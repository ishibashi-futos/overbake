import { afterEach, beforeEach, describe } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import type { ComposeService } from "../../src/service/config.ts";
import { resolveServiceConfig } from "../../src/service/config.ts";
import type {
  ServiceConfig,
  ServiceDefinition,
  Task,
  TaskFunction,
} from "../../src/types.ts";

/**
 * テストごとに一時ディレクトリを作成・削除するヘルパー。
 *
 * `chdir: true` の場合は作成したディレクトリへ `process.chdir` し、
 * `afterEach` で元の作業ディレクトリへ戻す。
 *
 * @example
 * const tmp = useTempDir("overbake-foo", { chdir: true });
 * test("...", () => { writeFileSync(resolve(tmp.path, "Bakefile.ts"), "..."); });
 */
export function useTempDir(
  prefix = "overbake-test",
  options: { chdir?: boolean } = {},
): { readonly path: string } {
  const state = { path: "", originalCwd: "" };

  beforeEach(() => {
    state.originalCwd = process.cwd();
    state.path = resolve("/tmp", `${prefix}-${Date.now()}-${Math.random()}`);
    mkdirSync(state.path, { recursive: true });
    if (options.chdir) {
      process.chdir(state.path);
    }
  });

  afterEach(() => {
    // テスト本体が chdir した場合に備え、常に元の作業ディレクトリへ戻す。
    process.chdir(state.originalCwd);
    if (existsSync(state.path)) {
      rmSync(state.path, { recursive: true });
    }
  });

  return {
    get path() {
      return state.path;
    },
  };
}

/**
 * `console.log` / `console.error` の出力をテストごとにキャプチャするヘルパー。
 * 返り値の `logs` / `errors` には各呼び出しの引数を空白連結した文字列が積まれる。
 */
export function useConsoleCapture(): { logs: string[]; errors: string[] } {
  const logs: string[] = [];
  const errors: string[] = [];
  let originalLog: typeof console.log;
  let originalError: typeof console.error;

  beforeEach(() => {
    logs.length = 0;
    errors.length = 0;
    originalLog = console.log;
    originalError = console.error;
    console.log = (...args: unknown[]) => {
      logs.push(args.join(" "));
    };
    console.error = (...args: unknown[]) => {
      errors.push(args.join(" "));
    };
  });

  afterEach(() => {
    console.log = originalLog;
    console.error = originalError;
  });

  return { logs, errors };
}

/**
 * `process.stdout.write` の出力をテストごとにキャプチャするヘルパー。
 * 返り値の `writes` には各呼び出しの chunk を文字列化したものが順番に積まれる。
 */
export function useStdoutCapture(): { writes: string[] } {
  const writes: string[] = [];
  let original: typeof process.stdout.write;

  beforeEach(() => {
    writes.length = 0;
    original = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string) => {
      writes.push(chunk.toString());
      return true;
    }) as typeof process.stdout.write;
  });

  afterEach(() => {
    process.stdout.write = original;
  });

  return { writes };
}

/**
 * `process.exit` を no-op に差し替え、渡された終了コードを記録するヘルパー。
 * `code()` で直近の `process.exit` 呼び出しのコード（未呼び出しなら `undefined`）を取得する。
 */
export function useProcessExitMock(): () => number | undefined {
  const state = { code: undefined as number | undefined };
  let original: typeof process.exit;

  beforeEach(() => {
    state.code = undefined;
    original = process.exit;
    (process.exit as unknown) = (code?: number) => {
      state.code = code;
    };
  });

  afterEach(() => {
    process.exit = original;
  });

  return () => state.code;
}

/**
 * SIGTERM/SIGKILL・プロセスグループへのシグナル送信など POSIX 前提の describe。
 * Windows では挙動が異なるため skip する。
 */
export const describeIfPosix =
  process.platform === "win32" ? describe.skip : describe;

/**
 * ctx.signal の abort を待って return するタスク関数用のヘルパー。
 * 実プロセスを使わずに「停止要求を待ち受けて終了するサービス」を模したいテストで使う。
 */
export function waitForAbort(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

/**
 * condition が真になるまでポーリングする。timeoutMs を超えたら throw する。
 */
export async function waitUntil(
  condition: () => boolean,
  timeoutMs = 3000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10));
  }
  if (!condition()) throw new Error("waitUntil: timed out");
}

/**
 * stop() で abort されない限り絶対に解決しない sleep。
 * 「バックオフ/猶予待機に入ったまま止まらず、stop() で即座に抜ける」ことを
 * 厳密に検証したいテストで使う（実タイマーに依存しない）。
 */
export function makeNeverSleep(): (
  ms: number,
  signal: AbortSignal,
) => Promise<void> {
  return (_ms, signal) =>
    new Promise((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      signal.addEventListener("abort", () => resolve(), { once: true });
    });
}

/**
 * テスト用の Task（task.service で宣言したのと同じ形）を組み立てる。
 * registry.ts には依存しない。
 */
export function makeServiceTask(
  name: string,
  run: TaskFunction,
  config: ServiceConfig = {},
): Task {
  const service: ServiceDefinition = { run, source: { kind: "fn" }, ...config };
  return { name, fn: async () => {}, options: { service } };
}

/**
 * テスト用の ComposeService（superviseService に直接渡せる、検証済みの 1 サービス）を組み立てる。
 * makeServiceTask の上に組み立て、ServiceDefinition の生成箇所を 1 つに保つ。
 */
export function makeComposeService(
  name: string,
  run: TaskFunction,
  config: ServiceConfig = {},
): ComposeService {
  const task = makeServiceTask(name, run, config);
  const service = task.options?.service as ServiceDefinition;
  return { task, service, config: resolveServiceConfig(config) };
}
