import {
  backoffDelay,
  type ComposeService,
  describePattern,
  matchesPattern,
  type ResolvedServiceConfig,
} from "../service/config.ts";
import { createTaskContext } from "./context.ts";

/**
 * task.service の監督ループが停止して、サービスの生存期間全体で見て失敗が確定したときに
 * handle.done を reject するエラー。service 名・失敗理由・使い切った retry 回数を保持する。
 */
export class ServiceFailedError extends Error {
  readonly service: string;
  readonly reason: string;
  readonly retries: number;

  constructor(service: string, reason: string, retries: number) {
    super(
      `${service}: ${reason}${retries > 0 ? ` (gave up after ${retries} retries)` : ""}`,
    );
    this.name = "ServiceFailedError";
    this.service = service;
    this.reason = reason;
    this.retries = retries;
  }
}

export interface SuperviseDeps {
  root: string;
  cwd: string;
  /** 出力の 1 行（改行なし）。prefix の付与は呼び出し側（compose）が行う */
  writeLine: (line: string) => void;
  /** SIGTERM → SIGKILL までの猶予（ミリ秒） */
  graceMs: number;
  /** バックオフ・ready 待ちの待機。abort で即座に解決すること */
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  /** ready.port probe の TCP 接続確認 */
  connect: (port: number, host: string, timeoutMs: number) => Promise<boolean>;
  /**
   * attempt の失敗を確定する前に置く猶予（ミリ秒）。0 なら待機せず即座に確定する。
   * FAILURE_SETTLE_MS を参照。
   */
  settleMs: number;
}

/**
 * attempt が「失敗」で settle してから、それを確定（"failed:" 出力・retry/ServiceFailedError）
 * するまでに置く既定の猶予（ミリ秒）。
 *
 * Ctrl+C や `bake stop` はプロセスグループ全体へ SIGINT/SIGTERM を送るため、サービスの子プロセスは
 * bake 自身のシグナルハンドラ（compose の onSignal → handle.stop()）より先に、あるいはそれと競合する
 * タイミングで終了しうる。その終了が監督ループに「失敗」として先に届いてしまうと、実際には正常な
 * 停止要求なのに retry / ServiceFailedError へ進み、compose failed（exit 1）になってしまう。
 * この猶予の間に停止要求（handle.stop）が届けば、その失敗は確定させず正常終了として扱う。
 */
export const FAILURE_SETTLE_MS = 100;

export interface ServiceHandle {
  /** 初回 ready で resolve する。reject はしない */
  ready: Promise<void>;
  /** 停止要求で resolve、retry を使い切ったら ServiceFailedError で reject */
  done: Promise<void>;
  /** 停止要求。現在の attempt を止めて再起動しない */
  stop(): void;
}

/** SuperviseDeps.sleep の既定実装。abort されたら即座に解決する */
export function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    // unref しない: バックオフ・猶予待機の間は子プロセスが存在せず、この timer だけが
    // イベントループを ref している。unref すると（process.on("SIGINT") 自体はループを
    // 維持しないため）待機中に Bun プロセスがそのまま exit 0 で終了してしまう
    // （retry のバックオフ待機中に見えたバグ）。abort されれば clearTimeout で確実に片付く。
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** 出力の chunk を改行で行に分割し、完成した行だけ通知するバッファ */
function createLineSplitter(onLine: (line: string) => void): {
  push: (text: string) => void;
  flush: () => void;
} {
  let buffer = "";
  return {
    push(text: string): void {
      buffer += text;
      let idx = buffer.indexOf("\n");
      while (idx !== -1) {
        onLine(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 1);
        idx = buffer.indexOf("\n");
      }
    },
    flush(): void {
      if (buffer.length > 0) {
        onLine(buffer);
        buffer = "";
      }
    },
  };
}

async function safeCheck(
  check: () => boolean | Promise<boolean>,
): Promise<boolean> {
  try {
    return await check();
  } catch {
    return false;
  }
}

async function safeConnect(
  connect: SuperviseDeps["connect"],
  port: number,
  host: string,
  timeoutMs: number,
): Promise<boolean> {
  try {
    return await connect(port, host, timeoutMs);
  } catch {
    return false;
  }
}

/**
 * ready probe を監視する。log は handleLine 側で検出するため、ここではタイムアウトのみ監視する。
 * port / check はここで intervalMs ごとにポーリングし、タイムアウトも合わせて監視する。
 * ready 到達・失敗確定のいずれかが先に起きたら、以降の判定は isReady/isSettled で無害化される。
 */
async function watchReady(
  ready: NonNullable<ResolvedServiceConfig["ready"]>,
  deps: SuperviseDeps,
  signal: AbortSignal,
  hooks: {
    markReady: () => void;
    fail: (reason: string) => void;
    isReady: () => boolean;
    isSettled: () => boolean;
  },
): Promise<void> {
  const { probe, timeoutMs, intervalMs } = ready;

  void deps.sleep(timeoutMs, signal).then(() => {
    if (!hooks.isReady() && !hooks.isSettled()) {
      hooks.fail(`ready timeout after ${timeoutMs}ms`);
    }
  });

  if (probe.kind === "log") return;

  while (!hooks.isReady() && !hooks.isSettled() && !signal.aborted) {
    const ok =
      probe.kind === "port"
        ? await safeConnect(deps.connect, probe.port, probe.host, intervalMs)
        : await safeCheck(probe.check);

    if (ok) {
      hooks.markReady();
      return;
    }
    if (hooks.isReady() || hooks.isSettled() || signal.aborted) return;
    await deps.sleep(intervalMs, signal);
  }
}

