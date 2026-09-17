# `task.service()` / `task.compose()` — 長時間サービスの起動と監視

DB・dev サーバ・worker のような、明示的に止めるまで動き続ける **長時間サービス** を宣言的に定義するための
API です。`task.service` は 1 つのサービスを、`task.compose` はそれらを起動順に束ねます。
短命な工程をまとめて実行する `task.each`（[詳細](run-each.md)）とは実行モデルが異なります。

## `task.service()` — 1 つのサービスを宣言する

```typescript
declare function service(name: string, run: ServiceRun): Service;
declare function service(
  name: string,
  options: TaskServiceOptions,
  run: ServiceRun,
): Service;

type ServiceRun = TaskFn | RunEachCommand | Task;
```

`run` には 3 つの形式を渡せます。

```typescript
// 1. タスク関数（ctx.cmd で起動するのが最も一般的）
const api = task.service("api", { ready: { log: /listening on/ } }, async ({ cmd }) => {
  await cmd("bun", ["run", "--hot", "src/index.ts"], { cwd: "apps/api" });
});

// 2. コマンドタプル（ctx.cmd と同じ [command, args?]）
const worker = task.service("worker", ["bun", ["run", "worker.ts"]]);

// 3. タスクハンドル（既存の task() をそのままサービス化する）
const legacy = task("legacy-server", async ({ cmd }) => cmd("./start.sh"));
const db = task.service("db", legacy);
```

`task.service()` の戻り値は `Service`（`Task` を継承したブランド付き型）です。`bake db` のように単体でも
起動でき、`task.compose` にはこの `Service` しか渡せません（通常の `task()` タスクやコマンドタプルを
直接渡すと型エラーになります）。

## ready — 起動完了の判定

`ready` は **log / port / check のいずれか 1 つ** と、任意の `timeoutMs` / `intervalMs` を指定します。

| 判定方法 | 書き方 | 判定 |
|---|---|---|
| ログ行 | `{ log: "listening" }` / `{ log: /listening on/ }` | 出力行が一致したら ready。string は部分一致（`includes`）、RegExp は `test()`（`g` / `y` フラグ付きでも `lastIndex` に影響されない） |
| TCP 接続 | `{ port: 5432 }` / `{ port: 5432, host: "db.local" }` | `intervalMs` ごとに TCP 接続を試み、成功したら ready。`host` の既定は `"localhost"` |
| 任意条件 | `{ check: async () => (await fetch(url)).ok }` | `intervalMs` ごとに呼び出し、`true` を返したら ready。`false` / throw は未 ready 扱い |

| オプション | 既定値 | 意味 |
|---|---|---|
| `timeoutMs` | `60000` | ready になるまでの上限。超えたら失敗 |
| `intervalMs` | `500` | port / check の確認間隔 |

`ready` を省略したサービスは、**`run` を呼び出した直後に ready** とみなされます（起動できたかどうかは
確認しません）。`task.compose` のステージはこの ready 到達を待ってから次のステージへ進むため、`ready`
を省略したサービスが実際には起動に失敗していても、compose 上はその時点で「次のステージへ進んでよい」
と判定されます。ステージを跨いで起動順を保証したいサービスには `ready` を明示することを推奨します。

## 失敗条件

以下のいずれかに該当すると失敗と判定されます。同じ出力行が `failOn` と `ready.log` の両方に一致した
場合は **`failOn` を優先**します。

| 条件 | 失敗理由（`failed: <reason>` の `<reason>`） |
|---|---|
| ready になる前に `run` が正常終了した | `exited unexpectedly` |
| ready になる前に `run` が例外を投げた / reject した | `Error` ならその `message`、それ以外は `String(err)` |
| `ready.timeoutMs` を超えても ready にならなかった | `ready timeout after <timeoutMs>ms` |
| ready になった **後**に `run` が終了した（**`exit 0` も含む**） | `exited unexpectedly` |
| 出力行が `failOn` に一致した | `matched failOn <failOn の表示形式>: <一致した行>` |

長時間サービスにとっては「正常終了」も想定外の停止なので、ready 後の終了は理由を問わず失敗として扱います。

`failOn` も `ready.log` と同じ判定方法です（string は部分一致、RegExp は `test()`）。指定は任意で、
省略すると出力行による失敗判定は行いません。

## retry と指数バックオフ

```typescript
retry: { attempts: 5, delayMs: 1000, factor: 2, maxDelayMs: 30_000 }
```

| オプション | 既定値 | 意味 |
|---|---|---|
| `attempts` | （必須。`retry` 省略時は `0` ＝再起動しない） | 失敗後に再起動する最大回数 |
| `delayMs` | `1000` | 1 回目の再起動前の待機（ミリ秒） |
| `factor` | `2` | 再起動ごとに待機へ掛ける倍率 |
| `maxDelayMs` | `30000` | 待機の上限（ミリ秒） |

