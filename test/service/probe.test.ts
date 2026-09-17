import { afterEach, describe, expect, test } from "bun:test";
import { type AddressInfo, createServer, type Server } from "node:net";
import { tryConnect } from "../../src/service/probe.ts";

describe("tryConnect", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      server = undefined;
    }
  });

  test("port 0 で listen したサーバへの接続は true", async () => {
    server = createServer();
    await new Promise<void>((resolve) =>
      server?.listen(0, "127.0.0.1", resolve),
    );
    const port = (server.address() as AddressInfo).port;

    expect(await tryConnect(port, "127.0.0.1", 500)).toBe(true);
  });

  test("誰も listen していないポートへの接続は false", async () => {
    // 一時的に listen してすぐ閉じ、そのポート番号を再利用する（誰も listen していない状態を作る）
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const port = (probe.address() as AddressInfo).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));

    expect(await tryConnect(port, "127.0.0.1", 500)).toBe(false);
  });

  test("timeoutMs 超過で false", async () => {
    // TEST-NET-1（RFC 5737）の到達不能アドレス相手にタイムアウトさせる
    expect(await tryConnect(65530, "192.0.2.1", 200)).toBe(false);
  }, 3000);
});
