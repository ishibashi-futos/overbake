import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { discoverBakefile } from "../src/bakefile/discover.ts";
import { loadBakefile } from "../src/bakefile/loader.ts";
import { TaskRegistry } from "../src/bakefile/registry.ts";
import { parseArgs } from "../src/cli/args.ts";
import { main } from "../src/cli/main.ts";
import { resolveTasks } from "../src/graph/resolver.ts";
import { init } from "../src/init/init.ts";
import {
  BakefileNotFoundError,
  CircularDependencyError,
  DuplicateTaskError,
  TaskNotFoundError,
} from "../src/shared/errors.ts";

describe("parseArgs", () => {
  test('parses "init" command', () => {
    const result = parseArgs(["init"]);
    expect(result.type).toBe("init");
  });

  test("parses run command with task name", () => {
    const result = parseArgs(["build"]);
    expect(result.type).toBe("run");
    if (result.type === "run") {
      expect(result.taskName).toBe("build");
    }
  });

  test("throws error when no command provided", () => {
    expect(() => parseArgs([])).toThrow("No command provided");
  });
});

describe("discoverBakefile", () => {
  let originalCwd: string;
  let tempDir: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tempDir = resolve("/tmp", `overbake-test-${Date.now()}-${Math.random()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true });
    }
  });

  test("finds Bakefile.ts in current directory", () => {
    const bakefilePath = resolve(tempDir, "Bakefile.ts");
    writeFileSync(bakefilePath, "// test");

    process.chdir(tempDir);
    const result = discoverBakefile();
    expect(realpathSync(result)).toBe(realpathSync(bakefilePath));
  });

  test("searches upward for Bakefile.ts", () => {
    const bakefilePath = resolve(tempDir, "Bakefile.ts");
    writeFileSync(bakefilePath, "// test");

    const subDir = resolve(tempDir, "sub", "deep");
    mkdirSync(subDir, { recursive: true });

    process.chdir(subDir);
    const result = discoverBakefile();
    expect(realpathSync(result)).toBe(realpathSync(bakefilePath));
  });

  test("throws BakefileNotFoundError when Bakefile.ts does not exist", () => {
    process.chdir(tempDir);
    expect(() => discoverBakefile()).toThrow(BakefileNotFoundError);
  });
});

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
});

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
});

describe("loadBakefile", () => {
  let originalCwd: string;
  let tempDir: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tempDir = resolve("/tmp", `overbake-test-${Date.now()}-${Math.random()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true });
    }
  });

  test("restores globalThis.task after successful import", async () => {
    const bakefilePath = resolve(tempDir, "test-bakefile.ts");
    writeFileSync(bakefilePath, 'export default "test";');

    const registry = new TaskRegistry();

    const taskBeforeLoad = (globalThis as Record<string, unknown>).task;

    await loadBakefile(bakefilePath, registry);

    // loadBakefile should restore task to its original value after import
    expect((globalThis as Record<string, unknown>).task).toBe(taskBeforeLoad);
  });

  test("restores globalThis.task even if import fails", async () => {
    const bakefilePath = resolve(tempDir, "broken-bakefile.ts");
    writeFileSync(bakefilePath, "throw new Error('import error');");

    const registry = new TaskRegistry();

    const taskBeforeLoad = (globalThis as Record<string, unknown>).task;

    try {
      await loadBakefile(bakefilePath, registry);
    } catch {
      // expected
    }

    // loadBakefile should restore task even on error
    expect((globalThis as Record<string, unknown>).task).toBe(taskBeforeLoad);
  });

  test("registers tasks via injected task function", async () => {
    const bakefilePath = resolve(tempDir, "test-bakefile.ts");
    writeFileSync(
      bakefilePath,
      `task("mytask", { desc: "Test" }, () => {
        console.log("executed");
      });`,
    );

    const registry = new TaskRegistry();
    await loadBakefile(bakefilePath, registry);

    const task = registry.get("mytask");
    expect(task).toBeDefined();
    expect(task?.name).toBe("mytask");
    expect(task?.options?.desc).toBe("Test");
  });
});

describe("init", () => {
  let originalCwd: string;
  let tempDir: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tempDir = resolve("/tmp", `overbake-test-${Date.now()}-${Math.random()}`);
    mkdirSync(tempDir, { recursive: true });
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true });
    }
  });

  test("creates Bakefile.ts and Bakefile.d.ts", async () => {
    await init();

    expect(existsSync("Bakefile.ts")).toBe(true);
    expect(existsSync("Bakefile.d.ts")).toBe(true);
  });

  test("throws error if Bakefile.ts already exists", async () => {
    writeFileSync("Bakefile.ts", "// existing");

    expect(async () => {
      await init();
    }).toThrow();
  });

  test("throws error if Bakefile.d.ts already exists", async () => {
    writeFileSync("Bakefile.d.ts", "// existing");

    expect(async () => {
      await init();
    }).toThrow();
  });

  test("generated Bakefile.ts contains triple-slash reference", async () => {
    await init();

    const content = readFileSync("Bakefile.ts", "utf-8");
    expect(content).toContain('/// <reference path="./Bakefile.d.ts" />');
  });

  test("generated Bakefile.d.ts declares task function", async () => {
    await init();

    const content = readFileSync("Bakefile.d.ts", "utf-8");
    expect(content).toContain("declare function task");
  });
});

