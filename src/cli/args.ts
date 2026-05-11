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

export interface Flags {
  dryRun: boolean;
  explain: boolean;
  watch: boolean;
}

export interface RunCommand {
  type: "run";
  taskName: string;
  flags: Flags;
}

export type Command = InitCommand | ListCommand | HelpCommand | RunCommand;

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

  if (!command) {
    throw new Error("No command provided");
  }

  const helpIndex = args.indexOf("--help");
  if (helpIndex !== -1) {
    const taskName = helpIndex === 0 ? args[1] : args[0];
    return { type: "help", taskName };
  }

  const flags: Flags = {
    dryRun: args.includes("--dry-run"),
    explain: args.includes("--explain"),
    watch: args.includes("--watch"),
  };

  return { type: "run", taskName: command, flags };
}
