# overbake

Bun 製の TypeScript タスクランナー。`Bakefile.ts` で型補完が効きながらタスクを定義でき、`bake <task>` で実行します。

## 特徴

- **TypeScript で書ける**: `Bakefile.ts` に関数型 API でタスクを定義
- **型補完が効く**: import 不要、`tsconfig.json` 不要で IDE 補完が動作
- **依存関係解決 (DAG)**: `deps` で他のタスクを指定すると自動で順序を決定
- **TaskContext API**: ファイル操作、コマンド実行などのユーティリティを提供
- **まとめて実行 (`ctx.runEach` / `task.each`)**: 複数タスク・コマンドを順に実行し、出力を抑えて失敗だけ表示。`task.each` で宣言すると工程が `--graph` 出力にも現れる（[詳細](docs/features/run-each.md)）
- **並列サービス起動 (`task.compose`)**: 複数フォルダ（ワークスペース）の長時間サービスを並列起動。`[name]` prefix 付きストリーミング出力、1 つでも落ちたら他に SIGTERM、Ctrl+C で全停止
- **デーモンモード (`-d`)**: タスクをバックグラウンドで常駐起動。ログは `.overbake/logs/<task>.log` へ。`bake ps` / `bake logs` / `bake stop` で管理
- **定期実行 (`task.cron`)**: cron 式でジョブを定義。前景でも `-d` でデーモンとしても動かせ、`task.compose` の要素にもできる

## インストールと更新

GitHub Releases から自分のプラットフォーム向けバイナリをダウンロードし、PATH の通ったディレクトリに
`bake`（Windows は `bake.exe`）として配置します。

```bash
# linux/x64
curl -fsSL -o /usr/local/bin/bake https://github.com/ishibashi-futos/overbake/releases/latest/download/bake-linux-x64
chmod +x /usr/local/bin/bake

# darwin/arm64 (macOS Apple Silicon)
curl -fsSL -o /usr/local/bin/bake https://github.com/ishibashi-futos/overbake/releases/latest/download/bake-darwin-arm64
chmod +x /usr/local/bin/bake

# win32/x64 は bake-windows-x64.exe を PATH の通ったディレクトリへ bake.exe としてダウンロードしてください
```

更新は `bake update` で行います。

```bash
bake update          # 最新版を確認し、新しければダウンロードして置き換える
bake update --check  # 確認のみ。ダウンロード・置き換えは行わない
bake update --force  # 同一/新しいバージョンでも再インストールする
```

詳細は [docs/features/self-update.md](docs/features/self-update.md) を参照してください。

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

# タスクをバックグラウンドのデーモンとして起動（ログは .overbake/logs/<task>.log）
bake -d dev

# 起動中のデーモン一覧（NAME / PID / UPTIME / LOG）
bake ps

# デーモンのログを表示（既定 50 行）。-f で追従、-n で行数指定
bake logs dev
bake logs dev -n 200 -f

# デーモンを停止（プロセスグループ全体へ SIGTERM → 5 秒後 SIGKILL）
bake stop dev
bake stop --all

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

# bake を最新の GitHub Release に更新する
bake update
bake update --check  # 確認のみ。ダウンロード・置き換えは行わない
bake update --force  # 同一/新しいバージョンでも再インストールする

# バージョンを表示
bake --version
bake -v
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

// 複数フォルダのサービスを並列起動（dev サーバの compose）。
// 1 つでも exit すると他に SIGTERM が飛び、Ctrl+C で全停止する。
const ui = task("ui", async ({ cmd }) => {
  await cmd("bun", ["run", "--hot", "src/index.ts"], { cwd: "apps/ui" });
});
const api = task("api", async ({ cmd }) => {
  await cmd("bun", ["run", "--hot", "src/index.ts"], { cwd: "apps/api" });
});
task.compose("dev", { desc: "全サービス並列起動" }, ui, api);

// 定期実行。工程は task.each と同じ書き方で、schedule に従って繰り返される。
// bake nightly で前景実行、bake -d nightly でデーモン実行。
const backup = task("backup", async ({ cmd }) => {
  await cmd("bun", ["scripts/backup.ts"]);
});
task.cron("nightly", { schedule: "0 3 * * *", desc: "毎晩バックアップ" }, backup);

