#!/usr/bin/env bun

import { dirname } from "node:path";
import { discoverBakefile } from "../bakefile/discover.ts";
import { loadBakefile } from "../bakefile/loader.ts";
import { TaskRegistry } from "../bakefile/registry.ts";
import {
  type DaemonRecord,
  followLog,
  readLogTail,
  renderDaemonList,
  type StopResult,
  stopAllDaemons,
  stopDaemon,
} from "../daemon/control.ts";
import {
  DAEMON_LOG_ENV,
  resolveRotationConfig,
  startLogRotation,
} from "../daemon/rotate.ts";
import { buildDaemonCommand, startDaemon } from "../daemon/spawn.ts";
import {
  claimRecord,
  isAlive,
  readRecord,
  removeRecord,
} from "../daemon/state.ts";
import { resolveTasks } from "../graph/resolver.ts";
import { init } from "../init/init.ts";
import {
  buildPlan,
  confirmPlan,
  type ExecutionPlan,
  executePlan,
  printDryRun,
  printExplain,
} from "../runtime/executor.ts";
import {
  BakefileNotFoundError,
  CircularDependencyError,
  DuplicateDefaultTaskError,
  TaskNotFoundError,
  WildcardNoMatchError,
} from "../shared/errors.ts";
import { renderGraph } from "../ui/graph.ts";
import {
  renderGlobalHelp,
  renderTaskHelp,
  renderTaskList,
  renderTaskNotFound,
} from "../ui/help.ts";
import { runUpdate } from "../update/update.ts";
import { BAKE_VERSION } from "../version.ts";
import { collectWatchPaths, startWatch } from "../watch/watcher.ts";
import { type Flags, parseArgs } from "./args.ts";
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

/** Bakefile を探して読み込み、ルートディレクトリと Registry を返す */
async function loadRegistry(): Promise<{
  bakefile: string;
  root: string;
  registry: TaskRegistry;
}> {
  const bakefile = discoverBakefile();
  const registry = new TaskRegistry();
  await loadBakefile(bakefile, registry);
  return { bakefile, root: dirname(bakefile), registry };
}

/** Bakefile を読み込まずにルートディレクトリだけ得る（デーモン管理コマンド用） */
function findRoot(): string {
  return dirname(discoverBakefile());
}

/**
 * タスクをバックグラウンドのデーモンとして起動する。
 *
 * 実行計画の構築（未定義タスク・循環の検出）と `confirm:` の確認は **detach する前の親プロセス**で行う。
 * こうすることで設定エラーは前景で exit 2 になり、確認プロンプトは TTY のある側で応答できる。
 * 子プロセスには `--yes` を足して渡し、ログファイル越しの再確認で止まらないようにする。
 */
async function startTaskDaemon(
  plan: ExecutionPlan,
  args: string[],
  flags: Flags,
): Promise<void> {
  if (plan.targets.length !== 1) {
    throw new CliError(
      "-d / --daemon は 1 つのタスクにだけ指定できます。複数を常駐させる場合は task.compose を使ってください。",
      2,
    );
  }

  const name = plan.targets[0] as string;
  const existing = readRecord(plan.root, name);
  if (existing) {
    if (isAlive(existing.pid)) {
      throw new CliError(
        `デーモン '${name}' は既に起動しています (pid ${existing.pid})。'bake stop ${name}' で停止できます。`,
        2,
      );
    }
    // 停止済みのレコードが残っているだけなので掃除して起動を続ける
    removeRecord(plan.root, name);
  }

  await confirmPlan(plan, { yes: flags.yes });

  // spawn までの隙間で別の `bake -d` に追い越されないよう、状態ファイルを排他作成して権利を取る
  if (!claimRecord(plan.root, name, process.pid, new Date())) {
    throw new CliError(
      `デーモン '${name}' は既に起動処理中です。'bake ps' で状態を確認してください。`,
      2,
    );
  }

  const command = buildDaemonCommand({
    execPath: process.execPath,
    entry: process.argv[1],
    args,
    appendArgs: ["--yes"],
  });

  let record: DaemonRecord;
  try {
    record = startDaemon({
      root: plan.root,
      name,
      command,
      cwd: process.cwd(),
    });
  } catch (error) {
    // 起動に失敗したら仮レコードを残さない
    removeRecord(plan.root, name);
    throw error;
  }

  console.log(`Started daemon '${name}' (pid ${record.pid})`);
  console.log(`  log:  ${record.logFile}`);
  console.log(`  stop: bake stop ${name}`);
}

/** 実行計画を実行し、--watch 指定時は監視を続ける */
async function executePlanWithFlags(
  plan: ExecutionPlan,
  flags: Flags,
): Promise<void> {
  const options = {
    keepGoing: flags.keepGoing,
    quiet: flags.quiet,
    verbose: flags.verbose,
    noColor: flags.noColor,
    yes: flags.yes,
    noSummary: flags.noSummary,
  };

  await executePlan(plan, options);

  if (!flags.watch) return;

  const paths = collectWatchPaths(plan.tasks, plan.bakefile);
  console.log(`Watching: ${paths.join(", ")}`);
  // 初回に build した plan を再利用して同じタスク列を再実行
  startWatch(paths, async () => {
    await executePlan(plan, options);
  });
  // Ctrl+C まで待機
  await new Promise<void>(() => {});
}

/**
 * 実行計画に対する出力系フラグ（--dry-run / --explain）とデーモン起動を振り分ける。
 * --dry-run / --explain は副作用を持たないため -d より優先する。
 */
