import type {
  RunEachCommand,
  RunEachItem,
  RunEachOptions,
  Task,
} from "../types.ts";

/** runEach / task.each の引数が コマンドタプル `[command, args?]` か判定する */
export function isCommand(
  x: RunEachOptions | RunEachItem,
): x is RunEachCommand {
  return Array.isArray(x);
}

/** runEach / task.each の引数が タスクハンドルか判定する */
export function isTask(x: RunEachOptions | RunEachItem): x is Task {
  return !Array.isArray(x) && typeof (x as Task).fn === "function";
}

/** コマンドタプルを表示用ラベル（`command args...`）に整形する */
export function commandLabel(cmd: RunEachCommand): string {
  const [command, args] = cmd;
  return args && args.length > 0 ? `${command} ${args.join(" ")}` : command;
}
