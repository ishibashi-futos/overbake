#!/usr/bin/env bun

import { init } from "../init/init.ts";
import {
  buildPlan,
  executePlan,
  printDryRun,
  printExplain,
} from "../runtime/executor.ts";
import { collectWatchPaths, startWatch } from "../watch/watcher.ts";
import { parseArgs } from "./args.ts";

export async function main(args: string[]): Promise<void> {
  try {
    const command = parseArgs(args);

    if (command.type === "init") {
      await init();
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
    process.exit(1);
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  await main(args);
}
