export interface InitCommand {
  type: "init";
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

export type Command =
  | InitCommand
  | ListCommand
  | HelpCommand
  | DefaultCommand
  | RunCommand
  | CompletionsCommand
  | CompleteCommand;

export function parseArgs(args: string[]): Command {
  const [command] = args;

  if (command === "init") {
    return { type: "init" };
  }

  if (command === "-l" || command === "list") {
    return { type: "list" };
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

  if (
    !command ||
    command === "--dry-run" ||
    command === "--explain" ||
    command === "--watch" ||
    command === "--keep-going" ||
    command === "--quiet" ||
    command === "--verbose" ||
    command === "--no-color" ||
    command === "--yes" ||
    command === "-y"
  ) {
    const flags: Flags = {
      dryRun: args.includes("--dry-run"),
      explain: args.includes("--explain"),
      watch: args.includes("--watch"),
      keepGoing: args.includes("--keep-going"),
      quiet: args.includes("--quiet"),
      verbose: args.includes("--verbose"),
      noColor: args.includes("--no-color"),
      yes: args.includes("--yes") || args.includes("-y"),
    };
    return { type: "default", flags };
  }

  const helpIndex = args.indexOf("--help");
  if (helpIndex !== -1) {
    const taskName = helpIndex === 0 ? args[1] : args[0];
    return { type: "help", taskName };
  }

  // -- の前の非フラグ位置引数（タスク名）を抽出
  const taskNames: string[] = [];
  const dashIndex = args.indexOf("--");
  const flagArgs = dashIndex !== -1 ? args.slice(0, dashIndex) : args;

  for (const arg of flagArgs) {
    if (
      !arg.startsWith("-") &&
      arg !== "--dry-run" &&
      arg !== "--explain" &&
      arg !== "--watch" &&
      arg !== "--keep-going" &&
      arg !== "--quiet" &&
      arg !== "--verbose" &&
      arg !== "--no-color" &&
      arg !== "--yes" &&
      arg !== "-y"
    ) {
      taskNames.push(arg);
    }
  }

  const flags: Flags = {
    dryRun: args.includes("--dry-run"),
    explain: args.includes("--explain"),
    watch: args.includes("--watch"),
    keepGoing: args.includes("--keep-going"),
    quiet: args.includes("--quiet"),
    verbose: args.includes("--verbose"),
    noColor: args.includes("--no-color"),
    yes: args.includes("--yes") || args.includes("-y"),
  };

  return { type: "run", taskNames, flags };
}
