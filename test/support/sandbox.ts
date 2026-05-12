import { afterEach, beforeEach } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

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
