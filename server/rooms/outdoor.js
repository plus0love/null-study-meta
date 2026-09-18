'use strict';
/**
 * "공용 야외" (12단계 → 14단계 확장) — 모든 스터디가 공유하는 100x70 타일 맵. Socket.io room 은 'outdoor' 하나.
 *
 * 구성 (타일 좌표, x 0..99 · y 0..69)
 *   y 0..2    하늘 띠 (통과 불가, 클라이언트가 시간대 그라데이션 + 밤 별 + 별똥별)
 *   y 3..12   뒤쪽 언덕 (전망대 데크 x 35..40 · 망원경 · 침엽수), y 9..11 경사 띠 3단, y 12 능선. 트랙 위 언덕(y 10..11)에 관중석 2줄
 *   y 13..20  스터디룸 건물 파사드 x 18..46 — 벽돌 벽 · 큰 창문 4개(밤엔 불빛, 낮엔 반사 = windowDay 레이어) · 캐노피 · 간판 조명 · 덩굴
 *             이중문 x 27..36, 문 타일 (31,19)(32,19) → 스터디로 복귀
 *   y 21..25  건물 앞 보도 (매트·볼라드·화단·벤치·자전거 거치대·플랜터) + 연석
 *   y 26..36  광장 x 14..47 (분수 3x3 애니 + 원형 포석 띠 2겹 · 가로등 · 벤치 · 화단 4색 · 전광판 x 42..46 · 카트 차고 x 44..46)
 *   좌측/하단 공원 (이음새 없는 잔디 4톤 + 잔디 결·클로버·작은 꽃·돌 · 나무 군락 6종 · 연못 x 3..10 y 39..45 (갈대·돌·수련) · 자갈 산책로 · 피크닉 테이블·담요)
 *   우측 트랙 x 48..78 · y 13..48: 폭 3 둥근 사각 흙길(모서리 반지름 8), 양옆 흰/빨강 연석 · 코너 안쪽 스키드 자국 · 바깥 타이어 배리어 · 코너 번호 표지판,
 *     출발선 (48..50, 31) 위 아치 배너 + 깃발, 시계 방향(왼쪽 직선에서 위로), 체크포인트 3개. 한 바퀴 중심선 약 120타일.
 *     안쪽 섬: 가운데 작은 연못(오리 1) + 자연스러운 꽃 군락 6곳(꽃 패치·작은 꽃·꽃 핀 잔디, 전부 통과 가능) + 벤치 2 주변 피크닉 담요·나무 군락 + 응원 깃발 8 + 피트 박스.
 *   x 80..99 · y 50..69: 14단계 B 동물원 (buildZoo). 우리마다 서식지 소품 5~8개 · 바닥 종별(잔디·모래·얼음·흙·마른 풀·진흙) · 두꺼운 나무 울타리 + 큰 안내판(2x2).
 *   빈 잔디는 Ctx.scatter 로 소품(꽃 군락·돌·통나무·낙엽·관목·그루터기)을 결정적으로 흩뿌린다 — 통과 불가 소품은 둘레가 비었을 때만 놓아 고립 구역을 만들지 않는다.
 * 통행 규칙: 산책로가 울타리와 만나는 곳은 전부 문(2칸 + 양쪽 기둥, ZOO_GATES). 걸을 수 있는 모든 바닥은 스폰에서 닿아야 한다 (우리 안쪽 제외, 만지기 코너만 문) — test/stage16.test.js 가 BFS 로 검증.
 * 문(doors[].to): 'studyroom' 이면 자기 스터디로 복귀. spawn 은 이중문 앞 보도.
 * room.track: 랩 판정 정의 (server/game/track.js). room.outdoor = true.
 */
const { RoomBuilder, TILE, TILES } = require('./build');

const W = 100;
const H = 70;
const TRACK = { x0: 48, x1: 78, y0: 13, y1: 48, width: 3, radius: 8 };
const SANS = { font: 'sans' };
const FOUNTAIN = { x: 32.5, y: 30.5 }; // 분수 중심 (타일)
const WALKABLE_KINDS = new Set(['grass', 'hill', 'path', 'track', 'plaza', 'paver', 'deck']); // 사람이 걷는 바닥 종류 (scatter 의 둘레 검사)
const INFIELD_POND = { x0: 61, y0: 28, x1: 65, y1: 32 }; // 트랙 안쪽 작은 연못 (물가 포함). 물은 안쪽 3x3
const FLOWER_COLORS = ['pink', 'yellow', 'purple', 'white', 'red']; // 꽃 패치(flower_patch_*) 색

/** 둥근 사각형 부호 거리 (셀 중심 기준, 안쪽이 음수) */
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function trackDistance(tx, ty) {
  const cx = (TRACK.x0 + TRACK.x1 + 1) / 2;
  const cy = (TRACK.y0 + TRACK.y1 + 1) / 2;
  const hw = (TRACK.x1 + 1 - TRACK.x0) / 2;
  const hh = (TRACK.y1 + 1 - TRACK.y0) / 2;
  return sdRoundRect(tx + 0.5, ty + 0.5, cx, cy, hw, hh, TRACK.radius);
}

/** 트랙 흙길 셀인지 (테스트·클라이언트 미니맵 공용) */
function isTrackCell(tx, ty) {
  const d = trackDistance(tx, ty);
  return d < 0 && d >= -TRACK.width;
}

/** 트랙 모서리 구역인지 (코너 스키드·타이어 배리어) */
function isTrackCorner(tx, ty) {
  const cx = (TRACK.x0 + TRACK.x1 + 1) / 2;
  const cy = (TRACK.y0 + TRACK.y1 + 1) / 2;
  const hw = (TRACK.x1 + 1 - TRACK.x0) / 2;
  const hh = (TRACK.y1 + 1 - TRACK.y0) / 2;
  return Math.abs(tx + 0.5 - cx) > hw - TRACK.radius && Math.abs(ty + 0.5 - cy) > hh - TRACK.radius;
}

/** 결정적 해시 (0..2^32) */
function hash(x, y, salt = 0) {
  let h = (x * 73856093) ^ (y * 19349663) ^ (salt * 83492791);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  return (h ^ (h >>> 15)) >>> 0;
}

/**
 * 맵 조립 컨텍스트: 바닥 종류(kind)를 기억해 산책로 테두리 마스크·소품 배치 검증(잔디 위 빈 자리만)에 쓴다.
 */
class Ctx {
  constructor(b) {
    this.b = b;
    this.kind = Array.from({ length: H }, () => new Array(W).fill('grass'));
  }

