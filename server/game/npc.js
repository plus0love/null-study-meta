'use strict';
/**
 * NPC 펫 (10단계에서 일반화). 행동은 서버가 결정하고 10Hz 로 방 전원에게 동기화한다 (npc:update).
 *
 *  - BaseNpc: 타일 경로(BFS, 가구·벽 충돌 준수) · 걷기 · 상태 · 쓰다듬기(쿨다운, 종별 반응 이모지) · 이름 · 꾸미기 슬롯(head/neck/back) · 스킬
 *  - DogNpc (기존 라운지 푸들 = 방 공용 펫의 원형): 어슬렁(wander) → 앉기(sit) → 쿠션 위 자기(sleep) → 산책(stroll).
 *    플레이어가 가까이 오면(NEAR_PX) 멈추고 쳐다보며 꼬리를 흔든다(look).
 *  - SharedPetNpc: 방에 사는 공용 펫. 강아지와 같은 상태기계에 종별 선호 구역(home)·잠자리(spots: 고양이 = 책장 선반·소파, 거북이 = 러그)·속도.
 *    물고기는 라운지 테이블 위 어항 안에서만 헤엄친다 (경로 없음).
 *  - FollowerNpc: 개인 펫. 주인의 최근 위치(trail)를 따라 1.5타일 뒤에서 따라온다 (경로는 BFS, 못 따라오면 순간이동).
 *    주인이 멈추면 1초 뒤 앉고, 주인이 앉아 공부 중이면 발밑에서 앉는다 (스킬 'sleep_beside' 가 있으면 잔다).
 *    앵무새는 어깨 위(위치를 주인에게 붙인다), 슬라임은 통통 튐(클라이언트 연출), 거북이는 느려서 자주 순간이동한다.
 *  - 스킬(펫별 1회 구매): 'come'(채팅에 이름을 부르면 달려옴 → comeTo), 'sleep_beside', 'high_five'(쓰다듬기 반응 추가).
 *  - 18단계: HumanNpc (매점 점원 · 바리스타) — 제자리에 서서 idle/손 흔들기/컵 닦기/머신 조작/잔 정리를 번갈아 하고, 손님이 앞(greet 지점)에 서면 말풍선.
 *    강아지 산책: DogNpc 는 hidden(산책 중엔 스냅샷을 내지 않음) · level(애정도, 이름 옆 ❤️) · trick(앉아/손/빙글). FollowerNpc 는 산책 강아지로도 쓴다
 *    (id 'dogwalk:<studyId>', walk: true, sleepBeside 옵션 = Lv8 같이 자기).
 * 이벤트: 'update'(스냅샷, 바뀐 것이 있을 때) · 'pet'({ by, id, reaction, highFive }) · 'name'(name) · 'say'({ text, ms }) · 'trick'({ trick })
 */
const EventEmitter = require('node:events');
const { isBlocked } = require('../rooms/build');
const { normalizeNickname } = require('./nickname');

const TICK_MS = 100; // 10Hz
const PET_RANGE_PX = 56; // 쓰다듬기 가능 거리
const NEAR_PX = PET_RANGE_PX; // 플레이어가 이 안에 오면 쳐다본다 (15단계: 쓰다듬기 힌트가 뜨는 거리와 같게 — 힌트가 보이면 늘 쳐다본다)
const PET_COOLDOWN_MS = 3000;
const NAME_MAX = 8;
const SPEED = { wander: 40, stroll: 60, home: 50 }; // px/s
const DEFAULT_NAME = '사랑';
const FOLLOW_GAP_PX = 48; // 주인 뒤 1.5타일
const FOLLOW_TELEPORT_PX = 8 * 32; // 이만큼 멀어지면(못 따라오면) 순간이동
const FOLLOW_SIT_MS = 1000; // 주인이 멈추고 이만큼 지나면 앉는다
const COME_SPEED = 110;

// 라운지: 러그(16..26, 7..10) 주변. 쿠션은 (24,9), 강아지는 그 위에서 잔다.
const HOME = { x0: 16, y0: 7, x1: 26, y1: 11 };
const CUSHION = { x: 24, y: 9 };

