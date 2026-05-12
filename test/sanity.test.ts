import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
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
import {
  generateBashCompletion,
  generateFishCompletion,
  generateZshCompletion,
} from "../src/cli/completions.ts";
import { runDoctor } from "../src/cli/doctor.ts";
import { main } from "../src/cli/main.ts";
import { expandWildcardTargets, resolveTasks } from "../src/graph/resolver.ts";
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
  WildcardNoMatchError,
} from "../src/shared/errors.ts";
import { formatSummary, type TaskResult } from "../src/ui/format.ts";
import { renderDot, renderMermaid } from "../src/ui/graph.ts";
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
    if (result.type === "init") {
      expect(result.typesOnly).toBe(false);
    }
  });

  test('parses "init --type" command', () => {
    const result = parseArgs(["init", "--type"]);
    expect(result.type).toBe("init");
    if (result.type === "init") {
      expect(result.typesOnly).toBe(true);
    }
  });

  test("parses run command with task name", () => {
    const result = parseArgs(["build"]);
    expect(result.type).toBe("run");
    if (result.type === "run") {
      expect(result.taskNames).toEqual(["build"]);
    }
  });

  test("parses run command with multiple task names", () => {
    const result = parseArgs(["build", "test", "lint"]);
    expect(result.type).toBe("run");
    if (result.type === "run") {
      expect(result.taskNames).toEqual(["build", "test", "lint"]);
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
      expect(result.taskNames).toEqual(["build"]);
      expect(result.flags.dryRun).toBe(true);
      expect(result.flags.explain).toBe(false);
      expect(result.flags.watch).toBe(false);
    }
  });

  test("--explain フラグを解析する", () => {
    const result = parseArgs(["build", "--explain"]);
    expect(result.type).toBe("run");
    if (result.type === "run") {
      expect(result.taskNames).toEqual(["build"]);
      expect(result.flags.explain).toBe(true);
      expect(result.flags.dryRun).toBe(false);
      expect(result.flags.watch).toBe(false);
    }
  });

  test("--watch フラグを解析する", () => {
    const result = parseArgs(["build", "--watch"]);
    expect(result.type).toBe("run");
    if (result.type === "run") {
      expect(result.taskNames).toEqual(["build"]);
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
      `const build = task("build", () => {});
task.default(build);`,
    );

    const registry = new TaskRegistry();
    await loadBakefile(bakefilePath, registry);

    expect(registry.getDefault()).toBe("build");
  });

  test("throws DuplicateDefaultTaskError when default called twice", async () => {
    const bakefilePath = resolve(tempDir, "test-bakefile.ts");
    writeFileSync(
      bakefilePath,
      `const build = task("build", () => {});
const clean = task("clean", () => {});
task.default(build);
task.default(clean);`,
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
    expect(content).toContain("function defaultTask");
    expect(content).toContain("export { defaultTask as default }");
    expect(content).toContain("declare namespace task");
  });

  test("init(true) updates only Bakefile.d.ts without touching Bakefile.ts", async () => {
    writeFileSync("Bakefile.ts", "// existing bakefile");
    const originalBakefileContent = readFileSync("Bakefile.ts", "utf-8");

    await init(true);

    expect(existsSync("Bakefile.d.ts")).toBe(true);
    const updatedBakefileContent = readFileSync("Bakefile.ts", "utf-8");
    expect(updatedBakefileContent).toBe(originalBakefileContent);
  });

  test("generated Bakefile.d.ts is valid TypeScript with task.default usage", async () => {
    const tempDtsDir = resolve(
      "/tmp",
      `overbake-dts-test-${Date.now()}-${Math.random()}`,
    );
    mkdirSync(tempDtsDir, { recursive: true });

    try {
      const dtsPath = resolve(tempDtsDir, "Bakefile.d.ts");
      const tsPath = resolve(tempDtsDir, "test.ts");

      await init();
      const generatedDts = readFileSync("Bakefile.d.ts", "utf-8");
      writeFileSync(dtsPath, generatedDts);

      writeFileSync(
        tsPath,
        `/// <reference path="./Bakefile.d.ts" />\n\nconst x = task("x", () => {});\ntask.default(x);\n`,
      );

      execSync(`bunx tsc --noEmit --strict "${tsPath}"`, {
        cwd: tempDtsDir,
        stdio: "pipe",
      });
    } finally {
      rmSync(tempDtsDir, { recursive: true, force: true });
    }
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

  test("executes multiple targets with shared dependencies", async () => {
    const bakefileContent = `
task("clean", () => {
  console.log("clean");
});

task("build", { deps: ["clean"] }, () => {
  console.log("build");
});

task("test", { deps: ["clean"] }, () => {
  console.log("test");
});
`;

    writeFileSync("Bakefile.ts", bakefileContent);

    await main(["build", "test"]);

    const taskLogs = logs.filter((log) =>
      ["clean", "build", "test"].includes(log),
    );

    // clean should appear only once
    expect(taskLogs.filter((l) => l === "clean").length).toBe(1);
    expect(taskLogs).toContain("build");
    expect(taskLogs).toContain("test");

    const cleanIdx = taskLogs.indexOf("clean");
    const buildIdx = taskLogs.indexOf("build");
    const testIdx = taskLogs.indexOf("test");

    expect(cleanIdx).toBeLessThan(buildIdx);
    expect(cleanIdx).toBeLessThan(testIdx);
  });

  test("executes multiple independent targets in order", async () => {
    const bakefileContent = `
task("a", () => {
  console.log("task a");
});

task("b", () => {
  console.log("task b");
});

task("c", () => {
  console.log("task c");
});
`;

    writeFileSync("Bakefile.ts", bakefileContent);

    await main(["a", "b", "c"]);

    const taskLogs = logs.filter(
      (log) => log === "task a" || log === "task b" || log === "task c",
    );
    expect(taskLogs).toEqual(["task a", "task b", "task c"]);
  });

  test("init command creates files", async () => {
    await main(["init"]);

    expect(existsSync("Bakefile.ts")).toBe(true);
    expect(existsSync("Bakefile.d.ts")).toBe(true);
  });

  test("init --type command updates only Bakefile.d.ts", async () => {
    const originalBakefileContent = "// original bakefile";
    writeFileSync("Bakefile.ts", originalBakefileContent);

    await main(["init", "--type"]);

    expect(existsSync("Bakefile.d.ts")).toBe(true);
    expect(readFileSync("Bakefile.ts", "utf-8")).toBe(originalBakefileContent);
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
const build = task("build", () => {
  console.log("build executed");
});

task("clean", () => {
  console.log("clean executed");
});

task.default(build);
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
const mytask = task("mytask", () => {
  globalThis.__defaultDryRunCalled = true;
});

task.default(mytask);
`;

    writeFileSync("Bakefile.ts", bakefileContent);

    const g = globalThis as Record<string, unknown>;
    g.__defaultDryRunCalled = false;
    await main(["--dry-run"]);
    expect(g.__defaultDryRunCalled).toBe(false);
  });

  test("default task respects --explain flag", async () => {
    const bakefileContent = `
const explained = task("explained", { desc: "Task for explain" }, () => {
  globalThis.__defaultExplainCalled = true;
});

task.default(explained);
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
    expect(lines.some((l) => l.includes("Targets:"))).toBe(true);
  });

  test("printDryRun shows targets for multiple tasks", async () => {
    writeFileSync(
      resolve(tempDir, "Bakefile.ts"),
      `task("a", () => {}); task("b", () => {}); task("c", () => {});`,
    );
    const plan = await buildPlan(["a", "b"]);
    const lines: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => lines.push(a.join(" "));
    printDryRun(plan);
    console.log = orig;
    expect(lines.some((l) => l.includes("Targets: a b"))).toBe(true);
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

  test("main multiple tasks --dry-run shows execution plan", async () => {
    writeFileSync(
      resolve(tempDir, "Bakefile.ts"),
      `task("a", () => { globalThis.__aCalled = true; });
task("b", () => { globalThis.__bCalled = true; });`,
    );
    const g = globalThis as Record<string, unknown>;
    g.__aCalled = false;
    g.__bCalled = false;

    const lines: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => {
      lines.push(a.join(" "));
      orig(...a);
    };

    await main(["a", "b", "--dry-run"]);

    console.log = orig;

    expect(lines.some((l) => l.includes("Targets: a b"))).toBe(true);
    expect(g.__aCalled).toBe(false);
    expect(g.__bCalled).toBe(false);
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

describe("executePlan verbose logging", () => {
  let originalCwd: string;
  let tempDir: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tempDir = resolve(
      "/tmp",
      `overbake-verbose-${Date.now()}-${Math.random()}`,
    );
    mkdirSync(tempDir, { recursive: true });
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true });
    }
  });

  test("executePlan with verbose logs plan details", async () => {
    const bakefileContent = `
task("a", () => {
  console.log("task a");
});

task("b", { deps: ["a"] }, () => {
  console.log("task b");
});
`;

    writeFileSync("Bakefile.ts", bakefileContent);

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.join(" "));
      originalLog(...args);
    };

    try {
      const plan = await buildPlan("b");
      await executePlan(plan, { verbose: true });

      const verboseLogs = logs.filter((l) =>
        ["targets:", "root:", "cwd:", "tasks:"].some((v) => l.includes(v)),
      );

      expect(verboseLogs.length).toBeGreaterThan(0);
      expect(logs.some((l) => l.includes("targets:") && l.includes("b"))).toBe(
        true,
      );
      expect(logs.some((l) => l.includes("tasks:") && l.includes("a"))).toBe(
        true,
      );
      expect(logs.some((l) => l.includes("tasks:") && l.includes("b"))).toBe(
        true,
      );
    } finally {
      console.log = originalLog;
    }
  });

  test("executePlan with quiet does not log verbose output", async () => {
    const bakefileContent = `task("a", () => {});`;

    writeFileSync("Bakefile.ts", bakefileContent);

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.join(" "));
      originalLog(...args);
    };

    try {
      const plan = await buildPlan("a");
      await executePlan(plan, { quiet: true, verbose: true });

      const verboseLogs = logs.filter((l) =>
        ["targets:", "root:", "cwd:", "tasks:"].some((v) => l.includes(v)),
      );

      expect(verboseLogs.length).toBe(0);
    } finally {
      console.log = originalLog;
    }
  });
});