describe("CLI integration", () => {
  let originalCwd: string;
  let tempDir: string;
  let logs: string[] = [];
  let originalLog: typeof console.log;

  beforeEach(() => {
    originalCwd = process.cwd();
    tempDir = resolve("/tmp", `overbake-test-${Date.now()}-${Math.random()}`);
    mkdirSync(tempDir, { recursive: true });
    process.chdir(tempDir);

    logs = [];
    originalLog = console.log;
    console.log = (...args: string[]) => {
      logs.push(args.join(" "));
      originalLog(...args);
    };
  });

  afterEach(() => {
    console.log = originalLog;
    process.chdir(originalCwd);
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true });
    }
  });

  test("executes tasks in dependency order", async () => {
    const bakefileContent = `
task("a", () => {
  console.log("task a");
});

task("b", { deps: ["a"] }, () => {
  console.log("task b");
});

task("c", { deps: ["b"] }, () => {
  console.log("task c");
});
`;

    writeFileSync("Bakefile.ts", bakefileContent);

    await main(["c"]);

    const taskLogs = logs.filter((log) => log.startsWith("task"));
    expect(taskLogs).toContain("task a");
    expect(taskLogs).toContain("task b");
    expect(taskLogs).toContain("task c");

    const aIdx = taskLogs.indexOf("task a");
    const bIdx = taskLogs.indexOf("task b");
    const cIdx = taskLogs.indexOf("task c");

    expect(aIdx).toBeLessThan(bIdx);
    expect(bIdx).toBeLessThan(cIdx);
  });

  test("init command creates files", async () => {
    await main(["init"]);

    expect(existsSync("Bakefile.ts")).toBe(true);
    expect(existsSync("Bakefile.d.ts")).toBe(true);
  });

  test("task receives TaskContext with required properties", async () => {
    const bakefileContent = `
task("contexted", (ctx) => {
  // Context is passed to the task function
});
`;

    writeFileSync("Bakefile.ts", bakefileContent);

    const bakefilePath = resolve(tempDir, "Bakefile.ts");
    const registry = new TaskRegistry();
    await loadBakefile(bakefilePath, registry);
    const task = registry.get("contexted");
    expect(task).toBeDefined();
    if (task) {
      const { createTaskContext } = await import("../src/runtime/executor.ts");
      const ctx = createTaskContext({ name: "contexted", root: tempDir });
      await task.fn(ctx);

      expect(ctx.name).toBe("contexted");
      expect(ctx.root).toBe(tempDir);
      expect(typeof ctx.cmd).toBe("function");
      expect(typeof ctx.rm).toBe("function");
      expect(typeof ctx.exists).toBe("function");
      expect(typeof ctx.resolve).toBe("function");
      expect(typeof ctx.log).toBe("function");
    }
  });

  test("ctx.cmd executes command successfully", async () => {
    const bakefileContent = `
task("run-cmd", async (ctx) => {
  await ctx.cmd("echo", ["test"]);
});
`;

    writeFileSync("Bakefile.ts", bakefileContent);

    const bakefilePath = resolve(tempDir, "Bakefile.ts");
    const registry = new TaskRegistry();
    await loadBakefile(bakefilePath, registry);
    const task = registry.get("run-cmd");
    expect(task).toBeDefined();
    if (task) {
      const { createTaskContext } = await import("../src/runtime/executor.ts");
      const ctx = createTaskContext({ name: "run-cmd", root: tempDir });
      // Should not throw
      await task.fn(ctx);
    }
  });

  test("ctx.rm removes files with root as base", async () => {
    const subDir = resolve(tempDir, "subdir");
    mkdirSync(subDir, { recursive: true });
    const testFile = resolve(subDir, "test.txt");
    writeFileSync(testFile, "test content");

    expect(existsSync(testFile)).toBe(true);

    const { createTaskContext } = await import("../src/runtime/executor.ts");
    const ctx = createTaskContext({ name: "test", root: tempDir });
    await ctx.rm("subdir", { recursive: true });

    expect(existsSync(subDir)).toBe(false);
  });

  test("ctx.exists checks file existence relative to root", async () => {
    const subDir = resolve(tempDir, "check-dir");
    mkdirSync(subDir, { recursive: true });
    const testFile = resolve(subDir, "exists.txt");
    writeFileSync(testFile, "test");

    const { createTaskContext } = await import("../src/runtime/executor.ts");
    const ctx = createTaskContext({ name: "test", root: tempDir });

    expect(ctx.exists("check-dir/exists.txt")).toBe(true);
    expect(ctx.exists("nonexistent.txt")).toBe(false);
  });

  test("ctx.resolve returns absolute path relative to root", async () => {
    const { createTaskContext } = await import("../src/runtime/executor.ts");
    const ctx = createTaskContext({ name: "test", root: tempDir });

    const resolved = ctx.resolve("subdir", "file.txt");
    expect(resolved).toBe(resolve(tempDir, "subdir", "file.txt"));
  });

  test("ctx.cwd is user's working directory, ctx.root is Bakefile directory", async () => {
    const bakefileContent = `
task("check-paths", (ctx) => {
  globalThis.capturedCwd = ctx.cwd;
  globalThis.capturedRoot = ctx.root;
});
`;
    writeFileSync("Bakefile.ts", bakefileContent);

    const subDir = resolve(tempDir, "work");
    mkdirSync(subDir, { recursive: true });
    process.chdir(subDir);

    const g = globalThis as Record<string, unknown>;
    await main(["check-paths"]);

    expect(realpathSync(g.capturedCwd as string)).toBe(realpathSync(subDir));
    expect(realpathSync(g.capturedRoot as string)).toBe(realpathSync(tempDir));
  });
});
