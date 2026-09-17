'use strict';
/**
 * Supabase 영구 저장소 (service_role 키, 서버 전용). 스키마·집계 함수는 supabase/schema.sql.
 * 메모리 저장소(memory.js)와 같은 인터페이스·반환 형태(camelCase, ms 타임스탬프).
 * 집계는 SQL 함수(study_totals / attendance_streaks / list_todos / coin_stats)에 시간대를 넘겨 DB 에서 계산한다.
 * 코인 증감(adjust_coins)은 잔액 확인·차감·원장 기록을 한 트랜잭션(plpgsql)으로 처리해 동시 요청에도 음수가 되지 않는다.
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
  const userRow = (r) => (r ? { nickname: r.nickname, avatar: r.avatar, dogName: r.dog_name, coins: Number(r.coins) || 0, coinCarrySeconds: Number(r.coin_carry_seconds) || 0, createdAt: ms(r.created_at), updatedAt: ms(r.updated_at) } : null);
  const ledgerRow = (r) => ({ id: r.id, nickname: r.nickname, delta: Number(r.delta), reason: r.reason, createdAt: ms(r.created_at) });
  const invRow = (r) => ({ id: r.id, nickname: r.nickname, itemId: r.item_id, acquiredAt: ms(r.acquired_at), meta: r.meta || {} });
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

    // ── 코인 / 인벤토리 (8단계) ────────────────────────────────────────
    async getCoins(nickname) {
      const r = check(await client.from('users').select('coins').eq('nickname', nickname).maybeSingle());
      return r ? Number(r.coins) || 0 : 0;
    },
    /** adjust_coins(): users.coins 갱신 + coin_ledger 삽입을 한 트랜잭션으로. 잔액 부족이면 ok=false (기록 없음) */
    async adjustCoins(nickname, delta, reason, now = Date.now()) {
      const d = Number(delta);
      if (!Number.isInteger(d) || d === 0) return { ok: false, error: 'invalid', balance: await this.getCoins(nickname) };
      const rows = check(await client.rpc('adjust_coins', { p_nickname: nickname, p_delta: d, p_reason: String(reason || ''), p_at: iso(now) })) || [];
      const r = rows[0];
      if (!r) throw new Error('adjust_coins 응답 없음');
      if (!r.ok) return { ok: false, error: 'insufficient', balance: Number(r.balance) || 0 };
      return { ok: true, balance: Number(r.balance), entry: { id: r.entry_id, nickname, delta: d, reason: String(reason || ''), createdAt: ms(r.created_at) } };
    },
    async getCoinCarry(nickname) {
      const r = check(await client.from('users').select('coin_carry_seconds').eq('nickname', nickname).maybeSingle());
      return r ? Number(r.coin_carry_seconds) || 0 : 0;
    },
    async setCoinCarry(nickname, seconds, now = Date.now()) {
      const v = Math.max(0, Math.floor(Number(seconds) || 0));
      check(await client.from('users').upsert({ nickname, coin_carry_seconds: v, updated_at: iso(now) }, { onConflict: 'nickname' }));
      return v;
    },
    async coinLedger(nickname, limit = 10) {
      const rows = check(await client.from('coin_ledger').select('*').eq('nickname', nickname).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit)) || [];
      return rows.map(ledgerRow);
    },
    async coinStats({ tz = DEFAULT_TZ } = {}) {
      const rows = check(await client.rpc('coin_stats', { tz })) || [];
      return rows.map((r) => ({ nickname: r.nickname, coins: Number(r.coins) || 0, weekCoins: Number(r.week_coins) || 0 }));
    },
    async addInventory(nickname, itemId, meta = {}, now = Date.now()) {
      await ensureUser(nickname);
      return invRow(check(await client.from('inventory').insert({ nickname, item_id: itemId, meta, acquired_at: iso(now) }).select().single()));
    },
    async listInventory(nickname) {
      const rows = check(await client.from('inventory').select('*').eq('nickname', nickname).order('acquired_at')) || [];
      return rows.map(invRow);
    },

    // ── 기록 초기화 (7단계) ───────────────────────────────────────────
    async resetUser(nickname) {
      const counts = {};
      check(await client.from('users').update({ coin_carry_seconds: 0 }).eq('nickname', nickname)); // 이월 초도 0 (없는 사용자면 0행)
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