describe("keepGoing / executePlan failure handling", () => {
  let originalCwd: string;
  let tempDir: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tempDir = resolve(
      "/tmp",
      `overbake-keep-going-${Date.now()}-${Math.random()}`,
    );
    mkdirSync(tempDir, { recursive: true });
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true });
    }
  });

  test("executePlan throws error with failure details when keep-going encounters failures", async () => {
    const bakefileContent = `
task("passing", () => {
  console.log("passing task");
});

task("failing1", { deps: ["passing"] }, () => {
  throw new Error("task failing1 error");
});

task("failing2", { deps: ["passing"] }, () => {
  throw new Error("task failing2 error");
});
`;

    writeFileSync("Bakefile.ts", bakefileContent);

    const plan = await buildPlan(["failing1", "failing2"]);

    let thrownError: unknown;
    try {
      await executePlan(plan, { keepGoing: true });
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError).toBeDefined();
    expect(thrownError instanceof Error).toBe(true);
    if (thrownError instanceof Error) {
      expect(thrownError.message).toContain("Execution failed");
      expect(thrownError.message).toContain("failing1");
      expect(thrownError.message).toContain("failing2");
    }
  });

  test("executePlan without keep-going throws error on first failure", async () => {
    const bakefileContent = `
task("first", () => {
  throw new Error("first failed");
});

task("second", { deps: ["first"] }, () => {
  console.log("second");
});
`;

    writeFileSync("Bakefile.ts", bakefileContent);

    const plan = await buildPlan("second");

    let thrownError: unknown;
    try {
      await executePlan(plan, { keepGoing: false });
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError).toBeDefined();
    expect(thrownError instanceof Error).toBe(true);
    if (thrownError instanceof Error) {
      expect(thrownError.message).toContain("first failed");
    }
  });

  test("executePlan with keep-going continues after first failure", async () => {
    const bakefileContent = `
task("first", () => {
  globalThis.__executionLog.push("first");
  throw new Error("first failed");
});

task("second", () => {
  globalThis.__executionLog.push("second");
});

task("third", () => {
  globalThis.__executionLog.push("third");
});
`;

    writeFileSync("Bakefile.ts", bakefileContent);

    const g = globalThis as Record<string, unknown>;
    g.__executionLog = [];

    const plan = await buildPlan(["first", "second", "third"]);

    let thrownError: unknown;
    try {
      await executePlan(plan, { keepGoing: true });
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError).toBeDefined();
    const log = g.__executionLog as string[];
    expect(log).toContain("first");
    expect(log).toContain("second");
    expect(log).toContain("third");
    delete g.__executionLog;
  });
});

describe("quiet flag - console suppression", () => {
  let originalCwd: string;
  let tempDir: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tempDir = resolve("/tmp", `overbake-quiet-${Date.now()}-${Math.random()}`);
    mkdirSync(tempDir, { recursive: true });
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true });
    }
  });

  test("--quiet suppresses task console.log output", async () => {
    const bakefileContent = `
task("output-task", () => {
  console.log("task output");
});
`;

    writeFileSync("Bakefile.ts", bakefileContent);

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.join(" "));
      originalLog(...args);
    };

    try {
      const plan = await buildPlan("output-task");
      await executePlan(plan, { quiet: true });

      // Task output should be suppressed
      const taskOutput = logs.filter((l) => l === "task output");
      expect(taskOutput.length).toBe(0);
    } finally {
      console.log = originalLog;
    }
  });

  test("--quiet suppresses task console.error output", async () => {
    const bakefileContent = `
task("error-task", () => {
  console.error("task error");
});
`;

    writeFileSync("Bakefile.ts", bakefileContent);

    const errors: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.join(" "));
    };

    try {
      const plan = await buildPlan("error-task");
      await executePlan(plan, { quiet: true });

      // Task error output should be suppressed
      const taskErrors = errors.filter((e) => e === "task error");
      expect(taskErrors.length).toBe(0);
    } finally {
      console.error = originalError;
    }
  });

  test("--quiet does not suppress logger.error output", async () => {
    const bakefileContent = `
task("failing-task", () => {
  throw new Error("task failed");
});
`;

    writeFileSync("Bakefile.ts", bakefileContent);

    const errors: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.join(" "));
    };

    try {
      const plan = await buildPlan("failing-task");
      try {
        await executePlan(plan, { quiet: true });
      } catch {
        // expected to fail
      }

      // Logger error output should be present
      const hasFailedTask = errors.some(
        (e) => e.includes("failing-task") && e.includes("failed"),
      );
      expect(hasFailedTask).toBe(true);
    } finally {
      console.error = originalError;
    }
  });

  test("without --quiet, task console.log is visible", async () => {
    const bakefileContent = `
task("verbose-task", () => {
  console.log("visible output");
});
`;

    writeFileSync("Bakefile.ts", bakefileContent);

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.join(" "));
      originalLog(...args);
    };

    try {
      const plan = await buildPlan("verbose-task");
      await executePlan(plan, { quiet: false });

      // Task output should be visible
      const taskOutput = logs.filter((l) => l === "visible output");
      expect(taskOutput.length).toBeGreaterThan(0);
    } finally {
      console.log = originalLog;
    }
  });
});

