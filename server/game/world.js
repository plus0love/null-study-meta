'use strict';
/**
 * 방 하나의 실시간 상태 (소켓과 무관한 순수 로직).
 *  - 플레이어 입장/퇴장, 닉네임 중복 처리, 세션 토큰으로 재접속
 *  - 이동 검증(예산 방식), 좌석 점유, 상태(공부/휴식/☕휴식), 채팅 검증, 뽀모도로
 *  - 상호작용 지점(커피머신 앞 E → 'coffee' 상태), 듣는 중(유튜브 제목) 표시
 *  - 4단계: 영구 데이터는 store(메모리/Supabase) — 공부 세션·출석·오늘 목표·할 일·강아지 이름. 실시간 상태는 계속 메모리.
 *  - 5단계: 아바타는 파츠 객체(avatar.js 카탈로그 검증) — users.avatar 에 저장하고 재입장 시 복원.
 * 이벤트: 'playerLeft' (유예 시간이 지나 정리될 때), 'pomodoro' (snap, reason, player — 개인 타이머 상태 변화),
 *         'npcUpdate' (NPC 스냅샷, 10Hz), 'npcPet' ({ npc, by, nickname }), 'npcName' ({ npc, name }),
 *         'sessionSaved' { nickname, playerId, seconds }, 'attendance' { nickname, playerId, streak, weekDays, inserted },
 *         'goalReached' { nickname, playerId, todaySeconds, targetMinutes }
 */
const EventEmitter = require('node:events');
const crypto = require('node:crypto');

const { normalizeNickname, uniqueNickname } = require('./nickname');
const { SPEED, FEET_W, FEET_H, applyMove, maxBudget, canStand } = require('./movement');
const { sanitizeChat, createRateLimiter, MAX_LEN: CHAT_MAX } = require('./chat');
const { Pomodoro } = require('./pomodoro');
const { DogNpc } = require('./npc');
const { StudyTracker } = require('./study');
const { createMemoryStore } = require('../store/memory');
const { DEFAULT_TZ, dateKey, isValidTz } = require('../store/stats');
const { FACING_DELTA, interactableById } = require('../rooms/build');
const { normalizeAvatar } = require('./avatar');

const GRACE_MS = 30 * 1000; // 연결 끊김 후 플레이어를 유지하는 시간
const SIT_RANGE_PX = 56; // 좌석 중심까지 이 거리 안이어야 앉을 수 있다 (대각선 인접 포함)
const STATUSES = ['study', 'rest', 'coffee']; // coffee = 커피머신 앞에서 E ("☕ 휴식"). 수동 토글은 study/rest 만
const MANUAL_STATUSES = ['study', 'rest'];
const LISTENING_MAX = 80;
const EMOJIS = ['👋', '😊', '👍', '❤️', '😂', '🔥'];
const FACINGS = Object.keys(FACING_DELTA);
const GOAL_TEXT_MAX = 20;
const GOAL_MIN = 30; // 분
const GOAL_MAX = 8 * 60;
const GOAL_STEP = 30;
const TODO_MAX = 60;

function seatCenter(room, seat) {
  return { x: (seat.x + 0.5) * room.tileSize, y: (seat.y + 1) * room.tileSize };
}

