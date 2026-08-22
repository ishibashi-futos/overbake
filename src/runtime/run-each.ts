import { captureConsole } from "../shared/console-capture.ts";
import { commandLabel, isCommand, isTask } from "../shared/run-each.ts";
import type {
  RunEachItem,
  RunEachOptions,
  Task,
  TaskContext,
} from "../types.ts";
import { runWithHooks } from "./hooks.ts";

export interface RunEachDeps {
  /** runEach を呼び出した親タスク名（見出しに使用） */
  taskName: string;
  root: string;
  cwd: string;
  /** 各工程用の出力キャプチャ付きコンテキストを生成する */
  createContext: (params: {
    name: string;
    root: string;
    cwd: string;
    onOutput: (text: string) => void;
    abortSignal?: AbortSignal;
  }) => TaskContext;
  /**
   * 進行状況の出力先。未指定なら stdout へ直接書く。
   * task.cron や task.compose の配下で動く場合、prefix 付き出力へ流すために差し替える。
   */
  write?: (text: string) => void;
  /** 各工程の ctx へ引き継ぐ中断シグナル（cron が compose 配下で停止されたときの伝播用） */
  abortSignal?: AbortSignal;
}

const SEPARATOR = "-".repeat(50);

function taskLabel(task: Task): string {
  const desc = task.options?.desc;
  return desc ? `${task.name} (${desc})` : task.name;
}

interface Failure {
  label: string;
  output: string;
  error: Error;
}

export async function runEach(
  deps: RunEachDeps,
  args: (RunEachOptions | RunEachItem)[],
): Promise<void> {
  let options: RunEachOptions = {};
  let items = args as RunEachItem[];
  const first = args[0];
  if (first !== undefined && !isCommand(first) && !isTask(first)) {
    options = first as RunEachOptions;
    items = args.slice(1) as RunEachItem[];
  }

  const write =
    deps.write ??
    ((text: string): void => {
      process.stdout.write(text);
    });

  write(`Running ${deps.taskName}...\n`);

  const failures: Failure[] = [];

  for (const item of items) {
    const label = isCommand(item) ? commandLabel(item) : taskLabel(item);
    write(`  - ${label}... `);

    const buffer: string[] = [];
    const subCtx = deps.createContext({
      name: isCommand(item) ? label : item.name,
      root: deps.root,
      cwd: deps.cwd,
      onOutput: (text) => buffer.push(text),
      abortSignal: deps.abortSignal,
    });

    const releaseConsole = captureConsole((text) => buffer.push(`${text}\n`));

    let error: unknown;
    try {
      if (isCommand(item)) {
        await subCtx.cmd(item[0], item[1] ?? []);
      } else {
        await runWithHooks(item, subCtx);
      }
    } catch (err) {
      error = err;
    } finally {
      releaseConsole();
    }

    if (error) {
      write("❌\n");
      failures.push({
        label,
        output: buffer.join(""),
        error: error instanceof Error ? error : new Error(String(error)),
      });
      if (!options.keepGoing) break;
    } else {
      write("✅\n");
    }
  }

  if (failures.length > 0) {
    for (const failure of failures) {
      write(`\n[${failure.label}] failed\n`);
      write(`${SEPARATOR}\n`);
      const trimmed = failure.output.trim();
      if (trimmed) write(`${trimmed}\n`);
      write(`${failure.error.message}\n`);
      write(`${SEPARATOR}\n`);
    }
    const labels = failures.map((f) => f.label).join(", ");
    throw new Error(`runEach failed: ${labels}`);
  }

  const done = options.done ?? `✨ done (${items.length} task(s))`;
  write(`${done}\n`);
}
