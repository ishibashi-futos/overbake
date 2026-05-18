import { CliError } from "../cli/error.ts";
import { BAKE_VERSION } from "../version.ts";
import { fetchLatestRelease } from "./github.ts";
import { currentBinaryPath, installBinary } from "./installer.ts";
import { resolveAssetName } from "./platform.ts";
import { isNewer } from "./semver.ts";

export interface UpdateOptions {
  /** --check: 確認のみ、インストールしない */
  check: boolean;
  /** --force: 同一/新しいバージョンでも再インストール */
  force: boolean;
}

/** テスト用に差し替え可能な依存。既定は実関数。 */
export interface UpdateDeps {
  fetchLatestRelease: typeof fetchLatestRelease;
  installBinary: typeof installBinary;
  currentBinaryPath: typeof currentBinaryPath;
}

const DEFAULT_DEPS: UpdateDeps = {
  fetchLatestRelease,
  installBinary,
  currentBinaryPath,
};

/**
 * `bake update` の実体。
 * 戻り値は終了コード（0: 成功/最新、1: 実行時失敗、2: 設定エラー）。
 * CliError は呼び出し側 main.ts の catch が exitCode を尊重する。
 */
export async function runUpdate(
  options: UpdateOptions,
  deps: Partial<UpdateDeps> = {},
): Promise<number> {
  const d = { ...DEFAULT_DEPS, ...deps };

  // 非対応プラットフォームは CliError(2) を投げる（main.ts の catch が処理）。
  const assetName = resolveAssetName();

  const release = await d.fetchLatestRelease();

  if (!isNewer(release.version, BAKE_VERSION) && !options.force) {
    console.log(`bake は最新です (v${BAKE_VERSION})`);
    return 0;
  }

  if (options.check) {
    console.log(
      `新しいバージョンが利用可能です: ${release.tagName} (現在: v${BAKE_VERSION})`,
    );
    console.log("`bake update` で更新できます。");
    return 0;
  }

  const asset = release.assets.find((a) => a.name === assetName);
  if (!asset) {
    throw new CliError(
      `リリース ${release.tagName} に ${assetName} が添付されていません`,
      1,
    );
  }

  console.log(`${release.tagName} をダウンロードしています...`);
  await d.installBinary(asset.browserDownloadUrl, d.currentBinaryPath());

  console.log(`bake を ${release.tagName} に更新しました`);
  return 0;
}
