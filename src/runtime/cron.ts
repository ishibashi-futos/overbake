import { formatTime, nextRun, parseSchedule } from "../cron/schedule.ts";
import type { RunEachItem } from "../types.ts";
import { type RunEachDeps, runEach } from "./run-each.ts";

/** sleepUntil が 1 回の setTimeout で待つ最大時間。長い待機を分割して時刻ずれ・中断に追従する */
const SLEEP_CHUNK_MS = 60_000;

export interface RunCronDeps extends RunEachDeps {
  /** 停止シグナル。abort されるとスケジューラループを抜ける */
  abortSignal?: AbortSignal;
}

export interface RunCronOptions {
  /** テスト用: 現在時刻の取得（既定は new Date()） */
  now?: () => Date;
  /** テスト用: 指定時刻まで待機する（既定は setTimeout ベース） */
  sleepUntil?: (until: Date, signal?: AbortSignal) => Promise<void>;
  /** テスト用: 実行回数の上限。到達したらループを抜ける（既定は無制限） */
  maxRuns?: number;
}

/** 指定時刻まで待つ。長い待機は分割し、abort されたら即座に解決する */
export function sleepUntil(until: Date, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (): void => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    };

    const tick = (): void => {
      if (signal?.aborted) {
        finish();
        return;
      }
      const remaining = until.getTime() - Date.now();
      if (remaining <= 0) {
        finish();
        return;
      }
      timer = setTimeout(tick, Math.min(remaining, SLEEP_CHUNK_MS));
    };

    signal?.addEventListener("abort", finish, { once: true });
    tick();
  });
}

/**
 * スケジュールに従って工程列を繰り返し実行する。
 *
 * - 1 回分の実行は runEach と同じ（逐次実行・失敗工程の出力表示）。
 * - **工程が失敗してもスケジューラは止まらない**（cron の慣習）。失敗は報告して次回へ進む。
 * - 次回時刻は「実行完了後」に計算するため、実行が長引いた分の発火は自然にスキップされる（多重起動しない）。
 * - abortSignal が abort されるとループを抜ける（task.compose 配下での停止・Ctrl+C 伝播）。
 */
export async function runCron(
  deps: RunCronDeps,
  spec: string,
  items: readonly RunEachItem[],
  options: RunCronOptions = {},
): Promise<void> {
  const schedule = parseSchedule(spec);
  const now = options.now ?? ((): Date => new Date());
  const sleep = options.sleepUntil ?? sleepUntil;
  const write =
    deps.write ??
    ((text: string): void => {
      process.stdout.write(text);
    });
  const label = `[cron ${deps.taskName}]`;

  write(`${label} schedule: ${spec}\n`);

  let runs = 0;
  while (!deps.abortSignal?.aborted) {
    const next = nextRun(schedule, now());
    write(`${label} next run at ${formatTime(next)}\n`);

    await sleep(next, deps.abortSignal);
    if (deps.abortSignal?.aborted) break;

    runs += 1;
    try {
      await runEach({ ...deps, write }, [...items]);
    } catch (error) {
      // cron は 1 回の失敗で停止しない。失敗を報告して次の発火を待つ。
      const message = error instanceof Error ? error.message : String(error);
      write(`${label} run failed: ${message}\n`);
    }

    if (options.maxRuns !== undefined && runs >= options.maxRuns) break;
  }
}
