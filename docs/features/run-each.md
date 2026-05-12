# `ctx.runEach()` — 複数タスク・コマンドのまとめて実行

`scripts/sanity.sh`（型チェック → フォーマット → ビルド → テストを順に走らせ、各工程の出力は抑え、
失敗した工程だけ出力を表示して異常終了し、全部通れば独自メッセージを出す）と同じ体験を、`Bakefile.ts`
の 1 タスクとして書くためのヘルパーです。

## task() はタスクハンドルを返す

`task()` の戻り値（タスクハンドル）を変数で受け取り、`runEach` や `task.default()` に渡せます。

```typescript
/// <reference path="./Bakefile.d.ts" />

const typecheck = task("typecheck", { desc: "型チェック" }, async ({ cmd }) => {
  await cmd("bunx", ["tsc", "--noEmit"]);
});

const fmt = task("fmt", { desc: "フォーマットチェック" }, async ({ cmd }) => {
  await cmd("bunx", ["biome", "check", "."]);
});

const test = task("test", { desc: "テストを実行" }, async ({ cmd }) => {
  await cmd("bun", ["test"]);
});

task("sanity", { desc: "まとめて検証" }, async ({ runEach }) => {
  await runEach(
    { done: "✨ All checks passed!" },
    typecheck,
    fmt,
    ["bun", ["build", "src/cli/main.ts", "--compile"]],
    test,
  );
});
```

実行すると次のように出力されます。

```
Running sanity...
  - typecheck (型チェック)... ✅
  - fmt (フォーマットチェック)... ✅
  - bun build src/cli/main.ts --compile... ✅
  - test (テストを実行)... ✅
✨ All checks passed!
```

## 宣言的に定義する: `task.each()`

「`runEach` のパイプラインをそのまま 1 つの名前付きタスクにしたい」場合は、`ctx.runEach` を本体で
呼ぶ代わりに `task.each()` を使えます。`task.default()` と並ぶ登録ヘルパーで、戻り値はタスクハンドルです。

```typescript
/// <reference path="./Bakefile.d.ts" />

const typecheck = task("typecheck", { desc: "型チェック" }, async ({ cmd }) => {
  await cmd("bunx", ["tsc", "--noEmit"]);
});
const fmt = task("fmt", { desc: "フォーマットチェック" }, async ({ cmd }) => {
  await cmd("bunx", ["biome", "check", "."]);
});
const build = task("build", { deps: ["clean"] }, async ({ cmd }) => {
  await cmd("bun", ["build", "src/cli/main.ts", "--compile"]);
});
const test = task("test", async ({ cmd }) => {
  await cmd("bun", ["test"]);
});

task.each(
  "sanity",
  { desc: "まとめて検証", done: "✨ All checks passed!" },
  typecheck,
  fmt,
  build,
  test,
);
```

- 先頭にオプションを置けます（`{ desc, done, keepGoing }` など。`done`/`keepGoing` はそのまま `runEach` に渡り、
  `desc` などは生成されるタスクのオプションになります）。省略可。
- 実行時の挙動は `ctx.runEach` を本体で呼ぶのと同じ（出力抑制・fail-fast・`done` メッセージ）。
- **違いは `bake <task> --graph` に工程が現れること。** `task.each` で宣言した工程は静的記述として
  タスク定義に残るため、`mermaid` / `dot` 出力に `工程 --> タスク` の辺として描かれます
  （コマンドタプル `["bun", ["test"]]` はコマンド文字列をラベルにしたノードになります）。
  本体で `ctx.runEach` を呼ぶ形では工程は実行時にしか分からないため、グラフには出ません。
- `deps` は **展開されません**（`runEach` と同じ）。`build` の `clean` 依存などは `bake build` 側で解決されます。
  グラフ上の `build --> sanity` はあくまで表示用の辺で、`bake sanity` 実行時に `clean` を走らせるわけではありません。
- 工程に渡すタスクハンドルは、その `task.each(...)` 呼び出しより前に定義しておく必要があります。

## シグネチャ

```typescript
ctx.runEach(...items: (RunEachOptions | RunEachItem)[]): Promise<void>

task.each(name: string, ...items: (TaskEachOptions | RunEachItem)[]): Task
type TaskEachOptions = TaskOptions & RunEachOptions;

type RunEachCommand = readonly [string, (readonly string[])?]; // ctx.cmd と同じ [command, args?]
type RunEachItem = Task | RunEachCommand;

interface RunEachOptions {
  done?: string;        // 全件成功時に出力するメッセージ
  keepGoing?: boolean;  // true なら最初の失敗で中断しない
}
```

- `runEach` には **タスクハンドル** または **コマンドタプル** を任意個、混在で渡せます。
- コマンドタプルは `ctx.cmd` と同じ `[command, args?]` の形です（例: `["bun", ["test"]]`、`["echo"]`）。
- オプションを渡したいときは **先頭引数** にオブジェクトを置きます（`{ done, keepGoing }`）。省略可。

## 出力の抑制

各工程の出力（`ctx.cmd` の stdout/stderr、`ctx.log`、工程内の `console.log` / `console.error`）は
ターミナルに直接流さず、バッファに溜めます。表示されるのは進捗行（`  - <ラベル>... ✅ / ❌`）と、
失敗時のバッファ内容、最後のメッセージだけです。

ラベルは、タスクハンドルなら `name`（`desc` があれば `name (desc)`）、コマンドなら `command args...` です。

## 失敗時の挙動

### 既定: fail-fast

ある工程が失敗（コマンドが非ゼロ終了、タスク関数が例外を投げる）した時点で、**残りの工程は実行しません**。
失敗した工程のバッファ内容を区切り線つきで表示し、`Error("runEach failed: <ラベル>")` を投げます
（タスクとして実行された場合は通常どおり非ゼロ終了します）。

```
Running sanity...
  - typecheck (型チェック)... ✅
  - fmt (フォーマットチェック)... ❌

[fmt (フォーマットチェック)] failed
--------------------------------------------------
<biome check の出力>
Command "bunx" exited with code 1
--------------------------------------------------
```

### `{ keepGoing: true }`: 全件実行してまとめて報告

先頭オプションに `keepGoing: true` を渡すと、失敗があっても残りの工程を実行し続け、最後に失敗した
全工程の出力をまとめて表示してから例外を投げます。

```typescript
task("check-all", async ({ runEach }) => {
  await runEach({ keepGoing: true }, typecheck, fmt, test);
});
```

## 成功時のメッセージ

全工程が成功すると、`{ done }` で指定した文字列を出力します。未指定の場合は既定文言
（`✨ done (<件数> task(s))`）を出力します。

```typescript
await runEach({ done: "✨ All checks passed! You're good to go." }, typecheck, fmt, test);
```

## タスクハンドルを渡したときの挙動

- タスクの `before` / `after` フックは実行されます。
- タスクの `deps` は **展開されません**（`runEach` は渡された工程だけを順に実行します）。依存込みで
  まとめたい場合は `deps` を持つメタタスクや `bake <task>` 側で組み立ててください。
- メタタスク（`fn` を省略したタスク）を渡した場合は何も実行しません。
