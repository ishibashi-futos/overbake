---
name: overbake
description: Bakefile.ts を書く・編集する、または bake コマンド（task.service / task.compose / task.cron などで定義したタスクの実行・調査・デバッグ）を使うときに読むスキル。
---

# overbake

overbake は Bun 製のタスクランナーです。プロジェクトルートの `Bakefile.ts` に TypeScript でタスクを定義し、`bake <task>` で実行します。このスキルは人間向け README の要約ではなく、**エージェントが Bakefile.ts を書き、`bake` コマンドでタスクを実行・調査・デバッグするときに迷わないための手順と落とし穴**をまとめたものです。

## 1. overbake とは

- `bake` は単一の Bun プロセスとして動き、`Bakefile.ts` を `import` してタスクを登録する。
- `Bakefile.ts` は **`cwd` から上方向に探索**して最初に見つかったものを使う（`.git` と同じ作法）。見つからなければ `bake init` を案内される。
- ユーザーは何も `import` しない。`globalThis` に `task` / `argv` が注入され、同階層の `Bakefile.d.ts`（`/// <reference>` で読み込む型宣言。実行時には使われない）がエディタ補完を支える。

### 最小の Bakefile.ts

```typescript
/// <reference path="./Bakefile.d.ts" />

task("hello", { desc: "サンプルタスク" }, async ({ log }) => {
  log("Hello from Overbake!");
});
```

### 初期化

- `bake init` — `Bakefile.ts` と `Bakefile.d.ts` を生成し、`.gitignore` に `.overbake/` を追記する。既存の `Bakefile.ts` があれば上書き確認する。
- `bake init --type` — `Bakefile.d.ts` だけを最新版に更新する（既存プロジェクトで型が古くなったとき）。**`Bakefile.ts` を編集していて型エラーが実際の仕様とズレていると感じたら、まずこれを実行する。**

## 2. まず状況を把握するコマンド

Bakefile.ts があるディレクトリに入ったら、実行より先にこれらで現状を掴む。

| コマンド | 何が分かるか |
|---|---|
| `bake list`（`bake -l`） | 定義済みタスクの一覧と `desc` |
| `bake --help <task>` | そのタスクの `deps` / `inputs` / `outputs` / `env` / `platforms`、compose なら `Services:`、service なら `Ready:` / `Fail on:` / `Retry:` |
| `bake <task> --dry-run` | タスク関数を実行せず、実行計画（実行されるタスクの並び）だけ表示 |
| `bake <task> --explain` | キャッシュ判定の理由（`inputs` の何が変わったか）を表示 |
| `bake <task> --graph`（`--graph=dot`） | 依存グラフを mermaid / dot で出力（`task.each` / `task.compose` / `task.cron` の工程も辺として現れる） |
| `bake doctor` | `Bakefile.ts` を実行せずに静的検証（後述） |

`Bakefile.ts` を編集した直後は、実行する前に必ず `bake doctor` を通すこと（§6 参照）。

## 3. タスク API

### `task()` — 単体タスク

```typescript
declare function task(name: string, fn: TaskFn): Task;
declare function task(name: string, opts: TaskOptions, fn: TaskFn): Task;
declare function task(name: string, opts: TaskOptions): Task; // fn 省略 = メタタスク（deps だけを束ねる）
```

`task()` の戻り値は **タスクハンドル**。変数で受け取って `task.each` / `task.service` / `task.compose` / `task.cron` / `task.default` に渡せる。

#### `TaskOptions`

| オプション | 説明 |
|---|---|
| `desc` | `bake list` / `--help` に出る短い説明 |
| `deps` | 先に実行する他タスク名（文字列配列） |
| `inputs` | 監視・キャッシュ対象ファイルの glob |
| `outputs` | タスクの出力ファイルの glob。指定するとキャッシュ判定が有効化される |
| `env` | ハッシュに含める環境変数名 |
| `confirm` | 実行前の確認プロンプト（文字列 or 文字列配列）。`--yes` / `-y` でスキップ。**非 TTY（デーモン起動時など）では `--yes` が無いと止まる** |
| `platforms` | 実行対象 OS（`NodeJS.Platform` の配列）。対象外 OS では自動スキップ |
| `before` / `after` | 実行前後のフック。`after` は `{ ok, durationMs }` も受け取る |