describe("parseArgs - output control flags", () => {
  test("parses --keep-going flag", () => {
    const result = parseArgs(["build", "--keep-going"]);
    expect(result.type).toBe("run");
    if (result.type === "run") {
      expect(result.flags.keepGoing).toBe(true);
    }
  });

  test("parses --quiet flag", () => {
    const result = parseArgs(["build", "--quiet"]);
    expect(result.type).toBe("run");
    if (result.type === "run") {
      expect(result.flags.quiet).toBe(true);
    }
  });

  test("parses --verbose flag", () => {
    const result = parseArgs(["build", "--verbose"]);
    expect(result.type).toBe("run");
    if (result.type === "run") {
      expect(result.flags.verbose).toBe(true);
    }
  });

  test("parses --no-color flag", () => {
    const result = parseArgs(["build", "--no-color"]);
    expect(result.type).toBe("run");
    if (result.type === "run") {
      expect(result.flags.noColor).toBe(true);
    }
  });

  test("parses multiple output control flags", () => {
    const result = parseArgs([
      "build",
      "--keep-going",
      "--quiet",
      "--verbose",
      "--no-color",
    ]);
    expect(result.type).toBe("run");
    if (result.type === "run") {
      expect(result.flags.keepGoing).toBe(true);
      expect(result.flags.quiet).toBe(true);
      expect(result.flags.verbose).toBe(true);
      expect(result.flags.noColor).toBe(true);
    }
  });

  test("parses default command with output control flags", () => {
    const result = parseArgs(["--keep-going", "--quiet"]);
    expect(result.type).toBe("default");
    if (result.type === "default") {
      expect(result.flags.keepGoing).toBe(true);
      expect(result.flags.quiet).toBe(true);
    }
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
    expect(output).toContain("init --type");
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
    expect(output).toContain("init --type");
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
const build = task("build", () => {});
const clean = task("clean", () => {});

task.default(build);
task.default(clean);
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

// issue #14: confirm プロンプト - parseArgs の --yes / -y フラグ
describe("confirm プロンプト (#14) - parseArgs の --yes / -y フラグ", () => {
  test("run コマンドで --yes を解析すると flags.yes=true になる", () => {
    const result = parseArgs(["build", "--yes"]);
    expect(result.type).toBe("run");
    if (result.type === "run") {
      expect(result.flags.yes).toBe(true);
    }
  });

  test("run コマンドで -y を解析すると flags.yes=true になる", () => {
    const result = parseArgs(["build", "-y"]);
    expect(result.type).toBe("run");
    if (result.type === "run") {
      expect(result.flags.yes).toBe(true);
    }
  });

  test("default コマンドで --yes を解析すると flags.yes=true になる", () => {
    const result = parseArgs(["--yes"]);
    expect(result.type).toBe("default");
    if (result.type === "default") {
      expect(result.flags.yes).toBe(true);
    }
  });

  test("default コマンドで -y を解析すると flags.yes=true になる", () => {
    const result = parseArgs(["-y"]);
    expect(result.type).toBe("default");
    if (result.type === "default") {
      expect(result.flags.yes).toBe(true);
    }
  });
});

// issue #14: confirm プロンプト - executePlan confirm 動作
describe("confirm プロンプト (#14) - executePlan confirm 動作", () => {
  let originalCwd: string;
  let tempDir: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tempDir = resolve(
      "/tmp",
      `overbake-confirm-${Date.now()}-${Math.random()}`,
    );
    mkdirSync(tempDir, { recursive: true });
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true });
    }
  });

  test("options.yes=true なら confirmFn を呼ばずにタスクを実行する", async () => {
    writeFileSync(
      resolve(tempDir, "Bakefile.ts"),
      `task("confirm-task", { confirm: "続行しますか?" }, () => {
        globalThis.__confirmTaskCalled = true;
      });`,
    );

    const g = globalThis as Record<string, unknown>;
    g.__confirmTaskCalled = false;

    let confirmCalled = false;
    const mockConfirmFn = async (_: string): Promise<boolean> => {
      confirmCalled = true;
      return true;
    };

    const plan = await buildPlan("confirm-task");
    await executePlan(plan, { yes: true, confirmFn: mockConfirmFn });

    expect(confirmCalled).toBe(false);
    expect(g.__confirmTaskCalled).toBe(true);
    delete g.__confirmTaskCalled;
  });

  test("confirm: string[] は順番に confirmFn を呼ぶ", async () => {
    writeFileSync(
      resolve(tempDir, "Bakefile.ts"),
      `task("multi-confirm", { confirm: ["確認1", "確認2", "確認3"] }, () => {});`,
    );

    const calledWith: string[] = [];
    const mockConfirmFn = async (msg: string): Promise<boolean> => {
      calledWith.push(msg);
      return true;
    };

    const plan = await buildPlan("multi-confirm");
    await executePlan(plan, { confirmFn: mockConfirmFn });

    expect(calledWith).toEqual(["確認1", "確認2", "確認3"]);
  });

  test("confirmFn が false を返したらタスクを実行せず中断する", async () => {
    writeFileSync(
      resolve(tempDir, "Bakefile.ts"),
      `task("cancel-task", { confirm: "本当に実行しますか?" }, () => {
        globalThis.__cancelTaskCalled = true;
      });`,
    );

    const g = globalThis as Record<string, unknown>;
    g.__cancelTaskCalled = false;

    const mockConfirmFn = async (_: string): Promise<boolean> => false;

    const plan = await buildPlan("cancel-task");
    let thrownError: unknown;
    try {
      await executePlan(plan, { confirmFn: mockConfirmFn });
    } catch (e) {
      thrownError = e;
    }

    expect(thrownError).toBeDefined();
    expect(g.__cancelTaskCalled).toBe(false);
    delete g.__cancelTaskCalled;
  });

  test("非TTY + --yes なしは exitCode=2 の CliError を throw する", async () => {
    const { createDefaultConfirm } = await import("../src/runtime/executor.ts");

    // TTY を強制的に無効化して非対話環境をシミュレート
    const origStdinIsTTY = process.stdin.isTTY;
    const origStdoutIsTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdin, "isTTY", {
      value: false,
      configurable: true,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      value: false,
      configurable: true,
    });

    let caughtError: unknown;
    try {
      const confirmFn = createDefaultConfirm();
      await confirmFn("テスト確認");
    } catch (e) {
      caughtError = e;
    } finally {
      Object.defineProperty(process.stdin, "isTTY", {
        value: origStdinIsTTY,
        configurable: true,
      });
      Object.defineProperty(process.stdout, "isTTY", {
        value: origStdoutIsTTY,
        configurable: true,
      });
    }

    expect(caughtError).toBeDefined();
    expect((caughtError as Error & { exitCode?: number }).exitCode).toBe(2);
  });
});

// issue #16: シェル補完スクリプト生成 - parseArgs
describe("シェル補完 (#16) - parseArgs", () => {
  test('"completions zsh" を解析すると type=completions, shell=zsh になる', () => {
    const result = parseArgs(["completions", "zsh"]);
    expect(result.type).toBe("completions");
    if (result.type === "completions") {
      expect(result.shell).toBe("zsh");
    }
  });

  test('"completions bash" を解析すると type=completions, shell=bash になる', () => {
    const result = parseArgs(["completions", "bash"]);
    expect(result.type).toBe("completions");
    if (result.type === "completions") {
      expect(result.shell).toBe("bash");
    }
  });

  test('"completions fish" を解析すると type=completions, shell=fish になる', () => {
    const result = parseArgs(["completions", "fish"]);
    expect(result.type).toBe("completions");
    if (result.type === "completions") {
      expect(result.shell).toBe("fish");
    }
  });

  test('"__complete tasks" を解析すると type=complete, subcommand=tasks になる', () => {
    const result = parseArgs(["__complete", "tasks"]);
    expect(result.type).toBe("complete");
    if (result.type === "complete") {
      expect(result.subcommand).toBe("tasks");
    }
  });
});

// issue #16: シェル補完スクリプト生成 - completions.ts
describe("シェル補完 (#16) - 補完スクリプト生成", () => {
  test("generateZshCompletion は #compdef bake を含む", () => {
    const script = generateZshCompletion();
    expect(script).toContain("#compdef bake");
  });

  test("generateZshCompletion は bake __complete tasks を含む", () => {
    const script = generateZshCompletion();
    expect(script).toContain("bake __complete tasks");
  });

  test("generateZshCompletion はサブコマンドを含む", () => {
    const script = generateZshCompletion();
    expect(script).toContain("init");
    expect(script).toContain("list");
    expect(script).toContain("completions");
    expect(script).toContain("doctor");
  });

  test("generateZshCompletion はフラグを含む", () => {
    const script = generateZshCompletion();
    expect(script).toContain("--dry-run");
    expect(script).toContain("--watch");
    expect(script).toContain("--help");
  });

  test("generateBashCompletion は complete -F _bake bake を含む", () => {
    const script = generateBashCompletion();
    expect(script).toContain("complete -F _bake bake");
  });

  test("generateBashCompletion は bake __complete tasks を含む", () => {
    const script = generateBashCompletion();
    expect(script).toContain("bake __complete tasks");
  });

  test("generateBashCompletion はサブコマンドを含む", () => {
    const script = generateBashCompletion();
    expect(script).toContain("init");
    expect(script).toContain("list");
    expect(script).toContain("completions");
    expect(script).toContain("doctor");
  });

  test("generateFishCompletion は complete -c bake を含む", () => {
    const script = generateFishCompletion();
    expect(script).toContain("complete -c bake");
  });

  test("generateFishCompletion は bake __complete tasks を含む", () => {
    const script = generateFishCompletion();
    expect(script).toContain("bake __complete tasks");
  });

  test("generateFishCompletion はサブコマンドを含む", () => {
    const script = generateFishCompletion();
    expect(script).toContain("init");
    expect(script).toContain("list");
    expect(script).toContain("completions");
    expect(script).toContain("doctor");
  });
});

