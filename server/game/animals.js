'use strict';
/**
 * 14단계 B: 동물 NPC (야외 전용, 서버가 행동을 결정하고 npc:update 로 동기화).
 *
 *  - AnimalNpc: 우리 안 동물. area(안쪽 사각형) 밖으로 나가지 않는다 (경로 탐색도 area 안에서만). 상태기계: 어슬렁(walk) → 멈춤(idle) → 앉기(sit) → 먹기(eat) → 자기(sleep).
 *    feed(): 먹이 지점(feedTile)으로 걸어가 EAT_MS 동안 먹고 'react'(❤️) 를 낸다. 종별 속도(SPEED).
 *    스냅샷에 sheet: 'animals' (animals.png) — 토끼·고양이처럼 펫 시트(pets.png)에 있는 종은 sheet 를 붙이지 않는다.
 *  - DuckNpc: 연못 안쪽 물 타일에서만 헤엄친다(walkable 을 물 타일로 제한). 상태 swim(=walk)·idle·sleep.
 *  - SquirrelNpc: 나무 사이 지점(spots)을 빠르게 오가고, 앉아서 도토리를 먹는다. 쓰다듬기 가능.
 *  - PigeonNpc: 광장을 걸으며 모이를 쫀다. 플레이어가 FLEE_PX 안에 오면 날아올라(fly, 충돌 무시 직선 이동) 멀리 내려앉는다.
 *  - FireflyNpc: 밤 반딧불이 — 꽃밭·공원 위를 항상 천천히 떠다니고(fly, 충돌 무시, glow: true) 클라이언트가 밤에만 보여 준다. (나비는 후속 수정에서 뺐다)
 * 이벤트: BaseNpc 와 같은 'update' · 'pet' · 'name' + 'react' { reaction } (먹이를 먹었을 때)
 */
const { BaseNpc, SharedPetNpc, SPECIES: PET_SPECIES } = require('./npc');
const { isBlocked, TILES } = require('../rooms/build');

const ANIMAL_TICK_MS = 150; // 동물은 조금 느리게 (트래픽)
const EAT_MS = 4500;
const FLEE_PX = 64; // 비둘기가 날아오르는 거리
const SPEED = { panda: 26, lion: 40, giraffe: 34, penguin: 30, guinea_pig: 32, rabbit: 44, flamingo: 30, monkey: 55, elephant: 24, duck: 28, squirrel: 120, pigeon: 40, firefly: 18, cat: 45 };
const PETTABLE = new Set(['rabbit', 'guinea_pig', 'squirrel', 'cat']);
const REACTION = { panda: '🎋', lion: '🍖', giraffe: '🌿', penguin: '🐟', guinea_pig: '🥬', rabbit: '🥕', flamingo: '🦐', monkey: '🍌', elephant: '🍉', squirrel: '🌰', cat: '😻', duck: '🍞' };
const SHEET_SPECIES = new Set(['panda', 'lion', 'giraffe', 'penguin', 'guinea_pig', 'flamingo', 'monkey', 'elephant', 'duck', 'squirrel', 'pigeon']);
const NAMES = { panda: '판다', lion: '사자', giraffe: '기린', penguin: '펭귄', guinea_pig: '기니피그', flamingo: '플라밍고', monkey: '원숭이', elephant: '코끼리', duck: '오리', squirrel: '다람쥐', pigeon: '비둘기', rabbit: '토끼', cat: '고양이', firefly: '반딧불이' };

/** 바닥 타일 인덱스 집합 (이름 접두어) */
function floorSet(prefixes) {
  const out = new Set();
  for (const [name, o] of Object.entries(TILES.objects)) if (prefixes.some((p) => name.startsWith(p))) for (const row of o.tiles) for (const i of row) out.add(i);
  return out;
}
const WATER_TILES = floorSet(['water_']);
const POOL_TILES = floorSet(['pool_']);

function center(room, tx, ty) {
  return { x: (tx + 0.5) * room.tileSize, y: (ty + 1) * room.tileSize };
}

