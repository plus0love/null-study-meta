'use strict';
/**
 * 스터디 허브 (11단계): 스터디(방 인스턴스) 목록 · 소속 · 비밀번호 · 월드 수명 · 로비 데이터 · 그룹 목표 타이머.
 *  - 스터디마다 World 하나. 처음 입장할 때 만들고(init: 가구·펫 로드) 아무도 없으면 releaseMs(5분) 뒤 메모리에서 내린다.
 *    비어도 가구·공용 펫은 저장소에 남는다. 방장이 나가도 스터디는 유지된다.
 *  - 공부 기록·목표는 사람에게 붙으므로 StudyTracker 와 goals 맵은 허브가 하나만 갖고 모든 World 가 공유한다.
 *  - 닉네임은 접속 중인 모든 스터디를 통틀어 하나만 (같은 사람이 두 곳에 동시에 있을 수 없다 → 코인·기록이 섞이지 않는다).
 *  - 비밀번호: 스터디별 scrypt 해시(gate.hashPassword). 생략 기준은 "기기": 비밀번호를 맞춘(또는 만든·바꾼) 기기에
 *    study_access 토큰(무작위 32바이트)을 주고 해시만 저장한다. 다음 입장 때 유효한 토큰을 내면 묻지 않고, 없거나 무효면 다시 입력.
 *    방장이 비밀번호를 바꾸거나 풀면 그 스터디 토큰 전부 무효(방장 기기는 바꿀 때 새 토큰을 받는다). 방장이라도 토큰 없는 기기면 입력.
 *    실패 5회 → 30초 잠금 (키 = ip|studyId). study_members(소속)는 로비 카드·멤버 목록 표시용일 뿐 입장 권한과 무관하다.
 *  - 정원: 유예 중인 사람까지 players.size 로 센다. 방장이 없는 스터디(마이그레이션·방장 탈퇴)는 첫 입장자가 방장.
 *  - 60일간 아무도 안 들어온 스터디는 서버 시작 시 삭제. 스터디가 하나도 없고 옛 데이터(study_id 없는 가구·펫)가 있으면
 *    '우리의 스터디룸' 을 만들어 그리로 옮긴다.
 *  - 그룹 주간 목표: goalCheckMs 마다 사람이 있는 월드의 checkWeeklyGoal().
 * 이벤트: 'worldCreated' (world), 'worldReleased' (world), 'studyUpdated' ({ study, world }), 'studyDeleted' ({ study })
 */
const EventEmitter = require('node:events');
const crypto = require('node:crypto');

const { World } = require('./world');
const { StudyTracker } = require('./study');
const { normalizeNickname, uniqueNickname } = require('./nickname');
const { createStudyGate, hashPassword, newAccessToken, hashToken } = require('../gate');
const { DEFAULT_TZ, dateKey, weekStart, streakOf, isValidTz } = require('../store/stats');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 헷갈리는 0/O · 1/I 제외한 영숫자
const CODE_LEN = 6;
const NAME_MAX = 20;
const PASSWORD_MIN = 4;
const PASSWORD_MAX = 20;
const PLAYERS_MIN = 2;
const PLAYERS_MAX = 12;
const PLAYERS_DEFAULT = 8;
const GOAL_MIN = 5 * 60; // 분 (5시간)
const GOAL_MAX = 100 * 60; // 분 (100시간)
const GOAL_DEFAULT = 1200; // 분 (20시간)
const EDIT_POLICIES = ['anyone', 'owner'];
const RELEASE_MS = 5 * 60 * 1000; // 비면 이만큼 뒤 월드 해제
const INACTIVE_MS = 60 * 24 * 60 * 60 * 1000; // 60일
const GOAL_CHECK_MS = 30 * 1000;
const DEFAULT_NAME = '우리의 스터디룸';

function randomCode(random = () => crypto.randomInt(CODE_CHARS.length)) {
  let s = '';
  for (let i = 0; i < CODE_LEN; i++) s += CODE_CHARS[random()];
  return s;
}

