'use strict';
/**
 * Supabase 영구 저장소 (service_role 키, 서버 전용). 스키마·집계 함수는 supabase/schema.sql.
 * 메모리 저장소(memory.js)와 같은 인터페이스·반환 형태(camelCase, ms 타임스탬프).
 * 집계는 SQL 함수(study_totals / attendance_streaks / list_todos)에 시간대를 넘겨 DB 에서 계산한다.
 */
const { DEFAULT_TZ } = require('./stats');

const ms = (iso) => (iso ? new Date(iso).getTime() : null);
const iso = (t) => new Date(t).toISOString();

function createSupabaseStore({ url, key }) {
  const { createClient } = require('@supabase/supabase-js');
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const check = ({ data, error }) => {
    if (error) throw new Error(error.message);
    return data;
  };
  const ensureUser = async (nickname) => {
    check(await client.from('users').upsert({ nickname }, { onConflict: 'nickname', ignoreDuplicates: true }));
  };
  const userRow = (r) => (r ? { nickname: r.nickname, avatar: r.avatar, dogName: r.dog_name, createdAt: ms(r.created_at), updatedAt: ms(r.updated_at) } : null);
  const todoRow = (r) => ({ id: r.id, nickname: r.nickname, text: r.text, done: r.done, createdAt: ms(r.created_at), doneAt: ms(r.done_at), carried: Boolean(r.carried) });

  return {
    kind: 'supabase',
    async ping() {
      check(await client.from('users').select('nickname', { head: true, count: 'exact' }).limit(1));
      return true;
    },

    // ── 사용자 ───────────────────────────────────────────────────────
    async upsertUser(nickname, data = {}) {
      const patch = { nickname, updated_at: iso(Date.now()) };
      if (data.avatar !== undefined) patch.avatar = data.avatar;
      if (data.dogName !== undefined) patch.dog_name = data.dogName;
      return userRow(check(await client.from('users').upsert(patch, { onConflict: 'nickname' }).select().single()));
    },
    async getUser(nickname) {
      return userRow(check(await client.from('users').select('*').eq('nickname', nickname).maybeSingle()));
    },
    async getLatestDogName() {
      const rows = check(await client.from('users').select('dog_name').not('dog_name', 'is', null).order('updated_at', { ascending: false }).limit(1));
      return rows && rows[0] ? rows[0].dog_name : null;
    },

    // ── 공부 세션 ────────────────────────────────────────────────────
    async saveSession({ nickname, startedAt, endedAt, seconds }) {
      await ensureUser(nickname);
      const r = check(await client.from('study_sessions').insert({ nickname, started_at: iso(startedAt), ended_at: iso(endedAt), seconds }).select().single());
      return { id: r.id, nickname: r.nickname, startedAt: ms(r.started_at), endedAt: ms(r.ended_at), seconds: r.seconds };
    },
    async studyTotals({ tz = DEFAULT_TZ } = {}) {
      const rows = check(await client.rpc('study_totals', { tz })) || [];
      return rows.map((r) => ({ nickname: r.nickname, todaySeconds: Number(r.today_seconds), weekSeconds: Number(r.week_seconds) }));
    },
    async listSessions(nickname) {
      const rows = check(await client.from('study_sessions').select('*').eq('nickname', nickname).order('started_at')) || [];
      return rows.map((r) => ({ id: r.id, nickname: r.nickname, startedAt: ms(r.started_at), endedAt: ms(r.ended_at), seconds: r.seconds }));
    },

    // ── 출석 ─────────────────────────────────────────────────────────
    async recordAttendance(nickname, date) {
      await ensureUser(nickname);
      const rows = check(await client.from('attendance').upsert({ nickname, date }, { onConflict: 'nickname,date', ignoreDuplicates: true }).select());
      return { inserted: Boolean(rows && rows.length) };
    },
    async attendanceOf(nickname, { tz = DEFAULT_TZ } = {}) {
      const rows = check(await client.rpc('attendance_streaks', { tz, only_nickname: nickname })) || [];
      const r = rows[0];
      return r ? { streak: Number(r.streak), weekDays: Number(r.week_days), attendedToday: Boolean(r.attended_today) } : { streak: 0, weekDays: 0, attendedToday: false };
    },
    async attendanceStats({ tz = DEFAULT_TZ } = {}) {
      const rows = check(await client.rpc('attendance_streaks', { tz })) || [];
      return rows.map((r) => ({ nickname: r.nickname, streak: Number(r.streak), weekDays: Number(r.week_days), attendedToday: Boolean(r.attended_today) }));
    },

    // ── 할 일 ────────────────────────────────────────────────────────
    async listTodos(nickname, { tz = DEFAULT_TZ } = {}) {
      const rows = check(await client.rpc('list_todos', { p_nickname: nickname, tz })) || [];
      return rows.map(todoRow);
    },
    async addTodo(nickname, text) {
      await ensureUser(nickname);
      return todoRow(check(await client.from('todos').insert({ nickname, text }).select().single()));
    },
    async setTodoDone(nickname, id, done, now = Date.now()) {
      const r = check(await client.from('todos').update({ done: Boolean(done), done_at: done ? iso(now) : null }).eq('id', id).eq('nickname', nickname).select().maybeSingle());
      return r ? todoRow(r) : null;
    },
    async deleteTodo(nickname, id) {
      const rows = check(await client.from('todos').delete().eq('id', id).eq('nickname', nickname).select('id'));
      return Boolean(rows && rows.length);
    },

    // ── 오늘 목표 ────────────────────────────────────────────────────
    async getGoal(nickname, date) {
      const r = check(await client.from('daily_goals').select('*').eq('nickname', nickname).eq('date', date).maybeSingle());
      return r ? { nickname: r.nickname, date: r.date, goalText: r.goal_text, targetMinutes: r.target_minutes } : null;
    },
    async setGoal(nickname, date, { goalText, targetMinutes }) {
      await ensureUser(nickname);
      const r = check(await client.from('daily_goals').upsert({ nickname, date, goal_text: goalText, target_minutes: targetMinutes }, { onConflict: 'nickname,date' }).select().single());
      return { nickname: r.nickname, date: r.date, goalText: r.goal_text, targetMinutes: r.target_minutes };
    },

    // ── 기록 초기화 (7단계) ───────────────────────────────────────────
    async resetUser(nickname) {
      const counts = {};
      for (const [key, table] of [['sessions', 'study_sessions'], ['attendance', 'attendance'], ['goals', 'daily_goals'], ['todos', 'todos']]) {
        const rows = check(await client.from(table).delete().eq('nickname', nickname).select('nickname'));
        counts[key] = rows ? rows.length : 0;
      }
      return counts;
    },

    async close() {},
  };
}

module.exports = { createSupabaseStore };
