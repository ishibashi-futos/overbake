import type { TaskFunction, TaskOptions } from "../types.ts";
import type { TaskRegistry } from "./registry.ts";

declare global {
  var task: (
    name: string,
    optionsOrFn: TaskOptions | TaskFunction,
    fn?: TaskFunction,
  ) => void;
}

export async function loadBakefile(
  filePath: string,
  registry: TaskRegistry,
): Promise<void> {
  const previousTask = globalThis.task;

  try {
    globalThis.task = (name, optionsOrFn, fn) => {
      registry.register(name, optionsOrFn, fn);
    };

    await import(filePath);
  } finally {
    globalThis.task = previousTask;
  }
}
