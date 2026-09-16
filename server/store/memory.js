'use strict';
/**
 * 메모리 저장소. Supabase 키가 없거나 STORE=memory 일 때 사용 (프로세스가 죽으면 사라진다).
 * Supabase 저장소(supabase.js)와 같은 인터페이스·같은 반환 형태를 지킨다 — 집계 규칙은 stats.js 공용.
 *
 *  upsertUser / getUser / getLatestDogName
 *  saveSession / studyTotals
 *  recordAttendance / attendanceOf / attendanceStats
 *  listTodos / addTodo / setTodoDone / deleteTodo
 *  getGoal / setGoal
 */
const { DEFAULT_TZ, dateKey, streakOf, totalsOf } = require('./stats');

function createMemoryStore() {
  const users = new Map(); // nickname → { nickname, avatar, dogName, createdAt, updatedAt }
  const sessions = []; // { id, nickname, startedAt, endedAt, seconds }
  const attendance = new Set(); // `${nickname}|${date}`
  const todos = []; // { id, nickname, text, done, createdAt, doneAt }
  const goals = new Map(); // `${nickname}|${date}` → { nickname, date, goalText, targetMinutes }
  let seq = 1;

  const ensureUser = (nickname, now = Date.now()) => {
    let u = users.get(nickname);
    if (!u) {
      u = { nickname, avatar: null, dogName: null, createdAt: now, updatedAt: now };
      users.set(nickname, u);
    }
    return u;
  };

  return {
    kind: 'memory',
    async ping() {
      return true;
    },

    // ── 사용자 ───────────────────────────────────────────────────────
    async upsertUser(nickname, data = {}) {
      const u = ensureUser(nickname);
      if (data.avatar !== undefined) u.avatar = data.avatar;
      if (data.dogName !== undefined) u.dogName = data.dogName;
      u.updatedAt = Date.now();
      return { ...u };
    },
    async getUser(nickname) {
      const u = users.get(nickname);
      return u ? { ...u } : null;
    },
    /** 마지막으로 바꾼 강아지 이름 (방 전체 공용) */
    async getLatestDogName() {
      let best = null;
      for (const u of users.values()) if (u.dogName && (!best || u.updatedAt > best.updatedAt)) best = u;
      return best ? best.dogName : null;
    },

    // ── 공부 세션 ────────────────────────────────────────────────────
    async saveSession({ nickname, startedAt, endedAt, seconds }) {
      ensureUser(nickname, startedAt);
      const row = { id: seq++, nickname, startedAt, endedAt, seconds };
      sessions.push(row);
      return { ...row };
    },
    /** 닉네임별 오늘/이번 주 합계(초) */
    async studyTotals({ tz = DEFAULT_TZ, now = Date.now() } = {}) {
      return [...totalsOf(sessions, now, tz).values()];
    },
    async listSessions(nickname) {
      return sessions.filter((s) => s.nickname === nickname).map((s) => ({ ...s }));
    },

    // ── 출석 ─────────────────────────────────────────────────────────
    async recordAttendance(nickname, date) {
      ensureUser(nickname);
      const key = `${nickname}|${date}`;
      if (attendance.has(key)) return { inserted: false };
      attendance.add(key);
      return { inserted: true };
    },
    async attendanceOf(nickname, { tz = DEFAULT_TZ, now = Date.now() } = {}) {
      const dates = [];
      for (const k of attendance) if (k.startsWith(`${nickname}|`)) dates.push(k.slice(nickname.length + 1));
      return streakOf(dates, dateKey(now, tz));
    },
    async attendanceStats({ tz = DEFAULT_TZ, now = Date.now() } = {}) {
      const today = dateKey(now, tz);
      const byNick = new Map();
      for (const k of attendance) {
        const i = k.lastIndexOf('|');
        const nick = k.slice(0, i);
        if (!byNick.has(nick)) byNick.set(nick, []);
        byNick.get(nick).push(k.slice(i + 1));
      }
      return [...byNick.entries()].map(([nickname, dates]) => ({ nickname, ...streakOf(dates, today) }));
    },

    // ── 할 일 ────────────────────────────────────────────────────────
    /** 미완료 전부 + 오늘 완료한 것. 어제 이전에 만든 미완료는 carried(이월) 로 맨 위 */
    async listTodos(nickname, { tz = DEFAULT_TZ, now = Date.now() } = {}) {
      const today = dateKey(now, tz);
      return todos
        .filter((t) => t.nickname === nickname && (!t.done || (t.doneAt && dateKey(t.doneAt, tz) === today)))
        .map((t) => ({ ...t, carried: !t.done && dateKey(t.createdAt, tz) < today }))
        .sort((a, b) => (a.carried !== b.carried ? (a.carried ? -1 : 1) : a.createdAt - b.createdAt));
    },
    async addTodo(nickname, text, now = Date.now()) {
      ensureUser(nickname, now);
      const t = { id: seq++, nickname, text, done: false, createdAt: now, doneAt: null };
      todos.push(t);
      return { ...t, carried: false };
    },
    async setTodoDone(nickname, id, done, now = Date.now()) {
      const t = todos.find((x) => x.id === Number(id) && x.nickname === nickname);
      if (!t) return null;
      t.done = Boolean(done);
      t.doneAt = t.done ? now : null;
      return { ...t };
    },
    async deleteTodo(nickname, id) {
      const i = todos.findIndex((x) => x.id === Number(id) && x.nickname === nickname);
      if (i < 0) return false;
      todos.splice(i, 1);
      return true;
    },

    // ── 오늘 목표 ────────────────────────────────────────────────────
    async getGoal(nickname, date) {
      const g = goals.get(`${nickname}|${date}`);
      return g ? { ...g } : null;
    },
    async setGoal(nickname, date, { goalText, targetMinutes }) {
      ensureUser(nickname);
      const g = { nickname, date, goalText, targetMinutes };
      goals.set(`${nickname}|${date}`, g);
      return { ...g };
    },

    async close() {},
  };
}

module.exports = { createMemoryStore };
