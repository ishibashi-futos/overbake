import { DuplicateTaskError } from "../shared/errors.ts";
import type { TaskDefinition, TaskFunction, TaskOptions } from "../types.ts";

export class TaskRegistry {
  private tasks = new Map<string, TaskDefinition>();

  register(
    name: string,
    optionsOrFn: TaskOptions | TaskFunction,
    fn?: TaskFunction,
  ) {
    if (this.tasks.has(name)) {
      throw new DuplicateTaskError(name);
    }

    let actualFn: TaskFunction;
    let actualOptions: TaskOptions = {};
    let isMeta = false;

    if (typeof optionsOrFn === "function") {
      actualFn = optionsOrFn;
    } else {
      actualOptions = optionsOrFn;
      if (fn) {
        actualFn = fn;
      } else {
        actualFn = () => {};
        isMeta = true;
      }
    }

    this.tasks.set(name, {
      name,
      fn: actualFn,
      isMeta,
      options: actualOptions,
    });
  }

  get(name: string): TaskDefinition | undefined {
    return this.tasks.get(name);
  }

  all(): TaskDefinition[] {
    return Array.from(this.tasks.values());
  }
}
