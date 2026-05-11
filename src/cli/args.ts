export interface InitCommand {
  type: "init";
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

export type Command = InitCommand | RunCommand;

export function parseArgs(args: string[]): Command {
  const [command] = args;

  if (command === "init") {
    return { type: "init" };
  }

  if (!command) {
    throw new Error("No command provided");
  }

  const flags: Flags = {
    dryRun: args.includes("--dry-run"),
    explain: args.includes("--explain"),
    watch: args.includes("--watch"),
  };

  return { type: "run", taskName: command, flags };
}
