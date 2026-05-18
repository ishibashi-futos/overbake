import { CliError } from "../cli/error.ts";
import type { FetchLike } from "./fetch.ts";

const RELEASE_API_URL =
  "https://api.github.com/repos/ishibashi-futos/overbake/releases/latest";

export interface ReleaseAsset {
  name: string;
  browserDownloadUrl: string;
}

export interface LatestRelease {
  /** 例: "v0.2.0" */
  tagName: string;
  /** tagName から先頭 "v" を除いた値。例: "0.2.0" */
  version: string;
  assets: ReleaseAsset[];
}

interface GitHubReleaseResponse {
  tag_name?: unknown;
  assets?: unknown;
}

const REQUEST_HEADERS: Record<string, string> = {
  "User-Agent": "overbake-bake-updater",
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};

/**
 * GitHub の最新リリースを取得する。
 * ネットワーク失敗・リリース未公開・パース失敗はいずれも CliError(exitCode=1)。
 */
export async function fetchLatestRelease(
  fetchImpl: FetchLike = fetch,
): Promise<LatestRelease> {
  let response: Response;
  try {
    response = await fetchImpl(RELEASE_API_URL, { headers: REQUEST_HEADERS });
  } catch {
    throw new CliError(
      "ネットワークエラー: 最新リリースを取得できませんでした",
      1,
    );
  }

  if (response.status === 404) {
    throw new CliError("リリースがまだ公開されていません", 1);
  }
  if (!response.ok) {
    throw new CliError(
      `GitHub API がエラーを返しました (HTTP ${response.status})`,
      1,
    );
  }

  let body: GitHubReleaseResponse;
  try {
    body = (await response.json()) as GitHubReleaseResponse;
  } catch {
    throw new CliError("GitHub API のレスポンスを解析できませんでした", 1);
  }

  const tagName = body.tag_name;
  if (typeof tagName !== "string" || tagName.length === 0) {
    throw new CliError("GitHub API のレスポンスに tag_name がありません", 1);
  }

  const rawAssets = Array.isArray(body.assets) ? body.assets : [];
  const assets: ReleaseAsset[] = [];
  for (const asset of rawAssets) {
    const name = (asset as { name?: unknown }).name;
    const url = (asset as { browser_download_url?: unknown })
      .browser_download_url;
    if (typeof name === "string" && typeof url === "string") {
      assets.push({ name, browserDownloadUrl: url });
    }
  }

  return {
    tagName,
    version: tagName.replace(/^v/, ""),
    assets,
  };
}
