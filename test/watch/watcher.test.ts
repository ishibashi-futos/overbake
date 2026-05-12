import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildPlan, executePlan } from "../../src/runtime/executor.ts";
import { collectWatchPaths, startWatch } from "../../src/watch/watcher.ts";
import { useTempDir } from "../support/sandbox.ts";

describe("collectWatchPaths", () => {
  const tmp = useTempDir("overbake-watch-test");

  test("inputs が指定されている場合は絶対パス化して返す", () => {
    const srcDir = resolve(tmp.path, "src");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(resolve(srcDir, "a.ts"), "");
    writeFileSync(resolve(srcDir, "b.ts"), "");

    const bakefilePath = resolve(tmp.path, "Bakefile.ts");
    const tasks = [
      {
        name: "a",
        fn: () => {},
        options: { inputs: ["src/a.ts", "src/b.ts"] },
      },
      {
        name: "b",
        fn: () => {},
        options: { inputs: ["src/b.ts", "src/c.ts"] },
      },
    ];
    const result = collectWatchPaths(tasks, bakefilePath);

    // 相対パスが絶対パスに変換される
    expect(result).toContain(srcDir);
    expect(result.every((p) => p.startsWith("/"))).toBe(true);
  });

  test("inputs が全タスクで未指定なら Bakefile.ts を返す", () => {
    const bakefilePath = resolve(tmp.path, "Bakefile.ts");
    writeFileSync(bakefilePath, "");

    const tasks = [
      { name: "a", fn: () => {}, options: {} },
      { name: "b", fn: () => {}, options: {} },
    ];
    const result = collectWatchPaths(tasks, bakefilePath);
    expect(result).toEqual([bakefilePath]);
  });

  test("inputs の重複は除去される", () => {
    const srcDir = resolve(tmp.path, "src");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(resolve(srcDir, "shared.ts"), "");

    const bakefilePath = resolve(tmp.path, "Bakefile.ts");
    const tasks = [
      { name: "a", fn: () => {}, options: { inputs: ["src/shared.ts"] } },
      { name: "b", fn: () => {}, options: { inputs: ["src/shared.ts"] } },
    ];
    const result = collectWatchPaths(tasks, bakefilePath);
    expect(result.length).toBe(1);
    expect(result[0]).toBe(srcDir);
  });

  test("glob パターン src/**/*.ts は src ディレクトリを監視対象にする", () => {
    const srcDir = resolve(tmp.path, "src");
    mkdirSync(srcDir, { recursive: true });

    const bakefilePath = resolve(tmp.path, "Bakefile.ts");
    const tasks = [
      { name: "build", fn: () => {}, options: { inputs: ["src/**/*.ts"] } },
    ];
    const result = collectWatchPaths(tasks, bakefilePath);

    expect(result).toEqual([srcDir]);
  });

  test("glob より前のディレクトリが存在しない場合はルートを監視対象にする", () => {
    const bakefilePath = resolve(tmp.path, "Bakefile.ts");
    const tasks = [
      {
        name: "build",
        fn: () => {},
        options: { inputs: ["nonexistent/**/*.ts"] },
      },
    ];
    const result = collectWatchPaths(tasks, bakefilePath);

    expect(result).toEqual([tmp.path]);
  });

  test("サブディレクトリから実行した場合も絶対パスで正規化される", () => {
    const srcDir = resolve(tmp.path, "src");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(resolve(srcDir, "main.ts"), "");

    const bakefilePath = resolve(tmp.path, "Bakefile.ts");
    writeFileSync(bakefilePath, "");

    const subDir = resolve(tmp.path, "work");
    mkdirSync(subDir, { recursive: true });

    // サブディレクトリから実行すると仮定
    const originalCwd = process.cwd();
    process.chdir(subDir);

    const tasks = [
      { name: "build", fn: () => {}, options: { inputs: ["src/main.ts"] } },
    ];

    try {
      const result = collectWatchPaths(tasks, bakefilePath);

      // 相対パスの src/main.ts が bakefilePath ルート基準の /p/src に正規化される
      expect(result).toEqual([srcDir]);
      expect(result[0]).toStrictEqual(srcDir);
    } finally {
      process.chdir(originalCwd);
    }
  });
});

describe("startWatch", () => {
  const tmp = useTempDir("overbake-watch-test");

  test("ファイル変更時に callback が呼ばれる", async () => {
    const file = resolve(tmp.path, "watched.ts");
    writeFileSync(file, "initial");

    let callCount = 0;
    const stop = startWatch(
      [file],
      async () => {
        callCount++;
      },
      50,
    );

    writeFileSync(file, "changed");

    // debounce + ファイルシステムイベント待機
    await new Promise((r) => setTimeout(r, 200));
    stop();

    expect(callCount).toBeGreaterThanOrEqual(1);
  });

  test("stop() を呼ぶと以降の変更で callback が呼ばれない", async () => {
    const file = resolve(tmp.path, "stopped.ts");
    writeFileSync(file, "initial");

    let callCount = 0;
    const stop = startWatch(
      [file],
      async () => {
        callCount++;
      },
      50,
    );
    stop();

    writeFileSync(file, "changed after stop");
    await new Promise((r) => setTimeout(r, 200));

    expect(callCount).toBe(0);
  });

  test("ネストされたディレクトリ内のファイル変更時に callback が呼ばれる", async () => {
    const srcDir = resolve(tmp.path, "src");
    const nestedDir = resolve(srcDir, "nested");
    mkdirSync(nestedDir, { recursive: true });
    const nestedFile = resolve(nestedDir, "file.ts");
    writeFileSync(nestedFile, "initial");

    let callCount = 0;
    const stop = startWatch(
      [srcDir],
      async () => {
        callCount++;
      },
      50,
    );

    writeFileSync(nestedFile, "changed");

    // debounce + ファイルシステムイベント待機
    await new Promise((r) => setTimeout(r, 200));
    stop();

    expect(callCount).toBeGreaterThanOrEqual(1);
  });

  test("同じ plan を複数回実行できる（watch 再実行用）", async () => {
    const tempDir2 = resolve(
      "/tmp",
      `overbake-plan-reuse-${Date.now()}-${Math.random()}`,
    );
    mkdirSync(tempDir2, { recursive: true });

    const bakefileContent = `
task("step1", async (ctx) => {
  ctx.log("step1 done");
});

task("step2", { deps: ["step1"] }, async (ctx) => {
  ctx.log("step2 done");
});
`;

    const bakefilePath = resolve(tempDir2, "Bakefile.ts");
    writeFileSync(bakefilePath, bakefileContent);

    const originalCwd = process.cwd();
    process.chdir(tempDir2);

    const logs: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => logs.push(a.join(" "));

    try {
      const plan = await buildPlan("step2");

      // plan を複数回実行できることを確認
      // 初回実行
      await executePlan(plan);
      const firstRunLogs = logs.length;

      // 再実行
      await executePlan(plan);
      const secondRunLogs = logs.length - firstRunLogs;

      // 両回で同じタスク数が実行されることを確認
      expect(secondRunLogs).toBe(firstRunLogs);

      // 各ステップが複数回実行されたことを確認
      const step1Logs = logs.filter((l) => l.includes("step1 done"));
      const step2Logs = logs.filter((l) => l.includes("step2 done"));

      expect(step1Logs.length).toBeGreaterThanOrEqual(2);
      expect(step2Logs.length).toBeGreaterThanOrEqual(2);
    } finally {
      console.log = orig;
      process.chdir(originalCwd);
      if (existsSync(tempDir2)) {
        rmSync(tempDir2, { recursive: true });
      }
    }
  });
});
