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
  buildPlan,
  createTaskContext,
  executePlan,
  printDryRun,
  printExplain,
} from "../src/runtime/executor.ts";
import { runWithHooks } from "../src/runtime/hooks.ts";
import {
  BakefileNotFoundError,
  CircularDependencyError,
  DuplicateDefaultTaskError,
  DuplicateTaskError,
  TaskNotFoundError,
} from "../src/shared/errors.ts";
import {
  renderGlobalHelp,
  renderTaskHelp,
  renderTaskList,
  renderTaskNotFound,
} from "../src/ui/help.ts";
import { collectWatchPaths, startWatch } from "../src/watch/watcher.ts";

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

  test("returns default command when no args provided", () => {
    const result = parseArgs([]);
    expect(result.type).toBe("default");
    if (result.type === "default") {
      expect(result.flags.dryRun).toBe(false);
      expect(result.flags.explain).toBe(false);
      expect(result.flags.watch).toBe(false);
    }
  });

  test("--dry-run フラグを解析する", () => {
    const result = parseArgs(["build", "--dry-run"]);
    expect(result.type).toBe("run");
    if (result.type === "run") {
      expect(result.flags.dryRun).toBe(true);
      expect(result.flags.explain).toBe(false);
      expect(result.flags.watch).toBe(false);
    }
  });

  test("--explain フラグを解析する", () => {
    const result = parseArgs(["build", "--explain"]);
    expect(result.type).toBe("run");
    if (result.type === "run") {
      expect(result.flags.explain).toBe(true);
      expect(result.flags.dryRun).toBe(false);
      expect(result.flags.watch).toBe(false);
    }
  });

  test("--watch フラグを解析する", () => {
    const result = parseArgs(["build", "--watch"]);
    expect(result.type).toBe("run");
    if (result.type === "run") {
      expect(result.flags.watch).toBe(true);
      expect(result.flags.dryRun).toBe(false);
      expect(result.flags.explain).toBe(false);
    }
  });

  test("フラグなしは全て false", () => {
    const result = parseArgs(["build"]);
    if (result.type === "run") {
      expect(result.flags.dryRun).toBe(false);
      expect(result.flags.explain).toBe(false);
      expect(result.flags.watch).toBe(false);
    }
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

  test("sets default task via task.default()", async () => {
    const bakefilePath = resolve(tempDir, "test-bakefile.ts");
    writeFileSync(
      bakefilePath,
      `task("build", () => {});
task.default("build");`,
    );

    const registry = new TaskRegistry();
    await loadBakefile(bakefilePath, registry);

    expect(registry.getDefault()).toBe("build");
  });

  test("throws DuplicateDefaultTaskError when default called twice", async () => {
    const bakefilePath = resolve(tempDir, "test-bakefile.ts");
    writeFileSync(
      bakefilePath,
      `task("build", () => {});
task("clean", () => {});
task.default("build");
task.default("clean");`,
    );

    const registry = new TaskRegistry();

    expect(async () => {
      await loadBakefile(bakefilePath, registry);
    }).toThrow();
  });

  test("restores globalThis.task.default after successful import", async () => {
    const bakefilePath = resolve(tempDir, "test-bakefile.ts");
    writeFileSync(bakefilePath, 'export default "test";');

    const registry = new TaskRegistry();

    const taskBeforeLoad = (globalThis as Record<string, unknown>).task;

    await loadBakefile(bakefilePath, registry);

    // task.default should be restored
    expect((globalThis as Record<string, unknown>).task).toBe(taskBeforeLoad);
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

  test("generated Bakefile.d.ts declares task.default function", async () => {
    await init();

    const content = readFileSync("Bakefile.d.ts", "utf-8");
    expect(content).toContain("function default");
    expect(content).toContain("declare namespace task");
  });
});

describe("CLI integration", () => {
  let originalCwd: string;
  let tempDir: string;
  let logs: string[] = [];
  let errors: string[] = [];
  let originalLog: typeof console.log;
  let originalError: typeof console.error;
  let originalExit: typeof process.exit;

  beforeEach(() => {
    originalCwd = process.cwd();
    tempDir = resolve("/tmp", `overbake-test-${Date.now()}-${Math.random()}`);
    mkdirSync(tempDir, { recursive: true });
    process.chdir(tempDir);

    logs = [];
    errors = [];
    originalLog = console.log;
    originalError = console.error;
    originalExit = process.exit;

    console.log = (...args: string[]) => {
      logs.push(args.join(" "));
      originalLog(...args);
    };

    console.error = (...args: string[]) => {
      errors.push(args.join(" "));
    };

    (process.exit as unknown) = () => {
      // mock: do nothing
    };
  });

  afterEach(() => {
    console.log = originalLog;
    console.error = originalError;
    process.exit = originalExit;
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

  test("default task execution with task.default()", async () => {
    const bakefileContent = `
task("build", () => {
  console.log("build executed");
});

task("clean", () => {
  console.log("clean executed");
});

task.default("build");
`;

    writeFileSync("Bakefile.ts", bakefileContent);

    await main([]);

    const taskLogs = logs.filter((log) => log.includes("executed"));
    expect(taskLogs).toContain("build executed");
    expect(taskLogs).not.toContain("clean executed");
  });

  test("bake with no args shows task list when no default", async () => {
    const bakefileContent = `
task("build", { desc: "Build project" }, () => {});
task("clean", { desc: "Clean build" }, () => {});
`;

    writeFileSync("Bakefile.ts", bakefileContent);

    await main([]);

    const output = logs.join("\n");
    expect(output).toContain("build");
    expect(output).toContain("clean");
  });

  test("default task respects --dry-run flag", async () => {
    const bakefileContent = `
task("mytask", () => {
  globalThis.__defaultDryRunCalled = true;
});

task.default("mytask");
`;

    writeFileSync("Bakefile.ts", bakefileContent);

    const g = globalThis as Record<string, unknown>;
    g.__defaultDryRunCalled = false;
    await main(["--dry-run"]);
    expect(g.__defaultDryRunCalled).toBe(false);
  });

  test("default task respects --explain flag", async () => {
    const bakefileContent = `
task("explained", { desc: "Task for explain" }, () => {
  globalThis.__defaultExplainCalled = true;
});

task.default("explained");
`;

    writeFileSync("Bakefile.ts", bakefileContent);

    const g = globalThis as Record<string, unknown>;
    g.__defaultExplainCalled = false;
    await main(["--explain"]);
    expect(g.__defaultExplainCalled).toBe(false);
  });
});

describe("dry-run / explain", () => {
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

  test("printDryRun はタスク名を出力しタスク関数を実行しない", async () => {
    writeFileSync(
      resolve(tempDir, "Bakefile.ts"),
      `task("a", () => {}); task("b", { deps: ["a"] }, () => {});`,
    );
    const plan = await buildPlan("b");
    const lines: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => lines.push(a.join(" "));
    printDryRun(plan);
    console.log = orig;
    expect(lines.some((l) => l.includes("a"))).toBe(true);
    expect(lines.some((l) => l.includes("b"))).toBe(true);
  });

  test("printExplain は desc/deps/inputs/outputs/env を出力しタスク関数を実行しない", async () => {
    writeFileSync(
      resolve(tempDir, "Bakefile.ts"),
      `task("build", { desc: "compile", deps: [], inputs: ["src/**"], outputs: ["dist"], env: ["NODE_ENV"] }, () => {});`,
    );
    const plan = await buildPlan("build");
    const lines: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => lines.push(a.join(" "));
    printExplain(plan);
    console.log = orig;
    expect(lines.some((l) => l.includes("compile"))).toBe(true);
    expect(lines.some((l) => l.includes("src/**"))).toBe(true);
    expect(lines.some((l) => l.includes("dist"))).toBe(true);
    expect(lines.some((l) => l.includes("NODE_ENV"))).toBe(true);
  });

  test("main --dry-run はタスク関数を呼ばない", async () => {
    writeFileSync(
      resolve(tempDir, "Bakefile.ts"),
      `task("mytask", () => { globalThis.__dryRunCalled = true; });`,
    );
    const g = globalThis as Record<string, unknown>;
    g.__dryRunCalled = false;
    await main(["mytask", "--dry-run"]);
    expect(g.__dryRunCalled).toBe(false);
  });

  test("main --explain はタスク関数を呼ばない", async () => {
    writeFileSync(
      resolve(tempDir, "Bakefile.ts"),
      `task("mytask", () => { globalThis.__explainCalled = true; });`,
    );
    const g = globalThis as Record<string, unknown>;
    g.__explainCalled = false;
    await main(["mytask", "--explain"]);
    expect(g.__explainCalled).toBe(false);
  });
});

describe("collectWatchPaths", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = resolve(
      "/tmp",
      `overbake-watch-test-${Date.now()}-${Math.random()}`,
    );
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true });
    }
  });

  test("inputs が指定されている場合は絶対パス化して返す", () => {
    const srcDir = resolve(tempDir, "src");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(resolve(srcDir, "a.ts"), "");
    writeFileSync(resolve(srcDir, "b.ts"), "");

    const bakefilePath = resolve(tempDir, "Bakefile.ts");
    const tasks = [
      {
        name: "a",
        fn: () => {},
        options: { inputs: ["src/a.ts", "src/b.ts"] },
      },
      {
        name: "b",
        fn: () => {},
        options: { inputs: ["src/b.ts", "src/c.ts"] },
      },
    ];
    const result = collectWatchPaths(tasks, bakefilePath);

    // 相対パスが絶対パスに変換される
    expect(result).toContain(srcDir);
    expect(result.every((p) => p.startsWith("/"))).toBe(true);
  });

  test("inputs が全タスクで未指定なら Bakefile.ts を返す", () => {
    const bakefilePath = resolve(tempDir, "Bakefile.ts");
    writeFileSync(bakefilePath, "");

    const tasks = [
      { name: "a", fn: () => {}, options: {} },
      { name: "b", fn: () => {}, options: {} },
    ];
    const result = collectWatchPaths(tasks, bakefilePath);
    expect(result).toEqual([bakefilePath]);
  });

  test("inputs の重複は除去される", () => {
    const srcDir = resolve(tempDir, "src");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(resolve(srcDir, "shared.ts"), "");

    const bakefilePath = resolve(tempDir, "Bakefile.ts");
    const tasks = [
      { name: "a", fn: () => {}, options: { inputs: ["src/shared.ts"] } },
      { name: "b", fn: () => {}, options: { inputs: ["src/shared.ts"] } },
    ];
    const result = collectWatchPaths(tasks, bakefilePath);
    expect(result.length).toBe(1);
    expect(result[0]).toBe(srcDir);
  });

  test("glob パターン src/**/*.ts は src ディレクトリを監視対象にする", () => {
    const srcDir = resolve(tempDir, "src");
    mkdirSync(srcDir, { recursive: true });

    const bakefilePath = resolve(tempDir, "Bakefile.ts");
    const tasks = [
      { name: "build", fn: () => {}, options: { inputs: ["src/**/*.ts"] } },
    ];
    const result = collectWatchPaths(tasks, bakefilePath);

    expect(result).toEqual([srcDir]);
  });

  test("glob より前のディレクトリが存在しない場合はルートを監視対象にする", () => {
    const bakefilePath = resolve(tempDir, "Bakefile.ts");
    const tasks = [
      {
        name: "build",
        fn: () => {},
        options: { inputs: ["nonexistent/**/*.ts"] },
      },
    ];
    const result = collectWatchPaths(tasks, bakefilePath);

    expect(result).toEqual([tempDir]);
  });

  test("サブディレクトリから実行した場合も絶対パスで正規化される", () => {
    const srcDir = resolve(tempDir, "src");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(resolve(srcDir, "main.ts"), "");

    const bakefilePath = resolve(tempDir, "Bakefile.ts");
    writeFileSync(bakefilePath, "");

    const subDir = resolve(tempDir, "work");
    mkdirSync(subDir, { recursive: true });

    // サブディレクトリから実行すると仮定
    const originalCwd = process.cwd();
    process.chdir(subDir);

    const tasks = [
      { name: "build", fn: () => {}, options: { inputs: ["src/main.ts"] } },
    ];

    try {
      const result = collectWatchPaths(tasks, bakefilePath);

      // 相対パスの src/main.ts が bakefilePath ルート基準の /p/src に正規化される
      expect(result).toEqual([srcDir]);
      expect(result[0]).toStrictEqual(srcDir);
    } finally {
      process.chdir(originalCwd);
    }
  });
});

