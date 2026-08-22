import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { logFile } from "../../src/daemon/paths.ts";
import {
  buildDaemonCommand,
  isEmbeddedEntry,
  startDaemon,
} from "../../src/daemon/spawn.ts";
import { readRecord } from "../../src/daemon/state.ts";
import { useTempDir } from "../support/sandbox.ts";

describe("isEmbeddedEntry", () => {
  test.each([
    ["/$bunfs/root/bake", true],
    ["B:\\~BUN\\root\\bake.exe", true],
    [undefined, true],
    ["/Users/me/overbake/src/cli/main.ts", false],
    ["./src/cli/main.ts", false],
  ])("%s -> %s", (entry, expected) => {
    expect(isEmbeddedEntry(entry)).toBe(expected);
  });
});

describe("buildDaemonCommand", () => {
  test("開発時（bun <script>）はスクリプトパスを引き継ぐ", () => {
    expect(
      buildDaemonCommand({
        execPath: "/usr/bin/bun",
        entry: "/repo/src/cli/main.ts",
        args: ["-d", "dev", "--verbose"],
      }),
    ).toEqual(["/usr/bin/bun", "/repo/src/cli/main.ts", "dev", "--verbose"]);
  });

  test("コンパイル済みバイナリでは仮想パスを再実行しない", () => {
    expect(
      buildDaemonCommand({
        execPath: "/usr/local/bin/bake",
        entry: "/$bunfs/root/bake",
        args: ["--daemon", "dev"],
      }),
    ).toEqual(["/usr/local/bin/bake", "dev"]);
  });

  test("appendArgs を末尾に足す（重複は足さない）", () => {
    expect(
      buildDaemonCommand({
        execPath: "/bin/bake",
        entry: "/$bunfs/root/bake",
        args: ["-d", "dev"],
        appendArgs: ["--yes"],
      }),
    ).toEqual(["/bin/bake", "dev", "--yes"]);

    expect(
      buildDaemonCommand({
        execPath: "/bin/bake",
        entry: "/$bunfs/root/bake",
        args: ["-d", "dev", "--yes"],
        appendArgs: ["--yes"],
      }),
    ).toEqual(["/bin/bake", "dev", "--yes"]);
  });

  test("`--` 以降のタスク引数はそのまま渡す", () => {
    expect(
      buildDaemonCommand({
        execPath: "/bin/bake",
        entry: "/$bunfs/root/bake",
        args: ["-d", "dev", "--", "--port", "3000"],
      }),
    ).toEqual(["/bin/bake", "dev", "--", "--port", "3000"]);
  });

  test("appendArgs は `--` より前に入れる（子で bake のフラグとして解釈させるため）", () => {
    expect(
      buildDaemonCommand({
        execPath: "/bin/bake",
        entry: "/$bunfs/root/bake",
        args: ["-d", "dev", "--", "--port", "3000"],
        appendArgs: ["--yes"],
      }),
    ).toEqual(["/bin/bake", "dev", "--yes", "--", "--port", "3000"]);
  });

  test("`--` 以降にあるデーモンフラグはパススルー引数として保持する", () => {
    expect(
      buildDaemonCommand({
        execPath: "/bin/bake",
        entry: "/$bunfs/root/bake",
        args: ["-d", "dev", "--", "-d"],
        appendArgs: ["--yes"],
      }),
    ).toEqual(["/bin/bake", "dev", "--yes", "--", "-d"]);
  });
});

describe("startDaemon", () => {
  const tmp = useTempDir("overbake-daemon-spawn");

  test("状態ファイルとログのヘッダを書き、プロセスを起動する", async () => {
    const record = startDaemon({
      root: tmp.path,
      name: "noop",
      // すぐ終了するプロセス（起動できたことだけ確認する）
      command: ["bun", "-e", "process.exit(0)"],
      cwd: tmp.path,
      now: new Date(2026, 7, 21, 10, 0, 0),
    });

    expect(record.name).toBe("noop");
    expect(record.pid).toBeGreaterThan(0);
    expect(record.logFile).toBe(logFile(tmp.path, "noop"));
    expect(readRecord(tmp.path, "noop")).toEqual(record);

    const log = readFileSync(record.logFile, "utf-8");
    expect(log).toContain("=== noop started at");
  });
});
