'use strict';
/**
 * 17단계(2인 스터디룸 안쪽 정리) 단위 테스트.
 *  - 실내 통행 검증: 입장 스폰에서 실내의 걸을 수 있는 모든 칸(좌석·문·상호작용 지점 포함)에 BFS 로 닿는다. 가구 사이 막힌 틈은 setSolid 로 막혀 있어야 한다.
 *  - 스터디룸 배치: 러그는 책상 폭·4타일 깊이(격자) · 위를 보는 2인 소파가 아래 벽(문 오른쪽) · 낮은 테이블·램프·사이드 테이블 ·
 *    왼쪽 벽 화이트보드+2단 책장 · 오른쪽 벽 옷걸이·수납장·미니 냉장고 · 슬리퍼 2·쿠션 2(통과 가능) · 문/의자/모니터/코르크보드는 그대로 ·
 *    러그 밖 바닥이 보인다 · 문 → 의자·소파 앞은 1타일 이상 폭.
 *  - 구역 간 동선: 커피 코너·푸프·라운지·회의·스터디룸·복도 사이 이웃 쌍마다 2타일 폭 통로(걸을 수 있는 2x2 블록의 연속)가 두 구역의 경계 상자 안에 하나 이상. 소품이 통로를 좁히면 실패.
 *    커피 코너 동선 수정(원두 선반은 벽에·화분 제거·우유 상자/쓰레기통은 구석·프린터 수납장은 왼쪽 벽까지)과 사다리 선반·정수기 이동을 확인.
 *  - 상점 가구 통행 규칙(layout.js isolates): 놓으면/옮기면 스폰에서 닿던 칸이 못 가는 곳이 되는 배치는 'isolates' 로 거부. 월드(배치·이동·로드 회수)와 순수 함수 모두.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { getStudyRoom } = require('../server/rooms/studyroom');
const { TILES } = require('../server/rooms/build');
const L = require('../server/game/layout');
const { createShop } = require('../server/game/shop');
const { World } = require('../server/game/world');
const { createMemoryStore } = require('../server/store/memory');

const T = 32;
const room = getStudyRoom();
const shop = createShop();
const quiet = { log() {}, warn() {}, error() {} };
const spawnTile = L.spawnTile(room);
const propsAt = (x, y) => room.props.filter((p) => x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h);
const propNamed = (name) => room.props.filter((p) => p.name === name);
const free = (x, y) => !room.collision[y][x];

/** 스폰에서 4방향 BFS 로 닿는 걸을 수 있는 칸 집합 (야외 stage16 과 같은 규칙) */
function reachable(r, from) {
  const seen = new Set([`${from.tx},${from.ty}`]);
  const q = [[from.tx, from.ty]];
  while (q.length) {
    const [x, y] = q.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= r.width || ny >= r.height || r.collision[ny][nx]) continue;
      const k = `${nx},${ny}`;
      if (seen.has(k)) continue;
      seen.add(k);
      q.push([nx, ny]);
    }
  }
  return seen;
}

function makeWorld(opts = {}) {
  let t = new Date('2026-09-18T10:00:00+09:00').getTime();
  const store = opts.store || createMemoryStore();
  const world = new World(room, { now: () => t, store, tz: 'Asia/Seoul', npc: { autoStart: false }, study: { autoTick: false }, log: quiet, ...opts });
  const give = (nick, itemId) => {
    const it = shop.get(itemId);
    return store.addInventory(nick, itemId, { name: it.name, price: it.price, tab: it.tab, category: it.category, variant: it.variants ? it.variants[0].id : null }, t);
  };
  return { world, store, give };
}