describe("startWatch", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = resolve(
      "/tmp",
      `overbake-watch-test-${Date.now()}-${Math.random()}`,
    );
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true });
    }
  });

  test("ファイル変更時に callback が呼ばれる", async () => {
    const file = resolve(tempDir, "watched.ts");
    writeFileSync(file, "initial");

    let callCount = 0;
    const stop = startWatch(
      [file],
      async () => {
        callCount++;
      },
      50,
    );

    writeFileSync(file, "changed");

    // debounce + ファイルシステムイベント待機
    await new Promise((r) => setTimeout(r, 200));
    stop();

    expect(callCount).toBeGreaterThanOrEqual(1);
  });

  test("stop() を呼ぶと以降の変更で callback が呼ばれない", async () => {
    const file = resolve(tempDir, "stopped.ts");
    writeFileSync(file, "initial");

    let callCount = 0;
    const stop = startWatch(
      [file],
      async () => {
        callCount++;
      },
      50,
    );
    stop();

    writeFileSync(file, "changed after stop");
    await new Promise((r) => setTimeout(r, 200));

    expect(callCount).toBe(0);
  });

  test("ネストされたディレクトリ内のファイル変更時に callback が呼ばれる", async () => {
    const srcDir = resolve(tempDir, "src");
    const nestedDir = resolve(srcDir, "nested");
    mkdirSync(nestedDir, { recursive: true });
    const nestedFile = resolve(nestedDir, "file.ts");
    writeFileSync(nestedFile, "initial");

    let callCount = 0;
    const stop = startWatch(
      [srcDir],
      async () => {
        callCount++;
      },
      50,
    );

    writeFileSync(nestedFile, "changed");

    // debounce + ファイルシステムイベント待機
    await new Promise((r) => setTimeout(r, 200));
    stop();

    expect(callCount).toBeGreaterThanOrEqual(1);
  });

  test("同じ plan を複数回実行できる（watch 再実行用）", async () => {
    const tempDir2 = resolve(
      "/tmp",
      `overbake-plan-reuse-${Date.now()}-${Math.random()}`,
    );
    mkdirSync(tempDir2, { recursive: true });

    const bakefileContent = `
task("step1", async (ctx) => {
  ctx.log("step1 done");
});

task("step2", { deps: ["step1"] }, async (ctx) => {
  ctx.log("step2 done");
});
`;

    const bakefilePath = resolve(tempDir2, "Bakefile.ts");
    writeFileSync(bakefilePath, bakefileContent);

    const originalCwd = process.cwd();
    process.chdir(tempDir2);

    const logs: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => logs.push(a.join(" "));

    try {
      const plan = await buildPlan("step2");

      // plan を複数回実行できることを確認
      // 初回実行
      await executePlan(plan);
      const firstRunLogs = logs.length;

      // 再実行
      await executePlan(plan);
      const secondRunLogs = logs.length - firstRunLogs;

      // 両回で同じタスク数が実行されることを確認
      expect(secondRunLogs).toBe(firstRunLogs);

      // 各ステップが複数回実行されたことを確認
      const step1Logs = logs.filter((l) => l.includes("step1 done"));
      const step2Logs = logs.filter((l) => l.includes("step2 done"));

      expect(step1Logs.length).toBeGreaterThanOrEqual(2);
      expect(step2Logs.length).toBeGreaterThanOrEqual(2);
    } finally {
      console.log = orig;
      process.chdir(originalCwd);
      if (existsSync(tempDir2)) {
        rmSync(tempDir2, { recursive: true });
      }
    }
  });
});

