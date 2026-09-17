'use strict';
/**
 * 방 하나의 실시간 상태 (소켓과 무관한 순수 로직).
 *  - 플레이어 입장/퇴장, 닉네임 중복 처리, 세션 토큰으로 재접속
 *  - 이동 검증(예산 방식), 좌석 점유, 상태(공부/휴식/☕휴식), 채팅 검증, 뽀모도로
 *  - 상호작용 지점(커피머신 앞 E → 'coffee' 상태), 듣는 중(유튜브 제목) 표시
 *  - 4단계: 영구 데이터는 store(메모리/Supabase) — 공부 세션·출석·오늘 목표·할 일·강아지 이름. 실시간 상태는 계속 메모리.
 *  - 5단계: 아바타는 파츠 객체(avatar.js 카탈로그 검증) — users.avatar 에 저장하고 재입장 시 복원.
 *  - 8단계: 코인 — 세션 저장 시 10분당 1코인(남은 초는 users.coin_carry_seconds 로 이월), 집중 사이클 완주(앉아서 공부 중 유지) 시 5코인 (coins.js).
 *    잔액·원장·이월 초·인벤토리는 store.
 *    상점(shop.js) — purchase 는 잔액 확인·차감·원장·인벤토리까지 한다 (색/종류 variant 선택).
 *  - 9단계: 가구. 공용 가구 배치(layout: room_layout, 규칙은 layout.js)·편집 모드·가구 잠금(먼저 잡은 사람 우선)·
 *    권한(놓은 사람의 "내가 놓은 것만" 설정)·충돌 맵 반영(this.room.collision 을 다시 만든다)·동적 좌석(빈백/안마의자/침대 = f:<id>).
 *    침대·안마의자에 앉으면 자동 휴식(공부로 못 바꿈, 세션 안 쌓임). 책상 소품은 users.desk_items 슬롯 3개 → player.deskItems.
 *  - 10단계: 펫. 개인 펫(FollowerNpc 'p:<playerId>', users.pet_config: 활성 펫·이름·꾸미기·스킬) · 공용 펫(SharedPetNpc/FishNpc 's:<roomPetId>',
 *    room_pets, 최대 3마리, 푼 사람만 이름/회수) · 기존 강아지의 꾸미기/스킬은 room_pets 의 item_id 'dog' 행. 쓰다듬기는 종별 반응 이모지.
 *    스킬은 펫별 1회 구매(shop:buy target): 'come'(채팅에 이름 → comeTo) · 'sleep_beside' · 'high_five'.
 * 이벤트: 'playerLeft' (유예 시간이 지나 정리될 때), 'pomodoro' (snap, reason, player — 개인 타이머 상태 변화),
 *         'npcUpdate' (NPC 스냅샷, 10Hz), 'npcPet' ({ npc, by, playerId, name, reaction, highFive }), 'npcName' ({ npc, name }), 'npcRemoved' ({ id }),
 *         'sessionSaved' { nickname, playerId, seconds }, 'attendance' { nickname, playerId, streak, weekDays, inserted },
 *         'goalReached' { nickname, playerId, todaySeconds, targetMinutes },
 *         'coins' { nickname, playerId, delta, reason, balance } (코인 증감이 저장된 뒤)
 *         'layout' { op: 'add'|'move'|'remove'|'grab'|'release', entry?, id?, by } (배치 변경 — 소켓이 layout:update 로 방송)
 *         'desk' { player } (책상 소품 변경), 'editing' { player } (편집 모드 on/off)
 */
const EventEmitter = require('node:events');
const crypto = require('node:crypto');

const { normalizeNickname, uniqueNickname } = require('./nickname');
const { SPEED, FEET_W, FEET_H, applyMove, maxBudget, canStand } = require('./movement');
const { sanitizeChat, createRateLimiter, MAX_LEN: CHAT_MAX } = require('./chat');
const { Pomodoro } = require('./pomodoro');
const { DogNpc, SharedPetNpc, FishNpc, FollowerNpc, SPECIES: PET_SPECIES } = require('./npc');
const { StudyTracker } = require('./study');
const { createMemoryStore } = require('../store/memory');
const { DEFAULT_TZ, dateKey, isValidTz } = require('../store/stats');
const { FACING_DELTA, interactableById } = require('../rooms/build');
const { normalizeAvatar } = require('./avatar');
const { settleStudy, focusBonusFor } = require('./coins');
const { createShop, pickVariant, PET_SLOTS } = require('./shop');
const { validatePlacement, buildCollision, seatOf, cellsOf } = require('./layout');

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
const LOCK_MS = 30 * 1000; // 편집 잠금: 잡은 뒤 이만큼 손대지 않으면 풀린다
const DESK_SLOTS = 3;
const RESTING_SEATS = new Set(['bed', 'massage']); // 앉으면 자동 휴식 (공부로 못 바꿈)
const MAX_SHARED_PETS = 3;
const PET_NAME_MAX = 8;

function seatCenter(room, seat) {
  return { x: (seat.x + 0.5) * room.tileSize, y: (seat.y + 1) * room.tileSize };
}

