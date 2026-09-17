import type { RunEachCommand, Task } from "../types.ts";

/**
 * runEach / task.each / task.compose / task.service の引数が
 * コマンドタプル `[command, args?]` か判定する型ガード。
 * オプションオブジェクト・タスクハンドル・コマンドタプル・
 * compose のグループ配列が混在しうる入力に対して働く。
 */
export function isCommand(x: unknown): x is RunEachCommand {
  return Array.isArray(x);
}

/** runEach / task.each / task.compose / task.service の引数が タスクハンドルか判定する */
export function isTask(x: unknown): x is Task {
  return !Array.isArray(x) && typeof (x as Task)?.fn === "function";
}

/** コマンドタプルを表示用ラベル（`command args...`）に整形する */
export function commandLabel(cmd: RunEachCommand): string {
  const [command, args] = cmd;
  return args && args.length > 0 ? `${command} ${args.join(" ")}` : command;
}
