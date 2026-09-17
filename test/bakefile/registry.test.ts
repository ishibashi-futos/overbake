import { describe, expect, test } from "bun:test";
import { TaskRegistry } from "../../src/bakefile/registry.ts";
import {
  DuplicateDefaultTaskError,
  DuplicateTaskError,
} from "../../src/shared/errors.ts";
import type { ServiceReady, TaskContext } from "../../src/types.ts";

// runEach 呼び出しだけを記録する最小の TaskContext スタブ
function stubContext(): {
  ctx: TaskContext;
  calls: unknown[][];
} {
  const calls: unknown[][] = [];
  const ctx = {
    name: "stub",
    root: ".",
    cwd: ".",
    async runEach(...args: unknown[]) {
      calls.push(args);
    },
  } as unknown as TaskContext;
  return { ctx, calls };
}

// runCompose 呼び出しだけを記録する最小の TaskContext スタブ
function stubComposeContext(): {
  ctx: TaskContext;
  calls: unknown[][];
} {
  const calls: unknown[][] = [];
  const ctx = {
    name: "stub",
    root: ".",
    cwd: ".",
    async runCompose(items: unknown[]) {
      calls.push(items);
    },
  } as unknown as TaskContext;
  return { ctx, calls };
}

describe("TaskRegistry", () => {
  test("registers a task with function only", () => {
    const registry = new TaskRegistry();
    const fn = () => {};

    registry.register("test", fn);

    const task = registry.get("test");
    expect(task).toBeDefined();
    expect(task?.name).toBe("test");
    expect(task?.fn).toBe(fn);
  });

  test("registers a task with options and function", () => {
    const registry = new TaskRegistry();
    const fn = () => {};
    const options = { desc: "Test task", deps: ["dep1"] };

    registry.register("test", options, fn);

    const task = registry.get("test");
    expect(task?.options).toEqual(options);
    expect(task?.fn).toBe(fn);
  });

  test("throws DuplicateTaskError when registering duplicate task", () => {
    const registry = new TaskRegistry();
    registry.register("test", () => {});

    expect(() => registry.register("test", () => {})).toThrow(
      DuplicateTaskError,
    );
  });

  test("returns all registered tasks", () => {
    const registry = new TaskRegistry();
    registry.register("task1", () => {});
    registry.register("task2", () => {});

    const all = registry.all();
    expect(all.length).toBe(2);
    expect(all.map((t) => t.name)).toContain("task1");
    expect(all.map((t) => t.name)).toContain("task2");
  });

  test("sets and gets default task", () => {
    const registry = new TaskRegistry();
    registry.register("build", () => {});
    registry.setDefault("build");

    expect(registry.getDefault()).toBe("build");
  });

  test("throws DuplicateDefaultTaskError when setting default twice", () => {
    const registry = new TaskRegistry();
    registry.register("build", () => {});
    registry.register("clean", () => {});

    registry.setDefault("build");
    expect(() => registry.setDefault("clean")).toThrow(
      DuplicateDefaultTaskError,
    );
  });

  test("getDefault returns undefined when no default is set", () => {
    const registry = new TaskRegistry();
    registry.register("task1", () => {});

    expect(registry.getDefault()).toBeUndefined();
  });

  test("メタタスク (options のみで fn なし) は isMeta=true", () => {
    const registry = new TaskRegistry();
    registry.register("group", { desc: "Group task", deps: ["task1"] });

    const task = registry.get("group");
    expect(task?.isMeta).toBe(true);
    expect(typeof task?.fn).toBe("function");
  });
});