  setKind(x0, y0, x1, y1, k) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.kind[y][x] = k;
  }

  /** 모든 셀이 잔디/언덕이고 아직 소품이 없으면 true */
  free(x, y, w = 1, h = 1, kinds = ['grass', 'hill']) {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const tx = x + dx;
        const ty = y + dy;
        if (tx < 0 || ty < 0 || tx >= W || ty >= H) return false;
        if (!kinds.includes(this.kind[ty][tx]) || this.b.occupant[ty][tx] !== -1) return false;
      }
    }
    return true;
  }

  /** 소품 배치 (겹치면 예외 — 배치 실수를 바로 알 수 있게) */
  put(name, x, y, opts = {}) {
    const o = this.b.obj(name);
    if (!this.free(x, y, o.w, o.h, opts.kinds)) throw new Error(`[outdoor] ${name} 자리가 비어 있지 않음: (${x},${y})`);
    this.b.place(name, x, y, opts);
    for (let dy = 0; dy < o.h; dy++) for (let dx = 0; dx < o.w; dx++) if (o.layer === 'floor') this.kind[y + dy][x + dx] = opts.kind || 'prop';
    return this;
  }

  /** 자갈 산책로 셀 (테두리 마스크는 나중에 finishPaths 가 계산) */
  path(x, y) {
    this.kind[y][x] = 'path';
  }

  /**
   * 소품 footprint 둘레(8방)가 전부 걸을 수 있는 빈 칸인지 — 통과 불가 소품은 이 조건일 때만 흩뿌려서
   * 다른 장애물과 붙어 고립 구역을 만들지 않게 한다 (맵 가장자리도 장애물로 본다).
   */
  clearAround(x, y, w, h) {
    for (let ty = y - 1; ty <= y + h; ty++) {
      for (let tx = x - 1; tx <= x + w; tx++) {
        if (tx >= x && tx < x + w && ty >= y && ty < y + h) continue;
        if (tx < 0 || ty < 0 || tx >= W || ty >= H) return false;
        if (!WALKABLE_KINDS.has(this.kind[ty][tx])) return false;
        const occ = this.b.occupant[ty][tx];
        if (occ !== -1 && this.b.obj(this.b.props[occ].name).solid) return false;
      }
    }
    return true;
  }

  /** 꽃 군락: 가운데 + 이웃 2~4칸에 작은 꽃 (통과 가능). 놓은 개수를 돌려준다 */
  flowerCluster(x, y, salt) {
    let n = 0;
    const cells = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
    const want = 3 + (hash(x, y, salt) % 3);
    const col = FLOWER_COLORS[hash(x, y, salt + 3) % FLOWER_COLORS.length];
    for (let i = 0; i < cells.length && n < want; i++) {
      const [dx, dy] = cells[i];
      if (i > 0 && hash(x + dx, y + dy, salt + 1) % 3 === 0) continue;
      if (this.free(x + dx, y + dy, 1, 1, ['grass'])) { this.put(i === 0 ? `flower_patch_${col}` : `flower_${hash(x + dx, y + dy, salt + 2) % 3}`, x + dx, y + dy); n++; }
    }
    return n;
  }

  /**
   * 빈 잔디에 소품을 결정적으로 흩뿌린다 (밀도 density = 셀당 시도 확률).
   * items: [[name | 'flower_cluster', weight], ...]. 통과 불가 소품은 clearAround 를 만족할 때만.
   */
  scatter(x0, y0, x1, y1, salt, density, items, kinds = ['grass']) {
    const total = items.reduce((s, [, w]) => s + w, 0);
    let placed = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const h = hash(x, y, salt);
        if ((h % 1000) / 1000 >= density) continue;
        let r = (h >>> 10) % total;
        let name = items[0][0];
        for (const [n, w] of items) { if (r < w) { name = n; break; } r -= w; }
        if (name === 'flower_cluster') { placed += this.flowerCluster(x, y, salt + 7) > 0 ? 1 : 0; continue; }
        const o = this.b.obj(name);
        if (!this.free(x, y, o.w, o.h, kinds)) continue;
        if (o.solid && !this.clearAround(x, y, o.w, o.h)) continue;
        this.put(name, x, y);
        placed++;
      }
    }
    return placed;
  }

  /** 산책로 타일 확정: 잔디와 닿는 쪽에 흙 테두리 */
  finishPaths() {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (this.kind[y][x] !== 'path') continue;
        const edge = (nx, ny) => nx < 0 || ny < 0 || nx >= W || ny >= H || ['grass', 'hill', 'prop'].includes(this.kind[ny][nx]);
        const mask = (edge(x, y - 1) ? 1 : 0) | (edge(x + 1, y) ? 2 : 0) | (edge(x, y + 1) ? 4 : 0) | (edge(x - 1, y) ? 8 : 0);
        this.b.place(`gravel_${mask}`, x, y);
      }
    }
  }
}

function buildOutdoor() {
  const b = new RoomBuilder({ id: 'outdoor', name: '공용 야외', width: W, height: H });
  const c = new Ctx(b);

  // ── 하늘 · 언덕 ──────────────────────────────────────────────────────
  b.fill('sky', 0, 0, W - 1, 2);
  c.setKind(0, 0, W - 1, 2, 'sky');
  b.window(0, 0, W, 3.5);
  for (let y = 3; y <= 12; y++) {
    for (let x = 0; x < W; x++) {
      const name = y === 12 ? 'hill_edge' : y >= 9 ? `hill_step_${y - 9}` : hash(x, y, 1) % 4 === 0 ? 'hill_b' : 'hill_a';
      b.place(name, x, y);
      c.kind[y][x] = 'hill';
    }
  }
  // ── 잔디 (이음새 없는 4톤 x 3시드 + 소품 변형) ─────────────────────────
  for (let y = 13; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const h = hash(x, y, 2);
      const r = h % 100;
      let name = `grass2_${h % 4}_${(h >>> 4) % 3}`;
      if (r < 4) name = `grass_tuft_${(h >>> 8) % 3}`;
      else if (r < 7) name = `grass_clover_${(h >>> 8) % 3}`;
      else if (r < 9) name = `grass_flowers_${(h >>> 8) % 3}`;
      else if (r < 10) name = `grass_pebble_${(h >>> 8) % 3}`;
      b.place(name, x, y);
    }
  }

  buildTrack(b, c);
  buildBuilding(b, c);
  buildPlaza(b, c);
  buildPark(b, c);
  buildHill(b, c);
  buildZoo(b, c);
  c.finishPaths();

  b.setSpawn(31, 22);
  const room = b.build();
  room.outdoor = true;
  room.zoo = b.zoo;
  room.animals = FREE_ANIMALS;
  // 랩 판정: 왼쪽 직선(x 48..50, y 31)의 출발선을 위(북)로 지나면 시작 → 위·오른쪽·아래 직선 가운데를 차례로 → 다시 출발선
  room.track = {
    start: { x1: 48 * TILE, y1: 31.5 * TILE, x2: 51 * TILE, y2: 31.5 * TILE },
    dir: { x: 0, y: -1 },
    checkpoints: [
      { x: 63.5 * TILE, y: 14.5 * TILE, r: 2.5 * TILE },
      { x: 77.5 * TILE, y: 30.5 * TILE, r: 2.5 * TILE },
      { x: 63.5 * TILE, y: 47.5 * TILE, r: 2.5 * TILE },
    ],
    lengthTiles: 120,
    bounds: { ...TRACK },
  };
  return room;
}