class AnimalNpc extends BaseNpc {
  /**
   * opts: area { x0, y0, x1, y1 } (타일, 포함) · feedTile { x, y } · species · name · pettable(기본 종별) · tickMs
   */
  constructor(room, { area, feedTile = null, species = 'panda', kind = 'animal', tickMs = ANIMAL_TICK_MS, ...opts } = {}) {
    super(room, { kind, tickMs, ...opts, species: PET_SPECIES[species] ? species : 'dog' });
    this.animal = species; // 실제 종 (npc.js 의 SPECIES 에 없는 종도 그대로)
    this.area = area;
    this.feedTile = feedTile;
    this.pettable = opts.pettable !== undefined ? opts.pettable : PETTABLE.has(species);
    this.feeding = null; // { until } 먹는 중
    this.fedCount = 0;
    const st = this.randomTile(area) || { tx: area.x0, ty: area.y0 };
    const c = center(room, st.tx, st.ty);
    this.x = c.x;
    this.y = c.y;
    this.facing = this.random() < 0.5 ? 'left' : 'right';
    this.state = 'idle';
    this.stateUntil = this.now() + this.between(500, 2500);
  }

  get info() {
    return PET_SPECIES[this.animal] || { reaction: REACTION[this.animal] || '❤️', speed: SPEED[this.animal] || 30 };
  }

  get speedPx() {
    return SPEED[this.animal] || 30;
  }

  snapshot() {
    const s = super.snapshot();
    s.species = this.animal;
    if (SHEET_SPECIES.has(this.animal)) s.sheet = 'animals';
    s.pettable = this.pettable;
    if (this.feeding) s.eating = true;
    return s;
  }

  inArea(tx, ty) {
    return tx >= this.area.x0 && tx <= this.area.x1 && ty >= this.area.y0 && ty <= this.area.y1;
  }

  walkable(tx, ty) {
    return this.inArea(tx, ty) && !isBlocked(this.room, tx, ty);
  }

  randomTile(area = this.area, tries = 40) {
    for (let i = 0; i < tries; i++) {
      const tx = area.x0 + Math.floor(this.random() * (area.x1 - area.x0 + 1));
      const ty = area.y0 + Math.floor(this.random() * (area.y1 - area.y0 + 1));
      if (this.walkable(tx, ty)) return { tx, ty };
    }
    return null;
  }

  /** 다음 행동 (기본 우리 동물) */
  decide() {
    const r = this.random();
    if (r < 0.4) {
      const t = this.randomTile();
      if (t && this.goTo(t, this.speedPx, () => this.setState('idle', this.between(800, 2500)))) return;
    } else if (r < 0.6) {
      this.setState('sit', this.between(3000, 8000));
      return;
    } else if (r < 0.75) {
      this.setState('eat', this.between(2500, 5000));
      return;
    } else if (r < 0.88) {
      this.setState('sleep', this.between(8000, 20000));
      return;
    }
    this.setState('idle', this.between(800, 2500));
  }

  /**
   * 먹이 주기: 먹이 지점으로 걸어가 먹는다. 이미 먹는 중이면 false.
   * @returns {boolean}
   */
  feed() {
    if (this.feeding) return false;
    this.feeding = { until: null }; // 가는 중에도 중복 요청 방지
    const target = this.feedTile && this.walkable(this.feedTile.x, this.feedTile.y) ? { tx: this.feedTile.x, ty: this.feedTile.y } : this.tile();
    const start = () => {
      this.feeding = { until: this.now() + EAT_MS };
      this.setState('eat', EAT_MS);
      this.fedCount++;
      this.dirty = true;
      this.emit('react', { reaction: REACTION[this.animal] || '❤️' });
    };
    const here = this.tile();
    if ((here.tx === target.tx && here.ty === target.ty) || !this.goTo(target, this.speedPx * 1.4, start)) start();
    this.dirty = true;
    return true;
  }

  /** 걷기·헤엄·날기 중엔 매 틱 전송 */
  emitIfNeeded(now) {
    if (this.state === 'walk' || this.state === 'fly' || this.state === 'swim' || this.dirty || now - this.lastEmitAt >= 1000) {
      this.dirty = false;
      this.lastEmitAt = now;
      this.emit('update', this.snapshot());
    }
  }

  behave(now, dt) {
    if (this.state === 'walk') { this.step(dt); return; }
    if (this.feeding && this.feeding.until !== null && now >= this.feeding.until) { this.feeding = null; this.dirty = true; }
    if (now >= this.stateUntil) this.decide();
  }
}

/** 오리: 연못 물 타일 위에서만 (헤엄). walk 상태 대신 swim */
class DuckNpc extends AnimalNpc {
  constructor(room, opts = {}) {
    super(room, { species: 'duck', kind: 'duck', ...opts });
  }

