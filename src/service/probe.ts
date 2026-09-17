import { connect as netConnect } from "node:net";

/**
 * TCP 接続確認。`ready: { port }` の probe に使用する。
 * 接続できたら socket を破棄して true、エラーまたは timeoutMs 超過で false を返す（例外は投げない）。
 */
export function tryConnect(
  port: number,
  host: string,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const socket = netConnect({ port, host });

    const settle = (result: boolean): void => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => settle(true));
    socket.once("timeout", () => settle(false));
    socket.once("error", () => settle(false));
  });
}