describe("runWithHooks / executePlan / TaskRegistry before/after hooks", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = resolve(
      "/tmp",
      `overbake-hooks-test-${Date.now()}-${Math.random()}`,
    );
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true });
    }
  });

  test("before -> fn -> after の実行順序を検証", async () => {
    const callOrder: string[] = [];

    const task = {
      name: "ordered",
      fn: async () => {
        callOrder.push("fn");
      },
      isMeta: false,
      options: {
        before: async () => {
          callOrder.push("before");
        },
        after: async () => {
          callOrder.push("after");
        },
      },
    };

    const ctx = createTaskContext({
      name: "ordered",
      root: tempDir,
      cwd: tempDir,
    });

    await runWithHooks(task, ctx);

    expect(callOrder).toEqual(["before", "fn", "after"]);
  });

  test("fn 失敗時 after で ok:false、その後元エラーが伝播する", async () => {
    const hookCalls: Array<{ phase: string; ok?: boolean }> = [];
    const testError = new Error("fn failed");

    const task = {
      name: "failing",
      fn: async () => {
        throw testError;
      },
      isMeta: false,
      options: {
        before: async () => {
          hookCalls.push({ phase: "before" });
        },
        after: async ({
          ok,
        }: {
          ok: boolean;
          durationMs: number;
          name: string;
        }) => {
          hookCalls.push({ phase: "after", ok });
        },
      },
    };

    const ctx = createTaskContext({
      name: "failing",
      root: tempDir,
      cwd: tempDir,
    });

    let caughtError: unknown;
    try {
      await runWithHooks(task, ctx);
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBe(testError);
    expect(hookCalls).toEqual([
      { phase: "before" },
      { phase: "after", ok: false },
    ]);
  });

  test("after に durationMs が数値で渡される", async () => {
    let capturedDuration: number | undefined;

    const task = {
      name: "timed",
      fn: async () => {
        await new Promise((r) => setTimeout(r, 10));
      },
      isMeta: false,
      options: {
        after: async ({
          durationMs,
        }: {
          ok: boolean;
          durationMs: number;
          name: string;
        }) => {
          capturedDuration = durationMs;
        },
      },
    };

    const ctx = createTaskContext({
      name: "timed",
      root: tempDir,
      cwd: tempDir,
    });

    await runWithHooks(task, ctx);

    expect(typeof capturedDuration).toBe("number");
    expect(capturedDuration).toBeGreaterThanOrEqual(10);
  });

  test("before 失敗時に fn と after を呼ばない", async () => {
    const callLog: string[] = [];
    const beforeError = new Error("before failed");

    const task = {
      name: "before-fails",
      fn: async () => {
        callLog.push("fn");
      },
      isMeta: false,
      options: {
        before: async () => {
          callLog.push("before");
          throw beforeError;
        },
        after: async () => {
          callLog.push("after");
        },
      },
    };

    const ctx = createTaskContext({
      name: "before-fails",
      root: tempDir,
      cwd: tempDir,
    });

    let caughtError: unknown;
    try {
      await runWithHooks(task, ctx);
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBe(beforeError);
    expect(callLog).toEqual(["before"]);
  });

  test("fn なしメタタスク (isMeta=true) は hooks を呼ばない", async () => {
    const hookCalls: string[] = [];

    const task = {
      name: "meta",
      fn: async () => {
        hookCalls.push("fn");
      },
      isMeta: true,
      options: {
        before: async () => {
          hookCalls.push("before");
        },
        after: async () => {
          hookCalls.push("after");
        },
      },
    };

    const ctx = createTaskContext({
      name: "meta",
      root: tempDir,
      cwd: tempDir,
    });

    await runWithHooks(task, ctx);

    expect(hookCalls.length).toBe(0);
  });

  test("executePlan で複数タスクの hooks が各タスク単位で実行される", async () => {
    const bakefileContent = `
task("task-a", {
  before: async (ctx) => {
    globalThis.__hookLog.push('a-before');
  },
  after: async (ctx) => {
    globalThis.__hookLog.push('a-after');
  },
}, async () => {
  globalThis.__hookLog.push('a-fn');
});

task("task-b", {
  deps: ["task-a"],
  before: async (ctx) => {
    globalThis.__hookLog.push('b-before');
  },
  after: async (ctx) => {
    globalThis.__hookLog.push('b-after');
  },
}, async () => {
  globalThis.__hookLog.push('b-fn');
});
`;

    writeFileSync(resolve(tempDir, "Bakefile.ts"), bakefileContent);

    const g = globalThis as Record<string, unknown>;
    g.__hookLog = [];

    const originalCwd = process.cwd();
    process.chdir(tempDir);

    try {
      const plan = await buildPlan("task-b");
      await executePlan(plan);

      const hookLog = g.__hookLog as string[];
      expect(hookLog).toEqual([
        "a-before",
        "a-fn",
        "a-after",
        "b-before",
        "b-fn",
        "b-after",
      ]);
    } finally {
      process.chdir(originalCwd);
      delete g.__hookLog;
    }
  });

  test("TaskRegistry メタタスク (options のみで fn なし) は isMeta=true", () => {
    const registry = new TaskRegistry();
    registry.register("group", { desc: "Group task", deps: ["task1"] });

    const task = registry.get("group");
    expect(task?.isMeta).toBe(true);
    expect(typeof task?.fn).toBe("function");
  });
});

