export interface InitCommand {
  type: "init";
  typesOnly: boolean;
}

export interface ListCommand {
  type: "list";
}

export interface HelpCommand {
  type: "help";
  taskName?: string;
}

export interface DefaultCommand {
  type: "default";
  flags: Flags;
}

export interface Flags {
  dryRun: boolean;
  explain: boolean;
  watch: boolean;
  keepGoing: boolean;
  quiet: boolean;
  verbose: boolean;
  noColor: boolean;
  yes: boolean;
  noSummary: boolean;
  daemon: boolean;
  // "mermaid" | "dot" または未知フォーマット（main.ts で検証）
  graph?: string;
}

export interface RunCommand {
  type: "run";
  taskNames: string[];
  flags: Flags;
}

export interface CompletionsCommand {
  type: "completions";
  shell: string;
}

export interface CompleteCommand {
  type: "complete";
  subcommand: string;
}

export interface DoctorCommand {
  type: "doctor";
}

export interface GlazeCommand {
  type: "glaze";
  filePath?: string;
  check: boolean;
}

export interface VersionCommand {
  type: "version";
}

export interface UpdateCommand {
  type: "update";
  check: boolean;
  force: boolean;
}

export interface PsCommand {
  type: "ps";
}

export interface StopCommand {
  type: "stop";
  taskName?: string;
  all: boolean;
}

export interface LogsCommand {
  type: "logs";
  taskName?: string;
  follow: boolean;
  lines: number;
}

export type Command =
  | InitCommand
  | ListCommand
  | HelpCommand
  | DefaultCommand
  | RunCommand
  | CompletionsCommand
  | CompleteCommand
  | DoctorCommand
  | GlazeCommand
  | VersionCommand
  | UpdateCommand
  | PsCommand
  | StopCommand
  | LogsCommand;

/** `bake logs` が既定で表示する行数 */
export const DEFAULT_LOG_LINES = 50;

/**
 * タスク実行時のフラグ定義。フラグ名の一覧をここへ集約し、
 * 「フラグの解析」と「タスク名の抽出」で同じ定義を使う。
 */
const RUN_FLAGS: ReadonlyArray<{ key: keyof Flags; names: readonly string[] }> =
  [
    { key: "dryRun", names: ["--dry-run"] },
    { key: "explain", names: ["--explain"] },
    { key: "watch", names: ["--watch"] },
    { key: "keepGoing", names: ["--keep-going"] },
    { key: "quiet", names: ["--quiet"] },
    { key: "verbose", names: ["--verbose"] },
    { key: "noColor", names: ["--no-color"] },
    { key: "yes", names: ["--yes", "-y"] },
    { key: "noSummary", names: ["--no-summary"] },
    { key: "daemon", names: ["--daemon", "-d"] },
  ];

// --graph / --graph=mermaid / --graph=dot などを抽出する
function extractGraph(args: string[]): string | undefined {
  for (const arg of args) {
    if (arg === "--graph" || arg === "--graph=mermaid") return "mermaid";
    if (arg === "--graph=dot") return "dot";
    if (arg.startsWith("--graph=")) return arg.slice("--graph=".length);
  }
  return undefined;
}

function parseFlags(args: string[]): Flags {
  const flags = {
    graph: extractGraph(args),
  } as Flags;
  for (const { key, names } of RUN_FLAGS) {
    (flags[key] as boolean) = names.some((name) => args.includes(name));
  }
  return flags;
}

/**
 * `--` より前（bake 自身への引数）だけを切り出す。
 * `--` 以降はタスクへのパススルーなので、フラグ解析・タスク名抽出のどちらからも除く。
 */
function beforeDoubleDash(args: string[]): string[] {
  const dashIndex = args.indexOf("--");
  return dashIndex !== -1 ? args.slice(0, dashIndex) : args;
}

/** `-n 20` / `-n20` / `--lines=20` 形式の行数指定を読む */
function extractLines(args: string[], fallback: number): number {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === "-n" || arg === "--lines") {
      const value = Number(args[i + 1]);
      if (Number.isInteger(value) && value > 0) return value;
      continue;
    }
    const match = /^(?:-n|--lines=)(\d+)$/.exec(arg);
    if (match) {
      const value = Number(match[1]);
      if (value > 0) return value;
    }
  }
  return fallback;
}

export function parseArgs(args: string[]): Command {
  const [command] = args;

  if (command === "init") {
    return { type: "init", typesOnly: args.includes("--type") };
  }

  if (command === "doctor") {
    return { type: "doctor" };
  }

  if (command === "glaze") {
    const filePath = args.slice(1).find((arg) => !arg.startsWith("-"));
    return { type: "glaze", filePath, check: args.includes("--check") };
  }

  if (command === "-l" || command === "list") {
    return { type: "list" };
  }

  if (command === "ps") {
    return { type: "ps" };
  }

  if (command === "stop") {
    const taskName = args.slice(1).find((arg) => !arg.startsWith("-"));
    return { type: "stop", taskName, all: args.includes("--all") };
  }

  if (command === "logs") {
    const rest = args.slice(1);
    // -n の値（数値）はタスク名として拾わないよう除外する
    const valueIndexes = new Set<number>();
    rest.forEach((arg, i) => {
      if (arg === "-n" || arg === "--lines") valueIndexes.add(i + 1);
    });
    const taskName = rest.find(
      (arg, i) => !arg.startsWith("-") && !valueIndexes.has(i),
    );
    return {
      type: "logs",
      taskName,
      follow: args.includes("-f") || args.includes("--follow"),
      lines: extractLines(rest, DEFAULT_LOG_LINES),
    };
  }

  if (command === "--help") {
    const taskName = args[1];
    return { type: "help", taskName };
  }

  if (command === "completions") {
    const shell = args[1] ?? "";
    return { type: "completions", shell };
  }

  if (command === "__complete") {
    const subcommand = args[1] ?? "";
    return { type: "complete", subcommand };
  }

  if (command === "--version" || command === "-v") {
    return { type: "version" };
  }

  if (command === "update") {
    return {
      type: "update",
      check: args.includes("--check"),
      force: args.includes("--force"),
    };
  }

  const flagArgs = beforeDoubleDash(args);

  const helpIndex = flagArgs.indexOf("--help");
  if (helpIndex !== -1) {
    const taskName = helpIndex === 0 ? flagArgs[1] : flagArgs[0];
    return { type: "help", taskName };
  }

  const flags = parseFlags(flagArgs);
  const taskNames = flagArgs.filter((arg) => !arg.startsWith("-"));

  // タスク名が無ければデフォルトタスク（未設定ならタスク一覧）へ
  if (taskNames.length === 0) {
    return { type: "default", flags };
  }

  return { type: "run", taskNames, flags };
}