// ── 통행 검증 ─────────────────────────────────────────────────────────
test('실내 통행 검증: 걸을 수 있는 모든 칸이 스폰에서 닿는다 (고립 칸 0) · 좌석·문·상호작용 지점·바깥 보도까지', () => {
  const seen = reachable(room, spawnTile);
  const isolated = [];
  let walkable = 0;
  for (let y = 0; y < room.height; y++) {
    for (let x = 0; x < room.width; x++) {
      if (room.collision[y][x]) continue;
      walkable++;
      if (!seen.has(`${x},${y}`)) isolated.push(`(${x},${y})`);
    }
  }
  assert.ok(walkable > 600, `걸을 수 있는 칸 ${walkable}`);
  assert.deepEqual(isolated, [], `고립된 걸을 수 있는 칸: ${isolated.join(' ')}`);
  for (const s of room.seats) assert.ok(seen.has(`${s.x},${s.y}`), `좌석 ${s.id} (${s.x},${s.y})`);
  for (const d of room.doors) assert.ok(seen.has(`${d.x},${d.y}`), `문 ${d.id} (${d.x},${d.y})`);
  for (const it of room.interactables) {
    const tx = Math.floor(it.x / T);
    const ty = Math.floor((it.y - 1) / T);
    let ok = false;
    for (let dy = -1; dy <= 1 && !ok; dy++) for (let dx = -1; dx <= 1 && !ok; dx++) if (seen.has(`${tx + dx},${ty + dy}`)) ok = true;
    assert.ok(ok, `상호작용 ${it.id} 근처에 닿는 칸`);
  }
  assert.ok(seen.has('22,28'), '입구 밖 매트');
  // 가구 사이 막힌 틈은 걸을 수 있는 칸으로 남아 있지 않다 (setSolid)
  for (const [x, y] of [[3, 3], [3, 6], [12, 3], [13, 4], [23, 9], [7, 13], [8, 13]]) assert.ok(room.collision[y][x], `막힌 틈 (${x},${y}) 은 solid`);
});

test('스터디룸 안: 문에서 두 의자·소파 좌석까지 이어지고, 방 안 걸을 수 있는 칸끼리 전부 이어진다 (통로 1타일 이상)', () => {
  // 방 안쪽(x 15..29, y 12..20)만 놓고 문 칸에서 BFS — 방 밖으로 나가지 않고도 모든 안쪽 칸에 닿아야 한다 (18단계: 폭 15)
  const inside = (x, y) => x >= 15 && x <= 29 && y >= 12 && y <= 20;
  const seen = new Set(['22,21']);
  const q = [[22, 21]];
  while (q.length) {
    const [x, y] = q.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inside(nx, ny) || room.collision[ny][nx] || seen.has(`${nx},${ny}`)) continue;
      seen.add(`${nx},${ny}`);
      q.push([nx, ny]);
    }
  }
  const missing = [];
  let walk = 0;
  for (let y = 12; y <= 20; y++) for (let x = 15; x <= 29; x++) if (free(x, y)) { walk++; if (!seen.has(`${x},${y}`)) missing.push(`(${x},${y})`); }
  assert.deepEqual(missing, [], `문에서 못 가는 방 안 칸: ${missing.join(' ')}`);
  assert.ok(walk >= 80, `방 안 걸을 수 있는 칸 ${walk}`);
  for (const id of ['study-a', 'study-b', 'study-sofa-a', 'study-sofa-b']) {
    const s = room.seats.find((q2) => q2.id === id);
    assert.ok(seen.has(`${s.x},${s.y}`), `${id} 도달`);
  }
  // 문 → 위쪽 통로: 문 패널(x 20..21)과 왼쪽 램프(x 24) 사이 x 22..23 이 y 18..20 에서 비어 있다 (2칸 폭)
  for (let y = 18; y <= 20; y++) for (const x of [22, 23]) assert.ok(free(x, y), `문 통로 (${x},${y})`);
  // 소파 앞 줄(y 18)은 비어 있어 좌석에 들어갈 수 있다 · 커튼 옆 세로 통로 x 13 · 책상 앞 줄 y 15 는 벽에서 벽까지 이어진다
  for (const x of [25, 26, 27, 28]) assert.ok(free(x, 18), `소파 앞 (${x},18)`);
  for (let y = 12; y <= 20; y++) assert.ok(free(15, y), `커튼 옆 통로 (15,${y})`);
  for (let x = 15; x <= 29; x++) assert.ok(free(x, 15), `가로 통로 (${x},15)`);
});

