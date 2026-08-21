import {
  chmodSync,
  existsSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { CliError } from "../cli/error.ts";
import type { FetchLike } from "./fetch.ts";

/** 旧バイナリの退避ファイル名に付ける接尾辞（`bake.exe.old-1234`）。 */
const BACKUP_SUFFIX = ".old-";

/** テスト用に差し替え可能な依存。既定は実行環境の値。 */
export interface InstallDeps {
  fetch: FetchLike;
  platform: NodeJS.Platform;
}

/**
 * 実行中の bake バイナリの絶対パス。
 * Bun standalone executable では process.execPath が bake 自身を指す。
 */
export function currentBinaryPath(): string {
  return process.execPath;
}

function isPermissionError(error: unknown): boolean {
  const code = (error as { code?: unknown }).code;
  return code === "EACCES" || code === "EPERM";
}

/** 消せなくても構わないファイルを削除する（実行中ロック・不在はいずれも無視）。 */
function removeQuietly(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch {
    // Windows では実行中のファイルを削除できない。次回の更新時に掃除する。
  }
}

/**
 * 前回の Windows 更新で削除できずに残った退避ファイルを掃除する。
 * 対象は targetPath と同一ディレクトリの `<binary>.old-*` のみ。
 */
function removeStaleBackups(targetPath: string): void {
  const dir = dirname(targetPath);
  const prefix = `${basename(targetPath)}${BACKUP_SUFFIX}`;

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.startsWith(prefix)) {
      removeQuietly(join(dir, entry));
    }
  }
}

/**
 * 一時ファイルを targetPath へ配置する。
 *
 * Unix: rename は原子的で、実行中バイナリもそのまま置換できる（旧 inode は開いたまま残る）。
 * Windows: 実行中の .exe へは上書き rename できないため、旧ファイルを退避してから
 *          新ファイルを配置する。退避ファイルは実行中ロックで削除できないことがあり、
 *          その場合は次回の更新時に removeStaleBackups が掃除する。
 */
function replaceBinary(
  tmpPath: string,
  targetPath: string,
  platform: NodeJS.Platform,
): void {
  if (platform !== "win32" || !existsSync(targetPath)) {
    renameSync(tmpPath, targetPath);
    return;
  }

  const backup = `${targetPath}${BACKUP_SUFFIX}${process.pid}`;
  renameSync(targetPath, backup);
  try {
    renameSync(tmpPath, targetPath);
  } catch (error) {
    // 新バイナリを置けなかった場合は旧バイナリを戻し、更新前の状態へ復帰する。
    renameSync(backup, targetPath);
    throw error;
  }
  removeQuietly(backup);
}

/**
 * downloadUrl からバイナリを取得し、targetPath を置換する。
 *
 * 一時ファイルは targetPath と同一ディレクトリに作成する（rename はファイルシステムを
 * またぐと原子的でなくなる/EXDEV になるため）。
 */
export async function installBinary(
  downloadUrl: string,
  targetPath: string,
  deps: Partial<InstallDeps> = {},
): Promise<void> {
  const fetchImpl = deps.fetch ?? fetch;
  const platform = deps.platform ?? process.platform;
  const tmpPath = join(dirname(targetPath), `.bake-update-${process.pid}.tmp`);

  removeStaleBackups(targetPath);

  try {
    let response: Response;
    try {
      response = await fetchImpl(downloadUrl, {
        headers: { "User-Agent": "overbake-bake-updater" },
      });
    } catch {
      throw new CliError(
        "ネットワークエラー: バイナリをダウンロードできませんでした",
        1,
      );
    }

    if (!response.ok) {
      throw new CliError(
        `バイナリのダウンロードに失敗しました (HTTP ${response.status})`,
        1,
      );
    }

    await Bun.write(tmpPath, await response.arrayBuffer());

    try {
      chmodSync(tmpPath, 0o755);
      replaceBinary(tmpPath, targetPath, platform);
    } catch (error) {
      if (isPermissionError(error)) {
        throw new CliError(
          `バイナリを置換する権限がありません: ${targetPath}\n` +
            "管理者権限（sudo / 管理者として実行）で再実行するか、" +
            "書き込み可能な場所へ再インストールしてください。",
          1,
        );
      }
      throw error;
    }
  } finally {
    // 成功時は rename 済みで tmpPath は存在しない。失敗時の後始末。
    removeQuietly(tmpPath);
  }
}
