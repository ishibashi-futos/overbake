import { describe, expect, test } from "bun:test";
import { parseArgs } from "../../src/cli/args.ts";

describe("parseArgs", () => {
  test('parses "init" command', () => {
    const result = parseArgs(["init"]);
    expect(result.type).toBe("init");
    if (result.type === "init") {
      expect(result.typesOnly).toBe(false);
    }
  });

  test('parses "init --type" command', () => {
    const result = parseArgs(["init", "--type"]);
    expect(result.type).toBe("init");
    if (result.type === "init") {
      expect(result.typesOnly).toBe(true);
    }
  });

  test("parses run command with task name", () => {
    const result = parseArgs(["build"]);
    expect(result.type).toBe("run");
    if (result.type === "run") {
      expect(result.taskNames).toEqual(["build"]);
    }
  });

  test("parses run command with multiple task names", () => {
    const result = parseArgs(["build", "test", "lint"]);
    expect(result.type).toBe("run");
    if (result.type === "run") {
      expect(result.taskNames).toEqual(["build", "test", "lint"]);
    }
  });

  test("returns default command when no args provided", () => {
    const result = parseArgs([]);
    expect(result.type).toBe("default");
    if (result.type === "default") {
      expect(result.flags.dryRun).toBe(false);
      expect(result.flags.explain).toBe(false);
      expect(result.flags.watch).toBe(false);
    }
  });

  test("--dry-run フラグを解析する", () => {
    const result = parseArgs(["build", "--dry-run"]);
    expect(result.type).toBe("run");
    if (result.type === "run") {
      expect(result.taskNames).toEqual(["build"]);
      expect(result.flags.dryRun).toBe(true);
      expect(result.flags.explain).toBe(false);
      expect(result.flags.watch).toBe(false);
    }
  });

  test("--explain フラグを解析する", () => {
    const result = parseArgs(["build", "--explain"]);
    expect(result.type).toBe("run");
    if (result.type === "run") {
      expect(result.taskNames).toEqual(["build"]);
      expect(result.flags.explain).toBe(true);
      expect(result.flags.dryRun).toBe(false);
      expect(result.flags.watch).toBe(false);
    }
  });

  test("--watch フラグを解析する", () => {
    const result = parseArgs(["build", "--watch"]);
    expect(result.type).toBe("run");
    if (result.type === "run") {
      expect(result.taskNames).toEqual(["build"]);
      expect(result.flags.watch).toBe(true);
      expect(result.flags.dryRun).toBe(false);
      expect(result.flags.explain).toBe(false);
    }
  });

  test("フラグなしは全て false", () => {
    const result = parseArgs(["build"]);
    if (result.type === "run") {
      expect(result.flags.dryRun).toBe(false);
      expect(result.flags.explain).toBe(false);
      expect(result.flags.watch).toBe(false);
    }
  });
});

describe("parseArgs - output control flags", () => {
  test("parses --keep-going flag", () => {
    const result = parseArgs(["build", "--keep-going"]);
    expect(result.type).toBe("run");
    if (result.type === "run") {
      expect(result.flags.keepGoing).toBe(true);
    }
  });

  test("parses --quiet flag", () => {
    const result = parseArgs(["build", "--quiet"]);
    expect(result.type).toBe("run");
    if (result.type === "run") {
      expect(result.flags.quiet).toBe(true);
    }
  });

  test("parses --verbose flag", () => {
    const result = parseArgs(["build", "--verbose"]);
    expect(result.type).toBe("run");
    if (result.type === "run") {
      expect(result.flags.verbose).toBe(true);
    }
  });

  test("parses --no-color flag", () => {
    const result = parseArgs(["build", "--no-color"]);
    expect(result.type).toBe("run");
    if (result.type === "run") {
      expect(result.flags.noColor).toBe(true);
    }
  });

  test("parses multiple output control flags", () => {
    const result = parseArgs([
      "build",
      "--keep-going",
      "--quiet",
      "--verbose",
      "--no-color",
    ]);
    expect(result.type).toBe("run");
    if (result.type === "run") {
      expect(result.flags.keepGoing).toBe(true);
      expect(result.flags.quiet).toBe(true);
      expect(result.flags.verbose).toBe(true);
      expect(result.flags.noColor).toBe(true);
    }
  });

  test("parses default command with output control flags", () => {
    const result = parseArgs(["--keep-going", "--quiet"]);
    expect(result.type).toBe("default");
    if (result.type === "default") {
      expect(result.flags.keepGoing).toBe(true);
      expect(result.flags.quiet).toBe(true);
    }
  });
});

