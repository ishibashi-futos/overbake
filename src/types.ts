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
  /**
   * task.each() で宣言された工程列（グラフ描画などのツール用の静的記述）。
   * 実行は生成された fn が ctx.runEach で行う。
   */
  each?: RunEachStep[];
  /**
   * task.compose() で宣言された並列サービス列（グラフ描画用の静的記述）。
   * 実行は生成された fn が runCompose で行う。
   */
  compose?: ComposeStep[];
}

/** task.each() で宣言された 1 工程の静的記述 */
export type RunEachStep =
  | { kind: "task"; name: string; desc?: string }
  | { kind: "command"; label: string };

/** task.compose() で宣言された 1 サービスの静的記述（構造は RunEachStep と同形だが意味論が違うため別名） */
export type ComposeStep =
  | { kind: "task"; name: string; desc?: string }
  | { kind: "command"; label: string };

export interface CmdOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  /**
   * 中断シグナル。abort() を呼ぶと cmd の起動した子プロセスに SIGTERM を送る。
   * task.compose の fail-fast / Ctrl+C 伝播で使用される。
   */
  signal?: AbortSignal;
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

/** task.each() の先頭に渡せるオプション（省略可）。TaskOptions と RunEachOptions の和。 */
export type TaskEachOptions = TaskOptions & RunEachOptions;

/** task.compose に渡せる要素: タスクオブジェクト または コマンド */
export type ComposeItem = Task | RunEachCommand;

/** task.compose() の先頭に渡せるオプション（省略可）。MVP では TaskOptions と同等。 */
export type TaskComposeOptions = TaskOptions;

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
  /**
   * 内部 API: task.compose で生成されるタスクから呼ばれる並列サービス起動。
   * 公開 d.ts には載せず、ユーザーは task.compose 経由でのみ使用する。
   * 1 サービスでも exit したら他に SIGTERM → grace 後 SIGKILL する fail-fast。
   */
  runCompose(items: ComposeItem[]): Promise<void>;
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