function normalizeCode(code) {
  const c = String(code ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return c.length === CODE_LEN ? c : null;
}

/** 스터디 이름: 제어문자 제거·trim, 1~20자 */
function normalizeName(raw) {
  const s = String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  const len = [...s].length;
  return len >= 1 && len <= NAME_MAX ? s : null;
}

class Hub extends EventEmitter {
  constructor({ room, store, tz = DEFAULT_TZ, now = () => Date.now(), log = console, world: worldOpts = {}, releaseMs = RELEASE_MS, inactiveMs = INACTIVE_MS, goalCheckMs = GOAL_CHECK_MS, gate: gateOpts = {} } = {}) {
    super();
    this.room = room;
    this.store = store;
    this.tz = isValidTz(tz) ? tz : DEFAULT_TZ;
    this.now = now;
    this.log = log;
    this.worldOpts = worldOpts;
    this.releaseMs = releaseMs;
    this.inactiveMs = inactiveMs;
    this.goalCheckMs = goalCheckMs;
    this.gate = createStudyGate({ now, log, ...gateOpts });
    this.studies = new Map(); // id → 행 (저장소 캐시)
    this.worlds = new Map(); // id → World
    this.creating = new Map(); // id → Promise<World> (동시 입장 때 init 한 번만)
    this.releaseTimers = new Map(); // id → timeout
    this.goals = new Map(); // nickname → 오늘 목표 (모든 월드가 공유)
    const { study: studyOpts = {}, ...rest } = worldOpts;
    this.worldRest = rest;
    this.study = new StudyTracker({ store, tz: this.tz, now, log, goalOf: (n) => this.goalOf(n), ...studyOpts });
    this.study.setMaxListeners(0);
    this.goalTimer = null;
  }

  today() {
    return dateKey(this.now(), this.tz);
  }

  goalOf(nickname) {
    const g = this.goals.get(nickname);
    return g && g.date === this.today() ? g : null;
  }

  /** 서버 시작: 스터디 목록 로드 · 60일 비활성 삭제 · 옛 데이터 마이그레이션 · 그룹 목표 타이머 */
  async init() {
    await this.study.refreshTotals();
    const rows = await this.store.listStudies();
    this.studies = new Map(rows.map((s) => [s.id, s]));
    await this.pruneInactive();
    await this.migrateLegacy();
    if (this.goalCheckMs > 0) {
      this.goalTimer = setInterval(() => { for (const w of this.worlds.values()) if (w.players.size) w.checkWeeklyGoal(); }, this.goalCheckMs);
      this.goalTimer.unref?.();
    }
    this.log.log(`[hub] 스터디 ${this.studies.size}개`);
    return this;
  }

  async pruneInactive() {
    const cutoff = this.now() - this.inactiveMs;
    const dead = [...this.studies.values()].filter((s) => (s.lastActiveAt || s.createdAt || 0) < cutoff);
    for (const s of dead) {
      await this.store.deleteStudy(s.id);
      this.studies.delete(s.id);
      this.log.log(`[hub] 60일 비활성 스터디 삭제: ${s.name} (${s.code})`);
    }
    return dead.length;
  }

  /** 스터디가 없는데 study_id 없는 가구·펫이 있으면 기본 스터디를 만들어 옮긴다. 있으면 첫 스터디(가장 오래된 것)로 */
  async migrateLegacy() {
    let first = [...this.studies.values()].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))[0] || null;
    if (!first) {
      if (!(await this.store.hasLegacy())) return null;
      first = await this.store.createStudy({ code: await this.freshCode(), name: DEFAULT_NAME, ownerNickname: null, maxPlayers: PLAYERS_DEFAULT, weeklyGoalMinutes: GOAL_DEFAULT }, this.now());
      this.studies.set(first.id, first);
      this.log.log(`[hub] 기본 스터디 생성: ${first.name} (${first.code})`);
    }
    const moved = await this.store.migrateLegacy(first.id);
    if (moved.layout || moved.pets) {
      // 옛 강아지 이름(users.dog_name 의 마지막 값)을 스터디의 'dog' 행에
      const name = await this.store.getLatestDogName();
      if (name) {
        const pets = await this.store.roomPets(first.id);
        const dog = pets.find((p) => p.itemId === 'dog');
        if (dog) await this.store.updateRoomPet(first.id, dog.id, { name });
        else await this.store.addRoomPet(first.id, { itemId: 'dog', name, releasedBy: null, roomId: this.room.id }, this.now());
      }
      this.log.log(`[hub] 옛 데이터를 ${first.name} 으로 옮김: 가구 ${moved.layout} · 펫 ${moved.pets}`);
    }
    return moved;
  }

  async freshCode() {
    for (let i = 0; i < 20; i++) {
      const code = randomCode();
      if (![...this.studies.values()].some((s) => s.code === code) && !(await this.store.getStudyByCode(code))) return code;
    }
    throw new Error('스터디 코드를 만들지 못했습니다');
  }

  // ── 조회 ────────────────────────────────────────────────────────────
  /** id(숫자) 또는 코드(6자) → 스터디 행 */
  resolve(ref) {
    if (ref === null || ref === undefined || ref === '') return null;
    if (typeof ref === 'object') return this.resolve(ref.id ?? ref.code);
    const n = Number(ref);
    if (Number.isInteger(n) && this.studies.has(n)) return this.studies.get(n);
    const code = normalizeCode(ref);
    if (!code) return null;
    for (const s of this.studies.values()) if (s.code === code) return s;
    return null;
  }

  /** 클라이언트에 보내는 스터디 정보 (해시는 절대 안 나간다) */
  publicStudy(s, extra = {}) {
    return { id: s.id, code: s.code, name: s.name, locked: Boolean(s.passwordHash), ownerNickname: s.ownerNickname || null, maxPlayers: s.maxPlayers, weeklyGoalMinutes: s.weeklyGoalMinutes, editPolicy: s.editPolicy || 'anyone', online: this.onlineCount(s.id), createdAt: s.createdAt, ...extra };
  }

  onlineCount(id) {
    const w = this.worlds.get(id);
    return w ? w.connectedCount : 0;
  }

  async memberNames(id) {
    return (await this.store.studyMembers(id)).map((m) => m.nickname);
  }

  /** 마지막 활동 시각 (저장소 + 캐시) — 로비 정렬·60일 삭제 기준 */
  async touch(id, now = this.now()) {
    await this.store.touchStudy(id, now);
    const s = this.studies.get(id);
    if (s) s.lastActiveAt = now;
  }

  /** 접속 중(유예 포함)인 모든 플레이어 (랭킹 '전체' 의 online 표시) */
  allPlayers() {
    const out = [];
    for (const w of this.worlds.values()) out.push(...w.players.values());
    return out;
  }

  /** 접속 중(유예 포함)인 모든 닉네임 */
  takenNicknames() {
    const out = [];
    for (const w of this.worlds.values()) for (const p of w.players.values()) out.push(p.nickname);
    return out;
  }

  findSession(token) {
    if (typeof token !== 'string') return null;
    for (const w of this.worlds.values()) if (w.sessions.has(token)) return { world: w, player: w.sessions.get(token) };
    return null;
  }

  playerByNickname(nickname) {
    for (const w of this.worlds.values()) for (const p of w.players.values()) if (p.nickname === nickname) return { world: w, player: p };
    return null;
  }

  // ── 월드 수명 ───────────────────────────────────────────────────────
  async ensureWorld(id) {
    if (this.worlds.has(id)) return this.worlds.get(id);
    if (this.creating.has(id)) return this.creating.get(id);
    const p = (async () => {
      const world = new World(this.room, {
        ...this.worldRest,
        store: this.store, tz: this.tz, now: this.now, log: this.log,
        study: this.study, goals: this.goals, studyId: id,
        studyInfo: () => this.studies.get(id) || null,
        members: () => this.memberNames(id),
        takenNicknames: () => this.takenNicknames(),
        allPlayers: () => this.allPlayers(),
      });
      world.on('playerLeft', () => this.scheduleRelease(id));
      await world.init();
      this.worlds.set(id, world);
      this.emit('worldCreated', world);
      this.scheduleRelease(id);
      return world;
    })().finally(() => this.creating.delete(id));
    this.creating.set(id, p);
    return p;
  }

  scheduleRelease(id) {
    const w = this.worlds.get(id);
    if (!w || w.players.size > 0) return;
    this.cancelRelease(id);
    const t = setTimeout(() => this.releaseWorld(id).catch((err) => this.log.warn(`[hub] 월드 해제 실패: ${err.message}`)), this.releaseMs);
    t.unref?.();
    this.releaseTimers.set(id, t);
  }

  cancelRelease(id) {
    clearTimeout(this.releaseTimers.get(id));
    this.releaseTimers.delete(id);
  }

  /** 비어 있는 월드를 메모리에서 내린다 (가구·펫은 저장소에 남는다) */
  async releaseWorld(id) {
    this.cancelRelease(id);
    const w = this.worlds.get(id);
    if (!w || w.players.size > 0) return false;
    this.worlds.delete(id);
    await w.dispose();
    this.emit('worldReleased', w);
    return true;
  }

  // ── 만들기 / 설정 ───────────────────────────────────────────────────
  /**
   * 입력 검증. partial 이면 준 값만. @returns {{ ok: true, values } | { ok: false, error }}
   * error: invalid_name | invalid_password | invalid_max_players | invalid_goal | invalid_policy
   */
  validate({ name, password, maxPlayers, weeklyGoalMinutes, editPolicy } = {}, { partial = false } = {}) {
    const v = {};
    if (name !== undefined || !partial) {
      v.name = normalizeName(name);
      if (!v.name) return { ok: false, error: 'invalid_name' };
    }
    if (password !== undefined && password !== null && password !== '') {
      if (typeof password !== 'string') return { ok: false, error: 'invalid_password' };
      const len = [...password].length;
      if (len < PASSWORD_MIN || len > PASSWORD_MAX) return { ok: false, error: 'invalid_password' };
      v.password = password;
    } else if (password === '' || password === null) v.password = null;
    if (maxPlayers !== undefined || !partial) {
      const n = maxPlayers === undefined ? PLAYERS_DEFAULT : Number(maxPlayers);
      if (!Number.isInteger(n) || n < PLAYERS_MIN || n > PLAYERS_MAX) return { ok: false, error: 'invalid_max_players' };
      v.maxPlayers = n;
    }
    if (weeklyGoalMinutes !== undefined || !partial) {
      const n = weeklyGoalMinutes === undefined ? GOAL_DEFAULT : Number(weeklyGoalMinutes);
      if (!Number.isInteger(n) || n < GOAL_MIN || n > GOAL_MAX) return { ok: false, error: 'invalid_goal' };
      v.weeklyGoalMinutes = n;
    }
    if (editPolicy !== undefined || !partial) {
      const p = editPolicy === undefined ? 'anyone' : editPolicy;
      if (!EDIT_POLICIES.includes(p)) return { ok: false, error: 'invalid_policy' };
      v.editPolicy = p;
    }
    return { ok: true, values: v };
  }

  /** 누구나 만들 수 있다. 만든 사람이 방장. @returns {{ ok, study } | { ok:false, error }} */
  async createStudy({ name, password, maxPlayers, weeklyGoalMinutes, editPolicy, ownerNickname } = {}) {
    const v = this.validate({ name, password, maxPlayers, weeklyGoalMinutes, editPolicy });
    if (!v.ok) return v;
    const norm = normalizeNickname(ownerNickname);
    if (!norm.ok) return { ok: false, error: norm.error };
    const passwordHash = v.values.password ? await hashPassword(v.values.password) : null;
    const row = await this.store.createStudy({ code: await this.freshCode(), name: v.values.name, passwordHash, ownerNickname: norm.name, maxPlayers: v.values.maxPlayers, weeklyGoalMinutes: v.values.weeklyGoalMinutes, editPolicy: v.values.editPolicy }, this.now());
    this.studies.set(row.id, row);
    await this.store.upsertMember(row.id, norm.name, this.now());
    const access = passwordHash ? await this.issueAccess(row.id, norm.name) : null; // 만든 기기는 비밀번호를 아는 셈
    this.log.log(`[hub] 스터디 생성: ${row.name} (${row.code}) by ${norm.name}${passwordHash ? ' 🔒' : ''}`);
    return { ok: true, study: this.publicStudy(row), access };
  }

  isOwner(study, nickname) {
    return Boolean(study && study.ownerNickname && study.ownerNickname === nickname);
  }

  /** 방장만: 이름·비밀번호(''/null 이면 해제)·정원·목표·편집 권한. 비밀번호를 바꾸면 기기 토큰 전부 무효 → 방장 기기만 새 토큰(access) */
  async updateStudy(ref, byNickname, patch = {}) {
    const study = this.resolve(ref);
    if (!study) return { ok: false, error: 'no_study' };
    if (!this.isOwner(study, byNickname)) return { ok: false, error: 'forbidden' };
    const v = this.validate(patch, { partial: true });
    if (!v.ok) return v;
    const p = { ...v.values };
    if (patch.password !== undefined) {
      p.passwordHash = v.values.password ? await hashPassword(v.values.password) : null;
      delete p.password;
    }
    if (p.maxPlayers !== undefined) {
      const w = this.worlds.get(study.id);
      if (w && w.players.size > p.maxPlayers) return { ok: false, error: 'too_many_players' };
    }
    const row = await this.store.updateStudy(study.id, p, this.now());
    if (!row) return { ok: false, error: 'no_study' };
    this.studies.set(row.id, row);
    let access = null;
    if (p.passwordHash !== undefined) {
      const n = await this.store.clearAccess(row.id);
      if (row.passwordHash) access = await this.issueAccess(row.id, byNickname);
      this.log.log(`[hub] ${row.name} (${row.code}) 비밀번호 ${row.passwordHash ? '변경' : '해제'} — 기기 토큰 ${n}개 무효`);
    }
    const world = this.worlds.get(row.id) || null;
    if (world && p.weeklyGoalMinutes !== undefined) world.checkWeeklyGoal();
    this.emit('studyUpdated', { study: row, world, passwordChanged: p.passwordHash !== undefined });
    return { ok: true, study: this.publicStudy(row), access };
  }

  /** 방장만: 멤버 내보내기 (소속 삭제 + 그 닉네임의 기기 토큰 무효 + 접속 중이면 방에서 제거). @returns {{ ok, player? }} */
  async kickMember(ref, byNickname, nickname) {
    const study = this.resolve(ref);
    if (!study) return { ok: false, error: 'no_study' };
    if (!this.isOwner(study, byNickname)) return { ok: false, error: 'forbidden' };
    if (nickname === byNickname) return { ok: false, error: 'self' };
    const removed = await this.store.removeMember(study.id, nickname);
    const w = this.worlds.get(study.id);
    const p = w && [...w.players.values()].find((x) => x.nickname === nickname);
    if (p) w.remove(p.id, 'kicked');
    if (!removed && !p) return { ok: false, error: 'not_member' };
    await this.store.clearAccess(study.id, nickname); // 그 닉네임으로 발급된 기기 토큰도 무효 → 다시 들어오려면 비밀번호
    return { ok: true, player: p ? { id: p.id, socketId: p.socketId } : null };
  }

  /** 방장만, 방에 다른 사람이 있으면 불가 (본인만 있거나 비어 있어야). 가구·펫·소속 기록까지 지운다 */
  async deleteStudy(ref, byNickname) {
    const study = this.resolve(ref);
    if (!study) return { ok: false, error: 'no_study' };
    if (!this.isOwner(study, byNickname)) return { ok: false, error: 'forbidden' };
    const w = this.worlds.get(study.id);
    if (w && [...w.players.values()].some((p) => p.nickname !== byNickname)) return { ok: false, error: 'not_empty' };
    if (w) {
      this.cancelRelease(study.id);
      this.worlds.delete(study.id);
      for (const p of [...w.players.values()]) w.remove(p.id, 'deleted');
      await w.dispose();
      this.emit('worldReleased', w);
    }
    await this.store.deleteStudy(study.id);
    this.studies.delete(study.id);
    this.emit('studyDeleted', { study });
    this.log.log(`[hub] 스터디 삭제: ${study.name} (${study.code}) by ${byNickname}`);
    return { ok: true };
  }

  // ── 입장 ────────────────────────────────────────────────────────────
  /** 기기 토큰 발급: 원문은 클라이언트에게만, 저장소엔 sha256 해시. @returns {Promise<string>} 토큰 원문 */
  async issueAccess(studyId, nickname) {
    const token = newAccessToken();
    await this.store.createAccess(studyId, hashToken(token), nickname, this.now());
    return token;
  }

  /** 기기 토큰이 이 스터디에 유효한지 (비밀번호 변경·해제 뒤 발급된 것만 남아 있다). 유효하면 last_used_at 갱신 */
  async checkAccess(study, token) {
    const h = hashToken(token);
    if (!h) return false;
    const row = await this.store.findAccess(study.id, h);
    if (!row) return false;
    await this.store.touchAccess(study.id, h, this.now());
    return true;
  }

  /**
   * 입장. token(세션) 이 살아 있으면(같은 스터디거나 스터디를 안 골랐으면) 이어받는다.
   * 잠긴 스터디: studyAccess(기기 토큰) 가 유효하면 비밀번호 생략, 아니면 studyPassword 를 검사하고 맞으면 새 기기 토큰(access)을 돌려준다.
   * @returns {Promise<{ ok: true, world, player, study, resumed, oldSocketId, access: string|null } |
   *   { ok: false, error: 'no_study' | 'study_full' | 'password_required' | 'wrong_password' | 'locked' | 닉네임 오류, remaining?, retryAfterMs? }>}
   */
  async join({ study: ref, nickname, token, avatar, socketId, studyPassword, studyAccess, key = 'unknown' } = {}) {
    const found = this.findSession(token);
    const target = this.resolve(ref);
    if (found && (!target || target.id === found.world.studyId)) {
      const res = found.world.join({ token, socketId });
      this.cancelRelease(found.world.studyId);
      return { ok: true, world: found.world, player: res.player, study: this.studies.get(found.world.studyId), resumed: true, oldSocketId: res.oldSocketId, access: null };
    }
    if (found) found.world.remove(found.player.id, 'leave'); // 다른 스터디로 옮겨 간다
    if (!target) return { ok: false, error: 'no_study' };
    const norm = normalizeNickname(nickname);
    if (!norm.ok) return { ok: false, error: norm.error };
    const name = uniqueNickname(norm.name, this.takenNicknames());
    const world = await this.ensureWorld(target.id);
    const study = this.studies.get(target.id);
    if (!study) return { ok: false, error: 'no_study' };
    if (world.players.size >= study.maxPlayers) return { ok: false, error: 'study_full' };
    let issue = false;
    if (study.passwordHash && !(await this.checkAccess(study, studyAccess))) {
      const g = await this.gate.check(`${key}|${study.id}`, studyPassword, study.passwordHash);
      if (!g.ok) return g;
      issue = true;
      if (world.players.size >= study.maxPlayers) return { ok: false, error: 'study_full' }; // 해시 계산 사이에 찼을 수 있다
    }
    const res = world.join({ nickname: name, avatar, socketId });
    if (!res.ok) return res;
    this.cancelRelease(study.id);
    const access = issue ? await this.issueAccess(study.id, res.player.nickname) : null;
    await this.store.upsertMember(study.id, res.player.nickname, this.now());
    await this.touch(study.id);
    if (!study.ownerNickname) {
      const row = await this.store.updateStudy(study.id, { ownerNickname: res.player.nickname }, this.now());
      if (row) { this.studies.set(row.id, row); this.emit('studyUpdated', { study: row, world, passwordChanged: false }); }
    }
    return { ok: true, world, player: res.player, study: this.studies.get(study.id), resumed: false, oldSocketId: null, access };
  }

  // ── 로비 / 정보 ─────────────────────────────────────────────────────
  /** 스터디별 이번 주 합계(초, 진행 중 포함)와 멤버 이름 */
  async weekTotals() {
    const members = await this.store.listMembers();
    const rows = await this.study.stats([]);
    const week = new Map(rows.map((r) => [r.nickname, r.weekSeconds]));
    const out = new Map();
    for (const m of members) {
      const e = out.get(m.studyId) || { members: [], weekSeconds: 0 };
      e.members.push(m.nickname);
      e.weekSeconds += week.get(m.nickname) || 0;
      out.set(m.studyId, e);
    }
    return out;
  }

  /** 그룹 스트릭: 멤버 중 한 명이라도 출석한 연속 일수 */
  async groupStreak(nicknames) {
    if (!nicknames.length) return 0;
    const dates = await this.store.attendanceDates(nicknames);
    return streakOf(dates, this.today()).streak;
  }

  /**
   * 로비: 내 스터디(소속·방장) 카드 + 다른 공개 목록.
   * mine: [{ ...publicStudy, weekSeconds, streak, reached, memberCount, isOwner }], others: [{ code, name, locked, weekSeconds, online, maxPlayers }]
   */
  async lobby(nickname) {
    const totals = await this.weekTotals();
    const week = weekStart(this.today());
    const mine = [];
    const others = [];
    for (const s of [...this.studies.values()].sort((a, b) => (b.lastActiveAt || 0) - (a.lastActiveAt || 0))) {
      const t = totals.get(s.id) || { members: [], weekSeconds: 0 };
      const isMember = t.members.includes(nickname) || this.isOwner(s, nickname);
      if (isMember) {
        mine.push(this.publicStudy(s, { weekSeconds: t.weekSeconds, streak: await this.groupStreak(t.members), reached: await this.store.weeklyGoalReached(s.id, week), memberCount: t.members.length, isOwner: this.isOwner(s, nickname) }));
      } else {
        others.push({ code: s.code, name: s.name, locked: Boolean(s.passwordHash), weekSeconds: t.weekSeconds, online: this.onlineCount(s.id), maxPlayers: s.maxPlayers });
      }
    }
    return { ok: true, nickname, mine, others };
  }

  /** 링크(?study=CODE)로 들어올 때 입장 화면에 보여줄 것 */
  lookup(ref) {
    const s = this.resolve(ref);
    if (!s) return { ok: false, error: 'no_study' };
    return { ok: true, study: { code: s.code, name: s.name, locked: Boolean(s.passwordHash), online: this.onlineCount(s.id), maxPlayers: s.maxPlayers, weeklyGoalMinutes: s.weeklyGoalMinutes } };
  }

  /** 스터디 정보 팝오버: 멤버(접속 중/오프라인·이번 주 시간) · 이번 주 목표 진행 · 그룹 스트릭 · 방장 여부 */
  async info(ref, nickname) {
    const s = this.resolve(ref);
    if (!s) return { ok: false, error: 'no_study' };
    const members = await this.store.studyMembers(s.id);
    const w = this.worlds.get(s.id);
    const online = new Map();
    if (w) for (const p of w.players.values()) online.set(p.nickname, p.connected);
    const rows = await this.study.stats([]);
    const weekOf = new Map(rows.map((r) => [r.nickname, r.weekSeconds]));
    const names = new Set(members.map((m) => m.nickname));
    for (const n of online.keys()) names.add(n);
    const list = [...names].map((n) => {
      const m = members.find((x) => x.nickname === n);
      return { nickname: n, online: online.has(n), connected: online.get(n) ?? false, weekSeconds: weekOf.get(n) || 0, lastSeenAt: m ? m.lastSeenAt : null, isOwner: this.isOwner(s, n) };
    }).sort((a, b) => (a.online !== b.online ? (a.online ? -1 : 1) : b.weekSeconds - a.weekSeconds || a.nickname.localeCompare(b.nickname)));
    const week = weekStart(this.today());
    let total = 0;
    for (const m of list) total += m.weekSeconds;
    return {
      ok: true,
      study: this.publicStudy(s, { isOwner: this.isOwner(s, nickname), memberCount: list.length }),
      members: list,
      week: { weekStart: week, totalSeconds: total, targetSeconds: s.weeklyGoalMinutes * 60, reached: await this.store.weeklyGoalReached(s.id, week) },
      streak: await this.groupStreak([...names]),
    };
  }

  /** 접속 중인 인원 (모든 스터디) */
  get connectedCount() {
    let n = 0;
    for (const w of this.worlds.values()) n += w.connectedCount;
    return n;
  }

  /** 종료: 모든 월드 정리 → 공유 트래커의 세션 저장 */
  async dispose() {
    clearInterval(this.goalTimer);
    this.goalTimer = null;
    for (const t of this.releaseTimers.values()) clearTimeout(t);
    this.releaseTimers.clear();
    const worlds = [...this.worlds.values()];
    this.worlds.clear();
    for (const w of worlds) await w.dispose();
    await this.study.flushAll('shutdown');
  }
}

module.exports = { Hub, randomCode, normalizeCode, normalizeName, CODE_LEN, CODE_CHARS, NAME_MAX, PASSWORD_MIN, PASSWORD_MAX, PLAYERS_MIN, PLAYERS_MAX, PLAYERS_DEFAULT, GOAL_MIN, GOAL_MAX, GOAL_DEFAULT, EDIT_POLICIES, RELEASE_MS, INACTIVE_MS, DEFAULT_NAME };
