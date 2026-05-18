// `vX.Y.Z` 形式のリリースタグ前提の最小バージョン比較。
// 完全な SemVer 2.0 prerelease 順序は実装しない（リリースタグは常に `vX.Y.Z`）。

interface ParsedVersion {
  core: [number, number, number];
  prerelease: boolean;
}

function parse(version: string): ParsedVersion {
  const trimmed = version.trim().replace(/^v/, "");
  const [coreStr = "", ...rest] = trimmed.split("-");
  const parts = coreStr.split(".");
  const core: [number, number, number] = [
    Number.parseInt(parts[0] ?? "0", 10) || 0,
    Number.parseInt(parts[1] ?? "0", 10) || 0,
    Number.parseInt(parts[2] ?? "0", 10) || 0,
  ];
  return { core, prerelease: rest.length > 0 };
}

/**
 * a が b より新しいなら正、古いなら負、同じなら 0 を返す。
 * 数値トリプルが同値なら、prerelease 付き（`0.1.0-dev`）はリリース版より古い。
 */
export function compareVersions(a: string, b: string): number {
  const pa = parse(a);
  const pb = parse(b);

  for (let i = 0; i < 3; i++) {
    const diff = (pa.core[i] ?? 0) - (pb.core[i] ?? 0);
    if (diff !== 0) {
      return diff > 0 ? 1 : -1;
    }
  }

  if (pa.prerelease === pb.prerelease) {
    return 0;
  }
  // prerelease 付きはリリース版より古い
  return pa.prerelease ? -1 : 1;
}

/** latest が current より新しいなら true。 */
export function isNewer(latest: string, current: string): boolean {
  return compareVersions(latest, current) > 0;
}
