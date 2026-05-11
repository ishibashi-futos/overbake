const isNoColor =
  process.env.NO_COLOR !== undefined || process.env.NO_COLOR === "";
const isTTY = process.stdout.isTTY ?? false;

function useColor(noColor: boolean): boolean {
  return !noColor && !isNoColor && isTTY;
}

export function formatTaskStarted(
  taskName: string,
  noColor: boolean = false,
): string {
  const use = useColor(noColor);
  const prefix = use ? "\x1b[36m" : "";
  const reset = use ? "\x1b[0m" : "";
  return `${prefix}[${taskName}]${reset}  started`;
}

export function formatTaskDone(
  taskName: string,
  durationMs: number,
  noColor: boolean = false,
): string {
  const use = useColor(noColor);
  const checkmark = use ? "\x1b[32m✓\x1b[0m" : "✓";
  const prefix = use ? "\x1b[36m" : "";
  const reset = use ? "\x1b[0m" : "";
  return `${prefix}[${taskName}]${reset}  ${checkmark} done (${durationMs}ms)`;
}

export function formatTaskFailed(
  taskName: string,
  noColor: boolean = false,
): string {
  const use = useColor(noColor);
  const cross = use ? "\x1b[31m✗\x1b[0m" : "✗";
  const prefix = use ? "\x1b[36m" : "";
  const reset = use ? "\x1b[0m" : "";
  return `${prefix}[${taskName}]${reset}  ${cross} failed`;
}

export function formatTaskSkipped(
  taskName: string,
  reason: string,
  noColor: boolean = false,
): string {
  const use = useColor(noColor);
  const prefix = use ? "\x1b[36m" : "";
  const reason_text = use ? "\x1b[2m" : "";
  const reset = use ? "\x1b[0m" : "";
  return `${prefix}[${taskName}]${reset}  ${reason_text}${reason}${reset}`;
}

export function colorRed(text: string, noColor: boolean = false): string {
  const use = useColor(noColor);
  return use ? `\x1b[31m${text}\x1b[0m` : text;
}

// サマリーで使用するタスク結果の状態
export type TaskStatus = "ok" | "failed" | "skipped" | "cached" | "meta";

export interface TaskResult {
  name: string;
  status: TaskStatus;
  durationMs: number;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatSummary(
  results: TaskResult[],
  wallMs: number,
  opts: { quiet?: boolean; noColor?: boolean } = {},
): string {
  const use = useColor(opts.noColor ?? false);
  const lines: string[] = [];
  const failedTasks = results.filter((r) => r.status === "failed");

  if (!opts.quiet) {
    lines.push("");
    lines.push("Summary");

    const maxNameLen =
      results.length > 0 ? Math.max(...results.map((r) => r.name.length)) : 0;

    for (const r of results) {
      const name = r.name.padEnd(maxNameLen);
      let symbol: string;
      let detail: string;
      switch (r.status) {
        case "ok":
          symbol = use ? "\x1b[32m✓\x1b[0m" : "✓";
          detail = formatDuration(r.durationMs);
          break;
        case "failed":
          symbol = use ? "\x1b[31m✗\x1b[0m" : "✗";
          detail = formatDuration(r.durationMs);
          break;
        case "cached":
          symbol = use ? "\x1b[2m⏭\x1b[0m" : "⏭";
          detail = "cached";
          break;
        case "skipped":
          symbol = use ? "\x1b[2m⏭\x1b[0m" : "⏭";
          detail = "skipped";
          break;
        case "meta":
          symbol = use ? "\x1b[32m✓\x1b[0m" : "✓";
          detail = "(meta)";
          break;
      }
      lines.push(`  ${name}  ${symbol}  ${detail}`);
    }

    const sepLen = Math.max(maxNameLen + 12, 20);
    lines.push(`  ${"─".repeat(sepLen)}`);
  }

  // 要約行（--quiet でも常に表示）
  const total = results.length;
  const wallStr = formatDuration(wallMs);
  let summaryLine = `  ${total} task${total !== 1 ? "s" : ""}`;
  if (failedTasks.length > 0) {
    const failStr = `${failedTasks.length} failed`;
    summaryLine += ` · ${use ? `\x1b[31m${failStr}\x1b[0m` : failStr}`;
  }
  summaryLine += ` · total ${wallStr} (wall)`;
  lines.push(summaryLine);

  // 失敗タスク一覧（失敗がある場合のみ）
  if (failedTasks.length > 0) {
    lines.push("");
    const header = "Failed tasks:";
    lines.push(use ? `\x1b[31m${header}\x1b[0m` : header);
    for (const r of failedTasks) {
      lines.push(`  - ${r.name}`);
    }
  }

  return lines.join("\n");
}
