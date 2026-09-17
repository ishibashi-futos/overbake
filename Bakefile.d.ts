// Bakefile.d.ts — Overbake が globalThis に注入する API の型宣言
// 実行時には参照されず、Bakefile.ts の型補完を提供するためだけに存在する
// Bakefile.ts の triple-slash reference によって TS Language Server に読み込まれる

// Bakefile.ts は tsconfig.json の include 外にあり、エディタでは bun の型が
// 自動では入らない inferred project として扱われる。この参照が自ファイルの位置を
// 起点に @types/bun を解決し、Bakefile.ts での Bun.* 補完を成立させる。
/// <reference types="bun" />

/** task() が返すハンドル。runEach / task.each / task.cron / task.service に渡せる。 */
interface Task {
  readonly name: string;
}

/** Service を通常の Task と型の上で区別するための目印（実行時には存在しない） */
declare const serviceBrand: unique symbol;

/** task.service() が返すハンドル。task.compose に渡せる。Task としても使える。 */
interface Service extends Task {
  readonly [serviceBrand]: true;
}

/** runEach / task.service に渡せるコマンド: cmd と同じ [command, args?] 形式 */
type RunEachCommand = readonly [string, (readonly string[])?];

/** runEach に渡せる要素: タスクオブジェクト または コマンド */
type RunEachItem = Task | RunEachCommand;

/** task.compose に渡せる要素: サービス または 同時に起動するサービスのグループ */
type ComposeItem = Service | readonly Service[];

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
  /**
   * 停止要求のシグナル。task.compose / task.service 配下で停止・再起動するときに abort される。
   * ctx.cmd は自動でこれに従う。プロセス内でサーバを動かすタスク関数は abort を待って return すること。
   */
  signal: AbortSignal;
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

/** task.service() の起動処理: タスク関数 / コマンド / タスクハンドル */
type ServiceRun = TaskFn | RunEachCommand | Task;

/** 起動完了（ready）の判定方法。log / port / check のいずれか 1 つを指定する */
type ServiceReadyProbe =
  /** 出力行が一致したら ready（string は部分一致、RegExp は test） */
  | { log: string | RegExp }
  /** TCP 接続できたら ready（host の既定は "localhost"） */
  | { port: number; host?: string }
  /** true を返したら ready（false / throw は未 ready として intervalMs 後に再確認） */
  | { check: () => boolean | Promise<boolean> };

type ServiceReady = ServiceReadyProbe & {
  /** ready になるまでの上限（ミリ秒）。超えたら失敗扱い。既定 60000 */
  timeoutMs?: number;
  /** port / check の確認間隔（ミリ秒）。既定 500 */
  intervalMs?: number;
};

/** 失敗時の再起動と指数バックオフ（待機 = delayMs × factor^(n-1)、maxDelayMs で頭打ち） */
interface ServiceRetry {
  /** 失敗後に再起動する最大回数。初回起動は含まず、サービスの生存期間全体で数える */
  attempts: number;
  /** 1 回目の再起動前の待機（ミリ秒）。既定 1000 */
  delayMs?: number;
  /** 再起動ごとに待機へ掛ける倍率。既定 2 */
  factor?: number;
  /** 待機の上限（ミリ秒）。既定 30000 */
  maxDelayMs?: number;
}

/** task.service() のオプション（省略可） */
type TaskServiceOptions = TaskOptions & {
  /** 起動完了の判定。省略時は起動した直後に ready とみなす */
  ready?: ServiceReady;
  /** 出力行がこれに一致したら失敗扱い（起動前後を問わず、ready.log より優先） */
  failOn?: string | RegExp;
  /** 失敗時の再起動。省略時は再起動しない */
  retry?: ServiceRetry;
};

/** task.cron() の第 2 引数。schedule は必須。 */
type TaskCronOptions = TaskOptions & {
  /**
   * cron 式。5 フィールド（`分 時 日 月 曜日`）のほか、
   * `@daily` などのエイリアスと `@every 30s` 形式の固定間隔が使える。
   */
  schedule: string;
};

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
   * 長時間動くサービス（dev サーバ・DB・worker など）を宣言的に登録する。
   * 起動完了（ready）と失敗の条件、失敗時の再起動（指数バックオフ）を指定できる。
   * 失敗 = ready 前の終了 / ready タイムアウト / ready 後の終了（exit 0 を含む） / failOn に一致する出力。
   * `bake <service>` で単体起動でき、task.compose に渡すと起動順を指定して束ねられる。
   */
  export function service(name: string, run: ServiceRun): Service;
  export function service(
    name: string,
    options: TaskServiceOptions,
    run: ServiceRun,
  ): Service;

  /**
   * 複数のサービスを起動順に従って起動するタスクを宣言的に登録する。
   * 引数の並びが起動順で、配列で渡したサービスは同時に起動する。
   * 前のステージの全サービスが ready になってから次のステージを起動する（例: db, [api, worker], web）。
   * retry を使い切って失敗したサービスが出たら全サービスに SIGTERM を送り、grace 後 SIGKILL する fail-fast。
   * 出力は [name] prefix 付きで stdout に行単位でストリーミングされる。
   * サービスは `bake <task> --graph` の出力にも辺として現れる。
   */
  export function compose(
    name: string,
    ...items: (TaskComposeOptions | ComposeItem)[]
  ): Task;

  /**
   * 工程列をスケジュールに従って繰り返し実行するタスクを宣言的に登録する。
   * 1 回の発火は task.each と同じ逐次実行。工程が失敗してもスケジューラは止まらない。
   * 次回時刻は実行完了後に計算するため多重起動しない。
   * `bake <task>` で前景実行、`bake -d <task>` でデーモン実行。
   * task.compose に入れる場合は task.service で包む（例: task.service("poller", cronTask)）。
   */
  export function cron(
    name: string,
    options: TaskCronOptions,
    ...items: RunEachItem[]
  ): Task;

  function defaultTask(task: Task): void;

  export { defaultTask as default };
}

declare const argv: readonly string[];