#### `ctx`（`TaskFn = (ctx: TaskContext) => void | Promise<void>`）

| メンバー | 説明 |
|---|---|
| `ctx.name` | タスク名 |
| `ctx.root` | プロジェクトルートの絶対パス |
| `ctx.cwd` | 現在の作業ディレクトリ |
| `ctx.signal` | `AbortSignal`。`task.compose` / `task.service` 配下で停止・再起動するときに abort される。`ctx.cmd` は自動でこれに従う |
| `ctx.cmd(command, args?, options?)` | サブプロセス実行。`options.signal` を渡すと外部の abort にも従わせられる。失敗時は例外 |
| `ctx.rm(path, options?)` | ファイル・ディレクトリ削除（`recursive`, `force`） |
| `ctx.exists(path)` | 存在チェック |
| `ctx.resolve(...segments)` | 相対パス → 絶対パス |
| `ctx.log(...args)` | ログ出力 |
| `ctx.runEach(...items)` | 複数タスク・コマンドを順に実行（下記 `task.each` と同じ挙動） |

**プロセス内でサーバを立てるタスク関数（`Bun.serve` など）は `ctx.signal` の abort を待ってから `return` すること。** 待たずに即 `return` すると、`run` が終了扱いになり「ready 後の終了」として失敗判定される。逆に abort を受けても `server.stop()` を呼ばず `return` もしないと、`task.compose` / `bake stop` の停止処理が `run` の終了を待ち続けて止まらなくなる。

```typescript
task("api", async ({ signal }) => {
  const server = Bun.serve({ port: 3000, fetch: () => new Response("ok") });
  await new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => {
      server.stop();
      resolve();
    });
  });
});
```

### `task.each` — 複数工程をまとめて実行

短命な工程（typecheck / lint / build / test など）を **逐次**実行する。`ctx.runEach` を本体で呼ぶ代わりに宣言的に書くと、工程が `--graph` の辺にも現れる。

```typescript
const typecheck = task("typecheck", async ({ cmd }) => cmd("bunx", ["tsc", "--noEmit"]));
const fmt = task("fmt", async ({ cmd }) => cmd("bunx", ["biome", "check", "."]));
const build = task("build", { deps: ["clean"] }, async ({ cmd }) => cmd("bun", ["build", "src/cli/main.ts"]));
const test = task("test", async ({ cmd }) => cmd("bun", ["test"]));

task.each(
  "sanity",
  { desc: "まとめて検証", done: "✨ All checks passed!" },
  typecheck,
  fmt,
  build,
  ["bun", ["run", "lint:extra"]], // コマンドタプル [command, args?] も混在できる
  test,
);
```

- `RunEachItem` = タスクハンドル または `[command, args?]` のコマンドタプル。
- 先頭に `{ desc?, done?, keepGoing? }`（`TaskEachOptions`）を置ける。省略可。
- 既定は **fail-fast**（最初の失敗で残りを実行しない）。`keepGoing: true` で全件実行してから失敗をまとめて報告する。
- 各工程の出力（`cmd` の stdout/stderr・`ctx.log`）は抑制してバッファし、**失敗した工程のバッファだけ**表示する。
- 渡したタスクの `deps` は展開されない（`sanity` を呼んでも `build` の依存 `clean` は自動では走らない）。

### `task.service` — 長時間サービス

DB / dev サーバ / worker のような、明示的に止めるまで動き続けるプロセスを宣言する。詳細な実行モデルは §4。

```typescript
declare function service(name: string, run: ServiceRun): Service;
declare function service(name: string, options: TaskServiceOptions, run: ServiceRun): Service;

type ServiceRun = TaskFn | RunEachCommand | Task;
```

```typescript
const api = task.service(
  "api",
  {
    desc: "API サーバ",
    ready: { log: /listening on/, timeoutMs: 30_000 },
    failOn: "EADDRINUSE",
    retry: { attempts: 5, delayMs: 1000 },
  },
  async ({ cmd }) => {
    await cmd("bun", ["run", "--hot", "src/index.ts"], { cwd: "apps/api" });
  },
);

const worker = task.service("worker", ["bun", ["run", "worker.ts"]]);
```

`bake api` で単体起動できる（`bake <他のタスク>` と同じ扱い）。`task.compose` に渡すとまとめて起動順を制御できる。

