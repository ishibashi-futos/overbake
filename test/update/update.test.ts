import { describe, expect, test } from "bun:test";
import { CliError } from "../../src/cli/error.ts";
import type { LatestRelease } from "../../src/update/github.ts";
import { resolveAssetName } from "../../src/update/platform.ts";
import { runUpdate, type UpdateDeps } from "../../src/update/update.ts";
import { BAKE_VERSION } from "../../src/version.ts";
import { useConsoleCapture } from "../support/sandbox.ts";

// 現在の実行プラットフォームに対応するアセット名（テストを環境非依存にする）。
const ASSET = resolveAssetName();

function release(tagName: string, withAsset = true): LatestRelease {
  return {
    tagName,
    version: tagName.replace(/^v/, ""),
    assets: withAsset
      ? [{ name: ASSET, browserDownloadUrl: `https://example.com/${ASSET}` }]
      : [],
  };
}

interface InstallCall {
  url: string;
  target: string;
}

function makeDeps(
  rel: LatestRelease,
  calls: InstallCall[],
): Partial<UpdateDeps> {
  return {
    fetchLatestRelease: async () => rel,
    installBinary: async (url, target) => {
      calls.push({ url, target });
    },
    currentBinaryPath: () => "/fake/path/bake",
  };
}

describe("runUpdate", () => {
  const { logs } = useConsoleCapture();

  test("--check reports an available update without installing", async () => {
    const calls: InstallCall[] = [];
    const code = await runUpdate(
      { check: true, force: false },
      makeDeps(release("v9.9.9"), calls),
    );

    expect(code).toBe(0);
    expect(calls).toHaveLength(0);
    expect(logs.some((l) => l.includes("v9.9.9"))).toBe(true);
  });

  test("reports up-to-date when no newer release exists", async () => {
    const calls: InstallCall[] = [];
    const code = await runUpdate(
      { check: false, force: false },
      makeDeps(release(`v${BAKE_VERSION}`), calls),
    );

    expect(code).toBe(0);
    expect(calls).toHaveLength(0);
    expect(logs.some((l) => l.includes("最新です"))).toBe(true);
  });

  test("installs the platform asset when a newer release exists", async () => {
    const calls: InstallCall[] = [];
    const code = await runUpdate(
      { check: false, force: false },
      makeDeps(release("v9.9.9"), calls),
    );

    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`https://example.com/${ASSET}`);
    expect(calls[0]?.target).toBe("/fake/path/bake");
  });

  test("--force installs even when not newer", async () => {
    const calls: InstallCall[] = [];
    const code = await runUpdate(
      { check: false, force: true },
      makeDeps(release(`v${BAKE_VERSION}`), calls),
    );

    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
  });

  test("throws CliError(1) when the release lacks the platform asset", async () => {
    const calls: InstallCall[] = [];
    try {
      await runUpdate(
        { check: false, force: false },
        makeDeps(release("v9.9.9", false), calls),
      );
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      expect((error as CliError).exitCode).toBe(1);
    }
    expect(calls).toHaveLength(0);
  });
});
