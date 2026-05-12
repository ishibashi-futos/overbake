import { describe, expect, test } from "bun:test";
import { TaskRegistry } from "../../src/bakefile/registry.ts";
import {
  DuplicateDefaultTaskError,
  DuplicateTaskError,
} from "../../src/shared/errors.ts";
import type { TaskContext } from "../../src/types.ts";

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