// ── 구역 간 2타일 폭 통로 ─────────────────────────────────────────────
/** 구역(타일 사각형, 포함 범위). 걸을 수 있는 2x2 블록(네 칸 모두 통과 가능·좌석 아님)이 이어져야 2타일 폭 통로다. */
const ZONES = {
  coffee: { x0: 3, y0: 10, x1: 11, y1: 17 },
  pouf: { x0: 3, y0: 18, x1: 11, y1: 24 },
  lounge: { x0: 14, y0: 5, x1: 28, y1: 9 },
  meeting: { x0: 36, y0: 10, x1: 43, y1: 24 },
  study: { x0: 15, y0: 12, x1: 29, y1: 20 },
  corridor: { x0: 12, y0: 22, x1: 33, y1: 24 },
  corridorL: { x0: 12, y0: 10, x1: 13, y1: 24 }, // 18단계: 스터디룸을 줄여 생긴 왼쪽 복도 (소품 없음)
  corridorR: { x0: 31, y0: 10, x1: 35, y1: 24 }, // 오른쪽 복도
};
/** 이웃 구역 쌍 (직접 이어져야 하는 곳). 18단계: 스터디룸은 아래 문 + 좌우 문으로 복도 3곳과 만난다 */
const ZONE_PAIRS = [['coffee', 'pouf'], ['coffee', 'lounge'], ['coffee', 'corridor'], ['pouf', 'corridor'], ['lounge', 'meeting'], ['meeting', 'corridor'], ['study', 'corridor'], ['study', 'corridorL'], ['study', 'corridorR'], ['corridorL', 'corridor'], ['corridorR', 'corridor'], ['corridorL', 'lounge'], ['corridorR', 'meeting']];
const seatSet = new Set(room.seats.map((s) => `${s.x},${s.y}`));
const walkable = (x, y) => x >= 0 && y >= 0 && x < room.width && y < room.height && !room.collision[y][x] && !seatSet.has(`${x},${y}`);
const block = (x, y) => walkable(x, y) && walkable(x + 1, y) && walkable(x, y + 1) && walkable(x + 1, y + 1);
const inRect = (x, y, r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
const blockIn = (x, y, r) => inRect(x, y, r) && inRect(x + 1, y + 1, r);

/** a 구역 안 블록에서 두 구역의 경계 상자 안 블록만 밟아 b 구역 안 블록에 닿는가 (2타일 폭 통로) */
function wideConnected(a, b) {
  const A = ZONES[a];
  const B = ZONES[b];
  const bb = { x0: Math.min(A.x0, B.x0), y0: Math.min(A.y0, B.y0), x1: Math.max(A.x1, B.x1), y1: Math.max(A.y1, B.y1) };
  const q = [];
  for (let y = A.y0; y <= A.y1; y++) for (let x = A.x0; x <= A.x1; x++) if (blockIn(x, y, A) && block(x, y)) q.push([x, y]);
  const seen = new Set(q.map(([x, y]) => `${x},${y}`));
  while (q.length) {
    const [x, y] = q.shift();
    if (blockIn(x, y, B)) return true;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (!blockIn(nx, ny, bb) || !block(nx, ny) || seen.has(`${nx},${ny}`)) continue;
      seen.add(`${nx},${ny}`);
      q.push([nx, ny]);
    }
  }
  return false;
}

test('구역 간 동선: 이웃 구역 쌍마다 2타일 폭 통로가 하나 이상 (2x2 블록 BFS) · 각 구역 안에 2x2 블록이 있다', () => {
  for (const id of Object.keys(ZONES)) {
    const z = ZONES[id];
    let n = 0;
    for (let y = z.y0; y <= z.y1; y++) for (let x = z.x0; x <= z.x1; x++) if (blockIn(x, y, z) && block(x, y)) n++;
    assert.ok(n > 0, `${id} 구역 안에 걸을 수 있는 2x2 블록`);
  }
  const narrow = ZONE_PAIRS.filter(([a, b]) => !wideConnected(a, b)).map(([a, b]) => `${a}-${b}`);
  assert.deepEqual(narrow, [], `2타일 폭 통로가 없는 구역 쌍: ${narrow.join(' ')}`);
});

