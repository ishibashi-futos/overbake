import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runCompose } from "../../src/runtime/compose.ts";
import type { ComposeItem, Task } from "../../src/types.ts";
import { useTempDir } from "../support/sandbox.ts";

// Windows では SIGTERM 相当の挙動が POSIX と異なるため MVP では検証対象外
const describeIfPosix = process.platform === "win32" ? describe.skip : describe;

/**
 * temp dir に fixture スクリプトを書き出し、command タプルから参照できるようにする。
 * すべて Bun が解釈可能な ts ファイル（node の child_process.spawn から `bun <file>` で起動する）。
 */
function writeFixtures(dir: string): void {
  writeFileSync(
    resolve(dir, "quick-exit-0.ts"),
    `console.log("started"); process.exit(0);\n`,
  );
  writeFileSync(
    resolve(dir, "quick-exit-1.ts"),
    `console.log("started"); process.exit(1);\n`,
  );
  writeFileSync(
    resolve(dir, "forever.ts"),
    `console.log("started");
process.on("SIGTERM", () => { process.exit(143); });
setInterval(() => {}, 1 << 30);
`,
  );
  writeFileSync(
    resolve(dir, "ignores-sigterm.ts"),
    `process.on("SIGTERM", () => {});
console.log("started");
setInterval(() => {}, 1 << 30);
`,
  );
}

interface CaptureHandle {
  readonly chunks: string[];
  readonly text: () => string;
}

function makeCapture(): CaptureHandle {
  const chunks: string[] = [];
  return {
    chunks,
    text: () => chunks.join(""),
  };
}