  walkable(tx, ty) {
    if (!this.inArea(tx, ty)) return false;
    const idx = this.room.layers.floor[ty] && this.room.layers.floor[ty][tx];
    return WATER_TILES.has(idx);
  }

  setState(state, ms) {
    super.setState(state === 'walk' ? 'swim' : state, ms);
  }

  behave(now, dt) {
    if (this.state === 'swim') { this.step(dt); return; }
    if (now >= this.stateUntil) {
      const r = this.random();
      if (r < 0.6) {
        const t = this.randomTile();
        if (t && this.goTo(t, this.speedPx, () => this.setState('idle', this.between(1000, 3000)))) return;
      } else if (r < 0.8) { this.setState('sleep', this.between(5000, 12000)); return; }
      this.setState('idle', this.between(1000, 3000));
    }
  }
}

/** 다람쥐: 나무 밑동(spots) 사이를 빠르게 오간다. 앉아서 도토리 */
class SquirrelNpc extends AnimalNpc {
  constructor(room, { spots = [], ...opts } = {}) {
    super(room, { species: 'squirrel', kind: 'squirrel', ...opts });
    this.treeSpots = spots.filter((s) => this.walkable(s.x, s.y));
    if (this.treeSpots.length) {
      const s = this.treeSpots[0];
      const c = center(room, s.x, s.y);
      this.x = c.x;
      this.y = c.y;
    }
  }

  decide() {
    const r = this.random();
    if (r < 0.5 && this.treeSpots.length) {
      const s = this.treeSpots[Math.floor(this.random() * this.treeSpots.length)];
      if (this.goTo({ tx: s.x, ty: s.y }, this.speedPx, () => this.setState('sit', this.between(2000, 5000)))) return;
    }
    if (r < 0.7) { this.setState('eat', this.between(2000, 4000)); return; }
    if (r < 0.8) { this.setState('sleep', this.between(4000, 9000)); return; }
    const t = this.randomTile();
    if (t && this.goTo(t, this.speedPx, () => this.setState('idle', this.between(500, 1500)))) return;
    this.setState('idle', this.between(500, 1500));
  }
}

/** 직선 비행 (충돌 무시): flyTo 로 목표를 정하면 도착할 때까지 fly */
class FlyerNpc extends AnimalNpc {
  constructor(room, opts = {}) {
    super(room, opts);
    this.flyTarget = null;
  }

  flyTo(x, y, speed, next) {
    const T = this.room.tileSize;
    x = Math.min(Math.max(x, (this.area.x0 + 0.2) * T), (this.area.x1 + 0.8) * T);
    y = Math.min(Math.max(y, (this.area.y0 + 0.6) * T), (this.area.y1 + 0.95) * T);
    this.flyTarget = { x, y, speed };
    this.path = [];
    this.nextState = next;
    this.setState('fly');
    this.facing = x < this.x ? 'left' : 'right';
    this.dirty = true;
  }

  flyStep(dt) {
    const t = this.flyTarget;
    if (!t) return this.arrive();
    const dx = t.x - this.x;
    const dy = t.y - this.y;
    const dist = Math.hypot(dx, dy);
    const remain = t.speed * dt;
    if (dist <= remain) { this.x = t.x; this.y = t.y; this.flyTarget = null; return this.arrive(); }
    this.x += (dx / dist) * remain;
    this.y += (dy / dist) * remain;
    return null;
  }

  behave(now, dt) {
    if (this.state === 'fly') { this.flyStep(dt); return; }
    super.behave(now, dt);
  }
}

/** 비둘기: 걷다가 사람이 가까이 오면 날아올라 멀리 내려앉는다 */
class PigeonNpc extends FlyerNpc {
  constructor(room, opts = {}) {
    super(room, { species: 'pigeon', kind: 'pigeon', ...opts });
    this.flights = 0;
  }

  decide() {
    const r = this.random();
    if (r < 0.5) {
      const t = this.randomTile();
      if (t && this.goTo(t, this.speedPx, () => this.setState('idle', this.between(500, 1500)))) return;
    } else if (r < 0.85) { this.setState('eat', this.between(1000, 2500)); return; }
    this.setState('idle', this.between(500, 2000));
  }

