import { describe, expect, test } from "bun:test";
import { CliError } from "../../src/cli/error.ts";
import {
  ASSET_DARWIN_ARM64,
  ASSET_LINUX_X64,
  resolveAssetName,
} from "../../src/update/platform.ts";

describe("resolveAssetName", () => {
  test("linux/x64 maps to bake-linux-x64", () => {
    expect(resolveAssetName("linux", "x64")).toBe(ASSET_LINUX_X64);
  });

  test("darwin/arm64 maps to bake-darwin-arm64", () => {
    expect(resolveAssetName("darwin", "arm64")).toBe(ASSET_DARWIN_ARM64);
  });

  test("unsupported platform throws CliError with exitCode 2", () => {
    const cases: [NodeJS.Platform, string][] = [
      ["win32", "x64"],
      ["linux", "arm64"],
      ["darwin", "x64"],
    ];
    for (const [platform, arch] of cases) {
      try {
        resolveAssetName(platform, arch);
        throw new Error(`expected throw for ${platform}/${arch}`);
      } catch (error) {
        expect(error).toBeInstanceOf(CliError);
        expect((error as CliError).exitCode).toBe(2);
      }
    }
  });
});