test('커피 코너 동선: 카운터 오른쪽 x 9..11 이 y 10..17 전부 비어 위(라운지)·아래(복도)로 트인다 · 원두 선반은 스터디룸 벽에 · 화분 제거 · 우유 상자/쓰레기통은 구석 · 사다리 선반·정수기 이동', () => {
  for (let y = 10; y <= 17; y++) for (const x of [9, 10, 11]) assert.ok(free(x, y), `통로 (${x},${y})`);
  assert.equal(propNamed('bean_shelf').length, 0, '바닥의 원두 선반은 없다');
  assert.deepEqual(propNamed('bean_shelf_wall'), [{ name: 'bean_shelf_wall', x: 14, y: 10, w: 2, h: 2 }]); // 18단계: 벽이 x 14 로
  assert.equal(TILES.objects.bean_shelf_wall.solid, true);
  assert.deepEqual(propNamed('wall_frames_a').map((p) => [p.x, p.y]), [[11, 1], [20, 10]], '액자는 벽의 빈 자리로 ((18,10) 은 빈 벽으로 남긴다)');
  assert.equal(propNamed('plant_tall_2').length, 0, '통로의 화분 제거');
  assert.deepEqual(propNamed('milk_crate').map((p) => [p.x, p.y]), [[4, 18]]);
  assert.deepEqual(propNamed('trash_bin').map((p) => [p.x, p.y]).sort((a, b) => a[0] - b[0]), [[3, 18], [30, 24], [41, 23]]);
  assert.deepEqual(propNamed('ladder_shelf').map((p) => [p.x, p.y]), [[36, 10]]);
  // 프린터 수납장은 왼쪽 벽까지 (오른쪽 끝 x 8) → 커피 코너 통로가 위쪽 복도(y 8..9)와 2칸 폭으로 꺾인다. 그 자리의 작은 수납장은 뺐다
  assert.deepEqual(propNamed('cabinet_printer').map((p) => [p.x, p.y, p.w]), [[2, 7, 7]]);
  assert.ok(!propNamed('cabinet_small').some((p) => p.x === 2 && p.y === 7));
  for (const x of [9, 10]) for (const y of [7, 8]) assert.ok(free(x, y), `수납장 오른쪽 (${x},${y})`);
  assert.deepEqual(propNamed('water_dispenser').map((p) => [p.x, p.y]), [[42, 22]]);
  // 라운지 ↔ 회의 · 회의 ↔ 복도: 스터디룸 벽 옆 x 34..35 가 y 10..24 내내 비어 있다
  for (let y = 10; y <= 24; y++) for (const x of [34, 35]) assert.ok(free(x, y), `x 34..35 통로 (${x},${y})`);
  // 아래쪽: 카운터 앞줄(y 15) 에서 x 8 로 나가 y 15..17 (3칸) 이 트인다
  for (let y = 15; y <= 17; y++) assert.ok(free(8, y), `(8,${y})`);
});

