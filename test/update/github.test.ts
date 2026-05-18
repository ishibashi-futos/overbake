import { describe, expect, test } from "bun:test";
import { CliError } from "../../src/cli/error.ts";
import type { FetchLike } from "../../src/update/fetch.ts";
import { fetchLatestRelease } from "../../src/update/github.ts";

function jsonFetch(body: unknown, status = 200): FetchLike {
  return async () => new Response(JSON.stringify(body), { status });
}

describe("fetchLatestRelease", () => {
  test("parses tag_name and assets", async () => {
    const release = await fetchLatestRelease(
      jsonFetch({
        tag_name: "v0.2.0",
        assets: [
          {
            name: "bake-linux-x64",
            browser_download_url: "https://example.com/bake-linux-x64",
          },
          {
            name: "bake-darwin-arm64",
            browser_download_url: "https://example.com/bake-darwin-arm64",
          },
        ],
      }),
    );

    expect(release.tagName).toBe("v0.2.0");
    expect(release.version).toBe("0.2.0");
    expect(release.assets).toHaveLength(2);
    expect(release.assets[0]).toEqual({
      name: "bake-linux-x64",
      browserDownloadUrl: "https://example.com/bake-linux-x64",
    });
  });

  test("missing assets field yields an empty array", async () => {
    const release = await fetchLatestRelease(jsonFetch({ tag_name: "v1.0.0" }));
    expect(release.assets).toEqual([]);
  });

  test("404 throws a 'not published' CliError", async () => {
    const fetch404: FetchLike = async () => new Response("", { status: 404 });
    try {
      await fetchLatestRelease(fetch404);
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      expect((error as CliError).exitCode).toBe(1);
      expect((error as CliError).message).toContain("公開されていません");
    }
  });

  test("non-OK status throws CliError", async () => {
    const fetch403: FetchLike = async () => new Response("", { status: 403 });
    try {
      await fetchLatestRelease(fetch403);
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      expect((error as CliError).message).toContain("403");
    }
  });

  test("network failure throws a network CliError", async () => {
    const fetchThrows: FetchLike = async () => {
      throw new TypeError("network down");
    };
    try {
      await fetchLatestRelease(fetchThrows);
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      expect((error as CliError).message).toContain("ネットワークエラー");
    }
  });

  test("sends a User-Agent header", async () => {
    let capturedHeaders: Record<string, string> | undefined;
    const spyFetch: FetchLike = async (_url, init) => {
      capturedHeaders = init?.headers;
      return new Response(JSON.stringify({ tag_name: "v0.1.0" }), {
        status: 200,
      });
    };

    await fetchLatestRelease(spyFetch);

    expect(capturedHeaders?.["User-Agent"]).toBeDefined();
  });
});
