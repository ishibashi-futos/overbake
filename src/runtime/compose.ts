import { type ChildProcess, spawn } from "node:child_process";
import { commandLabel, isCommand } from "../shared/run-each.ts";
import type { ComposeItem, RunEachCommand } from "../types.ts";
import { createTaskContext } from "./context.ts";

/** task.compose の fail-fast 時、SIGTERM 後に SIGKILL を送るまでの猶予（ミリ秒） */
export const COMPOSE_GRACE_MS = 5000;

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
}

export interface RunComposeOptions {
  /** テスト用: SIGTERM → SIGKILL までの猶予を上書き */
  graceMs?: number;
  /** テスト用: stdout 書き込み先（デフォルトは process.stdout.write） */
  writeOut?: (text: string) => void;
  /** テスト用: 色を強制無効化 */
  noColor?: boolean;
}

interface ServiceState {
  rawName: string;
  proc?: ChildProcess;
  abort?: AbortController;
  done: Promise<void>;
  exitCode: number | null;
  signaled: NodeJS.Signals | null;
}

interface Failure {
  label: string;
  reason: string;
}

/**
 * 複数の長時間サービスを並列起動する。1 サービスでも exit したら他に SIGTERM を送り、
 * grace 経過後も生きていれば SIGKILL する。SIGINT/SIGTERM を受け取ったら全サービスを停止する。
 *
 * Task ハンドル渡しの場合、サービス側の fn が `ctx.cmd(...)` で起動した grandchild プロセスに
 * SIGTERM を伝播させるため、各サービスに AbortController を割り当てて createTaskContext に渡す。
 */
export async function runCompose(
  deps: RunComposeDeps,
  items: readonly ComposeItem[],
  options: RunComposeOptions = {},
): Promise<void> {
  if (items.length === 0) return;

  const writeOut =
    options.writeOut ??
    ((text: string): void => {
      process.stdout.write(text);
    });
  const useColor =
    !options.noColor && !process.env.NO_COLOR && Boolean(process.stdout.isTTY);
  const grace = options.graceMs ?? COMPOSE_GRACE_MS;

  const labels = items.map(labelOf);
  const width = labels.reduce((w, l) => Math.max(w, l.length), 0);

  const services: ServiceState[] = items.map((item, index) =>
    startService(
      item,
      labels[index] as string,
      width,
      index,
      useColor,
      writeOut,
      deps,
    ),
  );

  const firstFailureRef: { value: Failure | null } = { value: null };
  let shuttingDown = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;

  // failure が null の場合は user-initiated stop（SIGINT/SIGTERM）として扱い、最終的に throw しない。
  // 非 null の場合は「サービスが prematurely exit した」fail-fast で、最後に compose failed を throw する。
  const triggerShutdown = (failure: Failure | null): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (failure !== null && firstFailureRef.value === null) {
      firstFailureRef.value = failure;
    }
    for (const s of services) {
      if (s.exitCode !== null) continue;
      // task ハンドル渡しは abort 経由で grandchild に SIGTERM を届ける。
      // command 渡しは直接 proc に SIGTERM。
      if (s.abort) s.abort.abort();
      if (s.proc?.exitCode === null) s.proc.kill("SIGTERM");
    }
    killTimer = setTimeout(() => {
      for (const s of services) {
        if (s.proc && s.proc.exitCode === null) s.proc.kill("SIGKILL");
      }
    }, grace);
    killTimer.unref?.();
  };

  // SIGINT/SIGTERM は user-initiated stop。failure を残さず、全サービスを停止して正常終了する。
  const onSignal = (): void => {
    triggerShutdown(null);
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  try {
    // Promise.race で初動 exit を検知。task ハンドル fn が throw した場合も race が解決する。
    await Promise.race(services.map((s) => s.done.catch(() => undefined)));
    if (!shuttingDown) {
      const exited = services.find((s) => s.exitCode !== null);
      if (exited) {
        const reason =
          exited.exitCode === 0
            ? "exited unexpectedly (code 0)"
            : exited.signaled
              ? `terminated by ${exited.signaled}`
              : `exited with code ${exited.exitCode}`;
        triggerShutdown({ label: exited.rawName, reason });
      }
    }
    await Promise.allSettled(services.map((s) => s.done));
  } finally {
    if (killTimer) clearTimeout(killTimer);
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }

  const failure = firstFailureRef.value;
  if (failure) {
    throw new Error(`compose failed: ${failure.label}: ${failure.reason}`);
  }
}

