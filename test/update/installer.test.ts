import { describe, expect, test } from "bun:test";
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { CliError } from "../../src/cli/error.ts";
import type { FetchLike } from "../../src/update/fetch.ts";
import { installBinary } from "../../src/update/installer.ts";
import { useTempDir } from "../support/sandbox.ts";

function bytesFetch(text: string, status = 200): FetchLike {
  return async () => new Response(new TextEncoder().encode(text), { status });
}

describe("installBinary", () => {
  const tmp = useTempDir("overbake-installer");

  test("replaces the target file with the downloaded bytes", async () => {
    const target = join(tmp.path, "bake");
    writeFileSync(target, "old binary");

    await installBinary("https://example.com/bake", target, {
      fetch: bytesFetch("new binary v2"),
    });

    expect(readFileSync(target, "utf8")).toBe("new binary v2");
  });

  test("makes the installed binary executable (0o755)", async () => {
    const target = join(tmp.path, "bake");
    writeFileSync(target, "old");

    await installBinary("https://example.com/bake", target, {
      fetch: bytesFetch("new"),
    });

    expect(statSync(target).mode & 0o777).toBe(0o755);
  });

  test("leaves no temp file behind on download failure", async () => {
    const target = join(tmp.path, "bake");
    writeFileSync(target, "old");

    try {
      await installBinary("https://example.com/bake", target, {
        fetch: bytesFetch("", 500),
      });
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
    }

    const leftovers = readdirSync(tmp.path).filter((f) => f.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
    // 既存バイナリは保持される
    expect(readFileSync(target, "utf8")).toBe("old");
  });

  // Windows 分岐は platform を注入して Unix 上でも検証する
  // （実行中 .exe への上書き rename ができないため、退避 → 配置の順で置換する）。
  describe("win32", () => {
    test("replaces the target via rename-then-place", async () => {
      const target = join(tmp.path, "bake.exe");
      writeFileSync(target, "old binary");

      await installBinary("https://example.com/bake.exe", target, {
        fetch: bytesFetch("new binary v2"),
        platform: "win32",
      });

      expect(readFileSync(target, "utf8")).toBe("new binary v2");
      // 退避ファイルを削除できる環境では残さない
      const backups = readdirSync(tmp.path).filter((f) => f.includes(".old-"));
      expect(backups).toEqual([]);
    });

    test("installs when the target does not exist yet", async () => {
      const target = join(tmp.path, "bake.exe");

      await installBinary("https://example.com/bake.exe", target, {
        fetch: bytesFetch("fresh"),
        platform: "win32",
      });

      expect(readFileSync(target, "utf8")).toBe("fresh");
    });

    test("cleans up backups left by a previous update", async () => {
      const target = join(tmp.path, "bake.exe");
      writeFileSync(target, "old binary");
      // 実行中ロックで消せずに残った前回の退避ファイル
      const stale = join(tmp.path, "bake.exe.old-999");
      writeFileSync(stale, "two versions ago");
      // 別バイナリの退避ファイルには触れない
      const other = join(tmp.path, "other.exe.old-999");
      writeFileSync(other, "not ours");

      await installBinary("https://example.com/bake.exe", target, {
        fetch: bytesFetch("new binary v2"),
        platform: "win32",
      });

      expect(existsSync(stale)).toBe(false);
      expect(existsSync(other)).toBe(true);
      expect(readFileSync(target, "utf8")).toBe("new binary v2");
    });
  });
});
