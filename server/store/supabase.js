'use strict';
/**
 * Supabase 영구 저장소 (service_role 키, 서버 전용). 스키마·집계 함수는 supabase/schema.sql.
 * 메모리 저장소(memory.js)와 같은 인터페이스·반환 형태(camelCase, ms 타임스탬프).
 * 집계는 SQL 함수(study_totals / attendance_streaks / list_todos / coin_stats)에 시간대를 넘겨 DB 에서 계산한다.
 * 코인 증감(adjust_coins)은 잔액 확인·차감·원장 기록을 한 트랜잭션(plpgsql)으로 처리해 동시 요청에도 음수가 되지 않는다.
 * 11단계: studies / study_members / study_goal_rewards / study_access(기기 토큰 해시). room_layout · room_pets 는 study_id 로 스터디마다 나뉜다.
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
  const userRow = (r) => (r ? { nickname: r.nickname, avatar: r.avatar, dogName: r.dog_name, coins: Number(r.coins) || 0, coinCarrySeconds: Number(r.coin_carry_seconds) || 0, deskItems: Array.isArray(r.desk_items) ? r.desk_items : [null, null, null], layoutLock: Boolean(r.layout_lock), petConfig: r.pet_config || null, vehicleConfig: r.vehicle_config || null, statsPublic: Boolean(r.stats_public), createdAt: ms(r.created_at), updatedAt: ms(r.updated_at) } : null);
  const trackRow = (r) => ({ id: r.id, nickname: r.nickname, studyId: r.study_id ?? null, vehicle: r.vehicle, ms: Number(r.ms), createdAt: ms(r.created_at) });
  const studyRow = (r) => (r ? { id: r.id, code: r.code, name: r.name, passwordHash: r.password_hash || null, ownerNickname: r.owner_nickname || null, maxPlayers: Number(r.max_players) || 8, weeklyGoalMinutes: Number(r.weekly_goal_minutes) || 1200, editPolicy: r.edit_policy || 'anyone', passwordChangedAt: ms(r.password_changed_at), createdAt: ms(r.created_at), lastActiveAt: ms(r.last_active_at) } : null);
  const memberRow = (r) => ({ studyId: r.study_id, nickname: r.nickname, joinedAt: ms(r.joined_at), lastSeenAt: ms(r.last_seen_at) });
  const accessRow = (r) => ({ id: r.id, studyId: r.study_id, tokenHash: r.token_hash, nickname: r.nickname, createdAt: ms(r.created_at), lastUsedAt: ms(r.last_used_at) });
  const rewardRow = (r) => ({ id: r.id, studyId: r.study_id, weekStart: r.week_start, nickname: r.nickname, createdAt: ms(r.created_at), awardedAt: ms(r.awarded_at) });
  const petRow = (r) => ({ id: r.id, studyId: r.study_id, roomId: r.room_id, itemId: r.item_id, inventoryId: r.inventory_id, name: r.name, releasedBy: r.released_by, releasedAt: ms(r.released_at), cosmetics: r.cosmetics || {}, skills: Array.isArray(r.skills) ? r.skills : [], tank: Array.isArray(r.tank) ? r.tank : [] });
  const layoutRow = (r) => ({ id: r.id, studyId: r.study_id, roomId: r.room_id, itemId: r.item_id, inventoryId: r.inventory_id, x: r.x, y: r.y, rotation: r.rotation, meta: r.meta || {}, placedBy: r.placed_by, placedAt: ms(r.placed_at) });
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
      if (data.deskItems !== undefined) patch.desk_items = data.deskItems;
      if (data.layoutLock !== undefined) patch.layout_lock = Boolean(data.layoutLock);
      if (data.petConfig !== undefined) patch.pet_config = data.petConfig;
      if (data.vehicleConfig !== undefined) patch.vehicle_config = data.vehicleConfig;
      if (data.statsPublic !== undefined) patch.stats_public = Boolean(data.statsPublic);
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
    /** 여러 닉네임의 출석 날짜 합집합 (정렬, 중복 제거, 최근 400일) — 그룹 스트릭용 */
    async attendanceDates(nicknames) {
      if (!nicknames.length) return [];
      const since = new Date(Date.now() - 400 * 24 * 3600 * 1000).toISOString().slice(0, 10);
      const rows = check(await client.from('attendance').select('date').in('nickname', nicknames).gte('date', since)) || [];
      return [...new Set(rows.map((r) => r.date))].sort();
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
    async getInventoryItem(nickname, id) {
      const r = check(await client.from('inventory').select('*').eq('id', id).eq('nickname', nickname).maybeSingle());
      return r ? invRow(r) : null;
    },

    // ── 방 배치 (9단계) ───────────────────────────────────────────────
    async roomLayout(studyId) {
      const rows = check(await client.from('room_layout').select('*').eq('study_id', studyId).order('placed_at')) || [];
      return rows.map(layoutRow);
    },
    async addLayout(studyId, { itemId, inventoryId, x, y, rotation = 0, meta = {}, placedBy, roomId = 'studyroom' }, now = Date.now()) {
      return layoutRow(check(await client.from('room_layout').insert({ study_id: studyId, room_id: roomId, item_id: itemId, inventory_id: inventoryId ?? null, x, y, rotation, meta, placed_by: placedBy, placed_at: iso(now) }).select().single()));
    },
    async updateLayout(studyId, id, { x, y, rotation }) {
      const patch = {};
      if (x !== undefined) patch.x = x;
      if (y !== undefined) patch.y = y;
      if (rotation !== undefined) patch.rotation = rotation;
      const r = check(await client.from('room_layout').update(patch).eq('id', id).eq('study_id', studyId).select().maybeSingle());
      return r ? layoutRow(r) : null;
    },
    async removeLayout(studyId, id) {
      const rows = check(await client.from('room_layout').delete().eq('id', id).eq('study_id', studyId).select());
      return rows && rows[0] ? layoutRow(rows[0]) : null;
    },

    // ── 공용 펫 (10단계) ──────────────────────────────────────────────
    async roomPets(studyId) {
      const rows = check(await client.from('room_pets').select('*').eq('study_id', studyId).order('released_at')) || [];
      return rows.map(petRow);
    },
    async addRoomPet(studyId, { itemId, inventoryId = null, name, releasedBy = null, cosmetics = {}, skills = [], roomId = 'studyroom' }, now = Date.now()) {
      return petRow(check(await client.from('room_pets').insert({ study_id: studyId, room_id: roomId, item_id: itemId, inventory_id: inventoryId, name, released_by: releasedBy, released_at: iso(now), cosmetics, skills }).select().single()));
    },
    async updateRoomPet(studyId, id, { name, cosmetics, skills } = {}) {
      const patch = {};
      if (name !== undefined) patch.name = name;
      if (cosmetics !== undefined) patch.cosmetics = cosmetics;
      if (skills !== undefined) patch.skills = skills;
      const r = check(await client.from('room_pets').update(patch).eq('id', id).eq('study_id', studyId).select().maybeSingle());
      return r ? petRow(r) : null;
    },
    async removeRoomPet(studyId, id) {
      const rows = check(await client.from('room_pets').delete().eq('id', id).eq('study_id', studyId).select());
      return rows && rows[0] ? petRow(rows[0]) : null;
    },

    // ── 스터디 (11단계) ───────────────────────────────────────────────
    async listStudies() {
      const rows = check(await client.from('studies').select('*').order('created_at')) || [];
      return rows.map(studyRow);
    },
    async getStudy(id) {
      return studyRow(check(await client.from('studies').select('*').eq('id', id).maybeSingle()));
    },
    async getStudyByCode(code) {
      return studyRow(check(await client.from('studies').select('*').eq('code', String(code || '').toUpperCase()).maybeSingle()));
    },
    async createStudy({ code, name, passwordHash = null, ownerNickname = null, maxPlayers = 8, weeklyGoalMinutes = 1200, editPolicy = 'anyone' }, now = Date.now()) {
      if (ownerNickname) await ensureUser(ownerNickname);
      const row = { code: String(code).toUpperCase(), name, password_hash: passwordHash, owner_nickname: ownerNickname, max_players: maxPlayers, weekly_goal_minutes: weeklyGoalMinutes, edit_policy: editPolicy, password_changed_at: passwordHash ? iso(now) : null, created_at: iso(now), last_active_at: iso(now) };
      return studyRow(check(await client.from('studies').insert(row).select().single()));
    },
    async updateStudy(id, patch = {}, now = Date.now()) {
      const p = {};
      if (patch.name !== undefined) p.name = patch.name;
      if (patch.ownerNickname !== undefined) p.owner_nickname = patch.ownerNickname;
      if (patch.maxPlayers !== undefined) p.max_players = patch.maxPlayers;
      if (patch.weeklyGoalMinutes !== undefined) p.weekly_goal_minutes = patch.weeklyGoalMinutes;
      if (patch.editPolicy !== undefined) p.edit_policy = patch.editPolicy;
      if (patch.passwordHash !== undefined) { p.password_hash = patch.passwordHash; p.password_changed_at = iso(now); }
      if (!Object.keys(p).length) return this.getStudy(id);
      const r = check(await client.from('studies').update(p).eq('id', id).select().maybeSingle());
      return r ? studyRow(r) : null;
    },
    async deleteStudy(id) {
      const rows = check(await client.from('studies').delete().eq('id', id).select('id'));
      return Boolean(rows && rows.length);
    },
    async touchStudy(id, now = Date.now()) {
      check(await client.from('studies').update({ last_active_at: iso(now) }).eq('id', id));
    },
    async studyMembers(studyId) {
      const rows = check(await client.from('study_members').select('*').eq('study_id', studyId).order('joined_at')) || [];
      return rows.map(memberRow);
    },
    async membershipsOf(nickname) {
      const rows = check(await client.from('study_members').select('*').eq('nickname', nickname)) || [];
      return rows.map(memberRow);
    },
    async listMembers() {
      const rows = check(await client.from('study_members').select('*')) || [];
      return rows.map(memberRow);
    },
    /** 소속 기록 (표시용, 입장 권한과 무관) */
    async upsertMember(studyId, nickname, now = Date.now()) {
      await ensureUser(nickname);
      const existing = check(await client.from('study_members').select('*').eq('study_id', studyId).eq('nickname', nickname).maybeSingle());
      const patch = { study_id: studyId, nickname, last_seen_at: iso(now) };
      if (!existing) patch.joined_at = iso(now);
      const r = check(await client.from('study_members').upsert(patch, { onConflict: 'study_id,nickname' }).select().single());
      return { ...memberRow(r), inserted: !existing };
    },
    async removeMember(studyId, nickname) {
      const rows = check(await client.from('study_members').delete().eq('study_id', studyId).eq('nickname', nickname).select('nickname'));
      return Boolean(rows && rows.length);
    },
    // ── 기기 접근 토큰 (잠긴 스터디, 해시만 저장) ──
    async createAccess(studyId, tokenHash, nickname, now = Date.now()) {
      await ensureUser(nickname);
      const r = check(await client.from('study_access').insert({ study_id: studyId, token_hash: tokenHash, nickname, created_at: iso(now), last_used_at: iso(now) }).select().single());
      return accessRow(r);
    },
    async findAccess(studyId, tokenHash) {
      const r = check(await client.from('study_access').select('*').eq('study_id', studyId).eq('token_hash', tokenHash).maybeSingle());
      return r ? accessRow(r) : null;
    },
    async touchAccess(studyId, tokenHash, now = Date.now()) {
      check(await client.from('study_access').update({ last_used_at: iso(now) }).eq('study_id', studyId).eq('token_hash', tokenHash));
    },
    async clearAccess(studyId, nickname) {
      let q = client.from('study_access').delete().eq('study_id', studyId);
      if (nickname) q = q.eq('nickname', nickname);
      const rows = check(await q.select('id')) || [];
      return rows.length;
    },
    async weeklyGoalReached(studyId, weekStart) {
      const rows = check(await client.from('study_goal_rewards').select('id').eq('study_id', studyId).eq('week_start', weekStart).limit(1)) || [];
      return rows.length > 0;
    },
    async recordWeeklyGoal(studyId, weekStart, nicknames, now = Date.now()) {
      if (await this.weeklyGoalReached(studyId, weekStart)) return false;
      const rows = nicknames.map((n) => ({ study_id: studyId, week_start: weekStart, nickname: n, created_at: iso(now) }));
      if (!rows.length) return true;
      const { error } = await client.from('study_goal_rewards').upsert(rows, { onConflict: 'study_id,week_start,nickname', ignoreDuplicates: true });
      if (error) throw new Error(error.message);
      return true;
    },
    async claimRewards(nickname, now = Date.now()) {
      const rows = check(await client.from('study_goal_rewards').update({ awarded_at: iso(now) }).eq('nickname', nickname).is('awarded_at', null).select()) || [];
      return rows.map(rewardRow);
    },
    async hasLegacy() {
      const l = check(await client.from('room_layout').select('id').is('study_id', null).limit(1)) || [];
      if (l.length) return true;
      const p = check(await client.from('room_pets').select('id').is('study_id', null).limit(1)) || [];
      return p.length > 0;
    },
    async migrateLegacy(studyId) {
      const l = check(await client.from('room_layout').update({ study_id: studyId }).is('study_id', null).select('id')) || [];
      const p = check(await client.from('room_pets').update({ study_id: studyId }).is('study_id', null).select('id')) || [];
      return { layout: l.length, pets: p.length };
    },

    // ── 트랙 기록 (12단계) ────────────────────────────────────────────
    async addTrackRecord({ nickname, studyId = null, vehicle, ms: lapMs }, now = Date.now()) {
      await ensureUser(nickname);
      return trackRow(check(await client.from('track_records').insert({ nickname, study_id: studyId, vehicle: String(vehicle), ms: Math.max(0, Math.round(Number(lapMs) || 0)), created_at: iso(now) }).select().single()));
    },
    /** track_top(): 닉네임마다 최고 1건, ms 오름차순 (오늘/역대는 SQL 에서 tz 기준) */
    async trackTop({ scope = 'all', tz = DEFAULT_TZ, limit = 5 } = {}) {
      const rows = check(await client.rpc('track_top_sorted', { tz, today_only: scope === 'today', lim: limit })) || [];
      return rows.map(trackRow);
    },
    async trackBest(nickname) {
      const rows = check(await client.from('track_records').select('*').eq('nickname', nickname).order('ms', { ascending: true }).limit(1)) || [];
      return rows[0] ? { ms: Number(rows[0].ms), vehicle: rows[0].vehicle, createdAt: ms(rows[0].created_at) } : null;
    },
    async hasLapToday(nickname, { tz = DEFAULT_TZ } = {}) {
      const rows = check(await client.rpc('track_top', { tz, today_only: true, lim: 1000, only_nickname: nickname })) || [];
      return rows.length > 0;
    },

    // ── 낚시 · 별자리 · 어항 (14단계) ─────────────────────────────────
    async addFishCatch({ nickname, fishId }, now = Date.now()) {
      await ensureUser(nickname);
      const r = check(await client.from('fish_catches').insert({ nickname, fish_id: String(fishId), caught_at: iso(now) }).select().single());
      return { id: r.id, nickname: r.nickname, fishId: r.fish_id, caughtAt: ms(r.caught_at) };
    },
    async fishCodex(nickname) {
      const rows = check(await client.from('fish_catches').select('fish_id, caught_at').eq('nickname', nickname)) || [];
      const m = new Map();
      for (const r of rows) {
        const at = ms(r.caught_at);
        const e = m.get(r.fish_id) || { fishId: r.fish_id, count: 0, firstAt: at, lastAt: at };
        e.count++;
        e.firstAt = Math.min(e.firstAt, at);
        e.lastAt = Math.max(e.lastAt, at);
        m.set(r.fish_id, e);
      }
      return [...m.values()];
    },
    async fishCatchesToday(nickname, { tz = DEFAULT_TZ, now = Date.now() } = {}) {
      const { dateKey } = require('./stats');
      const today = dateKey(now, tz);
      const rows = check(await client.from('fish_catches').select('caught_at').eq('nickname', nickname).gte('caught_at', iso(now - 48 * 3600 * 1000))) || [];
      return rows.filter((r) => dateKey(ms(r.caught_at), tz) === today).length;
    },
    async addConstellationView(nickname, constId, now = Date.now()) {
      await ensureUser(nickname);
      const prev = check(await client.from('constellation_views').select('seen_at').eq('nickname', nickname).eq('const_id', String(constId)).limit(1)) || [];
      if (prev[0]) return { inserted: false, seenAt: ms(prev[0].seen_at) };
      check(await client.from('constellation_views').upsert({ nickname, const_id: String(constId), seen_at: iso(now) }, { onConflict: 'nickname,const_id', ignoreDuplicates: true }));
      return { inserted: true, seenAt: now };
    },
    async constellationViews(nickname) {
      const rows = check(await client.from('constellation_views').select('const_id, seen_at').eq('nickname', nickname)) || [];
      return rows.map((r) => ({ constId: r.const_id, seenAt: ms(r.seen_at) }));
    },
    async setPetTank(roomPetId, tank) {
      const rows = check(await client.from('room_pets').update({ tank: Array.isArray(tank) ? tank : [] }).eq('id', roomPetId).select('tank')) || [];
      return rows[0] ? rows[0].tank : null;
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
