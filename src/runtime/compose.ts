import {
  type ComposeService,
  resolveComposeStages,
} from "../service/config.ts";
import { tryConnect } from "../service/probe.ts";
import type { Task } from "../types.ts";
import { KILL_GRACE_MS } from "./context.ts";
import {
  defaultSleep,
  FAILURE_SETTLE_MS,
  type ServiceHandle,
  superviseService,
} from "./service.ts";

/** prefix 付与時に各サービスに割り当てる固定カラー（ANSI escape）。NO_COLOR/非 TTY では無効化 */
const COMPOSE_COLORS = [
  "\x1b[32m", // green
  "\x1b[34m", // blue
  "\x1b[33m", // yellow
  "\x1b[35m", // magenta
  "\x1b[36m", // cyan
  "\x1b[31m", // red
];
const COLOR_RESET = "\x1b[0m";

export interface RunComposeDeps {
  /** runCompose を呼び出した親タスク名（エラーメッセージ用） */
  taskName: string;
  root: string;
  cwd: string;
  /**
   * 外側（task.service に包まれた compose や、上位の compose）からの停止要求。
   * SIGINT / SIGTERM と同じく正常停止として扱う（開始時点で既に abort 済みなら何も起動しない）。
   */
  abortSignal?: AbortSignal;
}

export interface RunComposeOptions {
  /** テスト用: SIGTERM → SIGKILL までの猶予を上書き */
  graceMs?: number;
  /** テスト用: stdout 書き込み先（デフォルトは process.stdout.write） */
  writeOut?: (text: string) => void;
  /** テスト用: 色を強制無効化 */
  noColor?: boolean;
  /** テスト用: バックオフ・ready 待ちの待機実装を差し替える */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** テスト用: ready.port probe の TCP 接続確認を差し替える */
  connect?: (port: number, host: string, timeoutMs: number) => Promise<boolean>;
  /** テスト用: attempt の失敗を確定する前の猶予（ミリ秒）を上書きする。既定 FAILURE_SETTLE_MS */
  settleMs?: number;
}

function padLabel(label: string, width: number): string {
  return label.length >= width
    ? label
    : label + " ".repeat(width - label.length);
}

function colorize(text: string, color: string | null): string {
  return color ? `${color}${text}${COLOR_RESET}` : text;
}

/**
 * task.compose のステージ列を順に起動する。前ステージの全サービスが ready になってから
 * 次のステージを起動し（起動順）、ステージ内は同時に起動する。retry を使い切って失敗した
 * サービスが出たら全サービスを停止（SIGTERM → grace → SIGKILL）して compose failed で失敗する。
 * SIGINT / SIGTERM を受け取ったときは同様に全停止するが、throw せず正常終了する。
 */
export async function runCompose(
  deps: RunComposeDeps,
  stages: readonly (readonly Task[])[],
  options: RunComposeOptions = {},
): Promise<void> {
  let resolvedStages: ComposeService[][];
  try {
    resolvedStages = resolveComposeStages(stages);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`compose '${deps.taskName}': ${detail}`);
  }

  const flat = resolvedStages.flat();
  if (flat.length === 0) return;

  const writeOut =
    options.writeOut ??
    ((text: string): void => {
      process.stdout.write(text);
    });
  const useColor =
    !options.noColor && !process.env.NO_COLOR && Boolean(process.stdout.isTTY);
  const graceMs = options.graceMs ?? KILL_GRACE_MS;
  const sleep = options.sleep ?? defaultSleep;
  const connect = options.connect ?? tryConnect;
  const settleMs = options.settleMs ?? FAILURE_SETTLE_MS;

  // ラベル幅・固定カラーは全ステージ横断で事前計算する（サービス名は resolveComposeStages が重複を拒否済み）
  const width = flat.reduce((w, cs) => Math.max(w, cs.task.name.length), 0);
  const prefixes = new Map<string, string>(
    flat.map((cs, index) => {
      const color = useColor
        ? (COMPOSE_COLORS[index % COMPOSE_COLORS.length] as string)
        : null;
      return [
        cs.task.name,
        `${colorize(`[${padLabel(cs.task.name, width)}]`, color)} `,
      ];
    }),
  );

  const handles = new Map<string, ServiceHandle>();

  let shuttingDown = false;
  // let ではなくオブジェクトに包む: クロージャ越しの再代入を tsc の制御フロー解析に
  // 正しく反映させるため（narrowing が効かず failure.message が never 扱いになるのを防ぐ）
  const failureRef: { value: Error | null } = { value: null };
  let resolveShutdown!: () => void;
  const shutdown = new Promise<void>((resolve) => {
    resolveShutdown = resolve;
  });
  const triggerShutdown = (error: Error | null): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (error && !failureRef.value) failureRef.value = error;
    resolveShutdown();
  };

  const onSignal = (): void => triggerShutdown(null);
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  // task.service に包まれた compose（ネスト）や上位 compose からの停止要求。
  // SIGINT/SIGTERM と同じく正常停止として扱う。開始時点で既に abort 済みなら
  // 下の for ループが shuttingDown を見て何も起動しない。
  const onAbort = (): void => triggerShutdown(null);
  if (deps.abortSignal?.aborted) {
    triggerShutdown(null);
  } else {
    deps.abortSignal?.addEventListener("abort", onAbort, { once: true });
  }

  try {
    for (const stage of resolvedStages) {
      if (shuttingDown) break;

      const stageHandles = stage.map((cs) => {
        const prefix = prefixes.get(cs.task.name) as string;
        const handle = superviseService(cs, {
          root: deps.root,
          cwd: deps.cwd,
          writeLine: (line) => writeOut(`${prefix}${line}\n`),
          graceMs,
          sleep,
          connect,
          settleMs,
        });
        handles.set(cs.task.name, handle);
        // done の reject（retry を使い切った失敗）を fail-fast の起点にする。
        // ここで即座に拾っておくことで unhandled rejection を防ぐ。
        handle.done.then(undefined, (error: unknown) => {
          triggerShutdown(
            error instanceof Error ? error : new Error(String(error)),
          );
        });
        return handle;
      });

      const stageReady = Promise.all(stageHandles.map((h) => h.ready)).then(
        () => undefined,
      );
      await Promise.race([stageReady, shutdown]);
    }

    if (!shuttingDown) {
      // 全ステージが ready。SIGINT/SIGTERM か、いずれかのサービスの最終失敗を待つ。
      await shutdown;
    }

    for (const handle of handles.values()) handle.stop();
    await Promise.allSettled(Array.from(handles.values(), (h) => h.done));
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    deps.abortSignal?.removeEventListener("abort", onAbort);
  }

  if (failureRef.value) {
    throw new Error(`compose failed: ${failureRef.value.message}`);
  }
}
