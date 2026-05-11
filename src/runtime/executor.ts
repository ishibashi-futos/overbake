import { dirname } from "node:path";
import { discoverBakefile } from "../bakefile/discover.ts";
import { loadBakefile } from "../bakefile/loader.ts";
import { TaskRegistry } from "../bakefile/registry.ts";
import { resolveTasks } from "../graph/resolver.ts";
import type { TaskDefinition } from "../types.ts";
import { createTaskContext } from "./context.ts";

export { createTaskContext } from "./context.ts";

export interface ExecutionPlan {
  bakefile: string;
  root: string;
  tasks: TaskDefinition[];
}

export async function buildPlan(taskName: string): Promise<ExecutionPlan> {
  const bakefile = discoverBakefile();
  const root = dirname(bakefile);
  const registry = new TaskRegistry();
  await loadBakefile(bakefile, registry);
  const tasks = resolveTasks(taskName, registry.all());
  return { bakefile, root, tasks };
}

export async function executePlan(plan: ExecutionPlan): Promise<void> {
  const cwd = process.cwd();
  for (const task of plan.tasks) {
    const ctx = createTaskContext({ name: task.name, root: plan.root, cwd });
    console.log(`Running task: ${task.name}`);
    await task.fn(ctx);
  }
}

export function printDryRun(plan: ExecutionPlan): void {
  console.log("Execution plan:");
  for (const task of plan.tasks) {
    console.log(`  ${task.name}`);
  }
}

export function printExplain(plan: ExecutionPlan): void {
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
