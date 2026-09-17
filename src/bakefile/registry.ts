import {
  DuplicateDefaultTaskError,
  DuplicateTaskError,
} from "../shared/errors.ts";
import { commandLabel, isCommand, isTask } from "../shared/run-each.ts";
import type {
  ComposeItem,
  CronDefinition,
  RunEachItem,
  RunEachOptions,
  RunEachStep,
  ServiceDefinition,
  ServiceRun,
  ServiceSource,
  TaskComposeOptions,
  TaskCronOptions,
  TaskDefinition,
  TaskEachOptions,
  TaskFunction,
  TaskOptions,
  TaskServiceOptions,
} from "../types.ts";

/**
 * task.service() の run（関数 / コマンド / タスクハンドル）を
 * ServiceDefinition.run（常に TaskFunction）と source（静的記述）に正規化する。
 */
function normalizeServiceRun(run: ServiceRun): {
  run: TaskFunction;
  source: ServiceSource;
} {
  if (isCommand(run)) {
    const [command, args] = run;
    return {
      run: (ctx) => ctx.cmd(command, args ?? []),
      source: { kind: "command", label: commandLabel(run) },
    };
  }
  if (isTask(run)) {
    return {
      run: run.fn,
      source: { kind: "task", name: run.name, desc: run.options?.desc },
    };
  }
  return { run, source: { kind: "fn" } };
}

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
   * task.service(): 長時間動くサービスを宣言的に登録する。
   * 引数は 1 個（run のみ）か 2 個（options, run）かを個数で判定する（型の推測はしない）。
   * options の ready / failOn / retry は ServiceDefinition へ、残りは通常の TaskOptions へ振り分ける。
   * run は関数 / コマンド / タスクハンドルのいずれも TaskFunction + source（静的記述）へ正規化する。
   * 生成された fn は ctx.runCompose([[自分自身]]) で単体起動する（task.compose の 1 ステージ 1 サービスと同じ経路）。
   * 設定値（ready/failOn/retry）の検証はここでは行わない（cron と同じ方針。検証は実行時と doctor）。
   */
  registerService(
    name: string,
    ...args: [ServiceRun] | [TaskServiceOptions, ServiceRun]
  ): TaskDefinition {
    const hasOptions = args.length === 2;
    const options = (hasOptions ? args[0] : {}) as TaskServiceOptions;
    const run = (hasOptions ? args[1] : args[0]) as ServiceRun;

    const { ready, failOn, retry, ...taskOptions } = options;
    const { run: normalizedRun, source } = normalizeServiceRun(run);

    const service: ServiceDefinition = { run: normalizedRun, source };
    if (ready !== undefined) service.ready = ready;
    if (failOn !== undefined) service.failOn = failOn;
    if (retry !== undefined) service.retry = retry;

    let definition: TaskDefinition;
    const fn: TaskFunction = async (ctx) => {
      await ctx.runCompose([[definition]]);
    };

    definition = this.register(name, { ...taskOptions, service }, fn);
    return definition;
  }

  /**
   * task.compose(): 複数のサービスを起動順に従って束ねるタスクを宣言的に登録する。
   * 引数は先頭がオプション（配列でもタスクハンドルでもない）か否かで判定する。
   * 以降の各要素はタスクハンドル（1 要素のステージ）または配列（同時起動するグループ）で、
   * 並びがそのままステージ順になる。options.compose にはステージごとのサービス名（string[][]）を
   * 静的記述として保存し（グラフ描画・help 用）、生成された fn が ctx.runCompose(stages) で実行する。
   * 要素がサービスかどうかの検証はここでは行わない（検証は実行時と doctor）。
   */
  registerCompose(
    name: string,
    ...args: (TaskComposeOptions | ComposeItem)[]
  ): TaskDefinition {
    let taskOptions: TaskComposeOptions = {};
    let items = args as ComposeItem[];
    const first = args[0];
    if (first !== undefined && !Array.isArray(first) && !isTask(first)) {
      taskOptions = first as TaskComposeOptions;
      items = args.slice(1) as ComposeItem[];
    }

    const stages: TaskDefinition[][] = items.map((item) =>
      Array.isArray(item) ? [...item] : [item],
    );

    const compose: string[][] = stages.map((stage) =>
      stage.map((task) => task.name),
    );

    const fn: TaskFunction = async (ctx) => {
      await ctx.runCompose(stages);
    };

    return this.register(name, { ...taskOptions, compose }, fn);
  }

  /**
   * task.cron(): 工程列をスケジュールに従って繰り返し実行するタスクを登録する。
   * スケジュールと工程列は options.cron に静的記述として保存され（グラフ描画・doctor 用）、
   * 生成された fn が ctx.runCron で実行する。
   * cron 式の検証は実行時／doctor 側の parseSchedule に一本化する（登録時には検証しない）。
   */
  registerCron(
    name: string,
    options: TaskCronOptions,
    ...items: RunEachItem[]
  ): TaskDefinition {
    const { schedule, ...taskOptions } = options;

    const cron: CronDefinition = {
      schedule,
      steps: items.map((item) =>
        isCommand(item)
          ? { kind: "command", label: commandLabel(item) }
          : { kind: "task", name: item.name, desc: item.options?.desc },
      ),
    };

    const fn: TaskFunction = async (ctx) => {
      await ctx.runCron(schedule, items);
    };

    return this.register(name, { ...taskOptions, cron }, fn);
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