describe("TaskRegistry.registerEach", () => {
  test("工程を options.each に静的記述として保存し、isMeta=false の通常タスクになる", () => {
    const registry = new TaskRegistry();
    const typecheck = registry.register("typecheck", { desc: "型" }, () => {});
    const fmt = registry.register("fmt", () => {});

    const def = registry.registerEach(
      "sanity",
      { desc: "まとめて検証", done: "✨ ok" },
      typecheck,
      fmt,
      ["bun", ["test"]],
    );

    expect(def.name).toBe("sanity");
    expect(def.isMeta).toBe(false);
    expect(typeof def.fn).toBe("function");
    expect(def.options).toEqual({
      desc: "まとめて検証",
      each: [
        { kind: "task", name: "typecheck", desc: "型" },
        { kind: "task", name: "fmt", desc: undefined },
        { kind: "command", label: "bun test" },
      ],
    });
    expect(registry.get("sanity")).toBe(def);
  });

  test("生成された fn は ctx.runEach を {done,keepGoing} → 工程の順で呼ぶ", async () => {
    const registry = new TaskRegistry();
    const a = registry.register("a", () => {});
    const b = registry.register("b", () => {});

    const def = registry.registerEach("each-task", { done: "d" }, a, b);
    const { ctx, calls } = stubContext();
    await def.fn(ctx);

    expect(calls.length).toBe(1);
    expect(calls[0]).toEqual([{ done: "d" }, a, b]);
  });

  test("オプションを省略すると fn は ctx.runEach を工程のみで呼ぶ", async () => {
    const registry = new TaskRegistry();
    const a = registry.register("a", () => {});

    const def = registry.registerEach("each-task", a, ["echo"]);
    const { ctx, calls } = stubContext();
    await def.fn(ctx);

    expect(calls[0]).toEqual([a, ["echo"]]);
    expect(def.options?.each).toEqual([
      { kind: "task", name: "a", desc: undefined },
      { kind: "command", label: "echo" },
    ]);
  });

  test("工程ゼロ個でも登録でき each は空配列になる", () => {
    const registry = new TaskRegistry();
    const def = registry.registerEach("empty");
    expect(def.options?.each).toEqual([]);
    expect(typeof def.fn).toBe("function");
  });

  test("重複名は DuplicateTaskError", () => {
    const registry = new TaskRegistry();
    registry.register("dup", () => {});
    expect(() => registry.registerEach("dup")).toThrow(DuplicateTaskError);
  });
});