// ── 트랙: 연석 · 스키드 · 출발 아치 · 타이어 배리어 · 관중석 · 코너 표지판 · 피트 · 안쪽 꽃밭 ──
function buildTrack(b, c) {
  for (let y = TRACK.y0 - 1; y <= TRACK.y1 + 1; y++) {
    for (let x = TRACK.x0 - 1; x <= TRACK.x1 + 1; x++) {
      if (!isTrackCell(x, y)) continue;
      const sides = [['N', x, y - 1], ['E', x + 1, y], ['S', x, y + 1], ['W', x - 1, y]].filter(([, nx, ny]) => !isTrackCell(nx, ny)).map(([s]) => s).join('');
      let name;
      if (y === 31 && x >= 48 && x <= 50) name = x === 48 ? 'start_line_W' : x === 50 ? 'start_line_E' : 'start_line';
      else if (!sides) name = isTrackCorner(x, y) ? `dirt_skid_${hash(x, y, 3) % 2}` : 'dirt_a';
      else name = TILES.objects[`dirt_kerb_${sides}`] ? `dirt_kerb_${sides}` : 'dirt_b';
      b.place(name, x, y);
      c.kind[y][x] = 'track';
    }
  }
  // 바깥 타이어 배리어 (모서리, 트랙 바로 밖 한 칸 걸러)
  for (let y = TRACK.y0 - 1; y <= TRACK.y1 + 1; y++) {
    for (let x = TRACK.x0 - 1; x <= TRACK.x1 + 1; x++) {
      const d = trackDistance(x, y);
      if (d < 0 || d >= 1 || !isTrackCorner(x, y) || y <= 12) continue;
      if ((x + y) % 2 === 0 && c.free(x, y)) c.put('tire_stack', x, y);
    }
  }
  // 출발 아치: 배너(top) + 양쪽 기둥 + 깃발
  b.place('start_banner', 47, 30);
  c.put('arch_post', 47, 31);
  c.put('arch_post', 51, 31);
  // 코너 표지판 (바깥, 시계 방향 1..4: 좌상 → 우상 → 우하 → 좌하)
  const signAt = (n, sx, sy) => {
    for (let r = 0; r < 4; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const x = sx + dx;
        const y = sy + dy;
        if (y > 12 && trackDistance(x, y) >= 0.5 && c.free(x, y)) { c.put(`corner_sign_${n}`, x, y); return; }
      }
    }
  };
  signAt(1, 50, 14);
  signAt(2, 77, 14);
  signAt(3, 77, 47);
  signAt(4, 50, 47);
  // 관중석: 트랙 위 언덕 경사에 2줄 (아래·트랙 쪽을 본다)
  for (const y of [10, 11]) for (let x = 55; x <= 72; x += 3) c.put('stand_bench_s', x, y);
  b.place('lamp_post', 75, 10);
  b.light(75.5, 10.3, 4.0, 0xffd48a, 0.7);
  b.place('lamp_post', 52, 10);
  b.light(52.5, 10.3, 4.0, 0xffd48a, 0.7);
  // 피트 박스 (안쪽, 왼쪽 직선 옆) + 타이어
  c.put('pit_box', 52, 33);
  c.put('tire_stack', 52, 36);
  c.put('tire_stack', 55, 33);
  // 안쪽 섬 — 가운데 작은 연못(오리 1마리) + 자연스러운 꽃 군락 + 벤치 주변 피크닉 담요·나무 군락 + 관중 응원 깃발
  const P = INFIELD_POND;
  for (let y = P.y0; y <= P.y1; y++) {
    for (let x = P.x0; x <= P.x1; x++) {
      const n = y === P.y0 ? 'N' : y === P.y1 ? 'S' : '';
      const e = x === P.x1 ? 'E' : x === P.x0 ? 'W' : '';
      if (n + e) b.place(`shore_${n + e}`, x, y);
      else if (x === 63 && y === 30) b.place('water_lily_f0', x, y);
      else b.place((x + y) % 2 ? 'water_f1' : 'water_f0', x, y);
    }
  }
  c.setKind(P.x0, P.y0, P.x1, P.y1, 'water');
  b.place('reed', 62, P.y0);
  b.place('reed', P.x1, 31);
  c.put('pond_rock', 60, 29);
  c.put('pond_rock', 66, 32);
  c.put('lamp_post', 57, 30);
  b.light(57.5, 30.3, 4.0, 0xffd48a, 0.7);
  c.put('lamp_post', 70, 30);
  b.light(70.5, 30.3, 4.0, 0xffd48a, 0.7);
  // 벤치 2 + 피크닉 담요 + 나무 군락 (위·아래)
  c.put('bench_park', 64, 24);
  c.put('blanket', 66, 24);
  c.put('tree_round', 60, 20);
  c.put('tree_birch', 66, 20);
  c.put('tree_small', 63, 19);
  c.put('bush_0', 62, 22);
  c.put('bench_park', 62, 37);
  c.put('blanket', 64, 36);
  c.put('tree_olive', 57, 38);
  c.put('tree_round', 66, 39);
  c.put('tree_small', 60, 40);
  c.put('bush_1', 69, 42);
  c.put('rock_a', 73, 25);
  c.put('rock_a', 55, 43);
  c.put('rock_b', 72, 37);
  c.put('stump', 56, 22);
  // 꽃 군락: 중심·반지름·색. 중심 가까이는 테두리 없는 촘촘한 꽃 패치(통과 가능), 둘레는 작은 꽃, 바깥은 꽃 핀 잔디 바닥 — 격자 화단 대신 자연스러운 덩어리
  const clusters = [[57, 26, 3, 'pink'], [69, 26, 3, 'yellow'], [57, 35, 2.6, 'purple'], [70, 35, 2.6, 'white'], [63, 26, 1.7, 'red'], [63, 35, 1.7, 'pink']];
  for (const [cx, cy, r, col] of clusters) {
    for (let y = Math.floor(cy - r * 1.5); y <= Math.ceil(cy + r * 1.5); y++) {
      for (let x = Math.floor(cx - r * 1.5); x <= Math.ceil(cx + r * 1.5); x++) {
        const d = Math.hypot(x - cx, y - cy) + ((hash(x, y, 4) % 100) / 100 - 0.5) * 0.9; // 가장자리를 울퉁불퉁하게
        if (!c.free(x, y, 1, 1, ['grass'])) continue;
        if (d < r * 0.55) c.put(`flower_patch_${col}`, x, y);
        else if (d < r) { if (hash(x, y, 5) % 10 < 7) c.put(hash(x, y, 9) % 3 === 0 ? `flower_patch_${col}` : `flower_${hash(x, y, 6) % 3}`, x, y); }
        else if (d < r * 1.5 && hash(x, y, 7) % 2 === 0) b.place(`grass_flowers_${hash(x, y, 8) % 3}`, x, y);
      }
    }
  }
  // 관중 응원 깃발: 안쪽 섬 가장자리 (기둥 칸은 y+1)
  [[54, 17], [72, 17], [60, 16], [66, 16], [54, 43], [72, 43], [60, 44], [66, 44]].forEach(([x, y], i) => { if (c.free(x, y, 1, 2, ['grass'])) c.put(`cheer_flag_${i % 3}`, x, y); });
}

