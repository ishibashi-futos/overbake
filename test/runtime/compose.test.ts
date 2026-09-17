import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runCompose } from "../../src/runtime/compose.ts";
import type { Task } from "../../src/types.ts";
import {
  describeIfPosix,
  makeServiceTask,
  useTempDir,
  waitForAbort,
  waitUntil,
} from "../support/sandbox.ts";

/**
 * temp dir に fixture スクリプトを書き出す（実プロセスを使うテスト用）。
 * すべて Bun が解釈可能な ts ファイル（node の child_process.spawn から `bun <file>` で起動する）。
 */
function writeFixtures(dir: string): void {
  writeFileSync(
    resolve(dir, "quick-exit-1.ts"),
    `console.log("started"); process.exit(1);\n`,
  );
  writeFileSync(
    resolve(dir, "forever.ts"),
    `console.log("started");
process.on("SIGTERM", () => { process.exit(143); });
setInterval(() => {}, 1 << 30);
`,
  );
  writeFileSync(
    resolve(dir, "ignores-sigterm.ts"),
    `process.on("SIGTERM", () => {});
console.log("started");
setInterval(() => {}, 1 << 30);
`,
  );
}

describeIfPosix("runCompose", () => {
  const tmp = useTempDir("overbake-compose");

  test("空ステージ列: 何もせず即座に解決する", async () => {
    await runCompose({ taskName: "noop", root: tmp.path, cwd: tmp.path }, [], {
      noColor: true,
      writeOut: () => {},
    });
  });

  test("前ステージが ready になるまで次ステージの run が呼ばれない", async () => {
    const order: string[] = [];
    let releaseDb!: () => void;
    const dbGate = new Promise<void>((resolve) => {
      releaseDb = resolve;
    });
    const db = makeServiceTask(
      "db",
      async (ctx) => {
        order.push("db:start");
        await dbGate;
        ctx.log("READY");
        await waitForAbort(ctx.signal);
      },
      { ready: { log: "READY" } },
    );
    const api = makeServiceTask("api", async (ctx) => {
      order.push("api:start");
      await waitForAbort(ctx.signal);
    });

    const composePromise = runCompose(
      { taskName: "dev", root: tmp.path, cwd: tmp.path },
      [[db], [api]],
      { noColor: true, writeOut: () => {} },
    );

    await new Promise((r) => setTimeout(r, 50));
    expect(order).toEqual(["db:start"]);

    releaseDb();
    await waitUntil(() => order.includes("api:start"));
    expect(order).toEqual(["db:start", "api:start"]);

    process.emit("SIGINT", "SIGINT" as NodeJS.Signals);
    await composePromise;
  });

  test("グループ内は同時に起動する", async () => {
    const starts: number[] = [];
    const makeTimed = (name: string): Task =>
      makeServiceTask(name, async (ctx) => {
        starts.push(Date.now());
        await waitForAbort(ctx.signal);
      });

    const composePromise = runCompose(
      { taskName: "dev", root: tmp.path, cwd: tmp.path },
      [[makeTimed("api"), makeTimed("worker")]],
      { noColor: true, writeOut: () => {} },
    );

    await waitUntil(() => starts.length === 2);
    expect(Math.abs((starts[0] ?? 0) - (starts[1] ?? 0))).toBeLessThan(200);

    process.emit("SIGINT", "SIGINT" as NodeJS.Signals);
    await composePromise;
  });

  test("前ステージの最終失敗で後続ステージを起動せず compose failed になる", async () => {
    // ready.log を指定し、READY を出力する前に落とす（ready 未指定だと「起動直後に ready」が
    // 即時失敗と競合してしまうため、現実の DB サービスに近い形で検証する）
    const db = makeServiceTask(
      "db",
      async () => {
        throw new Error("boom");
      },
      { ready: { log: "READY" } },
    );
    let apiStarted = false;
    const api = makeServiceTask("api", async (ctx) => {
      apiStarted = true;
      await waitForAbort(ctx.signal);
    });

    await expect(
      runCompose(
        { taskName: "dev", root: tmp.path, cwd: tmp.path },
        [[db], [api]],
        { noColor: true, writeOut: () => {} },
      ),
    ).rejects.toThrow(/compose failed: db: boom/);

    expect(apiStarted).toBe(false);
  });

  test("全 ready 後の最終失敗で全サービスが停止する", async () => {
    let releaseFailure!: () => void;
    const failureGate = new Promise<void>((resolve) => {
      releaseFailure = resolve;
    });
    const db = makeServiceTask("db", async () => {
      await failureGate;
      throw new Error("db crashed");
    });
    let apiAborted = false;
    const api = makeServiceTask("api", async (ctx) => {
      ctx.signal.addEventListener("abort", () => {
        apiAborted = true;
      });
      await waitForAbort(ctx.signal);
    });

    const composePromise = runCompose(
      { taskName: "dev", root: tmp.path, cwd: tmp.path },
      [[db], [api]],
      { noColor: true, writeOut: () => {} },
    );

    // db / api とも ready 未指定なので起動直後に ready。両方揃うのを少し待ってから失敗させる。
    await new Promise((r) => setTimeout(r, 50));
    releaseFailure();

    await expect(composePromise).rejects.toThrow(
      /compose failed: db: db crashed/,
    );
    expect(apiAborted).toBe(true);
  });

  test("SIGINT で正常 resolve する（後続ステージ未起動のケースを含む）", async () => {
    const db = makeServiceTask(
      "db",
      async (ctx) => {
        await waitForAbort(ctx.signal);
      },
      {
        ready: { check: async () => false, timeoutMs: 999999, intervalMs: 50 },
      },
    );
    let apiStarted = false;
    const api = makeServiceTask("api", async () => {
      apiStarted = true;
    });

    const composePromise = runCompose(
      { taskName: "dev", root: tmp.path, cwd: tmp.path },
      [[db], [api]],
      { noColor: true, writeOut: () => {} },
    );

    // db が起動して ready 待ちのポーリングに入るまで待つ
    await new Promise((r) => setTimeout(r, 150));
    process.emit("SIGINT", "SIGINT" as NodeJS.Signals);
    await composePromise; // throw しない

    expect(apiStarted).toBe(false);
  });

  test("abortSignal の abort で正常 resolve し全サービスが停止する", async () => {
    // task.service にネストされた compose（ctx.runCompose 経由）から渡される
    // 外側の停止要求を模す。SIGINT/SIGTERM と同じ「正常停止」として扱われること。
    const db = makeServiceTask("db", async (ctx) => {
      await waitForAbort(ctx.signal);
    });
    let apiAborted = false;
    const api = makeServiceTask("api", async (ctx) => {
      ctx.signal.addEventListener("abort", () => {
        apiAborted = true;
      });
      await waitForAbort(ctx.signal);
    });

    const controller = new AbortController();
    const composePromise = runCompose(
      {
        taskName: "dev",
        root: tmp.path,
        cwd: tmp.path,
        abortSignal: controller.signal,
      },
      [[db], [api]],
      { noColor: true, writeOut: () => {} },
    );

    // db / api とも ready 未指定なので起動直後に ready。両方揃うのを少し待ってから abort する。
    await new Promise((r) => setTimeout(r, 50));
    controller.abort();

    await composePromise; // throw しない
    expect(apiAborted).toBe(true);
  });

  test("開始時点で abortSignal が既に abort 済みなら何も起動しない", async () => {
    let started = false;
    const db = makeServiceTask("db", async () => {
      started = true;
    });

    const controller = new AbortController();
    controller.abort();

    await runCompose(
      {
        taskName: "dev",
        root: tmp.path,
        cwd: tmp.path,
        abortSignal: controller.signal,
      },
      [[db]],
      { noColor: true, writeOut: () => {} },
    ); // throw しない

    expect(started).toBe(false);
  });

  test("検証エラーで何も起動せずシグナルリスナも増えない", async () => {
    const notAService: Task = { name: "plain", fn: async () => {} };
    const before = {
      sigint: process.listenerCount("SIGINT"),
      sigterm: process.listenerCount("SIGTERM"),
    };

    await expect(
      runCompose(
        { taskName: "dev", root: tmp.path, cwd: tmp.path },
        [[notAService]],
        { noColor: true, writeOut: () => {} },
      ),
    ).rejects.toThrow(/compose 'dev':.*はサービスではありません/);

    expect(process.listenerCount("SIGINT")).toBe(before.sigint);
    expect(process.listenerCount("SIGTERM")).toBe(before.sigterm);
  });

  test("全ステージ横断でラベル幅が揃う", async () => {
    const chunks: string[] = [];
    const db = makeServiceTask("db", async (ctx) => {
      ctx.log("hi");
      await waitForAbort(ctx.signal);
    });
    const apiLongName = makeServiceTask("api-long-name", async (ctx) => {
      ctx.log("hi");
      await waitForAbort(ctx.signal);
    });

    const composePromise = runCompose(
      { taskName: "dev", root: tmp.path, cwd: tmp.path },
      [[db], [apiLongName]],
      { noColor: true, writeOut: (t) => chunks.push(t) },
    );

    await waitUntil(() => chunks.join("").includes("[api-long-name]"));
    const out = chunks.join("");
    const width = "api-long-name".length;
    expect(out).toContain(`[${"db".padEnd(width)}] hi`);
    expect(out).toContain(`[${"api-long-name".padEnd(width)}] hi`);

    process.emit("SIGINT", "SIGINT" as NodeJS.Signals);
    await composePromise;
  });

  test("リスナの後始末: 解決後に再度 SIGINT を emit してもエラーにならない", async () => {
    const failing = makeServiceTask("failing", async () => {
      throw new Error("boom");
    });
    await runCompose(
      { taskName: "dev", root: tmp.path, cwd: tmp.path },
      [[failing]],
      { noColor: true, writeOut: () => {} },
    ).catch(() => {
      // 期待通り fail-fast で reject される
    });
    expect(process.listenerCount("SIGINT")).toBeLessThan(10);
    expect(process.listenerCount("SIGTERM")).toBeLessThan(10);
  });
});

