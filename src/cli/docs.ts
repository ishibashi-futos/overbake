// `bake docs` が出力するエージェント向けガイド。
// docs/SKILL.md を唯一の読み込み元とし、`bun build --compile` でバイナリへ埋め込まれる。
import skill from "../../docs/SKILL.md" with { type: "text" };

/** docs/SKILL.md の内容をそのまま返す */
export function getDocs(): string {
  return skill;
}
