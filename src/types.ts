export interface TaskOptions {
  desc?: string;
  deps?: string[];
  inputs?: string[];
  outputs?: string[];
  env?: string[];
  before?: (ctx: HookContext) => void | Promise<void>;
  after?: (
    ctx: HookContext & { ok: boolean; durationMs: number },
  ) => void | Promise<void>;
}

export type TaskFunction = () => void | Promise<void>;

export interface HookContext {
  name: string;
}

export interface TaskDefinition {
  name: string;
  fn: TaskFunction;
  options?: TaskOptions;
}
