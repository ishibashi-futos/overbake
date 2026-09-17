import type {
  ServiceConfig,
  ServiceDefinition,
  TaskDefinition,
} from "../types.ts";

/** ServiceConfig の未指定項目を補う既定値 */
export const SERVICE_DEFAULTS = {
  readyTimeoutMs: 60000,
  readyIntervalMs: 500,
  host: "localhost",
  retryDelayMs: 1000,
  retryFactor: 2,
  retryMaxDelayMs: 30000,
} as const;

/** 既定値補完・検証後の ready probe（3 種のいずれか） */
export type ResolvedProbe =
  | { kind: "log"; pattern: string | RegExp }
  | { kind: "port"; port: number; host: string }
  | { kind: "check"; check: () => boolean | Promise<boolean> };

/** 既定値補完後の retry 設定 */
export interface ResolvedRetry {
  attempts: number;
  delayMs: number;
  factor: number;
  maxDelayMs: number;
}

/** 既定値補完・検証済みの ServiceConfig */
export interface ResolvedServiceConfig {
  ready: { probe: ResolvedProbe; timeoutMs: number; intervalMs: number } | null;
  failOn: string | RegExp | null;
  retry: ResolvedRetry;
}

/** 値をエラーメッセージに埋め込むための表示形式。関数・RegExp も判読できる形にする */
function describeValue(value: unknown): string {
  if (typeof value === "function") return "[Function]";
  if (value instanceof RegExp) return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function resolveReady(
  ready: ServiceConfig["ready"],
): ResolvedServiceConfig["ready"] {
  if (ready === undefined) return null;

  const kindCount =
    ("log" in ready ? 1 : 0) +
    ("port" in ready ? 1 : 0) +
    ("check" in ready ? 1 : 0);
  if (kindCount !== 1) {
    throw new Error(
      "ready は log / port / check のいずれか 1 つだけを指定してください",
    );
  }

  const timeoutMs = ready.timeoutMs ?? SERVICE_DEFAULTS.readyTimeoutMs;
  if (!isFiniteNumber(timeoutMs) || timeoutMs <= 0) {
    throw new Error(
      `ready.timeoutMs は有限の正の数を指定してください（指定値: ${describeValue(timeoutMs)}）`,
    );
  }
  const intervalMs = ready.intervalMs ?? SERVICE_DEFAULTS.readyIntervalMs;
  if (!isFiniteNumber(intervalMs) || intervalMs <= 0) {
    throw new Error(
      `ready.intervalMs は有限の正の数を指定してください（指定値: ${describeValue(intervalMs)}）`,
    );
  }

  // "in" によるナローイングを効かせるため、ブール変数へ抽出せずここで直接分岐する
  if ("log" in ready) {
    const pattern = ready.log;
    if (!(pattern instanceof RegExp) && !isNonEmptyString(pattern)) {
      throw new Error(
        `ready.log は空でない文字列または RegExp を指定してください（指定値: ${describeValue(pattern)}）`,
      );
    }
    return { probe: { kind: "log", pattern }, timeoutMs, intervalMs };
  }
  if ("port" in ready) {
    const port = ready.port;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(
        `ready.port は 1〜65535 の整数を指定してください（指定値: ${describeValue(port)}）`,
      );
    }
    const host = ready.host ?? SERVICE_DEFAULTS.host;
    if (!isNonEmptyString(host)) {
      throw new Error(
        `ready.host は空でない文字列を指定してください（指定値: ${describeValue(host)}）`,
      );
    }
    return { probe: { kind: "port", port, host }, timeoutMs, intervalMs };
  }
  // kindCount === 1 の検証により、ここに来るときは必ず check が指定されている
  const check = ready.check;
  if (typeof check !== "function") {
    throw new Error(
      `ready.check は関数を指定してください（指定値: ${describeValue(check)}）`,
    );
  }
  return { probe: { kind: "check", check }, timeoutMs, intervalMs };
}

function resolveFailOn(
  failOn: ServiceConfig["failOn"],
): ResolvedServiceConfig["failOn"] {
  if (failOn === undefined) return null;
  if (!(failOn instanceof RegExp) && !isNonEmptyString(failOn)) {
    throw new Error(
      `failOn は空でない文字列または RegExp を指定してください（指定値: ${describeValue(failOn)}）`,
    );
  }
  return failOn;
}