// ── 건물 파사드 ──────────────────────────────────────────────────────────
function buildBuilding(b, c) {
  for (let x = 18; x <= 46; x++) b.place('wall_top', x, 13);
  for (let y = 14; y <= 20; y++) for (let x = 18; x <= 46; x++) b.place(`brick_${hash(x, y, 8) % 2}`, x, y);
  c.setKind(18, 13, 46, 20, 'building');
  // 큰 창문 4개: 밤 타일 + 낮 타일(windowDay 레이어, 클라이언트가 낮에 알파를 올린다)
  for (const [x, y] of [[21, 15], [24, 15], [39, 15], [42, 15]]) {
    b.place('facade_window_night', x, y);
    b.place('facade_window_day', x, y, { layer: 'windowDay' });
    b.light(x + 1, y + 1.2, 2.2, 0xffc46a, 0.35);
  }
  b.place('wall_vine_out', 23, 17);
  b.place('wall_vine_out', 41, 17);
  b.place('entrance_wide', 27, 19);
  b.setSolid(31, 19, 32, 20, false);
  b.doors.push({ id: 'exit', x: 31, y: 19, to: 'studyroom' }, { id: 'exit', x: 32, y: 19, to: 'studyroom' });
  b.place('canopy', 27, 18);
  b.light(27.5, 19.3, 2.8, 0xffc46a, 0.55);
  b.light(36.5, 19.3, 2.8, 0xffc46a, 0.55);
  b.place('sign_left', 18, 14);
  b.label(19.5, 16.1, 'Same\nPlace\nBrighter\nUs\n♡', { ...SANS, size: 9, color: '#efe6d6', lineHeight: 1.25 });
  b.place('sign_right', 44, 14);
  b.label(45.5, 16.1, 'Good\nIdeas\nStart\nHere\n→', { ...SANS, size: 9, color: '#efe6d6', lineHeight: 1.25 });
  b.place('sign_lamp', 19, 13);
  b.place('sign_lamp', 45, 13);
  b.light(19.5, 14.2, 2.0, 0xffd48a, 0.4);
  b.light(45.5, 14.2, 2.0, 0xffd48a, 0.4);
  b.label(32, 15.5, 'STUDY ROOM', { ...SANS, size: 16, weight: 700, color: '#efe6d6', spacing: 2 });
  b.place('sign_lamp', 29, 13);
  b.place('sign_lamp', 35, 13);
  b.light(29.5, 14.4, 2.4, 0xffd48a, 0.45);
  b.light(35.5, 14.4, 2.4, 0xffd48a, 0.45);

  // 보도 · 연석 · 매트 · 볼라드 · 화분 · 화단 · 벤치 · 자전거 거치대 · 플랜터
  b.fill(['paver_0', 'paver_1'], 14, 21, 47, 24);
  b.fill('kerb', 14, 25, 47, 25);
  c.setKind(14, 21, 47, 25, 'paver');
  b.place('doormat_big', 28, 21);
  b.label(31.5, 22.45, 'WELCOME\nTO\nOUR STUDY ROOM\n♡', { ...SANS, size: 9, weight: 600, color: '#e4d3b4', lineHeight: 1.2, spacing: 1 });
  b.place('bollard', 25, 21);
  b.place('bollard', 38, 21);
  b.light(25.5, 21.6, 2.4, 0xffc46a, 0.5);
  b.light(38.5, 21.6, 2.4, 0xffc46a, 0.5);
  b.place('plant_tall_3', 26, 21);
  b.place('plant_tall_1', 37, 21);
  b.fill(['hedge_0', 'hedge_1', 'hedge_flower_0'], 14, 21, 23, 22);
  b.fill(['hedge_1', 'hedge_0', 'hedge_flower_1'], 40, 21, 47, 22);
  b.place('bench', 16, 23);
  b.place('bench', 41, 23);
  b.place('bike_rack', 22, 23);
  b.place('planter_pink', 38, 23);
  b.place('planter_yellow', 46, 23);
  b.place('planter_purple', 14, 23);
}

// ── 광장 ────────────────────────────────────────────────────────────────
function buildPlaza(b, c) {
  for (let y = 26; y <= 36; y++) {
    for (let x = 14; x <= 47; x++) {
      const d = Math.hypot(x + 0.5 - FOUNTAIN.x, y + 0.5 - FOUNTAIN.y);
      const name = d < 2.3 ? 'plaza_center' : d < 3.2 ? 'plaza_ring' : d >= 4.6 && d < 5.4 ? 'plaza_ring2' : hash(x, y, 9) % 3 === 0 ? 'plaza_b' : 'plaza_a';
      b.place(name, x, y);
    }
  }
  c.setKind(14, 26, 47, 36, 'plaza');
  b.place('fountain_f0', 31, 29);
  b.light(32.5, 30.5, 3.2, 0x9fd0ff, 0.3);
  for (const [x, y] of [[17, 27], [40, 27], [17, 34], [24, 36], [39, 36]]) {
    b.place('lamp_post', x, y);
    b.light(x + 0.5, y + 0.3, 4.0, 0xffd48a, 0.7);
  }
  b.place('bench_park', 26, 30);
  b.place('bench_park', 36, 30);
  b.place('bench_park', 31, 34);
  b.place('bench_park', 20, 33);
  b.place('bench_park', 43, 34);
  // 화단 4색 (모서리·전광판 옆)
  const beds = [[14, 26, 'pink'], [15, 26, 'yellow'], [14, 27, 'purple'], [47, 36, 'red'], [46, 36, 'white'], [47, 35, 'pink'], [20, 26, 'yellow'], [21, 26, 'pink'], [22, 26, 'purple'], [36, 26, 'white'], [37, 26, 'red'], [38, 26, 'yellow'], [14, 36, 'white'], [15, 36, 'purple']];
  for (const [x, y, col] of beds) b.place(`flowerbed_${col}`, x, y);
  b.place('trash_bin', 16, 36);
  b.place('scoreboard', 42, 26);
  b.light(44.5, 27, 3.4, 0xffb85c, 0.4);
  b.interactable('board', 'board', 44.5, 30, { hint: '기록 보기', range: 64 });
  b.place('kart_garage', 44, 31);
  b.label(45.5, 33.4, 'KART', { ...SANS, size: 7, weight: 700, color: '#ffb85c', spacing: 1 });
  b.interactable('kartstop', 'shop', 45.5, 34.5, { hint: '탈것 상점', range: 56 });
}

