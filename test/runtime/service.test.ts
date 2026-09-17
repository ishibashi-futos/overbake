import { describe, expect, test } from "bun:test";
import {
  ServiceFailedError,
  type SuperviseDeps,
  superviseService,
} from "../../src/runtime/service.ts";
import type { TaskFunction } from "../../src/types.ts";
import {
  makeComposeService,
  makeNeverSleep,
  useTempDir,
  waitForAbort,
  waitUntil,
} from "../support/sandbox.ts";

/**
 * deps.sleep の既定テスト実装: 呼び出しごとに ms を記録する。
 * ready.timeoutMs の既定値（60000ms）のような「テスト中には経過してほしくない」待機と、
 * 明示的に指定した短い interval/backoff/猶予の待機を区別するため、
 * 10000ms 未満だけマクロタスク 1 回分で自然に解決し、それ以上は abort されるまで解決しない。
 * settleMs は既定 0（猶予の待機を挟まない）にし、バックオフ列など既存の検証と混ざらないようにする。
 */
function makeDeps(
  overrides: {
    connect?: SuperviseDeps["connect"];
    graceMs?: number;
    settleMs?: number;
  } = {},
): { deps: SuperviseDeps; lines: string[]; sleepCalls: number[] } {
  const lines: string[] = [];
  const sleepCalls: number[] = [];
  const sleep: SuperviseDeps["sleep"] = (ms, signal) => {
    sleepCalls.push(ms);
    return new Promise((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      const timer = ms < 10000 ? setTimeout(resolve, 0) : undefined;
      signal.addEventListener(
        "abort",
        () => {
          if (timer) clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  };
  const deps: SuperviseDeps = {
    root: "/tmp",
    cwd: "/tmp",
    writeLine: (line) => lines.push(line),
    graceMs: overrides.graceMs ?? 50,
    sleep,
    connect: overrides.connect ?? (async () => false),
    settleMs: overrides.settleMs ?? 0,
  };
  return { deps, lines, sleepCalls };
}

describe("superviseService", () => {
  const tmp = useTempDir("overbake-service");

  test("ready 未指定なら run 開始直後に ready になる（reject しない）", async () => {
    const run: TaskFunction = async (ctx) => {
      await waitForAbort(ctx.signal);
    };
    const cs = makeComposeService("svc", run);
    const { deps } = makeDeps();
    const handle = superviseService(cs, deps);

    await handle.ready;
    handle.stop();
    await handle.done;
  });

  test("log probe: 出力行が一致したら ready", async () => {
    const run: TaskFunction = async (ctx) => {
      ctx.log("server listening on :3000");
      await waitForAbort(ctx.signal);
    };
    const cs = makeComposeService("svc", run, { ready: { log: "listening" } });
    const { deps, lines } = makeDeps();
    const handle = superviseService(cs, deps);

    await handle.ready;
    expect(lines).toContain("ready");
    handle.stop();
    await handle.done;
  });

  test("check probe: check が true を返したら ready", async () => {
    const run: TaskFunction = async (ctx) => {
      await waitForAbort(ctx.signal);
    };
    const cs = makeComposeService("svc", run, {
      ready: { check: async () => true },
    });
    const { deps, lines } = makeDeps();
    const handle = superviseService(cs, deps);

    await handle.ready;
    expect(lines).toContain("ready");
    handle.stop();
    await handle.done;
  });

  test("port probe: intervalMs ごとにポーリングし、成功したら ready になる", async () => {
    let calls = 0;
    const connect: SuperviseDeps["connect"] = async () => {
      calls += 1;
      return calls >= 3;
    };
    const run: TaskFunction = async (ctx) => {
      await waitForAbort(ctx.signal);
    };
    const cs = makeComposeService("svc", run, {
      ready: { port: 1234, intervalMs: 25 },
    });
    const { deps, sleepCalls } = makeDeps({ connect });
    const handle = superviseService(cs, deps);

    await handle.ready;
    expect(calls).toBe(3);
    expect(sleepCalls.filter((ms) => ms === 25)).toHaveLength(2);
    handle.stop();
    await handle.done;
  });

  test("ready タイムアウト: timeoutMs 超過で失敗し retry 0 ならそのまま reject する", async () => {
    const run: TaskFunction = async (ctx) => {
      await waitForAbort(ctx.signal);
    };
    const cs = makeComposeService("svc", run, {
      ready: { log: "never-matches", timeoutMs: 1234 },
    });
    const { deps } = makeDeps();
    const handle = superviseService(cs, deps);

    await expect(handle.done).rejects.toThrow(
      "svc: ready timeout after 1234ms",
    );
  });

  test("ready 前の終了で retry し、バックオフ列が期待どおりになる", async () => {
    const run: TaskFunction = async () => {
      throw new Error("boom");
    };
    const cs = makeComposeService("svc", run, {
      retry: { attempts: 3, delayMs: 10, factor: 2, maxDelayMs: 1000 },
    });
    const { deps, sleepCalls, lines } = makeDeps();
    const handle = superviseService(cs, deps);

    await expect(handle.done).rejects.toThrow(
      "svc: boom (gave up after 3 retries)",
    );
    expect(sleepCalls).toEqual([10, 20, 40]);
    expect(lines).toContain("retrying in 10ms (1/3)");
    expect(lines).toContain("retrying in 20ms (2/3)");
    expect(lines).toContain("retrying in 40ms (3/3)");
  });

  test("3 回目の attempt で成功したら ready になり、それ以上再起動しない", async () => {
    let attemptCount = 0;
    const run: TaskFunction = async (ctx) => {
      attemptCount += 1;
      if (attemptCount < 3) throw new Error(`boom ${attemptCount}`);
      ctx.log("up");
      await waitForAbort(ctx.signal);
    };
    const cs = makeComposeService("svc", run, {
      ready: { log: "up" },
      retry: { attempts: 5, delayMs: 5 },
    });
    const { deps } = makeDeps();
    const handle = superviseService(cs, deps);

    await handle.ready;
    expect(attemptCount).toBe(3);
    handle.stop();
    await handle.done;
    expect(attemptCount).toBe(3);
  });

  test("failed で settle した後に届いた ready 検出（改行なし末尾出力の flush）は無視される", async () => {
    // 改行なしで出力して exit 0 するプロセス。行バッファは attempt 終了時の flush で初めて
    // handleLine に渡るため、その時点では既に「exited unexpectedly」で settle 済みになっている。
    const run: TaskFunction = async (ctx) => {
      await ctx.cmd("bun", ["-e", 'process.stdout.write("up")']);
    };
    const cs = makeComposeService("svc", run, { ready: { log: "up" } });
    const { deps, lines } = makeDeps();
    const handle = superviseService(cs, deps);

    let readyResolved = false;
    handle.ready.then(() => {
      readyResolved = true;
    });

    await expect(handle.done).rejects.toThrow("svc: exited unexpectedly");
    expect(readyResolved).toBe(false);
    expect(lines.filter((l) => l === "ready")).toHaveLength(0);
  });

  test("ready 後のクラッシュでも retry し、回数がリセットされない", async () => {
    let attemptCount = 0;
    const run: TaskFunction = async (ctx) => {
      attemptCount += 1;
      ctx.log("up");
      if (attemptCount <= 2) throw new Error(`crash ${attemptCount}`);
      await waitForAbort(ctx.signal);
    };
    const cs = makeComposeService("svc", run, {
      ready: { log: "up" },
      retry: { attempts: 5, delayMs: 5, factor: 2 },
    });
    const { deps, lines } = makeDeps();
    const handle = superviseService(cs, deps);

    await handle.ready; // 1 attempt 目で ready になる
    await waitUntil(() => attemptCount >= 3);
    handle.stop();
    await handle.done;

    expect(lines).toContain("retrying in 5ms (1/5)");
    expect(lines).toContain("retrying in 10ms (2/5)");
  });

  test("failOn: run が生存中でも失敗になり、同じ行なら ready.log より優先される", async () => {
    const run: TaskFunction = async (ctx) => {
      ctx.log("BOOT");
      await waitForAbort(ctx.signal);
    };
    const cs = makeComposeService("svc", run, {
      ready: { log: "BOOT" },
      failOn: "BOOT",
    });
    const { deps } = makeDeps();
    const handle = superviseService(cs, deps);

    let readyResolved = false;
    handle.ready.then(() => {
      readyResolved = true;
    });

    await expect(handle.done).rejects.toThrow(/matched failOn "BOOT": BOOT/);
    expect(readyResolved).toBe(false);
  });

  test("バックオフ中の stop で即座に終了し、次の attempt を始めない", async () => {
    let attemptCount = 0;
    const run: TaskFunction = async () => {
      attemptCount += 1;
      throw new Error("boom");
    };
    const cs = makeComposeService("svc", run, {
      retry: { attempts: 5, delayMs: 999999 },
    });
    const lines: string[] = [];
    const deps: SuperviseDeps = {
      root: tmp.path,
      cwd: tmp.path,
      writeLine: (line) => lines.push(line),
      graceMs: 50,
      sleep: makeNeverSleep(),
      connect: async () => false,
      settleMs: 0,
    };
    const handle = superviseService(cs, deps);

    // バックオフ待機に入る（"retrying in" 行が出る）まで待つ
    await waitUntil(() => lines.some((l) => l.startsWith("retrying in")));
    handle.stop();
    await handle.done; // stop 済みなので reject せず resolve する

    expect(attemptCount).toBe(1);
  });

  test("ready 待ち中の stop で即座に終了する", async () => {
    let started = false;
    const run: TaskFunction = async (ctx) => {
      started = true;
      await waitForAbort(ctx.signal);
    };
    const cs = makeComposeService("svc", run, {
      ready: { log: "never-matches", timeoutMs: 999999 },
    });
    const lines: string[] = [];
    const deps: SuperviseDeps = {
      root: tmp.path,
      cwd: tmp.path,
      writeLine: (line) => lines.push(line),
      graceMs: 50,
      sleep: makeNeverSleep(),
      connect: async () => false,
      settleMs: 0,
    };
    const handle = superviseService(cs, deps);

    await waitUntil(() => started);
    let readyResolved = false;
    handle.ready.then(() => {
      readyResolved = true;
    });
    handle.stop();
    await handle.done;

    expect(readyResolved).toBe(false);
  });

  test("最終失敗メッセージ: retries > 0 なら「(gave up after N retries)」が付き、0 なら付かない", async () => {
    const failingRun: TaskFunction = async () => {
      throw new Error("boom");
    };

    const zeroAttempts = makeComposeService("svc-zero", failingRun);
    const { deps: depsZero } = makeDeps();
    await expect(superviseService(zeroAttempts, depsZero).done).rejects.toThrow(
      "svc-zero: boom",
    );
    await expect(
      superviseService(zeroAttempts, makeDeps().deps).done,
    ).rejects.not.toThrow(/gave up/);

    const twoAttempts = makeComposeService("svc-two", failingRun, {
      retry: { attempts: 2, delayMs: 1 },
    });
    const { deps: depsTwo } = makeDeps();
    await expect(superviseService(twoAttempts, depsTwo).done).rejects.toThrow(
      "svc-two: boom (gave up after 2 retries)",
    );
  });

  test("ctx.signal を待つタスク関数は stop() で abort されて return し、done が resolve する", async () => {
    let sawAbort = false;
    const run: TaskFunction = async (ctx) => {
      await waitForAbort(ctx.signal);
      sawAbort = true;
    };
    const cs = makeComposeService("svc", run);
    const { deps, lines } = makeDeps();
    const handle = superviseService(cs, deps);

    await handle.ready;
    handle.stop();
    await handle.done;

    expect(sawAbort).toBe(true);
    expect(lines.some((l) => l.startsWith("failed:"))).toBe(false);
  });
});

describe("失敗確定の猶予（settleMs / FAILURE_SETTLE_MS）", () => {
  // Ctrl+C / bake stop はプロセスグループ全体へシグナルを送るため、サービスの子プロセスの
  // 終了（failed 扱い）が bake 自身の停止要求（handle.stop）より先に届くことがある。
  // その競合を吸収する猶予の挙動を、backoff とは別枠で検証する。

  test("失敗の猶予中に stop() すると「failed:」を出さずに正常終了し、次の attempt を始めない", async () => {
    let attemptCount = 0;
    const run: TaskFunction = async () => {
      attemptCount += 1;
      throw new Error("boom");
    };
    const cs = makeComposeService("svc", run, {
      retry: { attempts: 5, delayMs: 10 },
    });
    const sleepCalls: number[] = [];
    const neverSleep = makeNeverSleep();
    const lines: string[] = [];
    const deps: SuperviseDeps = {
      root: "/tmp",
      cwd: "/tmp",
      writeLine: (line) => lines.push(line),
      graceMs: 50,
      sleep: (ms, signal) => {
        sleepCalls.push(ms);
        return neverSleep(ms, signal);
      },
      connect: async () => false,
      settleMs: 50,
    };
    const handle = superviseService(cs, deps);

    // 猶予の待機（deps.sleep(settleMs, ...)）に入るまで待つ。retry backoff より前なので
    // この時点の sleep 呼び出しは必ず猶予の待機である。
    await waitUntil(() => sleepCalls.length > 0);
    handle.stop();
    await handle.done; // reject せず resolve する

    expect(attemptCount).toBe(1);
    expect(lines.some((l) => l.startsWith("failed:"))).toBe(false);
    expect(lines.some((l) => l.startsWith("retrying in"))).toBe(false);
  });

  test("猶予後に stop() しても失敗の確定は覆らない", async () => {
    const run: TaskFunction = async () => {
      throw new Error("boom");
    };
    const cs = makeComposeService("svc", run);
    const { deps, lines } = makeDeps({ settleMs: 20 });
    const handle = superviseService(cs, deps);
    // done は「failed:」出力と同じ tick で reject するため、待っている間に unhandled rejection と
    // ならないよう assertion を先に仕込んでおく
    const doneAssertion = expect(handle.done).rejects.toThrow("svc: boom");

    // "failed:" 行が出た時点で猶予は既に終わり、失敗は確定している
    await waitUntil(() => lines.some((l) => l.startsWith("failed:")));
    handle.stop();

    await doneAssertion;
  });

  test("settleMs が 0 なら猶予の待機を呼ばずに即座に失敗を確定する", async () => {
    const run: TaskFunction = async () => {
      throw new Error("boom");
    };
    const cs = makeComposeService("svc", run);
    const { deps, lines, sleepCalls } = makeDeps({ settleMs: 0 });
    const handle = superviseService(cs, deps);

    await expect(handle.done).rejects.toThrow("svc: boom");
    expect(sleepCalls).toEqual([]);
    expect(lines).toContain("failed: boom");
  });
});

describe("ServiceFailedError", () => {
  test("service / reason / retries を保持する", () => {
    const err = new ServiceFailedError("api", "boom", 2);
    expect(err.service).toBe("api");
    expect(err.reason).toBe("boom");
    expect(err.retries).toBe(2);
    expect(err.message).toBe("api: boom (gave up after 2 retries)");
    expect(err.name).toBe("ServiceFailedError");
  });

  test("retries が 0 なら (gave up after) は付かない", () => {
    const err = new ServiceFailedError("api", "boom", 0);
    expect(err.message).toBe("api: boom");
  });
});
