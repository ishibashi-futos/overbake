import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { TaskRegistry } from "../../src/bakefile/registry.ts";
import { InvalidScheduleError } from "../../src/cron/schedule.ts";
import { runCompose } from "../../src/runtime/compose.ts";
import { createTaskContext } from "../../src/runtime/context.ts";
import { runCron } from "../../src/runtime/cron.ts";
import type { RunEachItem, Task } from "../../src/types.ts";
import { useTempDir } from "../support/sandbox.ts";

/** 出力をバッファへ集めるヘルパー */
function makeWrite(): { chunks: string[]; write: (text: string) => void } {
  const chunks: string[] = [];
  return { chunks, write: (text) => chunks.push(text) };
}

/** 待機せずに即座に解決する sleepUntil（テストで時間を進めない） */
const noSleep = async (): Promise<void> => {};

describe("runCron", () => {
  const tmp = useTempDir("overbake-cron");

  function deps(write: (text: string) => void, abortSignal?: AbortSignal) {
    return {
      taskName: "scheduled",
      root: tmp.path,
      cwd: tmp.path,
      createContext: createTaskContext,
      write,
      abortSignal,
    };
  }

  test("maxRuns に達するまで工程を繰り返し実行する", async () => {
    const calls: number[] = [];
    const job: Task = {
      name: "job",
      fn: () => {
        calls.push(calls.length);
      },
    };
    const out = makeWrite();

    await runCron(deps(out.write), "@every 1s", [job], {
      sleepUntil: noSleep,
      maxRuns: 3,
    });

    expect(calls).toHaveLength(3);
    expect(out.chunks.join("")).toContain("schedule: @every 1s");
    expect(out.chunks.join("")).toContain("next run at");
  });

  test("工程が失敗してもスケジューラは止まらず次の発火を続ける", async () => {
    let attempts = 0;
    const flaky: Task = {
      name: "flaky",
      fn: () => {
        attempts += 1;
        if (attempts === 1) throw new Error("boom");
      },
    };
    const out = makeWrite();

    await runCron(deps(out.write), "@every 1s", [flaky], {
      sleepUntil: noSleep,
      maxRuns: 3,
    });

    expect(attempts).toBe(3);
    const text = out.chunks.join("");
    expect(text).toContain("run failed");
    expect(text).toContain("boom");
  });

  test("abort 済みシグナルなら 1 度も実行しない", async () => {
    let ran = false;
    const job: Task = {
      name: "job",
      fn: () => {
        ran = true;
      },
    };
    const controller = new AbortController();
    controller.abort();
    const out = makeWrite();

    await runCron(deps(out.write, controller.signal), "@every 1s", [job], {
      sleepUntil: noSleep,
      maxRuns: 5,
    });

    expect(ran).toBe(false);
  });

  test("実行中に abort されると次の発火を待たずに終了する", async () => {
    const controller = new AbortController();
    let runs = 0;
    const job: Task = {
      name: "job",
      fn: () => {
        runs += 1;
        // 1 回実行したら停止させる（compose の fail-fast / Ctrl+C 相当）
        controller.abort();
      },
    };
    const out = makeWrite();

    await runCron(deps(out.write, controller.signal), "@every 1s", [job], {
      sleepUntil: noSleep,
      maxRuns: 10,
    });

    expect(runs).toBe(1);
  });

  test("出力は write へ流れ、stdout へ直接書かない", async () => {
    const job: Task = { name: "job", fn: () => {} };
    const out = makeWrite();

    await runCron(deps(out.write), "@every 1s", [job], {
      sleepUntil: noSleep,
      maxRuns: 1,
    });

    const text = out.chunks.join("");
    expect(text).toContain("Running scheduled...");
    expect(text).toContain("job");
  });

  test("次回時刻は実行完了後に計算する（多重起動しない）", async () => {
    const nowValues = [
      new Date(2026, 7, 21, 10, 0, 0),
      new Date(2026, 7, 21, 10, 5, 0),
    ];
    let index = 0;
    const requested: Date[] = [];
    const job: Task = { name: "job", fn: () => {} };
    const out = makeWrite();

    await runCron(deps(out.write), "@every 1m", [job], {
      now: () => nowValues[Math.min(index++, nowValues.length - 1)] as Date,
      sleepUntil: async (until) => {
        requested.push(until);
      },
      maxRuns: 2,
    });

    // 2 回目の待機開始は「1 回目の実行が終わった後の現在時刻」基準になる
    expect(requested).toHaveLength(2);
    expect(requested[0]).toEqual(new Date(2026, 7, 21, 10, 1, 0));
    expect(requested[1]).toEqual(new Date(2026, 7, 21, 10, 6, 0));
  });

  test("不正なスケジュールは実行前に InvalidScheduleError", async () => {
    const out = makeWrite();
    const items: RunEachItem[] = [];
    await expect(
      runCron(deps(out.write), "not a cron", items, {
        sleepUntil: noSleep,
        maxRuns: 1,
      }),
    ).rejects.toThrow(InvalidScheduleError);
  });
});

// SIGINT による停止確認を含むため POSIX 前提
const describeIfPosix = process.platform === "win32" ? describe.skip : describe;

describeIfPosix("task.cron と task.compose の組み合わせ", () => {
  const tmp = useTempDir("overbake-cron-compose");

  test("compose 配下の cron タスクは prefix 付きで出力し、停止シグナルで終了する", async () => {
    writeFileSync(resolve(tmp.path, "tick.ts"), `console.log("TICKED");\n`);

    const registry = new TaskRegistry();
    const cronTask = registry.registerCron(
      "ticker",
      { schedule: "@every 1s" },
      ["bun", ["tick.ts"]],
    );

    const chunks: string[] = [];
    const composePromise = runCompose(
      { taskName: "dev", root: tmp.path, cwd: tmp.path },
      [cronTask],
      { graceMs: 100, noColor: true, writeOut: (t) => chunks.push(t) },
    );

    // 1 回発火するまで待つ
    const deadline = Date.now() + 10_000;
    while (!chunks.join("").includes("✅") && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }

    // Ctrl+C 相当。runCompose が全サービスへ停止を伝播する
    process.emit("SIGINT");
    await composePromise;

    const output = chunks.join("");
    expect(output).toContain("[ticker]");
    expect(output).toContain("schedule: @every 1s");
    expect(output).toContain("Running ticker...");
  }, 15_000);
});
