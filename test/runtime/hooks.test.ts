import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildPlan,
  createTaskContext,
  executePlan,
} from "../../src/runtime/executor.ts";
import { runWithHooks } from "../../src/runtime/hooks.ts";
import { useTempDir } from "../support/sandbox.ts";

describe("runWithHooks / executePlan の before/after hooks", () => {
  const tmp = useTempDir("overbake-hooks-test");

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
      root: tmp.path,
      cwd: tmp.path,
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
      root: tmp.path,
      cwd: tmp.path,
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
      root: tmp.path,
      cwd: tmp.path,
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
      root: tmp.path,
      cwd: tmp.path,
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
      root: tmp.path,
      cwd: tmp.path,
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

    writeFileSync(resolve(tmp.path, "Bakefile.ts"), bakefileContent);

    const g = globalThis as Record<string, unknown>;
    g.__hookLog = [];

    const originalCwd = process.cwd();
    process.chdir(tmp.path);

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
});