// issue #16: シェル補完スクリプト生成 - renderGlobalHelp
describe("シェル補完 (#16) - renderGlobalHelp に completions の案内が含まれる", () => {
  test("renderGlobalHelp は completions を含む", () => {
    const output = renderGlobalHelp();
    expect(output).toContain("completions");
  });
});

// issue #16: シェル補完スクリプト生成 - main 統合テスト
describe("シェル補完 (#16) - main 統合テスト", () => {
  let originalCwd: string;
  let tempDir: string;
  let logs: string[] = [];
  let errors: string[] = [];
  let originalLog: typeof console.log;
  let originalError: typeof console.error;
  let originalExit: typeof process.exit;

  beforeEach(() => {
    originalCwd = process.cwd();
    tempDir = resolve(
      "/tmp",
      `overbake-completions-test-${Date.now()}-${Math.random()}`,
    );
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
    (process.exit as unknown) = () => {};
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

  test("main completions zsh は zsh 補完スクリプトを出力する", async () => {
    await main(["completions", "zsh"]);
    const output = logs.join("\n");
    expect(output).toContain("#compdef bake");
  });

  test("main completions bash は bash 補完スクリプトを出力する", async () => {
    await main(["completions", "bash"]);
    const output = logs.join("\n");
    expect(output).toContain("complete -F _bake bake");
  });

  test("main completions fish は fish 補完スクリプトを出力する", async () => {
    await main(["completions", "fish"]);
    const output = logs.join("\n");
    expect(output).toContain("complete -c bake");
  });

  test("main completions 未対応シェルは exitCode=2 で終了する", async () => {
    let exitCode: number | undefined;
    (process.exit as unknown) = (code?: number) => {
      exitCode = code;
    };

    await main(["completions", "unknown-shell"]);
    expect(exitCode).toBe(2);
  });

  test("main __complete tasks は Bakefile.ts のタスク名を1行1件で出力する", async () => {
    writeFileSync(
      "Bakefile.ts",
      `task("build", () => {});
task("test", () => {});
task("clean", () => {});`,
    );

    await main(["__complete", "tasks"]);

    expect(logs).toContain("build");
    expect(logs).toContain("test");
    expect(logs).toContain("clean");
  });

  test("main __complete tasks は Bakefile.ts が無くてもエラーにならず何も出力しない", async () => {
    // tempDir には Bakefile.ts を作らない
    await main(["__complete", "tasks"]);

    expect(logs).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });
});

// issue #14: confirm プロンプト - main --yes / -y 統合テスト
describe("confirm プロンプト (#14) - main --yes / -y 統合テスト", () => {
  let originalCwd: string;
  let tempDir: string;
  let originalExit: typeof process.exit;

  beforeEach(() => {
    originalCwd = process.cwd();
    tempDir = resolve(
      "/tmp",
      `overbake-confirm-main-${Date.now()}-${Math.random()}`,
    );
    mkdirSync(tempDir, { recursive: true });
    process.chdir(tempDir);
    originalExit = process.exit;
    (process.exit as unknown) = () => {};
  });

  afterEach(() => {
    process.exit = originalExit;
    process.chdir(originalCwd);
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true });
    }
  });

  test("--yes フラグで confirm 付きタスクを実行できる", async () => {
    writeFileSync(
      "Bakefile.ts",
      `task("risky", { confirm: "本当に実行しますか?" }, () => {
        globalThis.__riskyTaskCalled = true;
      });`,
    );

    const g = globalThis as Record<string, unknown>;
    g.__riskyTaskCalled = false;

    await main(["risky", "--yes"]);

    expect(g.__riskyTaskCalled).toBe(true);
    delete g.__riskyTaskCalled;
  });

  test("-y フラグで confirm 付きタスクを実行できる", async () => {
    writeFileSync(
      "Bakefile.ts",
      `task("risky2", { confirm: "本当に実行しますか?" }, () => {
        globalThis.__risky2TaskCalled = true;
      });`,
    );

    const g = globalThis as Record<string, unknown>;
    g.__risky2TaskCalled = false;

    await main(["risky2", "-y"]);

    expect(g.__risky2TaskCalled).toBe(true);
    delete g.__risky2TaskCalled;
  });
});

describe("parseArgs --graph フラグ", () => {
  test("--graph 単独は default コマンドで graph=mermaid", () => {
    const result = parseArgs(["--graph"]);
    expect(result.type).toBe("default");
    if (result.type === "default") {
      expect(result.flags.graph).toBe("mermaid");
    }
  });

  test("--graph=mermaid は default コマンドで graph=mermaid", () => {
    const result = parseArgs(["--graph=mermaid"]);
    expect(result.type).toBe("default");
    if (result.type === "default") {
      expect(result.flags.graph).toBe("mermaid");
    }
  });

  test("--graph=dot は default コマンドで graph=dot", () => {
    const result = parseArgs(["--graph=dot"]);
    expect(result.type).toBe("default");
    if (result.type === "default") {
      expect(result.flags.graph).toBe("dot");
    }
  });

  test("task --graph は run コマンドで graph=mermaid", () => {
    const result = parseArgs(["build", "--graph"]);
    expect(result.type).toBe("run");
    if (result.type === "run") {
      expect(result.taskNames).toEqual(["build"]);
      expect(result.flags.graph).toBe("mermaid");
    }
  });

  test("task --graph=dot は run コマンドで graph=dot", () => {
    const result = parseArgs(["build", "--graph=dot"]);
    expect(result.type).toBe("run");
    if (result.type === "run") {
      expect(result.taskNames).toEqual(["build"]);
      expect(result.flags.graph).toBe("dot");
    }
  });

  test("--graph なしは graph が undefined", () => {
    const result = parseArgs(["build"]);
    if (result.type === "run") {
      expect(result.flags.graph).toBeUndefined();
    }
  });

  test("未知フォーマット --graph=svg を raw 値で保持する", () => {
    const result = parseArgs(["--graph=svg"]);
    if (result.type === "default") {
      expect(result.flags.graph).toBe("svg");
    }
  });
});

describe("graph レンダリング", () => {
  const tasksWithDeps = [
    { name: "clean", fn: () => {}, options: {} },
    { name: "build", fn: () => {}, options: { deps: ["clean"] } },
    { name: "test", fn: () => {}, options: { deps: ["build"] } },
  ];

  const isolatedTasks = [
    { name: "lint", fn: () => {}, options: {} },
    { name: "format", fn: () => {}, options: {} },
  ];

  test("renderMermaid は flowchart LR で始まる", () => {
    const output = renderMermaid(tasksWithDeps);
    expect(output.startsWith("flowchart LR")).toBe(true);
  });

  test("renderMermaid は dep --> task の辺を出力する", () => {
    const output = renderMermaid(tasksWithDeps);
    expect(output).toContain("clean --> build");
    expect(output).toContain("build --> test");
  });

  test("renderMermaid は孤立ノードを個別に出力する", () => {
    const output = renderMermaid(isolatedTasks);
    expect(output).toContain("lint");
    expect(output).toContain("format");
  });

  test("renderDot は digraph bake { で始まる", () => {
    const output = renderDot(tasksWithDeps);
    expect(output.startsWith("digraph bake {")).toBe(true);
    expect(output.endsWith("}")).toBe(true);
  });

  test("renderDot はクォートされたエッジを出力する", () => {
    const output = renderDot(tasksWithDeps);
    expect(output).toContain('"clean" -> "build";');
    expect(output).toContain('"build" -> "test";');
  });

  test("renderDot は孤立ノードを個別に出力する", () => {
    const output = renderDot(isolatedTasks);
    expect(output).toContain('"lint";');
    expect(output).toContain('"format";');
  });

  test("renderMermaid: 特殊文字を含むノード名は安全にエスケープ", () => {
    const tasks = [
      { name: "ns:build", fn: () => {}, options: {} },
      { name: "ns:test", fn: () => {}, options: { deps: ["ns:build"] } },
    ];
    const output = renderMermaid(tasks);
    expect(output).toContain("ns_build");
    expect(output).toContain("ns_test");
  });
});

