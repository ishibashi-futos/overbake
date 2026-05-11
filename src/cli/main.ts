#!/usr/bin/env bun

import { discoverBakefile } from "../bakefile/discover.ts";
import { loadBakefile } from "../bakefile/loader.ts";
import { TaskRegistry } from "../bakefile/registry.ts";
import { init } from "../init/init.ts";
import {
  buildPlan,
  executePlan,
  printDryRun,
  printExplain,
} from "../runtime/executor.ts";
import {
  renderGlobalHelp,
  renderTaskHelp,
  renderTaskList,
  renderTaskNotFound,
} from "../ui/help.ts";
import { collectWatchPaths, startWatch } from "../watch/watcher.ts";
import { parseArgs } from "./args.ts";
import { CliError } from "./error.ts";

export async function main(args: string[]): Promise<void> {
  try {
    const command = parseArgs(args);

    if (command.type === "init") {
      await init();
      return;
    }

    if (command.type === "list") {
      const bakefile = discoverBakefile();
      const registry = new TaskRegistry();
      await loadBakefile(bakefile, registry);
      const tasks = registry.all();
      console.log(renderTaskList(tasks));
      return;
    }

    if (command.type === "help") {
      if (!command.taskName) {
        console.log(renderGlobalHelp());
        return;
      }

      const bakefile = discoverBakefile();
      const registry = new TaskRegistry();
      await loadBakefile(bakefile, registry);
      const tasks = registry.all();
      const task = tasks.find((t) => t.name === command.taskName);

      if (!task) {
        throw new CliError(renderTaskNotFound(command.taskName, tasks), 2);
      }

      console.log(renderTaskHelp(task));
      return;
    }

    const { taskName, flags } = command;
    const plan = await buildPlan(taskName);

    if (flags.dryRun) {
      printDryRun(plan);
      return;
    }

    if (flags.explain) {
      printExplain(plan);
      return;
    }

    if (flags.watch) {
      await executePlan(plan);
      const paths = collectWatchPaths(plan.tasks, plan.bakefile);
      console.log(`Watching: ${paths.join(", ")}`);
      startWatch(paths, async () => {
        // 初回に build した plan を再利用して同じタスク列を再実行
        await executePlan(plan);
      });
      // Ctrl+C まで待機
      await new Promise<void>(() => {});
      return;
    }

    await executePlan(plan);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    const exitCode = error instanceof CliError ? error.exitCode : 1;
    process.exit(exitCode);
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  await main(args);
}
