import { describe, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { logFile, safeName, stateFile } from "../../src/daemon/paths.ts";
import {
  claimRecord,
  createRecord,
  type DaemonRecord,
  isAlive,
  listRecords,
  pruneRecords,
  readRecord,
  removeRecord,
  writeRecord,
} from "../../src/daemon/state.ts";
import { useTempDir } from "../support/sandbox.ts";

/** 存在しないことがほぼ確実な PID（POSIX の pid_max より大きい値） */
const DEAD_PID = 4_000_000;

function register(root: string, name: string, pid: number): void {
  writeRecord(root, makeRecord(root, name, pid));
}

function makeRecord(root: string, name: string, pid: number): DaemonRecord {
  return createRecord({
    root,
    name,
    pid,
    command: ["bun", "main.ts", name],
    cwd: root,
    startedAt: new Date(2026, 7, 21, 10, 0, 0),
  });
}

describe("daemon paths", () => {
  const tmp = useTempDir("overbake-daemon-paths");

  test("そのまま使える名前は変換しない", () => {
    expect(safeName("build")).toBe("build");
    expect(safeName("build.prod")).toBe("build.prod");
  });

  test("使えない文字は _ に置換し、衝突しないようハッシュを付ける", () => {
    expect(safeName("lint:fix")).toStartWith("lint_fix-");
    expect(safeName("a/b")).toStartWith("a_b-");
    // 置換後に同じ形になる別のタスク名が同じファイルを共有しない
    expect(safeName("lint:fix")).not.toBe(safeName("lint_fix"));
    expect(safeName("lint:fix")).not.toBe(safeName("lint-fix"));
    expect(safeName("lint:fix")).not.toBe(safeName("lint/fix"));
  });

  test("同じ名前からは常に同じファイル名になる（実行間で安定）", () => {
    expect(safeName("lint:fix")).toBe(safeName("lint:fix"));
    expect(safeName("lint:fix")).toBe("lint_fix-62dd262d");
  });

  test("ログ・状態ファイルは .overbake 配下に置かれる", () => {
    expect(logFile(tmp.path, "dev")).toBe(`${tmp.path}/.overbake/logs/dev.log`);
    expect(stateFile(tmp.path, "dev")).toBe(
      `${tmp.path}/.overbake/daemons/dev.json`,
    );
  });
});

describe("daemon state", () => {
  const tmp = useTempDir("overbake-daemon-state");

  test("書き込んだレコードを読み戻せる", () => {
    const record = makeRecord(tmp.path, "dev", 1234);
    writeRecord(tmp.path, record);

    expect(readRecord(tmp.path, "dev")).toEqual(record);
    expect(existsSync(stateFile(tmp.path, "dev"))).toBe(true);
  });

  test("未登録のタスクは null", () => {
    expect(readRecord(tmp.path, "missing")).toBeNull();
  });

  test("removeRecord で状態ファイルを削除する", () => {
    writeRecord(tmp.path, makeRecord(tmp.path, "dev", 1234));
    removeRecord(tmp.path, "dev");

    expect(readRecord(tmp.path, "dev")).toBeNull();
    // 二重削除でも例外にしない
    expect(() => removeRecord(tmp.path, "dev")).not.toThrow();
  });

  test("listRecords は名前順に返し、壊れたファイルは無視する", () => {
    writeRecord(tmp.path, makeRecord(tmp.path, "web", 1));
    writeRecord(tmp.path, makeRecord(tmp.path, "api", 2));
    writeFileSync(stateFile(tmp.path, "broken"), "{ not json");

    expect(listRecords(tmp.path).map((r) => r.name)).toEqual(["api", "web"]);
  });

  test("状態ディレクトリが無ければ空配列", () => {
    expect(listRecords(tmp.path)).toEqual([]);
  });

  test("isAlive は自プロセスを生存と判定し、存在しない PID を false にする", () => {
    expect(isAlive(process.pid)).toBe(true);
    expect(isAlive(DEAD_PID)).toBe(false);
  });

  test("pruneRecords は停止済みのレコードを掃除して生存分だけ返す", () => {
    writeRecord(tmp.path, makeRecord(tmp.path, "alive", process.pid));
    writeRecord(tmp.path, makeRecord(tmp.path, "dead", DEAD_PID));

    expect(pruneRecords(tmp.path).map((r) => r.name)).toEqual(["alive"]);
    expect(readRecord(tmp.path, "dead")).toBeNull();
    expect(readRecord(tmp.path, "alive")).not.toBeNull();
  });
});

describe("PID ガード", () => {
  const tmp = useTempDir("overbake-daemon-pidguard");

  // 0 / 負の PID は POSIX で「プロセスグループ」「全プロセス」を意味するため、
  // 壊れた状態ファイル経由で混入してもシグナル対象にしてはいけない
  test.each([0, -1, -100, 1.5])("isAlive(%s) は false", (pid) => {
    expect(isAlive(pid)).toBe(false);
  });

  test("0 以下の PID を持つレコードは prune で掃除される", () => {
    register(tmp.path, "broken", -1);
    expect(pruneRecords(tmp.path)).toEqual([]);
  });
});

describe("claimRecord", () => {
  const tmp = useTempDir("overbake-daemon-claim");

  test("状態ファイルが無ければ起動権を取れる", () => {
    expect(claimRecord(tmp.path, "dev", process.pid, new Date())).toBe(true);

    const record = readRecord(tmp.path, "dev");
    expect(record?.pid).toBe(process.pid);
  });

  test("既に状態ファイルがあれば起動権を取れない（二重起動の防止）", () => {
    expect(claimRecord(tmp.path, "dev", process.pid, new Date())).toBe(true);
    expect(claimRecord(tmp.path, "dev", process.pid, new Date())).toBe(false);
  });

  test("仮レコードは本番のレコードで上書きできる", () => {
    claimRecord(tmp.path, "dev", process.pid, new Date());
    writeRecord(tmp.path, makeRecord(tmp.path, "dev", 4242));

    expect(readRecord(tmp.path, "dev")?.pid).toBe(4242);
  });
});