describe("TaskRegistry.registerService", () => {
  test("引数 1 個（run のみ）で登録でき、service には ready/failOn/retry を含まない", () => {
    const registry = new TaskRegistry();
    const fn = async () => {};

    const def = registry.registerService("worker", fn);

    expect(def.name).toBe("worker");
    expect(def.isMeta).toBe(false);
    expect(def.options?.desc).toBeUndefined();
    expect(def.options?.service).toEqual({
      run: fn,
      source: { kind: "fn" },
    });
    expect(registry.get("worker")).toBe(def);
  });

  test("引数 2 個（options, run）で ready/failOn/retry を ServiceDefinition へ、残りを TaskOptions へ分離する", () => {
    const registry = new TaskRegistry();
    const fn = async () => {};

    const def = registry.registerService(
      "api",
      {
        desc: "API サーバ",
        deps: ["build"],
        ready: { log: /listening/ },
        failOn: "EADDRINUSE",
        retry: { attempts: 3 },
      },
      fn,
    );

    expect(def.options?.desc).toBe("API サーバ");
    expect(def.options?.deps).toEqual(["build"]);
    expect(def.options?.service).toEqual({
      run: fn,
      source: { kind: "fn" },
      ready: { log: /listening/ },
      failOn: "EADDRINUSE",
      retry: { attempts: 3 },
    });
  });

  test("ready/failOn/retry を省略すると service に含まれない（指定したキーだけ入る）", () => {
    const registry = new TaskRegistry();
    const fn = async () => {};

    const def = registry.registerService("api", { desc: "d" }, fn);

    expect(def.options?.service).toEqual({ run: fn, source: { kind: "fn" } });
    expect(Object.hasOwn(def.options?.service ?? {}, "ready")).toBe(false);
    expect(Object.hasOwn(def.options?.service ?? {}, "failOn")).toBe(false);
    expect(Object.hasOwn(def.options?.service ?? {}, "retry")).toBe(false);
  });

  test("登録時には ready/failOn/retry を検証しない（検証は実行時と doctor）", () => {
    const registry = new TaskRegistry();
    const invalidReady = { log: "", port: 5432 } as unknown as ServiceReady;
    expect(() =>
      registry.registerService("bad", { ready: invalidReady }, async () => {}),
    ).not.toThrow();
  });

  test("run が関数なら source は { kind: 'fn' } で run はそのまま使われる", () => {
    const registry = new TaskRegistry();
    const fn = async () => {};

    const def = registry.registerService("worker", fn);

    expect(def.options?.service?.source).toEqual({ kind: "fn" });
    expect(def.options?.service?.run).toBe(fn);
  });

  test("run がコマンドなら source はラベル付き command、run は ctx.cmd を呼ぶ", async () => {
    const registry = new TaskRegistry();
    const calls: unknown[][] = [];
    const ctx = {
      async cmd(...args: unknown[]) {
        calls.push(args);
      },
    } as unknown as TaskContext;

    const def = registry.registerService("db", [
      "docker",
      ["compose", "up", "postgres"],
    ]);

    expect(def.options?.service?.source).toEqual({
      kind: "command",
      label: "docker compose up postgres",
    });

    await def.options?.service?.run(ctx);
    expect(calls).toEqual([["docker", ["compose", "up", "postgres"]]]);
  });

  test("run がコマンドで args 省略時は ctx.cmd に空配列を渡す", async () => {
    const registry = new TaskRegistry();
    const calls: unknown[][] = [];
    const ctx = {
      async cmd(...args: unknown[]) {
        calls.push(args);
      },
    } as unknown as TaskContext;

    const def = registry.registerService("solo", ["ls"]);
    await def.options?.service?.run(ctx);

    expect(calls).toEqual([["ls", []]]);
  });

  test("run がタスクハンドルなら source は名前・desc 付き task、run はそのタスクの fn", async () => {
    const registry = new TaskRegistry();
    const calls: unknown[] = [];
    const inner = registry.register(
      "poll",
      { desc: "定期実行" },
      async (ctx) => {
        calls.push(ctx);
      },
    );

    const def = registry.registerService("poller", inner);

    expect(def.options?.service?.source).toEqual({
      kind: "task",
      name: "poll",
      desc: "定期実行",
    });
    expect(def.options?.service?.run).toBe(inner.fn);

    const ctx = {} as TaskContext;
    await def.options?.service?.run(ctx);
    expect(calls).toEqual([ctx]);
  });

  test("生成された fn は ctx.runCompose を [[自分自身]] で呼ぶ", async () => {
    const registry = new TaskRegistry();
    const def = registry.registerService("db", async () => {});
    const { ctx, calls } = stubComposeContext();

    await def.fn(ctx);

    expect(calls.length).toBe(1);
    expect(calls[0]).toEqual([[def]]);
  });

  test("重複名は DuplicateTaskError", () => {
    const registry = new TaskRegistry();
    registry.register("dup", () => {});
    expect(() => registry.registerService("dup", async () => {})).toThrow(
      DuplicateTaskError,
    );
  });
});

