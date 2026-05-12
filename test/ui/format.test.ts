import { describe, expect, test } from "bun:test";
import { formatSummary, type TaskResult } from "../../src/ui/format.ts";

// issue #18: 実行サマリー
describe("formatSummary", () => {
  test("正常終了のタスク一覧を表示する", () => {
    const results: TaskResult[] = [
      { name: "clean", status: "ok", durationMs: 12 },
      { name: "build", status: "ok", durationMs: 1200 },
    ];
    const output = formatSummary(results, 1212, { noColor: true });
    expect(output).toContain("Summary");
    expect(output).toContain("clean");
    expect(output).toContain("build");
    expect(output).toContain("12ms");
    expect(output).toContain("1.2s");
    expect(output).toContain("2 tasks");
    expect(output).toContain("wall");
  });

  test("失敗タスクが summary と Failed tasks 一覧に含まれる", () => {
    const results: TaskResult[] = [
      { name: "clean", status: "ok", durationMs: 10 },
      { name: "build", status: "failed", durationMs: 50 },
    ];
    const output = formatSummary(results, 60, { noColor: true });
    expect(output).toContain("✗");
    expect(output).toContain("1 failed");
    expect(output).toContain("Failed tasks:");
    expect(output).toContain("- build");
  });

  test("meta タスクが ✓ (meta) で表示される", () => {
    const results: TaskResult[] = [
      { name: "ci", status: "meta", durationMs: 0 },
    ];
    const output = formatSummary(results, 0, { noColor: true });
    expect(output).toContain("✓");
    expect(output).toContain("(meta)");
  });

  test("cached タスクが ⏭ cached で表示される", () => {
    const results: TaskResult[] = [
      { name: "lint", status: "cached", durationMs: 0 },
    ];
    const output = formatSummary(results, 0, { noColor: true });
    expect(output).toContain("⏭");
    expect(output).toContain("cached");
  });

  test("skipped タスクが ⏭ skipped で表示される", () => {
    const results: TaskResult[] = [
      { name: "test", status: "skipped", durationMs: 0 },
    ];
    const output = formatSummary(results, 0, { noColor: true });
    expect(output).toContain("⏭");
    expect(output).toContain("skipped");
  });

  test("quiet モードでは詳細行を出さず要約行のみ表示する", () => {
    const results: TaskResult[] = [
      { name: "clean", status: "ok", durationMs: 10 },
      { name: "build", status: "ok", durationMs: 100 },
    ];
    const output = formatSummary(results, 110, { quiet: true, noColor: true });
    expect(output).not.toContain("Summary");
    expect(output).toContain("2 tasks");
    expect(output).toContain("wall");
  });

  test("quiet モードで失敗がある場合は Failed tasks 一覧を含む", () => {
    const results: TaskResult[] = [
      { name: "build", status: "failed", durationMs: 30 },
    ];
    const output = formatSummary(results, 30, { quiet: true, noColor: true });
    expect(output).not.toContain("Summary");
    expect(output).toContain("1 failed");
    expect(output).toContain("Failed tasks:");
    expect(output).toContain("- build");
  });

  test("単数タスクは '1 task' と表示される", () => {
    const results: TaskResult[] = [{ name: "a", status: "ok", durationMs: 5 }];
    const output = formatSummary(results, 5, { noColor: true });
    expect(output).toContain("1 task ");
    expect(output).not.toContain("1 tasks");
  });
});
