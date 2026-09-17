import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getDocs } from "../../src/cli/docs.ts";
import { main } from "../../src/cli/main.ts";
import { BAKEFILE_DTS_TEMPLATE } from "../../src/init/templates.ts";
import { renderGlobalHelp } from "../../src/ui/help.ts";
import { useStdoutCapture } from "../support/sandbox.ts";

const SKILL_MD_PATH = resolve(import.meta.dir, "../../docs/SKILL.md");

/**
 * BAKEFILE_DTS_TEMPLATE の `declare namespace task { ... }` ブロック内で
 * export されている関数名（各オーバーロードは重複排除）を抽出する。
 * `default` は `export { defaultTask as default };` のエイリアスから拾う。
 * コメント中の `{ ... }` に惑わされないよう波括弧の深さを数えてブロックを切り出す。
 */
function extractNamespaceTaskFunctionNames(dts: string): string[] {
  const start = dts.indexOf("declare namespace task {");
  if (start === -1) throw new Error("declare namespace task が見つかりません");
  const openBrace = dts.indexOf("{", start);
  let depth = 0;
  let end = -1;
  for (let i = openBrace; i < dts.length; i++) {
    if (dts[i] === "{") depth++;
    if (dts[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1)
    throw new Error("namespace task ブロックの終端が見つかりません");
  const body = dts.slice(openBrace + 1, end);

  const names = new Set<string>();
  for (const m of body.matchAll(/export function (\w+)/g)) {
    names.add(m[1] as string);
  }
  for (const m of body.matchAll(/export \{ \w+ as (\w+) \}/g)) {
    names.add(m[1] as string);
  }
  return [...names];
}

/**
 * renderGlobalHelp() の Commands 節から、行頭の「素の英単語」（フラグでも
 * `<task>` のようなプレースホルダでもない先頭トークン）を抽出する。
 * 例: "  -l, list    ..." → "list"（"-l," はフラグなのでスキップ）、
 *     "  --help <task>  ..." → 該当なし（素の単語が無い行はスキップ）。
 */
function extractCommandsSectionWords(help: string): string[] {
  const start = help.indexOf("Commands:\n");
  const end = help.indexOf("\n\nOptions", start);
  if (start === -1 || end === -1) {
    throw new Error("Commands 節が見つかりません");
  }
  const section = help.slice(start + "Commands:\n".length, end);

  const words = new Set<string>();
  for (const line of section.split("\n")) {
    const tokens = line.trim().split(/\s+/);
    const first = tokens[0] ?? "";
    if (/^[A-Za-z]+$/.test(first)) {
      // 例: "init"、"init --type"、"glaze [path]"
      words.add(first);
      continue;
    }
    if (first.endsWith(",")) {
      // 例: "-l, list" → "list"（短縮フラグの直後に素の単語が続く形だけ拾う）
      const second = tokens[1] ?? "";
      if (/^[A-Za-z]+$/.test(second)) words.add(second);
      // 例: "-v, --version" は素の単語が無いので拾わない
    }
    // "--help" のように素の単語が無い行はスキップ（フラグであってサブコマンドではない）
  }
  return [...words];
}

// bake docs（#新規） - src/cli/docs.ts
describe("bake docs - getDocs", () => {
  const { writes } = useStdoutCapture();

  test("getDocs() は docs/SKILL.md の内容と完全一致する", () => {
    const fileContent = readFileSync(SKILL_MD_PATH, "utf-8");
    expect(getDocs()).toBe(fileContent);
  });

  test("frontmatter に name: overbake と description がある", () => {
    const content = getDocs();
    expect(content).toMatch(/^---\n/);
    expect(content).toMatch(/\nname: overbake\n/);
    expect(content).toMatch(/\ndescription: .+\n/);
  });

  test("BAKEFILE_DTS_TEMPLATE の task.* 関数が全て SKILL.md に「task.<name>」の形で登場する（ドリフト検出）", () => {
    const names = extractNamespaceTaskFunctionNames(BAKEFILE_DTS_TEMPLATE);
    expect(names.sort()).toEqual(
      ["each", "service", "compose", "cron", "default"].sort(),
    );

    const content = getDocs();
    for (const name of names) {
      expect(content).toContain(`task.${name}`);
    }
  });

  test("renderGlobalHelp の Commands 節のサブコマンドが全て SKILL.md に「bake <name>」の形で登場する（ドリフト検出）", () => {
    const words = extractCommandsSectionWords(renderGlobalHelp());
    expect(words.sort()).toEqual(
      [
        "init",
        "list",
        "doctor",
        "glaze",
        "completions",
        "update",
        "ps",
        "stop",
        "logs",
        "docs",
      ].sort(),
    );

    const content = getDocs();
    for (const word of words) {
      expect(content).toContain(`bake ${word}`);
    }
  });

  test("renderGlobalHelp に bake docs への導線がある", () => {
    const help = renderGlobalHelp();
    expect(help).toContain("docs");
    expect(help).toMatch(/bake docs.*SKILL\.md/);
  });

  test("main(['docs']) は SKILL.md をそのまま process.stdout.write する", async () => {
    const fileContent = readFileSync(SKILL_MD_PATH, "utf-8");

    await main(["docs"]);

    expect(writes.join("")).toBe(fileContent);
  });
});
