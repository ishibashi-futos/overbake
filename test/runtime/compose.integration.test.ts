import { expect, test } from "bun:test";
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildPlan, executePlan } from "../../src/runtime/executor.ts";
import { describeIfPosix, useTempDir, waitUntil } from "../support/sandbox.ts";

const MAIN = resolve(import.meta.dir, "../../src/cli/main.ts");

/**
 * Ctrl+C 競合の回帰テストで、全サービスの起動行（"svcN up"）が出力に現れるまで待つ
 * タイムアウト（ミリ秒）。遅い CI でも十分待てるよう余裕を持たせている。
 */
const SIGINT_RACE_STARTUP_TIMEOUT_MS = 15000;

/**
 * Ctrl+C 競合の回帰テストで、全サービスの起動を確認してから SIGINT 送信までに
 * 空ける時間（ミリ秒）。起動直後（イベントループが起動処理で忙しい間）に送ると
 * 競合が再現しないため、起動行が出揃った後もループが落ち着くまで少し待ってから
 * 送る（実測で確認した値）。固定時間ではなく起動行を待ってから送ることで、
 * 起動が遅い CI でも「8 サービス起動前に SIGINT を送ってしまい事後確認で誤って
 * 失敗する」ことを避ける。
 */
const SIGINT_RACE_SETTLE_MS = 400;

function readIfExists(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf-8") : null;
}

/**
 * `bake <args>` を実プロセスとして spawn する（node:child_process.spawn、detached: true で
 * 新しいプロセスグループを作る。proc.pid がそのままプロセスグループ ID になる）。
 * stdout/stderr は 1 つの文字列へ集約し、output() で読める。
 */