### `task.compose` — 起動順つきでサービスをまとめる

```typescript
declare function compose(name: string, ...items: (TaskComposeOptions | ComposeItem)[]): Task;

type ComposeItem = Service | readonly Service[];
```

**`task.compose` に渡せるのは `task.service` が返した `Service` だけ**（通常の `task()` タスクやコマンドタプルは渡せない。型エラーになる）。引数の並びが起動順、配列にまとめた要素は同時起動。

```typescript
const db = task.service("db", { ready: { port: 5432 } }, ["docker", ["compose", "up", "postgres"]]);
const api = task.service("api", { ready: { log: /listening/ } }, async ({ cmd }) => cmd("bun", ["run", "api"]));
const worker = task.service("worker", ["bun", ["run", "worker.ts"]]);
const web = task.service("web", { ready: { check: async () => (await fetch("http://localhost:5173")).ok } }, ["bun", ["run", "dev"]]);

// 起動順: db → (api と worker を同時) → web
task.compose("dev", { desc: "開発環境" }, db, [api, worker], web);
```

### `task.cron` — 定期実行

```typescript
declare function cron(name: string, options: TaskCronOptions, ...items: RunEachItem[]): Task;
type TaskCronOptions = TaskOptions & { schedule: string };
```

1 回の発火は `task.each` と同じ逐次実行。`schedule` は 5 フィールド cron 式 / `@hourly` などのエイリアス / `@every 30s` 形式の固定間隔。

```typescript
const backup = task("backup", async ({ cmd }) => cmd("bun", ["scripts/backup.ts"]));
task.cron("nightly", { schedule: "0 3 * * *", desc: "毎晩バックアップ" }, backup);
```

- `bake nightly` で前景実行（Ctrl+C で終了）、`bake -d nightly` でデーモン常駐。
- 工程が失敗してもスケジューラは止まらない。次回時刻は **実行完了後**に計算するため多重起動しない。
- `task.cron` が返すハンドルは `Task` であって `Service` ではないため、**`task.compose` へ直接渡すことはできない**。渡したい場合は `task.service` で包む（§4 参照）。

### `task.default` — デフォルトタスク

```typescript
declare function defaultTask(task: Task): void; // task.default として公開
```

`bake`（タスク名なし）で実行されるタスクを指定する。

```typescript
task.default(build);
```

### `argv`

`bake build -- --minify` の `--minify` のように、`--` 以降の引数は `argv: readonly string[]` として `Bakefile.ts` から参照できる。

## 4. サービスと起動順

### ready（起動完了）の判定

`ServiceReady` は `log` / `port` / `check` の **どれか 1 つ**と、`timeoutMs`（既定 `60000`）・`intervalMs`（既定 `500`）。

| 判定方法 | 書き方 | 説明 |
|---|---|---|
| ログ行 | `{ log: "listening" }` / `{ log: /listening on/ }` | 出力行が一致したら ready。string は部分一致、RegExp は `test()` |
| TCP 接続 | `{ port: 5432 }` / `{ port: 5432, host: "db.local" }` | `intervalMs` ごとに接続確認。`host` 既定は `"localhost"` |
| 任意の条件 | `{ check: async () => (await fetch(url)).ok }` | `true` を返すまで `intervalMs` ごとに再確認。`false` / throw は未 ready 扱い |

`ready` を省略したサービスは **起動（`run` 呼び出し）直後に ready** とみなされる。

### 失敗条件

以下のいずれかで失敗（同じ出力行が `failOn` と `ready.log` の両方に一致した場合は `failOn` を優先）:

- ready になる前にプロセスが終了した
- `ready.timeoutMs` を超えても ready にならなかった
- ready になった **後**にプロセスが終了した（**`exit 0` も失敗扱い**。長時間サービスにとって正常終了は想定外のため）
- 出力行が `failOn`（string は部分一致、RegExp は `test()`）に一致した

### retry と指数バックオフ

```typescript
retry: { attempts: 5, delayMs: 1000, factor: 2, maxDelayMs: 30_000 }
```

- `n` 回目（1 始まり）の再起動前の待機 = `min(delayMs × factor^(n-1), maxDelayMs)`。既定は `delayMs: 1000` / `factor: 2` / `maxDelayMs: 30000`。
- `attempts` は **サービスの生存期間全体で数える**（一度 ready になっても回数はリセットされない）。`retry` 未指定なら再起動しない。

