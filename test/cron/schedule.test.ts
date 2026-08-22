import { afterEach, describe, expect, test } from "bun:test";
import {
  InvalidScheduleError,
  nextRun,
  parseSchedule,
} from "../../src/cron/schedule.ts";

/** ローカル時刻で Date を組み立てる（cron はローカル時刻基準で判定する） */
function at(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): Date {
  return new Date(year, month - 1, day, hour, minute, second, 0);
}

describe("parseSchedule", () => {
  test("5 フィールドの cron 式をパースする", () => {
    const schedule = parseSchedule("*/15 9-17 * * 1-5");
    expect(schedule.kind).toBe("cron");
    if (schedule.kind !== "cron") return;
    expect([...schedule.minute]).toEqual([0, 15, 30, 45]);
    expect([...schedule.hour]).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect([...schedule.dayOfWeek]).toEqual([1, 2, 3, 4, 5]);
    expect(schedule.domRestricted).toBe(false);
    expect(schedule.dowRestricted).toBe(true);
  });

  test("カンマ区切りと単一値を展開する", () => {
    const schedule = parseSchedule("0,30 3 1 1,7 *");
    if (schedule.kind !== "cron") throw new Error("cron ではありません");
    expect([...schedule.minute]).toEqual([0, 30]);
    expect([...schedule.hour]).toEqual([3]);
    expect([...schedule.dayOfMonth]).toEqual([1]);
    expect([...schedule.month]).toEqual([1, 7]);
    expect(schedule.domRestricted).toBe(true);
  });

  test("曜日の 7 は日曜（0）へ正規化される", () => {
    const schedule = parseSchedule("0 0 * * 7");
    if (schedule.kind !== "cron") throw new Error("cron ではありません");
    expect([...schedule.dayOfWeek]).toEqual([0]);
  });

  test.each([
    ["@hourly", [0], undefined],
    ["@daily", [0], [0]],
    ["@midnight", [0], [0]],
  ] as const)("エイリアス %s を展開する", (spec, minutes, hours) => {
    const schedule = parseSchedule(spec);
    if (schedule.kind !== "cron") throw new Error("cron ではありません");
    expect([...schedule.minute]).toEqual([...minutes]);
    if (hours) expect([...schedule.hour]).toEqual([...hours]);
  });

  test.each([
    ["@every 30s", 30_000],
    ["@every 5m", 300_000],
    ["@every 2h", 7_200_000],
    ["@every 1d", 86_400_000],
  ])("@every %s を間隔スケジュールとして解釈する", (spec, ms) => {
    const schedule = parseSchedule(spec);
    expect(schedule.kind).toBe("interval");
    if (schedule.kind !== "interval") return;
    expect(schedule.ms).toBe(ms);
  });

  test.each([
    [""],
    ["* * *"],
    ["* * * * * *"],
    ["60 * * * *"],
    ["* 24 * * *"],
    ["* * 0 * *"],
    ["* * * 13 *"],
    ["* * * * 8"],
    ["5-1 * * * *"],
    ["*/0 * * * *"],
    ["abc * * * *"],
    ["@every"],
    ["@every 0s"],
    ["@every 10"],
    ["@unknown"],
  ])("不正な式 '%s' は InvalidScheduleError", (spec) => {
    expect(() => parseSchedule(spec)).toThrow(InvalidScheduleError);
  });
});

