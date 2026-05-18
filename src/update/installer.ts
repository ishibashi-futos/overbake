import { chmodSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { CliError } from "../cli/error.ts";
import type { FetchLike } from "./fetch.ts";

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

/**
 * downloadUrl からバイナリを取得し、targetPath を原子的に置換する。
 *
 * 一時ファイルは targetPath と同一ディレクトリに作成する（rename はファイルシステムを
 * またぐと原子的でなくなる/EXDEV になるため）。実行中バイナリへの rename は Unix では
 * 安全で、旧 inode は開いたまま残る。
 */
export async function installBinary(
  downloadUrl: string,
  targetPath: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  const tmpPath = join(dirname(targetPath), `.bake-update-${process.pid}.tmp`);

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
      renameSync(tmpPath, targetPath);
    } catch (error) {
      if (isPermissionError(error)) {
        throw new CliError(
          `バイナリを置換する権限がありません: ${targetPath}\n` +
            "root 所有の場所にインストールされている可能性があります。" +
            "sudo で再実行するか、書き込み可能な場所へ再インストールしてください。",
          1,
        );
      }
      throw error;
    }
  } finally {
    // 成功時は rename 済みで tmpPath は存在しない。失敗時の後始末。
    rmSync(tmpPath, { force: true });
  }
}