`n` 回目（1 始まり）の再起動前の待機は次の式で決まります。

```
待機(n) = min(delayMs × factor^(n-1), maxDelayMs)
```

既定値（`delayMs: 1000`, `factor: 2`, `maxDelayMs: 30000`）での具体例:

| 再起動回数 | 待機 |
|---|---|
| 1 回目 | 1000ms |
| 2 回目 | 2000ms |
| 3 回目 | 4000ms |
| 4 回目 | 8000ms |
| 5 回目 | 16000ms |
| 6 回目 | 30000ms（`maxDelayMs` で頭打ち。以降も 30000ms） |

**`attempts` はサービスの生存期間全体で数えます。** 一度 ready になって長時間動いた後に落ちても、
再起動回数はリセットされません（「起動から `attempts` 回まで再起動する」であって「ready 後にクラッシュ
するたび再起動回数がリセットされる」ではありません）。

再起動を使い切ると、サービスは `ServiceFailedError` で確定的に失敗します。

```
message = "<service>: <reason>"（retries > 0 のとき末尾に " (gave up after <retries> retries)" を追加）
```

## `task.compose()` — ステージとグループで起動順を宣言する

```typescript
declare function compose(
  name: string,
  ...items: (TaskComposeOptions | ComposeItem)[]
): Task;

type ComposeItem = Service | readonly Service[];
```

引数の **並びがそのまま起動順（ステージ）** になります。配列で渡した要素は **同時に起動するグループ**
です。前のステージの全サービスが ready になってから、次のステージを起動します。

```typescript
const db = task.service("db", { ready: { port: 5432, timeoutMs: 120_000 } }, [
  "docker",
  ["compose", "up", "postgres"],
]);
const api = task.service("api", { ready: { log: /listening on/ }, failOn: "EADDRINUSE", retry: { attempts: 5 } },
  async ({ cmd }) => cmd("bun", ["run", "--hot", "src/index.ts"], { cwd: "apps/api" }),
);
const worker = task.service("worker", ["bun", ["run", "worker.ts"]]);
const web = task.service("web", { ready: { check: async () => (await fetch("http://localhost:5173")).ok } }, [
  "bun",
  ["run", "dev"],
]);

// 起動順: db → (api と worker を同時) → web
task.compose("dev", { desc: "開発環境" }, db, [api, worker], web);
```

## 出力例

各サービスの出力は `[name]` prefix 付きで stdout に行単位でストリーミングされます（`NO_COLOR` / 非 TTY
以外では固定色、ラベルは全サービス中の最大幅にパディングして整列）。状態行（`ready` / `failed: ...` /
`retrying in ...`）も同じ prefix で出力されます。

```
[db    ] LOG:  database system is ready to accept connections
[db    ] ready
[api   ] server listening on http://localhost:4000
[api   ] ready
[web   ] ready
```

`worker` は `ready` を指定していないため（前節の例のとおり）、`run` を呼び出した直後に ready 扱いに
なり、`ready` の状態行は出力されません（`ready` を指定したサービスだけが `ready` 行を出します）。

`api` が `EADDRINUSE` で落ちて 5 回まで再起動する場合:

```
[api   ] Error: listen EADDRINUSE: address already in use :::4000
[api   ] failed: matched failOn "EADDRINUSE": Error: listen EADDRINUSE: address already in use :::4000
[api   ] retrying in 1000ms (1/5)
[api   ] server listening on http://localhost:4000
[api   ] ready
```

5 回とも失敗して再起動を使い切った場合、compose 全体が停止し次のメッセージで失敗します。

```
compose failed: api: matched failOn "EADDRINUSE": Error: listen EADDRINUSE: address already in use :::4000 (gave up after 5 retries)
```

## 停止の挙動

`task.compose` は次のいずれかで全サービスを停止します。

- retry を使い切って失敗したサービスが 1 つでも出た（fail-fast）
- `SIGINT` / `SIGTERM`（Ctrl+C など）を受け取った

停止手順はどちらも同じです。

1. 起動済みの全サービスへ `SIGTERM` を送る
2. `killGraceMs`（既定 `KILL_GRACE_MS = 5000`ms）待っても終了していなければ `SIGKILL` する
3. `SIGINT` / `SIGTERM` による停止は **正常終了**（例外を投げない）。fail-fast による停止は
   `compose failed: <reason>` で失敗として終了する

Ctrl+C や `bake stop` はプロセスグループ全体へシグナルを送るため、サービスの子プロセスが bake 自身より
先に終了することがあります。それを誤って失敗と判定しないよう、失敗を確定する前に短い猶予
（`FAILURE_SETTLE_MS`、既定 100ms）を置き、その間に停止要求が届けば `failed:` 行も出さず正常終了として
扱います。裏を返すと、**失敗の検知は最大でこの猶予ぶん遅れます。**