// ── 배치 ────────────────────────────────────────────────────────────
test('스터디룸 배치: 격자 러그(책상 폭 7 · 4타일 깊이) · 러그 밖 바닥이 보인다 · 문/의자/모니터/코르크보드 그대로', () => {
  // 바닥 오브젝트(러그)는 props 에 없다 → floor 레이어의 타일 인덱스로 본다
  const rugObj = TILES.objects.rug_study_grid;
  assert.deepEqual([rugObj.w, rugObj.h, rugObj.layer, rugObj.solid], [7, 4, 'floor', false]);
  const rugTiles = new Set(rugObj.tiles.flat());
  const anyRugTiles = new Set(Object.keys(TILES.objects).filter((n) => /^rug_/.test(n)).flatMap((n) => TILES.objects[n].tiles.flat()));
  const isRug = (x, y) => rugTiles.has(room.layers.floor[y][x]);
  for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 7; dx++) assert.equal(room.layers.floor[14 + dy][19 + dx], rugObj.tiles[dy][dx], `러그 (${19 + dx},${14 + dy})`);
  // 방 안쪽 180칸 중 러그가 덮는 칸은 28 → 나머지는 바닥(마루) 이 보인다 (러그 한 장처럼 보이지 않는다)
  let rugCells = 0;
  for (let y = 12; y <= 20; y++) for (let x = 15; x <= 29; x++) if (isRug(x, y)) rugCells++;
  assert.equal(rugCells, 28);
  assert.ok(rugCells / (15 * 9) < 0.25, '러그는 방 바닥의 1/4 미만');
  // 러그 밖: y 12..13(책상 줄) · y 18..20 · x 15..18 · x 26..29 에는 어떤 러그도 없다 (옛 넓은 러그·소파 러그 제거)
  for (let y = 12; y <= 20; y++) for (let x = 15; x <= 29; x++) if (!(x >= 19 && x <= 25 && y >= 14 && y <= 17)) assert.ok(!anyRugTiles.has(room.layers.floor[y][x]), `(${x},${y}) 러그 없음`);
  // 문·의자·모니터·코르크보드 그대로 (18단계: 좌우 벽 가운데 문 2개 추가)
  assert.deepEqual(room.doors.filter((d) => /^study-/.test(d.id)).map((d) => [d.id, d.x, d.y]), [['study-w-a', 14, 16], ['study-w-b', 14, 17], ['study-e-a', 30, 16], ['study-e-b', 30, 17], ['study-l', 22, 21], ['study-r', 23, 21]]);
  assert.deepEqual(room.seats.filter((s) => /^study-[ab]$/.test(s.id)).map((s) => [s.id, s.x, s.y, s.facing]), [['study-a', 21, 14, 'up'], ['study-b', 23, 14, 'up']]);
  assert.deepEqual(room.screens.filter((s) => /^study-[ab]$/.test(s.seatId)).map((s) => s.kind), ['monitor', 'monitor']);
  assert.deepEqual(room.anchors.corkboard.seats, ['study-a', 'study-b']);
  assert.deepEqual(propNamed('corkboard').map((p) => [p.x, p.y]), [[21, 10]]);
  assert.deepEqual(propNamed('desk_long').map((p) => [p.x, p.y]), [[19, 12]]);
});

test('소파 코너: 위를 보는 2인 소파가 아래 벽(문 오른쪽)에 등을 대고 · 좌석 2(위 방향) · 앞 낮은 테이블(러그 옆) · 양옆 스탠드 램프 + 작은 사이드 테이블', () => {
  const sofa = propNamed('sofa_love_n');
  assert.deepEqual(sofa, [{ name: 'sofa_love_n', x: 25, y: 19, w: 4, h: 2 }]);
  assert.equal(propNamed('sofa_love').length, 0);
  const seats = room.seats.filter((s) => /^study-sofa/.test(s.id));
  assert.deepEqual(seats.map((s) => [s.id, s.x, s.y, s.facing, s.kind]), [['study-sofa-a', 26, 19, 'up', 'sofa_love_n'], ['study-sofa-b', 27, 19, 'up', 'sofa_love_n']]);
  // 등받이(y 20)는 유리벽(y 21) 바로 위 · 팔걸이·등받이는 막힘, 좌석은 통과
  for (const x of [25, 26, 27, 28]) assert.ok(room.collision[20][x], `등받이 (${x},20)`);
  assert.ok(room.collision[19][25] && room.collision[19][28], '팔걸이');
  assert.ok(free(26, 19) && free(27, 19), '좌석 통과 가능');
  assert.ok(room.collision[21][25] && room.collision[21][28], '아래 유리벽');
  assert.deepEqual(propNamed('low_table_study'), [], '18단계: 낮은 테이블은 뺐다 (좌우 문 → 소파 앞 2칸 통로)');
  assert.deepEqual(propNamed('standing_lamp').filter((p) => p.y >= 12).map((p) => [p.x, p.y]), [[24, 18], [29, 18]]);
  assert.deepEqual(propNamed('side_table_small').map((p) => [p.x, p.y]), [[24, 20], [29, 20]]);
  // 스탠드 갓은 top 레이어(통과 가능), 받침은 막힘
  assert.ok(free(24, 18) && free(29, 18) && room.layers.top[18][24] >= 0 && room.layers.top[18][29] >= 0);
  assert.ok(room.collision[19][24] && room.collision[19][29]);
  // 램프 조명 2개
  const lamps = room.lights.filter((l) => l.x === Math.round(25 * T) || l.x === Math.round(30 * T)).filter((l) => l.y === Math.round(19.1 * T));
  assert.equal(lamps.length, 2);
  // 오브젝트 정의: 좌석은 윗줄 가운데 두 칸, 위를 본다
  assert.deepEqual(TILES.objects.sofa_love_n.seats, [{ dx: 1, dy: 0, facing: 'up' }, { dx: 2, dy: 0, facing: 'up' }]);
});