describe("TaskRegistry.registerCompose", () => {
  test("配列はグループ、タスクハンドルは 1 要素のステージとして stages を組み立てる", () => {
    const registry = new TaskRegistry();
    const db = registry.registerService("db", async () => {});
    const api = registry.registerService("api", async () => {});
    const worker = registry.registerService("worker", async () => {});
    const web = registry.registerService("web", async () => {});

    const def = registry.registerCompose(
      "dev",
      { desc: "開発環境" },
      db,
      [api, worker],
      web,
    );

    expect(def.name).toBe("dev");
    expect(def.isMeta).toBe(false);
    expect(typeof def.fn).toBe("function");
    expect(def.options?.desc).toBe("開発環境");
    expect(def.options?.compose).toEqual([["db"], ["api", "worker"], ["web"]]);
    expect(registry.get("dev")).toBe(def);
  });

  test("生成された fn は ctx.runCompose を stages（TaskDefinition[][]）で呼ぶ", async () => {
    const registry = new TaskRegistry();
    const a = registry.registerService("a", async () => {});
    const b = registry.registerService("b", async () => {});
    const c = registry.registerService("c", async () => {});

    const def = registry.registerCompose("dev", a, [b, c]);
    const { ctx, calls } = stubComposeContext();
    await def.fn(ctx);

    expect(calls.length).toBe(1);
    expect(calls[0]).toEqual([[a], [b, c]]);
  });

  test("オプションを省略しても登録できる", () => {
    const registry = new TaskRegistry();
    const a = registry.registerService("a", async () => {});

    const def = registry.registerCompose("dev", a);
    expect(def.options?.compose).toEqual([["a"]]);
  });

  test("要素 0 個でも登録でき compose は空配列になる", () => {
    const registry = new TaskRegistry();
    const def = registry.registerCompose("empty");
    expect(def.options?.compose).toEqual([]);
    expect(typeof def.fn).toBe("function");
  });

  test("要素がサービスかどうかは検証しない（検証は実行時と doctor）", () => {
    const registry = new TaskRegistry();
    const notAService = registry.register("plain", () => {});
    expect(() => registry.registerCompose("dev", notAService)).not.toThrow();
  });

  test("重複名は DuplicateTaskError", () => {
    const registry = new TaskRegistry();
    registry.register("dup", () => {});
    expect(() => registry.registerCompose("dup")).toThrow(DuplicateTaskError);
  });

  test("deps を TaskComposeOptions 経由で渡せる", () => {
    const registry = new TaskRegistry();
    const build = registry.register("build", () => {});
    const ui = registry.registerService("ui", async () => {});

    const def = registry.registerCompose("dev", { deps: ["build"] }, ui);
    expect(def.options?.deps).toEqual(["build"]);
    expect(def.options?.compose).toEqual([["ui"]]);
    // build/ui を参照していることを deps から確認
    expect(registry.get("build")).toBe(build);
  });
});

describe("TaskRegistry.register return value", () => {
  test("returns the created TaskDefinition", () => {
    const registry = new TaskRegistry();
    const fn = () => {};
    const def = registry.register("t", { desc: "d" }, fn);
    expect(def.name).toBe("t");
    expect(def.fn).toBe(fn);
    expect(def.options).toEqual({ desc: "d" });
    expect(registry.get("t")).toBe(def);
  });
});

describe("TaskRegistry.registerCron", () => {
  test("スケジュールと工程列を options.cron へ静的記述として保存する", () => {
    const registry = new TaskRegistry();
    const backup = registry.register(
      "backup",
      { desc: "バックアップ" },
      () => {},
    );

    const def = registry.registerCron(
      "nightly",
      { schedule: "0 3 * * *", desc: "毎晩バックアップ" },
      backup,
      ["bun", ["report.ts"]],
    );

    expect(def.name).toBe("nightly");
    expect(def.isMeta).toBe(false);
    expect(def.options?.desc).toBe("毎晩バックアップ");
    expect(def.options?.cron).toEqual({
      schedule: "0 3 * * *",
      steps: [
        { kind: "task", name: "backup", desc: "バックアップ" },
        { kind: "command", label: "bun report.ts" },
      ],
    });
    // schedule は cron 記述へ移し、TaskOptions 側には残さない
    expect(
      (def.options as Record<string, unknown> | undefined)?.schedule,
    ).toBeUndefined();
  });

  test("登録時には cron 式を検証しない（検証は parseSchedule に一本化）", () => {
    const registry = new TaskRegistry();
    expect(() =>
      registry.registerCron("bad", { schedule: "not a cron" }),
    ).not.toThrow();
  });

  test("同名タスクの二重登録はエラー", () => {
    const registry = new TaskRegistry();
    registry.register("dup", () => {});
    expect(() => registry.registerCron("dup", { schedule: "@daily" })).toThrow(
      DuplicateTaskError,
    );
  });
});