  behave(now, dt) {
    if (this.state !== 'fly') {
      const near = this.nearestPlayer(FLEE_PX);
      if (near) {
        // 사람 반대쪽으로 6~9타일 (area 안 걷기 가능한 칸 중 가장 멀리)
        const T = this.room.tileSize;
        let best = null;
        for (let i = 0; i < 20; i++) {
          const t = this.randomTile();
          if (!t) break;
          const c = center(this.room, t.tx, t.ty);
          const d = Math.hypot(c.x - near.x, c.y - near.y);
          if (d >= 6 * T && (!best || d > best.d)) best = { c, d };
        }
        const dest = best ? best.c : { x: this.x + (this.x - near.x) * 4, y: this.y + (this.y - near.y) * 4 };
        this.flights++;
        this.flyTo(dest.x, dest.y, 220, () => this.setState('idle', this.between(800, 2000)));
        return;
      }
    }
    super.behave(now, dt);
  }

  nearestPlayer(range = FLEE_PX) {
    let best = null;
    let bestD = range;
    for (const p of this.players()) {
      const d = Math.hypot(p.x - this.x, p.y - this.y);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }
}

/** 반딧불이: 밤에만 보이는 작은 불빛 (glow). 꽃밭·공원 위를 항상 천천히 떠다닌다 (fly, 충돌 무시, 목표를 자주 바꾼다) */
class FireflyNpc extends FlyerNpc {
  constructor(room, opts = {}) {
    super(room, { ...opts, species: 'firefly', kind: 'firefly', pettable: false });
    this.state = 'idle';
  }

  walkable(tx, ty) {
    return this.inArea(tx, ty);
  }

  decide() {
    const T = this.room.tileSize;
    const t = this.randomTile();
    if (t) {
      const c = center(this.room, t.tx, t.ty);
      this.flyTo(c.x + (this.random() - 0.5) * T, c.y - 10 + (this.random() - 0.5) * T, this.speedPx, () => this.setState('idle', this.between(300, 1500)));
      return;
    }
    this.setState('idle', 1000);
  }

  snapshot() {
    const s = { ...super.snapshot(), fly: true, glow: true };
    delete s.sheet;
    return s;
  }
}

/** 고양이: 10단계 공용 펫 행동(어슬렁·벤치 위 낮잠)을 야외 구역에 맞춘 것 (pets.png) */
class CatNpc extends SharedPetNpc {
  constructor(room, { area, spots = [], name = '고양이', ...opts } = {}) {
    super(room, { kind: 'cat', species: 'cat', name, home: area, spots, speeds: { wander: 45, stroll: 60, home: 50 }, stroll: area, tickMs: ANIMAL_TICK_MS, ...opts });
  }

  snapshot() {
    return { ...super.snapshot(), pettable: true };
  }
}

/** room.zoo / room.animals 정의로 야외 NPC 를 모두 만든다 */
function createOutdoorAnimals(room, base = {}) {
  const out = [];
  for (const e of (room.zoo && room.zoo.enclosures) || []) {
    const kinds = [[e.species, e.count], ...(e.extra || [])];
    for (const [species, count] of kinds) {
      for (let i = 0; i < count; i++) {
        out.push(new AnimalNpc(room, { ...base, id: `zoo:${e.id}:${species}:${i}`, species, name: NAMES[species] || e.name, area: e.area, feedTile: e.feedTile, kind: 'animal', enclosure: e.id }));
        out[out.length - 1].enclosure = e.id;
      }
    }
  }
  for (const a of room.animals || []) {
    const n = a.count || 1;
    for (let i = 0; i < n; i++) {
      const id = n > 1 ? `${a.id}:${i}` : a.id;
      const opts = { ...base, id, name: a.name || NAMES[a.species] || '', area: a.area, spots: a.spots };
      let npc;
      if (a.kind === 'duck') npc = new DuckNpc(room, opts);
      else if (a.kind === 'squirrel') npc = new SquirrelNpc(room, opts);
      else if (a.kind === 'cat') npc = new CatNpc(room, opts);
      else if (a.kind === 'pigeon') npc = new PigeonNpc(room, opts);
      else if (a.kind === 'firefly') npc = new FireflyNpc(room, opts);
      else npc = new AnimalNpc(room, { ...opts, species: a.species, kind: a.kind });
      out.push(npc);
    }
  }
  return out;
}

module.exports = { AnimalNpc, DuckNpc, SquirrelNpc, FlyerNpc, PigeonNpc, FireflyNpc, CatNpc, createOutdoorAnimals, ANIMAL_TICK_MS, EAT_MS, FLEE_PX, SPEED, REACTION, PETTABLE, WATER_TILES, POOL_TILES };