describeIfPosix("runCompose", () => {
  const tmp = useTempDir("overbake-compose");

  beforeEach(() => {
    writeFixtures(tmp.path);
  });

  test("並列起動: 全サービスがほぼ同時に started を出す", async () => {
    const capture = makeCapture();
    const start = Date.now();
    const composePromise = runCompose(
      { taskName: "dev", root: tmp.path, cwd: tmp.path },
      [
        ["bun", ["forever.ts"]],
        ["bun", ["forever.ts"]],
        ["bun", ["forever.ts"]],
      ],
      {
        graceMs: 100,
        noColor: true,
        writeOut: (t) => capture.chunks.push(t),
      },
    );

    // 全て started を出すまで待つ（ポーリング）
    while (
      capture.text().split("started").length - 1 < 3 &&
      Date.now() - start < 4000
    ) {
      await new Promise((r) => setTimeout(r, 20));
    }
    const elapsed = Date.now() - start;
    expect(capture.text().split("started").length - 1).toBe(3);
    // 並列起動の証拠: 3 つを直列に起動したら spawn 1 回 ~100ms 想定で 300ms 超は普通だが、
    // 1.5s 以内には全部出ているはず（CI でも十分余裕がある閾値）
    expect(elapsed).toBeLessThan(2500);

    // SIGINT は user-initiated stop。fail-fast ではなく正常 resolve する。
    process.emit("SIGINT", "SIGINT" as NodeJS.Signals);
    await composePromise;
  });

  test("fail-fast (異常終了): 1 つが exit 1 で他に SIGTERM が届く", async () => {
    const capture = makeCapture();
    await expect(
      runCompose(
        { taskName: "dev", root: tmp.path, cwd: tmp.path },
        [
          ["bun", ["quick-exit-1.ts"]],
          ["bun", ["forever.ts"]],
        ],
        {
          graceMs: 500,
          noColor: true,
          writeOut: (t) => capture.chunks.push(t),
        },
      ),
    ).rejects.toThrow(/compose failed.*exited with code 1/);
  });

  test("fail-fast (成功 exit): exit 0 でも unexpected 扱いで失敗する", async () => {
    const capture = makeCapture();
    await expect(
      runCompose(
        { taskName: "dev", root: tmp.path, cwd: tmp.path },
        [
          ["bun", ["quick-exit-0.ts"]],
          ["bun", ["forever.ts"]],
        ],
        {
          graceMs: 500,
          noColor: true,
          writeOut: (t) => capture.chunks.push(t),
        },
      ),
    ).rejects.toThrow(/exited unexpectedly \(code 0\)/);
  });

  test("SIGKILL フォールバック: SIGTERM 無視プロセスでも grace 後に止まる", async () => {
    const capture = makeCapture();
    const start = Date.now();
    await expect(
      runCompose(
        { taskName: "dev", root: tmp.path, cwd: tmp.path },
        [
          ["bun", ["quick-exit-1.ts"]],
          ["bun", ["ignores-sigterm.ts"]],
        ],
        {
          graceMs: 150,
          noColor: true,
          writeOut: (t) => capture.chunks.push(t),
        },
      ),
    ).rejects.toThrow();
    const elapsed = Date.now() - start;
    // grace 150ms 経過後に SIGKILL が飛ぶため、概ね 150〜1500ms 程度で解決する
    expect(elapsed).toBeLessThan(3000);
  });

  test("prefix 出力: 全 service 名が最大幅にパディングされて [name] で前置される", async () => {
    const capture = makeCapture();
    const composePromise = runCompose(
      { taskName: "dev", root: tmp.path, cwd: tmp.path },
      [
        ["bun", ["forever.ts"]],
        ["bun", ["forever.ts"]],
      ],
      {
        graceMs: 100,
        noColor: true,
        writeOut: (t) => capture.chunks.push(t),
      },
    );
    // 2 つの started を待つ
    const start = Date.now();
    while (
      capture.text().split("started").length - 1 < 2 &&
      Date.now() - start < 3000
    ) {
      await new Promise((r) => setTimeout(r, 20));
    }
    const out = capture.text();
    // ラベルは "bun forever.ts" 同士で同幅なのでパディングは追加されない
    expect(out).toContain("[bun forever.ts] started");

    process.emit("SIGINT", "SIGINT" as NodeJS.Signals);
    await composePromise;
  });

  test("ラベル幅パディング: 異なる長さの label が最大幅に揃う", async () => {
    const capture = makeCapture();
    // 短い名前の task ハンドルと長い名前の command タプルを混ぜる
    const ui: Task = {
      name: "ui",
      fn: async (ctx) => {
        await ctx.cmd("bun", [resolve(tmp.path, "forever.ts")]);
      },
      options: {},
    };
    const composePromise = runCompose(
      { taskName: "dev", root: tmp.path, cwd: tmp.path },
      [ui, ["bun", ["forever.ts"]]],
      {
        graceMs: 100,
        noColor: true,
        writeOut: (t) => capture.chunks.push(t),
      },
    );
    const start = Date.now();
    while (
      capture.text().split("started").length - 1 < 2 &&
      Date.now() - start < 3000
    ) {
      await new Promise((r) => setTimeout(r, 20));
    }
    const out = capture.text();
    // 短い "ui" は "bun forever.ts" (14 文字) と同幅にパディングされる
    expect(out).toContain("[ui            ] ");
    expect(out).toContain("[bun forever.ts] ");

    process.emit("SIGINT", "SIGINT" as NodeJS.Signals);
    await composePromise;
  });

  test("SIGINT 伝播: process.emit('SIGINT') で全 service が停止して正常 resolve する", async () => {
    const capture = makeCapture();
    const composePromise = runCompose(
      { taskName: "dev", root: tmp.path, cwd: tmp.path },
      [
        ["bun", ["forever.ts"]],
        ["bun", ["forever.ts"]],
      ],
      {
        graceMs: 200,
        noColor: true,
        writeOut: (t) => capture.chunks.push(t),
      },
    );
    // 起動完了を待つ
    const start = Date.now();
    while (
      capture.text().split("started").length - 1 < 2 &&
      Date.now() - start < 3000
    ) {
      await new Promise((r) => setTimeout(r, 20));
    }
    process.emit("SIGINT", "SIGINT" as NodeJS.Signals);
    // SIGINT/SIGTERM は user-initiated stop なので throw せず正常 resolve する
    await composePromise;
    // 「Command "bun" exited with code null」のような signal 起因のエラー文字列が混ざっていないこと
    expect(capture.text()).not.toMatch(/exited with code null/);
    expect(capture.text()).not.toMatch(/compose failed/);
  });

  test("Task ハンドル渡し: ctx.cmd の grandchild に SIGTERM が伝播する", async () => {
    const capture = makeCapture();
    const ui: Task = {
      name: "ui",
      fn: async (ctx) => {
        await ctx.cmd("bun", [resolve(tmp.path, "forever.ts")]);
      },
      options: {},
    };
    const composePromise = runCompose(
      { taskName: "dev", root: tmp.path, cwd: tmp.path },
      [ui, ["bun", ["quick-exit-1.ts"]]],
      {
        graceMs: 500,
        noColor: true,
        writeOut: (t) => capture.chunks.push(t),
      },
    );
    // quick-exit-1 が prematurely exit するため fail-fast が発火、ui には SIGTERM が伝播して止まる。
    await expect(composePromise).rejects.toThrow(/compose failed/);
    // ラベルは "bun quick-exit-1.ts" と同幅にパディングされるので [ui<spaces>] になる。
    // 重要なのは ui の forever.ts が出力した "started" が prefix 付きで現れていること。
    expect(capture.text()).toMatch(/\[ui\s+\] started/);
    // signal 経由の grandchild 停止は user-initiated 扱いなのでエラー文字列は出ない
    expect(capture.text()).not.toMatch(/exited with code null/);
  });

  test("空配列: 何もせず即座に解決する", async () => {
    await runCompose({ taskName: "noop", root: tmp.path, cwd: tmp.path }, [], {
      noColor: true,
      writeOut: () => {},
    });
  });

  test("ハンドラの後始末: 解決後に再度 SIGINT を emit してもエラーにならない", async () => {
    await runCompose(
      { taskName: "dev", root: tmp.path, cwd: tmp.path },
      [["bun", ["quick-exit-0.ts"]]],
      {
        graceMs: 100,
        noColor: true,
        writeOut: () => {},
      },
    ).catch(() => {
      // 期待通り fail-fast で reject される
    });
    // この時点で compose 内で installed したリスナは uninstall されている。
    // 別途プロセスに残るリスナがあれば process.listenerCount で増えてしまうが、
    // 後続テストへの副作用がないことだけを確認する。
    expect(process.listenerCount("SIGINT")).toBeLessThan(10);
    expect(process.listenerCount("SIGTERM")).toBeLessThan(10);
  });
});

