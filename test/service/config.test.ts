import { describe, expect, test } from "bun:test";
import {
  backoffDelay,
  describePattern,
  matchesPattern,
  resolveComposeStages,
  resolveServiceConfig,
  SERVICE_DEFAULTS,
} from "../../src/service/config.ts";
import type { TaskDefinition } from "../../src/types.ts";
import { makeServiceTask } from "../support/sandbox.ts";

/** このファイルは静的構造だけを検証するため、run は常に no-op でよい */
const noop = async (): Promise<void> => {};

describe("resolveServiceConfig", () => {
  test("ready 未指定なら ready は null、retry は attempts 0 の既定値", () => {
    const resolved = resolveServiceConfig({});
    expect(resolved.ready).toBeNull();
    expect(resolved.failOn).toBeNull();
    expect(resolved.retry).toEqual({
      attempts: 0,
      delayMs: SERVICE_DEFAULTS.retryDelayMs,
      factor: SERVICE_DEFAULTS.retryFactor,
      maxDelayMs: SERVICE_DEFAULTS.retryMaxDelayMs,
    });
  });

  test("ready.log は timeoutMs / intervalMs の既定値を補って解決する", () => {
    const resolved = resolveServiceConfig({ ready: { log: "listening" } });
    expect(resolved.ready).toEqual({
      probe: { kind: "log", pattern: "listening" },
      timeoutMs: SERVICE_DEFAULTS.readyTimeoutMs,
      intervalMs: SERVICE_DEFAULTS.readyIntervalMs,
    });
  });

  test("ready.port は host の既定値 localhost を補う", () => {
    const resolved = resolveServiceConfig({ ready: { port: 5432 } });
    expect(resolved.ready?.probe).toEqual({
      kind: "port",
      port: 5432,
      host: SERVICE_DEFAULTS.host,
    });
  });

  test("ready.check はそのまま probe に渡る", () => {
    const check = async () => true;
    const resolved = resolveServiceConfig({ ready: { check } });
    expect(resolved.ready?.probe).toEqual({ kind: "check", check });
  });

  test("retry は attempts 以外の既定値を補う", () => {
    const resolved = resolveServiceConfig({ retry: { attempts: 3 } });
    expect(resolved.retry).toEqual({
      attempts: 3,
      delayMs: SERVICE_DEFAULTS.retryDelayMs,
      factor: SERVICE_DEFAULTS.retryFactor,
      maxDelayMs: SERVICE_DEFAULTS.retryMaxDelayMs,
    });
  });

  test("failOn はそのまま解決される", () => {
    expect(resolveServiceConfig({ failOn: "EADDRINUSE" }).failOn).toBe(
      "EADDRINUSE",
    );
    const pattern = /boom/;
    expect(resolveServiceConfig({ failOn: pattern }).failOn).toBe(pattern);
  });

  describe("検証エラー", () => {
    test("ready に log/port/check を 0 個指定するとエラー", () => {
      expect(() =>
        resolveServiceConfig({
          ready: { timeoutMs: 1000 } as unknown as { log: string },
        }),
      ).toThrow(/log \/ port \/ check のいずれか 1 つ/);
    });

    test("ready に log/port を同時指定するとエラー", () => {
      expect(() =>
        resolveServiceConfig({
          ready: { log: "x", port: 1 } as unknown as { log: string },
        }),
      ).toThrow(/log \/ port \/ check のいずれか 1 つ/);
    });

    test("ready.log が空文字ならエラー", () => {
      expect(() => resolveServiceConfig({ ready: { log: "" } })).toThrow(
        /ready\.log は空でない文字列または RegExp/,
      );
    });

    test("ready.port が範囲外ならエラー", () => {
      expect(() => resolveServiceConfig({ ready: { port: 70000 } })).toThrow(
        /ready\.port は 1〜65535 の整数/,
      );
      expect(() => resolveServiceConfig({ ready: { port: 0 } })).toThrow(
        /ready\.port は 1〜65535 の整数/,
      );
      expect(() => resolveServiceConfig({ ready: { port: 1.5 } })).toThrow(
        /ready\.port は 1〜65535 の整数/,
      );
    });

    test("ready.host が空文字ならエラー", () => {
      expect(() =>
        resolveServiceConfig({ ready: { port: 80, host: "" } }),
      ).toThrow(/ready\.host は空でない文字列/);
    });

    test("ready.check が関数でないならエラー", () => {
      expect(() =>
        resolveServiceConfig({
          ready: { check: "not-a-function" } as unknown as {
            check: () => boolean;
          },
        }),
      ).toThrow(/ready\.check は関数/);
    });

    test("ready.timeoutMs / intervalMs が不正ならエラー", () => {
      expect(() =>
        resolveServiceConfig({ ready: { log: "x", timeoutMs: 0 } }),
      ).toThrow(/ready\.timeoutMs は有限の正の数/);
      expect(() =>
        resolveServiceConfig({
          ready: { log: "x", timeoutMs: Number.POSITIVE_INFINITY },
        }),
      ).toThrow(/ready\.timeoutMs は有限の正の数/);
      expect(() =>
        resolveServiceConfig({ ready: { log: "x", intervalMs: -1 } }),
      ).toThrow(/ready\.intervalMs は有限の正の数/);
    });

    test("failOn が空文字ならエラー", () => {
      expect(() => resolveServiceConfig({ failOn: "" })).toThrow(
        /failOn は空でない文字列または RegExp/,
      );
    });

    test("retry.attempts が負・非整数ならエラー", () => {
      expect(() => resolveServiceConfig({ retry: { attempts: -1 } })).toThrow(
        /retry\.attempts は 0 以上の整数/,
      );
      expect(() => resolveServiceConfig({ retry: { attempts: 1.5 } })).toThrow(
        /retry\.attempts は 0 以上の整数/,
      );
    });

    test("retry.delayMs / factor / maxDelayMs が不正ならエラー", () => {
      expect(() =>
        resolveServiceConfig({ retry: { attempts: 1, delayMs: -1 } }),
      ).toThrow(/retry\.delayMs は有限の 0 以上の数/);
      expect(() =>
        resolveServiceConfig({ retry: { attempts: 1, factor: 0.5 } }),
      ).toThrow(/retry\.factor は有限の 1 以上の数/);
      expect(() =>
        resolveServiceConfig({ retry: { attempts: 1, maxDelayMs: -1 } }),
      ).toThrow(/retry\.maxDelayMs は有限の 0 以上の数/);
    });
  });
});