describe("--graph フラグ integration", () => {
  let originalCwd: string;
  let tempDir: string;
  let originalExit: typeof process.exit;

  beforeEach(() => {
    originalCwd = process.cwd();
    tempDir = resolve("/tmp", `overbake-graph-${Date.now()}-${Math.random()}`);
    mkdirSync(tempDir, { recursive: true });
    process.chdir(tempDir);
    originalExit = process.exit;
    (process.exit as unknown) = () => {};
  });

  afterEach(() => {
    process.exit = originalExit;
    process.chdir(originalCwd);
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true });
    }
  });

  test("bake <task> --graph はタスク関数を実行しない", async () => {
    writeFileSync(
      "Bakefile.ts",
      `task("clean", () => { globalThis.__graphCleanCalled = true; });
task("build", { deps: ["clean"] }, () => { globalThis.__graphBuildCalled = true; });`,
    );

    const g = globalThis as Record<string, unknown>;
    g.__graphCleanCalled = false;
    g.__graphBuildCalled = false;

    await main(["build", "--graph"]);

    expect(g.__graphCleanCalled).toBe(false);
    expect(g.__graphBuildCalled).toBe(false);
    delete g.__graphCleanCalled;
    delete g.__graphBuildCalled;
  });

  test("bake <task> --graph は mermaid 形式の依存グラフを出力する", async () => {
    writeFileSync(
      "Bakefile.ts",
      `task("clean", () => {});
task("build", { deps: ["clean"] }, () => {});`,
    );

    const lines: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => lines.push(a.join(" "));

    await main(["build", "--graph"]);

    console.log = orig;

    const output = lines.join("\n");
    expect(output).toContain("flowchart LR");
    expect(output).toContain("clean --> build");
  });

  test("bake <task> --graph=dot は dot 形式を出力する", async () => {
    writeFileSync(
      "Bakefile.ts",
      `task("clean", () => {});
task("build", { deps: ["clean"] }, () => {});`,
    );

    const lines: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => lines.push(a.join(" "));

    await main(["build", "--graph=dot"]);

    console.log = orig;

    const output = lines.join("\n");
    expect(output).toContain("digraph bake {");
    expect(output).toContain('"clean" -> "build";');
  });

  test("bake --graph（タスク指定なし）は全タスクのグラフを出力する", async () => {
    writeFileSync(
      "Bakefile.ts",
      `task("lint", () => {});
task("build", () => {});
task("test", { deps: ["build"] }, () => {});`,
    );

    const lines: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => lines.push(a.join(" "));

    await main(["--graph"]);

    console.log = orig;

    const output = lines.join("\n");
    expect(output).toContain("flowchart LR");
    expect(output).toContain("lint");
    expect(output).toContain("build");
    expect(output).toContain("test");
  });

  test("bake --graph=mermaid は mermaid 形式を出力する", async () => {
    writeFileSync("Bakefile.ts", `task("mytask", () => {});`);

    const lines: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => lines.push(a.join(" "));

    await main(["mytask", "--graph=mermaid"]);

    console.log = orig;

    const output = lines.join("\n");
    expect(output).toContain("flowchart LR");
  });

  test("未対応フォーマット --graph=svg は exit code 2 で終了する", async () => {
    writeFileSync("Bakefile.ts", `task("build", () => {});`);

    let exitCode = 0;
    (process.exit as unknown) = (code: number) => {
      exitCode = code;
    };

    const errors: string[] = [];
    const origError = console.error;
    console.error = (...a: unknown[]) => errors.push(a.join(" "));

    await main(["build", "--graph=svg"]);

    console.error = origError;

    expect(exitCode).toBe(2);
    expect(errors.some((e) => e.includes("svg"))).toBe(true);
  });
});

// issue #18: 実行サマリー
describe("formatSummary", () => {
  test("正常終了のタスク一覧を表示する", () => {
    const results: TaskResult[] = [
      { name: "clean", status: "ok", durationMs: 12 },
      { name: "build", status: "ok", durationMs: 1200 },
    ];
    const output = formatSummary(results, 1212, { noColor: true });
    expect(output).toContain("Summary");
    expect(output).toContain("clean");
    expect(output).toContain("build");
    expect(output).toContain("12ms");
    expect(output).toContain("1.2s");
    expect(output).toContain("2 tasks");
    expect(output).toContain("wall");
  });

  test("失敗タスクが summary と Failed tasks 一覧に含まれる", () => {
    const results: TaskResult[] = [
      { name: "clean", status: "ok", durationMs: 10 },
      { name: "build", status: "failed", durationMs: 50 },
    ];
    const output = formatSummary(results, 60, { noColor: true });
    expect(output).toContain("✗");
    expect(output).toContain("1 failed");
    expect(output).toContain("Failed tasks:");
    expect(output).toContain("- build");
  });

  test("meta タスクが ✓ (meta) で表示される", () => {
    const results: TaskResult[] = [
      { name: "ci", status: "meta", durationMs: 0 },
    ];
    const output = formatSummary(results, 0, { noColor: true });
    expect(output).toContain("✓");
    expect(output).toContain("(meta)");
  });

  test("cached タスクが ⏭ cached で表示される", () => {
    const results: TaskResult[] = [
      { name: "lint", status: "cached", durationMs: 0 },
    ];
    const output = formatSummary(results, 0, { noColor: true });
    expect(output).toContain("⏭");
    expect(output).toContain("cached");
  });

  test("skipped タスクが ⏭ skipped で表示される", () => {
    const results: TaskResult[] = [
      { name: "test", status: "skipped", durationMs: 0 },
    ];
    const output = formatSummary(results, 0, { noColor: true });
    expect(output).toContain("⏭");
    expect(output).toContain("skipped");
  });

  test("quiet モードでは詳細行を出さず要約行のみ表示する", () => {
    const results: TaskResult[] = [
      { name: "clean", status: "ok", durationMs: 10 },
      { name: "build", status: "ok", durationMs: 100 },
    ];
    const output = formatSummary(results, 110, { quiet: true, noColor: true });
    expect(output).not.toContain("Summary");
    expect(output).toContain("2 tasks");
    expect(output).toContain("wall");
  });

  test("quiet モードで失敗がある場合は Failed tasks 一覧を含む", () => {
    const results: TaskResult[] = [
      { name: "build", status: "failed", durationMs: 30 },
    ];
    const output = formatSummary(results, 30, { quiet: true, noColor: true });
    expect(output).not.toContain("Summary");
    expect(output).toContain("1 failed");
    expect(output).toContain("Failed tasks:");
    expect(output).toContain("- build");
  });

  test("単数タスクは '1 task' と表示される", () => {
    const results: TaskResult[] = [{ name: "a", status: "ok", durationMs: 5 }];
    const output = formatSummary(results, 5, { noColor: true });
    expect(output).toContain("1 task ");
    expect(output).not.toContain("1 tasks");
  });
});

describe("parseArgs - --no-summary フラグ", () => {
  test("run コマンドで --no-summary を解析すると flags.noSummary=true になる", () => {
    const result = parseArgs(["build", "--no-summary"]);
    expect(result.type).toBe("run");
    if (result.type === "run") {
      expect(result.flags.noSummary).toBe(true);
    }
  });

  test("default コマンドで --no-summary を解析すると flags.noSummary=true になる", () => {
    const result = parseArgs(["--no-summary"]);
    expect(result.type).toBe("default");
    if (result.type === "default") {
      expect(result.flags.noSummary).toBe(true);
    }
  });

  test("--no-summary なしは flags.noSummary=false になる", () => {
    const result = parseArgs(["build"]);
    if (result.type === "run") {
      expect(result.flags.noSummary).toBe(false);
    }
  });
});

