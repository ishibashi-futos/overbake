import { afterEach, describe, expect, test } from "bun:test";
import { captureConsole } from "../../src/shared/console-capture.ts";

describe("captureConsole", () => {
  const originalLog = console.log;
  const originalError = console.error;

  afterEach(() => {
    console.log = originalLog;
    console.error = originalError;
  });

  test("キャプチャ中の console.log / console.error を sink へ流す", () => {
    const received: Array<[string, string]> = [];
    const release = captureConsole((text, stream) =>
      received.push([stream, text]),
    );

    console.log("hello", "world");
    console.error("oops");
    release();

    expect(received).toEqual([
      ["log", "hello world"],
      ["error", "oops"],
    ]);
  });

  test("解除すると元の console へ戻る", () => {
    const release = captureConsole(() => {});
    release();

    expect(console.log).toBe(originalLog);
    expect(console.error).toBe(originalError);
  });

  test("二重解除しても壊れない", () => {
    const release = captureConsole(() => {});
    release();
    release();

    expect(console.log).toBe(originalLog);
  });

  /**
   * 各呼び出し側が個別に console を退避する実装では、後発が先発のキャプチャ関数を
   * 「元の関数」として保存してしまい、全て解除しても console が死んだバッファに固定された。
   */
  test("並行キャプチャを解除順に関係なく元へ戻す（出力が失われない）", () => {
    const a: string[] = [];
    const b: string[] = [];

    const releaseA = captureConsole((text) => a.push(text));
    const releaseB = captureConsole((text) => b.push(text));

    console.log("during-b");
    // 先に開始した A から解除する（従来はこの順序で console が壊れた）
    releaseA();
    console.log("still-b");
    releaseB();

    const restored: string[] = [];
    console.log = (...args: unknown[]) => restored.push(args.join(" "));
    console.log("after-release");

    expect(b).toEqual(["during-b", "still-b"]);
    expect(a).toEqual([]);
    expect(restored).toEqual(["after-release"]);
  });

  test("外側で差し替えられている console があればそこへ戻す", () => {
    const outer: string[] = [];
    console.log = (...args: unknown[]) => outer.push(args.join(" "));

    const release = captureConsole(() => {});
    release();
    console.log("to-outer");

    expect(outer).toEqual(["to-outer"]);
  });
});