// ── 공원 (왼쪽 + 아래) ───────────────────────────────────────────────────
function buildPark(b, c) {
  // 자갈 산책로: 광장 서쪽 → 연못, 광장 남쪽 → 동물원 입구(y 49), 연못 동쪽 → 아래 공원
  for (let x = 5; x <= 13; x++) c.path(x, 31);
  for (let y = 32; y <= 38; y++) c.path(5, y);
  for (let y = 37; y <= 49; y++) for (let x = 32; x <= 33; x++) c.path(x, y); // 동물원 정문까지 2칸 폭 (문 32..33)
  for (let x = 12; x <= 17; x++) c.path(x, 40);
  for (let y = 41; y <= 44; y++) c.path(12, y);
  // 연못 x 3..10, y 39..45 (물가 8방향 + 안쪽 물 2프레임 체크 + 수련)
  for (let y = 39; y <= 45; y++) {
    for (let x = 3; x <= 10; x++) {
      const n = y === 39 ? 'N' : y === 45 ? 'S' : '';
      const e = x === 10 ? 'E' : x === 3 ? 'W' : '';
      const sides = n + e;
      if (sides) b.place(`shore_${sides}`, x, y);
      else if ((x === 5 && y === 41) || (x === 8 && y === 43)) b.place((x + y) % 2 ? 'water_lily_f1' : 'water_lily_f0', x, y);
      else b.place((x + y) % 2 ? 'water_f1' : 'water_f0', x, y);
    }
  }
  c.setKind(3, 39, 10, 45, 'water');
  for (const [x, y] of [[3, 39], [7, 39], [10, 40], [10, 44], [4, 45], [8, 45]]) b.place('reed', x, y);
  for (const [x, y] of [[2, 40], [11, 44], [9, 46], [1, 44]]) c.put('pond_rock', x, y);
  // 낚시 자리 4곳 (C 단계): 연못 둘레 — E 로 낚싯대를 든다
  [[5, 38], [11, 41], [7, 46], [2, 43]].forEach(([x, y], i) => b.interactable(`fish:${i}`, 'fish', x + 0.5, y + 1, { hint: '낚시하기', range: 40 }));

  // 나무 군락 NW (큰 활엽수 + 활엽수 + 자작나무 + 덤불)
  c.put('tree_round_big', 1, 13);
  c.put('tree_round', 4, 15);
  c.put('tree_small', 7, 14);
  c.put('tree_birch', 9, 13);
  c.put('bush_0', 6, 18);
  c.put('bush_1', 3, 18);
  c.put('tree_pine', 12, 15);
  // 피크닉
  c.put('picnic_table', 2, 20);
  c.put('blanket', 6, 20);
  c.put('picnic_table', 9, 22);
  c.put('flower_0', 5, 22);
  // 군락 W
  c.put('tree_olive', 1, 24);
  c.put('tree_round', 10, 26);
  c.put('tree_pine', 6, 27);
  c.put('tree_small', 3, 28);
  c.put('bush_1', 9, 29);
  c.put('lamp_post', 12, 29);
  b.light(12.5, 29.3, 4.0, 0xffd48a, 0.7);
  // 군락 SW (연못 위)
  c.put('tree_round', 1, 33);
  c.put('tree_birch', 9, 34);
  c.put('bench_park', 12, 36);
  c.put('tree_small', 8, 37);
  c.put('tree_pine', 1, 36);
  c.put('lamp_post', 11, 38);
  b.light(11.5, 38.3, 4.0, 0xffd48a, 0.7);
  // 아래 공원 (y 37..49)
  c.put('tree_round', 20, 38);
  c.put('tree_round_big', 26, 40);
  c.put('tree_birch', 40, 38);
  c.put('tree_pine', 44, 40);
  c.put('tree_olive', 22, 44);
  c.put('tree_small', 47, 38);
  c.put('tree_small', 15, 43);
  c.put('tree_round', 36, 40);
  c.put('tree_round_big', 17, 45);
  c.put('tree_birch', 29, 45);
  c.put('tree_olive', 42, 44);
  c.put('tree_pine', 46, 46);
  c.put('bush_0', 24, 38);
  c.put('bush_1', 34, 44);
  c.put('picnic_table', 37, 45);
  c.put('blanket', 41, 47);
  c.put('bench_park', 13, 46);
  c.put('bench_park', 34, 37);
  c.put('lamp_post', 28, 44);
  b.light(28.5, 44.3, 4.0, 0xffd48a, 0.7);
  c.put('lamp_post', 44, 43);
  b.light(44.5, 43.3, 4.0, 0xffd48a, 0.7);
  for (const [x, y] of [[4, 24], [7, 25], [13, 33], [2, 30], [18, 43], [25, 39], [30, 42], [38, 42], [41, 43], [17, 48], [7, 48], [45, 48], [22, 48], [35, 48], [1, 47]]) if (c.free(x, y)) c.put(`flower_${(x + y) % 3}`, x, y);
  for (const [x, y] of [[11, 24], [3, 35], [28, 48], [46, 49]]) if (c.free(x, y)) c.put('rock_a', x, y);
  if (c.free(14, 48, 2, 1)) c.put('rock_b', 14, 48);
  // 빈 잔디 소품 밀도 ↑: 꽃 군락·돌·통나무·낙엽·작은 관목·그루터기 (왼쪽 공원 + 아래 공원)
  c.scatter(0, 13, 13, 49, 21, 0.09, PARK_SCATTER);
  c.scatter(14, 37, 47, 49, 22, 0.09, PARK_SCATTER);
}

/** 흩뿌리는 소품과 가중치 (꽃 군락은 통과 가능 꽃 3~5칸) */
const PARK_SCATTER = [['flower_cluster', 6], ['leaves_0', 2], ['leaves_1', 2], ['leaves_2', 2], ['rock_a', 3], ['rock_b', 1], ['log', 1], ['shrub_0', 3], ['shrub_1', 3], ['stump', 1], ['bush_0', 1]];

// ── 언덕: 전망대 · 망원경 · 침엽수 · 돌 ───────────────────────────────────
function buildHill(b, c) {
  b.fill(['deck_a', 'deck_b'], 35, 5, 40, 8, { checker: true });
  c.setKind(35, 5, 40, 8, 'deck');
  for (const x of [35, 36, 38, 39, 40]) b.place('railing_h', x, 5);
  b.place('telescope', 37, 4);
  b.interactable('telescope', 'telescope', 37.5, 7, { hint: '망원경 보기', range: 40 }); // C 단계: 밤에 오늘의 별자리
  for (let y = 6; y <= 8; y++) { b.place('railing_v', 35, y); b.place('railing_v', 40, y); }
  for (const [x, y] of [[3, 4], [9, 7], [16, 4], [23, 7], [55, 5], [62, 8], [69, 4], [75, 7], [85, 5], [92, 8], [97, 4], [47, 8], [30, 5]]) if (c.free(x, y, 2, 3)) c.put('tree_pine', x, y);
  for (const [x, y] of [[28, 9], [48, 10], [12, 10], [66, 8], [88, 10]]) if (c.free(x, y)) c.put('rock_a', x, y);
  if (c.free(43, 9, 2, 1)) c.put('rock_b', 43, 9);
  b.label(38, 9.6, 'OBSERVATORY', { ...SANS, size: 8, weight: 600, color: '#efe6d6', spacing: 1 });
  c.scatter(0, 3, W - 1, 8, 23, 0.04, [['rock_a', 2], ['shrub_0', 2], ['shrub_1', 1], ['dry_grass', 3], ['stump', 1]], ['hill']);
}

// ── 동물원 (14단계 B) — 아래 띠 y 50..69 + 우측 띠 x 80..99 (L 자) ──────────────
/**
 * 우리 정의: id · 이름 · 한 줄 설명 · 종(animals.png 또는 pets.png) · 마릿수 · 사각형(울타리 포함) · 바닥 · 유리 펜스 쪽(front) · 소품
 * 방 데이터 room.zoo = { enclosures: [{ id, name, desc, species, count, area(안쪽), feedTile, sign }], photo: 사각형, snacks: [...] }
 */
/**
 * floor: grass(잔디) · sand(모래) · ice(얼음) · soil(흙) · savanna(마른 풀). mud: 물웅덩이 둘레 진흙 사각형. lilies: 우리 물 위 수련 칸.
 * props: 우리마다 서식지 소품 5~8개 (울타리 안쪽에만, 서로 겹치지 않게 — buildZoo 가 검증).
 */