class World extends EventEmitter {
  constructor(room, { graceMs = GRACE_MS, pomodoro = {}, npc = {}, now = () => Date.now(), store = null, tz = DEFAULT_TZ, study = {}, log = console } = {}) {
    super();
    this.room = room;
    this.now = now;
    this.log = log;
    this.graceMs = graceMs;
    this.store = store || createMemoryStore();
    this.tz = isValidTz(tz) ? tz : DEFAULT_TZ;
    this.goals = new Map(); // nickname → { date, goalText, targetMinutes } (오늘 것만 캐시)
    this.study = new StudyTracker({ store: this.store, tz: this.tz, now, log, goalOf: (n) => this.goalOf(n), ...study });
    this.study.on('saved', (e) => this.emit('sessionSaved', e));
    this.study.on('attendance', (e) => this.emit('attendance', e));
    this.study.on('goalReached', (e) => this.emit('goalReached', e));
    this.players = new Map(); // id → player
    this.sessions = new Map(); // token → player
    this.seatOwners = new Map(); // seatId → playerId
    this.graceTimers = new Map(); // playerId → timeout
    this.chatLimiter = createRateLimiter();
    this.pomodoroOpts = { ...pomodoro, now }; // 개인 타이머 기본값 (테스트: focusMs/breakMs)
    this.pomodoros = new Map(); // playerId → Pomodoro (7단계: 개인별, 퇴장하면 정리)

    // 강아지 NPC: 접속 중인 플레이어 위치를 보고 행동한다. npc.autoStart === false 면 테스트가 직접 tick() 한다.
    this.dog = new DogNpc(room, { ...npc, now });
    this.dog.players = () => [...this.players.values()].filter((p) => p.connected);
    this.dog.on('update', (snap) => this.emit('npcUpdate', snap));
    this.dog.on('pet', ({ by, id }) => this.emit('npcPet', { npc: this.dog.id, by, playerId: id, name: this.dog.name }));
    this.dog.on('name', (name) => this.emit('npcName', { npc: this.dog.id, name }));
    this.npcs = [this.dog];
    if (npc.autoStart !== false) this.dog.start();
  }

  /** 저장소에서 초기 상태 로드 (강아지 이름, 저장된 합계). 서버 시작 시 한 번 */
  async init() {
    try {
      const name = await this.store.getLatestDogName();
      if (name) this.dog.setName(name);
      await this.study.refreshTotals();
    } catch (err) {
      this.log.warn(`[world] 저장소 초기 로드 실패: ${err.message}`);
    }
    return this;
  }

  today() {
    return dateKey(this.now(), this.tz);
  }

  npcSnapshots() {
    return this.npcs.map((n) => n.snapshot());
  }

  npcById(id) {
    return this.npcs.find((n) => n.id === id) || null;
  }

  get config() {
    return { speed: SPEED, feetW: FEET_W, feetH: FEET_H, sendHz: 20, chatMax: CHAT_MAX, emojis: EMOJIS, graceMs: this.graceMs };
  }

  /** 다른 클라이언트에 보내는 공개 정보 */
  publicPlayer(p) {
    return { id: p.id, nickname: p.nickname, avatar: p.avatar, x: p.x, y: p.y, facing: p.facing, moving: p.moving, status: p.status, seatId: p.seatId, connected: p.connected, listening: p.listening || null, goal: this.publicGoal(p.nickname) };
  }

  listPlayers() {
    return [...this.players.values()].map((p) => this.publicPlayer(p));
  }

  /** 접속 중인 인원 (유예 중인 플레이어 제외) */
  get connectedCount() {
    let n = 0;
    for (const p of this.players.values()) if (p.connected) n++;
    return n;
  }

  // ── 입장 / 재접속 / 퇴장 ──────────────────────────────────────────
  /**
   * @returns {{ ok: true, player, resumed: boolean } | { ok: false, error }}
   */
  /** 살아 있는 세션 토큰인지 (유예 중 포함) — 게이트가 재접속을 비밀번호 없이 통과시킬 때 사용 */
  hasSession(token) {
    return typeof token === 'string' && this.sessions.has(token);
  }

