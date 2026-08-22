import { spawn } from "node:child_process";
import { appendFileSync, closeSync, openSync } from "node:fs";
import { ensureDaemonDirs, logFile } from "./paths.ts";
import {
  DAEMON_LOG_ENV,
  resolveRotationConfig,
  rotateIfNeeded,
} from "./rotate.ts";
import { createRecord, type DaemonRecord, writeRecord } from "./state.ts";

/** デーモン起動時に子プロセスの引数から取り除くフラグ（子は通常の前景実行として動く） */
export const DAEMON_FLAGS = ["-d", "--daemon"] as const;

/**
 * `bun build --compile` 製バイナリでは argv[1] が `/$bunfs/root/<name>`（Windows は `B:\~BUN\root\...`）
 * という仮想パスになり、そのまま再実行できない。この場合はランナー引数を付けず execPath だけで起動する。
 */
export function isEmbeddedEntry(entry: string | undefined): boolean {
  if (entry === undefined) return true;
  return entry.startsWith("/$bunfs/") || /^[A-Za-z]:[\\/]~BUN[\\/]/.test(entry);
}

/**
 * 自分自身を再実行するためのコマンド列を組み立てる。
 *
 * - コンパイル済みバイナリ: `[bake, <args...>]`
 * - 開発時（`bun src/cli/main.ts`）: `[bun, src/cli/main.ts, <args...>]`
 *
 * デーモンフラグは取り除き、`appendArgs`（確認プロンプトを親で済ませた印の `--yes` など）を足す。
 * `--` 以降はタスクへのパススルーなので触らず、そのまま末尾へ残す
 * （`--yes` も `--` より前に入れないと bake のフラグとして解釈されない）。
 */
export function buildDaemonCommand(params: {
  /** 実行中のランタイム（process.execPath） */
  execPath: string;
  /** エントリポイント（process.argv[1]）。コンパイル済みバイナリでは仮想パスになる */
  entry: string | undefined;
  /** CLI 引数（process.argv.slice(2) 相当） */
  args: readonly string[];
  appendArgs?: readonly string[];
}): string[] {
  const { execPath, entry, args, appendArgs = [] } = params;
  const runnerArgs = isEmbeddedEntry(entry) ? [] : [entry as string];

  const dashIndex = args.indexOf("--");
  const head = dashIndex !== -1 ? args.slice(0, dashIndex) : [...args];
  // `--` 自身も含めてそのまま引き継ぐ
  const passthrough = dashIndex !== -1 ? args.slice(dashIndex) : [];

  const taskArgs = head.filter(
    (arg) => !(DAEMON_FLAGS as readonly string[]).includes(arg),
  );
  const extra = appendArgs.filter((arg) => !taskArgs.includes(arg));
  return [execPath, ...runnerArgs, ...taskArgs, ...extra, ...passthrough];
}

export interface StartDaemonParams {
  root: string;
  /** デーモンとして起動するタスク名 */
  name: string;
  /** 子プロセスへ渡すコマンド列（buildDaemonCommand の戻り値） */
  command: string[];
  /** 子プロセスの作業ディレクトリ */
  cwd: string;
  /** テスト用: 現在時刻 */
  now?: Date;
}

/**
 * タスクをバックグラウンドのデーモンとして起動する。
 *
 * - stdout / stderr は `.overbake/logs/<task>.log` へ追記する（子から見た stdout はファイルなので
 *   `isTTY` が false になり、色付けや確認プロンプトは自動的に無効化される）。
 * - 起動時にサイズ超過を確認してローテーションし、子には `OVERBAKE_DAEMON_LOG` を渡して
 *   常駐中も自分でサイズを見張らせる（fd を継承しているのは子なので、切り詰めは子側で行う）。
 * - `detached: true` で新しいプロセスグループのリーダーにするため、`bake stop` はグループ全体
 *   （compose のサービスや ctx.cmd の孫プロセス）へシグナルを送れる。
 */
export function startDaemon(params: StartDaemonParams): DaemonRecord {
  const { root, name, command, cwd } = params;
  const startedAt = params.now ?? new Date();

  ensureDaemonDirs(root);
  const logPath = logFile(root, name);
  // 前回までのログが上限を超えていれば、書き手がいない今のうちに退避しておく
  rotateIfNeeded(logPath, resolveRotationConfig(), startedAt);
  appendFileSync(
    logPath,
    `=== ${name} started at ${startedAt.toISOString()} ===\n`,
  );

  const fd = openSync(logPath, "a");
  try {
    const [file, ...args] = command as [string, ...string[]];
    const child = spawn(file, args, {
      cwd,
      env: { ...process.env, [DAEMON_LOG_ENV]: logPath },
      stdio: ["ignore", fd, fd],
      detached: true,
      shell: false,
    });
    child.unref();

    if (child.pid === undefined) {
      // spawn に失敗した（実行ファイルが見つからない等）。PID の無いレコードは残さない。
      throw new Error(
        `デーモン '${name}' の起動に失敗しました: ${command.join(" ")}`,
      );
    }

    const record = createRecord({
      root,
      name,
      pid: child.pid,
      command,
      cwd,
      startedAt,
    });
    writeRecord(root, record);
    return record;
  } finally {
    closeSync(fd);
  }
}
