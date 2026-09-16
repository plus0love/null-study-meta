'use strict';
/**
 * 강아지 NPC (라운지의 갈색 푸들). 행동은 서버가 결정하고 10Hz 로 방 전원에게 동기화한다.
 *
 * 행동 순환: 라운지 러그 주변을 느리게 어슬렁(wander) → 멈춰서 앉기(sit) → 쿠션 위에서 자기(sleep)
 *            → 가끔 방 안 다른 구역까지 산책(stroll) 후 돌아오기.
 * 이동은 타일 중심을 잇는 BFS 경로를 따라가므로 가구·벽 충돌을 지킨다 (쿠션 타일만 예외적으로 올라갈 수 있다).
 * 플레이어와는 겹쳐도 된다. 플레이어가 가까이 오면(NEAR_PX) 하던 일을 멈추고 앉아서 쳐다보며 꼬리를 흔든다(look).
 * 이벤트: 'update'(스냅샷, 바뀐 것이 있을 때) · 'pet'({ by }) · 'name'(name)
 */
const EventEmitter = require('node:events');
const { isBlocked } = require('../rooms/build');
const { normalizeNickname } = require('./nickname');

const TICK_MS = 100; // 10Hz
const NEAR_PX = 48; // 플레이어가 이 안에 오면 쳐다본다
const PET_RANGE_PX = 56; // 쓰다듬기 가능 거리
const PET_COOLDOWN_MS = 3000;
const NAME_MAX = 8;
const SPEED = { wander: 40, stroll: 60, home: 50 }; // px/s
const DEFAULT_NAME = '사랑';

// 라운지: 러그(16..26, 7..10) 주변. 쿠션은 (24,9), 강아지는 그 위에서 잔다.
const HOME = { x0: 16, y0: 7, x1: 26, y1: 11 };
const CUSHION = { x: 24, y: 9 };

function center(room, tx, ty) {
  return { x: (tx + 0.5) * room.tileSize, y: (ty + 1) * room.tileSize };
}

class DogNpc extends EventEmitter {
  constructor(room, { name = DEFAULT_NAME, now = () => Date.now(), random = Math.random, tickMs = TICK_MS } = {}) {
    super();
    this.room = room;
    this.id = 'dog';
    this.kind = 'dog';
    this.name = name;
    this.now = now;
    this.random = random;
    this.tickMs = tickMs;
    const c = center(room, CUSHION.x, CUSHION.y);
    this.x = c.x;
    this.y = c.y;
    this.facing = 'down';
    this.state = 'sleep'; // walk | idle | sit | sleep | look
    this.path = []; // 남은 타일 좌표 목록
    this.speed = SPEED.wander;
    this.stateUntil = now() + 5000;
    this.afterLook = null; // look 전 하던 상태 복귀용
    this.lastPetAt = -Infinity;
    this.lastEmitAt = 0;
    this.timer = null;
    this.dirty = true;
    this.players = () => []; // 접속 중 플레이어 위치 목록 공급자 (world 가 주입)
    this.prevTick = now();
    this.sequence = 0;
  }

  snapshot() {
    return { id: this.id, kind: this.kind, name: this.name, x: Math.round(this.x * 100) / 100, y: Math.round(this.y * 100) / 100, facing: this.facing, state: this.state };
  }

  start() {
    if (this.timer) return;
    this.prevTick = this.now();
    this.timer = setInterval(() => this.tick(), this.tickMs);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  // ── 타일 판정 / 경로 ─────────────────────────────────────────────
  tile() {
    return { tx: Math.floor(this.x / this.room.tileSize), ty: Math.floor((this.y - 1) / this.room.tileSize) };
  }

  walkable(tx, ty) {
    if (tx === CUSHION.x && ty === CUSHION.y) return true;
    return !isBlocked(this.room, tx, ty);
  }

  /** BFS 경로 (시작 제외, 목표 포함). 없으면 null */
  findPath(from, to) {
    const key = (x, y) => `${x},${y}`;
    const prev = new Map([[key(from.tx, from.ty), null]]);
    const q = [[from.tx, from.ty]];
    while (q.length) {
      const [x, y] = q.shift();
      if (x === to.tx && y === to.ty) {
        const path = [];
        let cur = key(x, y);
        while (prev.get(cur)) {
          const [px, py] = prev.get(cur);
          path.unshift({ tx: Number(cur.split(',')[0]), ty: Number(cur.split(',')[1]) });
          cur = key(px, py);
        }
        return path;
      }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (!this.walkable(nx, ny) || prev.has(key(nx, ny))) continue;
        // 쿠션은 목적지일 때만 밟는다
        if (nx === CUSHION.x && ny === CUSHION.y && !(to.tx === nx && to.ty === ny)) continue;
        prev.set(key(nx, ny), [x, y]);
        q.push([nx, ny]);
      }
    }
    return null;
  }

  randomTile(area, tries = 40) {
    for (let i = 0; i < tries; i++) {
      const tx = area.x0 + Math.floor(this.random() * (area.x1 - area.x0 + 1));
      const ty = area.y0 + Math.floor(this.random() * (area.y1 - area.y0 + 1));
      if ((tx !== CUSHION.x || ty !== CUSHION.y) && !isBlocked(this.room, tx, ty)) return { tx, ty };
    }
    return null;
  }

  /** 목표 타일까지 경로를 잡고 걷기 시작. 경로가 없으면 false */
  goTo(target, speed, next) {
    const path = this.findPath(this.tile(), target);
    if (!path) return false;
    this.path = path;
    this.speed = speed;
    this.nextState = next;
    if (path.length) this.setState('walk');
    else this.arrive();
    return true;
  }

