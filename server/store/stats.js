'use strict';
/**
 * 통계용 날짜 계산 (순수 함수). STATS_TZ(기본 Asia/Seoul) 기준 0시에 날이 바뀌고, 주는 월요일에 시작한다.
 * 메모리 저장소의 집계와 Supabase SQL 함수(supabase/schema.sql)가 같은 규칙을 쓴다.
 *  - 세션은 started_at 이 속한 날짜로 집계한다.
 *  - 출석 스트릭: 오늘 출석했으면 오늘부터, 아니면 어제부터 거슬러 센 연속 일수 (하루가 지나기 전엔 끊기지 않는다).
 */
const DEFAULT_TZ = 'Asia/Seoul';
const DAY_MS = 24 * 60 * 60 * 1000;

const fmtCache = new Map();

function formatter(tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    } catch (_) {
      f = new Intl.DateTimeFormat('en-CA', { timeZone: DEFAULT_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
    }
    fmtCache.set(tz, f);
  }
  return f;
}

function isValidTz(tz) {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return true;
  } catch (_) {
    return false;
  }
}

/** ms 타임스탬프 → 해당 시간대의 'YYYY-MM-DD' */
function dateKey(ts, tz = DEFAULT_TZ) {
  return formatter(tz).format(new Date(ts)); // en-CA 는 YYYY-MM-DD
}

/** 'YYYY-MM-DD' ± n일 */
function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * DAY_MS).toISOString().slice(0, 10);
}

/** 두 날짜 키의 차이 (b - a, 일) */
function diffDays(a, b) {
  const p = (k) => { const [y, m, d] = k.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((p(b) - p(a)) / DAY_MS);
}

/** 그 주의 월요일 */
function weekStart(key) {
  const [y, m, d] = key.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = 일
  return addDays(key, -((dow + 6) % 7));
}

/**
 * 출석 스트릭. dates: 'YYYY-MM-DD' 배열/Set, today: 'YYYY-MM-DD'
 * @returns {{ streak: number, weekDays: number, attendedToday: boolean }}
 */
function streakOf(dates, today) {
  const set = new Set(dates);
  const attendedToday = set.has(today);
  let cursor = attendedToday ? today : addDays(today, -1);
  let streak = 0;
  while (set.has(cursor)) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  const ws = weekStart(today);
  let weekDays = 0;
  for (const d of set) if (d >= ws && d <= today) weekDays++;
  return { streak, weekDays, attendedToday };
}

/**
 * 세션 목록 → 닉네임별 오늘/이번 주 합계(초).
 * sessions: [{ nickname, startedAt(ms), seconds }]
 */
function totalsOf(sessions, now, tz = DEFAULT_TZ) {
  const today = dateKey(now, tz);
  const ws = weekStart(today);
  const out = new Map();
  for (const s of sessions) {
    const day = dateKey(s.startedAt, tz);
    const row = out.get(s.nickname) || { nickname: s.nickname, todaySeconds: 0, weekSeconds: 0 };
    if (day === today) row.todaySeconds += s.seconds;
    if (day >= ws && day <= today) row.weekSeconds += s.seconds;
    out.set(s.nickname, row);
  }
  return out;
}

module.exports = { DEFAULT_TZ, dateKey, addDays, diffDays, weekStart, streakOf, totalsOf, isValidTz };
