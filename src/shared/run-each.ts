import type {
  ComposeItem,
  RunEachCommand,
  RunEachItem,
  RunEachOptions,
  Task,
  TaskComposeOptions,
  TaskEachOptions,
} from "../types.ts";

/**
 * runEach / task.each / task.compose の引数が コマンドタプル `[command, args?]` か判定する。
 * オプションオブジェクト・タスクハンドル・コマンドタプルが混在しうる入力に対し型ガードとして働く。
 */
export function isCommand(
  x:
    | RunEachOptions
    | TaskEachOptions
    | TaskComposeOptions
    | RunEachItem
    | ComposeItem,
): x is RunEachCommand {
  return Array.isArray(x);
}

/** runEach / task.each / task.compose の引数が タスクハンドルか判定する */
export function isTask(
  x:
    | RunEachOptions
    | TaskEachOptions
    | TaskComposeOptions
    | RunEachItem
    | ComposeItem,
): x is Task {
  return !Array.isArray(x) && typeof (x as Task).fn === "function";
}

/** コマンドタプルを表示用ラベル（`command args...`）に整形する */
export function commandLabel(cmd: RunEachCommand): string {
  const [command, args] = cmd;
  return args && args.length > 0 ? `${command} ${args.join(" ")}` : command;
}