describe("parseArgs - list/help commands", () => {
  test("parses 'list' command", () => {
    const result = parseArgs(["list"]);
    expect(result.type).toBe("list");
  });

  test("parses '-l' as list command", () => {
    const result = parseArgs(["-l"]);
    expect(result.type).toBe("list");
  });

  test("parses '--help' without task name", () => {
    const result = parseArgs(["--help"]);
    expect(result.type).toBe("help");
    if (result.type === "help") {
      expect(result.taskName).toBeUndefined();
    }
  });

  test("parses '--help <taskname>' as help with task", () => {
    const result = parseArgs(["--help", "build"]);
    expect(result.type).toBe("help");
    if (result.type === "help") {
      expect(result.taskName).toBe("build");
    }
  });

  test("parses task --help as help with task", () => {
    const result = parseArgs(["build", "--help"]);
    expect(result.type).toBe("help");
    if (result.type === "help") {
      expect(result.taskName).toBe("build");
    }
  });

  test("parses default command with --dry-run flag", () => {
    const result = parseArgs(["--dry-run"]);
    expect(result.type).toBe("default");
    if (result.type === "default") {
      expect(result.flags.dryRun).toBe(true);
    }
  });

  test("parses default command with --explain flag", () => {
    const result = parseArgs(["--explain"]);
    expect(result.type).toBe("default");
    if (result.type === "default") {
      expect(result.flags.explain).toBe(true);
    }
  });

  test("parses default command with --watch flag", () => {
    const result = parseArgs(["--watch"]);
    expect(result.type).toBe("default");
    if (result.type === "default") {
      expect(result.flags.watch).toBe(true);
    }
  });
});

