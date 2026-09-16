'use strict';
/**
 * 방 하나의 실시간 상태 (소켓과 무관한 순수 로직).
 *  - 플레이어 입장/퇴장, 닉네임 중복 처리, 세션 토큰으로 재접속
 *  - 이동 검증(예산 방식), 좌석 점유, 상태(공부/휴식), 채팅 검증, 뽀모도로
 * 이벤트: 'playerLeft' (유예 시간이 지나 정리될 때), 'pomodoro' (상태 변화)
 */
const EventEmitter = require('node:events');
const crypto = require('node:crypto');

const { normalizeNickname, uniqueNickname } = require('./nickname');
const { SPEED, FEET_W, FEET_H, applyMove, maxBudget, canStand } = require('./movement');
const { sanitizeChat, createRateLimiter, MAX_LEN: CHAT_MAX } = require('./chat');
const { Pomodoro } = require('./pomodoro');
const { FACING_DELTA } = require('../rooms/build');

const GRACE_MS = 30 * 1000; // 연결 끊김 후 플레이어를 유지하는 시간
const SIT_RANGE_PX = 56; // 좌석 중심까지 이 거리 안이어야 앉을 수 있다 (대각선 인접 포함)
const STATUSES = ['study', 'rest'];
const EMOJIS = ['👋', '😊', '👍', '❤️', '😂', '🔥'];
const AVATAR_COUNT = 4;
const FACINGS = Object.keys(FACING_DELTA);

function seatCenter(room, seat) {
  return { x: (seat.x + 0.5) * room.tileSize, y: (seat.y + 1) * room.tileSize };
}

class World extends EventEmitter {
  constructor(room, { graceMs = GRACE_MS, pomodoro = {}, now = () => Date.now() } = {}) {
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
  }

  get config() {
    return { speed: SPEED, feetW: FEET_W, feetH: FEET_H, sendHz: 20, chatMax: CHAT_MAX, emojis: EMOJIS, avatarCount: AVATAR_COUNT, graceMs: this.graceMs };
  }

  /** 다른 클라이언트에 보내는 공개 정보 */
  publicPlayer(p) {
    return { id: p.id, nickname: p.nickname, avatar: p.avatar, x: p.x, y: p.y, facing: p.facing, moving: p.moving, status: p.status, seatId: p.seatId, connected: p.connected };
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
    player.prevStatus = player.status;
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
    if (!STATUSES.includes(status)) return { ok: false, error: 'invalid' };
    player.status = status;
    player.prevStatus = status;
    return { ok: true };
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
  }
}

module.exports = { World, GRACE_MS, SIT_RANGE_PX, EMOJIS, STATUSES, AVATAR_COUNT, seatCenter };