test('왼쪽 벽(화이트보드·2단 책장) · 오른쪽 벽(옷걸이·수납장·미니 냉장고) · 바닥 슬리퍼 2·쿠션 2(통과 가능) · 옛 작은 책장은 없다', () => {
  assert.deepEqual(propNamed('whiteboard_small'), [], '18단계: 이젤 화이트보드 제거');
  assert.deepEqual(propNamed('bookcase_2tier'), [{ name: 'bookcase_2tier', x: 16, y: 13, w: 2, h: 2 }], '책장은 1개');
  assert.equal(propNamed('bookcase_small').length, 0);
  assert.deepEqual(propNamed('coat_rack_cardigan').map((p) => [p.x, p.y]), [[29, 11]]);
  assert.deepEqual(propNamed('cabinet_small').filter((p) => p.x >= 15 && p.x <= 29 && p.y >= 12 && p.y <= 20), [{ name: 'cabinet_small', x: 28, y: 13, w: 2, h: 2 }]);
  assert.deepEqual(propNamed('mini_fridge'), [], '18단계: 미니 냉장고 제거');
  assert.ok(room.collision[12][29], '옷걸이 받침');
  const floorStuff = ['slippers_a', 'slippers_b', 'cushion_floor_a', 'cushion_floor_b'].map((n) => propNamed(n).find((p) => p.y >= 12 && p.y <= 20));
  assert.deepEqual(floorStuff.map((p) => p && [p.name, p.x, p.y]), [['slippers_a', 19, 20], ['slippers_b', 28, 18], ['cushion_floor_a', 16, 17], ['cushion_floor_b', 28, 16]]);
  for (const p of floorStuff) assert.ok(free(p.x, p.y), `${p.name} 통과 가능`);
  for (const n of ['cushion_floor_a', 'cushion_floor_b', 'slippers_a', 'slippers_b']) assert.equal(TILES.objects[n].solid, false);
  // 새 오브젝트는 전부 아틀라스 뒤쪽 (기존 인덱스 유지)
  for (const n of ['rug_study_grid', 'sofa_love_n', 'low_table_study', 'side_table_small', 'whiteboard_small', 'bookcase_2tier', 'mini_fridge', 'cushion_floor_a', 'cushion_floor_b']) {
    assert.ok(TILES.objects[n], n);
    assert.ok(TILES.objects[n].tiles[0][0] >= 1441, `${n} 은 뒤쪽에 추가`);
  }
});