### fail-fast と停止

`task.compose` は前ステージの **全サービスが ready** になってから次ステージを起動する（`db → [api, worker] → web` が確実にこの順で立ち上がる）。`retry` を使い切って失敗したサービスが 1 つでも出ると、compose 全体を止める:

1. 起動済みの全サービスへ `SIGTERM`
2. `KILL_GRACE_MS`（既定 5 秒）待って残っていれば `SIGKILL`
3. `compose failed: <service>: <reason>` で失敗として終了（`retry` を使い切った場合は末尾に ` (gave up after <N> retries)` が付く）

`SIGINT` / `SIGTERM`（Ctrl+C など）を受けた場合は同じ停止処理を行うが、こちらは正常終了として扱う（例外を投げない）。

**Ctrl+C や `bake stop` はプロセスグループ全体へシグナルを送るため、サービスの子プロセスが bake 自身より先に終了することがある。** これを誤って失敗と判定しないよう、失敗を確定する前に短い猶予（`FAILURE_SETTLE_MS`、既定 100ms）を置き、その間に停止要求が届けば失敗として扱わない（`failed:` 行も出さない）。**つまり失敗の検知は最大でこの猶予ぶん遅れる。**`task.service` の `run` が自身の中で compose を起動する（compose を `task.service` で包んでさらに外側の compose / `bake stop` から止める）場合も、外側の停止要求は内側の compose まで正しく伝わる。

出力は `[name]` prefix 付きで stdout にストリーミングされ、状態行も同じ prefix で流れる。

```
[db    ] ready
[api   ] failed: matched failOn "EADDRINUSE": Error: listen EADDRINUSE :::4000
[api   ] retrying in 1000ms (1/5)
[api   ] ready
```

### 既知の制限

- **上流サービスが再起動しても下流サービスは再起動しない。** 例えば `db` がクラッシュして再起動しても、既に ready になっている `api` はそのまま動き続ける。依存先の再接続はサービス側（`api` のコード）で処理する必要がある。
- **cron を compose に入れるときは `task.service` で包む**（`task.cron` はサービスではないため）。タスク名は一意である必要があるため、`compose` に渡す側は別名にする。

```typescript
const poll = task.cron("poll", { schedule: "@every 30s" }, backup);
task.compose("dev-all", db, [api, task.service("poller", poll)]);
```

## 5. CLI リファレンス

### 実行フラグ（`bake <task> [flags]`）

| フラグ | 効果 |
|---|---|
| `--dry-run` | 実行計画を表示するだけで、タスク関数は実行しない |
| `--explain` | キャッシュ判定の理由を表示 |
| `--watch` | `inputs` のファイル変更を監視して自動再実行 |
| `--graph`（`--graph=mermaid` \| `--graph=dot`） | 依存グラフを出力して終了（実行しない） |
| `--keep-going` | 失敗しても他のタスクを継続 |
| `--quiet` | タスク出力を抑制（最小限の要約行のみ） |
| `--verbose` | ハッシュ判定などの詳細ログも出力 |
| `--no-color` | 色付けを無効化 |
| `--no-summary` | 実行サマリーの出力を抑制 |
| `--yes` / `-y` | `confirm:` の確認プロンプトをスキップ |
| `-d` / `--daemon` | タスクをバックグラウンドのデーモンとして起動（1 タスクのみ。`--dry-run` / `--explain` があればそちらが優先） |
| `--` | 以降をタスクへの引数として `argv` に渡す |

### サブコマンド