`task.service` の `run` が自身の中で compose を起動する（`task.service` で包んだ compose を、さらに
外側の compose や `bake stop` から止める）場合も、外側の停止要求は内側の compose まで正しく伝わります。

`ctx.cmd` はこの停止要求（`ctx.signal` の abort）に自動で従い、子プロセスへ `SIGTERM` → `SIGKILL` を
送ります。**`Bun.serve` などでプロセス内にサーバを立てるタスク関数は、`ctx.signal` の abort を
待ってから `return` する必要があります。** 待たずに即座に `return` すると、`run` が終了扱いになって
「ready 後の終了」として失敗判定されてしまいます。逆に abort を受け取ってもサーバを止めず `return` も
しない場合は、`task.compose` / `bake stop` の停止処理が `run` の終了（`runDone`）を待ち続けて
止まらなくなります。

```typescript
task.service("api", async ({ signal }) => {
  const server = Bun.serve({ port: 3000, fetch: () => new Response("ok") });
  await new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => {
      server.stop();
      resolve();
    });
  });
});
```

`bake <service>` で単体起動した場合も同じ経路（`ctx.runCompose([[自分自身]])`）で動くため、停止の
挙動は compose 配下でも単体実行でも変わりません。

## cron を compose に入れる

`task.cron` が返すタスクハンドルは `Task` であって `Service` ではないため、`task.compose` へ直接
渡すことはできません（型エラーになります）。渡したい場合は `task.service` で包みます。タスク名は
一意である必要があるため、包む側には別名を付けます。

```typescript
const refresh = task("refresh", async ({ cmd }) => cmd("bun", ["scripts/refresh.ts"]));
const poll = task.cron("poll", { schedule: "@every 30s" }, refresh);
task.compose("dev-all", db, [api, task.service("poller", poll)]);
```

このとき、出力の prefix や `bake --help` に現れる名前は **包んだ側の名前**（この例では `poller`）に
なります。`poll` という名前は `task.compose` の中には現れません。

## `bake --help <task>` の表示

`task.compose` は `Services:` 行にステージを ` → `、グループ内を `, ` で区切って表示します。

```
$ bake --help dev
Task: dev
Description: 開発環境
Dependencies: (none)
Inputs: (none)
Outputs: (none)
Environment: (none)
Platforms: (all)
Services: db → api, worker → web
```

`task.service` は `Ready:` / `Fail on:` / `Retry:` を、指定された項目だけ表示します。

```
$ bake --help api
Task: api
Dependencies: (none)
Inputs: (none)
Outputs: (none)
Environment: (none)
Platforms: (all)
Ready: log /listening on/
Fail on: "EADDRINUSE"
Retry: 5 attempts
```

`Ready:` は probe の種類に応じて `port <host>:<port>` / `log <パターン>` / `check` のいずれかを表示し、
`timeoutMs` を明示していれば末尾に `(timeout <ms>ms)` を付けます。`Retry:` は `attempts` の後ろに、
`delayMs` / `factor` / `maxDelayMs` を明示した分だけ `(delayMs <ms>ms, factor <n>, ...)` の形で付け足します。

## `bake doctor` の検査

`bake doctor` は `Bakefile.ts` を実行せずに、次を静的に検証します（`task.service` / `task.compose` の
実行時と同じ検証関数を使うため、判定基準は一本化されています）。

- 各サービスの `ready` / `failOn` / `retry` の設定が不正（`ready` が 2 つ以上、`port` が範囲外、
  `retry.attempts` が負数、など）→ error
- 各 compose の構成が不正（空のステージ、サービスでない要素、同じサービスの重複指定）→ error
- compose / cron の工程に `confirm` 付きタスクが含まれる → warning（これらの工程は確認プロンプトを
  経由せずに実行されるため）
- タスク名が `docs` など CLI サブコマンドと同名 → warning

`task.service` / `task.compose` は **登録時には値を検証しません**。検証は実行時（`bake <service>` /
`bake <compose>` を実行したとき）と `bake doctor` の両方が同じ関数（`resolveServiceConfig` /
`resolveComposeStages`）を呼ぶことで一本化されています。`Bakefile.ts` を編集したら、実行する前に
`bake doctor` を通すことを推奨します。

## 既知の制限

- **上流サービスが再起動しても下流サービスは再起動しません。** 例えば `db` がクラッシュして再起動しても、
  既に ready になっている `api` はそのまま動き続けます。再接続はサービス側のコードで処理する必要があります。
- **`retry.attempts` はサービスの生存期間全体で数えます。** ready でリセットされないため、長時間
  安定稼働した後の 1 回の失敗でも「再起動 5 回目」としてカウントされることがあります。
- **登録時ではなく実行時と `bake doctor` で検証します。** `task.service` / `task.compose` を呼んだ
  時点では設定の妥当性は確認されません。実行前に `bake doctor` を通す運用を前提にしています。
