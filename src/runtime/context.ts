import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { rm as nodeRm } from "node:fs/promises";
import { resolve as nodePath } from "node:path";
import type { CmdOptions, RmOptions, TaskContext } from "../types.ts";

export function createTaskContext(params: {
  name: string;
  root: string;
  cwd?: string;
}): TaskContext {
  const { name, root, cwd = root } = params;

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
          stdio: "inherit",
          shell: false,
        });

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
      console.log(...args);
    },
  };
}
