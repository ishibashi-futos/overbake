/**
 * Bakefile.ts 向けの簡易 TypeScript フォーマッタ。
 *
 * overbake は依存ライブラリゼロ方針のため、外部フォーマッタ（biome / prettier）に
 * 頼らず軽量な文字列スキャナで実装している。行の分割・結合は一切行わず、以下だけを行う:
 *
 *   - インデントの再計算（ブロック開始/終了ベース。プリティプリンタの "hug" を素朴に再現）
 *   - シングルクォート文字列をダブルクォートへ統一（エスケープが増える場合は据え置き）
 *   - 行末空白の除去 / 連続する空行を 1 行に圧縮 / 末尾改行を 1 つに正規化
 *
 * 既知の制限（フルパーサではないため）:
 *   - 式の途中改行（`const x =\n  v;`）は構文を理解せず括弧の深さに丸める。
 *     多行の式は括弧で囲って書くこと。`.method()` のような行頭ドットの継続行だけは
 *     簡易救済としてもう 1 段深くする。
 *   - 多行にまたがるテンプレートリテラル / ブロックコメントの 2 行目以降は
 *     内容を保護するため再インデントしない（テンプレートは行末空白も触らない）。
 *   - 正規表現リテラルの検出は「直前の意味のあるコード文字」によるヒューリスティック。
 *     Bakefile では稀なため簡易対応に留める。
 */

const INDENT_UNIT = "  ";

const OPENERS = new Set(["(", "[", "{"]);

// `/` を正規表現リテラルの開始とみなしてよい「直前の意味のあるコード文字」。
// （これ以外、たとえば識別子・数値・`)`・`]` のあとの `/` は除算とみなす。）
const REGEX_PRECEDERS = new Set([
  "(",
  ",",
  "=",
  ":",
  "[",
  "!",
  "&",
  "|",
  "?",
  "{",
  "}",
  ";",
  "+",
  "-",
  "*",
  "%",
  "<",
  ">",
  "~",
  "^",
  "\n",
]);

interface ScanState {
  /** 行をまたいで継続中のブロックコメントの中にいるか */
  inBlockComment: boolean;
  /**
   * テンプレートリテラルのネスト管理スタック。
   *  - `"template"`: バッククォートのリテラルテキスト中
   *  - 数値 n: その上の `${ ... }` 内コード文脈で、まだ閉じていない `{` の数（= n）
   * スタックが空、または末尾が数値なら「コード文脈」とみなす。
   */
  tmplStack: Array<"template" | number>;
  /** 直前の意味のあるコード文字（空白・コメントを除く）。正規表現判定に使う。 */
  lastCodeChar: string;
}

interface LineResult {
  /** code: 通常のコード行（再インデント対象） / protected: 内容保護のため触らない行 */
  kind: "code" | "protected";
  /** 出力する行本体（code は trim + クォート変換済み、protected は整形済みの文字列） */
  body: string;
  /** code 行が空（空白のみ）か */
  isBlank: boolean;
  /** 行が閉じ括弧で始まるか（= 1 段デデントして出力する） */
  startsWithCloser: boolean;
  /** 行が `.identifier` で始まる継続行か（= 1 段インデントして出力する） */
  startsWithDot: boolean;
  /** 行末がブロックを開いて終わるか（= 次行から 1 段インデントする） */
  endsOpeningBlock: boolean;
}

function inTemplateText(state: ScanState): boolean {
  return state.tmplStack[state.tmplStack.length - 1] === "template";
}

function convertSingleQuote(raw: string): string {
  // raw は両端のシングルクォートを含む（未終端なら末尾の `'` が無い場合がある）
  if (!raw.startsWith("'")) return raw;
  const closed = raw.length >= 2 && raw.endsWith("'");
  const inner = closed ? raw.slice(1, -1) : raw.slice(1);
  // ダブルクォートを含むならエスケープが増えるので変換しない（biome と同じ判断）
  if (inner.includes('"')) return raw;
  let out = "";
  for (let k = 0; k < inner.length; k++) {
    const c = inner.charAt(k);
    if (c === "\\" && k + 1 < inner.length) {
      const next = inner.charAt(k + 1);
      // 単一引用符のエスケープはダブルクォートでは不要
      out += next === "'" ? "'" : c + next;
      k++;
      continue;
    }
    out += c;
  }
  return closed ? `"${out}"` : `"${out}`;
}