  join({ nickname, token, avatar, socketId }) {
    if (token && this.sessions.has(token)) {
      const player = this.sessions.get(token);
      const oldSocketId = player.socketId;
      player.socketId = socketId;
      player.connected = true;
      player.disconnectedAt = null;
      clearTimeout(this.graceTimers.get(player.id));
      this.graceTimers.delete(player.id);
      return { ok: true, player, resumed: true, oldSocketId: oldSocketId !== socketId ? oldSocketId : null };
    }
    const norm = normalizeNickname(nickname);
    if (!norm.ok) return { ok: false, error: norm.error };
    const name = uniqueNickname(norm.name, [...this.players.values()].map((p) => p.nickname));
    const id = crypto.randomBytes(6).toString('hex');
    const newToken = crypto.randomBytes(24).toString('base64url');
    const player = {
      id,
      token: newToken,
      socketId,
      nickname: name,
      avatar: normalizeAvatar(avatar), // 5단계: 파츠 객체 (옛 정수 값도 상의 색으로 변환)
      avatarProvided: avatar !== undefined && avatar !== null, // 안 보냈으면 loadProfile 에서 users.avatar 복원
      x: this.room.spawn.x,
      y: this.room.spawn.y,
      facing: 'down',
      moving: false,
      status: 'rest',
      prevStatus: 'rest',
      seatId: null,
      listening: null, // 유튜브 카드에서 재생 중인 영상 제목 (본인만 소리, 남들에겐 ♪ 표시)
      connected: true,
      disconnectedAt: null,
      budget: maxBudget(),
      lastMoveAt: this.now(),
      joinedAt: this.now(),
    };
    this.players.set(id, player);
    this.sessions.set(newToken, player);
    this.store.upsertUser(name, player.avatarProvided ? { avatar: player.avatar } : {}).catch((err) => this.log.warn(`[world] 사용자 저장 실패: ${err.message}`));
    return { ok: true, player, resumed: false, oldSocketId: null };
  }

  /** 입장 ack 에 실을 영구 데이터: 오늘 목표 · 출석 스트릭 · (클라이언트가 아바타를 안 보냈으면) 저장된 아바타 복원. 실패해도 입장은 된다 */
  async loadProfile(player) {
    const out = { goal: null, streak: { streak: 0, weekDays: 0, attendedToday: false } };
    try {
      if (!player.avatarProvided) {
        const u = await this.store.getUser(player.nickname);
        if (u && u.avatar !== null && u.avatar !== undefined) player.avatar = normalizeAvatar(u.avatar);
        player.avatarProvided = true;
      }
      const date = this.today();
      const g = await this.store.getGoal(player.nickname, date);
      if (g) this.goals.set(player.nickname, g);
      else this.goals.delete(player.nickname);
      out.goal = this.publicGoal(player.nickname);
      out.streak = await this.store.attendanceOf(player.nickname, { tz: this.tz, now: this.now() });
    } catch (err) {
      this.log.warn(`[world] 프로필 로드 실패 (${player.nickname}): ${err.message}`);
    }
    return out;
  }

  bySocket(socketId) {
    for (const p of this.players.values()) if (p.socketId === socketId && p.connected) return p;
    return null;
  }

  /** 소켓이 끊겼다: 유예 시간 동안 플레이어를 유지하고, 지나면 정리한다. */
  disconnect(player) {
    if (!player.connected) return;
    player.connected = false;
    player.moving = false;
    player.disconnectedAt = this.now();
    const t = setTimeout(() => this.remove(player.id, 'timeout'), this.graceMs);
    t.unref?.();
    this.graceTimers.set(player.id, t);
  }

  /** 즉시 퇴장 (나가기 버튼) 또는 유예 만료 */
  remove(id, reason = 'leave') {
    const player = this.players.get(id);
    if (!player) return null;
    clearTimeout(this.graceTimers.get(id));
    this.graceTimers.delete(id);
    if (player.seatId) this.seatOwners.delete(player.seatId);
    this.players.delete(id);
    this.sessions.delete(player.token);
    this.chatLimiter.forget(id);
    const pomo = this.pomodoros.get(id);
    if (pomo) { pomo.dispose(); this.pomodoros.delete(id); }
    player.removed = true;
    this.study.sync(player); // 앉은 채 나가면 세션 저장
    this.emit('playerLeft', player, reason);
    return player;
  }

