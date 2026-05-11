import {
  CircularDependencyError,
  TaskNotFoundError,
  WildcardNoMatchError,
} from "../shared/errors.ts";
import type { TaskDefinition } from "../types.ts";

/**
 * タスク名パターン（`*` を含む glob）を登録済みタスク名に展開する。
 * `*` は任意の文字列にマッチする。ワイルドカードを含まないパターンはそのまま返す。
 * 0 件マッチの場合は WildcardNoMatchError をスロー。
 */
export function expandWildcardTargets(
  patterns: string[],
  allTasks: TaskDefinition[],
): string[] {
  const expanded: string[] = [];
  for (const pattern of patterns) {
    if (!pattern.includes("*")) {
      expanded.push(pattern);
      continue;
    }
    const regexStr = pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*");
    const regex = new RegExp(`^${regexStr}$`);
    const matches = allTasks
      .filter((t) => regex.test(t.name))
      .map((t) => t.name);
    if (matches.length === 0) {
      throw new WildcardNoMatchError(pattern);
    }
    expanded.push(...matches);
  }
  return expanded;
}

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
