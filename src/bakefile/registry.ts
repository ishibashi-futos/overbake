import {
  DuplicateDefaultTaskError,
  DuplicateTaskError,
} from "../shared/errors.ts";
import { commandLabel, isCommand, isTask } from "../shared/run-each.ts";
import type {
  ComposeItem,
  ComposeStep,
  RunEachItem,
  RunEachOptions,
  RunEachStep,
  TaskComposeOptions,
  TaskDefinition,
  TaskEachOptions,
  TaskFunction,
  TaskOptions,
} from "../types.ts";

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

  /**
   * task.each(): 複数工程を順に実行するタスクを宣言的に登録する。
   * 工程列は options.each に静的記述として保存され（グラフ描画用）、
   * 生成された fn が ctx.runEach で実際の実行を行う。
   */
  registerEach(
    name: string,
    ...args: (TaskEachOptions | RunEachItem)[]
  ): TaskDefinition {
    let opts: TaskEachOptions = {};
    let items = args as RunEachItem[];
    const first = args[0];
    if (first !== undefined && !isCommand(first) && !isTask(first)) {
      opts = first as TaskEachOptions;
      items = args.slice(1) as RunEachItem[];
    }

    const { done, keepGoing, ...taskOptions } = opts;

    const each: RunEachStep[] = items.map((item) =>
      isCommand(item)
        ? { kind: "command", label: commandLabel(item) }
        : { kind: "task", name: item.name, desc: item.options?.desc },
    );

    const runEachOptions: RunEachOptions = {};
    if (done !== undefined) runEachOptions.done = done;
    if (keepGoing !== undefined) runEachOptions.keepGoing = keepGoing;
    const hasRunEachOptions = done !== undefined || keepGoing !== undefined;

    const fn: TaskFunction = async (ctx) => {
      await ctx.runEach(
        ...(hasRunEachOptions ? [runEachOptions, ...items] : items),
      );
    };

    return this.register(name, { ...taskOptions, each }, fn);
  }

  /**
   * task.compose(): 複数の長時間サービスを並列起動するタスクを宣言的に登録する。
   * サービス列は options.compose に静的記述として保存され（グラフ描画用）、
   * 生成された fn が ctx.runCompose で並列起動・fail-fast・SIGTERM 伝播を行う。
   */
  registerCompose(
    name: string,
    ...args: (TaskComposeOptions | ComposeItem)[]
  ): TaskDefinition {
    let taskOptions: TaskComposeOptions = {};
    let items = args as ComposeItem[];
    const first = args[0];
    if (first !== undefined && !isCommand(first) && !isTask(first)) {
      taskOptions = first as TaskComposeOptions;
      items = args.slice(1) as ComposeItem[];
    }

    const compose: ComposeStep[] = items.map((item) =>
      isCommand(item)
        ? { kind: "command", label: commandLabel(item) }
        : { kind: "task", name: item.name, desc: item.options?.desc },
    );

    const fn: TaskFunction = async (ctx) => {
      await ctx.runCompose(items);
    };

    return this.register(name, { ...taskOptions, compose }, fn);
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
