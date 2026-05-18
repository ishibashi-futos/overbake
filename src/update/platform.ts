import { CliError } from "../cli/error.ts";

// CI（.github/workflows/build.yml）が GitHub Release に添付する安定アセット名。
// この定数名は CI 側のステップと一致している必要がある。
export const ASSET_LINUX_X64 = "bake-linux-x64";
export const ASSET_DARWIN_ARM64 = "bake-darwin-arm64";

/**
 * 現在のプラットフォーム/アーキテクチャに対応するリリースアセット名を返す。
 * CI マトリクス（ubuntu-latest = linux x64, macos-latest = darwin arm64）と一致する。
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
  throw new CliError(
    `このプラットフォームはサポートされていません: ${platform}/${arch}。` +
      "対応プラットフォームは linux/x64 と darwin/arm64 です。",
    2,
  );
}