async function runPlan(
  plan: ExecutionPlan,
  args: string[],
  flags: Flags,
): Promise<void> {
  if (flags.dryRun) {
    printDryRun(plan);
    return;
  }

  if (flags.explain) {
    printExplain(plan);
    return;
  }

  if (flags.daemon) {
    await startTaskDaemon(plan, args, flags);
    return;
  }

  await executePlanWithFlags(plan, flags);
}

function reportStop(result: StopResult): void {
  switch (result.status) {
    case "stopped":
      console.log(`Stopped daemon '${result.name}' (pid ${result.pid})`);
      break;
    case "killed":
      console.log(
        `Killed daemon '${result.name}' (pid ${result.pid}) — SIGTERM に応答しませんでした`,
      );
      break;
    case "not-running":
      console.log(
        `デーモン '${result.name}' は既に停止していました（状態ファイルを削除しました）`,
      );
      break;
    case "not-found":
      console.log(`デーモン '${result.name}' は起動していません`);
      break;
  }
}

export async function main(args: string[]): Promise<void> {
  try {
    // デーモンとして起動された子プロセス自身がログサイズを見張る。
    // stdout/stderr の fd を握っているのはこのプロセス（と孫プロセス）なので、
    // 切り詰めはここで行うのが唯一安全なタイミングになる。
    const daemonLog = process.env[DAEMON_LOG_ENV];
    if (daemonLog) {
      startLogRotation(daemonLog, resolveRotationConfig());
      // ctx.cmd は process.env をそのまま子へ渡すため、残したままだとタスクから起動した
      // bake が同じログに対して 2 つ目の監視タイマーを張り、退避処理が競合する。
      delete process.env[DAEMON_LOG_ENV];
    }

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
          const { registry } = await loadRegistry();
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

    if (command.type === "version") {
      console.log(BAKE_VERSION);
      return;
    }

    if (command.type === "update") {
      const exitCode = await runUpdate({
        check: command.check,
        force: command.force,
      });
      if (exitCode !== 0) {
        process.exit(exitCode);
      }
      return;
    }

    if (command.type === "init") {
      await init(command.typesOnly);
      return;
    }

    if (command.type === "ps") {
      console.log(renderDaemonList(findRoot()));
      return;
    }

    if (command.type === "stop") {
      const root = findRoot();
      if (command.all) {
        const results = await stopAllDaemons(root);
        if (results.length === 0) {
          console.log("No running daemons.");
          return;
        }
        for (const result of results) reportStop(result);
        return;
      }
      if (!command.taskName) {
        throw new CliError(
          "停止するタスク名か --all を指定してください（例: bake stop dev）",
          2,
        );
      }
      reportStop(await stopDaemon(root, command.taskName));
      return;
    }

    if (command.type === "logs") {
      const root = findRoot();
      if (!command.taskName) {
        throw new CliError(
          "ログを表示するタスク名を指定してください（例: bake logs dev）",
          2,
        );
      }
      const tail = readLogTail(root, command.taskName, command.lines);
      if (tail === null) {
        throw new CliError(
          `デーモン '${command.taskName}' のログがありません。'bake -d ${command.taskName}' で起動してください。`,
          2,
        );
      }
      if (tail !== "") console.log(tail);
      if (command.follow) {
        followLog(root, command.taskName, (text) => process.stdout.write(text));
        // Ctrl+C まで待機
        await new Promise<void>(() => {});
      }
      return;
    }

    if (command.type === "list") {
      const { registry } = await loadRegistry();
      console.log(renderTaskList(registry.all()));
      return;
    }

    if (command.type === "help") {
      if (!command.taskName) {
        console.log(renderGlobalHelp());
        return;
      }

      const { registry } = await loadRegistry();
      const tasks = registry.all();
      const task = tasks.find((t) => t.name === command.taskName);

      if (!task) {
        throw new CliError(renderTaskNotFound(command.taskName, tasks), 2);
      }

      console.log(renderTaskHelp(task));
      return;
    }

    if (command.type === "default") {
      const { bakefile, root, registry } = await loadRegistry();

      if (command.flags.graph !== undefined) {
        validateGraphFormat(command.flags.graph);
        console.log(
          renderGraph(registry.all(), command.flags.graph as "mermaid" | "dot"),
        );
        return;
      }

      const defaultTaskName = registry.getDefault();
      if (!defaultTaskName) {
        console.log(renderTaskList(registry.all()));
        return;
      }

      // 動的インポートキャッシュ問題を避けるため、既にロードされたレジストリを使用してプランを構築
      const plan: ExecutionPlan = {
        bakefile,
        root,
        tasks: resolveTasks(defaultTaskName, registry.all()),
        targets: [defaultTaskName],
      };

      await runPlan(plan, args, command.flags);
      return;
    }

    const { taskNames, flags } = command;

    if (flags.graph !== undefined) {
      validateGraphFormat(flags.graph);
      const plan = await buildPlan(taskNames);
      console.log(renderGraph(plan.tasks, flags.graph as "mermaid" | "dot"));
      return;
    }

    await runPlan(await buildPlan(taskNames), args, flags);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    let exitCode = 1;
    if (error instanceof CliError) {
      exitCode = error.exitCode;
    } else if (
      // 設計 §11.3: 設定エラー（Bakefile 不在・未定義タスク・循環依存など）は exit 2
      error instanceof BakefileNotFoundError ||
      error instanceof DuplicateDefaultTaskError ||
      error instanceof WildcardNoMatchError ||
      error instanceof TaskNotFoundError ||
      error instanceof CircularDependencyError
    ) {
      exitCode = 2;
    }
    process.exit(exitCode);
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  (async () => {
    await main(args);
  })();
}
