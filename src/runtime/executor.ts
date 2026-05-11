import { dirname } from "node:path";
import { createInterface } from "node:readline";
import { discoverBakefile } from "../bakefile/discover.ts";
import { loadBakefile } from "../bakefile/loader.ts";
import { TaskRegistry } from "../bakefile/registry.ts";
import { CliError } from "../cli/error.ts";
import { expandWildcardTargets, resolveTasks } from "../graph/resolver.ts";
import type { TaskDefinition } from "../types.ts";
import {
  colorRed,
  formatSummary,
  formatTaskDone,
  formatTaskFailed,
  formatTaskStarted,
  type TaskResult,
} from "../ui/format.ts";
import { Logger } from "../ui/logger.ts";
import { createTaskContext } from "./context.ts";
import { runWithHooks } from "./hooks.ts";

export { createTaskContext } from "./context.ts";

export type ConfirmFn = (prompt: string) => Promise<boolean>;

export function createDefaultConfirm(): ConfirmFn {
  return async (prompt: string): Promise<boolean> => {
    const isTTY = process.stdin.isTTY && process.stdout.isTTY;
    if (!isTTY) {
      throw new CliError(
        `${prompt}\nConfirm is not supported in non-TTY environment. Use --yes/-y flag.`,
        2,
      );
    }

    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      rl.question(`${prompt} [y/N] `, (answer) => {
        rl.close();
        resolve(answer.toLowerCase() === "y");
      });
    });
  };
}

export interface ExecutionPlan {
  bakefile: string;
  root: string;
  tasks: TaskDefinition[];
  targets: string[];
}

export interface ExecutionOptions {
  keepGoing?: boolean;
  quiet?: boolean;
  verbose?: boolean;
  noColor?: boolean;
  yes?: boolean;
  noSummary?: boolean;
  confirmFn?: ConfirmFn;
}

export async function buildPlan(taskName: string): Promise<ExecutionPlan>;
export async function buildPlan(taskNames: string[]): Promise<ExecutionPlan>;
export async function buildPlan(
  taskName: string | string[],
): Promise<ExecutionPlan> {
  const bakefile = discoverBakefile();
  const root = dirname(bakefile);
  const registry = new TaskRegistry();
  await loadBakefile(bakefile, registry);
  const rawTargets = Array.isArray(taskName) ? taskName : [taskName];
  const taskNames = expandWildcardTargets(rawTargets, registry.all());
  const tasks = resolveTasks(taskNames, registry.all());
  return { bakefile, root, tasks, targets: taskNames };
}

export async function executePlan(
  plan: ExecutionPlan,
  options: ExecutionOptions = {},
): Promise<void> {
  const cwd = process.cwd();
  const logger = Logger.create({
    quiet: options.quiet,
    verbose: options.verbose,
    noColor: options.noColor,
  });

  logger.verbose(`targets: ${plan.targets.join(", ")}`);
  logger.verbose(`root: ${plan.root}`);
  logger.verbose(`cwd: ${cwd}`);
  logger.verbose(`tasks: ${plan.tasks.map((t) => t.name).join(", ")}`);

  const failures: Array<{ taskName: string; error: Error }> = [];
  const results: TaskResult[] = [];
  const wallStart = performance.now();
  const confirmFn = options.confirmFn ?? createDefaultConfirm();

  for (const task of plan.tasks) {
    if (task.options?.confirm && !options.yes) {
      const confirmMessages = Array.isArray(task.options.confirm)
        ? task.options.confirm
        : [task.options.confirm];

      for (const message of confirmMessages) {
        const confirmed = await confirmFn(message);
        if (!confirmed) {
          throw new Error(`Task '${task.name}' cancelled by user.`);
        }
      }
    }

    const ctx = createTaskContext({
      name: task.name,
      root: plan.root,
      cwd,
      logger,
    });

    logger.info(formatTaskStarted(task.name, options.noColor));

    const startTime = Date.now();
    const suppressedOutput: string[] = [];
    const suppressedErrors: string[] = [];
    const originalLog = console.log;
    const originalError = console.error;

    if (options.quiet) {
      console.log = (...args: unknown[]) => {
        suppressedOutput.push(args.join(" "));
      };
      console.error = (...args: unknown[]) => {
        suppressedErrors.push(args.join(" "));
      };
    }

    let taskError: unknown;
    try {
      await runWithHooks(task, ctx);
    } catch (error) {
      taskError = error;
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }

    const durationMs = Date.now() - startTime;

    if (taskError) {
      logger.error(formatTaskFailed(task.name, options.noColor));
      if (taskError instanceof Error) {
        logger.error(colorRed(taskError.message, options.noColor));
      }
      results.push({ name: task.name, status: "failed", durationMs });
      failures.push({
        taskName: task.name,
        error:
          taskError instanceof Error ? taskError : new Error(String(taskError)),
      });

      if (!options.keepGoing) {
        if (!options.noSummary) {
          // 実測の wall time と各タスクの実行時間の最大値の大きい方を使用
          const wallMs = Math.max(
            performance.now() - wallStart,
            ...results.map((r) => r.durationMs),
          );
          console.log(
            formatSummary(results, wallMs, {
              quiet: options.quiet,
              noColor: options.noColor,
            }),
          );
        }
        throw taskError;
      }
    } else {
      results.push({
        name: task.name,
        status: task.isMeta ? "meta" : "ok",
        durationMs,
      });
      logger.info(formatTaskDone(task.name, durationMs, options.noColor));
    }
  }

  // 実測の wall time と各タスクの実行時間の最大値の大きい方を使用
  // （短いタスクでは performance.now() の精度でずれることがあるため）
  const wallMs = Math.max(
    performance.now() - wallStart,
    ...results.map((r) => r.durationMs),
  );

  if (!options.noSummary) {
    console.log(
      formatSummary(results, wallMs, {
        quiet: options.quiet,
        noColor: options.noColor,
      }),
    );
  }

  if (failures.length > 0) {
    const failureMessages = failures
      .map((f) => `${f.taskName}: ${f.error.message}`)
      .join("\n");
    throw new Error(
      `Execution failed with ${failures.length} task(s):\n${failureMessages}`,
    );
  }
}

export function printDryRun(plan: ExecutionPlan): void {
  console.log(`Targets: ${plan.targets.join(" ")}`);
  console.log("Execution plan:");
  for (const task of plan.tasks) {
    console.log(`  ${task.name}`);
  }
}

export function printExplain(plan: ExecutionPlan): void {
  console.log(`Targets: ${plan.targets.join(" ")}`);
  for (const task of plan.tasks) {
    console.log(`[${task.name}]`);
    if (task.options?.desc) console.log(`  desc:    ${task.options.desc}`);
    const deps = task.options?.deps ?? [];
    console.log(`  deps:    ${deps.length ? deps.join(", ") : "(none)"}`);
    const inputs = task.options?.inputs ?? [];
    console.log(`  inputs:  ${inputs.length ? inputs.join(", ") : "(none)"}`);
    const outputs = task.options?.outputs ?? [];
    console.log(`  outputs: ${outputs.length ? outputs.join(", ") : "(none)"}`);
    const env = task.options?.env ?? [];
    console.log(`  env:     ${env.length ? env.join(", ") : "(none)"}`);
  }
}

export async function runTask(taskName: string): Promise<void> {
  const plan = await buildPlan(taskName);
  await executePlan(plan);
}
