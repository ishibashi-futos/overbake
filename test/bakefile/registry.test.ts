import { describe, expect, test } from "bun:test";
import { TaskRegistry } from "../../src/bakefile/registry.ts";
import {
  DuplicateDefaultTaskError,
  DuplicateTaskError,
} from "../../src/shared/errors.ts";

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
