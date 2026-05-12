import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { loadBakefile } from "../../src/bakefile/loader.ts";
import { TaskRegistry } from "../../src/bakefile/registry.ts";
import { main } from "../../src/cli/main.ts";
import { createTaskContext } from "../../src/runtime/executor.ts";
import {
  useConsoleCapture,
  useProcessExitMock,
  useTempDir,
} from "../support/sandbox.ts";

describe("CLI integration", () => {
  const tmp = useTempDir("overbake-test", { chdir: true });
  const { logs } = useConsoleCapture();
  useProcessExitMock();

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

    const bakefilePath = resolve(tmp.path, "Bakefile.ts");
    const registry = new TaskRegistry();
    await loadBakefile(bakefilePath, registry);
    const task = registry.get("contexted");
    expect(task).toBeDefined();
    if (task) {
      const ctx = createTaskContext({ name: "contexted", root: tmp.path });
      await task.fn(ctx);

      expect(ctx.name).toBe("contexted");
      expect(ctx.root).toBe(tmp.path);
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

    const bakefilePath = resolve(tmp.path, "Bakefile.ts");
    const registry = new TaskRegistry();
    await loadBakefile(bakefilePath, registry);
    const task = registry.get("run-cmd");
    expect(task).toBeDefined();
    if (task) {
      const ctx = createTaskContext({ name: "run-cmd", root: tmp.path });
      // Should not throw
      await task.fn(ctx);
    }
  });

  test("ctx.rm removes files with root as base", async () => {
    const subDir = resolve(tmp.path, "subdir");
    mkdirSync(subDir, { recursive: true });
    const testFile = resolve(subDir, "test.txt");
    writeFileSync(testFile, "test content");

    expect(existsSync(testFile)).toBe(true);

    const ctx = createTaskContext({ name: "test", root: tmp.path });
    await ctx.rm("subdir", { recursive: true });

    expect(existsSync(subDir)).toBe(false);
  });

  test("ctx.exists checks file existence relative to root", async () => {
    const subDir = resolve(tmp.path, "check-dir");
    mkdirSync(subDir, { recursive: true });
    const testFile = resolve(subDir, "exists.txt");
    writeFileSync(testFile, "test");

    const ctx = createTaskContext({ name: "test", root: tmp.path });

    expect(ctx.exists("check-dir/exists.txt")).toBe(true);
    expect(ctx.exists("nonexistent.txt")).toBe(false);
  });

  test("ctx.resolve returns absolute path relative to root", async () => {
    const ctx = createTaskContext({ name: "test", root: tmp.path });

    const resolved = ctx.resolve("subdir", "file.txt");
    expect(resolved).toBe(resolve(tmp.path, "subdir", "file.txt"));
  });

  test("ctx.cwd is user's working directory, ctx.root is Bakefile directory", async () => {
    const bakefileContent = `
task("check-paths", (ctx) => {
  globalThis.capturedCwd = ctx.cwd;
  globalThis.capturedRoot = ctx.root;
});
`;
    writeFileSync("Bakefile.ts", bakefileContent);

    const subDir = resolve(tmp.path, "work");
    mkdirSync(subDir, { recursive: true });
    process.chdir(subDir);

    const g = globalThis as Record<string, unknown>;
    await main(["check-paths"]);

    expect(realpathSync(g.capturedCwd as string)).toBe(realpathSync(subDir));
    expect(realpathSync(g.capturedRoot as string)).toBe(realpathSync(tmp.path));
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

describe("main --dry-run / --explain", () => {
  const tmp = useTempDir("overbake-test", { chdir: true });

  test("main --dry-run はタスク関数を呼ばない", async () => {
    writeFileSync(
      resolve(tmp.path, "Bakefile.ts"),
      `task("mytask", () => { globalThis.__dryRunCalled = true; });`,
    );
    const g = globalThis as Record<string, unknown>;
    g.__dryRunCalled = false;
    await main(["mytask", "--dry-run"]);
    expect(g.__dryRunCalled).toBe(false);
  });

  test("main multiple tasks --dry-run shows execution plan", async () => {
    writeFileSync(
      resolve(tmp.path, "Bakefile.ts"),
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
      resolve(tmp.path, "Bakefile.ts"),
      `task("mytask", () => { globalThis.__explainCalled = true; });`,
    );
    const g = globalThis as Record<string, unknown>;
    g.__explainCalled = false;
    await main(["mytask", "--explain"]);
    expect(g.__explainCalled).toBe(false);
  });
});

describe("CLI help/list integration", () => {
  useTempDir("overbake-cli-test", { chdir: true });
  const { logs, errors } = useConsoleCapture();
  const exitCode = useProcessExitMock();

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

    await main(["--help", "build-dev"]);

    const output = errors.join("\n");
    expect(output).toContain("build-dev");
    expect(output).toContain("Did you mean");
    expect(output).toContain("build");
    expect(exitCode()).toBe(2);
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

    await main([]);

    expect(exitCode()).toBe(2);
    const output = errors.join("\n");
    expect(output).toContain("Default task is already set");
  });
});

// issue #16: シェル補完スクリプト生成 - main 統合テスト
describe("シェル補完 (#16) - main 統合テスト", () => {
  useTempDir("overbake-completions-test", { chdir: true });
  const { logs, errors } = useConsoleCapture();
  const exitCode = useProcessExitMock();

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
    await main(["completions", "unknown-shell"]);
    expect(exitCode()).toBe(2);
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
  useTempDir("overbake-confirm-main", { chdir: true });
  useProcessExitMock();

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

describe("--graph フラグ integration", () => {
  useTempDir("overbake-graph", { chdir: true });
  const exitCode = useProcessExitMock();

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

    const errors: string[] = [];
    const origError = console.error;
    console.error = (...a: unknown[]) => errors.push(a.join(" "));

    await main(["build", "--graph=svg"]);

    console.error = origError;

    expect(exitCode()).toBe(2);
    expect(errors.some((e) => e.includes("svg"))).toBe(true);
  });
});

describe("issue #21: ワイルドカード CLI 統合テスト", () => {
  useTempDir("overbake-wildcard", { chdir: true });
  const { logs, errors } = useConsoleCapture();
  const exitCode = useProcessExitMock();

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
    writeFileSync("Bakefile.ts", `task("build", () => {});`);

    await main(["nonexistent:*"]);

    expect(exitCode()).toBe(2);
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

// issue #30: bake doctor - main 統合テスト
describe("bake doctor - main 統合テスト", () => {
  useTempDir("overbake-doctor-main", { chdir: true });
  const { logs } = useConsoleCapture();
  const exitCode = useProcessExitMock();

  test("main doctor は正常な Bakefile.ts で 0 errors を出力する", async () => {
    writeFileSync(".gitignore", ".overbake/\n");
    writeFileSync("Bakefile.ts", `task("build", () => {});`);

    await main(["doctor"]);

    const output = logs.join("\n");
    expect(output).toContain("0 errors");
    expect(exitCode()).toBeUndefined();
  });

  test("main doctor はエラーがある場合に exit code 2 で終了する", async () => {
    writeFileSync(".gitignore", ".overbake/\n");
    writeFileSync(
      "Bakefile.ts",
      `task("build", { deps: ["no-such-task"] }, () => {});`,
    );

    await main(["doctor"]);

    expect(exitCode()).toBe(2);
    const output = logs.join("\n");
    expect(output).toContain("ERROR");
  });
});
