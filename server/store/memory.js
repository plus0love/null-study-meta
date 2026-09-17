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
 *  resetUser (세션·출석·목표·할 일 삭제 + 코인 이월 초 0, users 행·코인 잔액·인벤토리는 유지)
 *  getCoins / adjustCoins / getCoinCarry / setCoinCarry / coinLedger / coinStats / addInventory / listInventory (8단계)
 *  roomLayout / addLayout / updateLayout / removeLayout (9단계: 스터디에 놓인 공용 가구, 첫 인자 = studyId) · users.deskItems / layoutLock 은 upsertUser/getUser
 *  roomPets / addRoomPet / updateRoomPet / removeRoomPet (10단계: 스터디에 풀린 공용 펫 + 강아지 설정 행 item_id 'dog') · users.petConfig
 *  11단계 스터디: listStudies / getStudy / getStudyByCode / createStudy / updateStudy / deleteStudy / touchStudy
 *    studyMembers / membershipsOf / listMembers / upsertMember / removeMember (소속 = 표시용, 입장 권한과 무관)
 *    createAccess / findAccess / touchAccess / clearAccess(studyId, nickname?) (잠긴 스터디 기기 토큰 study_access — 해시만 저장)
 *    weeklyGoalReached / recordWeeklyGoal / claimRewards (그룹 목표 보너스, 오프라인 멤버는 다음 접속 때)
 *    attendanceDates (그룹 스트릭) · migrateLegacy (study_id 없는 가구·펫 행을 첫 스터디로)
 *  12단계 야외: users.vehicleConfig / statsPublic · addTrackRecord / trackTop({ scope: 'today'|'all' }) / trackBest / hasLapToday (track_records)
 */
const { DEFAULT_TZ, dateKey, weekStart, streakOf, totalsOf } = require('./stats');

