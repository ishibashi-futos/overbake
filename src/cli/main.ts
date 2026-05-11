#!/usr/bin/env bun

import { init } from "../init/init.ts";
import { runTask } from "../runtime/executor.ts";
import { parseArgs } from "./args.ts";

export async function main(args: string[]): Promise<void> {
  try {
    const command = parseArgs(args);

    if (command.type === "init") {
      await init();
    } else {
      await runTask(command.taskName);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  await main(args);
}