  // ── 이동 ────────────────────────────────────────────────────────────
  /** @returns {{ ok: true } | { ok: false, reason, x, y }} */
  move(player, payload) {
    if (!payload || typeof payload !== 'object') return { ok: false, reason: 'invalid', x: player.x, y: player.y };
    if (player.seatId) return { ok: false, reason: 'seated', x: player.x, y: player.y };
    const res = applyMove(this.room, player, { x: Number(payload.x), y: Number(payload.y) }, this.now());
    if (FACINGS.includes(payload.facing)) player.facing = payload.facing;
    player.moving = Boolean(payload.moving);
    if (!res.ok) return { ok: false, reason: res.reason, x: player.x, y: player.y };
    return { ok: true };
  }

  // ── 좌석 ────────────────────────────────────────────────────────────
  seat(seatId) {
    return this.room.seats.find((s) => s.id === seatId) || null;
  }

  /** @returns {{ ok: true, seat } | { ok: false, error }} */
  sit(player, seatId) {
    if (player.seatId) return { ok: false, error: 'already_seated' };
    const seat = this.seat(seatId);
    if (!seat) return { ok: false, error: 'no_seat' };
    const owner = this.seatOwners.get(seatId);
    if (owner && owner !== player.id) return { ok: false, error: 'occupied' };
    const c = seatCenter(this.room, seat);
    if (Math.hypot(c.x - player.x, c.y - player.y) > SIT_RANGE_PX) return { ok: false, error: 'too_far' };
    this.seatOwners.set(seatId, player.id);
    player.seatId = seatId;
    player.x = c.x;
    player.y = c.y;
    player.facing = seat.facing;
    player.moving = false;
    // 커피(☕ 휴식) 중에 앉으면 공부 중 → 일어날 때는 커피가 아니라 휴식으로
    player.prevStatus = player.status === 'coffee' ? 'rest' : player.status;
    player.status = 'study';
    this.study.sync(player);
    return { ok: true, seat };
  }

  /** @returns {{ ok: true } | { ok: false, error }} */
  stand(player) {
    if (!player.seatId) return { ok: false, error: 'not_seated' };
    this.seatOwners.delete(player.seatId);
    player.seatId = null;
    player.status = player.prevStatus || 'rest';
    player.budget = maxBudget();
    player.lastMoveAt = this.now();
    this.study.sync(player);
    return { ok: true };
  }

  seatSnapshot() {
    return Object.fromEntries(this.seatOwners);
  }

  // ── 상태 / 채팅 / 이모지 ────────────────────────────────────────────
  setStatus(player, status) {
    if (!MANUAL_STATUSES.includes(status)) return { ok: false, error: 'invalid' };
    player.status = status;
    player.prevStatus = status;
    this.study.sync(player); // 앉은 채 휴식으로 바꾸면 세션 종료, 다시 공부면 새 세션
    return { ok: true };
  }

  /**
   * 상호작용 지점 (room.interactables) 에서 E: 거리 검사 후 종류별 효과.
   *  - coffee: 앉아 있지 않으면 'coffee' 상태 (☕ 휴식). 이미 커피 중이면 휴식으로 되돌린다.
   *  - music: 클라이언트 전용(유튜브 카드) — 서버는 거리만 확인한다.
   * @returns {{ ok: true, kind, status? } | { ok: false, error }}
   */
  interact(player, id) {
    const it = interactableById(this.room, id);
    if (!it) return { ok: false, error: 'no_interactable' };
    if (Math.hypot(it.x - player.x, it.y - player.y) > it.range) return { ok: false, error: 'too_far' };
    if (it.kind === 'coffee') {
      if (player.seatId) return { ok: false, error: 'seated' };
      player.status = player.status === 'coffee' ? 'rest' : 'coffee';
      player.prevStatus = player.status;
      return { ok: true, kind: it.kind, status: player.status };
    }
    return { ok: true, kind: it.kind };
  }