describe("parseArgs - list/help commands", () => {
  test("parses 'list' command", () => {
    const result = parseArgs(["list"]);
    expect(result.type).toBe("list");
  });

  test("parses '-l' as list command", () => {
    const result = parseArgs(["-l"]);
    expect(result.type).toBe("list");
  });

  test("parses '--help' without task name", () => {
    const result = parseArgs(["--help"]);
    expect(result.type).toBe("help");
    if (result.type === "help") {
      expect(result.taskName).toBeUndefined();
    }
  });

  test("parses '--help <taskname>' as help with task", () => {
    const result = parseArgs(["--help", "build"]);
    expect(result.type).toBe("help");
    if (result.type === "help") {
      expect(result.taskName).toBe("build");
    }
  });

  test("parses task --help as help with task", () => {
    const result = parseArgs(["build", "--help"]);
    expect(result.type).toBe("help");
    if (result.type === "help") {
      expect(result.taskName).toBe("build");
    }
  });

  test("parses default command with --dry-run flag", () => {
    const result = parseArgs(["--dry-run"]);
    expect(result.type).toBe("default");
    if (result.type === "default") {
      expect(result.flags.dryRun).toBe(true);
    }
  });

  test("parses default command with --explain flag", () => {
    const result = parseArgs(["--explain"]);
    expect(result.type).toBe("default");
    if (result.type === "default") {
      expect(result.flags.explain).toBe(true);
    }
  });

  test("parses default command with --watch flag", () => {
    const result = parseArgs(["--watch"]);
    expect(result.type).toBe("default");
    if (result.type === "default") {
      expect(result.flags.watch).toBe(true);
    }
  });
});

// issue #14: confirm プロンプト - parseArgs の --yes / -y フラグ
describe("confirm プロンプト (#14) - parseArgs の --yes / -y フラグ", () => {
  test("run コマンドで --yes を解析すると flags.yes=true になる", () => {
    const result = parseArgs(["build", "--yes"]);
    expect(result.type).toBe("run");
    if (result.type === "run") {
      expect(result.flags.yes).toBe(true);
    }
  });

  test("run コマンドで -y を解析すると flags.yes=true になる", () => {
    const result = parseArgs(["build", "-y"]);
    expect(result.type).toBe("run");
    if (result.type === "run") {
      expect(result.flags.yes).toBe(true);
    }
  });

  test("default コマンドで --yes を解析すると flags.yes=true になる", () => {
    const result = parseArgs(["--yes"]);
    expect(result.type).toBe("default");
    if (result.type === "default") {
      expect(result.flags.yes).toBe(true);
    }
  });

  test("default コマンドで -y を解析すると flags.yes=true になる", () => {
    const result = parseArgs(["-y"]);
    expect(result.type).toBe("default");
    if (result.type === "default") {
      expect(result.flags.yes).toBe(true);
    }
  });
});

// issue #16: シェル補完スクリプト生成 - parseArgs
describe("シェル補完 (#16) - parseArgs", () => {
  test('"completions zsh" を解析すると type=completions, shell=zsh になる', () => {
    const result = parseArgs(["completions", "zsh"]);
    expect(result.type).toBe("completions");
    if (result.type === "completions") {
      expect(result.shell).toBe("zsh");
    }
  });

  test('"completions bash" を解析すると type=completions, shell=bash になる', () => {
    const result = parseArgs(["completions", "bash"]);
    expect(result.type).toBe("completions");
    if (result.type === "completions") {
      expect(result.shell).toBe("bash");
    }
  });

  test('"completions fish" を解析すると type=completions, shell=fish になる', () => {
    const result = parseArgs(["completions", "fish"]);
    expect(result.type).toBe("completions");
    if (result.type === "completions") {
      expect(result.shell).toBe("fish");
    }
  });

  test('"__complete tasks" を解析すると type=complete, subcommand=tasks になる', () => {
    const result = parseArgs(["__complete", "tasks"]);
    expect(result.type).toBe("complete");
    if (result.type === "complete") {
      expect(result.subcommand).toBe("tasks");
    }
  });
});

