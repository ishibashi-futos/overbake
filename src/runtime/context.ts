import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { rm as nodeRm } from "node:fs/promises";
import { resolve as nodePath } from "node:path";
import type {
  CmdOptions,
  ComposeItem,
  RmOptions,
  RunEachItem,
  RunEachOptions,
  TaskContext,
} from "../types.ts";
import { Logger } from "../ui/logger.ts";
import { runCompose as runComposeImpl } from "./compose.ts";
import { runEach as runEachImpl } from "./run-each.ts";

export interface CreateTaskContextParams {
  name: string;
  root: string;
  cwd?: string;
  logger?: Logger;
  /**
   * 指定すると cmd/log の出力をターミナルに直接流さず、このコールバックに渡す。
   * runEach が各工程の出力を抑制・キャプチャするために使用する。
   */
  onOutput?: (text: string) => void;
  /**
   * 指定すると cmd 内で起動された子プロセスにこの signal を結びつけ、
   * abort() で SIGTERM を送れるようにする。CmdOptions.signal が個別指定された場合はそちらが優先される。
   * task.compose の fail-fast / Ctrl+C 伝播で使用される。
   */
  abortSignal?: AbortSignal;
}

export function createTaskContext(
  params: CreateTaskContextParams,
): TaskContext {
  const { name, root, cwd = root, logger, onOutput, abortSignal } = params;
  const log =
    logger ?? new Logger({ quiet: false, verbose: false, noColor: false });

  return {
    name,
    root,
    cwd,
    async cmd(
      command: string,
      args: readonly string[] = [],
      options: CmdOptions = {},
    ) {
      const cmdCwd = options.cwd ?? root;
      const env = { ...process.env, ...options.env };
      const signal = options.signal ?? abortSignal;
      return new Promise((resolve, reject) => {
        const proc = spawn(command, Array.from(args), {
          cwd: cmdCwd,
          env,
          stdio: onOutput ? ["ignore", "pipe", "pipe"] : "inherit",
          shell: false,
        });

        if (onOutput) {
          proc.stdout?.on("data", (chunk) => onOutput(chunk.toString()));
          proc.stderr?.on("data", (chunk) => onOutput(chunk.toString()));
        }

        // signal が abort されたら SIGTERM で子プロセスを停止させる。
        // 既に abort 済みなら起動直後に kill する。リスナは exit/error で必ず外す。
        let onAbort: (() => void) | undefined;
        if (signal) {
          onAbort = () => {
            if (proc.exitCode === null) proc.kill("SIGTERM");
          };
          if (signal.aborted) {
            onAbort();
          } else {
            signal.addEventListener("abort", onAbort, { once: true });
          }
        }
        const detach = () => {
          if (signal && onAbort) signal.removeEventListener("abort", onAbort);
        };

        proc.on("exit", (code) => {
          detach();
          // signal 経由で停止された場合は user-initiated abort なので正常終了扱い。
          // task.compose の SIGINT/SIGTERM 伝播で送られる SIGTERM がここに該当する。
          if (signal?.aborted) {
            resolve();
            return;
          }
          if (code !== 0) {
            reject(new Error(`Command "${command}" exited with code ${code}`));
          } else {
            resolve();
          }
        });

        proc.on("error", (err) => {
          detach();
          reject(err);
        });
      });
    },
    async rm(path: string, options: RmOptions = {}) {
      await nodeRm(nodePath(root, path), options);
    },
    exists(path: string): boolean {
      return existsSync(nodePath(root, path));
    },
    resolve(...segments: string[]): string {
      return nodePath(root, ...segments);
    },
    log(...args: unknown[]): void {
      if (onOutput) {
        onOutput(`${args.join(" ")}\n`);
      } else {
        log.info(...args);
      }
    },
    async runEach(...items: (RunEachOptions | RunEachItem)[]): Promise<void> {
      await runEachImpl(
        { taskName: name, root, cwd, createContext: createTaskContext },
        items,
      );
    },
    async runCompose(items: ComposeItem[]): Promise<void> {
      await runComposeImpl({ taskName: name, root, cwd }, items);
    },
  };
}
