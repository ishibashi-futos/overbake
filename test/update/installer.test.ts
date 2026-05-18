import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CliError } from "../../src/cli/error.ts";
import type { FetchLike } from "../../src/update/fetch.ts";
import { installBinary } from "../../src/update/installer.ts";
import { useTempDir } from "../support/sandbox.ts";

function bytesFetch(bytes: Uint8Array, status = 200): FetchLike {
  return async () => new Response(bytes, { status });
}

describe("installBinary", () => {
  const tmp = useTempDir("overbake-installer");

  test("replaces the target file with the downloaded bytes", async () => {
    const target = join(tmp.path, "bake");
    writeFileSync(target, "old binary");

    const newBytes = new TextEncoder().encode("new binary v2");
    await installBinary(
      "https://example.com/bake",
      target,
      bytesFetch(newBytes),
    );

    expect(readFileSync(target, "utf8")).toBe("new binary v2");
  });

  test("makes the installed binary executable (0o755)", async () => {
    const target = join(tmp.path, "bake");
    writeFileSync(target, "old");

    await installBinary(
      "https://example.com/bake",
      target,
      bytesFetch(new TextEncoder().encode("new")),
    );

    expect(statSync(target).mode & 0o777).toBe(0o755);
  });

  test("leaves no temp file behind on download failure", async () => {
    const target = join(tmp.path, "bake");
    writeFileSync(target, "old");

    try {
      await installBinary(
        "https://example.com/bake",
        target,
        bytesFetch(new Uint8Array(), 500),
      );
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
    }

    const leftovers = readdirSync(tmp.path).filter((f) => f.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
    // 既存バイナリは保持される
    expect(readFileSync(target, "utf8")).toBe("old");
  });
});