// cron タスクは compose の要素にもできる（dev サーバと定期ジョブを一緒に起動する）
const poller = task.cron("poll", { schedule: "@every 30s" }, backup);
task.compose("dev-all", { desc: "サービスと定期ジョブをまとめて起動" }, ui, api, poller);
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

### 宣言的タスク API

| API | 説明 |
|---------|------|
| `task(name, opts?, fn?)` | 通常のタスク。`fn` 省略でメタタスク |
| `task.default(task)` | `bake` 単体で実行されるデフォルトタスクを指定 |
| `task.each(name, opts?, ...items)` | 複数工程を順に実行（失敗した工程の出力だけ表示） |
| `task.compose(name, opts?, ...services)` | 複数の長時間サービスを並列起動（fail-fast・SIGINT 伝播） |
| `task.cron(name, { schedule, ...opts }, ...items)` | 工程列をスケジュールに従って繰り返し実行 |

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

## デーモンモード

`-d` / `--daemon` を付けると、タスクをバックグラウンドのデーモンとして起動します。

```bash
bake -d dev
# Started daemon 'dev' (pid 12345)
#   log:  /path/to/project/.overbake/logs/dev.log
#   stop: bake stop dev
```

- **起動前の検証は前景で行う**: 実行計画の構築（未定義タスク・循環依存の検出）と `confirm:` の確認プロンプトは detach する **前** の親プロセスで実行します。設定エラーはその場で exit 2 になり、確認は TTY のある側で応答できます。子プロセスには `--yes` が付与されるため、ログの向こう側でプロンプト待ちになることはありません。
- **ログ**: stdout / stderr は `.overbake/logs/<task>.log` へ **追記** されます。起動ごとに `=== <task> started at <ISO8601> ===` の区切り行が入ります。出力先がファイルなので色付けは自動的に無効になります。
- **状態**: PID などは `.overbake/daemons/<task>.json` に保存されます。`.overbake/` は `.gitignore` に追加することを推奨します（未記載の場合は `bake doctor` が警告します）。
- **停止**: `bake stop <task>` は **プロセスグループ全体** へ SIGTERM を送り、5 秒経っても残っていれば SIGKILL します。`ctx.cmd` が起動した孫プロセスや compose のサービスも取り残されません。
- **多重起動の防止**: 同名のデーモンが生きている間は再起動を exit 2 で拒否します。
- **`--dry-run` / `--explain` が優先**: 副作用が無いこれらのフラグは `-d` より優先して前景で処理されます。
- **対象は 1 タスク**: `-d` は 1 つのタスクにだけ指定できます。複数サービスを常駐させたい場合は `task.compose` でまとめてから `-d` を付けます。
- **ログのローテーション**: 既定で 1MB を超えると世代退避します（後述）。

### ログのローテーション

長期常駐でログが肥大化しないよう、デーモンは自分のログサイズを定期的（既定 5 秒間隔）に確認し、上限を超えたら世代退避します。

```
.overbake/logs/
├── dev.log      # 現在のログ
├── dev.log.1    # 直前の世代（新しい）
├── dev.log.2
└── dev.log.3    # 最古（これより古い世代は削除される）
```

- 既定は **1MB × 3 世代**（1 タスクあたり最大およそ 4MB）
- 退避後の現在ログの先頭には `=== rotated at <ISO8601>（前のログ: …dev.log.1）===` が入ります
- `bake logs -n 500` のように現在ログだけで足りない場合は、退避済みの世代へ遡って表示します
- `bake logs -f` の追従はローテーションを跨いでも継続します
- サイズ確認は間隔ごとなので、確認と確認の間に書かれた分だけ上限を超えることがあります（出力量が多いデーモンでは `OVERBAKE_LOG_CHECK_MS` を短くしてください）

