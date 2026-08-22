import {
  existsSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { daemonsDir, ensureDaemonDirs, logFile, stateFile } from "./paths.ts";

/** 起動中デーモン 1 件の状態。`.overbake/daemons/<task>.json` に保存される */
export interface DaemonRecord {
  /** デーモンとして起動されたタスク名 */
  name: string;
  /** 子プロセスの PID（POSIX ではプロセスグループ ID も兼ねる） */
  pid: number;
  /** 起動時刻（ISO8601） */
  startedAt: string;
  /** ログファイルの絶対パス */
  logFile: string;
  /** 起動に使った実際のコマンド列（トラブルシュート用） */
  command: string[];
  /** 起動時の作業ディレクトリ */
  cwd: string;
}

export function writeRecord(root: string, record: DaemonRecord): void {
  ensureDaemonDirs(root);
  writeFileSync(
    stateFile(root, record.name),
    `${JSON.stringify(record, null, 2)}\n`,
  );
}

export function readRecord(
  root: string,
  taskName: string,
): DaemonRecord | null {
  const path = stateFile(root, taskName);
  if (!existsSync(path)) return null;
  return parseRecord(path);
}

export function removeRecord(root: string, taskName: string): void {
  const path = stateFile(root, taskName);
  if (existsSync(path)) unlinkSync(path);
}

/** 状態ファイルを全件読み込む（壊れたファイルは無視する） */
export function listRecords(root: string): DaemonRecord[] {
  const dir = daemonsDir(root);
  if (!existsSync(dir)) return [];

  const records: DaemonRecord[] = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".json")) continue;
    const record = parseRecord(resolve(dir, entry));
    if (record) records.push(record);
  }
  return records.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * プロセスが生存しているか（シグナル 0 で存在確認する）。
 *
 * 0 以下の PID は POSIX では「プロセスグループ」「全プロセス」を意味してしまうため、
 * 壊れた状態ファイルなどで紛れ込んでも決してシグナル対象にしない。
 */
export function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM は「他ユーザーのプロセスとして存在する」ので生存扱い
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** 停止済みデーモンの状態ファイルを削除し、生存しているものだけ返す */
export function pruneRecords(root: string): DaemonRecord[] {
  const alive: DaemonRecord[] = [];
  for (const record of listRecords(root)) {
    if (isAlive(record.pid)) {
      alive.push(record);
    } else {
      removeRecord(root, record.name);
    }
  }
  return alive;
}

/**
 * 状態ファイルを排他作成して「起動処理中」の権利を取る。既に存在すれば false。
 *
 * spawn 前に親プロセス自身の PID で仮のレコードを置くことで、生存確認から spawn までの
 * 隙間に別の `bake -d` が走っても二重起動しない（仮レコードの PID は親なので生存扱いになる）。
 * 親が途中で落ちた場合は PID が死ぬため、次回の prune で掃除される。
 */
export function claimRecord(
  root: string,
  name: string,
  pid: number,
  startedAt: Date,
): boolean {
  ensureDaemonDirs(root);
  const placeholder = createRecord({
    root,
    name,
    pid,
    command: [],
    cwd: root,
    startedAt,
  });
  try {
    writeFileSync(
      stateFile(root, name),
      `${JSON.stringify(placeholder, null, 2)}\n`,
      { flag: "wx" },
    );
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

/** 新規デーモン用の DaemonRecord を組み立てる */
export function createRecord(params: {
  root: string;
  name: string;
  pid: number;
  command: string[];
  cwd: string;
  startedAt: Date;
}): DaemonRecord {
  return {
    name: params.name,
    pid: params.pid,
    startedAt: params.startedAt.toISOString(),
    logFile: logFile(params.root, params.name),
    command: params.command,
    cwd: params.cwd,
  };
}

function parseRecord(path: string): DaemonRecord | null {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as DaemonRecord;
    if (typeof parsed.name !== "string" || typeof parsed.pid !== "number") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
