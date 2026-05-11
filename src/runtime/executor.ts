import { dirname } from "node:path";
import { discoverBakefile } from "../bakefile/discover.ts";
import { loadBakefile } from "../bakefile/loader.ts";
import { TaskRegistry } from "../bakefile/registry.ts";
import { resolveTasks } from "../graph/resolver.ts";
import type { TaskDefinition } from "../types.ts";
import {
  colorRed,
  formatTaskDone,
  formatTaskFailed,
  formatTaskStarted,
} from "../ui/format.ts";
import { Logger } from "../ui/logger.ts";
import { createTaskContext } from "./context.ts";
import { runWithHooks } from "./hooks.ts";

export { createTaskContext } from "./context.ts";

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
  const taskNames = Array.isArray(taskName) ? taskName : [taskName];
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

  for (const task of plan.tasks) {
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
      failures.push({
        taskName: task.name,
        error:
          taskError instanceof Error ? taskError : new Error(String(taskError)),
      });

      if (!options.keepGoing) {
        throw taskError;
      }
    } else {
      logger.info(formatTaskDone(task.name, durationMs, options.noColor));
    }
  }

  if (failures.length > 0) {
    logger.error("\nFailed tasks:");
    for (const { taskName } of failures) {
      logger.error(`  - ${taskName}`);
    }
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