describe("executePlan - サマリー出力", () => {
  let originalCwd: string;
  let tempDir: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tempDir = resolve(
      "/tmp",
      `overbake-summary-${Date.now()}-${Math.random()}`,
    );
    mkdirSync(tempDir, { recursive: true });
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true });
    }
  });

  test("実行後に Summary が console.log に出力される", async () => {
    writeFileSync(
      resolve(tempDir, "Bakefile.ts"),
      `task("a", () => {}); task("b", { deps: ["a"] }, () => {});`,
    );
    const plan = await buildPlan("b");

    const logs: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    try {
      await executePlan(plan, { noColor: true });
    } finally {
      console.log = orig;
    }

    const summaryLog = logs.find((l) => l.includes("Summary"));
    expect(summaryLog).toBeDefined();
    expect(summaryLog).toContain("a");
    expect(summaryLog).toContain("b");
    expect(summaryLog).toContain("wall");
  });

  test("--no-summary では Summary が出力されない", async () => {
    writeFileSync(resolve(tempDir, "Bakefile.ts"), `task("a", () => {});`);
    const plan = await buildPlan("a");

    const logs: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    try {
      await executePlan(plan, { noSummary: true, noColor: true });
    } finally {
      console.log = orig;
    }

    expect(logs.some((l) => l.includes("Summary"))).toBe(false);
    expect(logs.some((l) => l.includes("wall"))).toBe(false);
  });

  test("quiet モードでも要約行が出力される", async () => {
    writeFileSync(
      resolve(tempDir, "Bakefile.ts"),
      `task("a", () => { console.log("task log"); });`,
    );
    const plan = await buildPlan("a");

    const logs: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    try {
      await executePlan(plan, { quiet: true, noColor: true });
    } finally {
      console.log = orig;
    }

    // quiet モード: "Summary" ヘッダはなく要約行のみ
    const summaryLine = logs.find((l) => l.includes("wall"));
    expect(summaryLine).toBeDefined();
    expect(logs.some((l) => l.includes("Summary"))).toBe(false);
    // タスク内の console.log は抑制される
    expect(logs.some((l) => l === "task log")).toBe(false);
  });

  test("メタタスク (isMeta=true) が (meta) と表示される", async () => {
    writeFileSync(
      resolve(tempDir, "Bakefile.ts"),
      `task("sub", () => {});
task("group", { deps: ["sub"] });`,
    );
    const plan = await buildPlan("group");

    const logs: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    try {
      await executePlan(plan, { noColor: true });
    } finally {
      console.log = orig;
    }

    const summaryLog = logs.find((l) => l.includes("Summary"));
    expect(summaryLog).toBeDefined();
    expect(summaryLog).toContain("(meta)");
  });

  test("keepGoing=false で失敗時もサマリーが出力される", async () => {
    writeFileSync(
      resolve(tempDir, "Bakefile.ts"),
      `task("fail", () => { throw new Error("oops"); });`,
    );
    const plan = await buildPlan("fail");

    const logs: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    try {
      await executePlan(plan, { keepGoing: false, noColor: true });
    } catch {
      // 期待通り失敗
    } finally {
      console.log = orig;
    }

    const summaryLog = logs.find((l) => l.includes("wall"));
    expect(summaryLog).toBeDefined();
    expect(summaryLog).toContain("1 failed");
  });

  test("keepGoing=true で複数失敗時にサマリーに全失敗が反映される", async () => {
    writeFileSync(
      resolve(tempDir, "Bakefile.ts"),
      `task("fail1", () => { throw new Error("err1"); });
task("fail2", () => { throw new Error("err2"); });`,
    );
    const plan = await buildPlan(["fail1", "fail2"]);

    const logs: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    try {
      await executePlan(plan, { keepGoing: true, noColor: true });
    } catch {
      // 期待通り失敗
    } finally {
      console.log = orig;
    }

    const summaryLog = logs.find((l) => l.includes("wall"));
    expect(summaryLog).toBeDefined();
    expect(summaryLog).toContain("2 failed");
    expect(summaryLog).toContain("- fail1");
    expect(summaryLog).toContain("- fail2");
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

describe("issue #21: renderTaskList グルーピング表示", () => {
  test("`:` を含まないタスクはフラット表示でグループヘッダーなし", () => {
    const tasks = [
      { name: "build", fn: () => {}, options: { desc: "ビルド" } },
      { name: "clean", fn: () => {}, options: {} },
    ];
    const output = renderTaskList(tasks);
    const lines = output.split("\n");
    expect(output).toContain("build");
    expect(output).toContain("clean");
    expect(lines.some((l) => l === "build:")).toBe(false);
  });

  test("`:` を含むタスクはグループヘッダーの下に表示される", () => {
    const tasks = [
      { name: "build:frontend", fn: () => {}, options: {} },
      { name: "build:backend", fn: () => {}, options: {} },
    ];
    const output = renderTaskList(tasks);
    const lines = output.split("\n");
    const headerIdx = lines.indexOf("build:");
    expect(headerIdx).toBeGreaterThan(-1);
    const frontendIdx = lines.findIndex((l) => l.includes("build:frontend"));
    const backendIdx = lines.findIndex((l) => l.includes("build:backend"));
    expect(headerIdx).toBeLessThan(frontendIdx);
    expect(headerIdx).toBeLessThan(backendIdx);
  });

  test("グループ内タスクは 2 スペースインデントで表示される", () => {
    const tasks = [
      { name: "lint:js", fn: () => {}, options: { desc: "js linter" } },
    ];
    const output = renderTaskList(tasks);
    const lines = output.split("\n");
    const jsLine = lines.find((l) => l.includes("lint:js"));
    expect(jsLine?.startsWith("  ")).toBe(true);
  });

  test("`:` なしと `:` ありタスクの混在で両方表示される", () => {
    const tasks = [
      { name: "clean", fn: () => {}, options: {} },
      { name: "build:frontend", fn: () => {}, options: {} },
      { name: "lint:js", fn: () => {}, options: {} },
    ];
    const output = renderTaskList(tasks);
    const lines = output.split("\n");
    expect(lines.some((l) => l === "build:")).toBe(true);
    expect(lines.some((l) => l === "lint:")).toBe(true);
    expect(output).toContain("clean");
  });

  test("グループ内タスクの desc が表示される", () => {
    const tasks = [
      {
        name: "build:frontend",
        fn: () => {},
        options: { desc: "フロントエンドビルド" },
      },
    ];
    const output = renderTaskList(tasks);
    expect(output).toContain("フロントエンドビルド");
  });
});

describe("issue #23: platform-specific tasks", () => {
  let originalCwd: string;
  let tempDir: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tempDir = resolve(
      "/tmp",
      `overbake-platform-${Date.now()}-${Math.random()}`,
    );
    mkdirSync(tempDir, { recursive: true });
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true });
    }
  });

  test("platforms に含まれないプラットフォームではタスクをスキップする", async () => {
    writeFileSync(
      resolve(tempDir, "Bakefile.ts"),
      `task("platform-task", { platforms: ["linux"] }, () => { globalThis.__platformTaskCalled = true; });`,
    );
    const g = globalThis as Record<string, unknown>;
    g.__platformTaskCalled = false;

    const plan = await buildPlan("platform-task");
    await executePlan(plan, { platform: "darwin", noSummary: true });

    expect(g.__platformTaskCalled).toBe(false);
    delete g.__platformTaskCalled;
  });

  test("platforms に含まれるプラットフォームではタスクを実行する", async () => {
    writeFileSync(
      resolve(tempDir, "Bakefile.ts"),
      `task("darwin-task", { platforms: ["darwin"] }, () => { globalThis.__darwinTaskCalled = true; });`,
    );
    const g = globalThis as Record<string, unknown>;
    g.__darwinTaskCalled = false;

    const plan = await buildPlan("darwin-task");
    await executePlan(plan, { platform: "darwin", noSummary: true });

    expect(g.__darwinTaskCalled).toBe(true);
    delete g.__darwinTaskCalled;
  });

  test("スキップログに platforms の理由が含まれる", async () => {
    writeFileSync(
      resolve(tempDir, "Bakefile.ts"),
      `task("skip-reason-task", { platforms: ["darwin"] }, () => {});`,
    );

    const plan = await buildPlan("skip-reason-task");
    const logLines: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => logLines.push(a.join(" "));

    try {
      await executePlan(plan, { platform: "linux", noSummary: true });
    } finally {
      console.log = orig;
    }

    expect(
      logLines.some((l) => l.includes("skipped") && l.includes("darwin")),
    ).toBe(true);
  });

  test("deps 経由で platforms 対象外タスクが含まれても後続タスクは実行される", async () => {
    writeFileSync(
      resolve(tempDir, "Bakefile.ts"),
      `task("platform-dep", { platforms: ["linux"] }, () => { globalThis.__depCalled = true; });
task("dependent", { deps: ["platform-dep"] }, () => { globalThis.__depTaskCalled = true; });`,
    );
    const g = globalThis as Record<string, unknown>;
    g.__depCalled = false;
    g.__depTaskCalled = false;

    const plan = await buildPlan("dependent");
    await executePlan(plan, { platform: "darwin", noSummary: true });

    expect(g.__depCalled).toBe(false);
    expect(g.__depTaskCalled).toBe(true);
    delete g.__depCalled;
    delete g.__depTaskCalled;
  });

  test("platforms 対象外では before/after hooks および fn を呼ばない", async () => {
    writeFileSync(
      resolve(tempDir, "Bakefile.ts"),
      `task("hook-task", {
  platforms: ["linux"],
  before: async () => { globalThis.__hookBeforeCalled = true; },
  after: async () => { globalThis.__hookAfterCalled = true; },
}, () => { globalThis.__hookFnCalled = true; });`,
    );
    const g = globalThis as Record<string, unknown>;
    g.__hookBeforeCalled = false;
    g.__hookAfterCalled = false;
    g.__hookFnCalled = false;

    const plan = await buildPlan("hook-task");
    await executePlan(plan, { platform: "darwin", noSummary: true });

    expect(g.__hookBeforeCalled).toBe(false);
    expect(g.__hookAfterCalled).toBe(false);
    expect(g.__hookFnCalled).toBe(false);
    delete g.__hookBeforeCalled;
    delete g.__hookAfterCalled;
    delete g.__hookFnCalled;
  });

  test("printExplain で platforms と skip 理由が表示される", async () => {
    writeFileSync(
      resolve(tempDir, "Bakefile.ts"),
      `task("explain-task", { platforms: ["darwin"] }, () => {});`,
    );
    const plan = await buildPlan("explain-task");
    const lines: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => lines.push(a.join(" "));

    printExplain(plan, { platform: "linux" });

    console.log = orig;
    expect(
      lines.some((l) => l.includes("platforms") && l.includes("darwin")),
    ).toBe(true);
    expect(lines.some((l) => l.includes("skip reason"))).toBe(true);
  });

  test("printExplain で実行対象プラットフォームでは skip 理由を表示しない", async () => {
    writeFileSync(
      resolve(tempDir, "Bakefile.ts"),
      `task("no-skip-task", { platforms: ["darwin"] }, () => {});`,
    );
    const plan = await buildPlan("no-skip-task");
    const lines: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => lines.push(a.join(" "));

    printExplain(plan, { platform: "darwin" });

    console.log = orig;
    expect(
      lines.some((l) => l.includes("platforms") && l.includes("darwin")),
    ).toBe(true);
    expect(lines.some((l) => l.includes("skip reason"))).toBe(false);
  });

  test("renderTaskList で platforms 情報が表示される", () => {
    const tasks = [
      {
        name: "open-finder",
        fn: () => {},
        options: {
          platforms: ["darwin"] as NodeJS.Platform[],
          desc: "Finder を開く",
        },
      },
      { name: "all-platforms", fn: () => {}, options: {} },
    ];
    const output = renderTaskList(tasks);
    expect(output).toContain("darwin only");
    expect(output).not.toMatch(/all-platforms.*only/);
  });

  test("スキップされたタスクはサマリーで skipped ステータスになる", async () => {
    writeFileSync(
      resolve(tempDir, "Bakefile.ts"),
      `task("skipped-task", { platforms: ["linux"] }, () => {});`,
    );

    const plan = await buildPlan("skipped-task");
    const summaryLines: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => summaryLines.push(a.join(" "));

    try {
      await executePlan(plan, { platform: "darwin" });
    } finally {
      console.log = orig;
    }

    const summaryOutput = summaryLines.join("\n");
    expect(summaryOutput).toContain("skipped");
  });
});

