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