describe("UI help rendering", () => {
  test("renderTaskList shows task names and descriptions", () => {
    const tasks = [
      { name: "build", fn: () => {}, options: { desc: "Build the project" } },
      { name: "test", fn: () => {}, options: { desc: "Run tests" } },
    ];
    const output = renderTaskList(tasks);
    expect(output).toContain("build");
    expect(output).toContain("Build the project");
    expect(output).toContain("test");
    expect(output).toContain("Run tests");
  });

  test("renderTaskList handles empty task list", () => {
    const output = renderTaskList([]);
    expect(output).toBe("No tasks found.");
  });

  test("renderGlobalHelp shows usage and commands", () => {
    const output = renderGlobalHelp();
    expect(output).toContain("Usage:");
    expect(output).toContain("init");
    expect(output).toContain("list");
    expect(output).toContain("--help");
    expect(output).toContain("--dry-run");
  });

  test("renderTaskHelp shows task details", () => {
    const task = {
      name: "build",
      fn: () => {},
      options: {
        desc: "Build project",
        deps: ["setup"],
        inputs: ["src/**"],
        outputs: ["dist"],
        env: ["NODE_ENV"],
      },
    };
    const output = renderTaskHelp(task);
    expect(output).toContain("build");
    expect(output).toContain("Build project");
    expect(output).toContain("setup");
    expect(output).toContain("src/**");
    expect(output).toContain("dist");
    expect(output).toContain("NODE_ENV");
  });

  test("renderTaskNotFound suggests similar tasks", () => {
    const tasks = [
      { name: "build", fn: () => {}, options: {} },
      { name: "build-prod", fn: () => {}, options: {} },
      { name: "test", fn: () => {}, options: {} },
    ];
    const output = renderTaskNotFound("build-dev", tasks);
    expect(output).toContain("build-dev");
    expect(output).toContain("build-prod");
    expect(output).toContain("build");
  });

  test("renderTaskNotFound shows 'bake --help' when no suggestions", () => {
    const tasks = [
      { name: "build", fn: () => {}, options: {} },
      { name: "test", fn: () => {}, options: {} },
    ];
    const output = renderTaskNotFound("xyz", tasks);
    expect(output).toContain("Task not found: xyz");
    expect(output).toContain("bake --help");
    expect(output).not.toContain("bun bake");
  });
});

