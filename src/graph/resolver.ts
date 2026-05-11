import {
  CircularDependencyError,
  TaskNotFoundError,
} from "../shared/errors.ts";
import type { TaskDefinition } from "../types.ts";

export function resolveTasks(
  targetName: string,
  allTasks: TaskDefinition[],
): TaskDefinition[];
export function resolveTasks(
  targetNames: string[],
  allTasks: TaskDefinition[],
): TaskDefinition[];
export function resolveTasks(
  targetName: string | string[],
  allTasks: TaskDefinition[],
): TaskDefinition[] {
  const taskMap = new Map(allTasks.map((t) => [t.name, t]));
  const targetNames = Array.isArray(targetName) ? targetName : [targetName];

  for (const name of targetNames) {
    if (!taskMap.has(name)) {
      throw new TaskNotFoundError(name);
    }
  }

  const visited = new Set<string>();
  const result: TaskDefinition[] = [];

  function visit(name: string, stack: string[] = []): void {
    if (visited.has(name)) {
      return;
    }

    if (stack.includes(name)) {
      throw new CircularDependencyError([...stack, name]);
    }

    const task = taskMap.get(name);
    if (!task) {
      throw new TaskNotFoundError(name);
    }

    const newStack = [...stack, name];
    const deps = task.options?.deps || [];
    for (const dep of deps) {
      visit(dep, newStack);
    }

    visited.add(name);
    result.push(task);
  }

  // Resolve in order, but shared dependencies are visited only once
  for (const targetName of targetNames) {
    visit(targetName);
  }

  return result;
}
