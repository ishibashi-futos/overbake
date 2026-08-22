/**
 * `console.log` / `console.error` の一時的な差し替えを一箇所に集約する。
 *
 * 各呼び出し側が「元の関数を保存して finally で戻す」方式だと、キャプチャが入れ子・並行に
 * なったときに *他人のキャプチャ関数* を「元の関数」として保存してしまい、全ての解除が
 * 終わっても console が死んだバッファに固定される。ここでは差し替えを 1 回だけ行い
 * （最初のキャプチャ開始時に退避、最後の解除時に復元）、その間はスタックで sink を切り替える。
 *
 * 並行キャプチャ中の出力は「最後に開始したキャプチャ」へ流れる。グローバルな console を
 * 使う以上、出力元のタスクを厳密に特定することはできない（`ctx.log` / `ctx.cmd` の出力は
 * TaskContext 経由なので正しく分離される）。
 */

export type ConsoleStream = "log" | "error";
export type ConsoleSink = (text: string, stream: ConsoleStream) => void;

const sinks: ConsoleSink[] = [];

/**
 * 差し替え直前の console。差し替えは最初のキャプチャ開始時の 1 回だけなので、
 * テストなどが外側で console を差し替えていてもその関数へ正しく戻せる。
 */
let outerLog: typeof console.log | undefined;
let outerError: typeof console.error | undefined;

function emit(stream: ConsoleStream, args: unknown[]): void {
  const sink = sinks[sinks.length - 1];
  if (sink) {
    sink(args.join(" "), stream);
    return;
  }
  // ここへ来るのはスタックが空のときだけ（= 差し替えが解除済み）
  if (stream === "log") outerLog?.(...args);
  else outerError?.(...args);
}

/**
 * console 出力を sink へ流し始める。返り値を呼ぶとこのキャプチャだけを解除する。
 * 二重解除は無害。
 */
export function captureConsole(sink: ConsoleSink): () => void {
  sinks.push(sink);
  if (sinks.length === 1) {
    outerLog = console.log;
    outerError = console.error;
    console.log = (...args: unknown[]) => emit("log", args);
    console.error = (...args: unknown[]) => emit("error", args);
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const index = sinks.lastIndexOf(sink);
    if (index !== -1) sinks.splice(index, 1);
    if (sinks.length === 0 && outerLog && outerError) {
      console.log = outerLog;
      console.error = outerError;
      outerLog = undefined;
      outerError = undefined;
    }
  };
}
