import { existsSync, readFileSync, statSync } from "node:fs";
import { logFile } from "./paths.ts";
import {
  type RotationConfig,
  resolveRotationConfig,
  rotatedPaths,
} from "./rotate.ts";
import {
  type DaemonRecord,
  isAlive,
  listRecords,
  pruneRecords,
  readRecord,
  removeRecord,
} from "./state.ts";

/** SIGTERM 送信後、SIGKILL へ切り替えるまでの猶予（ミリ秒） */
export const STOP_GRACE_MS = 5000;

/** 停止確認のポーリング間隔（ミリ秒） */
const POLL_INTERVAL_MS = 50;

/** `bake logs -f` がログの追記を確認する間隔（ミリ秒） */
export const LOG_FOLLOW_INTERVAL_MS = 200;

export type StopStatus = "stopped" | "killed" | "not-running" | "not-found";

export interface StopResult {
  name: string;
  pid: number;
  status: StopStatus;
}

/**
 * プロセスグループへシグナルを送る。
 *
 * デーモンは `detached: true` で起動しており POSIX では PID がそのままプロセスグループ ID になる。
 * 負の PID を指定することで compose のサービスや ctx.cmd の孫プロセスまでまとめて停止できる。
 * Windows にはプロセスグループシグナルが無いため PID を直接指定する。
 *
 * 0 以下の PID は「全プロセス」等を意味してしまうため、シグナルを送らず false を返す。
 */
export function signalTree(pid: number, signal: NodeJS.Signals): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  const target = process.platform === "win32" ? pid : -pid;
  try {
    process.kill(target, signal);
    return true;
  } catch {
    // 既に終了している（ESRCH）等。呼び出し側は isAlive で最終判定する。
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    await sleep(POLL_INTERVAL_MS);
  }
  return !isAlive(pid);
}

/**
 * デーモンを停止する。SIGTERM → grace 経過後も生きていれば SIGKILL。
 * 既に停止していた場合は状態ファイルを掃除して `not-running` を返す。
 */
export async function stopDaemon(
  root: string,
  name: string,
  options: { graceMs?: number } = {},
): Promise<StopResult> {
  const record = readRecord(root, name);
  if (!record) {
    return { name, pid: -1, status: "not-found" };
  }

  if (!isAlive(record.pid)) {
    // リーダーだけが先に死んでいてもプロセスグループには孫プロセスが残りうる。
    // グループが存在しなければ ESRCH で何も起きないため、送るだけ送って掃除する。
    signalTree(record.pid, "SIGTERM");
    removeRecord(root, name);
    return { name, pid: record.pid, status: "not-running" };
  }

  signalTree(record.pid, "SIGTERM");
  const exited = await waitForExit(
    record.pid,
    options.graceMs ?? STOP_GRACE_MS,
  );

  if (!exited) {
    signalTree(record.pid, "SIGKILL");
    await waitForExit(record.pid, STOP_GRACE_MS);
    removeRecord(root, name);
    return { name, pid: record.pid, status: "killed" };
  }

  removeRecord(root, name);
  return { name, pid: record.pid, status: "stopped" };
}

/** 全デーモンを停止する */
export async function stopAllDaemons(
  root: string,
  options: { graceMs?: number } = {},
): Promise<StopResult[]> {
  const results: StopResult[] = [];
  for (const record of listRecords(root)) {
    results.push(await stopDaemon(root, record.name, options));
  }
  return results;
}

/** 経過時間を `1h 2m` のような短い文字列へ整形する */
export function formatUptime(startedAt: string, now: Date): string {
  const started = new Date(startedAt).getTime();
  const seconds = Math.max(0, Math.floor((now.getTime() - started) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** `bake ps` の一覧を整形する。停止済みのレコードはこの時点で掃除される。 */
export function renderDaemonList(root: string, now: Date = new Date()): string {
  const records = pruneRecords(root);
  if (records.length === 0) {
    return "No running daemons.";
  }

  const rows = records.map((record) => ({
    name: record.name,
    pid: String(record.pid),
    uptime: formatUptime(record.startedAt, now),
    log: record.logFile,
  }));

  const width = (key: "name" | "pid" | "uptime"): number =>
    Math.max(key.length, ...rows.map((row) => row[key].length));

  const nameWidth = width("name");
  const pidWidth = width("pid");
  const uptimeWidth = width("uptime");

  const lines = [
    `${"NAME".padEnd(nameWidth)}  ${"PID".padEnd(pidWidth)}  ${"UPTIME".padEnd(uptimeWidth)}  LOG`,
  ];
  for (const row of rows) {
    lines.push(
      `${row.name.padEnd(nameWidth)}  ${row.pid.padEnd(pidWidth)}  ${row.uptime.padEnd(uptimeWidth)}  ${row.log}`,
    );
  }
  return lines.join("\n");
}

/** ファイルを行配列として読む（末尾の空要素は最終行の改行なので行として数えない） */
function readLines(path: string): string[] {
  const all = readFileSync(path, "utf-8").split("\n");
  if (all[all.length - 1] === "") all.pop();
  return all;
}

/**
 * ログ末尾の `lines` 行を返す。ファイルが無ければ null。
 * 現在のログだけで足りない場合はローテーション済みの世代（`<log>.1`, `.2`, …）へ遡って補う。
 */
export function readLogTail(
  root: string,
  name: string,
  lines: number,
  config: RotationConfig = resolveRotationConfig(),
): string | null {
  const path = logFile(root, name);
  if (!existsSync(path)) return null;

  let collected = readLines(path);
  for (const rotated of rotatedPaths(path, config.keep)) {
    if (collected.length >= lines) break;
    if (!existsSync(rotated)) break;
    collected = [...readLines(rotated), ...collected];
  }

  return collected.slice(-lines).join("\n");
}

/**
 * ログファイルへの追記を監視し、追記分を callback へ渡す。
 * 返り値の関数を呼ぶと監視を停止する。
 *
 * デーモンは長寿命の fd で追記し続けるため `fs.watch` の変更イベントが発火しないことがある。
 * サイズのポーリングなら書き手の実装に依存せず追従でき、copytruncate によるローテーション
 * （サイズの巻き戻り）も先頭からの読み直しとして自然に扱える。
 */
export function followLog(
  root: string,
  name: string,
  onAppend: (text: string) => void,
  intervalMs: number = LOG_FOLLOW_INTERVAL_MS,
): () => void {
  const path = logFile(root, name);
  let offset = existsSync(path) ? statSync(path).size : 0;

  const read = (): void => {
    if (!existsSync(path)) return;
    const size = statSync(path).size;
    // ログが切り詰められた場合は先頭から読み直す
    if (size < offset) offset = 0;
    if (size === offset) return;
    const buffer = readFileSync(path).subarray(offset, size);
    offset = size;
    onAppend(buffer.toString("utf-8"));
  };

  const timer = setInterval(read, intervalMs);
  return () => {
    clearInterval(timer);
  };
}

export type { DaemonRecord };
