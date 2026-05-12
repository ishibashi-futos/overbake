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
  });

  test("generateZshCompletion はフラグを含む", () => {
    const script = generateZshCompletion();
    expect(script).toContain("--dry-run");
    expect(script).toContain("--watch");
    expect(script).toContain("--help");
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
  });
});