describe("backoffDelay", () => {
  test("delay 100, factor 2, max 350 → 100, 200, 350, 350", () => {
    const retry = { attempts: 4, delayMs: 100, factor: 2, maxDelayMs: 350 };
    expect(backoffDelay(retry, 1)).toBe(100);
    expect(backoffDelay(retry, 2)).toBe(200);
    expect(backoffDelay(retry, 3)).toBe(350);
    expect(backoffDelay(retry, 4)).toBe(350);
  });
});

describe("matchesPattern", () => {
  test("string は部分一致", () => {
    expect(matchesPattern("listen", "server listening on :3000")).toBe(true);
    expect(matchesPattern("listen", "no match here")).toBe(false);
  });

  test("RegExp は test で判定する", () => {
    expect(matchesPattern(/^ready$/, "ready")).toBe(true);
    expect(matchesPattern(/^ready$/, "not ready")).toBe(false);
  });

  test("g フラグ付き RegExp を使い回しても lastIndex に影響されず毎回正しく判定する", () => {
    const pattern = /foo/g;
    for (let i = 0; i < 3; i++) {
      expect(matchesPattern(pattern, "foo bar")).toBe(true);
    }
  });

  test("y フラグ付き RegExp を使い回しても毎回正しく判定する", () => {
    const pattern = /^foo/y;
    expect(matchesPattern(pattern, "foo")).toBe(true);
    expect(matchesPattern(pattern, "foo")).toBe(true);
    expect(matchesPattern(pattern, "foo")).toBe(true);
  });
});

describe("describePattern", () => {
  test("string は JSON.stringify", () => {
    expect(describePattern("EADDRINUSE")).toBe('"EADDRINUSE"');
  });

  test("RegExp は String(regexp)", () => {
    expect(describePattern(/boom/i)).toBe("/boom/i");
  });
});

describe("resolveComposeStages", () => {
  test("空ステージ列は [] を返す", () => {
    expect(resolveComposeStages([])).toEqual([]);
  });

  test("サービスの静的情報を解決する", () => {
    const db = makeServiceTask("db", noop, { ready: { port: 5432 } });
    const resolved = resolveComposeStages([[db]]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toHaveLength(1);
    expect(resolved[0]?.[0]?.task).toBe(db);
    expect(resolved[0]?.[0]?.config.ready?.probe).toEqual({
      kind: "port",
      port: 5432,
      host: SERVICE_DEFAULTS.host,
    });
  });

  test("グループ（同時起動）はそのまま複数要素のステージになる", () => {
    const api = makeServiceTask("api", noop);
    const worker = makeServiceTask("worker", noop);
    const resolved = resolveComposeStages([[api, worker]]);
    expect(resolved[0]?.map((cs) => cs.task.name)).toEqual(["api", "worker"]);
  });

  test("空グループはエラー", () => {
    expect(() => resolveComposeStages([[]])).toThrow(/空のグループ/);
  });

  test("サービスでない要素（options.service が無い）はエラー", () => {
    const notAService: TaskDefinition = { name: "plain", fn: async () => {} };
    expect(() => resolveComposeStages([[notAService]])).toThrow(
      /'plain' はサービスではありません/,
    );
  });

  test("同じサービスの重複はエラー", () => {
    const db = makeServiceTask("db", noop);
    expect(() => resolveComposeStages([[db], [db]])).toThrow(
      /サービス 'db' が複数回指定されています/,
    );
  });

  test("サービス設定が不正ならサービス名を含めてエラー", () => {
    const broken = makeServiceTask("api", noop, {
      ready: { port: 999999 } as unknown as { port: number },
    });
    expect(() => resolveComposeStages([[broken]])).toThrow(
      /サービス 'api': ready\.port は 1〜65535 の整数/,
    );
  });
});