  setState(state, durationMs = 0) {
    if (state !== this.state) this.dirty = true;
    this.state = state;
    this.stateUntil = this.now() + durationMs;
  }

  // ── 행동 결정 ────────────────────────────────────────────────────
  between(a, b) {
    return a + this.random() * (b - a);
  }

  /** 현재 상태가 끝났을 때 다음 행동을 고른다 */
  decide() {
    const r = this.random();
    const atHome = this.inHome();
    if (!atHome && r < 0.7) {
      // 밖에 있으면 대부분 집으로
      const t = this.randomTile(HOME);
      if (t && this.goTo(t, SPEED.home, () => this.setState('sit', this.between(3000, 7000)))) return;
    }
    if (r < 0.45) {
      const t = this.randomTile(HOME);
      if (t && this.goTo(t, SPEED.wander, () => this.setState('idle', this.between(800, 2500)))) return;
    } else if (r < 0.65) {
      this.setState('sit', this.between(3000, 8000));
      return;
    } else if (r < 0.85) {
      if (this.goTo(CUSHION, SPEED.wander, () => this.setState('sleep', this.between(15000, 40000)))) return;
    } else {
      // 산책: 방 안 아무 곳(실내 바닥 y 3..24)
      const t = this.randomTile({ x0: 2, y0: 3, x1: 43, y1: 24 });
      if (t && this.goTo(t, SPEED.stroll, () => this.setState('idle', this.between(1500, 4000)))) return;
    }
    this.setState('idle', this.between(800, 2000));
  }

  inHome() {
    const { tx, ty } = this.tile();
    return tx >= HOME.x0 && tx <= HOME.x1 && ty >= HOME.y0 && ty <= HOME.y1;
  }

  arrive() {
    const next = this.nextState;
    this.nextState = null;
    if (next) next();
    else this.setState('idle', 1000);
  }

  nearestPlayer() {
    let best = null;
    let bestD = NEAR_PX;
    for (const p of this.players()) {
      const d = Math.hypot(p.x - this.x, p.y - this.y);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  faceToward(p) {
    const dx = p.x - this.x;
    const dy = p.y - this.y;
    const f = Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down';
    if (f !== this.facing) {
      this.facing = f;
      this.dirty = true;
    }
  }

  // ── 매 틱 ────────────────────────────────────────────────────────
  tick() {
    const now = this.now();
    const dt = Math.min(0.5, Math.max(0, (now - this.prevTick) / 1000));
    this.prevTick = now;

    const near = this.nearestPlayer();
    if (near) {
      if (this.state !== 'look') {
        this.afterLook = { state: this.state, path: this.path, nextState: this.nextState, speed: this.speed };
        this.path = [];
        this.setState('look');
      }
      this.faceToward(near);
      this.stateUntil = now + 1500; // 떠난 뒤 1.5초 더 쳐다보다가 복귀
    } else if (this.state === 'look') {
      if (now >= this.stateUntil) {
        const prev = this.afterLook;
        this.afterLook = null;
        if (prev && prev.state === 'walk' && prev.path.length) {
          this.path = prev.path;
          this.nextState = prev.nextState;
          this.speed = prev.speed;
          this.setState('walk');
        } else this.setState('idle', this.between(500, 1500));
      }
    } else if (this.state === 'walk') {
      this.step(dt);
    } else if (now >= this.stateUntil) {
      this.decide();
    }

    // 걷는 중에는 매 틱, 아니면 바뀐 것이 있을 때 + 1초마다 키프레임
    if (this.state === 'walk' || this.dirty || now - this.lastEmitAt >= 1000) {
      this.dirty = false;
      this.lastEmitAt = now;
      this.emit('update', this.snapshot());
    }
  }

  /** 경로를 따라 dt 초만큼 이동 (타일 중심에서 중심으로) */
  step(dt) {
    let remain = this.speed * dt;
    while (remain > 0 && this.path.length) {
      const t = this.path[0];
      const c = center(this.room, t.tx, t.ty);
      const dx = c.x - this.x;
      const dy = c.y - this.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= remain) {
        this.x = c.x;
        this.y = c.y;
        remain -= dist;
        this.path.shift();
      } else {
        this.x += (dx / dist) * remain;
        this.y += (dy / dist) * remain;
        remain = 0;
      }
      const f = Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down';
      if (dist > 0.01) this.facing = f;
    }
    if (!this.path.length) this.arrive();
  }

  // ── 상호작용 ─────────────────────────────────────────────────────
  /** @returns {{ ok: true } | { ok: false, error }} */
  pet(player) {
    if (Math.hypot(player.x - this.x, player.y - this.y) > PET_RANGE_PX) return { ok: false, error: 'too_far' };
    const now = this.now();
    if (now - this.lastPetAt < PET_COOLDOWN_MS) return { ok: false, error: 'cooldown' };
    this.lastPetAt = now;
    this.faceToward(player);
    this.emit('pet', { by: player.nickname, id: player.id });
    return { ok: true };
  }

  /** @returns {{ ok: true, name } | { ok: false, error }} */
  setName(raw) {
    const norm = normalizeNickname(raw);
    if (!norm.ok) return { ok: false, error: norm.error };
    if ([...norm.name].length > NAME_MAX) return { ok: false, error: `이름은 ${NAME_MAX}자 이하여야 합니다.` };
    this.name = norm.name;
    this.dirty = true;
    this.emit('name', this.name);
    return { ok: true, name: this.name };
  }

  dispose() {
    this.stop();
  }
}

module.exports = { DogNpc, TICK_MS, NEAR_PX, PET_RANGE_PX, PET_COOLDOWN_MS, NAME_MAX, HOME, CUSHION, DEFAULT_NAME };
