export interface TaskOptions {
  desc?: string;
  deps?: string[];
  inputs?: string[];
  outputs?: string[];
  env?: string[];
  confirm?: string | string[];
  before?: (ctx: HookContext) => void | Promise<void>;
  after?: (
    ctx: HookContext & { ok: boolean; durationMs: number },
  ) => void | Promise<void>;
}

export interface CmdOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
}

export interface RmOptions {
  recursive?: boolean;
  force?: boolean;
}

export interface TaskContext {
  name: string;
  root: string;
  cwd: string;
  cmd(
    command: string,
    args?: readonly string[],
    options?: CmdOptions,
  ): Promise<void>;
  rm(path: string, options?: RmOptions): Promise<void>;
  exists(path: string): boolean;
  resolve(...segments: string[]): string;
  log(...args: unknown[]): void;
}

export type TaskFunction = (ctx: TaskContext) => void | Promise<void>;

export interface HookContext {
  name: string;
}

export interface TaskDefinition {
  name: string;
  fn: TaskFunction;
  isMeta?: boolean;
  options?: TaskOptions;
}
