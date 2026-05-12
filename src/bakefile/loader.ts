import type {
  RunEachItem,
  Task,
  TaskEachOptions,
  TaskFunction,
  TaskOptions,
} from "../types.ts";
import type { TaskRegistry } from "./registry.ts";

declare global {
  var task: ((
    name: string,
    optionsOrFn: TaskOptions | TaskFunction,
    fn?: TaskFunction,
  ) => Task) & {
    default: (task: Task) => void;
    each: (name: string, ...args: (TaskEachOptions | RunEachItem)[]) => Task;
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
    ) => registry.register(name, optionsOrFn, fn)) as typeof globalThis.task;

    taskFn.default = (task: Task) => {
      registry.setDefault(task.name);
    };

    taskFn.each = (name, ...args) => registry.registerEach(name, ...args);

    globalThis.task = taskFn;

    await import(filePath);
  } finally {
    globalThis.task = previousTask;
  }
}
