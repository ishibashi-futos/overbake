import { describe, expect, test } from "bun:test";
import { compareVersions, isNewer } from "../../src/update/semver.ts";

describe("compareVersions", () => {
  test("newer major/minor/patch returns positive", () => {
    expect(compareVersions("1.0.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareVersions("0.2.0", "0.1.9")).toBeGreaterThan(0);
    expect(compareVersions("0.1.2", "0.1.1")).toBeGreaterThan(0);
  });

  test("older version returns negative", () => {
    expect(compareVersions("0.1.0", "0.2.0")).toBeLessThan(0);
  });

  test("equal versions return 0", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });

  test("leading v is ignored", () => {
    expect(compareVersions("v0.2.0", "0.1.0")).toBeGreaterThan(0);
    expect(compareVersions("v1.0.0", "v1.0.0")).toBe(0);
  });

  test("compares numerically, not lexically", () => {
    expect(compareVersions("0.10.0", "0.9.0")).toBeGreaterThan(0);
  });

  test("prerelease is older than the same release version", () => {
    expect(compareVersions("0.1.0-dev", "0.1.0")).toBeLessThan(0);
    expect(compareVersions("0.1.0", "0.1.0-dev")).toBeGreaterThan(0);
  });
});

describe("isNewer", () => {
  test("true when latest is a newer release", () => {
    expect(isNewer("0.2.0", "0.1.0")).toBe(true);
  });

  test("false when latest equals current", () => {
    expect(isNewer("0.1.0", "0.1.0")).toBe(false);
  });

  test("dev build is always older than any release", () => {
    expect(isNewer("0.1.0", "0.1.0-dev")).toBe(true);
    expect(isNewer("0.0.0", "0.0.0-dev")).toBe(true);
  });
});
