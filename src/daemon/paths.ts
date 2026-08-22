import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

/** Bakefile ルート直下に作られる作業ディレクトリ */
export const OVERBAKE_DIR = ".overbake";

/** デーモンのログ出力先ディレクトリ */
export function logsDir(root: string): string {
  return resolve(root, OVERBAKE_DIR, "logs");
}

/** デーモンの状態ファイル（PID など）の格納ディレクトリ */
export function daemonsDir(root: string): string {
  return resolve(root, OVERBAKE_DIR, "daemons");
}

/**
 * 安定した 32bit FNV-1a ハッシュ。ファイル名のサフィックスに使う。
 * ランタイム実装に依存しない自前実装にして、バージョン差でログの置き場所が変わらないようにする。
 */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * タスク名をファイル名として安全な形へ変換する。
 * `lint:fix` のような `:` 区切りのネームスペースも扱えるよう置換するが、
 * 置換が起きた場合は `lint:fix` と `lint_fix` が同じファイルを共有しないようハッシュを付ける。
 */
export function safeName(taskName: string): string {
  const sanitized = taskName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return sanitized === taskName ? taskName : `${sanitized}-${fnv1a(taskName)}`;
}

/** デーモンのログファイルパス */
export function logFile(root: string, taskName: string): string {
  return resolve(logsDir(root), `${safeName(taskName)}.log`);
}

/** デーモンの状態ファイルパス */
export function stateFile(root: string, taskName: string): string {
  return resolve(daemonsDir(root), `${safeName(taskName)}.json`);
}

/** ログ・状態ディレクトリを作成する（既存なら何もしない） */
export function ensureDaemonDirs(root: string): void {
  mkdirSync(logsDir(root), { recursive: true });
  mkdirSync(daemonsDir(root), { recursive: true });
}
