import { describe, expect, test } from "bun:test";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { discoverBakefile } from "../../src/bakefile/discover.ts";
import { BakefileNotFoundError } from "../../src/shared/errors.ts";
import { useTempDir } from "../support/sandbox.ts";

describe("discoverBakefile", () => {
  const tmp = useTempDir("overbake-test");

  test("finds Bakefile.ts in current directory", () => {
    const bakefilePath = resolve(tmp.path, "Bakefile.ts");
    writeFileSync(bakefilePath, "// test");

    process.chdir(tmp.path);
    const result = discoverBakefile();
    expect(realpathSync(result)).toBe(realpathSync(bakefilePath));
  });

  test("searches upward for Bakefile.ts", () => {
    const bakefilePath = resolve(tmp.path, "Bakefile.ts");
    writeFileSync(bakefilePath, "// test");

    const subDir = resolve(tmp.path, "sub", "deep");
    mkdirSync(subDir, { recursive: true });

    process.chdir(subDir);
    const result = discoverBakefile();
    expect(realpathSync(result)).toBe(realpathSync(bakefilePath));
  });

  test("throws BakefileNotFoundError when Bakefile.ts does not exist", () => {
    process.chdir(tmp.path);
    expect(() => discoverBakefile()).toThrow(BakefileNotFoundError);
  });
});