function scanLine(line: string, state: ScanState): LineResult {
  const protectedLine = state.inBlockComment || inTemplateText(state);
  const isCodeLine = !protectedLine;

  const startsWithCloser = isCodeLine && /^\s*[)\]}]/.test(line);
  const startsWithDot = isCodeLine && /^\s*\.[A-Za-z_$]/.test(line);

  // コード行の本体は「元の行 + シングルクォート文字列だけ変換」。
  // 変換が起きた箇所以外は元の行からそのままコピーする（lastCopied 〜 i の区間）。
  let rebuilt = "";
  let lastCopied = 0;
  let lineDepth = 0;
  let lastCodeCharThisLine = "";
  let i = 0;
  const n = line.length;

  while (i < n) {
    if (state.inBlockComment) {
      const end = line.indexOf("*/", i);
      if (end === -1) {
        i = n;
        break;
      }
      i = end + 2;
      state.inBlockComment = false;
      continue;
    }

    if (inTemplateText(state)) {
      const ch = line.charAt(i);
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === "`") {
        state.tmplStack.pop();
        i += 1;
        continue;
      }
      if (ch === "$" && line.charAt(i + 1) === "{") {
        state.tmplStack.push(0); // `${` で補間（コード文脈）に入る
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }

    // ここからコード文脈（トップレベル or `${ ... }` 内）
    const ch = line.charAt(i);

    if (ch === " " || ch === "\t") {
      i += 1;
      continue;
    }

    if (ch === "/" && line.charAt(i + 1) === "/") {
      i = n; // 行コメント以降はそのまま
      break;
    }

    if (ch === "/" && line.charAt(i + 1) === "*") {
      state.inBlockComment = true;
      i += 2;
      continue;
    }

    if (ch === "/") {
      if (REGEX_PRECEDERS.has(state.lastCodeChar)) {
        let j = i + 1;
        let inClass = false;
        let closed = false;
        while (j < n) {
          const c = line.charAt(j);
          if (c === "\\") {
            j += 2;
            continue;
          }
          if (c === "[") {
            inClass = true;
          } else if (c === "]") {
            inClass = false;
          } else if (c === "/" && !inClass) {
            j += 1;
            closed = true;
            break;
          }
          j += 1;
        }
        if (closed) {
          while (j < n && /[a-z]/i.test(line.charAt(j))) j += 1; // フラグ
          // 正規表現リテラルは「値」扱い: 次の `/` は除算とみなす
          state.lastCodeChar = ")";
          lastCodeCharThisLine = ")";
          i = j;
          continue;
        }
        // この行で閉じない（= 正規表現ではなさそう）→ 除算として処理
      }
      state.lastCodeChar = "/";
      lastCodeCharThisLine = "/";
      i += 1;
      continue;
    }

    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < n) {
        const c = line.charAt(j);
        if (c === "\\") {
          j += 2;
          continue;
        }
        if (c === ch) {
          j += 1;
          break;
        }
        j += 1;
      }
      const end = Math.min(j, n);
      if (ch === "'") {
        const converted = convertSingleQuote(line.slice(i, end));
        rebuilt += line.slice(lastCopied, i) + converted;
        lastCopied = end;
      }
      state.lastCodeChar = ch;
      lastCodeCharThisLine = ch;
      i = end;
      continue;
    }

    if (ch === "`") {
      state.tmplStack.push("template");
      state.lastCodeChar = ch;
      lastCodeCharThisLine = ch;
      i += 1;
      continue;
    }

    if (ch === "{") {
      const top = state.tmplStack[state.tmplStack.length - 1];
      if (typeof top === "number") {
        state.tmplStack[state.tmplStack.length - 1] = top + 1;
      }
      lineDepth += 1;
      state.lastCodeChar = ch;
      lastCodeCharThisLine = ch;
      i += 1;
      continue;
    }

    if (ch === "}") {
      const top = state.tmplStack[state.tmplStack.length - 1];
      if (typeof top === "number" && top === 0) {
        state.tmplStack.pop(); // `${ ... }` の閉じ。コード括弧としては数えない
      } else {
        if (typeof top === "number") {
          state.tmplStack[state.tmplStack.length - 1] = top - 1;
        }
        if (lineDepth > 0) lineDepth -= 1;
      }
      state.lastCodeChar = ch;
      lastCodeCharThisLine = ch;
      i += 1;
      continue;
    }

    if (ch === "(" || ch === "[") {
      lineDepth += 1;
      state.lastCodeChar = ch;
      lastCodeCharThisLine = ch;
      i += 1;
      continue;
    }

    if (ch === ")" || ch === "]") {
      if (lineDepth > 0) lineDepth -= 1;
      state.lastCodeChar = ch;
      lastCodeCharThisLine = ch;
      i += 1;
      continue;
    }

    state.lastCodeChar = ch;
    lastCodeCharThisLine = ch;
    i += 1;
  }

  const endsOpeningBlock = lineDepth > 0 && OPENERS.has(lastCodeCharThisLine);

  if (protectedLine) {
    // 出力本体は formatSource 側で決める（テンプレート=そのまま / コメント=行末空白除去）。
    return {
      kind: "protected",
      body: line,
      isBlank: false,
      startsWithCloser: false,
      startsWithDot: false,
      endsOpeningBlock,
    };
  }

  rebuilt += line.slice(lastCopied);
  // この行の途中から複数行のテンプレートリテラル / ブロックコメントに入った場合、
  // 行末の空白はその内容の一部なので削らない（先頭側だけ整形する）。
  const endsInProtected = state.inBlockComment || inTemplateText(state);
  const body = endsInProtected ? rebuilt.replace(/^\s+/, "") : rebuilt.trim();
  return {
    kind: "code",
    body,
    isBlank: body === "",
    startsWithCloser: startsWithCloser && body !== "",
    startsWithDot: startsWithDot && body !== "",
    endsOpeningBlock,
  };
}

