import {
  DuplicateDefaultTaskError,
  DuplicateTaskError,
} from "../shared/errors.ts";
import type { TaskDefinition, TaskFunction, TaskOptions } from "../types.ts";

export class TaskRegistry {
  private tasks = new Map<string, TaskDefinition>();
  private defaultTaskName: string | undefined;

  register(
    name: string,
    optionsOrFn: TaskOptions | TaskFunction,
    fn?: TaskFunction,
  ): TaskDefinition {
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

    const definition: TaskDefinition = {
      name,
      fn: actualFn,
      isMeta,
      options: actualOptions,
    };
    this.tasks.set(name, definition);
    return definition;
  }

  get(name: string): TaskDefinition | undefined {
    return this.tasks.get(name);
  }

  all(): TaskDefinition[] {
    return Array.from(this.tasks.values());
  }

  setDefault(name: string): void {
    if (this.defaultTaskName !== undefined) {
      throw new DuplicateDefaultTaskError();
    }
    this.defaultTaskName = name;
  }

  getDefault(): string | undefined {
    return this.defaultTaskName;
  }
}
