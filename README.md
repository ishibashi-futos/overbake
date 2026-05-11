# overbake

Bun 製の TypeScript タスクランナー。`Bakefile.ts` で型補完が効きながらタスクを定義でき、`bake <task>` で実行します。

## 特徴

- **TypeScript で書ける**: `Bakefile.ts` に関数型 API でタスクを定義
- **型補完が効く**: import 不要、`tsconfig.json` 不要で IDE 補完が動作
- **依存関係解決 (DAG)**: `deps` で他のタスクを指定すると自動で順序を決定
- **TaskContext API**: ファイル操作、コマンド実行などのユーティリティを提供

## How to Use

### CLI コマンド

```bash
# タスク実行（グローバルインストール済み、または dist を PATH に通した場合）
bake build
bake clean

# デフォルトタスクを実行（Bakefile.ts で task.default() で指定したタスク）
bake

# 実行計画を表示するだけで、タスク関数は実行しない
bake build --dry-run

# 各タスクの desc / deps / inputs / outputs / env を表示する
bake build --explain

# 初回実行後、inputs に指定されたファイルの変更を監視して自動再実行
# inputs 未指定の場合は Bakefile.ts を監視対象にする
bake build --watch

# タスク一覧を表示
bake list
bake -l

# ヘルプを表示
bake --help
bake --help build
```

### Bakefile.ts の書き方

プロジェクトルートに置いた `Bakefile.ts` で以下のように定義します。`/// <reference>` はエディタの型補完を有効にするための triple-slash reference です（実行時には不要）。

```typescript
/// <reference path="./Bakefile.d.ts" />

task("clean", { desc: "dist ディレクトリを削除" }, async ({ rm }) => {
  await rm("dist", { recursive: true, force: true });
});

task("build", { desc: "CLI をビルド", deps: ["clean"] }, async ({ cmd }) => {
  await cmd("bun", [
    "build",
    "src/cli/main.ts",
    "--compile",
    "--outfile=dist/bake",
  ]);
});

// デフォルトタスクを指定（bake だけで実行される）
task.default("build");
```

### TaskContext API

タスク関数の引数 `ctx` には以下のメソッドが含まれます。

| メソッド | 説明 |
|---------|------|
| `ctx.name` | タスク名 |
| `ctx.root` | プロジェクトルートの絶対パス |
| `ctx.cwd` | 現在の作業ディレクトリ |
| `ctx.cmd(command, args, options)` | コマンド実行。失敗時は例外をスロー |
| `ctx.rm(path, options)` | ファイル・ディレクトリ削除（`recursive`, `force` オプション） |
| `ctx.exists(path)` | ファイル・ディレクトリが存在するかチェック |
| `ctx.resolve(...segments)` | パスを解決（相対パス → 絶対パス） |
| `ctx.log(...args)` | ログ出力 |
