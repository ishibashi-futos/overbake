import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runGlaze } from "../../src/cli/glaze.ts";
import {
  useConsoleCapture,
  useProcessExitMock,
  useTempDir,
} from "../support/sandbox.ts";

const MESSY = [
  "task('build', {",
  "desc: 'CLI をビルド',",
  "}, async ({ cmd }) => {",
  "await cmd('bun', ['build']);",
  "});",
  "",
].join("\n");

const GLAZED = [
  'task("build", {',
  '  desc: "CLI をビルド",',
  "}, async ({ cmd }) => {",
  '  await cmd("bun", ["build"]);',
  "});",
  "",
].join("\n");

describe("runGlaze", () => {
  const tmp = useTempDir("overbake-glaze", { chdir: true });
  const { logs } = useConsoleCapture();
  const exitCode = useProcessExitMock();

  test("引数なしでカレントの Bakefile.ts を整形する", async () => {
    writeFileSync("Bakefile.ts", MESSY);
    const code = await runGlaze(undefined, false);
    expect(code).toBe(0);
    expect(readFileSync(resolve(tmp.path, "Bakefile.ts"), "utf-8")).toBe(
      GLAZED,
    );
  });

  test("パス指定でそのファイルを整形する", async () => {
    writeFileSync("other.ts", MESSY);
    const code = await runGlaze("other.ts", false);
    expect(code).toBe(0);
    expect(readFileSync(resolve(tmp.path, "other.ts"), "utf-8")).toBe(GLAZED);
  });

  test("既に整形済みなら何も書き換えず 0 を返す", async () => {
    writeFileSync("Bakefile.ts", GLAZED);
    const code = await runGlaze(undefined, false);
    expect(code).toBe(0);
    expect(readFileSync(resolve(tmp.path, "Bakefile.ts"), "utf-8")).toBe(
      GLAZED,
    );
    expect(logs.join("\n")).toContain("already glazed");
  });

  test("--check: 未整形なら 1 を返し、ファイルは変更しない", async () => {
    writeFileSync("Bakefile.ts", MESSY);
    const code = await runGlaze(undefined, true);
    expect(code).toBe(1);
    expect(readFileSync(resolve(tmp.path, "Bakefile.ts"), "utf-8")).toBe(MESSY);
  });

  test("--check: 整形済みなら 0 を返す", async () => {
    writeFileSync("Bakefile.ts", GLAZED);
    const code = await runGlaze(undefined, true);
    expect(code).toBe(0);
  });

  test("Bakefile.ts が無ければ exit 2 のエラー", async () => {
    await expect(runGlaze(undefined, false)).rejects.toMatchObject({
      exitCode: 2,
    });
  });

  test("指定したファイルが無ければ exit 2 のエラー", async () => {
    await expect(runGlaze("missing.ts", false)).rejects.toMatchObject({
      exitCode: 2,
    });
  });

  test("main 経由でも整形できる", async () => {
    const { main } = await import("../../src/cli/main.ts");
    writeFileSync("Bakefile.ts", MESSY);
    await main(["glaze"]);
    expect(exitCode()).toBeUndefined();
    expect(readFileSync(resolve(tmp.path, "Bakefile.ts"), "utf-8")).toBe(
      GLAZED,
    );
  });

  test("main 経由の --check は exit 1", async () => {
    const { main } = await import("../../src/cli/main.ts");
    writeFileSync("Bakefile.ts", MESSY);
    await main(["glaze", "--check"]);
    expect(exitCode()).toBe(1);
  });
});
