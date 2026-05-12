export interface TaskOptions {
  desc?: string;
  deps?: string[];
  inputs?: string[];
  outputs?: string[];
  env?: string[];
  confirm?: string | string[];
  platforms?: NodeJS.Platform[];
  before?: (ctx: HookContext) => void | Promise<void>;
  after?: (
    ctx: HookContext & { ok: boolean; durationMs: number },
  ) => void | Promise<void>;
}

export interface CmdOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
}

export interface RmOptions {
  recursive?: boolean;
  force?: boolean;
}

/** runEach に渡せるコマンド: cmd と同じ [command, args?] 形式 */
export type RunEachCommand = readonly [string, (readonly string[])?];

/** runEach に渡せる要素: タスクオブジェクト または コマンド */
export type RunEachItem = Task | RunEachCommand;

export interface RunEachOptions {
  /** 全件成功時に出力するメッセージ（未指定なら既定文言） */
  done?: string;
  /** true なら最初の失敗で中断せず、全件実行してから失敗をまとめて報告する */
  keepGoing?: boolean;
}

export interface TaskContext {
  name: string;
  root: string;
  cwd: string;
  cmd(
    command: string,
    args?: readonly string[],
    options?: CmdOptions,
  ): Promise<void>;
  rm(path: string, options?: RmOptions): Promise<void>;
  exists(path: string): boolean;
  resolve(...segments: string[]): string;
  log(...args: unknown[]): void;
  /**
   * 複数のタスク・コマンドを順に実行する。各工程の出力は抑制し、
   * 失敗した工程の出力だけを表示して例外を投げる。全件成功時は done メッセージを出力する。
   */
  runEach(...items: (RunEachOptions | RunEachItem)[]): Promise<void>;
}

export type TaskFunction = (ctx: TaskContext) => void | Promise<void>;

export interface HookContext {
  name: string;
}

export interface TaskDefinition {
  name: string;
  fn: TaskFunction;
  isMeta?: boolean;
  options?: TaskOptions;
}

/** task() が返すハンドル。runEach に渡せる。 */
export type Task = TaskDefinition;
