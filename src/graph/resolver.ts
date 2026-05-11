import {
  CircularDependencyError,
  TaskNotFoundError,
} from "../shared/errors.ts";
import type { TaskDefinition } from "../types.ts";

export function resolveTasks(
  targetName: string,
  allTasks: TaskDefinition[],
): TaskDefinition[] {
  const taskMap = new Map(allTasks.map((t) => [t.name, t]));

  if (!taskMap.has(targetName)) {
    throw new TaskNotFoundError(targetName);
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

  visit(targetName);
  return result;
}
