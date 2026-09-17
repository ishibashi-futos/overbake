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
   * task.compose() で宣言された起動順の静的記述（グラフ描画・help・doctor 用）。
   * 外側の配列がステージ（この順に起動する）、内側が同時に起動するサービス名。
   * 実行は生成された fn が runCompose で行う。
   */
  compose?: string[][];
  /**
   * task.service() で宣言されたサービス定義。
   * task.compose はこの定義を使ってサービスを起動・監視・再起動する。
   */
  service?: ServiceDefinition;
  /**
   * task.cron() で宣言された定期実行の静的記述。
   * 実行は生成された fn が runCron で行う。
   */
  cron?: CronDefinition;
}

/** task.cron() で宣言された定期実行の静的記述 */
export interface CronDefinition {
  /** cron 式（`0 3 * * *` / `@daily` / `@every 30s`）。検証は parseSchedule が唯一の担当 */
  schedule: string;
  /** 1 回の発火で順に実行される工程列 */
  steps: RunEachStep[];
}

/** task.each() で宣言された 1 工程の静的記述 */
export type RunEachStep =
  | { kind: "task"; name: string; desc?: string }
  | { kind: "command"; label: string };

/** サービスの起動処理をどう渡したか（グラフ描画・help 用の静的記述） */
export type ServiceSource =
  | { kind: "fn" }
  | { kind: "command"; label: string }
  | { kind: "task"; name: string; desc?: string };

/** 起動完了（ready）の判定方法。いずれか 1 つだけを指定する */
export type ServiceReadyProbe =
  /** 出力行が一致したら ready（string は部分一致、RegExp は test） */
  | { log: string | RegExp }
  /** TCP 接続できたら ready（host の既定は "localhost"） */
  | { port: number; host?: string }
  /** true を返したら ready（false / throw は未 ready として intervalMs 後に再確認） */
  | { check: () => boolean | Promise<boolean> };

export type ServiceReady = ServiceReadyProbe & {
  /** ready になるまでの上限（ミリ秒）。超えたら失敗扱い。既定 60000 */
  timeoutMs?: number;
  /** port / check の確認間隔（ミリ秒）。既定 500 */
  intervalMs?: number;
};

/** 失敗時の再起動と指数バックオフ */
export interface ServiceRetry {
  /** 失敗後に再起動する最大回数。初回起動は含まず、サービスの生存期間全体で数える（ready でリセットしない） */
  attempts: number;
  /** 1 回目の再起動前の待機（ミリ秒）。既定 1000 */
  delayMs?: number;
  /** 再起動ごとに待機へ掛ける倍率。既定 2 */
  factor?: number;
  /** 待機の上限（ミリ秒）。既定 30000 */
  maxDelayMs?: number;
}

/** task.service() 固有のオプション */
export interface ServiceConfig {
  ready?: ServiceReady;
  /** 出力行がこれに一致したら失敗扱い（起動前後を問わない。同じ行で ready.log にも一致した場合は failOn を優先） */
  failOn?: string | RegExp;
  retry?: ServiceRetry;
}

/** task.service() で宣言されたサービスの定義 */
export interface ServiceDefinition extends ServiceConfig {
  /** 正規化済みの起動処理（関数・コマンド・タスクハンドルのいずれもこの形に揃える） */
  run: TaskFunction;
  source: ServiceSource;
}

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

/** task.service() の起動処理: タスク関数 / コマンド / タスクハンドル */
export type ServiceRun = TaskFunction | RunEachCommand | Task;

/** task.service() のオプション。TaskOptions と ServiceConfig の和。 */
export type TaskServiceOptions = TaskOptions & ServiceConfig;

/**
 * task.compose に渡せる要素: サービス または 同時に起動するサービスのグループ。
 * 要素がサービス（options.service を持つ）かどうかの検証は実行時と doctor で行う。
 */
export type ComposeItem = Task | readonly Task[];

/** task.compose() の先頭に渡せるオプション（省略可）。TaskOptions と同等。 */
export type TaskComposeOptions = TaskOptions;

/** task.cron() の第 2 引数。schedule は必須。 */
export type TaskCronOptions = TaskOptions & { schedule: string };

export interface TaskContext {
  name: string;
  root: string;
  cwd: string;
  /**
   * 停止要求のシグナル。task.compose / task.service 配下で停止・再起動するときに abort される。
   * ctx.cmd は自動でこれに従う。プロセス内でサーバを動かすタスク関数は abort を待って return すること。
   */
  signal: AbortSignal;
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
   * 内部 API: task.compose / task.service で生成されるタスクから呼ばれるサービス起動。
   * 公開 d.ts には載せず、ユーザーは task.compose / task.service 経由でのみ使用する。
   * stages を先頭から順に起動し、ステージ内の全サービスが ready になってから次のステージへ進む。
   * retry を使い切って失敗したサービスが出たら全サービスを停止する fail-fast。
   */
  runCompose(stages: readonly (readonly Task[])[]): Promise<void>;
  /**
   * 内部 API: task.cron で生成されるタスクから呼ばれる定期実行スケジューラ。
   * 公開 d.ts には載せず、ユーザーは task.cron 経由でのみ使用する。
   * 工程が失敗してもスケジューラは停止せず、次の発火を待つ。
   */
  runCron(schedule: string, items: RunEachItem[]): Promise<void>;
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
