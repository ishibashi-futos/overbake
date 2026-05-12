# overbake

Bun 製の TypeScript タスクランナー。`Bakefile.ts` で型補完が効きながらタスクを定義でき、`bake <task>` で実行します。

## 特徴

- **TypeScript で書ける**: `Bakefile.ts` に関数型 API でタスクを定義
- **型補完が効く**: import 不要、`tsconfig.json` 不要で IDE 補完が動作
- **依存関係解決 (DAG)**: `deps` で他のタスクを指定すると自動で順序を決定
- **TaskContext API**: ファイル操作、コマンド実行などのユーティリティを提供
- **まとめて実行 (`ctx.runEach` / `task.each`)**: 複数タスク・コマンドを順に実行し、出力を抑えて失敗だけ表示。`task.each` で宣言すると工程が `--graph` 出力にも現れる（[詳細](docs/features/run-each.md)）

## How to Use

### CLI コマンド

```bash
# プロジェクトの初期化（Bakefile.ts と Bakefile.d.ts を作成）
bake init

# 既存プロジェクトで Bakefile.d.ts だけを更新
bake init --type

# タスク実行（グローバルインストール済み、または dist を PATH に通した場合）
bake build
bake clean

# デフォルトタスクを実行（Bakefile.ts で task.default() で指定したタスク）
bake

# 実行計画を表示するだけで、タスク関数は実行しない
bake build --dry-run

# 各タスクの desc / deps / inputs / outputs / env を表示する
bake build --explain

# 依存グラフを mermaid 形式で出力（タスクを実行しない）
# task.each で宣言した工程も「工程 --> タスク」の辺として現れる
bake build --graph
bake build --graph=mermaid

# 依存グラフを Graphviz dot 形式で出力
bake build --graph=dot

# 全タスクの依存グラフを出力（タスク指定なし）
bake --graph

# 初回実行後、inputs に指定されたファイルの変更を監視して自動再実行
# inputs 未指定の場合は Bakefile.ts を監視対象にする
bake build --watch

# 実行サマリーを非表示にする
bake build --no-summary

# 確認プロンプトをスキップして実行
bake deploy --yes
bake deploy -y

# ネームスペース（: 区切り）タスクをワイルドカードで一括実行
# シェルの glob 展開と衝突するため、必ずクォートで囲んでください
bake "build:*"         # build: で始まるタスクを全部実行
bake "lint:*"          # lint: で始まるタスクを全部実行

# Bakefile.ts を静的検証する（タスクは実行しない）
# 未定義 deps・循環依存・重複登録・メタタスクの矛盾などを検出
bake doctor

# タスク一覧を表示
bake list
bake -l

# ヘルプを表示
bake --help
bake --help build

# シェル補完スクリプトを出力
bake completions zsh > ~/.zsh/completions/_bake   # zsh
bake completions bash > ~/.bash_completion.d/bake # bash
bake completions fish > ~/.config/fish/completions/bake.fish # fish
```

### Bakefile.ts の書き方

プロジェクトルートに置いた `Bakefile.ts` で以下のように定義します。`/// <reference>` はエディタの型補完を有効にするための triple-slash reference です（実行時には不要）。

```typescript
/// <reference path="./Bakefile.d.ts" />

task("clean", { desc: "dist ディレクトリを削除" }, async ({ rm }) => {
  await rm("dist", { recursive: true, force: true });
});

// task() はタスクハンドルを返す。task.default() などに渡せる
const build = task("build", { desc: "CLI をビルド", deps: ["clean"] }, async ({ cmd }) => {
  await cmd("bun", [
    "build",
    "src/cli/main.ts",
    "--compile",
    "--outfile=dist/bake",
  ]);
});

task("deploy", { desc: "デプロイ", confirm: "本番環境にデプロイしますか?" }, async ({ cmd }) => {
  await cmd("kubectl", ["apply", "-f", "manifest.yaml"]);
});

// デフォルトタスクを指定（bake だけで実行される）。タスクハンドルを渡す
task.default(build);

// 複数工程を順に実行するタスクを宣言的に定義（工程は --graph にも現れる）
task.each(
  "sanity",
  { desc: "まとめて検証", done: "✨ All checks passed!" },
  build,
  ["bun", ["test"]],
);
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
| `ctx.runEach(...items)` | 複数タスク・コマンドをまとめて実行（[docs/features/run-each.md](docs/features/run-each.md)） |

### タスクオプション

| オプション | 説明 |
|---------|------|
| `desc` | タスク説明 |
| `deps` | 依存タスク（文字列配列） |
| `inputs` | 監視対象ファイル（`--watch` で使用） |
| `outputs` | タスク出力ファイル |
| `env` | 環境変数名（参照用） |
| `confirm` | 実行前の確認プロンプト。文字列または文字列配列。`--yes` / `-y` フラグで確認をスキップ |
| `platforms` | 実行対象 OS（`NodeJS.Platform` 配列）。指定なしは全 OS で実行。例: `["darwin", "linux"]`。対象外 OS では自動的にスキップされる |
| `before` | タスク実行前のフック |
| `after` | タスク実行後のフック |

## 実行サマリー

タスク実行後に各タスクの結果と所要時間、合計 wall time が表示されます。

```
Summary
  clean    ✓  12ms
  build    ✓  1.2s
  ci       ✓  (meta)
  ──────────────────────
  3 tasks · total 1.3s (wall)
```

- `--quiet` では最小限の要約行のみ表示されます（タスク内のログ抑制は維持）
- `--no-summary` でサマリー出力を完全に抑制できます
- 失敗があった場合はサマリー末尾に失敗タスク一覧が付加されます
