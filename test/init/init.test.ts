import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { init } from "../../src/init/init.ts";
import { BAKEFILE_DTS_TEMPLATE } from "../../src/init/templates.ts";
import { useTempDir } from "../support/sandbox.ts";

describe("init", () => {
  useTempDir("overbake-test", { chdir: true });

  test("creates Bakefile.ts and Bakefile.d.ts", async () => {
    await init();

    expect(existsSync("Bakefile.ts")).toBe(true);
    expect(existsSync("Bakefile.d.ts")).toBe(true);
  });

  test("throws error if Bakefile.ts already exists", async () => {
    writeFileSync("Bakefile.ts", "// existing");

    expect(async () => {
      await init();
    }).toThrow();
  });

  test("throws error if Bakefile.d.ts already exists", async () => {
    writeFileSync("Bakefile.d.ts", "// existing");

    expect(async () => {
      await init();
    }).toThrow();
  });

  test("リポジトリルートの Bakefile.d.ts は BAKEFILE_DTS_TEMPLATE と完全一致する（ドリフト防止）", () => {
    const repoRoot = resolve(import.meta.dir, "../..");
    const rootDts = readFileSync(resolve(repoRoot, "Bakefile.d.ts"), "utf-8");
    expect(rootDts).toBe(BAKEFILE_DTS_TEMPLATE);
  });

  test("generated Bakefile.ts contains triple-slash reference", async () => {
    await init();

    const content = readFileSync("Bakefile.ts", "utf-8");
    expect(content).toContain('/// <reference path="./Bakefile.d.ts" />');
  });

  test("generated Bakefile.d.ts declares task function", async () => {
    await init();

    const content = readFileSync("Bakefile.d.ts", "utf-8");
    expect(content).toContain("declare function task");
  });

  test("generated Bakefile.d.ts declares task.default function", async () => {
    await init();

    const content = readFileSync("Bakefile.d.ts", "utf-8");
    expect(content).toContain("function defaultTask");
    expect(content).toContain("export { defaultTask as default }");
    expect(content).toContain("declare namespace task");
  });

  test("init(true) updates only Bakefile.d.ts without touching Bakefile.ts", async () => {
    writeFileSync("Bakefile.ts", "// existing bakefile");
    const originalBakefileContent = readFileSync("Bakefile.ts", "utf-8");

    await init(true);

    expect(existsSync("Bakefile.d.ts")).toBe(true);
    const updatedBakefileContent = readFileSync("Bakefile.ts", "utf-8");
    expect(updatedBakefileContent).toBe(originalBakefileContent);
  });

  test("generated Bakefile.d.ts type-checks task.default and Bun globals", async () => {
    const repoRoot = resolve(import.meta.dir, "../..");
    const tempDtsDir = resolve(
      "/tmp",
      `overbake-dts-test-${Date.now()}-${Math.random()}`,
    );
    mkdirSync(tempDtsDir, { recursive: true });

    try {
      const dtsPath = resolve(tempDtsDir, "Bakefile.d.ts");
      const tsPath = resolve(tempDtsDir, "test.ts");
      const tsconfigPath = resolve(tempDtsDir, "tsconfig.json");

      await init();
      const generatedDts = readFileSync("Bakefile.d.ts", "utf-8");
      writeFileSync(dtsPath, generatedDts);

      writeFileSync(
        tsPath,
        `/// <reference path="./Bakefile.d.ts" />

const x = task("x", async () => {
  await Bun.file("package.json").text();
});
task.default(x);

// task.service: run の 3 形（コマンド / 関数 / タスクハンドル）
const db = task.service(
  "db",
  { ready: { port: 5432 }, retry: { attempts: 3 } },
  ["docker", ["compose", "up", "postgres"]],
);
const worker = task.service("worker", async ({ cmd }) => {
  await cmd("bun", ["run", "worker.ts"]);
});
const wrapped = task.service("wrapped", x);

// task.compose: ステージ（起動順）とグループ（同時起動）
task.compose("dev", { desc: "開発環境" }, db, [worker, wrapped]);

// @ts-expect-error 通常タスクは compose に渡せない（Service ではない）
task.compose("bad-task", x);
// @ts-expect-error コマンドタプルは compose に渡せない（Service ではない）
task.compose("bad-command", ["bun", ["run", "x.ts"]]);
`,
      );

      // エディタが Bakefile.ts を割り当てる inferred project を模した設定。
      // types: [] で @types の自動取り込みを止め、d.ts の
      // `/// <reference types="bun" />` だけで Bun.* が解決することを検証する。
      // typeRoots は一時ディレクトリからでも @types/bun を引けるようにするため。
      writeFileSync(
        tsconfigPath,
        JSON.stringify({
          compilerOptions: {
            target: "ESNext",
            strict: true,
            skipLibCheck: true,
            noEmit: true,
            types: [],
            typeRoots: [resolve(repoRoot, "node_modules/@types")],
          },
          files: ["test.ts"],
        }),
      );

      // cwd はリポジトリルート。一時ディレクトリで bunx すると tsc を
      // npm から取りに行き、実行するバージョンが不定になるうえ CI で
      // タイムアウトする。files は tsconfig.json の位置を基準に解決される。
      execSync(`bunx tsc -p "${tsconfigPath}"`, {
        cwd: repoRoot,
        stdio: "pipe",
      });
    } finally {
      rmSync(tempDtsDir, { recursive: true, force: true });
    }
    // 実 tsc をサブプロセスで走らせるため、既定の 5s では CI で不足しうる
  }, 15_000);
});
