import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { rm as nodeRm } from "node:fs/promises";
import { resolve as nodePath } from "node:path";
import type {
  CmdOptions,
  RmOptions,
  RunEachItem,
  RunEachOptions,
  TaskContext,
} from "../types.ts";
import { Logger } from "../ui/logger.ts";
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
}

export function createTaskContext(
  params: CreateTaskContextParams,
): TaskContext {
  const { name, root, cwd = root, logger, onOutput } = params;
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

        proc.on("exit", (code) => {
          if (code !== 0) {
            reject(new Error(`Command "${command}" exited with code ${code}`));
          } else {
            resolve();
          }
        });

        proc.on("error", (err) => {
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
  };
}