function createMemoryStore() {
  const users = new Map(); // nickname → { nickname, avatar, dogName, coins, coinCarrySeconds, deskItems, layoutLock, createdAt, updatedAt }
  const layout = []; // { id, studyId, roomId, itemId, inventoryId, x, y, rotation, meta, placedBy, placedAt } — 스터디에 놓인 공용 가구
  const roomPets = []; // { id, studyId, roomId, itemId, inventoryId, name, releasedBy, releasedAt, cosmetics, skills } — 공용 펫 (+ 강아지 설정 행)
  const studies = new Map(); // id → { id, code, name, passwordHash, ownerNickname, maxPlayers, weeklyGoalMinutes, editPolicy, passwordChangedAt, createdAt, lastActiveAt }
  const members = []; // { studyId, nickname, joinedAt, lastSeenAt } — 소속(표시용)
  const access = []; // { id, studyId, tokenHash, nickname, createdAt, lastUsedAt } — 비밀번호를 맞춘 기기의 토큰 해시
  const rewards = []; // { id, studyId, weekStart, nickname, createdAt, awardedAt } — 그룹 목표 보너스 (awardedAt null = 아직 못 받음)
  const sessions = []; // { id, nickname, startedAt, endedAt, seconds }
  const attendance = new Set(); // `${nickname}|${date}`
  const todos = []; // { id, nickname, text, done, createdAt, doneAt }
  const goals = new Map(); // `${nickname}|${date}` → { nickname, date, goalText, targetMinutes }
  const ledger = []; // { id, nickname, delta, reason, createdAt } — 모든 코인 증감
  const inventory = []; // { id, nickname, itemId, acquiredAt, meta }
  const trackRecords = []; // { id, nickname, studyId, vehicle, ms, createdAt } — 12단계 트랙 랩 기록
  let seq = 1;

  const ensureUser = (nickname, now = Date.now()) => {
    let u = users.get(nickname);
    if (!u) {
      u = { nickname, avatar: null, dogName: null, coins: 0, coinCarrySeconds: 0, deskItems: [null, null, null], layoutLock: false, petConfig: null, vehicleConfig: null, statsPublic: false, createdAt: now, updatedAt: now };
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
      if (data.deskItems !== undefined) u.deskItems = [...data.deskItems];
      if (data.layoutLock !== undefined) u.layoutLock = Boolean(data.layoutLock);
      if (data.petConfig !== undefined) u.petConfig = data.petConfig ? JSON.parse(JSON.stringify(data.petConfig)) : null;
      if (data.vehicleConfig !== undefined) u.vehicleConfig = data.vehicleConfig ? JSON.parse(JSON.stringify(data.vehicleConfig)) : null;
      if (data.statsPublic !== undefined) u.statsPublic = Boolean(data.statsPublic);
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
    /** 여러 닉네임의 출석 날짜 합집합 (정렬, 중복 제거) — 그룹 스트릭용 */
    async attendanceDates(nicknames) {
      const want = new Set(nicknames);
      const out = new Set();
      for (const k of attendance) {
        const i = k.lastIndexOf('|');
        if (want.has(k.slice(0, i))) out.add(k.slice(i + 1));
      }
      return [...out].sort();
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

    // ── 코인 / 인벤토리 (8단계) ────────────────────────────────────────
    async getCoins(nickname) {
      const u = users.get(nickname);
      return u ? u.coins : 0;
    },
    /**
     * 잔액을 delta 만큼 바꾸고 원장에 남긴다 (0 아래로는 못 내려간다 → { ok:false, error:'insufficient' }, 원장 기록 없음).
     * @returns {{ ok: true, balance, entry } | { ok: false, error: 'insufficient' | 'invalid', balance }}
     */
    async adjustCoins(nickname, delta, reason, now = Date.now()) {
      const d = Number(delta);
      const u = ensureUser(nickname, now);
      if (!Number.isInteger(d) || d === 0) return { ok: false, error: 'invalid', balance: u.coins };
      if (u.coins + d < 0) return { ok: false, error: 'insufficient', balance: u.coins };
      u.coins += d;
      u.updatedAt = now;
      const entry = { id: seq++, nickname, delta: d, reason: String(reason || ''), createdAt: now };
      ledger.push(entry);
      return { ok: true, balance: u.coins, entry: { ...entry } };
    },
    /** 코인으로 바뀌지 못하고 남은 공부 초 (다음 세션 정산 때 합산) */
    async getCoinCarry(nickname) {
      const u = users.get(nickname);
      return u ? u.coinCarrySeconds : 0;
    },
    async setCoinCarry(nickname, seconds, now = Date.now()) {
      const u = ensureUser(nickname, now);
      u.coinCarrySeconds = Math.max(0, Math.floor(Number(seconds) || 0));
      u.updatedAt = now;
      return u.coinCarrySeconds;
    },
    /** 최근 거래 (새 것부터) */
    async coinLedger(nickname, limit = 10) {
      return ledger.filter((e) => e.nickname === nickname).slice(-limit).reverse().map((e) => ({ ...e }));
    },
    /** 닉네임별 잔액 + 이번 주 획득(양수 delta 합, 월요일부터) */
    async coinStats({ tz = DEFAULT_TZ, now = Date.now() } = {}) {
      const today = dateKey(now, tz);
      const ws = weekStart(today);
      const out = new Map();
      for (const u of users.values()) out.set(u.nickname, { nickname: u.nickname, coins: u.coins, weekCoins: 0 });
      for (const e of ledger) {
        if (e.delta <= 0) continue;
        const day = dateKey(e.createdAt, tz);
        if (day >= ws && day <= today) out.get(e.nickname).weekCoins += e.delta;
      }
      return [...out.values()].filter((r) => r.coins > 0 || r.weekCoins > 0);
    },
    async addInventory(nickname, itemId, meta = {}, now = Date.now()) {
      ensureUser(nickname, now);
      const row = { id: seq++, nickname, itemId, acquiredAt: now, meta: { ...meta } };
      inventory.push(row);
      return { ...row, meta: { ...row.meta } };
    },
    async listInventory(nickname) {
      return inventory.filter((i) => i.nickname === nickname).map((i) => ({ ...i, meta: { ...i.meta } }));
    },
    async getInventoryItem(nickname, id) {
      const i = inventory.find((x) => x.id === Number(id) && x.nickname === nickname);
      return i ? { ...i, meta: { ...i.meta } } : null;
    },

    // ── 방 배치 (9단계) ───────────────────────────────────────────────
    async roomLayout(studyId) {
      return layout.filter((e) => e.studyId === studyId).map((e) => ({ ...e, meta: { ...e.meta } }));
    },
    async addLayout(studyId, { itemId, inventoryId, x, y, rotation = 0, meta = {}, placedBy, roomId = 'studyroom' }, now = Date.now()) {
      const e = { id: seq++, studyId, roomId, itemId, inventoryId: inventoryId ?? null, x, y, rotation, meta: { ...meta }, placedBy, placedAt: now };
      layout.push(e);
      return { ...e, meta: { ...e.meta } };
    },
    async updateLayout(studyId, id, { x, y, rotation }) {
      const e = layout.find((l) => l.id === Number(id) && l.studyId === studyId);
      if (!e) return null;
      if (x !== undefined) e.x = x;
      if (y !== undefined) e.y = y;
      if (rotation !== undefined) e.rotation = rotation;
      return { ...e, meta: { ...e.meta } };
    },
    async removeLayout(studyId, id) {
      const i = layout.findIndex((l) => l.id === Number(id) && l.studyId === studyId);
      if (i < 0) return null;
      const [e] = layout.splice(i, 1);
      return { ...e };
    },

    // ── 공용 펫 (10단계) ──────────────────────────────────────────────
    async roomPets(studyId) {
      return roomPets.filter((p) => p.studyId === studyId).map((p) => ({ ...p, cosmetics: { ...p.cosmetics }, skills: [...p.skills] }));
    },
    async addRoomPet(studyId, { itemId, inventoryId = null, name, releasedBy = null, cosmetics = {}, skills = [], roomId = 'studyroom' }, now = Date.now()) {
      const p = { id: seq++, studyId, roomId, itemId, inventoryId, name, releasedBy, releasedAt: now, cosmetics: { ...cosmetics }, skills: [...skills] };
      roomPets.push(p);
      return { ...p, cosmetics: { ...p.cosmetics }, skills: [...p.skills] };
    },
    async updateRoomPet(studyId, id, { name, cosmetics, skills } = {}) {
      const p = roomPets.find((r) => r.id === Number(id) && r.studyId === studyId);
      if (!p) return null;
      if (name !== undefined) p.name = name;
      if (cosmetics !== undefined) p.cosmetics = { ...cosmetics };
      if (skills !== undefined) p.skills = [...skills];
      return { ...p, cosmetics: { ...p.cosmetics }, skills: [...p.skills] };
    },
    async removeRoomPet(studyId, id) {
      const i = roomPets.findIndex((r) => r.id === Number(id) && r.studyId === studyId);
      if (i < 0) return null;
      const [p] = roomPets.splice(i, 1);
      return { ...p };
    },

    // ── 스터디 (11단계) ───────────────────────────────────────────────
    async listStudies() {
      return [...studies.values()].map((s) => ({ ...s }));
    },
    async getStudy(id) {
      const s = studies.get(Number(id));
      return s ? { ...s } : null;
    },
    async getStudyByCode(code) {
      const c = String(code || '').toUpperCase();
      for (const s of studies.values()) if (s.code === c) return { ...s };
      return null;
    },
    async createStudy({ code, name, passwordHash = null, ownerNickname = null, maxPlayers = 8, weeklyGoalMinutes = 1200, editPolicy = 'anyone' }, now = Date.now()) {
      const s = { id: seq++, code: String(code).toUpperCase(), name, passwordHash, ownerNickname, maxPlayers, weeklyGoalMinutes, editPolicy, passwordChangedAt: passwordHash ? now : null, createdAt: now, lastActiveAt: now };
      studies.set(s.id, s);
      return { ...s };
    },
    /** patch: name · passwordHash(null 이면 잠금 해제) · ownerNickname · maxPlayers · weeklyGoalMinutes · editPolicy. 비밀번호가 바뀌면 passwordChangedAt 갱신 */
    async updateStudy(id, patch = {}, now = Date.now()) {
      const s = studies.get(Number(id));
      if (!s) return null;
      for (const k of ['name', 'ownerNickname', 'maxPlayers', 'weeklyGoalMinutes', 'editPolicy']) if (patch[k] !== undefined) s[k] = patch[k];
      if (patch.passwordHash !== undefined) {
        s.passwordHash = patch.passwordHash;
        s.passwordChangedAt = now;
      }
      return { ...s };
    },
    async deleteStudy(id) {
      const sid = Number(id);
      if (!studies.delete(sid)) return false;
      for (let i = members.length - 1; i >= 0; i--) if (members[i].studyId === sid) members.splice(i, 1);
      for (let i = access.length - 1; i >= 0; i--) if (access[i].studyId === sid) access.splice(i, 1);
      for (let i = layout.length - 1; i >= 0; i--) if (layout[i].studyId === sid) layout.splice(i, 1);
      for (let i = roomPets.length - 1; i >= 0; i--) if (roomPets[i].studyId === sid) roomPets.splice(i, 1);
      for (let i = rewards.length - 1; i >= 0; i--) if (rewards[i].studyId === sid) rewards.splice(i, 1);
      return true;
    },
    async touchStudy(id, now = Date.now()) {
      const s = studies.get(Number(id));
      if (s) s.lastActiveAt = now;
    },
    async studyMembers(studyId) {
      return members.filter((m) => m.studyId === Number(studyId)).map((m) => ({ ...m }));
    },
    async membershipsOf(nickname) {
      return members.filter((m) => m.nickname === nickname).map((m) => ({ ...m }));
    },
    async listMembers() {
      return members.map((m) => ({ ...m }));
    },
    /** 소속 기록 (없으면 추가). 로비 '내 스터디'·멤버 목록 표시용이며 입장 권한과는 무관하다 */
    async upsertMember(studyId, nickname, now = Date.now()) {
      ensureUser(nickname, now);
      let m = members.find((x) => x.studyId === Number(studyId) && x.nickname === nickname);
      const inserted = !m;
      if (!m) {
        m = { studyId: Number(studyId), nickname, joinedAt: now, lastSeenAt: now };
        members.push(m);
      }
      m.lastSeenAt = now;
      return { ...m, inserted };
    },
    async removeMember(studyId, nickname) {
      const i = members.findIndex((x) => x.studyId === Number(studyId) && x.nickname === nickname);
      if (i < 0) return false;
      members.splice(i, 1);
      return true;
    },
    // ── 기기 접근 토큰 (잠긴 스터디) ──
    /** 비밀번호를 맞춘 기기에 발급한 토큰의 해시를 남긴다 */
    async createAccess(studyId, tokenHash, nickname, now = Date.now()) {
      const a = { id: seq++, studyId: Number(studyId), tokenHash, nickname, createdAt: now, lastUsedAt: now };
      access.push(a);
      return { ...a };
    },
    async findAccess(studyId, tokenHash) {
      const a = access.find((x) => x.studyId === Number(studyId) && x.tokenHash === tokenHash);
      return a ? { ...a } : null;
    },
    async touchAccess(studyId, tokenHash, now = Date.now()) {
      const a = access.find((x) => x.studyId === Number(studyId) && x.tokenHash === tokenHash);
      if (a) a.lastUsedAt = now;
    },
    /** 스터디의 토큰 무효 — 전부(비밀번호 변경·해제) 또는 nickname 으로 발급된 것만(내보내기). @returns 지운 개수 */
    async clearAccess(studyId, nickname) {
      let n = 0;
      for (let i = access.length - 1; i >= 0; i--) {
        if (access[i].studyId !== Number(studyId) || (nickname && access[i].nickname !== nickname)) continue;
        access.splice(i, 1); n++;
      }
      return n;
    },
    async weeklyGoalReached(studyId, weekStart) {
      return rewards.some((r) => r.studyId === Number(studyId) && r.weekStart === weekStart);
    },
    /** 이번 주 달성 기록 + 멤버 전원의 보너스 행 (이미 있으면 false) */
    async recordWeeklyGoal(studyId, weekStart, nicknames, now = Date.now()) {
      if (await this.weeklyGoalReached(studyId, weekStart)) return false;
      for (const n of nicknames) rewards.push({ id: seq++, studyId: Number(studyId), weekStart, nickname: n, createdAt: now, awardedAt: null });
      return true;
    },
    /** 아직 못 받은 보너스를 받은 것으로 표시하고 돌려준다 (호출자가 코인을 지급) */
    async claimRewards(nickname, now = Date.now()) {
      const out = [];
      for (const r of rewards) {
        if (r.nickname !== nickname || r.awardedAt) continue;
        r.awardedAt = now;
        out.push({ ...r });
      }
      return out;
    },
    /** study_id 없는 가구·펫 행이 있는지 (스터디가 하나도 없을 때 기본 스터디를 만들지 결정) */
    async hasLegacy() {
      const legacy = (r) => r.studyId === null || r.studyId === undefined;
      return layout.some(legacy) || roomPets.some(legacy);
    },
    /** 스터디가 생기기 전(study_id 없음)에 놓인 가구·펫을 첫 스터디로 옮긴다 */
    async migrateLegacy(studyId) {
      let n = 0;
      for (const e of layout) if (e.studyId === null || e.studyId === undefined) { e.studyId = studyId; n++; }
      let p = 0;
      for (const r of roomPets) if (r.studyId === null || r.studyId === undefined) { r.studyId = studyId; p++; }
      return { layout: n, pets: p };
    },

    // ── 트랙 기록 (12단계) ────────────────────────────────────────────
    async addTrackRecord({ nickname, studyId = null, vehicle, ms }, now = Date.now()) {
      ensureUser(nickname, now);
      const r = { id: seq++, nickname, studyId: studyId ?? null, vehicle: String(vehicle), ms: Math.max(0, Math.round(Number(ms) || 0)), createdAt: now };
      trackRecords.push(r);
      return { ...r };
    },
    /** 상위 기록 (닉네임마다 최고 1건, ms 오름차순). scope 'today' 면 오늘(tz) 것만 */
    async trackTop({ scope = 'all', tz = DEFAULT_TZ, now = Date.now(), limit = 5 } = {}) {
      const today = dateKey(now, tz);
      const best = new Map();
      for (const r of trackRecords) {
        if (scope === 'today' && dateKey(r.createdAt, tz) !== today) continue;
        const b = best.get(r.nickname);
        if (!b || r.ms < b.ms || (r.ms === b.ms && r.createdAt < b.createdAt)) best.set(r.nickname, r);
      }
      return [...best.values()].sort((a, b) => a.ms - b.ms || a.createdAt - b.createdAt).slice(0, limit).map((r) => ({ ...r }));
    },
    /** 내 역대 최고 { ms, vehicle, createdAt } | null */
    async trackBest(nickname) {
      let b = null;
      for (const r of trackRecords) if (r.nickname === nickname && (!b || r.ms < b.ms)) b = r;
      return b ? { ms: b.ms, vehicle: b.vehicle, createdAt: b.createdAt } : null;
    },
    /** 오늘(tz) 이미 완주한 적이 있는지 (하루 첫 완주 보상 판정) */
    async hasLapToday(nickname, { tz = DEFAULT_TZ, now = Date.now() } = {}) {
      const today = dateKey(now, tz);
      return trackRecords.some((r) => r.nickname === nickname && dateKey(r.createdAt, tz) === today);
    },

    // ── 기록 초기화 (7단계) ───────────────────────────────────────────
    /** 닉네임의 공부 세션·출석·목표·할 일을 지우고 코인 이월 초를 0으로. users(아바타·강아지 이름·코인 잔액)·인벤토리는 남긴다. 반환: 지운 개수 */
    async resetUser(nickname) {
      const counts = { sessions: 0, attendance: 0, goals: 0, todos: 0 };
      const u = users.get(nickname);
      if (u) u.coinCarrySeconds = 0;
      for (let i = sessions.length - 1; i >= 0; i--) if (sessions[i].nickname === nickname) { sessions.splice(i, 1); counts.sessions++; }
      for (const k of [...attendance]) if (k.startsWith(`${nickname}|`)) { attendance.delete(k); counts.attendance++; }
      for (const k of [...goals.keys()]) if (k.startsWith(`${nickname}|`)) { goals.delete(k); counts.goals++; }
      for (let i = todos.length - 1; i >= 0; i--) if (todos[i].nickname === nickname) { todos.splice(i, 1); counts.todos++; }
      return counts;
    },

    async close() {},
  };
}

module.exports = { createMemoryStore };