const ENCLOSURES = [
  { id: 'panda', name: '판다', desc: '대나무를 하루 종일 씹어요. 먹이를 주면 느긋하게 다가와요.', species: 'panda', count: 2, rect: [4, 51, 15, 56], floor: 'grass', front: 'S',
    props: [['bamboo_dense', 5, 52], ['bamboo_dense', 6, 52], ['bamboo', 9, 52], ['bamboo', 14, 52], ['bamboo_dense', 13, 53], ['bamboo_dense', 5, 54], ['rock_b', 11, 55], ['rock_a', 7, 55]] },
  { id: 'penguin', name: '펭귄', desc: '얼음 위를 뒤뚱뒤뚱, 물에 들어가면 날쌔요.', species: 'penguin', count: 3, rect: [18, 51, 29, 56], floor: 'ice', front: 'S', pool: [24, 52, 27, 54],
    props: [['ice_slide', 19, 52], ['snow_mound', 21, 52], ['ice_block', 28, 52], ['ice_block', 19, 54], ['snow_mound', 21, 55], ['ice_block', 28, 55], ['snow_mound', 23, 55]] },
  { id: 'flamingo', name: '플라밍고', desc: '한 다리로 서서 쉬는 분홍 새. 연못가에서 우아하게 걸어요.', species: 'flamingo', count: 3, rect: [36, 51, 47, 56], floor: 'grass', front: 'S', pool: [38, 52, 41, 54], lilies: [[39, 53], [40, 53]],
    props: [['reed', 37, 52], ['reed', 42, 52], ['reed', 37, 54], ['reed', 43, 55], ['rock_a', 45, 55], ['rock_b', 44, 52], ['dry_grass', 46, 54]] },
  { id: 'petting', name: '토끼·기니피그', desc: '들어가서 만져 볼 수 있어요. 살살, 조심조심.', species: 'rabbit', count: 2, extra: [['guinea_pig', 2]], rect: [50, 51, 61, 56], floor: 'grass', front: 'S', gate: [55, 56, 56, 56],
    props: [['hay', 52, 52], ['hay', 60, 52], ['trough', 57, 52], ['burrow', 51, 54], ['burrow', 60, 55], ['carrot_plate', 54, 53], ['carrot_plate', 58, 55], ['hay', 51, 52]] },
  { id: 'giraffe', name: '기린', desc: '키가 커서 나무 꼭대기 잎을 먹어요. 혀가 아주 길답니다.', species: 'giraffe', count: 2, rect: [81, 18, 86, 31], floor: 'savanna', front: 'E',
    props: [['acacia', 82, 19], ['acacia', 84, 24], ['feeder_tall', 82, 29], ['dry_grass', 83, 24], ['dry_grass', 85, 30], ['rock_a', 82, 25], ['dry_grass', 84, 21]] },
  { id: 'elephant', name: '코끼리', desc: '물웅덩이에서 코로 물을 뿌리며 놀아요.', species: 'elephant', count: 2, rect: [91, 18, 98, 31], floor: 'sand', front: 'W', pool: [93, 25, 96, 29], mud: [92, 24, 97, 30],
    props: [['log', 92, 20], ['log', 95, 21], ['rock_b', 96, 19], ['rock_a', 92, 22], ['dry_grass', 94, 20], ['dry_grass', 97, 23], ['rock_a', 97, 30]] },
  { id: 'lion', name: '사자', desc: '바위 위에서 낮잠 자는 걸 제일 좋아해요. 갈기가 멋져요.', species: 'lion', count: 2, rect: [81, 35, 86, 48], floor: 'sand', front: 'E',
    props: [['rock_big', 82, 36], ['tree_flat', 84, 38], ['dry_grass', 82, 39], ['dry_grass', 85, 42], ['dry_grass', 83, 45], ['rock_a', 82, 47], ['rock_b', 84, 46]] },
  { id: 'monkey', name: '원숭이', desc: '나무와 밧줄 사이를 오가며 장난쳐요. 바나나를 좋아해요.', species: 'monkey', count: 3, rect: [91, 35, 98, 48], floor: 'soil', front: 'W',
    props: [['tree_round', 93, 36], ['rope_post', 92, 40], ['rope_post', 96, 40], ['rope', 93, 40], ['rope', 94, 40], ['rope', 95, 40], ['tire_swing', 97, 43], ['platform', 93, 45], ['tree_small', 96, 46], ['log', 92, 47]] },
];
const FLOOR_TILE = { sand: 'sand_', ice: 'ice_', soil: 'soil_', savanna: 'savanna_' }; // grass 는 기본 잔디 그대로
const ZOO_PHOTO = { x0: 74, y0: 61, x1: 75, y1: 61 }; // 포토존 발자국 두 칸 (둘이 서면 플래시)