type AttemptOutcome = { kind: "failed"; reason: string } | { kind: "stopped" };

interface Attempt {
  attemptAbort: AbortController;
  settled: Promise<AttemptOutcome>;
  settle: (outcome: AttemptOutcome) => void;
  runDone: Promise<void>;
  flush: () => void;
}

/**
 * 1 attempt（1 回の起動〜終了）をセットアップする。
 * 呼び出し側（superviseService）は `settled` を待ってから `attemptAbort` を abort し、
 * `runDone` を待って完全にプロセスが終わるのを確認する。
 */
function startAttempt(
  cs: ComposeService,
  deps: SuperviseDeps,
  onReady: () => void,
): Attempt {
  const config = cs.config;
  const attemptAbort = new AbortController();

  let outcome: AttemptOutcome | null = null;
  let resolveSettled!: (outcome: AttemptOutcome) => void;
  const settled = new Promise<AttemptOutcome>((resolve) => {
    resolveSettled = resolve;
  });
  const settle = (next: AttemptOutcome): void => {
    if (outcome) return;
    outcome = next;
    resolveSettled(next);
  };
  const fail = (reason: string): void => settle({ kind: "failed", reason });

  let readyAlready = false;
  const markReady = (): void => {
    // すでに failed/stopped で settle 済みの attempt を後から ready にしない。
    // ready 検出（行バッファの flush や port/check ポーリング）は attempt 終了後にも
    // 非同期に届きうるため、呼び出し側の判定に頼らずここで一元的にガードする。
    if (readyAlready || outcome) return;
    readyAlready = true;
    onReady();
    if (config.ready !== null) deps.writeLine("ready");
  };

  const splitter = createLineSplitter((line) => {
    if (config.failOn && matchesPattern(config.failOn, line)) {
      deps.writeLine(line);
      fail(`matched failOn ${describePattern(config.failOn)}: ${line}`);
      return;
    }
    if (
      !readyAlready &&
      config.ready !== null &&
      config.ready.probe.kind === "log" &&
      matchesPattern(config.ready.probe.pattern, line)
    ) {
      deps.writeLine(line);
      markReady();
      return;
    }
    deps.writeLine(line);
  });

  const ctx = createTaskContext({
    name: cs.task.name,
    root: deps.root,
    cwd: deps.cwd,
    onOutput: splitter.push,
    abortSignal: attemptAbort.signal,
    killGraceMs: deps.graceMs,
  });

  const runDone: Promise<void> = Promise.resolve()
    .then(() => cs.service.run(ctx))
    .then(
      () => fail("exited unexpectedly"),
      (error: unknown) =>
        fail(error instanceof Error ? error.message : String(error)),
    );

  if (config.ready === null) {
    markReady();
  } else {
    void watchReady(config.ready, deps, attemptAbort.signal, {
      markReady,
      fail,
      isReady: () => readyAlready,
      isSettled: () => outcome !== null,
    });
  }

  return { attemptAbort, settled, settle, runDone, flush: splitter.flush };
}

/** 1 サービスの監督ループ: 起動 → ready 判定 → 失敗検知 → 停止 → バックオフ → 再起動 */
export function superviseService(
  cs: ComposeService,
  deps: SuperviseDeps,
): ServiceHandle {
  const name = cs.task.name;
  const config = cs.config;

  let resolveReady!: () => void;
  const readyPromise = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  let readyResolved = false;
  const onReadyOnce = (): void => {
    if (readyResolved) return;
    readyResolved = true;
    resolveReady();
  };

  let stopRequested = false;
  const stopAbort = new AbortController();
  let currentSettle: ((outcome: AttemptOutcome) => void) | undefined;

  const stop = (): void => {
    if (stopRequested) return;
    stopRequested = true;
    stopAbort.abort();
    currentSettle?.({ kind: "stopped" });
  };

  const done = (async (): Promise<void> => {
    let retries = 0;

    for (;;) {
      if (stopRequested) return;

      const attempt = startAttempt(cs, deps, onReadyOnce);
      currentSettle = attempt.settle;
      const outcome = await attempt.settled;
      currentSettle = undefined;

      if (!attempt.attemptAbort.signal.aborted) attempt.attemptAbort.abort();
      await attempt.runDone;
      attempt.flush();

      if (outcome.kind === "stopped" || stopRequested) return;

      // ここまでは outcome.kind === "failed"。プロセスグループへのシグナルで子の終了が
      // bake 自身のシグナルハンドラより先に届く競合を吸収するため、失敗を確定する前に
      // 短い猶予を置く。猶予中に停止要求が来たら「failed:」行も出さず正常終了する。
      if (deps.settleMs > 0) {
        await deps.sleep(deps.settleMs, stopAbort.signal);
      }
      if (stopRequested) return;

      deps.writeLine(`failed: ${outcome.reason}`);

      if (retries < config.retry.attempts) {
        retries += 1;
        const delay = backoffDelay(config.retry, retries);
        deps.writeLine(
          `retrying in ${delay}ms (${retries}/${config.retry.attempts})`,
        );
        await deps.sleep(delay, stopAbort.signal);
        if (stopRequested) return;
        continue;
      }

      throw new ServiceFailedError(name, outcome.reason, retries);
    }
  })();

  return { ready: readyPromise, done, stop };
}