/** 종별 정보: 반응 이모지 · 따라오는 속도 · 공용 펫 선호 구역/잠자리 */
const SPECIES = {
  // speed: 개인 펫이 따라오는 속도 (px/s). 주인(150)보다 빨라야 뒤처지지 않는다 — 거북이만 일부러 느리다
  dog: { reaction: '❤️', speed: 165 },
  hamster: { reaction: '🌰', speed: 160 },
  chick: { reaction: '🐣', speed: 155 },
  turtle: { reaction: '🍀', speed: 45, sharedSpeed: { wander: 12, stroll: 16, home: 14 }, home: { x0: 16, y0: 7, x1: 26, y1: 10 }, spots: [] },
  rabbit: { reaction: '🥕', speed: 180 },
  cat: { reaction: '😻', speed: 165, sharedSpeed: { wander: 45, stroll: 70, home: 55 }, home: { x0: 15, y0: 5, x1: 40, y1: 11 }, spots: [{ x: 35, y: 5 }, { x: 37, y: 5 }, { x: 19, y: 6 }, { x: 21, y: 6 }] },
  maltese: { reaction: '💗', speed: 165 },
  poodle_black: { reaction: '🖤', speed: 165 },
  shiba: { reaction: '🔥', speed: 170 },
  parrot: { reaction: '🎵', speed: 150, shoulder: true },
  slime: { reaction: '✨', speed: 150, bounce: true },
  fish: { reaction: '🫧', speed: 0, bowl: { x: 20, y: 8 } }, // 라운지 둥근 테이블 위 어항 (타일)
};

function center(room, tx, ty) {
  return { x: (tx + 0.5) * room.tileSize, y: (ty + 1) * room.tileSize };
}

class BaseNpc extends EventEmitter {
  constructor(room, { id, kind = 'pet', species = 'dog', name = DEFAULT_NAME, now = () => Date.now(), random = Math.random, tickMs = TICK_MS, x = 0, y = 0, cosmetics = null, skills = [] } = {}) {
    super();
    this.room = room;
    this.id = id;
    this.kind = kind;
    this.species = SPECIES[species] ? species : 'dog';
    this.name = name;
    this.now = now;
    this.random = random;
    this.tickMs = tickMs;
    this.x = x;
    this.y = y;
    this.facing = 'down';
    this.state = 'idle'; // walk | idle | sit | sleep | look
    this.path = []; // 남은 타일 좌표 목록
    this.speed = SPEED.wander;
    this.stateUntil = now();
    this.nextState = null;
    this.afterLook = null;
    this.lastPetAt = -Infinity;
    this.lastEmitAt = 0;
    this.timer = null;
    this.dirty = true;
    this.players = () => []; // 접속 중 플레이어 목록 공급자 (world 가 주입)
    this.prevTick = now();
    this.cosmetics = { head: null, neck: null, back: null, ...(cosmetics || {}) }; // 슬롯 → { itemId, variant, inventoryId } | null
    this.skills = new Set(skills);
    this.spots = []; // 목적지일 때만 밟을 수 있는 특별 타일 (쿠션·선반)
    this.ownerId = null;
  }

  get info() {
    return SPECIES[this.species];
  }

  /** 꾸미기 공개 형태: 슬롯 → 'itemId' 또는 'itemId/variant' */
  publicCosmetics() {
    const out = {};
    for (const slot of ['head', 'neck', 'back']) {
      const c = this.cosmetics[slot];
      out[slot] = c ? `${String(c.itemId).replace(/^deco_/, '')}${c.variant ? `/${c.variant}` : ''}` : null; // 아틀라스 키 'deco/<id>/<variant>' 의 가운데
    }
    return out;
  }

  snapshot() {
    const s = { id: this.id, kind: this.kind, species: this.species, name: this.name, x: Math.round(this.x * 100) / 100, y: Math.round(this.y * 100) / 100, facing: this.facing, state: this.state, cosmetics: this.publicCosmetics() };
    if (this.ownerId) s.ownerId = this.ownerId;
    if (this.info.shoulder) s.shoulder = true;
    if (this.info.bounce) s.bounce = true;
    if (this.level !== undefined && this.level !== null) s.level = this.level; // 18단계: 강아지 애정도 레벨 (이름 옆 ❤️)
    if (this.walk) s.walk = true;
    return s;
  }

  /** 18단계: 애정도 레벨 표시 (강아지·산책 강아지) */
  setLevel(level) {
    if (this.level === level) return;
    this.level = level;
    this.dirty = true;
  }

