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
}

export interface RunCommand {
  type: "run";
  taskNames: string[];
  flags: Flags;
}

export type Command =
  | InitCommand
  | ListCommand
  | HelpCommand
  | DefaultCommand
  | RunCommand;

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

  if (
    !command ||
    command === "--dry-run" ||
    command === "--explain" ||
    command === "--watch" ||
    command === "--keep-going" ||
    command === "--quiet" ||
    command === "--verbose" ||
    command === "--no-color"
  ) {
    const flags: Flags = {
      dryRun: args.includes("--dry-run"),
      explain: args.includes("--explain"),
      watch: args.includes("--watch"),
      keepGoing: args.includes("--keep-going"),
      quiet: args.includes("--quiet"),
      verbose: args.includes("--verbose"),
      noColor: args.includes("--no-color"),
    };
    return { type: "default", flags };
  }

  const helpIndex = args.indexOf("--help");
  if (helpIndex !== -1) {
    const taskName = helpIndex === 0 ? args[1] : args[0];
    return { type: "help", taskName };
  }

  // Extract task names (non-flag positional arguments before --)
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
      arg !== "--no-color"
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
  };

  return { type: "run", taskNames, flags };
}