class World extends EventEmitter {
  constructor(room, { graceMs = GRACE_MS, pomodoro = {}, npc = {}, now = () => Date.now(), store = null, tz = DEFAULT_TZ, study = {}, shop = undefined, log = console } = {}) {
    super();
    // 충돌 맵은 배치 가구에 따라 바뀌므로 방 데이터를 얕게 복사하고 collision 만 새로 만든다 (NPC 도 같은 객체를 본다)
    this.baseRoom = room;
    this.room = { ...room, collision: room.collision.map((r) => r.slice()) };
    this.roomId = room.id;
    this.now = now;
    this.log = log;
    this.graceMs = graceMs;
    this.store = store || createMemoryStore();
    this.tz = isValidTz(tz) ? tz : DEFAULT_TZ;
    this.goals = new Map(); // nickname → { date, goalText, targetMinutes } (오늘 것만 캐시)
    this.study = new StudyTracker({ store: this.store, tz: this.tz, now, log, goalOf: (n) => this.goalOf(n), ...study });
    this.study.on('saved', (e) => { this.emit('sessionSaved', e); this.settleSession(e); });
    this.study.on('attendance', (e) => this.emit('attendance', e));
    this.study.on('goalReached', (e) => this.emit('goalReached', e));
    this.players = new Map(); // id → player
    this.sessions = new Map(); // token → player
    this.seatOwners = new Map(); // seatId → playerId
    this.graceTimers = new Map(); // playerId → timeout
    this.chatLimiter = createRateLimiter();
    this.pomodoroOpts = { ...pomodoro, now }; // 개인 타이머 기본값 (테스트: focusMs/breakMs)
    this.pomodoros = new Map(); // playerId → Pomodoro (7단계: 개인별, 퇴장하면 정리)
    this.shop = createShop(shop); // 8단계: 카탈로그 (테스트는 임시 아이템을 넣는다)
    this.pendingAwards = new Set(); // 진행 중인 코인 저장 Promise (dispose 가 기다림)
    this.layout = new Map(); // 9단계: layoutId → 배치 항목 { id, itemId, inventoryId, x, y, rotation, meta, placedBy, placedAt }
    this.locks = new Map(); // layoutId → { by: playerId, at } (편집 잠금)

    // 강아지 NPC: 접속 중인 플레이어 위치를 보고 행동한다. npc.autoStart === false 면 테스트가 직접 tick() 한다.
    this.npcOpts = { ...npc, now };
    this.npcs = [];
    this.roomPets = new Map(); // roomPetId → { row, npc } (10단계 공용 펫)
    this.dogRow = null; // 강아지 꾸미기/스킬 설정 행 (room_pets item_id 'dog')
    this.dog = new DogNpc(this.room, this.npcOpts);
    this.addNpc(this.dog);
  }

  // ── NPC 공통 배선 (10단계) ──────────────────────────────────────────
  addNpc(n) {
    n.players = () => [...this.players.values()].filter((p) => p.connected);
    n.on('update', (snap) => this.emit('npcUpdate', snap));
    n.on('pet', ({ by, id, reaction, highFive }) => this.emit('npcPet', { npc: n.id, by, playerId: id, name: n.name, reaction, highFive }));
    n.on('name', (name) => this.emit('npcName', { npc: n.id, name }));
    this.npcs.push(n);
    if (this.npcOpts.autoStart !== false) n.start();
    this.emit('npcUpdate', n.snapshot());
    return n;
  }

  removeNpc(id) {
    const i = this.npcs.findIndex((n) => n.id === id);
    if (i < 0) return null;
    const [n] = this.npcs.splice(i, 1);
    n.dispose();
    this.emit('npcRemoved', { id });
    return n;
  }

