import { afterEach, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { stopDaemon } from "../../src/daemon/control.ts";
import { logFile } from "../../src/daemon/paths.ts";
import {
  createRecord,
  isAlive,
  listRecords,
  readRecord,
  writeRecord,
} from "../../src/daemon/state.ts";
import { describeIfPosix, useTempDir, waitUntil } from "../support/sandbox.ts";

const CLI = resolve(import.meta.dir, "../../src/cli/main.ts");
const TIMEOUT_MS = 30_000;

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function runCli(
  cwd: string,
  args: string[],
  env: Record<string, string> = {},
): Promise<CliResult> {
  const proc = Bun.spawn(["bun", CLI, ...args], {
    cwd,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

function writeFixtures(dir: string): void {
  writeFileSync(
    resolve(dir, "Bakefile.ts"),
    `task("serve", async ({ cmd }) => {
  await cmd("bun", ["forever.ts"]);
});
`,
  );
  // 孫プロセス。自分の PID をファイルへ書き出し、プロセスグループ停止の検証に使う
  writeFileSync(
    resolve(dir, "forever.ts"),
    `import { writeFileSync } from "node:fs";
writeFileSync("child.pid", String(process.pid));
console.log("serving");
setInterval(() => {}, 1 << 30);
`,
  );
}

/** compose 用の fixture: 2 サービスがそれぞれ PID ファイルを書いて常駐する（task.service で包む） */
function writeComposeFixtures(dir: string): void {
  writeFileSync(
    resolve(dir, "Bakefile.ts"),
    `const a = task.service("svc-a", async ({ cmd }) => {
  await cmd("bun", ["svc.ts"], { env: { SVC_NAME: "a" } });
});
const b = task.service("svc-b", async ({ cmd }) => {
  await cmd("bun", ["svc.ts"], { env: { SVC_NAME: "b" } });
});
task.compose("dev", a, b);
`,
  );
  writeFileSync(
    resolve(dir, "svc.ts"),
    `import { writeFileSync } from "node:fs";
const name = process.env.SVC_NAME;
writeFileSync(\`\${name}.pid\`, String(process.pid));
console.log(\`\${name} up\`);
setInterval(() => {}, 1 << 30);
`,
  );
}

/** cron 用の fixture: 1 秒ごとに 1 工程を実行する定期タスク */
function writeCronFixtures(dir: string): void {
  writeFileSync(
    resolve(dir, "Bakefile.ts"),
    `const tick = task("tick", async ({ cmd }) => {
  await cmd("bun", ["tick.ts"]);
});
task.cron("ticker", { schedule: "@every 1s" }, tick);
`,
  );
  writeFileSync(
    resolve(dir, "tick.ts"),
    `import { appendFileSync } from "node:fs";
appendFileSync("ticks.log", "tick\\n");
`,
  );
}

/** ログを高速に吐き続けるサービス（ローテーション検証用） */
function writeChattyFixtures(dir: string): void {
  writeFileSync(
    resolve(dir, "Bakefile.ts"),
    `task("chatty", async ({ cmd }) => {
  await cmd("bun", ["chatty.ts"]);
});
`,
  );
  writeFileSync(
    resolve(dir, "chatty.ts"),
    `const line = "L".repeat(200);
setInterval(() => { console.log(line); }, 5);
`,
  );
}

describeIfPosix("daemon 統合", () => {
  // 後片付けの afterEach は useTempDir より前に登録する。
  // bun:test の afterEach は登録順に実行される（先に登録したものが先に走る）ため、
  // 後に登録した useTempDir の afterEach（一時ディレクトリの rmSync。
  // .overbake/daemons の状態ファイルもここで消える）が先に走ると、テストが途中で
  // 失敗した際にここで常駐プロセスの状態ファイルを見つけられず、後片付けが効かなく
  // なる。このコールバック自体が呼ばれるのはテスト実行後（下の tmp 宣言より後）
  // なので、宣言前に書いても tmp.path を安全に参照できる。
  afterEach(async () => {
    for (const record of listRecords(tmp.path)) {
      try {
        process.kill(-record.pid, "SIGKILL");
      } catch {
        // 既に停止している
      }
    }
  });

  const tmp = useTempDir("overbake-daemon-int");

  test(
    "-d で起動 → ログ出力 → ps に載る → stop で孫プロセスごと停止する",
    async () => {
      writeFixtures(tmp.path);

      const start = await runCli(tmp.path, ["-d", "serve"]);
      expect(start.stderr).toBe("");
      expect(start.code).toBe(0);
      expect(start.stdout).toContain("Started daemon 'serve'");

      const record = readRecord(tmp.path, "serve");
      expect(record).not.toBeNull();
      if (!record) return;
      expect(isAlive(record.pid)).toBe(true);

      // ログにタスクの出力が流れてくる
      const log = logFile(tmp.path, "serve");
      await waitUntil(
        () => existsSync(log) && readFileSync(log, "utf-8").includes("serving"),
        15000,
      );
      expect(readFileSync(log, "utf-8")).toContain("=== serve started at");

      // 孫プロセス（ctx.cmd が起動した bun forever.ts）の PID
      const childPidFile = resolve(tmp.path, "child.pid");
      await waitUntil(() => existsSync(childPidFile), 15000);
      const grandchildPid = Number(readFileSync(childPidFile, "utf-8"));
      expect(isAlive(grandchildPid)).toBe(true);

      const ps = await runCli(tmp.path, ["ps"]);
      expect(ps.code).toBe(0);
      expect(ps.stdout).toContain("serve");
      expect(ps.stdout).toContain(String(record.pid));

      const logs = await runCli(tmp.path, ["logs", "serve", "-n", "5"]);
      expect(logs.code).toBe(0);
      expect(logs.stdout).toContain("serving");

      const stop = await runCli(tmp.path, ["stop", "serve"]);
      expect(stop.code).toBe(0);
      expect(stop.stdout).toContain("Stopped daemon 'serve'");

      // デーモン本体と孫プロセスの両方が停止している（プロセスグループへの SIGTERM）
      await waitUntil(() => !isAlive(record.pid), 15000);
      await waitUntil(() => !isAlive(grandchildPid), 15000);
      expect(readRecord(tmp.path, "serve")).toBeNull();
    },
    TIMEOUT_MS,
  );

  test(
    "同名デーモンの二重起動は exit 2 で拒否する",
    async () => {
      writeFixtures(tmp.path);

      const first = await runCli(tmp.path, ["-d", "serve"]);
      expect(first.code).toBe(0);
      await waitUntil(() => readRecord(tmp.path, "serve") !== null, 15000);

      const second = await runCli(tmp.path, ["-d", "serve"]);
      expect(second.code).toBe(2);
      expect(second.stderr).toContain("既に起動しています");

      await runCli(tmp.path, ["stop", "serve"]);
    },
    TIMEOUT_MS,
  );

  test(
    "存在しないタスクの -d は前景で設定エラーになる（デーモンを残さない）",
    async () => {
      writeFixtures(tmp.path);

      const result = await runCli(tmp.path, ["-d", "nope"]);

      expect(result.code).toBe(2);
      expect(listRecords(tmp.path)).toEqual([]);
    },
    TIMEOUT_MS,
  );

  test(
    "-d と task.compose で複数サービスをまとめてデーモン化し、stop で全て停止する",
    async () => {
      writeComposeFixtures(tmp.path);

      const start = await runCli(tmp.path, ["-d", "dev"]);
      expect(start.code).toBe(0);
      expect(start.stdout).toContain("Started daemon 'dev'");

      const record = readRecord(tmp.path, "dev");
      expect(record).not.toBeNull();
      if (!record) return;

      // 両サービスの出力が prefix 付きで 1 つのログへ流れる
      const log = logFile(tmp.path, "dev");
      const readLog = (): string =>
        existsSync(log) ? readFileSync(log, "utf-8") : "";
      await waitUntil(
        () => readLog().includes("a up") && readLog().includes("b up"),
        15000,
      );
      expect(readLog()).toContain("[svc-a]");
      expect(readLog()).toContain("[svc-b]");

      const pids = ["a", "b"].map((name) =>
        Number(readFileSync(resolve(tmp.path, `${name}.pid`), "utf-8")),
      );
      for (const pid of pids) expect(isAlive(pid)).toBe(true);

      const stop = await runCli(tmp.path, ["stop", "--all"]);
      expect(stop.code).toBe(0);
      expect(stop.stdout).toContain("dev");

      await waitUntil(() => !isAlive(record.pid), 15000);
      for (const pid of pids) {
        await waitUntil(() => !isAlive(pid), 15000);
      }
    },
    TIMEOUT_MS,
  );

  test(
    "cron タスクを -d でデーモン化すると定期実行が続き、stop で止まる",
    async () => {
      writeCronFixtures(tmp.path);

      const start = await runCli(tmp.path, ["-d", "ticker"]);
      expect(start.code).toBe(0);

      const record = readRecord(tmp.path, "ticker");
      expect(record).not.toBeNull();
      if (!record) return;

      const log = logFile(tmp.path, "ticker");
      const ticksFile = resolve(tmp.path, "ticks.log");
      const countTicks = (): number =>
        existsSync(ticksFile)
          ? readFileSync(ticksFile, "utf-8").trim().split("\n").length
          : 0;

      // 2 回以上発火することを確認（スケジューラが継続している）
      await waitUntil(() => countTicks() >= 2, 15000);
      const logText = readFileSync(log, "utf-8");
      expect(logText).toContain("schedule: @every 1s");
      expect(logText).toContain("next run at");

      const stop = await runCli(tmp.path, ["stop", "ticker"]);
      expect(stop.code).toBe(0);
      await waitUntil(() => !isAlive(record.pid), 15000);

      // 停止後は発火が増えない
      const afterStop = countTicks();
      await new Promise((r) => setTimeout(r, 1500));
      expect(countTicks()).toBe(afterStop);
    },
    TIMEOUT_MS,
  );

  test(
    "常駐中にログが上限を超えると世代退避され、ログ出力は継続する",
    async () => {
      writeChattyFixtures(tmp.path);

      // 子プロセスへ環境変数が伝わることも同時に確認する（上限 4KB / 2 世代 / 100ms 間隔）
      const start = await runCli(tmp.path, ["-d", "chatty"], {
        OVERBAKE_LOG_MAX_BYTES: "4096",
        OVERBAKE_LOG_KEEP: "2",
        OVERBAKE_LOG_CHECK_MS: "100",
      });
      expect(start.code).toBe(0);

      const record = readRecord(tmp.path, "chatty");
      expect(record).not.toBeNull();
      if (!record) return;

      const log = logFile(tmp.path, "chatty");
      const rotated = `${log}.1`;

      // 退避ファイルができる
      await waitUntil(() => existsSync(rotated), 15000);
      expect(readFileSync(rotated, "utf-8")).toContain("LLLL");

      // 退避後も live なログに書き込みが続く（fd を握ったままでも書き込み位置が壊れない）
      const marker = "=== rotated at";
      await waitUntil(() => {
        const text = readFileSync(log, "utf-8");
        const afterMarker = text.slice(
          text.lastIndexOf(marker) + marker.length,
        );
        return afterMarker.includes("LLLL");
      }, 15000);

      // 切り詰めた直後のログに NUL 埋め（スパースホール）が残らない
      expect(readFileSync(log, "utf-8")).not.toContain("\u0000");

      // 上限 + 1 回分の書き込み余地を大きく超えて肥大化しない
      const stop = await runCli(tmp.path, ["stop", "chatty"]);
      expect(stop.code).toBe(0);
      await waitUntil(() => !isAlive(record.pid), 15000);

      // 3 世代目は keep=2 のため作られない
      expect(existsSync(`${log}.3`)).toBe(false);
    },
    TIMEOUT_MS,
  );

  test(
    "リーダーが先に死んでいても stop がプロセスグループごと停止する",
    async () => {
      // リーダーが即 exit し、同じプロセスグループに孫プロセスだけが残る状況を作る
      writeFileSync(
        resolve(tmp.path, "leader.ts"),
        `import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const child = spawn("bun", ["orphan.ts"], { stdio: "ignore" });
writeFileSync("leader.pid", String(process.pid));
setTimeout(() => process.exit(0), 200);
`,
      );
      writeFileSync(
        resolve(tmp.path, "orphan.ts"),
        `import { writeFileSync } from "node:fs";
writeFileSync("orphan.pid", String(process.pid));
setInterval(() => {}, 1 << 30);
`,
      );

      // bake のデーモンと同じ条件（detached = プロセスグループのリーダー）で起動する
      const leader = spawn("bun", ["leader.ts"], {
        cwd: tmp.path,
        stdio: "ignore",
        detached: true,
      });
      leader.unref();
      await waitUntil(() => existsSync(resolve(tmp.path, "orphan.pid")), 15000);
      const orphanPid = Number(
        readFileSync(resolve(tmp.path, "orphan.pid"), "utf-8"),
      );
      const leaderPid = leader.pid as number;

      // リーダーの終了を待ってから、その PID の状態ファイルを置いて stop させる
      await waitUntil(() => !isAlive(leaderPid), 15000);
      writeRecord(
        tmp.path,
        createRecord({
          root: tmp.path,
          name: "leaky",
          pid: leaderPid,
          command: ["bun", "leader.ts"],
          cwd: tmp.path,
          startedAt: new Date(),
        }),
      );

      const result = await stopDaemon(tmp.path, "leaky");

      expect(result.status).toBe("not-running");
      // リーダーが死んでいても残った孫プロセスは停止される
      await waitUntil(() => !isAlive(orphanPid), 15000);
      expect(readRecord(tmp.path, "leaky")).toBeNull();
    },
    TIMEOUT_MS,
  );

  test(
    "bake logs -f がデーモンの追記をリアルタイムに流す",
    async () => {
      writeFixtures(tmp.path);

      const start = await runCli(tmp.path, ["-d", "serve"]);
      expect(start.code).toBe(0);
      const record = readRecord(tmp.path, "serve");
      if (!record) throw new Error("デーモンが起動していません");

      await waitUntil(
        () =>
          existsSync(logFile(tmp.path, "serve")) &&
          readFileSync(logFile(tmp.path, "serve"), "utf-8").includes("serving"),
        15000,
      );

      // follow を起動してから、デーモンのログへ新しい行が追記されるのを待つ
      const follow = Bun.spawn(["bun", CLI, "logs", "serve", "-f", "-n", "1"], {
        cwd: tmp.path,
        stdout: "pipe",
        stderr: "ignore",
      });

      const chunks: string[] = [];
      const reader = (async () => {
        for await (const chunk of follow.stdout) {
          chunks.push(new TextDecoder().decode(chunk));
        }
      })();

      // follow 開始後に追記された行が流れてくること
      await waitUntil(() => chunks.length > 0, 5000);
      appendFileSync(logFile(tmp.path, "serve"), "APPENDED-AFTER-FOLLOW\n");
      try {
        await waitUntil(
          () => chunks.join("").includes("APPENDED-AFTER-FOLLOW"),
          8000,
        );
      } finally {
        follow.kill();
        await reader.catch(() => undefined);
        await runCli(tmp.path, ["stop", "serve"]);
      }
    },
    TIMEOUT_MS,
  );

  test(
    "停止済みタスクの stop / ログの無い logs は分かるメッセージを返す",
    async () => {
      writeFixtures(tmp.path);

      const stop = await runCli(tmp.path, ["stop", "serve"]);
      expect(stop.code).toBe(0);
      expect(stop.stdout).toContain("起動していません");

      const logs = await runCli(tmp.path, ["logs", "serve"]);
      expect(logs.code).toBe(2);
      expect(logs.stderr).toContain("ログがありません");
    },
    TIMEOUT_MS,
  );
});
