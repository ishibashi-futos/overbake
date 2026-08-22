import { describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync } from "node:fs";
import {
  followLog,
  formatUptime,
  readLogTail,
  renderDaemonList,
  signalTree,
  stopDaemon,
} from "../../src/daemon/control.ts";
import { ensureDaemonDirs, logFile } from "../../src/daemon/paths.ts";
import {
  createRecord,
  readRecord,
  writeRecord,
} from "../../src/daemon/state.ts";
import { useTempDir } from "../support/sandbox.ts";

/** 存在しないことがほぼ確実な PID */
const DEAD_PID = 4_000_000;

function register(root: string, name: string, pid: number, startedAt: Date) {
  writeRecord(
    root,
    createRecord({
      root,
      name,
      pid,
      command: ["bun", "main.ts", name],
      cwd: root,
      startedAt,
    }),
  );
}

describe("formatUptime", () => {
  const base = new Date(2026, 7, 21, 12, 0, 0);
  const started = (msAgo: number): string =>
    new Date(base.getTime() - msAgo).toISOString();

  test.each([
    [5_000, "5s"],
    [90_000, "1m 30s"],
    [3_600_000 + 120_000, "1h 2m"],
    [86_400_000 + 3_600_000, "1d 1h"],
  ])("%s ms 前 -> %s", (msAgo, expected) => {
    expect(formatUptime(started(msAgo), base)).toBe(expected);
  });
});

describe("renderDaemonList", () => {
  const tmp = useTempDir("overbake-daemon-list");

  test("デーモンが無ければその旨を返す", () => {
    expect(renderDaemonList(tmp.path)).toBe("No running daemons.");
  });

  test("生存しているデーモンを表形式で表示する", () => {
    const now = new Date(2026, 7, 21, 12, 0, 0);
    register(tmp.path, "dev", process.pid, new Date(now.getTime() - 65_000));

    const output = renderDaemonList(tmp.path, now);

    expect(output).toContain("NAME");
    expect(output).toContain("PID");
    expect(output).toContain("UPTIME");
    expect(output).toContain("dev");
    expect(output).toContain(String(process.pid));
    expect(output).toContain("1m 5s");
  });

  test("停止済みのデーモンは一覧から消えて状態ファイルも掃除される", () => {
    register(tmp.path, "dead", DEAD_PID, new Date());

    expect(renderDaemonList(tmp.path)).toBe("No running daemons.");
    expect(readRecord(tmp.path, "dead")).toBeNull();
  });
});

describe("stopDaemon", () => {
  const tmp = useTempDir("overbake-daemon-stop");

  test("状態ファイルが無ければ not-found", async () => {
    const result = await stopDaemon(tmp.path, "missing");
    expect(result.status).toBe("not-found");
  });

  test("既に停止していれば not-running を返し状態ファイルを掃除する", async () => {
    register(tmp.path, "dead", DEAD_PID, new Date());

    const result = await stopDaemon(tmp.path, "dead");

    expect(result.status).toBe("not-running");
    expect(result.pid).toBe(DEAD_PID);
    expect(readRecord(tmp.path, "dead")).toBeNull();
  });
});

describe("readLogTail / followLog", () => {
  const tmp = useTempDir("overbake-daemon-logs");

  test("ログが無ければ null", () => {
    expect(readLogTail(tmp.path, "dev", 10)).toBeNull();
  });

  test("末尾 n 行を返す", () => {
    ensureDaemonDirs(tmp.path);
    appendFileSync(logFile(tmp.path, "dev"), "l1\nl2\nl3\nl4\n");

    expect(readLogTail(tmp.path, "dev", 2)).toBe("l3\nl4");
    expect(readLogTail(tmp.path, "dev", 100)).toBe("l1\nl2\nl3\nl4");
  });

  test("現在のログで足りなければ退避済みの世代へ遡って補う", () => {
    ensureDaemonDirs(tmp.path);
    const path = logFile(tmp.path, "dev");
    // 古い世代ほど番号が大きい
    appendFileSync(`${path}.2`, "old1\nold2\n");
    appendFileSync(`${path}.1`, "mid1\nmid2\n");
    appendFileSync(path, "new1\n");

    expect(readLogTail(tmp.path, "dev", 2)).toBe("mid2\nnew1");
    expect(readLogTail(tmp.path, "dev", 3)).toBe("mid1\nmid2\nnew1");
    expect(readLogTail(tmp.path, "dev", 10)).toBe(
      "old1\nold2\nmid1\nmid2\nnew1",
    );
  });

  test("keep を超える世代までは遡らない", () => {
    ensureDaemonDirs(tmp.path);
    const path = logFile(tmp.path, "keeplimit");
    appendFileSync(`${path}.2`, "too-old\n");
    appendFileSync(`${path}.1`, "kept\n");
    appendFileSync(path, "current\n");

    const config = { maxBytes: 1024, keep: 1, checkIntervalMs: 5000 };
    expect(readLogTail(tmp.path, "keeplimit", 10, config)).toBe(
      "kept\ncurrent",
    );
  });

  test("followLog は追記分だけを渡す", async () => {
    mkdirSync(`${tmp.path}/.overbake/logs`, { recursive: true });
    const path = logFile(tmp.path, "dev");
    appendFileSync(path, "before\n");

    const received: string[] = [];
    const stop = followLog(tmp.path, "dev", (text) => received.push(text));

    appendFileSync(path, "after\n");
    // fs.watch のイベント到達を待つ
    const deadline = Date.now() + 3000;
    while (received.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    stop();

    expect(received.join("")).toBe("after\n");
  });
});

describe("signalTree", () => {
  // 0 以下の PID にシグナルを送ると PID 1 や全プロセスへ届いてしまうため必ず拒否する
  test.each([0, -1, -1000, 2.5])("signalTree(%s) は送信せず false", (pid) => {
    expect(signalTree(pid, "SIGTERM")).toBe(false);
  });
});
