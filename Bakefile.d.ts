// Bakefile.d.ts — Overbake が globalThis に注入する API の型宣言
// 実行時には参照されず、Bakefile.ts の型補完を提供するためだけに存在する
// Bakefile.ts の triple-slash reference によって TS Language Server に読み込まれる

/** task() が返すハンドル。runEach / task.compose に渡せる。 */
interface Task {
  readonly name: string;
}

/** runEach / task.compose に渡せるコマンド: cmd と同じ [command, args?] 形式 */
type RunEachCommand = readonly [string, (readonly string[])?];

/** runEach に渡せる要素: タスクオブジェクト または コマンド */
type RunEachItem = Task | RunEachCommand;

/** task.compose に渡せる要素: タスクオブジェクト または コマンド */
type ComposeItem = Task | RunEachCommand;

interface RunEachOptions {
  /** 全件成功時に出力するメッセージ（未指定なら既定文言） */
  done?: string;
  /** true なら最初の失敗で中断せず、全件実行してから失敗をまとめて報告する */
  keepGoing?: boolean;
}

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
  /**
   * 複数のタスク・コマンドを順に実行する。各工程の出力は抑制し、
   * 失敗した工程の出力だけを表示して例外を投げる。全件成功時は done メッセージを出力する。
   */
  runEach(...items: (RunEachOptions | RunEachItem)[]): Promise<void>;
}

type TaskFn = (ctx: TaskContext) => void | Promise<void>;

type TaskPlatform =
  | "aix"
  | "darwin"
  | "freebsd"
  | "linux"
  | "openbsd"
  | "sunos"
  | "win32"
  | "cygwin"
  | "netbsd";

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
  platforms?: TaskPlatform[];
  before?: (ctx: HookContext) => void | Promise<void>;
  after?: (
    ctx: HookContext & { ok: boolean; durationMs: number },
  ) => void | Promise<void>;
}

/** task.each() の先頭に渡せるオプション（省略可） */
type TaskEachOptions = TaskOptions & RunEachOptions;

/** task.compose() の先頭に渡せるオプション（省略可） */
type TaskComposeOptions = TaskOptions;

declare function task(name: string, fn: TaskFn): Task;
declare function task(name: string, opts: TaskOptions, fn: TaskFn): Task;
declare function task(name: string, opts: TaskOptions): Task;

declare namespace task {
  /**
   * 複数のタスク・コマンドを順に実行するタスクを宣言的に登録する。
   * 工程は `bake <task> --graph` の出力にも辺として現れる。
   * 先頭にオプション（`{ desc, done, keepGoing, ... }`）を置ける。省略可。
   */
  export function each(
    name: string,
    ...items: (TaskEachOptions | RunEachItem)[]
  ): Task;

  /**
   * 複数の長時間サービスを並列起動するタスクを宣言的に登録する。
   * 1 つでも exit すると他に SIGTERM を送り、grace 後 SIGKILL する fail-fast。
   * 出力は [name] prefix 付きで stdout に行単位でストリーミングされる。
   * サービス列は `bake <task> --graph` の出力にも辺として現れる。
   */
  export function compose(
    name: string,
    ...items: (TaskComposeOptions | ComposeItem)[]
  ): Task;

  function defaultTask(task: Task): void;

  export { defaultTask as default };
}

declare const argv: readonly string[];