  /** 듣는 중 표시: 제목(≤80자, 제어문자 제거) 또는 null */
  setListening(player, title) {
    if (title === null || title === undefined || title === '') {
      player.listening = null;
      return { ok: true, listening: null };
    }
    if (typeof title !== 'string') return { ok: false, error: 'invalid' };
    // eslint-disable-next-line no-control-regex
    const clean = title.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, LISTENING_MAX);
    player.listening = clean || null;
    return { ok: true, listening: player.listening };
  }

  /** 아바타 변경: catalog 기준으로 정규화(없는 id → 기본값)하고 users.avatar 에 저장 */
  setAvatar(player, avatar) {
    player.avatar = normalizeAvatar(avatar);
    player.avatarProvided = true;
    this.store.upsertUser(player.nickname, { avatar: player.avatar }).catch((err) => this.log.warn(`[world] 아바타 저장 실패: ${err.message}`));
    return { ok: true, avatar: player.avatar };
  }

  chat(player, raw) {
    const s = sanitizeChat(raw);
    if (!s.ok) return s;
    if (!this.chatLimiter.allow(player.id, this.now())) return { ok: false, error: 'too_fast' };
    return { ok: true, text: s.text, ts: this.now() };
  }

  emoji(index) {
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0 || i >= EMOJIS.length) return null;
    return EMOJIS[i];
  }

  // ── 개인 뽀모도로 ──────────────────────────────────────────────────
  /** 플레이어의 타이머 (없으면 기본값으로 생성). 재접속으로 이어받으면 그대로 유지된다 */
  pomodoroOf(player) {
    let p = this.pomodoros.get(player.id);
    if (!p) {
      p = new Pomodoro(this.pomodoroOpts);
      p.on('change', (snap, reason) => this.emit('pomodoro', snap, reason, player));
      this.pomodoros.set(player.id, p);
    }
    return p;
  }

  /**
   * 내 타이머 시작. focusMinutes/breakMinutes 를 주면 먼저 설정(20~90 / 5~20분)하고 시작한다.
   * @returns {{ ok: true, ...snapshot } | { ok: false, error: 'running' | 'invalid_focus' | 'invalid_break' }}
   */
  startPomodoro(player, { focusMinutes, breakMinutes } = {}) {
    const pomo = this.pomodoroOf(player);
    if (pomo.running) return { ok: false, error: 'running' };
    if (focusMinutes !== undefined || breakMinutes !== undefined) {
      const c = pomo.configure({ focusMinutes: focusMinutes ?? pomo.focusMs / 60000, breakMinutes: breakMinutes ?? pomo.breakMs / 60000 });
      if (!c.ok) return c;
    }
    pomo.start(player.nickname);
    return { ok: true, ...pomo.snapshot() };
  }

  stopPomodoro(player) {
    const pomo = this.pomodoros.get(player.id);
    if (!pomo || !pomo.stop(player.nickname)) return { ok: false, error: 'not_running' };
    return { ok: true, ...pomo.snapshot() };
  }

  // ── 오늘 목표 / 랭킹 / 할 일 (영구 데이터) ──────────────────────────
  goalOf(nickname) {
    const g = this.goals.get(nickname);
    return g && g.date === this.today() ? g : null;
  }

  publicGoal(nickname) {
    const g = this.goalOf(nickname);
    return g ? { text: g.goalText || '', targetMinutes: g.targetMinutes || 0 } : null;
  }

  /** 목표 한 줄(≤20자) + 목표 시간(30분~8시간, 30분 단위). @returns {{ ok, goal, reached(이미 달성 상태인지) } | { ok: false, error }} */
  async setGoal(player, { text, targetMinutes } = {}) {
    const goalText = String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
    const mins = Number(targetMinutes);
    if (goalText.length > GOAL_TEXT_MAX) return { ok: false, error: 'text_too_long' };
    if (!Number.isInteger(mins) || mins < GOAL_MIN || mins > GOAL_MAX || mins % GOAL_STEP !== 0) return { ok: false, error: 'invalid_minutes' };
    const date = this.today();
    const g = await this.store.setGoal(player.nickname, date, { goalText, targetMinutes: mins });
    this.goals.set(player.nickname, { ...g, date });
    // 이미 넘어 있는 목표는 조용히 달성 처리(🎉 없음). reached 는 그 사실만 알려준다
    const reached = this.study.markGoal(player.nickname, true) || this.study.todaySeconds(player.nickname) >= mins * 60;
    return { ok: true, goal: this.publicGoal(player.nickname), reached };
  }

  /**
   * 내 기록 초기화(7단계): 공부 세션·출석·오늘 목표·할 일을 지운다 (아바타·강아지 이름은 유지).
   * 본인 확인: 세션 토큰 + 닉네임이 모두 일치해야 한다. 앉아서 공부 중이면 지금부터 새 세션을 센다.
   * @returns {{ ok: true, counts } | { ok: false, error: 'confirm_mismatch' }}
   */
  async resetProfile(player, { nickname, token } = {}) {
    if (typeof token !== 'string' || token !== player.token || nickname !== player.nickname) return { ok: false, error: 'confirm_mismatch' };
    this.study.reset(player.nickname);
    const counts = await this.store.resetUser(player.nickname);
    this.goals.delete(player.nickname);
    this.study.sync(player);
    this.log.log(`[world] 기록 초기화 ${player.nickname}: ${JSON.stringify(counts)}`);
    return { ok: true, counts };
  }

  async stats() {
    const rows = await this.study.stats([...this.players.values()]);
    return { ok: true, store: this.store.kind, tz: this.tz, date: this.today(), rows };
  }

  todoOpts() {
    return { tz: this.tz, now: this.now() };
  }

  async listTodos(player) {
    return this.store.listTodos(player.nickname, this.todoOpts());
  }

  async addTodo(player, text) {
    const t = String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, TODO_MAX);
    if (!t) return { ok: false, error: 'empty' };
    return { ok: true, todo: await this.store.addTodo(player.nickname, t, this.now()) };
  }

  async setTodoDone(player, id, done) {
    const todo = await this.store.setTodoDone(player.nickname, id, Boolean(done), this.now());
    return todo ? { ok: true, todo } : { ok: false, error: 'not_found' };
  }

  async deleteTodo(player, id) {
    return { ok: await this.store.deleteTodo(player.nickname, id) };
  }

  /** 강아지 이름 변경 → users.dog_name (방 전체 공용이라 마지막 변경값을 시작 시 쓴다) */
  setDogName(player, raw) {
    const res = this.dog.setName(raw);
    if (res.ok) this.store.upsertUser(player.nickname, { dogName: res.name }).catch((err) => this.log.warn(`[world] 강아지 이름 저장 실패: ${err.message}`));
    return res;
  }

  /** 플레이어 위치가 유효한지 (테스트/디버그용) */
  canStand(x, y) {
    return canStand(this.room, x, y);
  }

  /** 종료: 진행 중인 공부 세션을 모두 저장한 뒤 정리 (SIGTERM 에서 await) */
  async dispose() {
    for (const t of this.graceTimers.values()) clearTimeout(t);
    this.graceTimers.clear();
    for (const p of this.pomodoros.values()) p.dispose();
    this.pomodoros.clear();
    for (const n of this.npcs) n.dispose();
    await this.study.flushAll('shutdown');
  }
}

module.exports = { World, GRACE_MS, SIT_RANGE_PX, EMOJIS, STATUSES, MANUAL_STATUSES, LISTENING_MAX, GOAL_TEXT_MAX, GOAL_MIN, GOAL_MAX, GOAL_STEP, TODO_MAX, seatCenter };
