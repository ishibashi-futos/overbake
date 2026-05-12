import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { formatSource } from "../format/formatter.ts";
import { CliError } from "./error.ts";

/**
 * `bake glaze [<path>]` — Bakefile.ts を簡易フォーマッタで整形する。
 *
 * - `path` 省略時はカレントディレクトリ直下の `Bakefile.ts` が対象（上方向探索はしない）。
 * - `check` が true のときはファイルを書き換えず、整形が必要なら 1 を返す（CI 用）。
 *
 * @returns 終了コード（0: 整形済み or 整形完了 / 1: --check で未整形 / それ以外は例外）
 */
export async function runGlaze(
  filePath: string | undefined,
  check: boolean,
): Promise<number> {
  const display = filePath ?? "Bakefile.ts";
  const target = resolve(process.cwd(), display);

  if (!existsSync(target)) {
    if (filePath) {
      throw new CliError(`ファイルが見つかりません: ${display}`, 2);
    }
    throw new CliError(
      "Bakefile.ts が見つかりません（`bake init` で作成できます）",
      2,
    );
  }

  const original = await Bun.file(target).text();
  const formatted = formatSource(original);

  if (formatted === original) {
    console.log(`${display} is already glazed ✨`);
    return 0;
  }

  if (check) {
    console.log(`${display} needs glazing (run \`bake glaze\`)`);
    return 1;
  }

  await Bun.write(target, formatted);
  console.log(`glazed ${display} ✨`);
  return 0;
}