describe("CLI help/list integration", () => {
  let originalCwd: string;
  let tempDir: string;
  let logs: string[] = [];
  let errors: string[] = [];
  let originalLog: typeof console.log;
  let originalError: typeof console.error;

  beforeEach(() => {
    originalCwd = process.cwd();
    tempDir = resolve(
      "/tmp",
      `overbake-cli-test-${Date.now()}-${Math.random()}`,
    );
    mkdirSync(tempDir, { recursive: true });
    process.chdir(tempDir);

    logs = [];
    errors = [];
    originalLog = console.log;
    originalError = console.error;
    console.log = (...args: string[]) => {
      logs.push(args.join(" "));
      originalLog(...args);
    };
    console.error = (...args: string[]) => {
      errors.push(args.join(" "));
      originalError(...args);
    };
  });

  afterEach(() => {
    console.log = originalLog;
    console.error = originalError;
    process.chdir(originalCwd);
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true });
    }
  });

  test("main list shows all tasks", async () => {
    const bakefileContent = `
task("build", { desc: "Build the project" }, () => {});
task("test", { desc: "Run tests" }, () => {});
task("clean", { desc: "Clean output" }, () => {});
`;
    writeFileSync("Bakefile.ts", bakefileContent);

    await main(["list"]);

    const output = logs.join("\n");
    expect(output).toContain("build");
    expect(output).toContain("test");
    expect(output).toContain("clean");
  });

  test("main -l shows all tasks", async () => {
    const bakefileContent = `
task("setup", { desc: "Setup environment" }, () => {});
task("deploy", { desc: "Deploy app" }, () => {});
`;
    writeFileSync("Bakefile.ts", bakefileContent);

    await main(["-l"]);

    const output = logs.join("\n");
    expect(output).toContain("setup");
    expect(output).toContain("deploy");
  });

  test("main --help shows global help", async () => {
    const bakefileContent = `task("dummy", () => {});`;
    writeFileSync("Bakefile.ts", bakefileContent);

    await main(["--help"]);

    const output = logs.join("\n");
    expect(output).toContain("Usage:");
    expect(output).toContain("init");
    expect(output).toContain("list");
  });

  test("main --help task shows task details", async () => {
    const bakefileContent = `
task("compile", {
  desc: "Compile TypeScript",
  inputs: ["src/**"],
  outputs: ["dist"],
  deps: ["clean"],
  env: ["TS_NODE_PROJECT"]
}, () => {});
`;
    writeFileSync("Bakefile.ts", bakefileContent);

    await main(["--help", "compile"]);

    const output = logs.join("\n");
    expect(output).toContain("compile");
    expect(output).toContain("Compile TypeScript");
    expect(output).toContain("src/**");
    expect(output).toContain("dist");
    expect(output).toContain("clean");
    expect(output).toContain("TS_NODE_PROJECT");
  });

  test("main --help <missing> shows error with suggestions and exits with code 2", async () => {
    const bakefileContent = `
task("build", { desc: "Build" }, () => {});
task("build-prod", { desc: "Build for production" }, () => {});
task("test", { desc: "Test" }, () => {});
`;
    writeFileSync("Bakefile.ts", bakefileContent);

    const originalExit = process.exit;
    let exitCode: number | undefined;
    (process.exit as unknown) = (code?: number) => {
      exitCode = code;
    };

    try {
      await main(["--help", "build-dev"]);
    } finally {
      process.exit = originalExit;
    }

    const output = errors.join("\n");
    expect(output).toContain("build-dev");
    expect(output).toContain("Did you mean");
    expect(output).toContain("build");
    expect(exitCode).toBe(2);
  });

  test("main task --help also works for help", async () => {
    const bakefileContent = `
task("format", {
  desc: "Format code",
  inputs: ["src/**"],
  deps: []
}, () => {});
`;
    writeFileSync("Bakefile.ts", bakefileContent);

    await main(["format", "--help"]);

    const output = logs.join("\n");
    expect(output).toContain("format");
    expect(output).toContain("Format code");
  });

  test("duplicate default task definition is caught at Bakefile load time", async () => {
    const bakefileContent = `
task("build", () => {});
task("clean", () => {});

task.default("build");
task.default("clean");
`;

    writeFileSync("Bakefile.ts", bakefileContent);

    const originalExit = process.exit;
    let exitCode: number | undefined;
    (process.exit as unknown) = (code?: number) => {
      exitCode = code;
    };

    try {
      await main([]);
    } finally {
      process.exit = originalExit;
    }

    expect(exitCode).toBe(2);
    const output = errors.join("\n");
    expect(output).toContain("Default task is already set");
  });
});
