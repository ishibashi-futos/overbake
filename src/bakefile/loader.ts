import type { TaskFunction, TaskOptions } from "../types.ts";
import type { TaskRegistry } from "./registry.ts";

declare global {
  var task: ((
    name: string,
    optionsOrFn: TaskOptions | TaskFunction,
    fn?: TaskFunction,
  ) => void) & {
    default: (name: string) => void;
  };
}

export async function loadBakefile(
  filePath: string,
  registry: TaskRegistry,
): Promise<void> {
  const previousTask = globalThis.task;

  try {
    const taskFn = ((
      name: string,
      optionsOrFn: TaskOptions | TaskFunction,
      fn?: TaskFunction,
    ) => {
      registry.register(name, optionsOrFn, fn);
    }) as typeof globalThis.task;

    taskFn.default = (name: string) => {
      registry.setDefault(name);
    };

    globalThis.task = taskFn;

    await import(filePath);
  } finally {
    globalThis.task = previousTask;
  }
}
