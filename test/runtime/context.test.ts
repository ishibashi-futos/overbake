import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createTaskContext, KILL_GRACE_MS } from "../../src/runtime/context.ts";
import {
  describeIfPosix,
  makeServiceTask,
  useTempDir,
  waitForAbort,
} from "../support/sandbox.ts";

describe("createTaskContext", () => {
  const tmp = useTempDir("overbake-context");

  test("KILL_GRACE_MS の既定値は 5000", () => {
    expect(KILL_GRACE_MS).toBe(5000);
  });

  test("abortSignal 未指定なら signal は abort されていない既定のシグナルになる", () => {
    const ctx = createTaskContext({ name: "t", root: tmp.path });
    expect(ctx.signal.aborted).toBe(false);
  });

  test("abortSignal 指定時は同じシグナルが ctx.signal に渡る", () => {
    const controller = new AbortController();
    const ctx = createTaskContext({
      name: "t",
      root: tmp.path,
      abortSignal: controller.signal,
    });
    expect(ctx.signal).toBe(controller.signal);
    controller.abort();
    expect(ctx.signal.aborted).toBe(true);
  });
});

describeIfPosix("ctx.runCompose", () => {
  const tmp = useTempDir("overbake-context-runcompose");

  test("ctx.signal の abort が compose へ伝わり正常終了する（task.service に包まれた compose の外側停止伝播）", async () => {
    const controller = new AbortController();
    const ctx = createTaskContext({
      name: "wrapped",
      root: tmp.path,
      abortSignal: controller.signal,
    });

    let innerAborted = false;
    const inner = makeServiceTask("inner", async (innerCtx) => {
      innerCtx.signal.addEventListener("abort", () => {
        innerAborted = true;
      });
      await waitForAbort(innerCtx.signal);
    });

    const composePromise = ctx.runCompose([[inner]]);

    // ready 未指定なので起動直後に ready。少し待ってから外側の abortSignal を abort する。
    await new Promise((r) => setTimeout(r, 50));
    controller.abort();

    await composePromise; // throw しない
    expect(innerAborted).toBe(true);
  });
});

describeIfPosix("ctx.cmd の停止処理", () => {
  const tmp = useTempDir("overbake-context-cmd");

  test("SIGTERM を無視する子プロセスは killGraceMs 経過後に SIGKILL で止まる", async () => {
    writeFileSync(
      resolve(tmp.path, "ignores-sigterm.ts"),
      `process.on("SIGTERM", () => {});
console.log("started");
setInterval(() => {}, 1 << 30);
`,
    );
    const controller = new AbortController();
    const ctx = createTaskContext({
      name: "t",
      root: tmp.path,
      abortSignal: controller.signal,
      killGraceMs: 150,
    });

    const promise = ctx.cmd("bun", ["ignores-sigterm.ts"]);
    // 子プロセスが起動して SIGTERM ハンドラを登録するまで少し待ってから abort する
    await new Promise((r) => setTimeout(r, 300));
    const start = Date.now();
    controller.abort();

    // abort 由来の終了は resolve される
    await promise;
    const elapsed = Date.now() - start;
    // killGraceMs(150ms) 経過後に SIGKILL が飛ぶので、概ね 150〜2000ms で終わるはず
    expect(elapsed).toBeGreaterThanOrEqual(140);
    expect(elapsed).toBeLessThan(3000);
  }, 8000);

  test("abort 以外で signal 終了した場合は「terminated by <SIGNAL>」で reject する", async () => {
    writeFileSync(
      resolve(tmp.path, "self-kill.ts"),
      `console.log("started");
process.kill(process.pid, "SIGKILL");
`,
    );
    const ctx = createTaskContext({ name: "t", root: tmp.path });

    await expect(ctx.cmd("bun", ["self-kill.ts"])).rejects.toThrow(
      'Command "bun" was terminated by SIGKILL',
    );
  }, 5000);

  test("abort 由来の終了は resolve される（reject しない）", async () => {
    writeFileSync(
      resolve(tmp.path, "forever.ts"),
      `console.log("started");
process.on("SIGTERM", () => { process.exit(143); });
setInterval(() => {}, 1 << 30);
`,
    );
    const controller = new AbortController();
    const ctx = createTaskContext({
      name: "t",
      root: tmp.path,
      abortSignal: controller.signal,
    });

    const promise = ctx.cmd("bun", ["forever.ts"]);
    await new Promise((r) => setTimeout(r, 300));
    controller.abort();
    await expect(promise).resolves.toBeUndefined();
  }, 5000);
});