describeIfPosix("runCompose - 統合: registry → runCompose", () => {
  const tmp = useTempDir("overbake-compose-int", { chdir: true });
  let listenerSnapshot: { sigint: number; sigterm: number };

  beforeEach(() => {
    writeFixtures(tmp.path);
    listenerSnapshot = {
      sigint: process.listenerCount("SIGINT"),
      sigterm: process.listenerCount("SIGTERM"),
    };
  });

  afterEach(() => {
    // process.emit を経由していないテスト後にリスナが残っていないか軽く確認
    const after = {
      sigint: process.listenerCount("SIGINT"),
      sigterm: process.listenerCount("SIGTERM"),
    };
    expect(after.sigint).toBeLessThanOrEqual(listenerSnapshot.sigint + 1);
    expect(after.sigterm).toBeLessThanOrEqual(listenerSnapshot.sigterm + 1);
  });

  test("task.compose 経由で Bakefile から並列起動できる（fail-fast 検証）", async () => {
    writeFileSync(
      resolve(tmp.path, "Bakefile.ts"),
      `task.compose("dev",
        ["bun", ["quick-exit-1.ts"]],
        ["bun", ["forever.ts"]],
      );`,
    );

    const { buildPlan, executePlan } = await import(
      "../../src/runtime/executor.ts"
    );
    const plan = await buildPlan("dev");

    await expect(
      executePlan(plan, { noColor: true, noSummary: true }),
    ).rejects.toThrow(/compose failed/);
  });
});

describeIfPosix("ComposeItem 静的記述", () => {
  test("task.compose を含む TaskOptions が ComposeStep[] を持つことを ComposeItem 型から保証", () => {
    // 型のみのスモーク。実行時アサーションは registry.test.ts に存在。
    const item: ComposeItem = ["echo", ["x"]];
    expect(Array.isArray(item)).toBe(true);
  });
});
