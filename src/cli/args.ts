export interface InitCommand {
  type: "init";
}

export interface RunCommand {
  type: "run";
  taskName: string;
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

  return { type: "run", taskName: command };
}