  /** 18단계: 말풍선 — 'say' { text, ms } (소켓이 npc:say 로 방송). 서버 상태는 바꾸지 않는다 */
  say(text, ms = 2500) {
    this.emit('say', { text, ms });
    return { text, ms };
  }

  /**
   * 18단계: 재주 (앉아·손·빙글). 상태 'trick_<id>' 로 잠깐 바꾸고 'trick' 이벤트. 걷는 중이던 경로는 버린다.
   * @returns {{ ok: true, trick, ms } | { ok: false, error }}
   */
  trick(id) {
    const ms = { sit: 2200, paw: 1600, spin: 1400 }[id];
    if (!ms) return { ok: false, error: 'no_trick' };
    this.path = [];
    this.targetTile = null;
    this.afterLook = null;
    this.setState(`trick_${id}`, ms);
    this.dirty = true;
    this.emit('trick', { trick: id, ms });
    return { ok: true, trick: id, ms };
  }

  get inTrick() {
    return typeof this.state === 'string' && this.state.startsWith('trick_') && this.now() < this.stateUntil;
  }

  setCosmetics(c) {
    this.cosmetics = { head: null, neck: null, back: null, ...(c || {}) };
    this.dirty = true;
  }

  addSkill(id) {
    this.skills.add(id);
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

  isSpot(tx, ty) {
    return this.spots.some((s) => s.x === tx && s.y === ty);
  }

  walkable(tx, ty) {
    if (this.isSpot(tx, ty)) return true;
    return !isBlocked(this.room, tx, ty);
  }

  /** BFS 경로 (시작 제외, 목표 포함). 없으면 null. 특별 타일(spots)은 목적지일 때만 밟는다 */
  findPath(from, to, maxNodes = 4000) {
    const key = (x, y) => `${x},${y}`;
    const prev = new Map([[key(from.tx, from.ty), null]]);
    const q = [[from.tx, from.ty]];
    let n = 0;
    while (q.length && n++ < maxNodes) {
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
        if (this.isSpot(nx, ny) && !(to.tx === nx && to.ty === ny)) continue;
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
      if (!this.isSpot(tx, ty) && !isBlocked(this.room, tx, ty)) return { tx, ty };
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

  between(a, b) {
    return a + this.random() * (b - a);
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

  /** 플레이어 옆 빈 타일 (본인 타일 포함) */
  tileBeside(p) {
    const T = this.room.tileSize;
    const tx = Math.floor(p.x / T);
    const ty = Math.floor((p.y - 1) / T);
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, 1], [0, -1], [0, 0], [-1, 1], [1, 1], [-1, -1], [1, -1]]) {
      if (!isBlocked(this.room, tx + dx, ty + dy)) return { tx: tx + dx, ty: ty + dy };
    }
    return { tx, ty };
  }

  /** 스킬 'come': 부른 사람 옆으로 달려가 쳐다본다. 경로가 없으면 false */
  comeTo(player) {
    const target = this.tileBeside(player);
    this.afterLook = null;
    const ok = this.goTo(target, COME_SPEED, () => { this.faceToward(player); this.setState('look', 2000); });
    if (ok) this.dirty = true;
    return ok;
  }

  emitIfNeeded(now) {
    if (this.hidden) return; // 18단계: 산책 나간 강아지는 방에 없다
    if (this.state === 'walk' || this.dirty || now - this.lastEmitAt >= 1000) {
      this.dirty = false;
      this.lastEmitAt = now;
      this.emit('update', this.snapshot());
    }
  }

  tick() {
    const now = this.now();
    const dt = Math.min(0.5, Math.max(0, (now - this.prevTick) / 1000));
    this.prevTick = now;
    this.behave(now, dt);
    this.emitIfNeeded(now);
  }

  behave(now, dt) {
    if (this.state === 'walk') this.step(dt);
    else if (now >= this.stateUntil) this.setState('idle', 1000);
  }

  // ── 상호작용 ─────────────────────────────────────────────────────
  /** @returns {{ ok: true, reaction, highFive } | { ok: false, error }} */
  pet(player) {
    if (Math.hypot(player.x - this.x, player.y - this.y) > PET_RANGE_PX) return { ok: false, error: 'too_far' };
    const now = this.now();
    if (now - this.lastPetAt < PET_COOLDOWN_MS) return { ok: false, error: 'cooldown' };
    this.lastPetAt = now;
    this.faceToward(player);
    const reaction = this.info.reaction;
    const highFive = this.skills.has('high_five');
    this.emit('pet', { by: player.nickname, id: player.id, reaction, highFive });
    return { ok: true, reaction, highFive };
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

// ── 방 공용 펫 (강아지 + 고양이·거북이·물고기) ─────────────────────────
class SharedPetNpc extends BaseNpc {
  constructor(room, { home = HOME, spots = [CUSHION], speeds = SPEED, startTile = null, stroll = null, ...opts } = {}) {
    super(room, { kind: opts.kind || 'pet', ...opts });
    this.home = home;
    this.stroll = stroll || { x0: 2, y0: 3, x1: 43, y1: 24 }; // 가끔 멀리 산책하는 구역 (14단계: 야외 고양이는 자기 구역)
    this.spots = spots;
    this.speeds = speeds;
    const st = startTile || spots[0] || { x: home.x0, y: home.y0 };
    const c = center(room, st.x, st.y);
    this.x = c.x;
    this.y = c.y;
    this.state = 'sleep';
    this.stateUntil = this.now() + 5000;
  }

  inHome() {
    const { tx, ty } = this.tile();
    return tx >= this.home.x0 && tx <= this.home.x1 && ty >= this.home.y0 && ty <= this.home.y1;
  }

  randomSpot() {
    return this.spots.length ? this.spots[Math.floor(this.random() * this.spots.length)] : null;
  }

  /** 현재 상태가 끝났을 때 다음 행동을 고른다 */
  decide() {
    const r = this.random();
    const S = this.speeds;
    if (!this.inHome() && r < 0.7) {
      const t = this.randomTile(this.home);
      if (t && this.goTo(t, S.home, () => this.setState('sit', this.between(3000, 7000)))) return;
    }
    if (r < 0.45) {
      const t = this.randomTile(this.home);
      if (t && this.goTo(t, S.wander, () => this.setState('idle', this.between(800, 2500)))) return;
    } else if (r < 0.65) {
      this.setState('sit', this.between(3000, 8000));
      return;
    } else if (r < 0.85) {
      const spot = this.randomSpot();
      if (spot && this.goTo({ tx: spot.x, ty: spot.y }, S.wander, () => this.setState('sleep', this.between(15000, 40000)))) return;
      if (!spot) { this.setState('sleep', this.between(10000, 25000)); return; }
    } else {
      const t = this.randomTile(this.stroll);
      if (t && this.goTo(t, S.stroll, () => this.setState('idle', this.between(1500, 4000)))) return;
    }
    this.setState('idle', this.between(800, 2000));
  }

  behave(now, dt) {
    if (this.inTrick) return; // 18단계: 재주 중엔 가만히
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
  }
}

/** 기존 라운지 푸들 (id 'dog') */
class DogNpc extends SharedPetNpc {
  constructor(room, opts = {}) {
    super(room, { id: 'dog', kind: 'dog', species: 'dog', name: DEFAULT_NAME, home: HOME, spots: [CUSHION], speeds: SPEED, ...opts });
  }
}

/** 어항 물고기: 어항(타일) 안에서 좌우로 헤엄친다 */
class FishNpc extends BaseNpc {
  constructor(room, opts = {}) {
    super(room, { kind: 'pet', species: 'fish', ...opts });
    const b = SPECIES.fish.bowl;
    const c = center(room, b.x, b.y);
    this.x = c.x;
    this.y = c.y - 10; // 테이블 위
    this.state = 'sit';
    this.swimUntil = this.now();
    this.tank = []; // 14단계: 낚시로 잡아 넣은 물고기 [{ fishId, by, at }]
  }

  setTank(tank) {
    this.tank = Array.isArray(tank) ? tank.map((f) => ({ fishId: f.fishId, by: f.by, at: f.at })) : [];
    this.dirty = true;
  }

  snapshot() {
    return { ...super.snapshot(), tank: this.tank.map((f) => f.fishId) };
  }

  behave(now) {
    if (now >= this.swimUntil) {
      const r = this.random();
      this.facing = r < 0.4 ? 'left' : r < 0.8 ? 'right' : this.facing;
      this.setState(r < 0.9 ? 'walk' : 'sleep');
      this.swimUntil = now + this.between(1500, 4000);
      this.dirty = true;
    }
  }

  emitIfNeeded(now) {
    if (this.dirty || now - this.lastEmitAt >= 1000) {
      this.dirty = false;
      this.lastEmitAt = now;
      this.emit('update', this.snapshot());
    }
  }
}

// ── 개인 펫: 주인을 따라다닌다 ─────────────────────────────────────────
class FollowerNpc extends BaseNpc {
  constructor(room, owner, { sleepBeside = false, walk = false, ...opts } = {}) {
    super(room, { kind: 'pet', ...opts });
    this.owner = owner; // 플레이어 객체 (위치·seatId·status·facing 을 매 틱 본다)
    this.ownerId = owner.id;
    this.sleepBeside = Boolean(sleepBeside); // 18단계: Lv8 같이 자기 (스킬 없이도)
    this.walk = Boolean(walk); // 18단계: 산책 중인 라운지 강아지
    this.trail = []; // 주인의 최근 위치
    this.ownerStillSince = null;
    this.lastOwner = { x: owner.x, y: owner.y };
    this.teleports = 0;
    const t = this.tileBeside(owner);
    const c = center(room, t.tx, t.ty);
    this.x = c.x;
    this.y = c.y;
    this.state = 'sit';
    this.facing = owner.facing || 'down';
    this.targetTile = null;
  }

  speedOf() {
    return this.info.speed;
  }

  /** 주인 옆으로 순간이동 */
  teleportToOwner() {
    const t = this.tileBeside(this.owner);
    const c = center(this.room, t.tx, t.ty);
    this.x = c.x;
    this.y = c.y;
    this.path = [];
    this.targetTile = null;
    this.trail = [];
    this.teleports++;
    this.dirty = true;
  }

  /** 주인 뒤 FOLLOW_GAP_PX 지점 (최근 위치 궤적에서) */
  followPoint() {
    const o = this.owner;
    for (let i = this.trail.length - 1; i >= 0; i--) {
      const p = this.trail[i];
      if (Math.hypot(p.x - o.x, p.y - o.y) >= FOLLOW_GAP_PX) return p;
    }
    return null;
  }

  behave(now, dt) {
    const o = this.owner;
    if (this.inTrick) return;
    if (this.info.shoulder) {
      // 어깨 위: 주인에게 붙어 다닌다
      const nx = o.x + (o.facing === 'left' ? -9 : 9);
      const ny = o.y - 36;
      if (nx !== this.x || ny !== this.y || this.facing !== o.facing) {
        this.x = nx;
        this.y = ny;
        this.facing = o.facing;
        this.dirty = true;
      }
      this.state = 'sit';
      return;
    }
    // 주인 궤적 기록
    if (Math.hypot(o.x - this.lastOwner.x, o.y - this.lastOwner.y) >= 4) {
      this.trail.push({ x: o.x, y: o.y });
      if (this.trail.length > 60) this.trail.shift();
      this.lastOwner = { x: o.x, y: o.y };
      this.ownerStillSince = null;
    } else if (this.ownerStillSince === null) this.ownerStillSince = now;

    const T = this.room.tileSize;
    const distOwner = Math.hypot(o.x - this.x, o.y - this.y);
    if (distOwner > FOLLOW_TELEPORT_PX) return this.teleportToOwner();

    // 목표 결정
    let goal = null;
    let restState = 'sit';
    if (o.seatId) {
      goal = this.tileBeside(o); // 발밑
      restState = (this.skills.has('sleep_beside') || this.sleepBeside) && o.status === 'study' ? 'sleep' : 'sit';
    } else {
      const fp = this.followPoint();
      if (fp) goal = { tx: Math.floor(fp.x / T), ty: Math.floor((fp.y - 1) / T) };
      else if (distOwner > FOLLOW_GAP_PX * 1.5) goal = this.tileBeside(o);
    }
    if (goal && !this.walkable(goal.tx, goal.ty)) goal = this.tileBeside(o);
    const here = this.tile();
    const atGoal = goal && goal.tx === here.tx && goal.ty === here.ty;
    if (goal && !atGoal) {
      if (!this.targetTile || this.targetTile.tx !== goal.tx || this.targetTile.ty !== goal.ty || !this.path.length) {
        const path = this.findPath(here, goal, 600);
        if (!path) return this.teleportToOwner(); // 못 따라오면 순간이동
        this.path = path;
        this.targetTile = goal;
        this.speed = this.speedOf();
        this.nextState = () => { this.targetTile = null; this.setState('idle', 0); };
        this.setState('walk');
      }
      this.step(dt);
      return;
    }
    // 도착/대기: 주인이 멈춘 지 1초 지나면 앉기(또는 발밑에서 자기)
    if (this.state === 'walk') { this.path = []; this.targetTile = null; this.setState('idle'); }
    if (o.seatId) {
      if (this.state !== restState) this.setState(restState);
    } else if (this.ownerStillSince !== null && now - this.ownerStillSince >= FOLLOW_SIT_MS) {
      if (this.state !== 'sit' && this.state !== 'look') this.setState('sit');
    } else if (this.state === 'sleep') this.setState('idle');
    if (this.state !== 'sleep' && this.state !== 'look') this.faceToward(o);
    if (this.state === 'look' && now >= this.stateUntil) this.setState('idle');
  }
}

// ── 18단계: 사람 NPC (매점 점원 · 바리스타) ─────────────────────────────
const HUMAN_ACTS = { clerk: ['wave', 'wipe'], barista: ['wipe', 'machine', 'arrange'] };
const ACT_MS = { wave: 1800, wipe: 2600, machine: 2400, arrange: 2200 };
const GREET_COOLDOWN_MS = 20 * 1000; // 같은 사람에게 다시 인사하기까지
const GREET_MS = 2200;

/**
 * 제자리에 서서 일하는 사람 NPC. 위치는 고정(x, y = 발 위치 px), 걷지 않는다.
 * 상태: idle → (2~6초 뒤) 행동 하나(HUMAN_ACTS[char]) → idle … . greet 지점(range 안)에 손님이 서면 'greet' 상태 + 말풍선(greeting).
 * 스냅샷: sheet 'npcs' · char ('clerk' | 'barista') · pettable false.
 */
class HumanNpc extends BaseNpc {
  constructor(room, { char = 'clerk', greet = null, greeting = '어서 오세요!', facing = 'down', ...opts } = {}) {
    super(room, { kind: 'human', species: 'dog', ...opts });
    this.char = char;
    this.greetSpot = greet; // { x, y, range } (px) — 없으면 인사 없음
    this.greeting = greeting;
    this.facing = facing;
    this.baseFacing = facing;
    this.state = 'idle';
    this.stateUntil = this.now() + this.between(1500, 4000);
    this.greeted = new Map(); // playerId → 마지막 인사 시각
    this.acts = HUMAN_ACTS[char] || ['wave'];
  }

  get info() {
    return { reaction: '🙂', speed: 0 };
  }

  snapshot() {
    const s = super.snapshot();
    s.species = this.char;
    s.sheet = 'npcs';
    s.char = this.char;
    s.pettable = false;
    return s;
  }

  /** greet 지점 안에 있는 손님 (가장 가까운) */
  customer() {
    const g = this.greetSpot;
    if (!g) return null;
    let best = null;
    let bestD = g.range;
    for (const p of this.players()) {
      const d = Math.hypot(p.x - g.x, p.y - g.y);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  behave(now) {
    const c = this.customer();
    if (c && now - (this.greeted.get(c.id) || -Infinity) >= GREET_COOLDOWN_MS) {
      this.greeted.set(c.id, now);
      this.facing = this.baseFacing;
      this.setState('greet', GREET_MS);
      this.say(this.greeting, GREET_MS);
      this.dirty = true;
      return;
    }
    if (now < this.stateUntil) return;
    if (this.state === 'idle' && this.random() < 0.6) {
      const act = this.acts[Math.floor(this.random() * this.acts.length)];
      this.setState(act, ACT_MS[act] || 2000);
    } else this.setState('idle', this.between(2000, 6000));
  }

  /** 구매 뒤 한마디 (상태는 잠깐 greet 로) */
  thank(text) {
    this.setState('greet', GREET_MS);
    this.dirty = true;
    return this.say(text, GREET_MS);
  }

  pet() {
    return { ok: false, error: 'not_pettable' };
  }
}

module.exports = { BaseNpc, DogNpc, SharedPetNpc, FishNpc, FollowerNpc, HumanNpc, SPECIES, HUMAN_ACTS, ACT_MS, GREET_COOLDOWN_MS, GREET_MS, TICK_MS, NEAR_PX, PET_RANGE_PX, PET_COOLDOWN_MS, NAME_MAX, HOME, CUSHION, DEFAULT_NAME, FOLLOW_GAP_PX, FOLLOW_TELEPORT_PX, FOLLOW_SIT_MS };