describe("nextRun", () => {
  test("毎分スケジュールは次の分を返す（秒は切り捨て）", () => {
    const schedule = parseSchedule("* * * * *");
    expect(nextRun(schedule, at(2026, 8, 21, 10, 30, 42))).toEqual(
      at(2026, 8, 21, 10, 31),
    );
  });

  test("ちょうどの時刻でも「次」を返す（同一分での再発火を防ぐ）", () => {
    const schedule = parseSchedule("0 * * * *");
    expect(nextRun(schedule, at(2026, 8, 21, 10, 0, 0))).toEqual(
      at(2026, 8, 21, 11, 0),
    );
  });

  test("時刻指定は当日の該当時刻、過ぎていれば翌日", () => {
    const schedule = parseSchedule("30 3 * * *");
    expect(nextRun(schedule, at(2026, 8, 21, 1, 0))).toEqual(
      at(2026, 8, 21, 3, 30),
    );
    expect(nextRun(schedule, at(2026, 8, 21, 4, 0))).toEqual(
      at(2026, 8, 22, 3, 30),
    );
  });

  test("曜日指定は次に該当する曜日へ進む", () => {
    // 2026-08-21 は金曜日
    const schedule = parseSchedule("0 9 * * 1");
    expect(nextRun(schedule, at(2026, 8, 21, 12, 0))).toEqual(
      at(2026, 8, 24, 9, 0),
    );
  });

  test("月をまたいで進む", () => {
    const schedule = parseSchedule("0 0 1 * *");
    expect(nextRun(schedule, at(2026, 8, 21, 12, 0))).toEqual(
      at(2026, 9, 1, 0, 0),
    );
  });

  test("年をまたいで進む", () => {
    const schedule = parseSchedule("0 0 1 1 *");
    expect(nextRun(schedule, at(2026, 8, 21, 12, 0))).toEqual(
      at(2027, 1, 1, 0, 0),
    );
  });

  test("うるう日も候補になる", () => {
    const schedule = parseSchedule("0 0 29 2 *");
    expect(nextRun(schedule, at(2026, 8, 21, 12, 0))).toEqual(
      at(2028, 2, 29, 0, 0),
    );
  });

  test("dom と dow の両方指定は OR で判定する（cron 慣習）", () => {
    // 毎月 1 日 または 月曜日。2026-08-21(金) の次は 8/24(月)
    const schedule = parseSchedule("0 0 1 * 1");
    expect(nextRun(schedule, at(2026, 8, 21, 12, 0))).toEqual(
      at(2026, 8, 24, 0, 0),
    );
  });

  test("interval スケジュールは現在時刻に間隔を足す", () => {
    const schedule = parseSchedule("@every 30s");
    expect(nextRun(schedule, at(2026, 8, 21, 10, 30, 42))).toEqual(
      new Date(at(2026, 8, 21, 10, 30, 42).getTime() + 30_000),
    );
  });

  test("決してマッチしない式は InvalidScheduleError", () => {
    // 2 月 30 日は存在しない
    const schedule = parseSchedule("0 0 30 2 *");
    expect(() => nextRun(schedule, at(2026, 8, 21))).toThrow(
      InvalidScheduleError,
    );
  });
});

// DST（夏時間）の境界。Bun は実行中の process.env.TZ 変更を反映するため、
// テストごとにタイムゾーンを切り替えて検証する。
describe("nextRun と DST", () => {
  const original = process.env.TZ;

  afterEach(() => {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });

  /**
   * 秋の巻き戻しでは同じローカル時刻が 2 回現れ、Date#setHours は必ず早い方
   * （移行前オフセット）へ解決する。ここでガードが無いと nextRun が過去を返し、
   * runCron が待機せずに再実行し続けてしまう。
   */
  test.each([
    ["50 1 * * *", "2026-11-01T06:10:00Z"],
    ["*/5 * * * *", "2026-11-01T06:03:00Z"],
    ["*/15 * * * *", "2026-11-01T06:03:00Z"],
    ["0 * * * *", "2026-11-01T05:30:00Z"],
  ])("秋の巻き戻し中でも %s は from より後を返す", (spec, from) => {
    process.env.TZ = "America/New_York";
    const start = new Date(from);

    const next = nextRun(parseSchedule(spec), start);

    expect(next.getTime()).toBeGreaterThan(start.getTime());
  });

  test("春の進み（存在しない時刻）でも from より後を返す", () => {
    process.env.TZ = "America/New_York";
    // 2026-03-08 の 02:00-02:59 EST は存在しない
    const start = new Date("2026-03-08T06:30:00Z");

    const next = nextRun(parseSchedule("30 2 * * *"), start);

    expect(next.getTime()).toBeGreaterThan(start.getTime());
  });
});

describe("dom / dow の絞り込み判定（vixie cron 準拠）", () => {
  test("`*/n` は `*` 始まりなので絞り込みと見なさない", () => {
    const schedule = parseSchedule("0 0 */2 * 1");
    if (schedule.kind !== "cron") throw new Error("cron ではありません");
    expect(schedule.domRestricted).toBe(false);
    expect(schedule.dowRestricted).toBe(true);
  });

  test("`*` 始まりでない指定は絞り込みと見なす", () => {
    const schedule = parseSchedule("0 0 1,15 * 1-5");
    if (schedule.kind !== "cron") throw new Error("cron ではありません");
    expect(schedule.domRestricted).toBe(true);
    expect(schedule.dowRestricted).toBe(true);
  });

  test("dom が `*/n` なら dow との OR ではなく AND 相当（dow だけで絞る）になる", () => {
    // 毎月 1,3,5... 日ではなく「月曜日のみ」。2026-08-21(金) の次は 8/24(月)
    const schedule = parseSchedule("0 0 */2 * 1");
    expect(nextRun(schedule, at(2026, 8, 21, 12, 0))).toEqual(
      at(2026, 8, 24, 0, 0),
    );
  });
});
