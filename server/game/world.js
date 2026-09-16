'use strict';
/**
 * 방 하나의 실시간 상태 (소켓과 무관한 순수 로직).
 *  - 플레이어 입장/퇴장, 닉네임 중복 처리, 세션 토큰으로 재접속
 *  - 이동 검증(예산 방식), 좌석 점유, 상태(공부/휴식/☕휴식), 채팅 검증, 뽀모도로
 *  - 상호작용 지점(커피머신 앞 E → 'coffee' 상태), 듣는 중(유튜브 제목) 표시
 * 이벤트: 'playerLeft' (유예 시간이 지나 정리될 때), 'pomodoro' (상태 변화),
 *         'npcUpdate' (NPC 스냅샷, 10Hz), 'npcPet' ({ npc, by, nickname }), 'npcName' ({ npc, name })
 */
const EventEmitter = require('node:events');
const crypto = require('node:crypto');

const { normalizeNickname, uniqueNickname } = require('./nickname');
const { SPEED, FEET_W, FEET_H, applyMove, maxBudget, canStand } = require('./movement');
const { sanitizeChat, createRateLimiter, MAX_LEN: CHAT_MAX } = require('./chat');
const { Pomodoro } = require('./pomodoro');
const { DogNpc } = require('./npc');
const { FACING_DELTA, interactableById } = require('../rooms/build');

const GRACE_MS = 30 * 1000; // 연결 끊김 후 플레이어를 유지하는 시간
const SIT_RANGE_PX = 56; // 좌석 중심까지 이 거리 안이어야 앉을 수 있다 (대각선 인접 포함)
const STATUSES = ['study', 'rest', 'coffee']; // coffee = 커피머신 앞에서 E ("☕ 휴식"). 수동 토글은 study/rest 만
const MANUAL_STATUSES = ['study', 'rest'];
const LISTENING_MAX = 80;
const EMOJIS = ['👋', '😊', '👍', '❤️', '😂', '🔥'];
const AVATAR_COUNT = 4;
const FACINGS = Object.keys(FACING_DELTA);

function seatCenter(room, seat) {
  return { x: (seat.x + 0.5) * room.tileSize, y: (seat.y + 1) * room.tileSize };
}

class World extends EventEmitter {
  constructor(room, { graceMs = GRACE_MS, pomodoro = {}, npc = {}, now = () => Date.now() } = {}) {
    super();
    this.room = room;
    this.now = now;
    this.graceMs = graceMs;
    this.players = new Map(); // id → player
    this.sessions = new Map(); // token → player
    this.seatOwners = new Map(); // seatId → playerId
    this.graceTimers = new Map(); // playerId → timeout
    this.chatLimiter = createRateLimiter();
    this.pomodoro = new Pomodoro({ ...pomodoro, now });
    this.pomodoro.on('change', (snap, reason) => this.emit('pomodoro', snap, reason));

    // 강아지 NPC: 접속 중인 플레이어 위치를 보고 행동한다. npc.autoStart === false 면 테스트가 직접 tick() 한다.
    this.dog = new DogNpc(room, { ...npc, now });
    this.dog.players = () => [...this.players.values()].filter((p) => p.connected);
    this.dog.on('update', (snap) => this.emit('npcUpdate', snap));
    this.dog.on('pet', ({ by, id }) => this.emit('npcPet', { npc: this.dog.id, by, playerId: id, name: this.dog.name }));
    this.dog.on('name', (name) => this.emit('npcName', { npc: this.dog.id, name }));
    this.npcs = [this.dog];
    if (npc.autoStart !== false) this.dog.start();
  }

  npcSnapshots() {
    return this.npcs.map((n) => n.snapshot());
  }

  npcById(id) {
    return this.npcs.find((n) => n.id === id) || null;
  }

  get config() {
    return { speed: SPEED, feetW: FEET_W, feetH: FEET_H, sendHz: 20, chatMax: CHAT_MAX, emojis: EMOJIS, avatarCount: AVATAR_COUNT, graceMs: this.graceMs };
  }

  /** 다른 클라이언트에 보내는 공개 정보 */
  publicPlayer(p) {
    return { id: p.id, nickname: p.nickname, avatar: p.avatar, x: p.x, y: p.y, facing: p.facing, moving: p.moving, status: p.status, seatId: p.seatId, connected: p.connected, listening: p.listening || null };
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
      avatar: Number.isInteger(avatar) && avatar >= 0 && avatar < AVATAR_COUNT ? avatar : 0,
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
    return { ok: true, player, resumed: false, oldSocketId: null };
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

  setAvatar(player, avatar) {
    if (!Number.isInteger(avatar) || avatar < 0 || avatar >= AVATAR_COUNT) return { ok: false, error: 'invalid' };
    player.avatar = avatar;
    return { ok: true };
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

  /** 플레이어 위치가 유효한지 (테스트/디버그용) */
  canStand(x, y) {
    return canStand(this.room, x, y);
  }

  dispose() {
    for (const t of this.graceTimers.values()) clearTimeout(t);
    this.graceTimers.clear();
    this.pomodoro.dispose();
    for (const n of this.npcs) n.dispose();
  }
}

module.exports = { World, GRACE_MS, SIT_RANGE_PX, EMOJIS, STATUSES, MANUAL_STATUSES, AVATAR_COUNT, LISTENING_MAX, seatCenter };
