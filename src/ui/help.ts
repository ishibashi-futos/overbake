import type { TaskDefinition } from "../types.ts";

export function renderTaskList(tasks: TaskDefinition[]): string {
  if (tasks.length === 0) {
    return "No tasks found.";
  }

  const lines = ["Available tasks:"];
  const maxNameLength = Math.max(...tasks.map((t) => t.name.length));

  // `:` を含まないタスクとグループ別タスクに分類
  const ungrouped: TaskDefinition[] = [];
  const groups = new Map<string, TaskDefinition[]>();

  for (const task of tasks) {
    const colonIdx = task.name.indexOf(":");
    if (colonIdx === -1) {
      ungrouped.push(task);
    } else {
      const prefix = task.name.slice(0, colonIdx);
      if (!groups.has(prefix)) {
        groups.set(prefix, []);
      }
      groups.get(prefix)?.push(task);
    }
  }

  // `:` なしのタスクをフラット表示
  for (const task of ungrouped) {
    const paddedName = task.name.padEnd(maxNameLength);
    const desc = task.options?.desc ? ` - ${task.options.desc}` : "";
    const platforms = task.options?.platforms;
    const platformsStr =
      platforms && platforms.length > 0
        ? ` (${platforms.join(", ")} only)`
        : "";
    lines.push(`  ${paddedName}${desc}${platformsStr}`);
  }

  // `:` プレフィックスでグループ表示
  for (const [prefix, groupTasks] of groups) {
    lines.push(`${prefix}:`);
    for (const task of groupTasks) {
      const paddedName = task.name.padEnd(maxNameLength);
      const desc = task.options?.desc ? ` - ${task.options.desc}` : "";
      const platforms = task.options?.platforms;
      const platformsStr =
        platforms && platforms.length > 0
          ? ` (${platforms.join(", ")} only)`
          : "";
      lines.push(`  ${paddedName}${desc}${platformsStr}`);
    }
  }

  return lines.join("\n");
}

export function renderGlobalHelp(): string {
  return `Usage: bake [command] [options]

Commands:
  init                   Initialize a new Bakefile
  init --type            Update only Bakefile.d.ts
  -l, list               List available tasks
  doctor                 Validate Bakefile.ts without running tasks
  --help                 Show this help message
  --help <task>          Show help for a specific task
  completions <shell>    Output shell completion script (zsh/bash/fish)

Options (for run):
  --dry-run              Print tasks without executing
  --explain              Show task details and dependencies
  --watch                Watch input files and re-run on changes
  --graph[=mermaid|dot]  Print dependency graph without executing
  --no-summary           Skip the execution summary output
`;
}

export function renderTaskHelp(task: TaskDefinition): string {
  const lines = [`Task: ${task.name}`];

  if (task.options?.desc) {
    lines.push(`Description: ${task.options.desc}`);
  }

  const deps = task.options?.deps ?? [];
  lines.push(`Dependencies: ${deps.length > 0 ? deps.join(", ") : "(none)"}`);

  const inputs = task.options?.inputs ?? [];
  lines.push(`Inputs: ${inputs.length > 0 ? inputs.join(", ") : "(none)"}`);

  const outputs = task.options?.outputs ?? [];
  lines.push(`Outputs: ${outputs.length > 0 ? outputs.join(", ") : "(none)"}`);

  const env = task.options?.env ?? [];
  lines.push(`Environment: ${env.length > 0 ? env.join(", ") : "(none)"}`);

  const platforms = task.options?.platforms ?? [];
  lines.push(
    `Platforms: ${platforms.length > 0 ? platforms.join(", ") : "(all)"}`,
  );

  return lines.join("\n");
}

export function renderTaskNotFound(
  taskName: string,
  availableTasks: TaskDefinition[],
): string {
  const lines = [`Task not found: ${taskName}`];

  const prefix = taskName.split("-")[0] || "";
  const matches = availableTasks.filter(
    (t) =>
      t.name.includes(taskName) ||
      taskName.includes(t.name) ||
      t.name.startsWith(prefix),
  );

  if (matches.length > 0) {
    lines.push("\nDid you mean one of these?");
    for (const task of matches) {
      lines.push(`  ${task.name}`);
    }
  } else {
    lines.push("\nUse 'bake --help' to see available commands.");
  }

  return lines.join("\n");
}
