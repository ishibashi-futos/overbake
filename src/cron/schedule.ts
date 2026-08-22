/**
 * cron スケジュール式のパースと「次回実行時刻」の算出。
 *
 * 純粋関数のみで構成し、実行系（runCron）とは分離する。
 * `parseSchedule` が唯一の検証点で、`bake doctor` の静的検証と実行時の両方から呼ばれる。
 */

/** 5 フィールド cron 形式のスケジュール */
export interface CronSchedule {
  kind: "cron";
  /** 元の式（エラーメッセージ・表示用） */
  source: string;
  minute: ReadonlySet<number>;
  hour: ReadonlySet<number>;
  dayOfMonth: ReadonlySet<number>;
  month: ReadonlySet<number>;
  dayOfWeek: ReadonlySet<number>;
  /** day-of-month が `*` 以外で制限されているか（dom/dow の OR 判定に使う） */
  domRestricted: boolean;
  /** day-of-week が `*` 以外で制限されているか */
  dowRestricted: boolean;
}

/** `@every 30s` 形式の固定間隔スケジュール */
export interface IntervalSchedule {
  kind: "interval";
  /** 元の式（エラーメッセージ・表示用） */
  source: string;
  ms: number;
}

export type Schedule = CronSchedule | IntervalSchedule;

export class InvalidScheduleError extends Error {
  constructor(spec: string, reason: string) {
    super(`Invalid cron schedule '${spec}': ${reason}`);
    this.name = "InvalidScheduleError";
  }
}

/** nextRun が候補日を探索する上限（日数）。これを超えたら「決してマッチしない式」と判断する */
const MAX_SEARCH_DAYS = 366 * 4;

/** `@every` で許容する最小間隔（ミリ秒） */
const MIN_INTERVAL_MS = 1000;

const ALIASES: Record<string, string> = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
};

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const UNIT_MS: Record<string, number | undefined> = {
  s: SECOND_MS,
  m: MINUTE_MS,
  h: HOUR_MS,
  d: DAY_MS,
};

interface FieldSpec {
  name: string;
  min: number;
  max: number;
}

const FIELDS: readonly FieldSpec[] = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day-of-month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "day-of-week", min: 0, max: 7 },
];

/**
 * 1 フィールド（`*` / `*\/n` / `a` / `a-b` / `a-b/n` とそのカンマ区切り）を値集合へ展開する。
 * `restricted` はそのフィールドが `*`（全域）以外で絞り込まれているかを示す。
 */
function parseField(spec: string, raw: string, field: FieldSpec): Set<number> {
  const values = new Set<number>();

  for (const part of raw.split(",")) {
    if (part === "") {
      throw new InvalidScheduleError(spec, `${field.name} が空です`);
    }

    const [rangePart, stepPart, ...rest] = part.split("/");
    if (rest.length > 0 || rangePart === undefined) {
      throw new InvalidScheduleError(
        spec,
        `${field.name} の指定 '${part}' が不正です`,
      );
    }

    let step = 1;
    if (stepPart !== undefined) {
      if (!/^\d+$/.test(stepPart) || Number(stepPart) === 0) {
        throw new InvalidScheduleError(
          spec,
          `${field.name} のステップ '${stepPart}' が不正です`,
        );
      }
      step = Number(stepPart);
    }

    let start: number;
    let end: number;
    if (rangePart === "*") {
      start = field.min;
      end = field.max;
    } else if (/^\d+$/.test(rangePart)) {
      start = Number(rangePart);
      end = stepPart === undefined ? start : field.max;
    } else {
      const match = /^(\d+)-(\d+)$/.exec(rangePart);
      if (!match) {
        throw new InvalidScheduleError(
          spec,
          `${field.name} の指定 '${part}' が不正です`,
        );
      }
      start = Number(match[1]);
      end = Number(match[2]);
    }

    if (start < field.min || end > field.max || start > end) {
      throw new InvalidScheduleError(
        spec,
        `${field.name} の範囲 '${rangePart}' が ${field.min}-${field.max} を外れています`,
      );
    }

    for (let v = start; v <= end; v += step) {
      values.add(v);
    }
  }

  if (values.size === 0) {
    throw new InvalidScheduleError(
      spec,
      `${field.name} にマッチする値がありません`,
    );
  }

  return values;
}

/**
 * day-of-month / day-of-week が「絞り込まれている」か判定する。
 * vixie cron と同じく **フィールドが `*` で始まるかどうか** だけで決める
 * （`*\/2` は `*` 始まりなので絞り込みとは見なさず、dom/dow の OR 判定に参加しない）。
 */
function isRestrictedField(raw: string): boolean {
  return !raw.startsWith("*");
}