function buildZoo(b, c) {
  // ── 경계 울타리 (아래 띠 위쪽 y 50 · 우측 띠 왼쪽 x 80) + 정문(32..33, 50: 2칸 + 양쪽 기둥) 아치 + 옆문(80, 32..33: 2칸 + 양쪽 기둥) ──
  // 산책로가 울타리와 만나는 곳은 전부 이런 문이다 (ZOO_GATES — 통행 테스트가 검증)
  for (let x = 0; x < W; x++) {
    if (x >= 32 && x <= 33) continue;
    if (x === 31 || x === 34) { b.place('gate_post', x, 50); continue; }
    b.place(x === 79 ? 'fence_ne' : 'fence_h', x, 50);
  }
  for (let y = 13; y < 50; y++) {
    if (y === 32 || y === 33) continue;
    if (y === 31 || y === 34) { b.place('gate_post', 80, y); continue; }
    b.place(y === 13 ? 'fence_nw' : 'fence_v', 80, y);
  }
  b.place('fence_v', 80, 50);
  b.place('zoo_banner', 30, 49);
  b.label(82.5, 32.9, 'ZOO →', { ...SANS, size: 7, weight: 700, color: '#fff0cc', spacing: 1 });
  c.setKind(0, 50, W - 1, 50, 'fence');
  c.setKind(80, 13, 80, 50, 'fence');
  for (let x = 32; x <= 33; x++) c.kind[50][x] = 'grass';
  for (let y = 32; y <= 33; y++) c.kind[y][80] = 'grass';

  // ── 산책로: 정문 → y 58..59 가로 → x 88..89 세로(우측 띠) → 전망 데크. 옆문 → 세로 길 ──
  for (let y = 50; y <= 57; y++) for (let x = 32; x <= 33; x++) c.path(x, y);
  for (let y = 58; y <= 59; y++) for (let x = 3; x <= 96; x++) c.path(x, y);
  for (let y = 18; y <= 59; y++) for (let x = 88; x <= 89; x++) c.path(x, y);
  for (let y = 32; y <= 33; y++) for (let x = 79; x <= 89; x++) c.path(x, y); // 옆문: 트랙 옆 잔디 띠(79)부터 자갈
  // 입구 광장 화단
  for (const [x, y, col] of [[29, 52, 'pink'], [35, 52, 'yellow'], [29, 55, 'purple'], [35, 55, 'white']]) if (c.free(x, y)) c.put(`flowerbed_${col}`, x, y);

  // ── 우리 ─────────────────────────────────────────────────────────────
  const zoo = { enclosures: [], photo: ZOO_PHOTO, snacks: [] };
  for (const e of ENCLOSURES) {
    const [x0, y0, x1, y1] = e.rect;
    const gate = e.gate || null;
    // 바닥 (안쪽): 종별로 다르게 (잔디는 기본 잔디 그대로)
    for (let y = y0 + 1; y < y1; y++) {
      for (let x = x0 + 1; x < x1; x++) {
        if (FLOOR_TILE[e.floor]) b.place(`${FLOOR_TILE[e.floor]}${hash(x, y, 11) % 2}`, x, y);
        c.kind[y][x] = 'pen';
      }
    }
    const inPool = (x, y) => e.pool && x >= e.pool[0] && x <= e.pool[2] && y >= e.pool[1] && y <= e.pool[3];
    // 진흙 (물웅덩이 둘레)
    if (e.mud) {
      for (let y = e.mud[1]; y <= e.mud[3]; y++) for (let x = e.mud[0]; x <= e.mud[2]; x++) if (!inPool(x, y)) b.place(`mud_${hash(x, y, 13) % 2}`, x, y);
    }
    // 물 (우리 안, 동물만 지나감) + 수련
    if (e.pool) {
      const [px0, py0, px1, py1] = e.pool;
      const lilies = new Set((e.lilies || []).map(([x, y]) => `${x},${y}`));
      for (let y = py0; y <= py1; y++) {
        for (let x = px0; x <= px1; x++) {
          const n = y === py0 ? 'N' : y === py1 ? 'S' : '';
          const ew = x === px1 ? 'E' : x === px0 ? 'W' : '';
          const inner = (x + y) % 2 ? 'f1' : 'f0';
          b.place(n + ew ? `pool_edge_${n + ew}` : lilies.has(`${x},${y}`) ? `pool_lily_${inner}` : `pool_${inner}`, x, y);
          c.kind[y][x] = 'pen_pool';
        }
      }
    }
    // 울타리: 앞쪽(front)은 유리, 나머지는 나무. 문(gate)은 비우고 양쪽에 기둥
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const edge = x === x0 || x === x1 || y === y0 || y === y1;
        if (!edge) continue;
        if (gate && x >= gate[0] && x <= gate[2] && y >= gate[1] && y <= gate[3]) { c.kind[y][x] = 'pen'; continue; }
        let name;
        if (gate && ((y >= gate[1] && y <= gate[3] && (x === gate[0] - 1 || x === gate[2] + 1)) || (x >= gate[0] && x <= gate[2] && (y === gate[1] - 1 || y === gate[3] + 1)))) name = 'gate_post';
        else if (x === x0 && y === y0) name = 'fence_nw';
        else if (x === x1 && y === y0) name = 'fence_ne';
        else if (x === x0 && y === y1) name = 'fence_sw';
        else if (x === x1 && y === y1) name = 'fence_se';
        else if (y === y0) name = e.front === 'N' ? 'glass_fence_h' : 'fence_h';
        else if (y === y1) name = e.front === 'S' ? 'glass_fence_h' : 'fence_h';
        else if (x === x0) name = e.front === 'W' ? 'glass_fence_v' : 'fence_v';
        else name = e.front === 'E' ? 'glass_fence_v' : 'fence_v';
        b.place(name, x, y);
        c.kind[y][x] = 'fence';
      }
    }
    // 서식지 소품: 울타리 안쪽에만, 서로 겹치지 않게 (겹치면 예외 — 배치 실수를 바로 알 수 있게)
    for (const [name, x, y] of e.props || []) {
      const o = b.obj(name);
      for (let dy = 0; dy < o.h; dy++) {
        for (let dx = 0; dx < o.w; dx++) {
          const tx = x + dx;
          const ty = y + dy;
          const isTop = dy < (o.top || 0) || o.layer === 'top';
          if (tx <= x0 || tx >= x1 || ty <= y0 || ty >= y1) throw new Error(`[zoo] ${e.id} ${name} 이(가) 울타리 밖: (${tx},${ty})`);
          if (!isTop && (b.occupant[ty][tx] !== -1 || inPool(tx, ty))) throw new Error(`[zoo] ${e.id} ${name} 자리가 겹침: (${tx},${ty})`);
        }
      }
      b.place(name, x, y);
    }
    // 큰 안내판(2x2: 위 줄 = 판, 아래 줄 = 기둥 한 칸 + 빈 칸) — 앞쪽 울타리에 걸쳐 세운다 (판은 울타리 줄 위 top 레이어, 기둥은 울타리 바로 앞/울타리 칸)
    // + 먹이 주기 지점: 앞쪽 울타리 가운데 바깥
    const cx = Math.floor((x0 + x1) / 2);
    const cy = Math.floor((y0 + y1) / 2);
    let sign; // { name, x, y, post: [x, y], at: { x, y } (E 위치, 발 기준 타일 소수) }
    let feed;
    let feedTile;
    if (e.front === 'S') { sign = { name: 'zoo_sign_l', x: cx - 1, y: y1, post: [cx - 1, y1 + 1], at: { x: cx - 0.5, y: y1 + 3 } }; feed = { x: cx + 1.5, y: y1 + 2 }; feedTile = { x: cx + 1, y: y1 - 1 }; }
    else if (e.front === 'N') { sign = { name: 'zoo_sign_l', x: cx - 1, y: y0 - 1, post: [cx - 1, y0], at: { x: cx + 0.5, y: y0 } }; feed = { x: cx + 1.5, y: y0 }; feedTile = { x: cx + 1, y: y0 + 1 }; }
    else if (e.front === 'E') { sign = { name: 'zoo_sign_l', x: x1, y: cy - 1, post: [x1, cy], at: { x: x1 + 1.5, y: cy + 1 } }; feed = { x: x1 + 1.5, y: cy + 2 }; feedTile = { x: x1 - 1, y: cy + 1 }; }
    else { sign = { name: 'zoo_sign_r', x: x0 - 1, y: cy - 1, post: [x0, cy], at: { x: x0 - 0.5, y: cy + 1 } }; feed = { x: x0 - 0.5, y: cy + 2 }; feedTile = { x: x0 + 1, y: cy + 1 }; }
    if (e.gate) { sign = { name: 'zoo_sign_l', x: x0 + 2, y: y1, post: [x0 + 2, y1 + 1], at: { x: x0 + 2.5, y: y1 + 3 } }; feed = null; }
    b.place(sign.name, sign.x, sign.y); // 아래 줄 두 칸의 충돌을 false 로 쓴다 → 기둥 칸(울타리 칸일 수도)만 다시 막는다
    b.setSolid(sign.post[0], sign.post[1], sign.post[0], sign.post[1], true);
    b.interactable(`sign:${e.id}`, 'sign', sign.at.x, sign.at.y, { hint: '안내판 보기', range: 48 });
    if (feed) b.interactable(`feed:${e.id}`, 'feed', feed.x, feed.y, { hint: '먹이 주기', range: 48 });
    zoo.enclosures.push({ id: e.id, name: e.name, desc: e.desc, species: e.species, count: e.count, extra: e.extra || [], area: { x0: x0 + 1, y0: y0 + 1, x1: x1 - 1, y1: y1 - 1 }, floor: e.floor, pool: e.pool ? { x0: e.pool[0], y0: e.pool[1], x1: e.pool[2], y1: e.pool[3] } : null, feedTile, sign: { x: sign.x, y: sign.y }, enterable: Boolean(e.gate) });
  }

  // ── 매점 · 포토존 · 벤치 · 전망 데크 (산책로 남쪽 y 61..) ──────────────
  b.place('snack_bar', 66, 61);
  b.interactable('snack:icecream', 'snack_icecream', 66.5, 64, { hint: '아이스크림 1🪙', range: 40 });
  b.interactable('snack:churros', 'snack_churros', 68.5, 64, { hint: '츄러스 1🪙', range: 40 });
  zoo.snacks = [{ id: 'icecream', name: '아이스크림', emoji: '🍦', price: 1 }, { id: 'churros', name: '츄러스', emoji: '🥨', price: 1 }];
  b.place('photo_board', 73, 60);
  b.place('photo_mark', 74, 61);
  b.place('photo_mark', 75, 61);
  b.setSolid(74, 61, 75, 61, false);
  c.setKind(73, 60, 75, 61, 'prop');
  b.label(74.5, 62.6, 'PHOTO ZONE', { ...SANS, size: 7, weight: 700, color: '#3b3540', spacing: 1 });
  for (const [x, y] of [[8, 61], [20, 61], [40, 61], [52, 61], [84, 61], [92, 61], [92, 22], [84, 46]]) if (c.free(x, y, 2, 1)) c.put('bench_park', x, y);
  // 전망 데크: 우측 띠 위쪽 (x 82..95, y 14..17) 데크 + 난간 → 트랙·언덕이 보인다
  b.fill(['deck_a', 'deck_b'], 82, 14, 95, 17, { checker: true });
  c.setKind(82, 14, 95, 17, 'deck');
  for (let x = 82; x <= 95; x++) b.place('railing_h', x, 14);
  for (let y = 15; y <= 17; y++) { b.place('railing_v', 82, y); b.place('railing_v', 95, y); }
  b.place('telescope', 84, 13);
  b.label(88.5, 18.6, 'VIEW DECK', { ...SANS, size: 7, weight: 600, color: '#efe6d6', spacing: 1 });
  for (const [x, y] of [[83, 16], [92, 16]]) b.place('bench_park', x, y);
  // 산책로 가로등
  for (const [x, y] of [[36, 60], [64, 60], [86, 30], [86, 40], [91, 50]]) if (c.free(x, y)) { c.put('lamp_post', x, y); b.light(x + 0.5, y + 0.3, 4.0, 0xffd48a, 0.7); }
  // 남쪽 여백: 나무 군락 + 꽃 (동물원 아래 공원)
  for (const [x, y, n] of [[4, 64, 'tree_round'], [12, 65, 'tree_birch'], [26, 63, 'tree_olive'], [32, 65, 'tree_round_big'], [45, 64, 'tree_pine'], [56, 65, 'tree_round'], [80, 64, 'tree_birch'], [96, 63, 'tree_round'], [16, 62, 'bush_0'], [60, 62, 'bush_1'], [88, 66, 'tree_olive']]) if (c.free(x, y, b.obj(n).w, b.obj(n).h)) c.put(n, x, y);
  for (const [x, y] of [[2, 62], [22, 67], [38, 67], [50, 67], [70, 66], [86, 63], [98, 67]]) if (c.free(x, y)) c.put(`flower_${(x + y) % 3}`, x, y);
  // 우측 띠 나머지: 잔디 + 나무
  for (const [x, y, n] of [[82, 6, 'tree_pine'], [96, 8, 'tree_pine'], [97, 33, 'bush_0'], [82, 33, 'flower_1']]) if (c.free(x, y, b.obj(n).w, b.obj(n).h)) c.put(n, x, y);
  // 동물원 안 빈 잔디 소품 밀도 ↑ (우리 사이 · 산책로 남쪽 · 우측 띠)
  c.scatter(0, 51, 79, 57, 24, 0.08, PARK_SCATTER);
  c.scatter(0, 60, W - 1, H - 1, 25, 0.08, PARK_SCATTER);
  c.scatter(81, 19, 99, 57, 26, 0.07, PARK_SCATTER);
  b.zoo = zoo;
}

