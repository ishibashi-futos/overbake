#!/usr/bin/env bun

import { dirname } from "node:path";
import { discoverBakefile } from "../bakefile/discover.ts";
import { loadBakefile } from "../bakefile/loader.ts";
import { TaskRegistry } from "../bakefile/registry.ts";
import { resolveTasks } from "../graph/resolver.ts";
import { init } from "../init/init.ts";
import {
  buildPlan,
  type ExecutionPlan,
  executePlan,
  printDryRun,
  printExplain,
} from "../runtime/executor.ts";
import {
  DuplicateDefaultTaskError,
  WildcardNoMatchError,
} from "../shared/errors.ts";
import { renderGraph } from "../ui/graph.ts";
import {
  renderGlobalHelp,
  renderTaskHelp,
  renderTaskList,
  renderTaskNotFound,
} from "../ui/help.ts";
import { collectWatchPaths, startWatch } from "../watch/watcher.ts";
import { parseArgs } from "./args.ts";
import {
  generateBashCompletion,
  generateFishCompletion,
  generateZshCompletion,
} from "./completions.ts";
import { runDoctor } from "./doctor.ts";
import { CliError } from "./error.ts";
import { runGlaze } from "./glaze.ts";

function validateGraphFormat(format: string): void {
  if (format !== "mermaid" && format !== "dot") {
    throw new CliError(
      `未対応のグラフ形式です: "${format}"。mermaid または dot を指定してください。`,
      2,
    );
  }
}

export async function main(args: string[]): Promise<void> {
  try {
    const command = parseArgs(args);

    if (command.type === "completions") {
      if (command.shell === "zsh") {
        console.log(generateZshCompletion());
      } else if (command.shell === "bash") {
        console.log(generateBashCompletion());
      } else if (command.shell === "fish") {
        console.log(generateFishCompletion());
      } else {
        throw new CliError(
          `未対応のシェルです: "${command.shell}"。zsh / bash / fish を指定してください。`,
          2,
        );
      }
      return;
    }

    if (command.type === "complete") {
      if (command.subcommand === "tasks") {
        try {
          const bakefile = discoverBakefile();
          const registry = new TaskRegistry();
          await loadBakefile(bakefile, registry);
          for (const task of registry.all()) {
            console.log(task.name);
          }
        } catch {
          // Bakefile.ts が無いか読み込み失敗の場合は何も出力しない
        }
      }
      return;
    }

    if (command.type === "doctor") {
      const exitCode = await runDoctor();
      if (exitCode !== 0) {
        process.exit(exitCode);
      }
      return;
    }

    if (command.type === "glaze") {
      const exitCode = await runGlaze(command.filePath, command.check);
      if (exitCode !== 0) {
        process.exit(exitCode);
      }
      return;
    }

    if (command.type === "init") {
      await init(command.typesOnly);
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

    if (command.type === "default") {
      if (command.flags.graph !== undefined) {
        validateGraphFormat(command.flags.graph);
        const bakefile = discoverBakefile();
        const registry = new TaskRegistry();
        await loadBakefile(bakefile, registry);
        console.log(
          renderGraph(registry.all(), command.flags.graph as "mermaid" | "dot"),
        );
        return;
      }

      const bakefile = discoverBakefile();
      const root = dirname(bakefile);
      const registry = new TaskRegistry();
      await loadBakefile(bakefile, registry);
      const defaultTaskName = registry.getDefault();

      if (!defaultTaskName) {
        const tasks = registry.all();
        console.log(renderTaskList(tasks));
        return;
      }

      // 動的インポートキャッシュ問題を避けるため、既にロードされたレジストリを使用してプランを構築
      const tasks = resolveTasks(defaultTaskName, registry.all());
      const plan: ExecutionPlan = {
        bakefile,
        root,
        tasks,
        targets: [defaultTaskName],
      };

      if (command.flags.dryRun) {
        printDryRun(plan);
        return;
      }

      if (command.flags.explain) {
        printExplain(plan);
        return;
      }

      if (command.flags.watch) {
        await executePlan(plan, {
          keepGoing: command.flags.keepGoing,
          quiet: command.flags.quiet,
          verbose: command.flags.verbose,
          noColor: command.flags.noColor,
          yes: command.flags.yes,
          noSummary: command.flags.noSummary,
        });
        const paths = collectWatchPaths(plan.tasks, plan.bakefile);
        console.log(`Watching: ${paths.join(", ")}`);
        startWatch(paths, async () => {
          await executePlan(plan, {
            keepGoing: command.flags.keepGoing,
            quiet: command.flags.quiet,
            verbose: command.flags.verbose,
            noColor: command.flags.noColor,
            yes: command.flags.yes,
            noSummary: command.flags.noSummary,
          });
        });
        await new Promise<void>(() => {});
        return;
      }

      await executePlan(plan, {
        keepGoing: command.flags.keepGoing,
        quiet: command.flags.quiet,
        verbose: command.flags.verbose,
        noColor: command.flags.noColor,
        yes: command.flags.yes,
        noSummary: command.flags.noSummary,
      });
      return;
    }

    const { taskNames, flags } = command;

    if (flags.graph !== undefined) {
      validateGraphFormat(flags.graph);
      const plan = await buildPlan(taskNames);
      console.log(renderGraph(plan.tasks, flags.graph as "mermaid" | "dot"));
      return;
    }

    const plan = await buildPlan(taskNames);

    if (flags.dryRun) {
      printDryRun(plan);
      return;
    }

    if (flags.explain) {
      printExplain(plan);
      return;
    }

    if (flags.watch) {
      await executePlan(plan, {
        keepGoing: flags.keepGoing,
        quiet: flags.quiet,
        verbose: flags.verbose,
        noColor: flags.noColor,
        yes: flags.yes,
        noSummary: flags.noSummary,
      });
      const paths = collectWatchPaths(plan.tasks, plan.bakefile);
      console.log(`Watching: ${paths.join(", ")}`);
      startWatch(paths, async () => {
        // 初回に build した plan を再利用して同じタスク列を再実行
        await executePlan(plan, {
          keepGoing: flags.keepGoing,
          quiet: flags.quiet,
          verbose: flags.verbose,
          noColor: flags.noColor,
          yes: flags.yes,
          noSummary: flags.noSummary,
        });
      });
      // Ctrl+C まで待機
      await new Promise<void>(() => {});
      return;
    }

    await executePlan(plan, {
      keepGoing: flags.keepGoing,
      quiet: flags.quiet,
      verbose: flags.verbose,
      noColor: flags.noColor,
      yes: flags.yes,
      noSummary: flags.noSummary,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    let exitCode = 1;
    if (error instanceof CliError) {
      exitCode = error.exitCode;
    } else if (
      error instanceof DuplicateDefaultTaskError ||
      error instanceof WildcardNoMatchError
    ) {
      exitCode = 2;
    }
    process.exit(exitCode);
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  await main(args);
}