  /** 저장소에서 초기 상태 로드 (강아지 이름, 저장된 합계). 서버 시작 시 한 번 */
  async init() {
    try {
      const name = await this.store.getLatestDogName();
      if (name) this.dog.setName(name);
      await this.study.refreshTotals();
      await this.loadLayout();
      await this.loadPets();
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
    return { id: p.id, nickname: p.nickname, avatar: p.avatar, x: p.x, y: p.y, facing: p.facing, moving: p.moving, status: p.status, seatId: p.seatId, connected: p.connected, listening: p.listening || null, goal: this.publicGoal(p.nickname), pomodoro: this.publicPomodoro(p), editing: Boolean(p.editing), deskItems: this.publicDeskItems(p) };
  }

  /** 책상 소품 슬롯 (9단계): [{ itemId, variant } | null] x3 */
  publicDeskItems(p) {
    const arr = Array.isArray(p.deskItems) ? p.deskItems : [];
    return Array.from({ length: DESK_SLOTS }, (_, i) => (arr[i] ? { itemId: arr[i].itemId, variant: arr[i].variant || null } : null));
  }

  /** 머리 위 타이머 표시용 (8단계): 진행 중이면 { phase, endsAt }, 아니면 null. 남은 시간은 각자 서버 시각으로 계산한다 */
  publicPomodoro(p) {
    const pomo = this.pomodoros.get(p.id);
    return pomo && pomo.running ? { phase: pomo.phase, endsAt: pomo.endsAt } : null;
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
      editing: false, // 9단계: 편집 모드 (머리 위 🛠)
      deskItems: [null, null, null], // 9단계: 책상 소품 { inventoryId, itemId, variant } | null
      layoutLock: false, // 9단계: 내가 놓은 가구는 나만 이동·회수
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

  /** 입장 ack 에 실을 영구 데이터: 오늘 목표 · 출석 스트릭 · 코인 잔액 · (클라이언트가 아바타를 안 보냈으면) 저장된 아바타 복원. 실패해도 입장은 된다 */
  async loadProfile(player) {
    const out = { goal: null, streak: { streak: 0, weekDays: 0, attendedToday: false }, coins: 0 };
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
      out.coins = await this.store.getCoins(player.nickname);
      await this.loadDesk(player);
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
    this.releaseLocks(player);
    this.removeNpc(`p:${player.id}`); // 개인 펫은 주인과 함께 사라진다
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
  /** 방 좌석 또는 배치 가구 좌석(f:<layoutId> — 빈백/안마의자/침대) */
  seat(seatId) {
    if (typeof seatId !== 'string') return null;
    if (seatId.startsWith('f:')) return this.layoutSeat(this.layout.get(Number(seatId.slice(2))));
    return this.room.seats.find((s) => s.id === seatId) || null;
  }

  /** 배치 항목의 좌석 { id: 'f:<id>', x, y, facing, kind, layoutId } | null */
  layoutSeat(entry) {
    if (!entry) return null;
    const item = this.shop.get(entry.itemId);
    const s = item && seatOf(item.sprite, entry.x, entry.y, entry.rotation || 0);
    return s ? { id: `f:${entry.id}`, x: s.tx, y: s.ty, facing: s.facing, kind: s.kind, layoutId: entry.id } : null;
  }

  /** 방 좌석 + 배치 가구 좌석 전부 */
  allSeats() {
    const out = [...this.room.seats];
    for (const e of this.layout.values()) {
      const s = this.layoutSeat(e);
      if (s) out.push(s);
    }
    return out;
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
    // 침대·안마의자는 자동 휴식 (세션이 쌓이지 않는다). 일어나면 앉기 전 상태로
    player.status = RESTING_SEATS.has(seat.kind) ? 'rest' : 'study';
    this.study.sync(player);
    return { ok: true, seat };
  }

  /** 앉아 있는 좌석의 종류 ('bed' | 'massage' | 'beanbag' | 의자 이름) 또는 null */
  seatKindOf(player) {
    const s = player.seatId ? this.seat(player.seatId) : null;
    return s ? s.kind : null;
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
    if (status === 'study' && RESTING_SEATS.has(this.seatKindOf(player))) return { ok: false, error: 'resting' }; // 침대/안마의자에서는 휴식만
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
      p.on('phaseEnd', (cycle) => this.settleFocusCycle(player, cycle));
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

  // ── 코인 / 상점 (8단계) ────────────────────────────────────────────
  /** 코인 증감을 저장소에 기록하고 'coins' 이벤트. 실패(잔액 부족·저장소 오류)는 null. 저장이 끝날 때까지 dispose 가 기다린다 */
  award(nickname, playerId, delta, reason) {
    const p = (async () => {
      const r = await this.store.adjustCoins(nickname, delta, reason, this.now());
      if (!r.ok) return null;
      const e = { nickname, playerId, delta, reason, balance: r.balance };
      this.emit('coins', e);
      return e;
    })().catch((err) => {
      this.log.warn(`[world] 코인 저장 실패 (${nickname}, ${delta}, ${reason}): ${err.message}`);
      return null;
    });
    this.pendingAwards.add(p);
    p.finally(() => this.pendingAwards.delete(p));
    return p;
  }

  /**
   * 세션이 저장됐다 → 이월 초 + 이번 세션 초를 10분 단위로 정산 (coins.js settleStudy). 남은 초는 다시 이월.
   * 지급을 먼저 하고 이월을 갱신한다 (이월 저장이 실패하면 다음에 다시 세는 쪽이 코인을 잃는 쪽보다 낫다).
   * 반환: Promise<{ coins, carry } | null(저장소 오류)>
   */
  settleSession({ nickname, playerId, seconds }) {
    const p = (async () => {
      const prev = await this.store.getCoinCarry(nickname);
      const { coins, carry } = settleStudy(prev, seconds);
      if (coins > 0) await this.award(nickname, playerId, coins, 'study');
      if (carry !== prev) await this.store.setCoinCarry(nickname, carry, this.now());
      return { coins, carry };
    })().catch((err) => {
      this.log.warn(`[world] 코인 정산 실패 (${nickname}, ${seconds}s): ${err.message}`);
      return null;
    });
    this.pendingAwards.add(p);
    p.finally(() => this.pendingAwards.delete(p));
    return p;
  }

  /**
   * 집중 사이클이 끝까지 진행됐다 (Pomodoro 'phaseEnd') → 시작부터 지금까지 앉아서 공부 중이었으면 5코인.
   * 같은 사이클(startedAt)은 한 번만 지급한다. 반환: 지급 Promise 또는 null(조건 미달·이미 지급)
   */
  settleFocusCycle(player, cycle) {
    if (!cycle || cycle.phase !== 'focus' || player.removed) return null;
    if (player.focusBonusAt === cycle.startedAt) return null; // 이중 지급 방지
    const bonus = focusBonusFor(cycle, this.study.live.get(player.nickname) || null);
    if (!bonus) return null;
    player.focusBonusAt = cycle.startedAt;
    return this.award(player.nickname, player.id, bonus, 'focus');
  }

  /** 지갑: 잔액 · 이월 초(다음 코인까지 계산용) · 최근 거래 10건 · 인벤토리(placed/slot 표시) · 카탈로그(탭 + 카테고리 + 아이템) */
  async wallet(player) {
    const [coins, carrySeconds, ledger, inventory] = await Promise.all([
      this.store.getCoins(player.nickname),
      this.store.getCoinCarry(player.nickname),
      this.store.coinLedger(player.nickname, 10),
      this.store.listInventory(player.nickname),
    ]);
    const placed = new Set([...this.layout.values()].map((e) => e.inventoryId));
    const equipped = new Map((player.deskItems || []).map((d, i) => [d && d.inventoryId, i]).filter(([k]) => k !== null && k !== undefined));
    const released = new Map([...this.roomPets.values()].map(({ row }) => [row.inventoryId, row.id]));
    const cfg = this.petConfigOf(player);
    const decoUsed = new Map(); // 꾸미기 inventoryId → 어디에 달렸는지
    const mark = (cos, where) => { for (const slot of PET_SLOTS) if (cos && cos[slot] && cos[slot].inventoryId) decoUsed.set(cos[slot].inventoryId, where); };
    mark(this.dog.cosmetics, 'dog');
    for (const { row, npc } of this.roomPets.values()) mark(npc.cosmetics, `s:${row.id}`);
    for (const [pid, pc] of Object.entries(cfg.pets)) mark(pc.cosmetics, `pet:${pid}`);
    const inv = inventory.map((i) => ({ ...i, placed: placed.has(i.id), slot: equipped.has(i.id) ? equipped.get(i.id) : null, active: cfg.active === i.id, released: released.get(i.id) ?? null, equippedOn: decoUsed.get(i.id) || null }));
    return { ok: true, coins, carrySeconds, ledger, inventory: inv, tabs: this.shop.tabs, categories: this.shop.categories, items: this.shop.items, layoutLock: Boolean(player.layoutLock), pets: this.petSummary(player) };
  }

  // ── 가구: 책상 소품 · 공용 가구 배치 · 편집 잠금 (9단계) ────────────────
  /** 저장된 책상 슬롯·잠금 설정을 플레이어에 싣는다 (입장 때) */
  async loadDesk(player) {
    const u = await this.store.getUser(player.nickname);
    player.layoutLock = Boolean(u && u.layoutLock);
    const ids = (u && Array.isArray(u.deskItems) ? u.deskItems : []).slice(0, DESK_SLOTS);
    player.deskItems = await this.resolveDesk(player.nickname, ids);
    player.petConfig = (u && u.petConfig) || null; // 10단계
    await this.syncFollower(player);
  }

  /** inventory id 배열 → [{ inventoryId, itemId, variant } | null] (없어졌거나 책상 소품이 아니면 null) */
  async resolveDesk(nickname, ids) {
    const inv = ids.some((id) => id !== null && id !== undefined) ? await this.store.listInventory(nickname) : [];
    return Array.from({ length: DESK_SLOTS }, (_, i) => {
      const id = ids[i];
      const row = id === null || id === undefined ? null : inv.find((r) => r.id === Number(id));
      const item = row && this.shop.get(row.itemId);
      return item && item.category === 'desk' ? { inventoryId: row.id, itemId: row.itemId, variant: row.meta.variant || null } : null;
    });
  }

  /**
   * 책상 슬롯 장착: slots = [inventoryId | null] x3. 내 인벤토리의 책상 소품만, 같은 것을 두 슬롯에 못 넣는다.
   * @returns {{ ok: true, deskItems } | { ok: false, error: 'invalid' | 'no_item' | 'not_desk' | 'duplicate' }}
   */
  async equipDesk(player, slots) {
    if (!Array.isArray(slots) || slots.length > DESK_SLOTS) return { ok: false, error: 'invalid' };
    const ids = Array.from({ length: DESK_SLOTS }, (_, i) => (slots[i] === null || slots[i] === undefined ? null : Number(slots[i])));
    if (ids.some((id) => id !== null && !Number.isInteger(id))) return { ok: false, error: 'invalid' };
    const used = ids.filter((id) => id !== null);
    if (new Set(used).size !== used.length) return { ok: false, error: 'duplicate' };
    const inv = used.length ? await this.store.listInventory(player.nickname) : [];
    for (const id of used) {
      const row = inv.find((r) => r.id === id);
      if (!row) return { ok: false, error: 'no_item' };
      const item = this.shop.get(row.itemId);
      if (!item || item.category !== 'desk') return { ok: false, error: 'not_desk' };
    }
    await this.store.upsertUser(player.nickname, { deskItems: ids });
    player.deskItems = await this.resolveDesk(player.nickname, ids);
    this.emit('desk', { player });
    return { ok: true, deskItems: this.publicDeskItems(player) };
  }

  /** "내가 놓은 것만" 설정 (users.layout_lock) */
  async setLayoutLock(player, on) {
    player.layoutLock = Boolean(on);
    await this.store.upsertUser(player.nickname, { layoutLock: player.layoutLock });
    return { ok: true, layoutLock: player.layoutLock };
  }

  /** 편집 모드 on/off — 끄면 잡고 있던 가구를 모두 놓는다 */
  setEditing(player, on) {
    player.editing = Boolean(on);
    if (!player.editing) this.releaseLocks(player);
    this.emit('editing', { player });
    return { ok: true, editing: player.editing };
  }

  async loadLayout() {
    const rows = await this.store.roomLayout(this.roomId);
    this.layout.clear();
    for (const e of rows) if (this.shop.get(e.itemId)) this.layout.set(e.id, e);
    this.rebuildCollision();
  }

  listLayout() {
    return [...this.layout.values()].map((e) => this.publicLayout(e));
  }

  publicLayout(e) {
    return { id: e.id, itemId: e.itemId, x: e.x, y: e.y, rotation: e.rotation || 0, variant: (e.meta && e.meta.variant) || null, placedBy: e.placedBy, placedAt: e.placedAt, lockedBy: this.lockOwner(e.id) };
  }

  /** 배치 가구의 통과 불가 셀을 방 충돌 맵에 반영 (이동 검증·NPC 길찾기가 즉시 본다) */
  rebuildCollision() {
    this.room.collision = buildCollision(this.baseRoom, [...this.layout.values()], (id) => this.shop.get(id));
  }

  /** 사람(발 박스)·강아지가 서 있는 셀 — 그 위엔 통과 불가 가구를 못 놓는다 */
  occupiedTiles() {
    const T = this.room.tileSize;
    const set = new Set();
    const add = (px, py) => set.add(`${Math.floor(px / T)},${Math.floor(py / T)}`);
    for (const p of this.players.values()) {
      if (p.seatId) continue;
      const hw = FEET_W / 2;
      add(p.x - hw, p.y - FEET_H); add(p.x + hw - 1, p.y - FEET_H); add(p.x - hw, p.y - 1); add(p.x + hw - 1, p.y - 1);
    }
    for (const n of this.npcs) add(n.x, n.y - 1);
    return set;
  }

  validateLayout(item, placement) {
    // 기본 충돌 맵(baseRoom)으로 검사한다 — 배치 가구끼리의 관계는 규칙(겹침/러그)이 따로 본다
    return validatePlacement(this.baseRoom, item, placement, [...this.layout.values()], (id) => this.shop.get(id), { occupied: this.occupiedTiles() });
  }

  lockOwner(id) {
    const l = this.locks.get(id);
    if (!l) return null;
    if (this.now() - l.at > LOCK_MS || !this.players.has(l.by)) { this.locks.delete(id); return null; }
    return l.by;
  }

  releaseLocks(player) {
    for (const [id, l] of [...this.locks]) {
      if (l.by !== player.id) continue;
      this.locks.delete(id);
      if (this.layout.has(id)) this.emit('layout', { op: 'release', id, by: player.id });
    }
  }

  /** 이동·회수 권한: 놓은 사람이거나, 놓은 사람이 "내가 놓은 것만" 을 켜지 않았으면 누구나 */
  async canEditEntry(player, entry) {
    if (!entry.placedBy || entry.placedBy === player.nickname) return true;
    const owner = [...this.players.values()].find((p) => p.nickname === entry.placedBy);
    if (owner) return !owner.layoutLock;
    const u = await this.store.getUser(entry.placedBy);
    return !(u && u.layoutLock);
  }

  seatOccupied(entry) {
    const s = this.layoutSeat(entry);
    return Boolean(s && this.seatOwners.get(s.id));
  }

  /**
   * 배치: 내 인벤토리의 공용 가구(inventoryId)를 (x, y, rotation) 에 놓는다.
   * @returns {{ ok: true, entry } | { ok: false, error: 'no_item' | 'not_placeable' | 'already_placed' | 배치 규칙 오류 }}
   */
  async placeFurniture(player, { inventoryId, x, y, rotation = 0 } = {}) {
    const inv = await this.store.getInventoryItem(player.nickname, inventoryId);
    if (!inv) return { ok: false, error: 'no_item' };
    const item = this.shop.get(inv.itemId);
    if (!item || item.category !== 'shared') return { ok: false, error: 'not_placeable' };
    if ([...this.layout.values()].some((e) => e.inventoryId === inv.id)) return { ok: false, error: 'already_placed' };
    const v = this.validateLayout(item, { x, y, rotation });
    if (!v.ok) return v;
    const entry = await this.store.addLayout(this.roomId, { itemId: item.id, inventoryId: inv.id, x: Number(x), y: Number(y), rotation: Number(rotation) || 0, meta: { variant: inv.meta.variant || null }, placedBy: player.nickname }, this.now());
    this.layout.set(entry.id, entry);
    this.rebuildCollision();
    this.emit('layout', { op: 'add', entry: this.publicLayout(entry), by: player.id });
    return { ok: true, entry: this.publicLayout(entry) };
  }

  /** 잡기(드래그 시작): 먼저 잡은 사람 우선. @returns {{ ok } | { ok: false, error: 'not_found' | 'forbidden' | 'locked' | 'occupied' }} */
  async grabFurniture(player, id) {
    const entry = this.layout.get(Number(id));
    if (!entry) return { ok: false, error: 'not_found' };
    if (!(await this.canEditEntry(player, entry))) return { ok: false, error: 'forbidden' };
    if (this.seatOccupied(entry)) return { ok: false, error: 'occupied' };
    const owner = this.lockOwner(entry.id);
    if (owner && owner !== player.id) return { ok: false, error: 'locked', by: owner };
    this.locks.set(entry.id, { by: player.id, at: this.now() });
    if (!owner) this.emit('layout', { op: 'grab', id: entry.id, by: player.id });
    return { ok: true, id: entry.id };
  }

  releaseFurniture(player, id) {
    const entry = this.layout.get(Number(id));
    if (!entry) return { ok: false, error: 'not_found' };
    if (this.lockOwner(entry.id) !== player.id) return { ok: false, error: 'not_holder' };
    this.locks.delete(entry.id);
    this.emit('layout', { op: 'release', id: entry.id, by: player.id });
    return { ok: true };
  }

  /** 이동/회전: 잠금이 없으면 잡으면서 옮긴다. 다른 사람이 잡고 있으면 'locked' */
  async moveFurniture(player, { id, x, y, rotation } = {}) {
    const entry = this.layout.get(Number(id));
    if (!entry) return { ok: false, error: 'not_found' };
    const g = await this.grabFurniture(player, entry.id);
    if (!g.ok) return g;
    const item = this.shop.get(entry.itemId);
    const next = { id: entry.id, x: x ?? entry.x, y: y ?? entry.y, rotation: rotation ?? entry.rotation ?? 0 };
    const v = this.validateLayout(item, next);
    if (!v.ok) return v;
    const saved = await this.store.updateLayout(this.roomId, entry.id, { x: Number(next.x), y: Number(next.y), rotation: Number(next.rotation) || 0 });
    if (!saved) return { ok: false, error: 'not_found' };
    Object.assign(entry, { x: saved.x, y: saved.y, rotation: saved.rotation });
    this.locks.set(entry.id, { by: player.id, at: this.now() });
    this.rebuildCollision();
    this.emit('layout', { op: 'move', entry: this.publicLayout(entry), by: player.id });
    return { ok: true, entry: this.publicLayout(entry) };
  }

  /** 회수: 항목을 지운다 → 놓은 사람 인벤토리에서 다시 팔레트에 보인다 */
  async removeFurniture(player, id) {
    const entry = this.layout.get(Number(id));
    if (!entry) return { ok: false, error: 'not_found' };
    const g = await this.grabFurniture(player, entry.id);
    if (!g.ok) return g;
    await this.store.removeLayout(this.roomId, entry.id);
    this.layout.delete(entry.id);
    this.locks.delete(entry.id);
    this.rebuildCollision();
    this.emit('layout', { op: 'remove', id: entry.id, by: player.id, entry: this.publicLayout(entry) });
    return { ok: true, id: entry.id };
  }

  /** 배치 가구가 차지한 셀 (테스트/디버그) */
  layoutCells(id) {
    const e = this.layout.get(Number(id));
    const item = e && this.shop.get(e.itemId);
    return item ? cellsOf(item.sprite, e.x, e.y, e.rotation || 0) : [];
  }

  /**
   * 구매: 카탈로그 확인 → 잔액 확인·차감(저장소가 원자적으로) → 원장 기록 → 인벤토리 저장.
   * @returns {{ ok: true, balance, item, inventory } | { ok: false, error: 'no_item' | 'insufficient', balance? }}
   */
  async purchase(player, itemId, variant, target) {
    const item = this.shop.get(itemId);
    if (!item) return { ok: false, error: 'no_item' };
    const v = pickVariant(item, variant);
    if (!v.ok) return { ok: false, error: v.error };
    let skill = null;
    if (item.category === 'petSkill') {
      if (target === undefined || target === null || target === '') return { ok: false, error: 'no_target' };
      skill = await this.skillTarget(player, item, target);
      if (!skill.ok) return skill;
    }
    const r = await this.store.adjustCoins(player.nickname, -item.price, `purchase:${item.id}`, this.now());
    if (!r.ok) return { ok: false, error: r.error, balance: r.balance };
    const inv = await this.store.addInventory(player.nickname, item.id, { name: item.name, price: item.price, tab: item.tab, category: item.category, variant: v.variant, ...(skill ? { target: String(target) } : {}), ...item.meta }, this.now());
    if (skill) await skill.apply();
    this.emit('coins', { nickname: player.nickname, playerId: player.id, delta: -item.price, reason: `purchase:${item.id}`, balance: r.balance });
    return { ok: true, balance: r.balance, item, inventory: inv };
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
   * 내 기록 초기화(7단계): 공부 세션·출석·오늘 목표·할 일을 지우고 코인 이월 초를 0으로 (아바타·강아지 이름·코인 잔액·인벤토리는 유지).
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

  /** 랭킹: 공부 통계 + 코인(잔액 · 이번 주 획득). 코인 조회가 실패해도 공부 통계는 돌려준다 */
  async stats() {
    const rows = await this.study.stats([...this.players.values()]);
    let coinRows = [];
    try {
      coinRows = await this.store.coinStats({ tz: this.tz, now: this.now() });
    } catch (err) {
      this.log.warn(`[world] 코인 통계 실패: ${err.message}`);
    }
    const coins = new Map(coinRows.map((c) => [c.nickname, c]));
    const out = rows.map((r) => {
      const c = coins.get(r.nickname);
      return { ...r, coins: c ? c.coins : 0, weekCoins: c ? c.weekCoins : 0 };
    });
    for (const c of coinRows) if (!rows.some((r) => r.nickname === c.nickname) && c.weekCoins > 0) out.push({ nickname: c.nickname, todaySeconds: 0, weekSeconds: 0, streak: 0, weekDays: 0, live: false, online: false, coins: c.coins, weekCoins: c.weekCoins });
    return { ok: true, store: this.store.kind, tz: this.tz, date: this.today(), rows: out };
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

  // ── 펫 (10단계) ──────────────────────────────────────────────────
  /** 서버 시작: 공용 펫과 강아지 설정 행 로드 */
  async loadPets() {
    const rows = await this.store.roomPets(this.roomId);
    for (const row of rows) {
      if (row.itemId === 'dog') {
        this.dogRow = row;
        this.dog.setCosmetics(row.cosmetics);
        for (const sk of row.skills || []) this.dog.addSkill(sk);
      } else if (this.shop.get(row.itemId)) this.spawnSharedPet(row);
    }
  }

  spawnSharedPet(row) {
    const item = this.shop.get(row.itemId);
    const species = item.species;
    const info = PET_SPECIES[species] || {};
    const id = `s:${row.id}`;
    const base = { id, species, name: row.name, cosmetics: row.cosmetics, skills: row.skills || [], now: this.now, random: this.npcOpts.random, tickMs: this.npcOpts.tickMs };
    const npc = species === 'fish' ? new FishNpc(this.room, base) : new SharedPetNpc(this.room, { ...base, home: info.home, spots: info.spots || [], speeds: info.sharedSpeed });
    npc.roomPetId = row.id;
    npc.releasedBy = row.releasedBy;
    this.roomPets.set(row.id, { row, npc });
    this.addNpc(npc);
    return npc;
  }

  sharedPetCount() {
    return this.roomPets.size;
  }

  /** 개인 펫 설정 형태 보정 */
  petConfigOf(player) {
    const c = player.petConfig && typeof player.petConfig === 'object' ? player.petConfig : {};
    return { active: c.active ?? null, pets: c.pets && typeof c.pets === 'object' ? c.pets : {} };
  }

  /** 꾸미기 슬롯 { head, neck, back }: 값은 내 인벤토리의 petDeco inventoryId | null → { inventoryId, itemId, variant } | null */
  async resolveCosmetics(nickname, slots) {
    const out = { head: null, neck: null, back: null };
    if (!slots || typeof slots !== 'object') return { ok: true, cosmetics: out };
    const ids = PET_SLOTS.map((k) => slots[k]).filter((v) => v !== null && v !== undefined);
    const inv = ids.length ? await this.store.listInventory(nickname) : [];
    for (const slot of PET_SLOTS) {
      const id = slots[slot];
      if (id === null || id === undefined) continue;
      const row = inv.find((r) => r.id === Number(id));
      const item = row && this.shop.get(row.itemId);
      if (!item || item.category !== 'petDeco') return { ok: false, error: 'no_item' };
      if (item.slot !== slot) return { ok: false, error: 'wrong_slot' };
      out[slot] = { inventoryId: row.id, itemId: item.id, variant: row.meta.variant || null };
    }
    return { ok: true, cosmetics: out };
  }

  followerOf(player) {
    return this.npcs.find((n) => n.id === `p:${player.id}`) || null;
  }

  /** 활성 개인 펫에 맞춰 FollowerNpc 를 만들거나 지운다 (입장·설정 변경 때) */
  async syncFollower(player) {
    const cfg = this.petConfigOf(player);
    const cur = this.followerOf(player);
    let row = null;
    if (cfg.active !== null) {
      row = await this.store.getInventoryItem(player.nickname, cfg.active);
      const item = row && this.shop.get(row.itemId);
      if (!item || item.category !== 'pet') row = null;
    }
    if (!row) {
      if (cur) this.removeNpc(cur.id);
      return null;
    }
    const item = this.shop.get(row.itemId);
    const pc = cfg.pets[row.id] || {};
    if (cur && cur.inventoryId === row.id) {
      // 같은 펫: 이름·꾸미기·스킬만 갱신
      if (pc.name && pc.name !== cur.name) { cur.name = pc.name; cur.dirty = true; }
      cur.setCosmetics(pc.cosmetics || {});
      for (const sk of pc.skills || []) cur.addSkill(sk);
      return cur;
    }
    if (cur) this.removeNpc(cur.id);
    const npc = new FollowerNpc(this.room, player, { id: `p:${player.id}`, species: item.species, name: pc.name || item.name, cosmetics: pc.cosmetics || {}, skills: pc.skills || [], now: this.now, random: this.npcOpts.random, tickMs: this.npcOpts.tickMs });
    npc.inventoryId = row.id;
    this.addNpc(npc);
    return npc;
  }

  /**
   * 내 펫 설정: { active?: inventoryId|null, petId?: inventoryId, name?, cosmetics?: { head, neck, back } }
   * petId(기본: active) 의 이름·꾸미기를 바꾼다. active 를 바꾸면 따라다니는 펫이 바뀐다.
   * @returns {{ ok: true, petConfig, pet } | { ok: false, error: 'no_item' | 'not_pet' | 'invalid_name' | 'wrong_slot' }}
   */
  async setPetConfig(player, { active, petId, name, cosmetics } = {}) {
    const cfg = this.petConfigOf(player);
    if (active !== undefined) {
      if (active === null) cfg.active = null;
      else {
        const row = await this.store.getInventoryItem(player.nickname, active);
        const item = row && this.shop.get(row.itemId);
        if (!row) return { ok: false, error: 'no_item' };
        if (item.category !== 'pet') return { ok: false, error: 'not_pet' };
        cfg.active = row.id;
      }
    }
    const target = petId !== undefined && petId !== null ? Number(petId) : cfg.active;
    if (target !== null && (name !== undefined || cosmetics !== undefined)) {
      const row = await this.store.getInventoryItem(player.nickname, target);
      const item = row && this.shop.get(row.itemId);
      if (!item || item.category !== 'pet') return { ok: false, error: 'no_item' };
      const pc = cfg.pets[row.id] || { name: item.name, cosmetics: {}, skills: [] };
      if (name !== undefined) {
        const n = normalizeNickname(name);
        if (!n.ok || [...n.name].length > PET_NAME_MAX) return { ok: false, error: 'invalid_name' };
        pc.name = n.name;
      }
      if (cosmetics !== undefined) {
        const r = await this.resolveCosmetics(player.nickname, cosmetics);
        if (!r.ok) return r;
        pc.cosmetics = r.cosmetics;
      }
      cfg.pets[row.id] = pc;
    }
    player.petConfig = cfg;
    await this.store.upsertUser(player.nickname, { petConfig: cfg });
    const npc = await this.syncFollower(player);
    return { ok: true, petConfig: cfg, pet: npc ? npc.snapshot() : null };
  }

  npcOwnerCheck(player, npc) {
    if (npc.id === 'dog') return true; // 강아지는 누구나
    if (npc.roomPetId !== undefined) return npc.releasedBy === player.nickname;
    if (npc.ownerId !== undefined && npc.ownerId !== null) return npc.ownerId === player.id;
    return false;
  }

  /** NPC 이름 변경: 강아지(누구나, users.dog_name) · 공용 펫(푼 사람) · 개인 펫(주인) */
  async setNpcName(player, npcId, raw) {
    const npc = this.npcById(npcId);
    if (!npc) return { ok: false, error: 'no_npc' };
    if (npc.id === 'dog') return this.setDogName(player, raw);
    if (!this.npcOwnerCheck(player, npc)) return { ok: false, error: 'forbidden' };
    const res = npc.setName(raw);
    if (!res.ok) return res;
    if (npc.roomPetId !== undefined) await this.store.updateRoomPet(this.roomId, npc.roomPetId, { name: res.name });
    else {
      const cfg = this.petConfigOf(player);
      cfg.pets[npc.inventoryId] = { ...(cfg.pets[npc.inventoryId] || { cosmetics: {}, skills: [] }), name: res.name };
      player.petConfig = cfg;
      await this.store.upsertUser(player.nickname, { petConfig: cfg });
    }
    return res;
  }

  /** 강아지 설정 행 (없으면 만든다) */
  async ensureDogRow() {
    if (!this.dogRow) this.dogRow = await this.store.addRoomPet(this.roomId, { itemId: 'dog', name: this.dog.name, releasedBy: null }, this.now());
    return this.dogRow;
  }

  /** 꾸미기 장착: 강아지(누구나) · 공용 펫(푼 사람) · 개인 펫(주인). slots 값은 내 인벤토리 inventoryId */
  async setPetDeco(player, npcId, slots) {
    const npc = this.npcById(npcId);
    if (!npc) return { ok: false, error: 'no_npc' };
    if (!this.npcOwnerCheck(player, npc)) return { ok: false, error: 'forbidden' };
    if (npc.ownerId) return this.setPetConfig(player, { petId: npc.inventoryId, cosmetics: slots });
    const r = await this.resolveCosmetics(player.nickname, slots);
    if (!r.ok) return r;
    npc.setCosmetics(r.cosmetics);
    if (npc.id === 'dog') {
      await this.ensureDogRow();
      this.dogRow = (await this.store.updateRoomPet(this.roomId, this.dogRow.id, { cosmetics: r.cosmetics })) || this.dogRow;
    } else {
      const rp = this.roomPets.get(npc.roomPetId);
      if (rp) rp.row = (await this.store.updateRoomPet(this.roomId, npc.roomPetId, { cosmetics: r.cosmetics })) || rp.row;
    }
    return { ok: true, cosmetics: npc.publicCosmetics() };
  }

  /** 공용 펫 방에 풀기 (지갑에서). @returns {{ ok, pet } | { ok:false, error: no_item | not_shared_pet | already_released | room_full | invalid_name }} */
  async releasePet(player, { inventoryId, name } = {}) {
    const row = await this.store.getInventoryItem(player.nickname, inventoryId);
    const item = row && this.shop.get(row.itemId);
    if (!row) return { ok: false, error: 'no_item' };
    if (item.category !== 'sharedPet') return { ok: false, error: 'not_shared_pet' };
    if ([...this.roomPets.values()].some((p) => p.row.inventoryId === row.id)) return { ok: false, error: 'already_released' };
    if (this.sharedPetCount() >= MAX_SHARED_PETS) return { ok: false, error: 'room_full' };
    let petName = item.name.replace(/\s*\(.*\)$/, '');
    if (name !== undefined && name !== null && name !== '') {
      const n = normalizeNickname(name);
      if (!n.ok || [...n.name].length > PET_NAME_MAX) return { ok: false, error: 'invalid_name' };
      petName = n.name;
    }
    const saved = await this.store.addRoomPet(this.roomId, { itemId: item.id, inventoryId: row.id, name: petName, releasedBy: player.nickname }, this.now());
    const npc = this.spawnSharedPet(saved);
    return { ok: true, pet: npc.snapshot(), roomPetId: saved.id };
  }

  /** 공용 펫 회수 (푼 사람만) */
  async recallPet(player, id) {
    const rp = this.roomPets.get(Number(id));
    if (!rp) return { ok: false, error: 'not_found' };
    if (rp.row.releasedBy !== player.nickname) return { ok: false, error: 'forbidden' };
    await this.store.removeRoomPet(this.roomId, rp.row.id);
    this.roomPets.delete(rp.row.id);
    this.removeNpc(rp.npc.id);
    return { ok: true, id: rp.row.id };
  }

  /** 스킬 구매 대상 검증: 'dog' | 's:<roomPetId>' | inventoryId(내 개인 펫). @returns {{ ok, apply(): Promise }} */
  async skillTarget(player, item, target) {
    if (target === 'dog') {
      if (this.dog.skills.has(item.skill)) return { ok: false, error: 'already_has' };
      return { ok: true, apply: async () => { await this.ensureDogRow(); const skills = [...new Set([...(this.dogRow.skills || []), item.skill])]; this.dogRow = (await this.store.updateRoomPet(this.roomId, this.dogRow.id, { skills })) || this.dogRow; this.dog.addSkill(item.skill); } };
    }
    if (typeof target === 'string' && target.startsWith('s:')) {
      const rp = this.roomPets.get(Number(target.slice(2)));
      if (!rp) return { ok: false, error: 'no_target' };
      if (rp.npc.skills.has(item.skill)) return { ok: false, error: 'already_has' };
      return { ok: true, apply: async () => { const skills = [...new Set([...(rp.row.skills || []), item.skill])]; rp.row = (await this.store.updateRoomPet(this.roomId, rp.row.id, { skills })) || rp.row; rp.npc.addSkill(item.skill); } };
    }
    const row = await this.store.getInventoryItem(player.nickname, target);
    const pi = row && this.shop.get(row.itemId);
    if (!pi || pi.category !== 'pet') return { ok: false, error: 'no_target' };
    const cfg = this.petConfigOf(player);
    const pc = cfg.pets[row.id] || { name: pi.name, cosmetics: {}, skills: [] };
    if ((pc.skills || []).includes(item.skill)) return { ok: false, error: 'already_has' };
    return { ok: true, apply: async () => { pc.skills = [...new Set([...(pc.skills || []), item.skill])]; cfg.pets[row.id] = pc; player.petConfig = cfg; await this.store.upsertUser(player.nickname, { petConfig: cfg }); await this.syncFollower(player); } };
  }

  /** 채팅에 펫 이름이 들어 있으면 'come' 스킬이 있는 펫이 달려온다 (개인 펫은 주인이 부를 때만) */
  onChat(player, text) {
    const called = [];
    for (const n of this.npcs) {
      if (!n.skills.has('come') || !n.name || !text.includes(n.name)) continue;
      if (n.ownerId && n.ownerId !== player.id) continue;
      if (n.comeTo(player)) called.push(n.id);
    }
    return called;
  }

  /** 지갑용 펫 정보: 강아지 · 공용 펫 목록 · 내 설정 */
  petSummary(player) {
    const npcInfo = (n, extra = {}) => ({ id: n.id, species: n.species, name: n.name, cosmetics: n.cosmetics, skills: [...n.skills], ...extra });
    return {
      dog: npcInfo(this.dog),
      shared: [...this.roomPets.values()].map(({ row, npc }) => npcInfo(npc, { roomPetId: row.id, itemId: row.itemId, releasedBy: row.releasedBy, mine: row.releasedBy === player.nickname })),
      config: this.petConfigOf(player),
      maxShared: MAX_SHARED_PETS,
    };
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
    await Promise.all([...this.pendingAwards]); // flushAll 이 저장한 세션의 코인까지
  }
}

module.exports = { World, GRACE_MS, SIT_RANGE_PX, EMOJIS, STATUSES, MANUAL_STATUSES, LISTENING_MAX, GOAL_TEXT_MAX, GOAL_MIN, GOAL_MAX, GOAL_STEP, TODO_MAX, LOCK_MS, DESK_SLOTS, RESTING_SEATS, MAX_SHARED_PETS, PET_NAME_MAX, seatCenter };