describe("parseArgs --graph フラグ", () => {
  test("--graph 単独は default コマンドで graph=mermaid", () => {
    const result = parseArgs(["--graph"]);
    expect(result.type).toBe("default");
    if (result.type === "default") {
      expect(result.flags.graph).toBe("mermaid");
    }
  });

  test("--graph=mermaid は default コマンドで graph=mermaid", () => {
    const result = parseArgs(["--graph=mermaid"]);
    expect(result.type).toBe("default");
    if (result.type === "default") {
      expect(result.flags.graph).toBe("mermaid");
    }
  });

  test("--graph=dot は default コマンドで graph=dot", () => {
    const result = parseArgs(["--graph=dot"]);
    expect(result.type).toBe("default");
    if (result.type === "default") {
      expect(result.flags.graph).toBe("dot");
    }
  });

  test("task --graph は run コマンドで graph=mermaid", () => {
    const result = parseArgs(["build", "--graph"]);
    expect(result.type).toBe("run");
    if (result.type === "run") {
      expect(result.taskNames).toEqual(["build"]);
      expect(result.flags.graph).toBe("mermaid");
    }
  });

  test("task --graph=dot は run コマンドで graph=dot", () => {
    const result = parseArgs(["build", "--graph=dot"]);
    expect(result.type).toBe("run");
    if (result.type === "run") {
      expect(result.taskNames).toEqual(["build"]);
      expect(result.flags.graph).toBe("dot");
    }
  });

  test("--graph なしは graph が undefined", () => {
    const result = parseArgs(["build"]);
    if (result.type === "run") {
      expect(result.flags.graph).toBeUndefined();
    }
  });

  test("未知フォーマット --graph=svg を raw 値で保持する", () => {
    const result = parseArgs(["--graph=svg"]);
    if (result.type === "default") {
      expect(result.flags.graph).toBe("svg");
    }
  });
});

describe("parseArgs - --no-summary フラグ", () => {
  test("run コマンドで --no-summary を解析すると flags.noSummary=true になる", () => {
    const result = parseArgs(["build", "--no-summary"]);
    expect(result.type).toBe("run");
    if (result.type === "run") {
      expect(result.flags.noSummary).toBe(true);
    }
  });

  test("default コマンドで --no-summary を解析すると flags.noSummary=true になる", () => {
    const result = parseArgs(["--no-summary"]);
    expect(result.type).toBe("default");
    if (result.type === "default") {
      expect(result.flags.noSummary).toBe(true);
    }
  });

  test("--no-summary なしは flags.noSummary=false になる", () => {
    const result = parseArgs(["build"]);
    if (result.type === "run") {
      expect(result.flags.noSummary).toBe(false);
    }
  });
});

// issue #30: bake doctor（Bakefile 静的検証）
describe("issue #30: bake doctor - parseArgs", () => {
  test('"doctor" を解析すると type=doctor になる', () => {
    const result = parseArgs(["doctor"]);
    expect(result.type).toBe("doctor");
  });
});

describe("bake glaze - parseArgs", () => {
  test('"glaze" を解析すると type=glaze / filePath なし / check=false', () => {
    const result = parseArgs(["glaze"]);
    expect(result.type).toBe("glaze");
    if (result.type === "glaze") {
      expect(result.filePath).toBeUndefined();
      expect(result.check).toBe(false);
    }
  });

  test('"glaze <path>" は filePath を取り込む', () => {
    const result = parseArgs(["glaze", "Bakefile.ts"]);
    expect(result.type).toBe("glaze");
    if (result.type === "glaze") {
      expect(result.filePath).toBe("Bakefile.ts");
    }
  });

  test('"glaze --check" は check=true / filePath なし', () => {
    const result = parseArgs(["glaze", "--check"]);
    if (result.type === "glaze") {
      expect(result.filePath).toBeUndefined();
      expect(result.check).toBe(true);
    }
  });

  test('"glaze <path> --check" は両方を取り込む', () => {
    const result = parseArgs(["glaze", "x.ts", "--check"]);
    if (result.type === "glaze") {
      expect(result.filePath).toBe("x.ts");
      expect(result.check).toBe(true);
    }
  });
});
