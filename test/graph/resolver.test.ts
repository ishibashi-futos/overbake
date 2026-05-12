import { describe, expect, test } from "bun:test";
import {
  expandWildcardTargets,
  resolveTasks,
} from "../../src/graph/resolver.ts";
import {
  CircularDependencyError,
  TaskNotFoundError,
  WildcardNoMatchError,
} from "../../src/shared/errors.ts";

describe("resolveTasks", () => {
  test("resolves single task without dependencies", () => {
    const tasks = [{ name: "test", fn: () => {}, options: {} }];
    const result = resolveTasks("test", tasks);

    expect(result.length).toBe(1);
    expect(result[0]?.name).toBe("test");
  });

  test("resolves tasks in dependency order", () => {
    const tasks = [
      { name: "a", fn: () => {}, options: {} },
      { name: "b", fn: () => {}, options: { deps: ["a"] } },
      { name: "c", fn: () => {}, options: { deps: ["b"] } },
    ];

    const result = resolveTasks("c", tasks);

    expect(result.map((t) => t.name)).toEqual(["a", "b", "c"]);
  });

  test("handles multiple dependencies", () => {
    const tasks = [
      { name: "a", fn: () => {}, options: {} },
      { name: "b", fn: () => {}, options: {} },
      { name: "c", fn: () => {}, options: { deps: ["a", "b"] } },
    ];

    const result = resolveTasks("c", tasks);
    const names = result.map((t) => t.name);

    expect(names).toContain("a");
    expect(names).toContain("b");
    const aIdx = names.indexOf("a");
    const bIdx = names.indexOf("b");
    const cIdx = names.indexOf("c");
    expect(aIdx).toBeGreaterThanOrEqual(0);
    expect(bIdx).toBeGreaterThanOrEqual(0);
    expect(cIdx).toBeGreaterThanOrEqual(0);
    expect(aIdx).toBeLessThan(cIdx);
    expect(bIdx).toBeLessThan(cIdx);
  });

  test("throws TaskNotFoundError for undefined dependency", () => {
    const tasks = [{ name: "a", fn: () => {}, options: { deps: ["missing"] } }];

    expect(() => resolveTasks("a", tasks)).toThrow(TaskNotFoundError);
  });

  test("throws CircularDependencyError for circular dependencies", () => {
    const tasks = [
      { name: "a", fn: () => {}, options: { deps: ["b"] } },
      { name: "b", fn: () => {}, options: { deps: ["a"] } },
    ];

    expect(() => resolveTasks("a", tasks)).toThrow(CircularDependencyError);
  });

  test("throws TaskNotFoundError when target task not found", () => {
    const tasks = [{ name: "a", fn: () => {}, options: {} }];

    expect(() => resolveTasks("missing", tasks)).toThrow(TaskNotFoundError);
  });

  test("resolves multiple targets with shared dependencies", () => {
    const tasks = [
      { name: "clean", fn: () => {}, options: {} },
      { name: "build", fn: () => {}, options: { deps: ["clean"] } },
      { name: "test", fn: () => {}, options: { deps: ["clean"] } },
    ];

    const result = resolveTasks(["build", "test"], tasks);
    const names = result.map((t) => t.name);

    // clean should appear only once
    expect(names.filter((n) => n === "clean").length).toBe(1);
    expect(names).toContain("build");
    expect(names).toContain("test");

    const cleanIdx = names.indexOf("clean");
    const buildIdx = names.indexOf("build");
    const testIdx = names.indexOf("test");

    // clean should come before both build and test
    expect(cleanIdx).toBeLessThan(buildIdx);
    expect(cleanIdx).toBeLessThan(testIdx);
  });

  test("resolves multiple independent targets in order", () => {
    const tasks = [
      { name: "a", fn: () => {}, options: {} },
      { name: "b", fn: () => {}, options: {} },
      { name: "c", fn: () => {}, options: {} },
    ];

    const result = resolveTasks(["a", "b", "c"], tasks);
    const names = result.map((t) => t.name);

    expect(names).toEqual(["a", "b", "c"]);
  });

  test("throws TaskNotFoundError when any target is not found", () => {
    const tasks = [
      { name: "a", fn: () => {}, options: {} },
      { name: "b", fn: () => {}, options: {} },
    ];

    expect(() => resolveTasks(["a", "missing"], tasks)).toThrow(
      TaskNotFoundError,
    );
  });
});

// issue #21: ネームスペース + ワイルドカード実行
describe("issue #21: expandWildcardTargets", () => {
  const tasks = [
    { name: "build:frontend", fn: () => {}, options: {} },
    { name: "build:backend", fn: () => {}, options: {} },
    { name: "lint:js", fn: () => {}, options: {} },
    { name: "lint:css", fn: () => {}, options: {} },
    { name: "clean", fn: () => {}, options: {} },
  ];

  test("ワイルドカードなしのパターンはそのまま返す", () => {
    const result = expandWildcardTargets(["build:frontend"], tasks);
    expect(result).toEqual(["build:frontend"]);
  });

  test("build:* は build: で始まるタスクを全部展開する", () => {
    const result = expandWildcardTargets(["build:*"], tasks);
    expect(result).toEqual(["build:frontend", "build:backend"]);
  });

  test("lint:* は lint: で始まるタスクを全部展開する", () => {
    const result = expandWildcardTargets(["lint:*"], tasks);
    expect(result).toEqual(["lint:js", "lint:css"]);
  });

  test("* は全タスクを展開する", () => {
    const result = expandWildcardTargets(["*"], tasks);
    expect(result).toHaveLength(tasks.length);
  });

  test("ワイルドカードと通常名の混在", () => {
    const result = expandWildcardTargets(["build:*", "clean"], tasks);
    expect(result).toContain("build:frontend");
    expect(result).toContain("build:backend");
    expect(result).toContain("clean");
  });

  test("0 件マッチは WildcardNoMatchError をスロー", () => {
    expect(() => expandWildcardTargets(["nonexistent:*"], tasks)).toThrow(
      WildcardNoMatchError,
    );
  });

  test("0 件マッチのエラーはパターン名を含む", () => {
    let error: unknown;
    try {
      expandWildcardTargets(["xyz:*"], tasks);
    } catch (e) {
      error = e;
    }
    expect(error instanceof WildcardNoMatchError).toBe(true);
    if (error instanceof Error) {
      expect(error.message).toContain("xyz:*");
    }
  });
});
