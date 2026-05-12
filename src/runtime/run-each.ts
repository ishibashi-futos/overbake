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
  }) => TaskContext;
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

  process.stdout.write(`Running ${deps.taskName}...\n`);

  const failures: Failure[] = [];

  for (const item of items) {
    const label = isCommand(item) ? commandLabel(item) : taskLabel(item);
    process.stdout.write(`  - ${label}... `);

    const buffer: string[] = [];
    const subCtx = deps.createContext({
      name: isCommand(item) ? label : item.name,
      root: deps.root,
      cwd: deps.cwd,
      onOutput: (text) => buffer.push(text),
    });

    const originalLog = console.log;
    const originalError = console.error;
    console.log = (...a: unknown[]) => buffer.push(`${a.join(" ")}\n`);
    console.error = (...a: unknown[]) => buffer.push(`${a.join(" ")}\n`);

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
      console.log = originalLog;
      console.error = originalError;
    }

    if (error) {
      process.stdout.write("❌\n");
      failures.push({
        label,
        output: buffer.join(""),
        error: error instanceof Error ? error : new Error(String(error)),
      });
      if (!options.keepGoing) break;
    } else {
      process.stdout.write("✅\n");
    }
  }

  if (failures.length > 0) {
    for (const failure of failures) {
      process.stdout.write(`\n[${failure.label}] failed\n`);
      process.stdout.write(`${SEPARATOR}\n`);
      const trimmed = failure.output.trim();
      if (trimmed) process.stdout.write(`${trimmed}\n`);
      process.stdout.write(`${failure.error.message}\n`);
      process.stdout.write(`${SEPARATOR}\n`);
    }
    const labels = failures.map((f) => f.label).join(", ");
    throw new Error(`runEach failed: ${labels}`);
  }

  const done = options.done ?? `✨ done (${items.length} task(s))`;
  process.stdout.write(`${done}\n`);
}