describe("issue #21: ワイルドカード CLI 統合テスト", () => {
  let originalCwd: string;
  let tempDir: string;
  let logs: string[] = [];
  let errors: string[] = [];
  let originalLog: typeof console.log;
  let originalError: typeof console.error;
  let originalExit: typeof process.exit;

  beforeEach(() => {
    originalCwd = process.cwd();
    tempDir = resolve(
      "/tmp",
      `overbake-wildcard-${Date.now()}-${Math.random()}`,
    );
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
    (process.exit as unknown) = () => {};
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

  test('bake "build:*" は build: で始まるタスクを全部実行する', async () => {
    writeFileSync(
      "Bakefile.ts",
      `task("build:frontend", () => { console.log("build:frontend"); });
task("build:backend", () => { console.log("build:backend"); });
task("test", () => { console.log("test"); });`,
    );

    await main(["build:*"]);

    expect(logs).toContain("build:frontend");
    expect(logs).toContain("build:backend");
    expect(logs).not.toContain("test");
  });

  test("0 件マッチのワイルドカードは exit code 2 で終了する", async () => {
    let exitCode: number | undefined;
    (process.exit as unknown) = (code?: number) => {
      exitCode = code;
    };

    writeFileSync("Bakefile.ts", `task("build", () => {});`);

    await main(["nonexistent:*"]);

    expect(exitCode).toBe(2);
    expect(errors.some((e) => e.includes("nonexistent:*"))).toBe(true);
  });

  test("bake -l はグループヘッダーを表示する", async () => {
    writeFileSync(
      "Bakefile.ts",
      `task("build:frontend", { desc: "フロントエンド" }, () => {});
task("build:backend", { desc: "バックエンド" }, () => {});
task("clean", { desc: "クリーン" }, () => {});`,
    );

    await main(["-l"]);

    const output = logs.join("\n");
    expect(output).toContain("build:");
    expect(output).toContain("build:frontend");
    expect(output).toContain("build:backend");
    expect(output).toContain("clean");
  });
});

// issue #30: bake doctor（Bakefile 静的検証）
describe("issue #30: bake doctor - parseArgs", () => {
  test('"doctor" を解析すると type=doctor になる', () => {
    const result = parseArgs(["doctor"]);
    expect(result.type).toBe("doctor");
  });
});

describe("issue #30: bake doctor - renderGlobalHelp", () => {
  test("renderGlobalHelp は doctor コマンドを含む", () => {
    const output = renderGlobalHelp();
    expect(output).toContain("doctor");
  });
});

describe("issue #30: bake doctor - runDoctor", () => {
  let originalCwd: string;
  let tempDir: string;
  let logs: string[] = [];
  let originalLog: typeof console.log;

  beforeEach(() => {
    originalCwd = process.cwd();
    tempDir = resolve("/tmp", `overbake-doctor-${Date.now()}-${Math.random()}`);
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

  test("正常な Bakefile.ts では 0 errors, 0 warnings で exit code 0 を返す", async () => {
    writeFileSync(".gitignore", ".overbake/\n");
    writeFileSync("Bakefile.ts", `task("build", () => {});`);

    const code = await runDoctor();

    expect(code).toBe(0);
    const output = logs.join("\n");
    expect(output).toContain("0 errors");
    expect(output).toContain("0 warnings");
  });

  test("未定義 deps は ERROR として検出し exit code 2 を返す", async () => {
    writeFileSync(".gitignore", ".overbake/\n");
    writeFileSync(
      "Bakefile.ts",
      `task("build", { deps: ["undefined-dep"] }, () => {});`,
    );

    const code = await runDoctor();

    expect(code).toBe(2);
    const output = logs.join("\n");
    expect(output).toContain("ERROR");
    expect(output).toContain("undefined-dep");
  });

  test("循環依存は ERROR として検出し exit code 2 を返す", async () => {
    writeFileSync(".gitignore", ".overbake/\n");
    writeFileSync(
      "Bakefile.ts",
      `task("a", { deps: ["b"] }, () => {});
task("b", { deps: ["a"] }, () => {});`,
    );

    const code = await runDoctor();

    expect(code).toBe(2);
    const output = logs.join("\n");
    expect(output).toContain("ERROR");
    expect(output).toContain("循環依存");
  });

  test("重複タスク登録は ERROR として検出し exit code 2 を返す", async () => {
    writeFileSync(".gitignore", ".overbake/\n");
    writeFileSync(
      "Bakefile.ts",
      `task("build", () => {});
task("build", () => {});`,
    );

    const code = await runDoctor();

    expect(code).toBe(2);
    const output = logs.join("\n");
    expect(output).toContain("ERROR");
    expect(output).toContain("already defined");
  });

  test("メタタスクに outputs が指定されている場合は ERROR として検出し exit code 2 を返す", async () => {
    writeFileSync(".gitignore", ".overbake/\n");
    writeFileSync("Bakefile.ts", `task("meta-task", { outputs: ["dist"] });`);

    const code = await runDoctor();

    expect(code).toBe(2);
    const output = logs.join("\n");
    expect(output).toContain("ERROR");
    expect(output).toContain("meta-task");
    expect(output).toContain("outputs");
  });

  test("inputs glob が 0 件マッチの場合は WARN として検出し exit code 0 を返す", async () => {
    writeFileSync(".gitignore", ".overbake/\n");
    writeFileSync(
      "Bakefile.ts",
      `task("build", { inputs: ["nonexistent/**/*.ts"] }, () => {});`,
    );

    const code = await runDoctor();

    expect(code).toBe(0);
    const output = logs.join("\n");
    expect(output).toContain("WARN");
    expect(output).toContain("0 件");
    expect(output).toContain("0 errors");
  });

  test(".gitignore が無い場合は WARN として検出し exit code 0 を返す", async () => {
    writeFileSync("Bakefile.ts", `task("build", () => {});`);

    const code = await runDoctor();

    expect(code).toBe(0);
    const output = logs.join("\n");
    expect(output).toContain("WARN");
    expect(output).toContain(".gitignore");
    expect(output).toContain("0 errors");
  });

  test(".gitignore に .overbake/ が無い場合は WARN として検出し exit code 0 を返す", async () => {
    writeFileSync(".gitignore", "node_modules/\n");
    writeFileSync("Bakefile.ts", `task("build", () => {});`);

    const code = await runDoctor();

    expect(code).toBe(0);
    const output = logs.join("\n");
    expect(output).toContain("WARN");
    expect(output).toContain(".overbake/");
    expect(output).toContain("0 errors");
  });

  test("Bakefile.ts が無い場合は ERROR として検出し exit code 2 を返す", async () => {
    const code = await runDoctor();

    expect(code).toBe(2);
    const output = logs.join("\n");
    expect(output).toContain("ERROR");
  });

  test("error が複数ある場合も全件表示する", async () => {
    writeFileSync(".gitignore", ".overbake/\n");
    writeFileSync(
      "Bakefile.ts",
      `task("build", { deps: ["missing1"] }, () => {});
task("test", { deps: ["missing2"] }, () => {});`,
    );

    const code = await runDoctor();

    expect(code).toBe(2);
    const output = logs.join("\n");
    expect(output).toContain("missing1");
    expect(output).toContain("missing2");
  });

  test("wildcard を含む deps は未対応なので ERROR として検出し exit code 2 を返す", async () => {
    writeFileSync(".gitignore", ".overbake/\n");
    writeFileSync(
      "Bakefile.ts",
      `task("deploy", { deps: ["build:*"] }, () => {});`,
    );

    const code = await runDoctor();

    expect(code).toBe(2);
    const output = logs.join("\n");
    expect(output).toContain("ERROR");
    expect(output).toContain("build:*");
  });
});

describe("issue #30: bake doctor - main 統合テスト", () => {
  let originalCwd: string;
  let tempDir: string;
  let logs: string[] = [];
  let errors: string[] = [];
  let originalLog: typeof console.log;
  let originalError: typeof console.error;
  let originalExit: typeof process.exit;

  beforeEach(() => {
    originalCwd = process.cwd();
    tempDir = resolve(
      "/tmp",
      `overbake-doctor-main-${Date.now()}-${Math.random()}`,
    );
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
    (process.exit as unknown) = () => {};
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

  test("main doctor は正常な Bakefile.ts で 0 errors を出力する", async () => {
    writeFileSync(".gitignore", ".overbake/\n");
    writeFileSync("Bakefile.ts", `task("build", () => {});`);

    let exitCode: number | undefined;
    (process.exit as unknown) = (code?: number) => {
      exitCode = code;
    };

    await main(["doctor"]);

    const output = logs.join("\n");
    expect(output).toContain("0 errors");
    expect(exitCode).toBeUndefined();
  });

  test("main doctor はエラーがある場合に exit code 2 で終了する", async () => {
    writeFileSync(".gitignore", ".overbake/\n");
    writeFileSync(
      "Bakefile.ts",
      `task("build", { deps: ["no-such-task"] }, () => {});`,
    );

    let exitCode: number | undefined;
    (process.exit as unknown) = (code?: number) => {
      exitCode = code;
    };

    await main(["doctor"]);

    expect(exitCode).toBe(2);
    const output = logs.join("\n");
    expect(output).toContain("ERROR");
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

describe("createTaskContext onOutput", () => {
  test("cmd output and log are routed to onOutput", async () => {
    const chunks: string[] = [];
    const ctx = createTaskContext({
      name: "t",
      root: process.cwd(),
      onOutput: (text) => chunks.push(text),
    });
    await ctx.cmd("echo", ["hello-onoutput"]);
    ctx.log("logged-line");
    const all = chunks.join("");
    expect(all).toContain("hello-onoutput");
    expect(all).toContain("logged-line");
  });

  test("cmd rejects on non-zero exit even with onOutput", async () => {
    const ctx = createTaskContext({
      name: "t",
      root: process.cwd(),
      onOutput: () => {},
    });
    await expect(ctx.cmd("sh", ["-c", "exit 3"])).rejects.toThrow();
  });
});

describe("ctx.runEach", () => {
  let writes: string[];
  let origWrite: typeof process.stdout.write;

  beforeEach(() => {
    writes = [];
    origWrite = process.stdout.write.bind(process.stdout);
    (process.stdout.write as unknown) = (chunk: string | Uint8Array) => {
      writes.push(typeof chunk === "string" ? chunk : chunk.toString());
      return true;
    };
  });

  afterEach(() => {
    process.stdout.write = origWrite;
  });

  function makeCtx() {
    return createTaskContext({ name: "parent", root: process.cwd() });
  }

  test("runs all items and prints the done message on success", async () => {
    await makeCtx().runEach({ done: "ALL GOOD" }, ["echo", ["one"]], {
      name: "two",
      fn: async (c) => {
        await c.cmd("echo", ["two-ran"]);
      },
    });
    const out = writes.join("");
    expect(out).toContain("Running parent...");
    expect(out).toContain("- echo one... ✅");
    expect(out).toContain("- two... ✅");
    expect(out).toContain("ALL GOOD");
  });

  test("fail-fast: stops at the first failure and surfaces its output", async () => {
    let secondRan = false;
    await expect(
      makeCtx().runEach(["sh", ["-c", "echo BOOM-OUTPUT >&2; exit 1"]], {
        name: "second",
        fn: () => {
          secondRan = true;
        },
      }),
    ).rejects.toThrow("runEach failed");
    expect(secondRan).toBe(false);
    const out = writes.join("");
    expect(out).toContain("❌");
    expect(out).toContain("BOOM-OUTPUT");
  });

  test("keepGoing: runs everything and reports all failures", async () => {
    let thirdRan = false;
    await expect(
      makeCtx().runEach(
        { keepGoing: true },
        ["sh", ["-c", "exit 1"]],
        ["sh", ["-c", "exit 1"]],
        {
          name: "third",
          fn: () => {
            thirdRan = true;
          },
        },
      ),
    ).rejects.toThrow("runEach failed");
    expect(thirdRan).toBe(true);
  });

  test("uses a default done message when none is provided", async () => {
    await makeCtx().runEach(["echo", ["x"]]);
    expect(writes.join("")).toContain("✨ done (1 task(s))");
  });
});
