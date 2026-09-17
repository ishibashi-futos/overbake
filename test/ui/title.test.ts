import { describe, expect, test } from "bun:test";
import type { Command, Flags } from "../../src/cli/args.ts";
import {
  formatTitle,
  OSC_TITLE_END,
  OSC_TITLE_START,
  POP_TITLE,
  PUSH_TITLE,
  startTerminalTitle,
  TITLE_PREFIX,
  titleLabel,
} from "../../src/ui/title.ts";

// run / default コマンドの flags はテストの主眼ではないので全て false で固定する
const FLAGS: Flags = {
  dryRun: false,
  explain: false,
  watch: false,
  keepGoing: false,
  quiet: false,
  verbose: false,
  noColor: false,
  yes: false,
  noSummary: false,
  daemon: false,
};

/** TitleDeps.stream のモック。書き込まれたテキストを順番に記録する */
function createStreamMock(isTTY: boolean | undefined): {
  isTTY?: boolean;
  write: (text: string) => boolean;
  writes: string[];
} {
  const writes: string[] = [];
  return {
    isTTY,
    write: (text: string) => {
      writes.push(text);
      return true;
    },
    writes,
  };
}

describe("formatTitle", () => {
  test("ラベルが空なら TITLE_PREFIX のみを返す", () => {
    expect(formatTitle("")).toBe(TITLE_PREFIX);
  });

  test("ラベルがあれば `<prefix> - <label>` を返す", () => {
    expect(formatTitle("dev")).toBe(`${TITLE_PREFIX} - dev`);
  });

  test("C0 / C1 制御文字を除去してから埋め込む", () => {
    // ESC ('\x1b') / BEL ('\x07') / C1 (0x9b) の制御バイトだけが除去される。
    // エスケープシーケンス全体を解釈して取り除くわけではないので、ESC の後ろに続く
    // 通常の印字可能文字（例: "[31m"）はそのまま残る
    expect(formatTitle("dev\x1b\x07\x9b")).toBe(`${TITLE_PREFIX} - dev`);
    expect(formatTitle("dev\x1b[31m")).toBe(`${TITLE_PREFIX} - dev[31m`);
  });
});

describe("titleLabel", () => {
  test("run はタスク名をスペース区切りで結合する", () => {
    const command: Command = {
      type: "run",
      taskNames: ["build", "test"],
      flags: FLAGS,
    };
    expect(titleLabel(command)).toBe("build test");
  });

  test("logs はタスク名ありなら `logs <task>`", () => {
    const command: Command = {
      type: "logs",
      taskName: "dev",
      follow: false,
      lines: 50,
    };
    expect(titleLabel(command)).toBe("logs dev");
  });

  test("logs はタスク名なしなら `logs` のみ", () => {
    const command: Command = {
      type: "logs",
      taskName: undefined,
      follow: false,
      lines: 50,
    };
    expect(titleLabel(command)).toBe("logs");
  });

  test("stop はタスク名ありなら `stop <task>`", () => {
    const command: Command = { type: "stop", taskName: "dev", all: false };
    expect(titleLabel(command)).toBe("stop dev");
  });

  test("stop はタスク名なしなら `stop` のみ", () => {
    const command: Command = {
      type: "stop",
      taskName: undefined,
      all: true,
    };
    expect(titleLabel(command)).toBe("stop");
  });

  test("init はサブコマンド名", () => {
    const command: Command = { type: "init", typesOnly: false };
    expect(titleLabel(command)).toBe("init");
  });

  test("doctor はサブコマンド名", () => {
    const command: Command = { type: "doctor" };
    expect(titleLabel(command)).toBe("doctor");
  });

  test("glaze はサブコマンド名", () => {
    const command: Command = {
      type: "glaze",
      filePath: undefined,
      check: false,
    };
    expect(titleLabel(command)).toBe("glaze");
  });

  test("update はサブコマンド名", () => {
    const command: Command = { type: "update", check: false, force: false };
    expect(titleLabel(command)).toBe("update");
  });

  test("ps はサブコマンド名", () => {
    const command: Command = { type: "ps" };
    expect(titleLabel(command)).toBe("ps");
  });

  test("default は空文字列（タスク名はレジストリを読むまで分からないため付けない）", () => {
    const command: Command = { type: "default", flags: FLAGS };
    expect(titleLabel(command)).toBe("");
  });

  test("list は null", () => {
    const command: Command = { type: "list" };
    expect(titleLabel(command)).toBeNull();
  });

  test("help は null", () => {
    const command: Command = { type: "help", taskName: undefined };
    expect(titleLabel(command)).toBeNull();
  });

  test("version は null", () => {
    const command: Command = { type: "version" };
    expect(titleLabel(command)).toBeNull();
  });

  test("completions は null", () => {
    const command: Command = { type: "completions", shell: "zsh" };
    expect(titleLabel(command)).toBeNull();
  });

  test("complete は null", () => {
    const command: Command = { type: "complete", subcommand: "tasks" };
    expect(titleLabel(command)).toBeNull();
  });

  test("docs は null", () => {
    const command: Command = { type: "docs" };
    expect(titleLabel(command)).toBeNull();
  });
});

describe("startTerminalTitle", () => {
  test("TTY なら push → タイトル設定の順に書き込む", () => {
    const stream = createStreamMock(true);
    startTerminalTitle("dev", { stream, env: {}, onExit: () => {} });
    expect(stream.writes).toEqual([
      PUSH_TITLE,
      `${OSC_TITLE_START}${TITLE_PREFIX} - dev${OSC_TITLE_END}`,
    ]);
  });

  test("onExit に登録した復元処理はクリア → pop の順に書き込む", () => {
    const stream = createStreamMock(true);
    let restore: (() => void) | undefined;
    startTerminalTitle("dev", {
      stream,
      env: {},
      onExit: (fn) => {
        restore = fn;
      },
    });
    // 開始時点の書き込みは対象外なのでクリアしてから復元だけを見る
    stream.writes.length = 0;

    restore?.();

    expect(stream.writes).toEqual([
      `${OSC_TITLE_START}${OSC_TITLE_END}`,
      POP_TITLE,
    ]);
  });

  test("isTTY が false なら何も書き込まず onExit も登録しない", () => {
    const stream = createStreamMock(false);
    let onExitCalled = false;
    startTerminalTitle("dev", {
      stream,
      env: {},
      onExit: () => {
        onExitCalled = true;
      },
    });
    expect(stream.writes).toEqual([]);
    expect(onExitCalled).toBe(false);
  });

  test("isTTY が undefined なら何も書き込まず onExit も登録しない", () => {
    const stream = createStreamMock(undefined);
    let onExitCalled = false;
    startTerminalTitle("dev", {
      stream,
      env: {},
      onExit: () => {
        onExitCalled = true;
      },
    });
    expect(stream.writes).toEqual([]);
    expect(onExitCalled).toBe(false);
  });

  test("TERM=dumb なら TTY でも何も書き込まない", () => {
    const stream = createStreamMock(true);
    startTerminalTitle("dev", {
      stream,
      env: { TERM: "dumb" },
      onExit: () => {},
    });
    expect(stream.writes).toEqual([]);
  });

  test("deps 省略時は実際の process.stdout / process.env を使い、例外を投げない", () => {
    // TTY か否かは実行環境（パイプ経由の bun test か、対話端末上の bun test か）に依存するため、
    // ここでは isTTY の値を断定しない。書き込み条件の判定自体は上記の deps 注入テストで検証済み。
    expect(() => startTerminalTitle("dev")).not.toThrow();
  });
});