// ── 상점 가구 통행 규칙 ──────────────────────────────────────────────
test('layout.isolates: 통과 불가 가구가 스폰에서 닿던 칸을 고립시키면 거부 · 원래부터 못 가던 틈은 기준이 아님 · 러그(통과 가능)는 상관없음', () => {
  const lamp = shop.get('floor_lamp');
  const rug = shop.get('rug_small');
  // (18,13): 협탁(18,12)·책장(17,13)·책상(19,13) 사이 틈 — (18,14) 로만 들어간다. 스탠드를 (18,14) 에 세우면 (18,13) 이 고립된다 (18단계 배치)
  assert.ok(L.isFreeFloor(room, 18, 13) && L.isFreeFloor(room, 18, 14));
  assert.deepEqual(L.validatePlacement(room, lamp, { x: 18, y: 14 }, [], () => null), { ok: false, error: 'isolates' });
  assert.equal(L.validatePlacement(room, lamp, { x: 17, y: 16 }, [], () => null).ok, true, '트인 곳이면 된다');
  assert.equal(L.validatePlacement(room, lamp, { x: 18, y: 14 }, [], () => null, { connectivity: false }).ok, true, 'connectivity=false 면 끈다');
  assert.equal(L.validatePlacement(room, rug, { x: 16, y: 15 }, [], () => null).ok, true, '러그는 통과 가능 → 고립 없음');
  // 아래 문 통로(x 22..23, y 19..20): 18단계엔 좌우 문이 있어 스탠드 둘로 통로를 다 막아도 방 안은 고립되지 않는다
  const first = { id: 1, itemId: 'floor_lamp', x: 22, y: 19, rotation: 0 };
  assert.equal(L.validatePlacement(room, lamp, { x: 22, y: 19 }, [], () => null).ok, true);
  assert.equal(L.validatePlacement(room, lamp, { x: 23, y: 19 }, [first], (id) => shop.get(id)).ok, true, '좌우 문으로 들어갈 수 있다');
  // 이동: 자기 자신은 빼고 본다
  assert.equal(L.validatePlacement(room, lamp, { id: 1, x: 23, y: 19 }, [first], (id) => shop.get(id)).ok, true);
  // 순수 함수 직접: 소파 좌석 앞을 막아 좌석 두 칸을 고립시키면 true
  const solid = [{ tx: 26, ty: 18 }, { tx: 27, ty: 18 }];
  assert.equal(L.isolates(room, [], () => null, solid), true, '소파 좌석이 고립');
  assert.equal(L.isolates(room, [], () => null, [{ tx: 26, ty: 18 }]), false, '한 칸만 막으면 옆 칸으로 들어간다');
  assert.equal(L.isolates(room, [], () => null, []), false);
  assert.ok(L.ERRORS.includes('isolates'));
});

test('월드: 놓기·옮기기가 고립 칸을 만들면 isolates 로 거부(충돌 맵 안 바뀜) · 저장된 배치도 로드 때 회수', async () => {
  const { world, store, give } = makeWorld();
  const a = world.join({ nickname: '민수', socketId: 'sa' }).player;
  a.x = 22.5 * T; a.y = 16 * T;
  const lamp1 = await give('민수', 'floor_lamp');
  const lamp2 = await give('민수', 'floor_lamp');
  assert.deepEqual(await world.placeFurniture(a, { inventoryId: lamp1.id, x: 18, y: 14 }), { ok: false, error: 'isolates' });
  assert.equal(world.canStand(18.5 * T, 15 * T), true, '거부됐으니 충돌 맵은 그대로');
  assert.equal((await store.roomLayout(world.scopeId)).length, 0, '저장도 안 된다');
  const p1 = await world.placeFurniture(a, { inventoryId: lamp1.id, x: 22, y: 19 });
  assert.equal(p1.ok, true);
  const p2 = await world.placeFurniture(a, { inventoryId: lamp2.id, x: 17, y: 16 });
  assert.equal(p2.ok, true);
  assert.deepEqual(await world.moveFurniture(a, { id: p2.entry.id, x: 18, y: 14 }), { ok: false, error: 'isolates' }, '옮겨서 고립시켜도 거부');
  assert.equal((await world.moveFurniture(a, { id: p1.entry.id, x: 23, y: 19 })).ok, true, '통로의 스탠드를 옆 칸으로 옮기는 건 된다 (자기 자신은 빼고 본다)');
  assert.equal(world.canStand(22.5 * T, 20 * T), true);
  assert.equal(world.canStand(23.5 * T, 20 * T), false);
  await world.dispose();

  // 저장소에 고립시키는 배치가 남아 있으면 init() 때 회수 (맵 개편 회수와 같은 경로)
  const store2 = createMemoryStore();
  const inv = await store2.addInventory('민수', 'floor_lamp', {});
  await store2.addLayout('studyroom', { itemId: 'floor_lamp', inventoryId: inv.id, x: 18, y: 14, rotation: 0, meta: {}, placedBy: '민수' });
  const w2 = makeWorld({ store: store2 }).world;
  await w2.init();
  assert.deepEqual(w2.recalledLayout.map((e) => [e.itemId, e.error]), [['floor_lamp', 'isolates']]);
  assert.deepEqual(await store2.roomLayout('studyroom'), []);
  await w2.dispose();
});