| コマンド | 効果 |
|---|---|
| `bake init` | `Bakefile.ts` / `Bakefile.d.ts` を生成、`.gitignore` に `.overbake/` を追記 |
| `bake init --type` | `Bakefile.d.ts` だけを再生成 |
| `bake list`（`bake -l`） | タスク一覧を表示 |
| `bake doctor` | `Bakefile.ts` を静的検証（タスクは実行しない。§6 参照） |
| `bake glaze [path]` | `Bakefile.ts`（既定 `./Bakefile.ts`）をフォーマット |
| `bake glaze --check [path]` | フォーマット崩れの有無だけ確認（書き込まない） |
| `bake completions <shell>` | シェル補完スクリプトを出力（`zsh` / `bash` / `fish`） |
| `bake update` | `bake` 自身を GitHub の最新リリースへ更新 |
| `bake update --check` | 確認のみ（ダウンロード・置き換えなし） |
| `bake update --force` | 同一/新しいバージョンでも再インストール |
| `bake ps` | 起動中デーモンの一覧（NAME / PID / UPTIME / LOG） |
| `bake stop <task>`（`bake stop --all`） | デーモンを停止（プロセスグループへ `SIGTERM` → 5 秒後 `SIGKILL`） |
| `bake logs <task>`（`-n <行数>` 既定 50 / `-f` で追従） | デーモンのログを表示 |
| `bake docs` | このガイド（`docs/SKILL.md`）をそのまま標準出力へ出す |
| `bake --help`（`bake --help <task>`） | グローバルヘルプ / タスク別ヘルプ |
| `bake --version`（`bake -v`） | バージョンを表示 |

タスク名なしで `bake` を実行すると `task.default` で指定したタスク（未指定ならタスク一覧）が実行される。

### 終了コード

| コード | 意味 |
|---|---|
| `0` | 成功 |
| `1` | タスクの実行失敗 |
| `2` | 設定エラー（`Bakefile.ts` 不在、未定義タスク参照、循環依存など） |

## 6. エージェント向けの運用ルール

- **長時間動くタスクをそのまま前景で実行しない。** `task.service` / `task.compose` / `--watch` / `bake logs -f` はプロセスが終了しないため、そのままセッションをブロックする。代わりに `bake -d <task>` でデーモン起動し、`bake logs <task> -n 100` で状況を確認、用が済んだら `bake stop <task>` で止める。
- **非 TTY のセッションでは `confirm:` 付きタスクに `--yes`（`-y`）が必須。** 応答できるプロンプトが無いため、無しで実行すると止まる。
- **終了コードで成否を判定する。** `0` は成功、`1` はタスク失敗、`2` は `Bakefile.ts` 自体の設定エラー（`bake doctor` で事前に潰せる種類のもの）。
- **`Bakefile.ts` を編集したら、実行する前に `bake doctor` を通す。** 未定義 `deps`・循環依存・不正な `service` / `compose` 設定・不正な cron 式などを実行前に検出できる。
- **型エラーが実際の仕様とズレていると感じたら `bake init --type` で `Bakefile.d.ts` を更新**してから編集を続ける。
- **compose / cron の工程に `confirm` 付きタスクを混ぜない。** `bake doctor` が警告するとおり、これらの工程は確認プロンプトを経由せずに実行される。

## 7. レシピ

### sanity パイプライン（`task.each`）

```typescript
const typecheck = task("typecheck", async ({ cmd }) => cmd("bunx", ["tsc", "--noEmit"]));
const fmt = task("fmt", async ({ cmd }) => cmd("bunx", ["biome", "check", "."]));
const test = task("test", async ({ cmd }) => cmd("bun", ["test"]));

task.each("sanity", { desc: "まとめて検証", done: "✨ All checks passed!" }, typecheck, fmt, test);
```

### DB → API → Web の compose

```typescript
const db = task.service("db", { ready: { port: 5432, timeoutMs: 120_000 } }, ["docker", ["compose", "up", "postgres"]]);
const api = task.service("api", { ready: { log: /listening on/ }, retry: { attempts: 5 } }, async ({ cmd }) => {
  await cmd("bun", ["run", "--hot", "src/index.ts"], { cwd: "apps/api" });
});
const web = task.service("web", { ready: { check: async () => (await fetch("http://localhost:5173")).ok } }, ["bun", ["run", "dev"]]);

task.compose("dev", { desc: "開発環境" }, db, api, web);
```

### compose をデーモン化する

```bash
bake -d dev          # db → api → web をまとめて常駐起動
bake logs dev -f     # [db] / [api] / [web] prefix 付きログを追従
bake stop dev        # 全サービスをまとめて停止
```

### cron の定期実行

```typescript
const refresh = task("refresh", async ({ cmd }) => cmd("bun", ["scripts/refresh.ts"]));
task.cron("nightly", { schedule: "0 3 * * *", desc: "毎晩バックアップ" }, refresh);
```

```bash
bake nightly       # 前景実行（Ctrl+C で終了）
bake -d nightly    # デーモンとして常駐
bake logs nightly  # 実行ログを確認
```