function resolveRetry(retry: ServiceConfig["retry"]): ResolvedRetry {
  if (retry === undefined) {
    return {
      attempts: 0,
      delayMs: SERVICE_DEFAULTS.retryDelayMs,
      factor: SERVICE_DEFAULTS.retryFactor,
      maxDelayMs: SERVICE_DEFAULTS.retryMaxDelayMs,
    };
  }

  const attempts = retry.attempts;
  if (!Number.isInteger(attempts) || attempts < 0) {
    throw new Error(
      `retry.attempts は 0 以上の整数を指定してください（指定値: ${describeValue(attempts)}）`,
    );
  }
  const delayMs = retry.delayMs ?? SERVICE_DEFAULTS.retryDelayMs;
  if (!isFiniteNumber(delayMs) || delayMs < 0) {
    throw new Error(
      `retry.delayMs は有限の 0 以上の数を指定してください（指定値: ${describeValue(delayMs)}）`,
    );
  }
  const factor = retry.factor ?? SERVICE_DEFAULTS.retryFactor;
  if (!isFiniteNumber(factor) || factor < 1) {
    throw new Error(
      `retry.factor は有限の 1 以上の数を指定してください（指定値: ${describeValue(factor)}）`,
    );
  }
  const maxDelayMs = retry.maxDelayMs ?? SERVICE_DEFAULTS.retryMaxDelayMs;
  if (!isFiniteNumber(maxDelayMs) || maxDelayMs < 0) {
    throw new Error(
      `retry.maxDelayMs は有限の 0 以上の数を指定してください（指定値: ${describeValue(maxDelayMs)}）`,
    );
  }

  return { attempts, delayMs, factor, maxDelayMs };
}

/** 既定値を補完して検証する。不正なら日本語メッセージの Error を投げる */
export function resolveServiceConfig(
  config: ServiceConfig,
): ResolvedServiceConfig {
  return {
    ready: resolveReady(config.ready),
    failOn: resolveFailOn(config.failOn),
    retry: resolveRetry(config.retry),
  };
}

/** n 回目（1 始まり）の再起動前の待機（ミリ秒）: min(delayMs × factor^(n-1), maxDelayMs) */
export function backoffDelay(
  retry: ResolvedRetry,
  retryNumber: number,
): number {
  const raw = retry.delayMs * retry.factor ** (retryNumber - 1);
  return Math.min(raw, retry.maxDelayMs);
}

/**
 * 出力行が pattern に一致するか判定する。string は部分一致、RegExp は test。
 * g / y フラグ付き RegExp を渡し元で使い回しても lastIndex に影響されないよう、
 * 判定のたびに新しい RegExp を作って呼び出し元のオブジェクトを変更しない。
 */
export function matchesPattern(
  pattern: string | RegExp,
  line: string,
): boolean {
  if (typeof pattern === "string") return line.includes(pattern);
  return new RegExp(pattern.source, pattern.flags).test(line);
}

/** メッセージ用の表示形式: string は JSON.stringify、RegExp は String(regexp) */
export function describePattern(pattern: string | RegExp): string {
  return typeof pattern === "string"
    ? JSON.stringify(pattern)
    : String(pattern);
}

/** compose の 1 ステージに含まれる、検証済みの 1 サービス */
export interface ComposeService {
  task: TaskDefinition;
  service: ServiceDefinition;
  config: ResolvedServiceConfig;
}

/**
 * compose のステージ列を検証して解決する。空ステージ列（stages.length === 0）は [] を返す（何も起動しない）。
 * ステージ内の要素が空 / サービスでない / 重複 / サービス設定が不正のいずれかならエラーを投げる。
 */
export function resolveComposeStages(
  stages: readonly (readonly TaskDefinition[])[],
): ComposeService[][] {
  const seen = new Set<string>();

  return stages.map((stage, stageIndex) => {
    if (stage.length === 0) {
      throw new Error(
        `空のグループは指定できません（${stageIndex + 1} 番目のステージ）`,
      );
    }

    return stage.map((task): ComposeService => {
      const service = task.options?.service;
      if (!service) {
        throw new Error(
          `'${task.name}' はサービスではありません（task.service() で宣言してください）`,
        );
      }
      if (seen.has(task.name)) {
        throw new Error(`サービス '${task.name}' が複数回指定されています`);
      }
      seen.add(task.name);

      try {
        return { task, service, config: resolveServiceConfig(service) };
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`サービス '${task.name}': ${detail}`);
      }
    });
  });
}