function spawnBake(
  cwd: string,
  args: string[],
): {
  proc: ChildProcess;
  output: () => string;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
} {
  const proc = spawn("bun", [MAIN, ...args], {
    cwd,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  proc.stdout?.on("data", (chunk) => {
    out += chunk.toString();
  });
  proc.stderr?.on("data", (chunk) => {
    out += chunk.toString();
  });
  const exited = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((res) => {
    proc.on("exit", (code, signal) => res({ code, signal }));
  });
  return { proc, output: () => out, exited };
}

/**
 * Ctrl+C 競合の回帰テスト用 fixture: 8 サービスを 1 ステージにした compose。
 * 各サービスは実子プロセス（ctx.cmd）として起動し、プロセスグループへの SIGINT を
 * bake 本体と同時に直接受け取りうる状態を作る（handleSigint で受信時の挙動を切り替える）。
 */
function writeSigintRaceFixtures(dir: string, handleSigint: boolean): void {
  for (let i = 0; i < 8; i++) {
    writeFileSync(
      resolve(dir, `svc${i}.ts`),
      handleSigint
        ? `process.on("SIGINT", () => process.exit(0));\nconsole.log("svc${i} up");\nsetInterval(() => {}, 1 << 30);\n`
        : `console.log("svc${i} up");\nsetInterval(() => {}, 1 << 30);\n`,
    );
  }
  const names = Array.from({ length: 8 }, (_, i) => `s${i}`);
  const declarations = names
    .map(
      (n, i) => `const ${n} = task.service("${n}", ["bun", ["svc${i}.ts"]]);`,
    )
    .join("\n");
  writeFileSync(
    resolve(dir, "Bakefile.ts"),
    `${declarations}\ntask.compose("dev", [${names.join(", ")}]);\n`,
  );
}

describeIfPosix(
  "task.service / task.compose 統合（buildPlan / executePlan）",
  () => {
    const tmp = useTempDir("overbake-compose-integration", { chdir: true });

    test("task.service 単体（コマンド run が exit 1）→ compose failed: <service> で reject する", async () => {
      writeFileSync(resolve(tmp.path, "fail.ts"), `process.exit(1);\n`);
      writeFileSync(
        resolve(tmp.path, "Bakefile.ts"),
        `task.service("svc", ["bun", ["fail.ts"]]);\n`,
      );

      const plan = await buildPlan("svc");

      await expect(executePlan(plan, { noColor: true })).rejects.toThrow(
        /compose failed: svc:.*exited with code 1/,
      );
    });

    test("起動順: db が ready になってから api が起動する", async () => {
      writeFileSync(
        resolve(tmp.path, "db.ts"),
        `import { writeFileSync } from "node:fs";
setTimeout(() => {
  writeFileSync("db-ready.txt", String(Date.now()));
  console.log("READY");
}, 200);
setInterval(() => {}, 1 << 30);
`,
      );
      writeFileSync(
        resolve(tmp.path, "api.ts"),
        `import { writeFileSync } from "node:fs";
writeFileSync("api-start.txt", String(Date.now()));
setInterval(() => {}, 1 << 30);
`,
      );
      writeFileSync(
        resolve(tmp.path, "Bakefile.ts"),
        `const db = task.service("db", { ready: { log: "READY", timeoutMs: 5000 } }, ["bun", ["db.ts"]]);
const api = task.service("api", ["bun", ["api.ts"]]);
task.compose("dev", db, api);
`,
      );

      const plan = await buildPlan("dev");
      const composePromise = executePlan(plan, { noColor: true });

      const apiStartFile = resolve(tmp.path, "api-start.txt");
      await waitUntil(() => existsSync(apiStartFile), 5000);

      const dbReadyAt = Number(readIfExists(resolve(tmp.path, "db-ready.txt")));
      const apiStartAt = Number(readIfExists(apiStartFile));
      expect(dbReadyAt).toBeGreaterThan(0);
      expect(apiStartAt).toBeGreaterThanOrEqual(dbReadyAt);

      process.emit("SIGINT", "SIGINT" as NodeJS.Signals);
      await composePromise; // throw しない
    });

    test("retry: 2 回目まで失敗し 3 回目で ready になる → SIGINT で正常終了する", async () => {
      writeFileSync(
        resolve(tmp.path, "retry.ts"),
        `import { existsSync, readFileSync, writeFileSync } from "node:fs";
const countFile = "retry-count.txt";
const count = existsSync(countFile) ? Number(readFileSync(countFile, "utf-8")) + 1 : 1;
writeFileSync(countFile, String(count));
if (count < 3) {
  process.exit(1);
}
console.log("UP");
setInterval(() => {}, 1 << 30);
`,
      );
      writeFileSync(
        resolve(tmp.path, "Bakefile.ts"),
        `task.service("svc", { retry: { attempts: 3, delayMs: 10 } }, ["bun", ["retry.ts"]]);\n`,
      );

      const plan = await buildPlan("svc");
      const runPromise = executePlan(plan, { noColor: true });

      const countFile = resolve(tmp.path, "retry-count.txt");
      await waitUntil(() => readIfExists(countFile) === "3", 5000);

      process.emit("SIGINT", "SIGINT" as NodeJS.Signals);
      await runPromise; // throw しない（retry を使い切る前に ready になったので成功扱い）
    });

    test("compose に通常タスクを渡すと実行時に検証エラーになる", async () => {
      writeFileSync(
        resolve(tmp.path, "Bakefile.ts"),
        `const plain = task("plain", () => {});
task.compose("dev", plain);
`,
      );

      const plan = await buildPlan("dev");

      await expect(executePlan(plan, { noColor: true })).rejects.toThrow(
        /compose 'dev':.*はサービスではありません/,
      );
    });
  },
);

describeIfPosix(
  "task.service / task.compose 統合（実プロセス spawn によるシグナル競合の回帰）",
  () => {
    const tmp = useTempDir("overbake-compose-integration-signals", {
      chdir: true,
    });

    test("Ctrl+C 競合の回帰: プロセスグループへの SIGINT で compose failed（exit 1）にならない（5 回連続）", async () => {
      writeSigintRaceFixtures(tmp.path, false);
      const upMarkers = Array.from({ length: 8 }, (_, i) => `svc${i} up`);

      for (let i = 0; i < 5; i++) {
        const { proc, output, exited } = spawnBake(tmp.path, ["dev"]);

        // 全サービスの起動行が出揃うまで待ってから、ループが落ち着く猶予を置いて
        // SIGINT を送る（起動直後は bake 自身のイベントループが起動処理で忙しく、
        // 競合が再現しない）。
        await waitUntil(
          () => upMarkers.every((m) => output().includes(m)),
          SIGINT_RACE_STARTUP_TIMEOUT_MS,
        );
        await new Promise((r) => setTimeout(r, SIGINT_RACE_SETTLE_MS));
        process.kill(-(proc.pid as number), "SIGINT");
        const { code } = await exited;

        expect(code).toBe(0);
        expect(output()).not.toContain("compose failed");
      }
    }, 60000);

    test("SIGINT をハンドルして exit 0 で即終了する子プロセスでも compose failed にならない（5 回連続）", async () => {
      writeSigintRaceFixtures(tmp.path, true);
      const upMarkers = Array.from({ length: 8 }, (_, i) => `svc${i} up`);

      for (let i = 0; i < 5; i++) {
        const { proc, output, exited } = spawnBake(tmp.path, ["dev"]);

        await waitUntil(
          () => upMarkers.every((m) => output().includes(m)),
          SIGINT_RACE_STARTUP_TIMEOUT_MS,
        );
        await new Promise((r) => setTimeout(r, SIGINT_RACE_SETTLE_MS));
        process.kill(-(proc.pid as number), "SIGINT");
        const { code } = await exited;

        expect(code).toBe(0);
        expect(output()).not.toContain("compose failed");
      }
    }, 60000);

    test("retry の早期終了の回帰: バックオフ待機中に exit 0 で終了せず、retry を使い切って exit 1 になる", async () => {
      writeFileSync(resolve(tmp.path, "always-fail.ts"), `process.exit(1);\n`);
      writeFileSync(
        resolve(tmp.path, "Bakefile.ts"),
        `task.service("svc", { retry: { attempts: 2, delayMs: 50 } }, ["bun", ["always-fail.ts"]]);\n`,
      );

      const { output, exited } = spawnBake(tmp.path, ["svc"]);
      const { code } = await exited;

      expect(code).toBe(1);
      expect(output()).toContain("(gave up after 2 retries)");
    }, 15000);

    test("ネスト compose: 内側の compose が外側の停止を受けて一定時間内に compose failed で reject する", async () => {
      writeFileSync(
        resolve(tmp.path, "innerA.ts"),
        `console.log("innerA up");\nsetInterval(() => {}, 1 << 30);\n`,
      );
      writeFileSync(
        resolve(tmp.path, "innerB.ts"),
        `console.log("innerB up");\nsetInterval(() => {}, 1 << 30);\n`,
      );
      writeFileSync(resolve(tmp.path, "fail.ts"), `process.exit(1);\n`);
      writeFileSync(
        resolve(tmp.path, "Bakefile.ts"),
        `const innerA = task.service("innerA", ["bun", ["innerA.ts"]]);
const innerB = task.service("innerB", ["bun", ["innerB.ts"]]);
const inner = task.compose("inner", innerA, innerB);
const wrapped = task.service("wrapped", inner);
const failer = task.service("failer", ["bun", ["fail.ts"]]);
task.compose("outer", [wrapped, failer]);
`,
      );

      const plan = await buildPlan("outer");

      // abortSignal が inner の compose まで伝わらないと、wrapped の attempt が
      // 終了を待ち続けてハングする（このタイムアウトそのものが回帰検知になる）
      await expect(executePlan(plan, { noColor: true })).rejects.toThrow(
        /compose failed/,
      );
    }, 15000);
  },
);