function labelOf(item: ComposeItem): string {
  return isCommand(item) ? commandLabel(item) : item.name;
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
 * 1 サービスを起動して ServiceState を返す。
 * - command タプル: 直接 spawn し、stdout/stderr を行バッファ → prefix 付け → writeOut へ流す
 * - task ハンドル: AbortController 付きの TaskContext を作って fn を呼ぶ。
 *   fn 内の ctx.cmd は abortSignal を継承して grandchild に SIGTERM が届くようになる。
 */
function startService(
  item: ComposeItem,
  rawLabel: string,
  width: number,
  index: number,
  useColor: boolean,
  writeOut: (text: string) => void,
  deps: RunComposeDeps,
): ServiceState {
  const paddedLabel = padLabel(rawLabel, width);
  const color = useColor
    ? (COMPOSE_COLORS[index % COMPOSE_COLORS.length] as string)
    : null;
  const prefix = `${colorize(`[${paddedLabel}]`, color)} `;

  const state: ServiceState = {
    rawName: rawLabel,
    exitCode: null,
    signaled: null,
    done: Promise.resolve(),
  };

  let lineBuffer = "";
  const emit = (chunk: string): void => {
    lineBuffer += chunk;
    let nl = lineBuffer.indexOf("\n");
    while (nl !== -1) {
      const line = lineBuffer.slice(0, nl);
      lineBuffer = lineBuffer.slice(nl + 1);
      writeOut(`${prefix}${line}\n`);
      nl = lineBuffer.indexOf("\n");
    }
  };
  const flushTail = (): void => {
    if (lineBuffer.length > 0) {
      writeOut(`${prefix}${lineBuffer}\n`);
      lineBuffer = "";
    }
  };

  if (isCommand(item)) {
    const [command, args] = item as RunEachCommand;
    const proc = spawn(command, args ? Array.from(args) : [], {
      cwd: deps.root,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    state.proc = proc;
    proc.stdout?.on("data", (chunk: Buffer | string) => emit(chunk.toString()));
    proc.stderr?.on("data", (chunk: Buffer | string) => emit(chunk.toString()));

    state.done = new Promise<void>((resolve) => {
      const finish = (): void => {
        flushTail();
        resolve();
      };
      proc.on("exit", (code, signal) => {
        state.exitCode = code ?? (signal ? -1 : 0);
        state.signaled = signal ?? null;
        finish();
      });
      proc.on("error", (err) => {
        // spawn 自体が失敗したケース（例: ENOENT）
        writeOut(`${prefix}${err.message}\n`);
        if (state.exitCode === null) state.exitCode = -1;
        finish();
      });
    });
    return state;
  }

  // task ハンドル
  const abort = new AbortController();
  state.abort = abort;
  const ctx = createTaskContext({
    name: item.name,
    root: deps.root,
    cwd: deps.cwd,
    onOutput: emit,
    abortSignal: abort.signal,
  });
  state.done = (async () => {
    try {
      await item.fn(ctx);
      // task fn が正常 return した = サービスが「正常 exit」した。長時間サービスでは想定外。
      state.exitCode ??= 0;
    } catch (err) {
      // ctx.cmd が非0 exit や AbortError で reject した。exit コードは不明なので -1。
      if (state.exitCode === null) state.exitCode = -1;
      const msg = err instanceof Error ? err.message : String(err);
      writeOut(`${prefix}${msg}\n`);
    } finally {
      flushTail();
    }
  })();
  return state;
}
