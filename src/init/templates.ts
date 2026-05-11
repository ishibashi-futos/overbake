// bake init で生成するファイルのテンプレート
// Bakefile.d.ts は同階層に置かれることで TS Language Server が拾い、
// import 不要の状態で型補完を効かせる

export const BAKEFILE_TEMPLATE = `/// <reference path="./Bakefile.d.ts" />

// Bakefile.ts — Overbake のタスク定義ファイル
// 同階層の Bakefile.d.ts に task() 関数の型宣言があり、
// triple-slash reference によってエディタの型補完が有効になります。

task("hello", { desc: "サンプルタスク" }, async ({ log }) => {
  log("Hello from Overbake!");
});
`;

export const BAKEFILE_DTS_TEMPLATE = `// Bakefile.d.ts — Overbake が globalThis に注入する API の型宣言
// 実行時には参照されず、Bakefile.ts の型補完を提供するためだけに存在する
// Bakefile.ts の triple-slash reference によって TS Language Server に読み込まれる

interface TaskContext {
  name: string;
  root: string;
  cwd: string;
  cmd(command: string, args?: readonly string[], options?: { cwd?: string; env?: Record<string, string | undefined> }): Promise<void>;
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
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
  confirm?: string | string[];
  before?: (ctx: HookContext) => void | Promise<void>;
  after?: (
    ctx: HookContext & { ok: boolean; durationMs: number },
  ) => void | Promise<void>;
}

declare function task(name: string, fn: TaskFn): void;
declare function task(name: string, opts: TaskOptions, fn: TaskFn): void;
declare function task(name: string, opts: TaskOptions): void;

declare namespace task {
  function default(name: string): void;
}

declare const argv: readonly string[];
`;
