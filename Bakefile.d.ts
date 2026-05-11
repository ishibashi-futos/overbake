// Bakefile.d.ts — Overbake が globalThis に注入する API の型宣言
// 実行時には参照されず、Bakefile.ts の型補完を提供するためだけに存在する
// Bakefile.ts の triple-slash reference によって TS Language Server に読み込まれる

interface TaskContext {
  name: string;
  root: string;
  cwd: string;
  cmd(
    command: string,
    args?: readonly string[],
    options?: { cwd?: string; env?: Record<string, string | undefined> },
  ): Promise<void>;
  rm(
    path: string,
    options?: { recursive?: boolean; force?: boolean },
  ): Promise<void>;
  exists(path: string): boolean;
  resolve(...segments: string[]): string;
  log(...args: unknown[]): void;
}

type TaskFn = (ctx: TaskContext) => void | Promise<void>;

interface HookContext {
  name: string;
}

interface TaskOptions {
  desc?: string;
  deps?: string[];
  inputs?: string[];
  outputs?: string[];
  env?: string[];
  before?: (ctx: HookContext) => void | Promise<void>;
  after?: (
    ctx: HookContext & { ok: boolean; durationMs: number },
  ) => void | Promise<void>;
}

declare function task(name: string, fn: TaskFn): void;
declare function task(name: string, opts: TaskOptions, fn: TaskFn): void;
declare function task(name: string, opts: TaskOptions): void;

declare const argv: readonly string[];
