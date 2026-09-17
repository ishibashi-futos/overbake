import type { Command } from "../cli/args.ts";

/**
 * ターミナルのタイトルバーに実行中のコマンドを表示する。
 *
 * タイトルの設定には OSC 0（`\x1b]0;<title>\x07`）を使う。Windows Terminal / Ghostty など
 * 主要な端末が対応しており、タブタイトルをアイコン名から取る端末でも効く。
 *
 * 復元は XTWINOPS のタイトル push / pop（`\x1b[22;0t` / `\x1b[23;0t`）で行う。開始時に push
 * してからタイトルを設定し、終了時は「空タイトルでクリア → pop」の順で書き込む。push/pop に
 * 対応する端末（iTerm2 / kitty / Alacritty / tmux）では元のタイトルへ戻り、非対応の端末
 * （Windows Terminal / Ghostty / WezTerm）では pop が黙って無視されるだけで、空タイトル＝
 * 端末既定のタイトルに戻る。クリアと pop の順序を逆にすると、対応端末では復元した直後に
 * 自分でタイトルを消してしまうため、必ず「クリア → pop」の順にする。
 */

export const TITLE_PREFIX = "🍞 overbake";

export const OSC_TITLE_START = "\x1b]0;";
export const OSC_TITLE_END = "\x07";
export const PUSH_TITLE = "\x1b[22;0t";
export const POP_TITLE = "\x1b[23;0t";

// C0 制御文字（\x00-\x1f, \x7f）と C1 制御文字（\x80-\x9f）を除去する。
// タスク名に ESC や BEL が紛れ込んでいても OSC / XTWINOPS シーケンスを壊さないようにするため。
// biome-ignore lint/suspicious/noControlCharactersInRegex: 除去対象そのものが制御文字
const CONTROL_CHARS = /[\x00-\x1f\x7f-\x9f]/g;

/** label が空なら "🍞 overbake"、それ以外は "🍞 overbake - <label>" を返す */
export function formatTitle(label: string): string {
  const sanitized = label.replace(CONTROL_CHARS, "");
  return sanitized === "" ? TITLE_PREFIX : `${TITLE_PREFIX} - ${sanitized}`;
}

/**
 * Command からタイトルに表示するラベルを決める。null は「タイトルを変更しない」を意味する
 * （即座に出力して終わる、あるいはパイプされがちな出力専用コマンド）。
 *
 * `default` コマンドはデフォルトタスクを実行するかどうかを `registry.getDefault()` を
 * 引くまで判定できないため、タスク名は付けず空文字列を返す（タイトルは "🍞 overbake" のみ）。
 */
export function titleLabel(command: Command): string | null {
  switch (command.type) {
    case "run":
      return command.taskNames.join(" ");
    case "logs":
      return command.taskName ? `logs ${command.taskName}` : "logs";
    case "stop":
      return command.taskName ? `stop ${command.taskName}` : "stop";
    case "init":
      return "init";
    case "doctor":
      return "doctor";
    case "glaze":
      return "glaze";
    case "update":
      return "update";
    case "ps":
      return "ps";
    case "default":
      return "";
    case "list":
    case "help":
    case "version":
    case "completions":
    case "complete":
    case "docs":
      return null;
    default: {
      // 新しい Command を追加したのに titleLabel の対応を忘れると、ここで型エラーになる
      const exhaustive: never = command;
      throw new Error(`未対応の Command です: ${JSON.stringify(exhaustive)}`);
    }
  }
}

export interface TitleDeps {
  stream: { isTTY?: boolean; write(text: string): unknown };
  env: Record<string, string | undefined>;
  /** 終了時の復元処理を登録する（既定: process.once("exit", fn)） */
  onExit: (restore: () => void) => void;
}

/**
 * 条件（TTY かつ `TERM` が `dumb` でない）を満たせば push + タイトル設定を書き込み、
 * 終了時の復元（クリア → pop）を登録する。
 *
 * 復元はベストエフォートで process の `exit` イベントにのみ乗せる。`task.compose` が
 * SIGINT/SIGTERM を自前で処理しているため、ここでシグナルハンドラを追加すると
 * graceful shutdown を壊してしまう。
 */
export function startTerminalTitle(
  label: string,
  deps: Partial<TitleDeps> = {},
): void {
  const stream = deps.stream ?? process.stdout;
  const env = deps.env ?? process.env;
  const onExit =
    deps.onExit ?? ((restore: () => void) => process.once("exit", restore));

  if (stream.isTTY !== true || env.TERM === "dumb") return;

  stream.write(PUSH_TITLE);
  stream.write(`${OSC_TITLE_START}${formatTitle(label)}${OSC_TITLE_END}`);

  onExit(() => {
    stream.write(`${OSC_TITLE_START}${OSC_TITLE_END}`);
    stream.write(POP_TITLE);
  });
}