export function formatSource(source: string): string {
  const lines = source.split("\n");
  const state: ScanState = {
    inBlockComment: false,
    tmplStack: [],
    lastCodeChar: "\n",
  };
  const out: string[] = [];
  let level = 0;
  let prevBlank = true; // 先頭の空行を落とすため true から始める

  for (const rawLine of lines) {
    // 行頭でのコンテキストを記録（scanLine が state を更新するため、その前に判定する）
    const enteredBlockComment = state.inBlockComment;
    const enteredTemplateText = !enteredBlockComment && inTemplateText(state);

    const r = scanLine(rawLine, state);

    if (r.kind === "protected") {
      // テンプレートリテラル中は完全に手を付けない。ブロックコメント中は行末空白だけ除去。
      out.push(enteredTemplateText ? rawLine : rawLine.replace(/\s+$/, ""));
      prevBlank = false;
      if (r.endsOpeningBlock) level += 1;
      continue;
    }

    if (r.isBlank) {
      if (!prevBlank) {
        out.push("");
        prevBlank = true;
      }
      continue;
    }

    let renderLevel: number;
    if (r.startsWithDot) {
      renderLevel = level + 1;
    } else {
      renderLevel = Math.max(0, level - (r.startsWithCloser ? 1 : 0));
    }
    out.push(INDENT_UNIT.repeat(renderLevel) + r.body);
    prevBlank = false;

    const base = r.startsWithDot ? level : renderLevel;
    level = Math.max(0, base + (r.endsOpeningBlock ? 1 : 0));
  }

  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  if (out.length === 0) return "";
  return `${out.join("\n")}\n`;
}
