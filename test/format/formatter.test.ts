import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatSource } from "../../src/format/formatter.ts";

describe("formatSource - インデント再計算", () => {
  test("ネストしたタスク定義を 2 スペースインデントに揃える", () => {
    const input = [
      "task('build', {",
      "desc: 'CLI をビルド',",
      "deps: ['clean'],",
      "}, async ({ cmd }) => {",
      "await cmd('bun', ['build']);",
      "});",
      "",
    ].join("\n");
    const expected = [
      'task("build", {',
      '  desc: "CLI をビルド",',
      '  deps: ["clean"],',
      "}, async ({ cmd }) => {",
      '  await cmd("bun", ["build"]);',
      "});",
      "",
    ].join("\n");
    expect(formatSource(input)).toBe(expected);
  });

  test("過剰なインデントを詰める", () => {
    const input = "function f() {\n            return 1;\n}\n";
    expect(formatSource(input)).toBe("function f() {\n  return 1;\n}\n");
  });

  test("複数の閉じ括弧で始まる行も 1 段だけデデントする", () => {
    const input = ["foo(bar(", "x,", "));", ""].join("\n");
    expect(formatSource(input)).toBe(
      ["foo(bar(", "  x,", "));", ""].join("\n"),
    );
  });

  test("} else { は閉じ始まり・開き終わりとして扱う", () => {
    const input = ["if (a) {", "x();", "} else {", "y();", "}", ""].join("\n");
    expect(formatSource(input)).toBe(
      ["if (a) {", "  x();", "} else {", "  y();", "}", ""].join("\n"),
    );
  });

  test("行頭ドットの継続行は 1 段深くする", () => {
    const input = ["promise", ".then(x)", ".catch(e);", ""].join("\n");
    expect(formatSource(input)).toBe(
      ["promise", "  .then(x)", "  .catch(e);", ""].join("\n"),
    );
  });
});

describe("formatSource - クォート統一", () => {
  test("シングルクォートをダブルクォートにする", () => {
    expect(formatSource("const a = 'x';\n")).toBe('const a = "x";\n');
  });

  test("エスケープした単一引用符はアンエスケープする", () => {
    expect(formatSource("const a = 'it\\'s';\n")).toBe('const a = "it\'s";\n');
  });

  test("ダブルクォートを含む場合はシングルクォートのまま残す", () => {
    expect(formatSource("const a = 'say \"hi\"';\n")).toBe(
      "const a = 'say \"hi\"';\n",
    );
  });

  test("テンプレートリテラルは変更しない", () => {
    // 補間 `${...}` とその中のシングルクォートは触らない
    const src = `const a = \`x\${1}'y'\`;\n`;
    expect(formatSource(src)).toBe(src);
  });

  test("文字列内の // や { はコメント/インデント判定に影響しない", () => {
    const input = 'const url = "http://a.com/{x}";\nconst y = 1;\n';
    expect(formatSource(input)).toBe(input);
  });
});

describe("formatSource - コメント / テンプレートの保護", () => {
  test("複数行ブロックコメントの本文は再インデントしない", () => {
    const input = ["/*", "   keep this indent", "*/", "const x = 1;", ""].join(
      "\n",
    );
    expect(formatSource(input)).toBe(input);
  });

  test("複数行テンプレートリテラルの本文は行末空白も含めて保持する", () => {
    const input = ["const a = `line1   ", "    line2`;", ""].join("\n");
    expect(formatSource(input)).toBe(input);
  });

  test("行コメント中の括弧やクォートは無視する", () => {
    const input = "// task('x', () => {\nconst y = 1;\n";
    expect(formatSource(input)).toBe(input);
  });
});

describe("formatSource - 空白の正規化", () => {
  test("行末空白を除去する", () => {
    expect(formatSource("const a = 1;   \n")).toBe("const a = 1;\n");
  });

  test("連続する空行を 1 行に圧縮し、先頭・末尾の空行を落とす", () => {
    const input = "\n\nconst a = 1;\n\n\n\nconst b = 2;\n\n\n";
    expect(formatSource(input)).toBe("const a = 1;\n\nconst b = 2;\n");
  });

  test("末尾に改行が無くても 1 つ補う", () => {
    expect(formatSource("const a = 1;")).toBe("const a = 1;\n");
  });

  test("空ファイルは空文字列のまま", () => {
    expect(formatSource("")).toBe("");
    expect(formatSource("\n\n")).toBe("");
  });
});

describe("formatSource - 冪等性", () => {
  test("整形済みの入力は変化しない", () => {
    const formatted = [
      'task("clean", { desc: "clean" }, async ({ rm }) => {',
      '  await rm("dist", { recursive: true, force: true });',
      "});",
      "",
      "const build = task(",
      '  "build",',
      "  {",
      '    desc: "build",',
      '    deps: ["clean"],',
      "  },",
      "  async ({ cmd }) => {",
      '    await cmd("bun", ["build"]);',
      "  },",
      ");",
      "",
      "task.default(build);",
      "",
    ].join("\n");
    expect(formatSource(formatted)).toBe(formatted);
  });

  test("リポジトリの Bakefile.ts に対して冪等", () => {
    const path = resolve(import.meta.dir, "../../Bakefile.ts");
    const content = readFileSync(path, "utf-8");
    expect(formatSource(content)).toBe(content);
    // 2 回適用しても同じ（一般的な冪等性）
    expect(formatSource(formatSource(content))).toBe(formatSource(content));
  });
});