| 環境変数 | 既定 | 意味 |
|---|---|---|
| `OVERBAKE_LOG_MAX_BYTES` | `1048576` | ローテーションのしきい値（バイト）。`0` でローテーション無効 |
| `OVERBAKE_LOG_KEEP` | `3` | 保持する世代数。`0` なら退避せず現在ログを空にするだけ |
| `OVERBAKE_LOG_CHECK_MS` | `5000` | サイズを確認する間隔（ミリ秒） |

不正な値（負数・小数・数値以外）を指定した場合は既定値へ戻さずエラーにします。

> 退避は **`copytruncate` 方式**（内容をコピーしてから現在ログを 0 バイトに切り詰める）です。デーモンとその孫プロセスはログファイルの fd を継承したまま書き続けるため、ファイルをリネームして作り直す方式では新しいログに何も書かれなくなります。コピーと切り詰めの間に発生した書き込みが失われる可能性がありますが、これは logrotate の `copytruncate` と同じ既知のトレードオフです。

### 複数サービスをまとめてデーモン化する

`task.compose` と `-d` を組み合わせると、複数の長時間サービスを 1 つのデーモンとして常駐させられます。各サービスの出力は `[name]` prefix 付きで同じログファイルに集約されます。

```bash
bake -d dev          # ui と api をまとめて常駐起動
bake logs dev -f     # [ui] / [api] prefix 付きのログを追従
bake stop dev        # 両サービスをまとめて停止
```

## 定期実行 (`task.cron`)

`task.cron` はスケジュールに従って工程列を繰り返し実行するタスクを定義します。工程の書き方は `task.each` と同じ（タスクハンドルまたは `[command, args?]`）です。

```typescript
const backup = task("backup", async ({ cmd }) => {
  await cmd("bun", ["scripts/backup.ts"]);
});

task.cron("nightly", { schedule: "0 3 * * *", desc: "毎晩バックアップ" }, backup);
```

```bash
bake nightly       # 前景実行（Ctrl+C で終了）
bake -d nightly    # デーモンとして常駐
bake logs nightly  # 実行ログを確認
```

### スケジュール書式

| 書式 | 例 | 意味 |
|---|---|---|
| 5 フィールド cron | `*/15 9-17 * * 1-5` | 分 時 日 月 曜日。`*` / `*/n` / `a-b` / `a-b/n` / カンマ区切りに対応 |
| エイリアス | `@hourly` `@daily` `@midnight` `@weekly` `@monthly` `@yearly` `@annually` | 定番スケジュールの短縮形 |
| 固定間隔 | `@every 30s` `@every 5m` `@every 2h` `@every 1d` | 前回実行の完了時刻からの経過時間で発火（最小 1s） |

- 曜日は `0`（日）〜`6`（土）。`7` は `0` と同じ扱いです。日と曜日の両方を絞った場合は cron の慣習に従い **どちらかにマッチすれば実行** します。
- 判定は **ローカル時刻** で行います。
- **失敗してもスケジューラは止まりません**。失敗した工程の出力を表示し、次の発火を待ちます。
- **次回時刻は実行完了後に計算** するため、実行が長引いて次の発火時刻を過ぎた場合はその回をスキップします（多重起動しません）。
- cron 式の妥当性は `bake doctor` が静的に検証します。

### compose との組み合わせ

`task.cron` が返すタスクハンドルは `task.compose` の要素として渡せます。dev サーバと定期ジョブを 1 コマンドで起動・停止できます。

```typescript
const poller = task.cron("poll", { schedule: "@every 30s" }, refresh);
task.compose("dev", ui, api, poller);
```

## Bakefile の静的検証 (`bake doctor`)

`bake doctor` は `Bakefile.ts` を読み込むだけで（タスクを実行せずに）設定の健全性を検証します。

- **error**（exit 2）: 未定義の `deps` 参照、循環依存、同名タスクの二重登録、メタタスクなのに `outputs` を持つ矛盾、不正な cron 式
- **warning**（exit 0）: `inputs` glob の 0 件マッチ、`.gitignore` に `.overbake/` が無い、`compose` / `cron` の工程に `confirm` 付きタスクがある（非 TTY のデーモン実行では応答できないため）、CLI サブコマンドと同名のタスク
