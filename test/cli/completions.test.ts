import { describe, expect, test } from "bun:test";
import {
  generateBashCompletion,
  generateFishCompletion,
  generateZshCompletion,
} from "../../src/cli/completions.ts";

// issue #16: シェル補完スクリプト生成 - completions.ts
describe("シェル補完 (#16) - 補完スクリプト生成", () => {
  test("generateZshCompletion は #compdef bake を含む", () => {
    const script = generateZshCompletion();
    expect(script).toContain("#compdef bake");
  });

  test("generateZshCompletion は bake __complete tasks を含む", () => {
    const script = generateZshCompletion();
    expect(script).toContain("bake __complete tasks");
  });

  test("generateZshCompletion はサブコマンドを含む", () => {
    const script = generateZshCompletion();
    expect(script).toContain("init");
    expect(script).toContain("list");
    expect(script).toContain("completions");
    expect(script).toContain("doctor");
    expect(script).toContain("glaze");
  });

  test("generateZshCompletion はフラグを含む", () => {
    const script = generateZshCompletion();
    expect(script).toContain("--dry-run");
    expect(script).toContain("--watch");
    expect(script).toContain("--help");
  });

  test("generateZshCompletion は ps / stop / logs サブコマンドを含む", () => {
    const script = generateZshCompletion();
    expect(script).toContain("ps:");
    expect(script).toContain("stop:");
    expect(script).toContain("logs:");
  });

  test("generateZshCompletion は --no-summary / --graph を含む", () => {
    const script = generateZshCompletion();
    expect(script).toContain("--no-summary");
    expect(script).toContain("--graph=mermaid");
    expect(script).toContain("--graph=dot");
  });

  test("generateZshCompletion はデーモン関連フラグを含む", () => {
    const script = generateZshCompletion();
    expect(script).toContain("--daemon");
    expect(script).toContain("-d[");
    expect(script).toContain("--all");
    expect(script).toContain("--follow");
    expect(script).toContain("-f[");
    expect(script).toContain("-n[");
  });

  test("generateBashCompletion は complete -F _bake bake を含む", () => {
    const script = generateBashCompletion();
    expect(script).toContain("complete -F _bake bake");
  });

  test("generateBashCompletion は bake __complete tasks を含む", () => {
    const script = generateBashCompletion();
    expect(script).toContain("bake __complete tasks");
  });

  test("generateBashCompletion はサブコマンドを含む", () => {
    const script = generateBashCompletion();
    expect(script).toContain("init");
    expect(script).toContain("list");
    expect(script).toContain("completions");
    expect(script).toContain("doctor");
    expect(script).toContain("glaze");
  });

  test("generateBashCompletion は ps / stop / logs サブコマンドを含む", () => {
    const script = generateBashCompletion();
    expect(script).toContain("ps");
    expect(script).toContain("stop");
    expect(script).toContain("logs");
  });

  test("generateBashCompletion は --no-summary / --graph を含む", () => {
    const script = generateBashCompletion();
    expect(script).toContain("--no-summary");
    expect(script).toContain("--graph=mermaid");
    expect(script).toContain("--graph=dot");
  });

  test("generateBashCompletion はデーモン関連フラグを含む", () => {
    const script = generateBashCompletion();
    expect(script).toContain("--daemon");
    expect(script).toContain(" -d ");
    expect(script).toContain("--all");
    expect(script).toContain("--follow");
    expect(script).toContain(" -f ");
    expect(script).toContain(" -n");
  });

  test("generateFishCompletion は complete -c bake を含む", () => {
    const script = generateFishCompletion();
    expect(script).toContain("complete -c bake");
  });

  test("generateFishCompletion は bake __complete tasks を含む", () => {
    const script = generateFishCompletion();
    expect(script).toContain("bake __complete tasks");
  });

  test("generateFishCompletion はサブコマンドを含む", () => {
    const script = generateFishCompletion();
    expect(script).toContain("init");
    expect(script).toContain("list");
    expect(script).toContain("completions");
    expect(script).toContain("doctor");
    expect(script).toContain("glaze");
  });

  test("generateFishCompletion は ps / stop / logs サブコマンドを含む", () => {
    const script = generateFishCompletion();
    expect(script).toContain("-a 'ps'");
    expect(script).toContain("-a 'stop'");
    expect(script).toContain("-a 'logs'");
  });

  test("generateFishCompletion の __fish_seen_subcommand_from には全箇所に ps stop logs が含まれる", () => {
    const script = generateFishCompletion();
    const lines = script
      .split("\n")
      .filter((l) => l.includes("__fish_seen_subcommand_from"));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      if (line.includes("not __fish_seen_subcommand_from")) {
        expect(line).toContain("ps");
        expect(line).toContain("stop");
        expect(line).toContain("logs");
      }
    }
  });

  test("generateFishCompletion は --no-summary / --graph を含む", () => {
    const script = generateFishCompletion();
    expect(script).toContain("-l no-summary");
    expect(script).toContain("-l graph");
    expect(script).toContain("--graph=mermaid");
    expect(script).toContain("--graph=dot");
  });

  test("generateFishCompletion は stop / logs の後にタスク名を補完する", () => {
    const script = generateFishCompletion();
    expect(script).toContain(
      "-n '__fish_seen_subcommand_from stop' -a '(bake __complete tasks 2>/dev/null)'",
    );
    expect(script).toContain(
      "-n '__fish_seen_subcommand_from logs' -a '(bake __complete tasks 2>/dev/null)'",
    );
  });

  test("generateFishCompletion のタスク名を取らないサブコマンドの後ではタスク名を補完しない", () => {
    const script = generateFishCompletion();
    const taskCompletionLine = script
      .split("\n")
      .find(
        (l) =>
          l.includes("not __fish_seen_subcommand_from") &&
          l.includes("bake __complete tasks"),
      );
    expect(taskCompletionLine).toBeDefined();
    for (const subcommand of [
      "init",
      "list",
      "completions",
      "doctor",
      "glaze",
      "update",
      "ps",
    ]) {
      expect(taskCompletionLine).toContain(subcommand);
    }
  });

  test("generateFishCompletion はデーモン関連フラグを含む", () => {
    const script = generateFishCompletion();
    expect(script).toContain("-l daemon");
    expect(script).toContain("-s d");
    expect(script).toContain("-l all");
    expect(script).toContain("-l follow");
    expect(script).toContain("-s f");
    expect(script).toContain("-s n");
  });
});