/** `@every 30s` の期間指定をミリ秒へ変換する */
function parseInterval(spec: string, raw: string): IntervalSchedule {
  const match = /^(\d+)(s|m|h|d)$/.exec(raw.trim());
  if (!match) {
    throw new InvalidScheduleError(
      spec,
      "@every は '30s' / '5m' / '2h' / '1d' の形式で指定してください",
    );
  }
  const amount = Number(match[1]);
  const unit = UNIT_MS[match[2] as string] as number;
  const ms = amount * unit;
  if (ms < MIN_INTERVAL_MS) {
    throw new InvalidScheduleError(spec, "間隔は 1s 以上で指定してください");
  }
  return { kind: "interval", source: spec.trim(), ms };
}

/**
 * cron 式をパースする。
 *
 * 対応形式:
 * - 5 フィールド cron: `分 時 日 月 曜日`（`*`, `*\/n`, `a-b`, `a-b/n`, カンマ区切り）
 * - エイリアス: `@yearly` `@annually` `@monthly` `@weekly` `@daily` `@midnight` `@hourly`
 * - 固定間隔: `@every 30s` / `@every 5m` / `@every 2h` / `@every 1d`
 */
export function parseSchedule(spec: string): Schedule {
  const trimmed = spec.trim();
  if (trimmed === "") {
    throw new InvalidScheduleError(spec, "スケジュールが空です");
  }

  if (trimmed.startsWith("@every")) {
    return parseInterval(spec, trimmed.slice("@every".length));
  }

  const expanded = ALIASES[trimmed.toLowerCase()] ?? trimmed;
  if (expanded.startsWith("@")) {
    throw new InvalidScheduleError(spec, `未対応のエイリアスです`);
  }

  const parts = expanded.split(/\s+/);
  if (parts.length !== 5) {
    throw new InvalidScheduleError(
      spec,
      `5 フィールド（分 時 日 月 曜日）が必要ですが ${parts.length} 個でした`,
    );
  }

  const parsed = FIELDS.map((field, i) =>
    parseField(spec, parts[i] as string, field),
  ) as [Set<number>, Set<number>, Set<number>, Set<number>, Set<number>];
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parsed;

  // cron 慣習: 曜日の 7 は日曜（0）と同じ
  const dow = new Set(dayOfWeek);
  if (dow.has(7)) {
    dow.delete(7);
    dow.add(0);
  }

  return {
    kind: "cron",
    source: trimmed,
    minute,
    hour,
    dayOfMonth,
    month,
    dayOfWeek: dow,
    domRestricted: isRestrictedField(parts[2] as string),
    dowRestricted: isRestrictedField(parts[4] as string),
  };
}

/**
 * 日付が day-of-month / month / day-of-week にマッチするか判定する。
 * dom と dow の両方が制限されている場合は cron 慣習に従い OR で判定する。
 */
function matchesDate(schedule: CronSchedule, date: Date): boolean {
  if (!schedule.month.has(date.getMonth() + 1)) return false;

  const domMatch = schedule.dayOfMonth.has(date.getDate());
  const dowMatch = schedule.dayOfWeek.has(date.getDay());

  if (schedule.domRestricted && schedule.dowRestricted) {
    return domMatch || dowMatch;
  }
  if (schedule.domRestricted) return domMatch;
  if (schedule.dowRestricted) return dowMatch;
  return true;
}

/**
 * `from` より後の最初の実行時刻を返す（秒・ミリ秒は 0 に丸める）。
 * 日単位でスキップしながらマッチする日を探し、その日の中で時・分を走査する。
 */
export function nextRun(schedule: Schedule, from: Date): Date {
  if (schedule.kind === "interval") {
    return new Date(from.getTime() + schedule.ms);
  }

  // 秒以下を切り捨てて次の分から探索する（同一分の再発火を防ぐ）
  const cursor = new Date(from.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  let startHour = cursor.getHours();
  let startMinute = cursor.getMinutes();

  for (let day = 0; day < MAX_SEARCH_DAYS; day++) {
    if (matchesDate(schedule, cursor)) {
      for (let h = startHour; h <= 23; h++) {
        if (!schedule.hour.has(h)) continue;
        const minuteFrom = h === startHour ? startMinute : 0;
        for (let m = minuteFrom; m <= 59; m++) {
          if (!schedule.minute.has(m)) continue;
          const result = new Date(cursor.getTime());
          result.setHours(h, m, 0, 0);
          // DST の巻き戻しでは同じローカル時刻が 2 回現れ、setHours は必ず早い方
          // （移行前オフセット）へ解決するため from 以前になりうる。その候補は捨てる。
          if (result.getTime() <= from.getTime()) continue;
          return result;
        }
      }
    }
    // 翌日の 00:00 から探索を続ける
    cursor.setHours(0, 0, 0, 0);
    cursor.setDate(cursor.getDate() + 1);
    startHour = 0;
    startMinute = 0;
  }

  throw new InvalidScheduleError(
    schedule.source,
    `${MAX_SEARCH_DAYS} 日以内にマッチする日時がありません`,
  );
}

/** ログ表示用にスケジュールを短い文字列へ整形する */
export function describeSchedule(schedule: Schedule): string {
  return schedule.source;
}

/** ログ表示用の時刻整形（ローカル時刻、秒まで） */
export function formatTime(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}
