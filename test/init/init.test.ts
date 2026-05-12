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

  test("generated Bakefile.d.ts is valid TypeScript with task.default usage", async () => {
    const tempDtsDir = resolve(
      "/tmp",
      `overbake-dts-test-${Date.now()}-${Math.random()}`,
    );
    mkdirSync(tempDtsDir, { recursive: true });

    try {
      const dtsPath = resolve(tempDtsDir, "Bakefile.d.ts");
      const tsPath = resolve(tempDtsDir, "test.ts");

      await init();
      const generatedDts = readFileSync("Bakefile.d.ts", "utf-8");
      writeFileSync(dtsPath, generatedDts);

      writeFileSync(
        tsPath,
        `/// <reference path="./Bakefile.d.ts" />\n\nconst x = task("x", () => {});\ntask.default(x);\n`,
      );

      execSync(`bunx tsc --noEmit --strict "${tsPath}"`, {
        cwd: tempDtsDir,
        stdio: "pipe",
      });
    } finally {
      rmSync(tempDtsDir, { recursive: true, force: true });
    }
  });
});