/** 산책로가 경계 울타리와 만나는 문 (2칸 + 양쪽 기둥). 통행 테스트가 기둥·통과 가능을 검증한다 */
const ZOO_GATES = [
  { id: 'main', cells: [[32, 50], [33, 50]], posts: [[31, 50], [34, 50]] },
  { id: 'side', cells: [[80, 32], [80, 33]], posts: [[80, 31], [80, 34]] },
  { id: 'petting', cells: [[55, 56], [56, 56]], posts: [[54, 56], [57, 56]] },
];

/** 자유 동물 (14단계 B): 우리 밖 서버 NPC. area 는 타일 사각형, spots 는 특별 지점 */
const FREE_ANIMALS = [
  { id: 'duck1', species: 'duck', kind: 'duck', area: { x0: 4, y0: 40, x1: 9, y1: 44 } },
  { id: 'duck2', species: 'duck', kind: 'duck', area: { x0: 4, y0: 40, x1: 9, y1: 44 } },
  { id: 'squirrel', species: 'squirrel', kind: 'squirrel', area: { x0: 0, y0: 13, x1: 16, y1: 30 }, spots: [{ x: 5, y: 18 }, { x: 8, y: 17 }, { x: 11, y: 17 }, { x: 4, y: 26 }, { x: 8, y: 30 }, { x: 13, y: 18 }] },
  { id: 'cat1', species: 'cat', kind: 'cat', name: '나비', area: { x0: 14, y0: 26, x1: 47, y1: 36 }, spots: [{ x: 26, y: 30 }, { x: 37, y: 30 }, { x: 20, y: 33 }, { x: 44, y: 34 }] },
  { id: 'cat2', species: 'cat', kind: 'cat', name: '치즈', area: { x0: 12, y0: 36, x1: 47, y1: 49 }, spots: [{ x: 12, y: 36 }, { x: 13, y: 46 }, { x: 34, y: 37 }, { x: 41, y: 47 }] },
  { id: 'pigeon', species: 'pigeon', kind: 'pigeon', count: 5, area: { x0: 15, y0: 27, x1: 46, y1: 36 } },
  { id: 'duck_track', species: 'duck', kind: 'duck', area: { x0: INFIELD_POND.x0 + 1, y0: INFIELD_POND.y0 + 1, x1: INFIELD_POND.x1 - 1, y1: INFIELD_POND.y1 - 1 } },
  // 꽃밭 주변엔 밤 반딧불이만 (나비는 뺐다)
  { id: 'firefly', species: 'firefly', kind: 'firefly', count: 6, area: { x0: 0, y0: 33, x1: 30, y1: 49 } },
  { id: 'firefly_track', species: 'firefly', kind: 'firefly', count: 4, area: { x0: 56, y0: 24, x1: 71, y1: 37 } },
  { id: 'firefly_zoo', species: 'firefly', kind: 'firefly', count: 4, area: { x0: 40, y0: 60, x1: 70, y1: 68 } },
];

let cached = null;
function getOutdoor() {
  if (!cached) cached = buildOutdoor();
  return cached;
}

module.exports = { buildOutdoor, getOutdoor, isTrackCell, isTrackCorner, trackDistance, TRACK, W, H, ENCLOSURES, FREE_ANIMALS, ZOO_PHOTO, ZOO_GATES, INFIELD_POND };
