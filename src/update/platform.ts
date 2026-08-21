import { CliError } from "../cli/error.ts";

// CI（.github/workflows/build.yml）が GitHub Release に添付する安定アセット名。
// この定数値は CI のビルドマトリクス（matrix.asset）と一致している必要がある。
export const ASSET_LINUX_X64 = "bake-linux-x64";
export const ASSET_DARWIN_ARM64 = "bake-darwin-arm64";
export const ASSET_WINDOWS_X64 = "bake-windows-x64.exe";

/**
 * 現在のプラットフォーム/アーキテクチャに対応するリリースアセット名を返す。
 * CI マトリクス（ubuntu-latest = linux x64, macos-latest = darwin arm64,
 * windows-latest = win32 x64）と一致する。
 * 非対応の組み合わせは設定エラー（exitCode=2）。
 */
export function resolveAssetName(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  if (platform === "linux" && arch === "x64") {
    return ASSET_LINUX_X64;
  }
  if (platform === "darwin" && arch === "arm64") {
    return ASSET_DARWIN_ARM64;
  }
  if (platform === "win32" && arch === "x64") {
    return ASSET_WINDOWS_X64;
  }
  throw new CliError(
    `このプラットフォームはサポートされていません: ${platform}/${arch}。` +
      "対応プラットフォームは linux/x64・darwin/arm64・win32/x64 です。",
    2,
  );
}
