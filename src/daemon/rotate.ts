import {
  appendFileSync,
  copyFileSync,
  existsSync,
  renameSync,
  statSync,
  truncateSync,
  unlinkSync,
} from "node:fs";

/** ローテーションの既定しきい値（1MB） */
export const DEFAULT_LOG_MAX_BYTES = 1024 * 1024;

/** 保持する世代数の既定値（dev.log.1 〜 dev.log.3） */
export const DEFAULT_LOG_KEEP = 3;

/** デーモン子プロセスがサイズを確認する間隔の既定値 */
export const DEFAULT_LOG_CHECK_INTERVAL_MS = 5000;

/** デーモン子プロセスへログファイルのパスを伝える環境変数 */
export const DAEMON_LOG_ENV = "OVERBAKE_DAEMON_LOG";

const MAX_BYTES_ENV = "OVERBAKE_LOG_MAX_BYTES";
const KEEP_ENV = "OVERBAKE_LOG_KEEP";
const CHECK_INTERVAL_ENV = "OVERBAKE_LOG_CHECK_MS";

export interface RotationConfig {
  /** これを超えたらローテーションする。0 ならローテーションしない */
  maxBytes: number;
  /** 保持する世代数 */
  keep: number;
  /** デーモン子プロセスがサイズを確認する間隔（ミリ秒） */
  checkIntervalMs: number;
}

/** 非負整数として環境変数を読む。不正な値は黙って無視せずエラーにする */
function readNonNegativeInt(
  env: Record<string, string | undefined>,
  name: string,
  fallback: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `${name} は 0 以上の整数で指定してください（受け取った値: ${raw}）`,
    );
  }
  return value;
}

/**
 * 環境変数からローテーション設定を解決する。
 * `OVERBAKE_LOG_MAX_BYTES=0` を指定するとローテーションを無効化できる。
 */
export function resolveRotationConfig(
  env: Record<string, string | undefined> = process.env,
): RotationConfig {
  const checkIntervalMs = readNonNegativeInt(
    env,
    CHECK_INTERVAL_ENV,
    DEFAULT_LOG_CHECK_INTERVAL_MS,
  );
  if (checkIntervalMs === 0) {
    throw new Error(`${CHECK_INTERVAL_ENV} は 1 以上で指定してください`);
  }
  return {
    maxBytes: readNonNegativeInt(env, MAX_BYTES_ENV, DEFAULT_LOG_MAX_BYTES),
    keep: readNonNegativeInt(env, KEEP_ENV, DEFAULT_LOG_KEEP),
    checkIntervalMs,
  };
}

/** 世代 n のローテーション済みログのパス（`dev.log` → `dev.log.1`） */
export function rotatedPath(logPath: string, generation: number): string {
  return `${logPath}.${generation}`;
}

/** 新しい世代から古い世代の順にローテーション済みログのパスを列挙する */
export function rotatedPaths(logPath: string, keep: number): string[] {
  return Array.from({ length: keep }, (_, i) => rotatedPath(logPath, i + 1));
}

/**
 * ログが maxBytes を超えていれば世代をずらして切り詰める。ローテーションしたら true。
 *
 * **copytruncate 方式**: デーモンの子プロセス（と孫プロセス）は stdout/stderr として
 * このファイルの fd を継承しているため、rename して新規作成すると書き手は退避先の inode へ
 * 書き続けてしまう。そこで内容を `<log>.1` へコピーしてから live なファイルを 0 に切り詰める。
 * fd は `O_APPEND` で開かれているので、切り詰め後の書き込みは先頭から続く（穴は空かない）。
 */
export function rotateIfNeeded(
  logPath: string,
  config: RotationConfig,
  now: Date = new Date(),
): boolean {
  if (config.maxBytes === 0) return false;
  if (!existsSync(logPath)) return false;
  if (statSync(logPath).size <= config.maxBytes) return false;

  if (config.keep === 0) {
    truncateSync(logPath, 0);
    appendFileSync(logPath, rotationMarker(now, null));
    return true;
  }

  // 最古の世代を捨て、残りを 1 つずつ古い方へずらす
  const oldest = rotatedPath(logPath, config.keep);
  if (existsSync(oldest)) unlinkSync(oldest);
  for (let generation = config.keep - 1; generation >= 1; generation--) {
    const from = rotatedPath(logPath, generation);
    if (existsSync(from))
      renameSync(from, rotatedPath(logPath, generation + 1));
  }

  const newest = rotatedPath(logPath, 1);
  copyFileSync(logPath, newest);
  truncateSync(logPath, 0);
  appendFileSync(logPath, rotationMarker(now, newest));
  return true;
}

function rotationMarker(now: Date, movedTo: string | null): string {
  const where = movedTo ? `（前のログ: ${movedTo}）` : "（前のログは破棄）";
  return `=== rotated at ${now.toISOString()} ${where} ===\n`;
}

/**
 * デーモン子プロセス内でログサイズを定期的に監視し、超過したらローテーションする。
 * 返り値の関数を呼ぶと監視を止める。タイマーは unref するのでプロセスの寿命には影響しない。
 */
export function startLogRotation(
  logPath: string,
  config: RotationConfig = resolveRotationConfig(),
): () => void {
  if (config.maxBytes === 0) return () => {};

  const timer = setInterval(() => {
    rotateIfNeeded(logPath, config);
  }, config.checkIntervalMs);
  timer.unref?.();

  return () => {
    clearInterval(timer);
  };
}
