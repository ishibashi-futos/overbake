import type {
  ComposeItem,
  RunEachItem,
  ServiceRun,
  Task,
  TaskComposeOptions,
  TaskCronOptions,
  TaskEachOptions,
  TaskFunction,
  TaskOptions,
  TaskServiceOptions,
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
    service: {
      (name: string, run: ServiceRun): Task;
      (name: string, options: TaskServiceOptions, run: ServiceRun): Task;
    };
    compose: (
      name: string,
      ...args: (TaskComposeOptions | ComposeItem)[]
    ) => Task;
    cron: (
      name: string,
      options: TaskCronOptions,
      ...items: RunEachItem[]
    ) => Task;
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

    taskFn.service = ((
      name: string,
      ...args: [ServiceRun] | [TaskServiceOptions, ServiceRun]
    ) =>
      registry.registerService(
        name,
        ...args,
      )) as typeof globalThis.task.service;

    taskFn.compose = (name, ...args) => registry.registerCompose(name, ...args);

    taskFn.cron = (name, options, ...items) =>
      registry.registerCron(name, options, ...items);

    globalThis.task = taskFn;

    await import(filePath);
  } finally {
    globalThis.task = previousTask;
  }
}
