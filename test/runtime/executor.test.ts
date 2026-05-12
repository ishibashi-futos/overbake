import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildPlan,
  createTaskContext,
  executePlan,
  printDryRun,
  printExplain,
} from "../../src/runtime/executor.ts";
import { useTempDir } from "../support/sandbox.ts";

describe("printDryRun / printExplain", () => {
  const tmp = useTempDir("overbake-test", { chdir: true });

  test("printDryRun はタスク名を出力しタスク関数を実行しない", async () => {
    writeFileSync(
      resolve(tmp.path, "Bakefile.ts"),
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
      resolve(tmp.path, "Bakefile.ts"),
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
      resolve(tmp.path, "Bakefile.ts"),
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
});

describe("task.each と実行プラン", () => {
  const tmp = useTempDir("overbake-each", { chdir: true });

  test("task.each タスクの plan.tasks は本体 1 件のみ（工程は deps に展開されない）", async () => {
    writeFileSync(
      resolve(tmp.path, "Bakefile.ts"),
      `const a = task("a", () => {});
const b = task("b", () => {});
task.each("sanity", a, b);`,
    );
    const plan = await buildPlan("sanity");
    expect(plan.tasks.map((t) => t.name)).toEqual(["sanity"]);
    expect(plan.tasks[0]?.options?.each).toEqual([
      { kind: "task", name: "a", desc: undefined },
      { kind: "task", name: "b", desc: undefined },
    ]);
  });
});

describe("executePlan verbose logging", () => {
  const tmp = useTempDir("overbake-verbose", { chdir: true });

  test("executePlan with verbose logs plan details", async () => {
    const bakefileContent = `
task("a", () => {
  console.log("task a");
});

task("b", { deps: ["a"] }, () => {
  console.log("task b");
});
`;

    writeFileSync(resolve(tmp.path, "Bakefile.ts"), bakefileContent);

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

    writeFileSync(resolve(tmp.path, "Bakefile.ts"), bakefileContent);

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
  const tmp = useTempDir("overbake-keep-going", { chdir: true });

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

    writeFileSync(resolve(tmp.path, "Bakefile.ts"), bakefileContent);

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

    writeFileSync(resolve(tmp.path, "Bakefile.ts"), bakefileContent);

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

    writeFileSync(resolve(tmp.path, "Bakefile.ts"), bakefileContent);

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
  const tmp = useTempDir("overbake-quiet", { chdir: true });

  test("--quiet suppresses task console.log output", async () => {
    const bakefileContent = `
task("output-task", () => {
  console.log("task output");
});
`;

    writeFileSync(resolve(tmp.path, "Bakefile.ts"), bakefileContent);

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

    writeFileSync(resolve(tmp.path, "Bakefile.ts"), bakefileContent);

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

    writeFileSync(resolve(tmp.path, "Bakefile.ts"), bakefileContent);

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

    writeFileSync(resolve(tmp.path, "Bakefile.ts"), bakefileContent);

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

// issue #14: confirm プロンプト - executePlan confirm 動作
describe("confirm プロンプト (#14) - executePlan confirm 動作", () => {
  const tmp = useTempDir("overbake-confirm", { chdir: true });

  test("options.yes=true なら confirmFn を呼ばずにタスクを実行する", async () => {
    writeFileSync(
      resolve(tmp.path, "Bakefile.ts"),
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
      resolve(tmp.path, "Bakefile.ts"),
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
      resolve(tmp.path, "Bakefile.ts"),
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
    const { createDefaultConfirm } = await import(
      "../../src/runtime/executor.ts"
    );

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

describe("executePlan - サマリー出力", () => {
  const tmp = useTempDir("overbake-summary", { chdir: true });

  test("実行後に Summary が console.log に出力される", async () => {
    writeFileSync(
      resolve(tmp.path, "Bakefile.ts"),
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
    writeFileSync(resolve(tmp.path, "Bakefile.ts"), `task("a", () => {});`);
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
      resolve(tmp.path, "Bakefile.ts"),
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
      resolve(tmp.path, "Bakefile.ts"),
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
      resolve(tmp.path, "Bakefile.ts"),
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
      resolve(tmp.path, "Bakefile.ts"),
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

describe("issue #23: platform-specific tasks", () => {
  const tmp = useTempDir("overbake-platform", { chdir: true });

  test("platforms に含まれないプラットフォームではタスクをスキップする", async () => {
    writeFileSync(
      resolve(tmp.path, "Bakefile.ts"),
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
      resolve(tmp.path, "Bakefile.ts"),
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
      resolve(tmp.path, "Bakefile.ts"),
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
      resolve(tmp.path, "Bakefile.ts"),
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
      resolve(tmp.path, "Bakefile.ts"),
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
      resolve(tmp.path, "Bakefile.ts"),
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
      resolve(tmp.path, "Bakefile.ts"),
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

  test("スキップされたタスクはサマリーで skipped ステータスになる", async () => {
    writeFileSync(
      resolve(tmp.path, "Bakefile.ts"),
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