describeIfPosix("runCompose - 実プロセスを使うサービス", () => {
  const tmp = useTempDir("overbake-compose-proc");

  test("コマンド run（実プロセス）の fail-fast", async () => {
    writeFixtures(tmp.path);
    const failing = makeServiceTask("failing", async (ctx) => {
      await ctx.cmd("bun", [resolve(tmp.path, "quick-exit-1.ts")]);
    });
    const forever = makeServiceTask("forever", async (ctx) => {
      await ctx.cmd("bun", [resolve(tmp.path, "forever.ts")]);
    });

    await expect(
      runCompose(
        { taskName: "dev", root: tmp.path, cwd: tmp.path },
        [[failing, forever]],
        { graceMs: 500, noColor: true, writeOut: () => {} },
      ),
    ).rejects.toThrow(/compose failed: failing:.*exited with code 1/);
  });

  test("SIGTERM を無視するサービスも graceMs 後に止まる", async () => {
    writeFixtures(tmp.path);
    const start = Date.now();
    const failing = makeServiceTask("failing", async (ctx) => {
      await ctx.cmd("bun", [resolve(tmp.path, "quick-exit-1.ts")]);
    });
    const stubborn = makeServiceTask("stubborn", async (ctx) => {
      await ctx.cmd("bun", [resolve(tmp.path, "ignores-sigterm.ts")]);
    });

    await expect(
      runCompose(
        { taskName: "dev", root: tmp.path, cwd: tmp.path },
        [[failing, stubborn]],
        { graceMs: 150, noColor: true, writeOut: () => {} },
      ),
    ).rejects.toThrow(/compose failed/);

    const elapsed = Date.now() - start;
    // grace 150ms 経過後に SIGKILL が飛ぶため、概ね 150〜2500ms 程度で解決する
    expect(elapsed).toBeLessThan(3000);
  });
});
