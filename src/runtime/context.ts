import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { rm as nodeRm } from "node:fs/promises";
import { resolve as nodePath } from "node:path";
import type {
  CmdOptions,
  RmOptions,
  RunEachItem,
  RunEachOptions,
  Task,
  TaskContext,
} from "../types.ts";
import { Logger } from "../ui/logger.ts";
import { runCompose as runComposeImpl } from "./compose.ts";
import { runCron as runCronImpl } from "./cron.ts";
import { runEach as runEachImpl } from "./run-each.ts";

/** ctx.cmd の停止で SIGTERM を送った後、SIGKILL するまでの既定の猶予（ミリ秒） */
export const KILL_GRACE_MS = 5000;

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
   * task.compose / task.service の fail-fast / Ctrl+C 伝播で使用される。
   */
  abortSignal?: AbortSignal;
  /** abort による SIGTERM 後、子プロセスが終了しなければ SIGKILL するまでの猶予（ミリ秒）。既定 KILL_GRACE_MS */
  killGraceMs?: number;
}

export function createTaskContext(
  params: CreateTaskContextParams,
): TaskContext {
  const {
    name,
    root,
    cwd = root,
    logger,
    onOutput,
    abortSignal,
    killGraceMs = KILL_GRACE_MS,
  } = params;
  const log =
    logger ?? new Logger({ quiet: false, verbose: false, noColor: false });
  const signal = abortSignal ?? new AbortController().signal;

  return {
    name,
    root,
    cwd,
    signal,
    async cmd(
      command: string,
      args: readonly string[] = [],
      options: CmdOptions = {},
    ) {
      const cmdCwd = options.cwd ?? root;
      const env = { ...process.env, ...options.env };
      const cmdSignal = options.signal ?? abortSignal;
      return new Promise((resolve, reject) => {
        const proc = spawn(command, Array.from(args), {
          cwd: cmdCwd,
          env,
          stdio: onOutput ? ["ignore", "pipe", "pipe"] : "inherit",
          shell: false,
        });

        let exited = false;
        let killTimer: ReturnType<typeof setTimeout> | undefined;
        const clearKillTimer = (): void => {
          if (killTimer) {
            clearTimeout(killTimer);
            killTimer = undefined;
          }
        };

        if (onOutput) {
          proc.stdout?.on("data", (chunk) => onOutput(chunk.toString()));
          proc.stderr?.on("data", (chunk) => onOutput(chunk.toString()));
        }

        // signal が abort されたら SIGTERM で子プロセスを停止させ、killGraceMs 経過後も
        // まだ終了していなければ SIGKILL する。既に abort 済みなら起動直後に kill する。
        // リスナ・タイマーは exit/error で必ず外す（タイマーは unref してプロセスの生存を妨げない）。
        let onAbort: (() => void) | undefined;
        if (cmdSignal) {
          onAbort = () => {
            if (exited) return;
            proc.kill("SIGTERM");
            killTimer = setTimeout(() => {
              if (!exited) proc.kill("SIGKILL");
            }, killGraceMs);
            killTimer.unref?.();
          };
          if (cmdSignal.aborted) {
            onAbort();
          } else {
            cmdSignal.addEventListener("abort", onAbort, { once: true });
          }
        }
        const detach = () => {
          if (cmdSignal && onAbort) {
            cmdSignal.removeEventListener("abort", onAbort);
          }
        };

        proc.on("exit", (code, sig) => {
          exited = true;
          clearKillTimer();
          detach();
          // signal 経由で停止された場合は user-initiated abort なので正常終了扱い。
          // task.compose / task.service の SIGINT/SIGTERM 伝播で送られる SIGTERM がここに該当する。
          if (cmdSignal?.aborted) {
            resolve();
            return;
          }
          if (code === null && sig) {
            reject(new Error(`Command "${command}" was terminated by ${sig}`));
            return;
          }
          if (code !== 0) {
            reject(new Error(`Command "${command}" exited with code ${code}`));
          } else {
            resolve();
          }
        });

        proc.on("error", (err) => {
          exited = true;
          clearKillTimer();
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
        {
          taskName: name,
          root,
          cwd,
          createContext: createTaskContext,
          write: onOutput,
          abortSignal,
        },
        items,
      );
    },
    async runCompose(stages: readonly (readonly Task[])[]): Promise<void> {
      await runComposeImpl({ taskName: name, root, cwd, abortSignal }, stages);
    },
    async runCron(schedule: string, items: RunEachItem[]): Promise<void> {
      await runCronImpl(
        {
          taskName: name,
          root,
          cwd,
          createContext: createTaskContext,
          write: onOutput,
          abortSignal,
        },
        schedule,
        items,
      );
    },
  };
}
