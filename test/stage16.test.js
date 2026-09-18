'use strict';
/**
 * 16단계(야외 후속 수정) 단위 테스트.
 *  - 통행 검증: 걸을 수 있는 모든 바닥 타일이 스폰에서 BFS 로 닿는다 (우리 안쪽은 예외, 만지기 코너만 문). 고립 구역이 생기면 실패.
 *  - 산책로·보도가 울타리와 만나는 곳은 전부 문(2칸 + 양쪽 기둥): 경계 울타리 줄에서 통과 가능한 칸은 문뿐이다.
 *  - 동물원 우리: 서식지 소품 5~8개(전부 울타리 안) · 바닥 종별 · 큰 안내판(2x2)이 걸을 수 있는 곳 앞 · 먹이 지점 · 동물이 설 수 있는 칸 충분 · 두꺼운 울타리 소품.
 *  - 트랙 안쪽: 가운데 연못(오리 1) · 꽃 군락(동심원 아님) · 벤치 주변 담요·나무 · 응원 깃발.
 *  - 빈 잔디 소품 밀도 · 나비 완전 제거(정의·시트·NPC) · 구름 그림자 진하기(낮 옅게, 밤 0).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { getOutdoor, ENCLOSURES, ZOO_GATES, INFIELD_POND, trackDistance } = require('../server/rooms/outdoor');
const { createOutdoorAnimals, SPEED, FireflyNpc } = require('../server/game/animals');
const { TILES } = require('../server/rooms/build');
const Daylight = require('../public/js/daylight');
const animalsMeta = require('../public/assets/animals.json');

const T = 32;
const outdoor = getOutdoor();
const spawnTile = { x: Math.floor(outdoor.spawn.x / T), y: Math.floor((outdoor.spawn.y - 1) / T) };
const objName = (layer, x, y) => Object.keys(TILES.objects).find((n) => TILES.objects[n].tiles.some((row) => row.includes(outdoor.layers[layer][y][x]))) || null;
const propsAt = (x, y) => outdoor.props.filter((p) => x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h);
const inRect = (x, y, r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;

/** 스폰에서 4방향 BFS 로 닿는 걸을 수 있는 칸 집합 */
function reachable(room, from) {
  const seen = new Set([`${from.x},${from.y}`]);
  const q = [[from.x, from.y]];
  while (q.length) {
    const [x, y] = q.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= room.width || ny >= room.height || room.collision[ny][nx]) continue;
      const k = `${nx},${ny}`;
      if (seen.has(k)) continue;
      seen.add(k);
      q.push([nx, ny]);
    }
  }
  return seen;
}

test('통행 검증: 걸을 수 있는 모든 바닥 타일이 스폰에서 닿는다 (우리 안쪽 제외) · 만지기 코너 안쪽은 문으로 닿는다 · 좌석·상호작용 지점·포토존도 전부 닿는다', () => {
  const seen = reachable(outdoor, spawnTile);
  const pens = outdoor.zoo.enclosures.filter((e) => !e.enterable);
  const isolated = [];
  let walkable = 0;
  for (let y = 0; y < outdoor.height; y++) {
    for (let x = 0; x < outdoor.width; x++) {
      if (outdoor.collision[y][x]) continue;
      walkable++;
      if (pens.some((e) => inRect(x, y, e.area))) continue;
      if (!seen.has(`${x},${y}`)) isolated.push(`(${x},${y})`);
    }
  }
  assert.ok(walkable > 4000, `걸을 수 있는 칸 ${walkable}`);
  assert.deepEqual(isolated, [], `고립된 걸을 수 있는 칸: ${isolated.slice(0, 20).join(' ')}${isolated.length > 20 ? ' …' : ''}`);
  // 우리 안쪽(문 없음)은 정말로 못 들어간다
  for (const e of pens) {
    for (let y = e.area.y0; y <= e.area.y1; y++) for (let x = e.area.x0; x <= e.area.x1; x++) assert.ok(!seen.has(`${x},${y}`), `${e.id} 안쪽 (${x},${y}) 은 못 들어간다`);
  }
  const petting = outdoor.zoo.enclosures.find((e) => e.enterable);
  const inside = [];
  for (let y = petting.area.y0; y <= petting.area.y1; y++) for (let x = petting.area.x0; x <= petting.area.x1; x++) if (!outdoor.collision[y][x]) inside.push(`${x},${y}`);
  assert.ok(inside.length >= 20 && inside.every((k) => seen.has(k)), '만지기 코너 안쪽은 전부 닿는다');
  for (const s of outdoor.seats) assert.ok(seen.has(`${s.x},${s.y}`), `좌석 ${s.id} (${s.x},${s.y})`);
  for (const it of outdoor.interactables) {
    const tx = Math.floor(it.x / T);
    const ty = Math.floor((it.y - 1) / T);
    // 지점 자체가 막힌 칸이어도 range 안에 닿는 칸이 있어야 한다
    let ok = seen.has(`${tx},${ty}`);
    for (let dy = -1; dy <= 1 && !ok; dy++) for (let dx = -1; dx <= 1 && !ok; dx++) if (seen.has(`${tx + dx},${ty + dy}`)) ok = true;
    assert.ok(ok, `상호작용 ${it.id} 근처에 닿는 칸`);
  }
  for (let x = outdoor.zoo.photo.x0; x <= outdoor.zoo.photo.x1; x++) assert.ok(seen.has(`${x},${outdoor.zoo.photo.y0}`), '포토존');
});

test('문: 산책로가 경계 울타리와 만나는 곳은 전부 2칸 문 + 양쪽 기둥 · 울타리 줄의 통과 가능한 칸은 문뿐 · 만지기 코너 문도 기둥', () => {
  for (const g of ZOO_GATES) {
    assert.equal(g.cells.length, 2, `${g.id}: 출입구 2칸`);
    for (const [x, y] of g.cells) {
      assert.ok(!outdoor.collision[y][x], `${g.id}: 문 (${x},${y}) 통과 가능`);
      assert.equal(propsAt(x, y).filter((p) => /fence|gate_post/.test(p.name)).length, 0, `${g.id}: 문 칸엔 울타리 없음`);
    }
    for (const [x, y] of g.posts) {
      assert.ok(outdoor.collision[y][x], `${g.id}: 기둥 (${x},${y}) 은 막힘`);
      assert.ok(propsAt(x, y).some((p) => p.name === 'gate_post'), `${g.id}: 기둥 (${x},${y}) 은 gate_post`);
    }
  }
  // 경계 울타리 줄 (y 50 전체 · x 80 의 y 13..50): 통과 가능한 칸 = 정문·옆문 칸
  const mainOpen = [];
  for (let x = 0; x < outdoor.width; x++) if (!outdoor.collision[50][x]) mainOpen.push(x);
  assert.deepEqual(mainOpen, [32, 33]);
  const sideOpen = [];
  for (let y = 13; y <= 50; y++) if (!outdoor.collision[y][80]) sideOpen.push(y);
  assert.deepEqual(sideOpen, [32, 33]);
  // 정문·옆문 앞뒤는 산책로(자갈)로 이어진다
  for (const [x, y] of [[32, 49], [33, 49], [32, 51], [33, 51], [79, 32], [79, 33], [81, 32], [81, 33]]) assert.match(objName('floor', x, y) || '', /^gravel_/, `문 앞뒤 (${x},${y}) 는 산책로`);
  // 우리 울타리: 만지기 코너 문 2칸 말고는 전부 막힘
  for (const e of ENCLOSURES) {
    const [x0, y0, x1, y1] = e.rect;
    const open = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if ((x === x0 || x === x1 || y === y0 || y === y1) && !outdoor.collision[y][x]) open.push([x, y]);
    if (e.gate) assert.deepEqual(open, [[55, 56], [56, 56]], `${e.id}: 문 2칸`);
    else assert.deepEqual(open, [], `${e.id}: 울타리에 틈 없음`);
  }
});

test('동물원 우리: 서식지 소품 5~8개(울타리 안, 겹침 없음) · 바닥 종별(잔디·모래·얼음·흙·마른 풀) + 코끼리 진흙·플라밍고 수련 · 큰 안내판 2x2 · 먹이 지점 · 동물이 설 칸 충분 · 두꺼운 울타리', () => {
  const floors = new Set(ENCLOSURES.map((e) => e.floor));
  for (const f of ['grass', 'sand', 'ice', 'soil', 'savanna']) assert.ok(floors.has(f), `바닥 ${f}`);
  for (const e of ENCLOSURES) {
    const [x0, y0, x1, y1] = e.rect;
    const features = e.props.filter(([n]) => n !== 'rope').length + (e.props.some(([n]) => n === 'rope') ? 1 : 0);
    assert.ok(features >= 5 && features <= 8, `${e.id}: 소품 ${features}개`);
    for (const [name, x, y] of e.props) {
      const o = TILES.objects[name];
      assert.ok(o, `${e.id}: 소품 ${name} 존재`);
      assert.ok(x > x0 && x + o.w - 1 < x1 && y + o.h - 1 < y1 && y + (o.top || 0) > y0, `${e.id}: ${name} 은 울타리 안 (${x},${y})`);
    }
    const zooE = outdoor.zoo.enclosures.find((z) => z.id === e.id);
    // 바닥 타일 이름 (왼쪽 위 안쪽 칸 — 물·진흙이 없는 곳)
    const mid = objName('floor', x0 + 1, y0 + 1);
    if (e.floor === 'grass') assert.match(mid, /^grass/);
    else assert.match(mid, new RegExp(`^${e.floor}_`), `${e.id}: 바닥 ${mid}`);
    // 동물이 설 수 있는 칸 (물 포함) 이 충분하고 먹이 지점은 그중 하나
    let free = 0;
    for (let y = zooE.area.y0; y <= zooE.area.y1; y++) for (let x = zooE.area.x0; x <= zooE.area.x1; x++) if (!outdoor.collision[y][x]) free++;
    assert.ok(free >= 20, `${e.id}: 설 수 있는 칸 ${free}`);
    if (zooE.feedTile) assert.ok(!outdoor.collision[zooE.feedTile.y][zooE.feedTile.x] && inRect(zooE.feedTile.x, zooE.feedTile.y, zooE.area), `${e.id}: 먹이 지점`);
    // 큰 안내판: 2x2 (위 줄 판은 top 레이어, 기둥 칸은 막힘) + E 지점은 걸을 수 있는 칸
    const sign = outdoor.props.find((p) => /^zoo_sign_[lr]$/.test(p.name) && p.x === zooE.sign.x && p.y === zooE.sign.y);
    assert.ok(sign && sign.w === 2 && sign.h === 2, `${e.id}: 큰 안내판`);
    assert.notEqual(outdoor.layers.top[sign.y][sign.x], -1, `${e.id}: 안내판 판은 top 레이어`);
    const it = outdoor.interactables.find((i) => i.id === `sign:${e.id}`);
    assert.ok(!outdoor.collision[Math.floor((it.y - 1) / T)][Math.floor(it.x / T)], `${e.id}: 안내판 E 지점은 걸을 수 있는 칸`);
  }
  assert.ok(!outdoor.props.some((p) => p.name === 'zoo_sign'), '옛 작은 안내판 없음');
  // 코끼리: 물웅덩이 4x5 + 둘레 진흙 · 플라밍고: 수련
  const el = ENCLOSURES.find((e) => e.id === 'elephant');
  assert.deepEqual(el.pool, [93, 25, 96, 29]);
  assert.match(objName('floor', 92, 26), /^mud_/);
  assert.match(objName('floor', 94, 27), /^pool_f/);
  assert.match(objName('floor', 39, 53), /^pool_lily_/);
  // 두꺼운 울타리: 경계·우리 울타리 타일 + 문 기둥 (그림은 tools/props_zoo.py, 여기선 개수만)
  assert.ok(outdoor.props.filter((p) => p.name === 'fence_h').length >= 90);
  assert.ok(outdoor.props.filter((p) => p.name === 'gate_post').length >= 6);
  // 우리 동물 생성: 판다 2 · 펭귄 3 … 그대로, 나비 없음
  const all = createOutdoorAnimals(outdoor, { now: () => 0, random: () => 0.5 });
  assert.ok(all.every((n) => n.animal !== 'butterfly' && n.kind !== 'butterfly'));
  assert.equal(all.filter((n) => n.enclosure === 'panda').length, 2);
});

test('트랙 안쪽: 가운데 작은 연못(물 3x3 + 물가 + 수련) 과 오리 1 · 꽃 군락 6곳(화단 덩어리 + 작은 꽃 + 꽃 잔디, 동심원 아님) · 벤치 2 주변 담요·나무 군락 · 응원 깃발 8', () => {
  const P = INFIELD_POND;
  for (let y = P.y0; y <= P.y1; y++) {
    for (let x = P.x0; x <= P.x1; x++) {
      const edge = x === P.x0 || x === P.x1 || y === P.y0 || y === P.y1;
      assert.match(objName('floor', x, y), edge ? /^shore_/ : /^water_/, `연못 (${x},${y})`);
      assert.ok(outdoor.collision[y][x], '연못은 못 밟는다');
    }
  }
  assert.match(objName('floor', 63, 30), /^water_lily_/);
  const duck = outdoor.animals.find((a) => a.id === 'duck_track');
  assert.deepEqual(duck.area, { x0: 62, y0: 29, x1: 64, y1: 31 });
  const infield = (p) => trackDistance(p.x, p.y) < -3;
  const inProps = outdoor.props.filter(infield);
  const patches = inProps.filter((p) => /^flower_patch_/.test(p.name));
  const flowers = inProps.filter((p) => /^flower_\d/.test(p.name));
  assert.ok(patches.length >= 15 && patches.length <= 80, `꽃 패치 ${patches.length}`);
  assert.ok(flowers.length >= 25, `작은 꽃 ${flowers.length}`);
  // 격자 화단(돌 테두리, 통과 불가)은 안쪽 섬에 없다 — 꽃은 전부 통과 가능
  assert.equal(inProps.filter((p) => /^flowerbed_/.test(p.name)).length, 0, '안쪽 섬에 격자 화단 없음');
  for (const p of [...patches, ...flowers]) assert.ok(!outdoor.collision[p.y][p.x], `꽃 (${p.x},${p.y}) 은 통과 가능`);
  // 동심원이 아니다: 옛 꽃밭 중심(63.5, 30.5) 둘레 1.6~2.7 띠는 이제 연못·잔디
  const ring = [];
  for (let y = 26; y <= 35; y++) for (let x = 59; x <= 68; x++) { const d = Math.hypot(x + 0.5 - 63.5, y + 0.5 - 30.5); if (d >= 1.6 && d < 2.7) ring.push([x, y]); }
  assert.ok(ring.filter(([x, y]) => propsAt(x, y).some((p) => /^flower/.test(p.name))).length < ring.length / 2, '동심원 꽃밭 아님');
  const colors = new Set(patches.map((p) => p.name.slice('flower_patch_'.length)));
  assert.ok(colors.size >= 4, `군락 색 ${[...colors].join(',')}`);
  assert.equal(inProps.filter((p) => p.name === 'bench_park').length, 2);
  const blankets = [];
  for (let y = 16; y <= 45; y++) for (let x = 51; x <= 75; x++) if (objName('floor', x, y) === 'blanket' && objName('floor', x - 1, y) !== 'blanket' && objName('floor', x, y - 1) !== 'blanket') blankets.push({ x, y });
  assert.equal(blankets.length, 2, '벤치 옆 피크닉 담요 (바닥 2x2)');
  assert.ok(inProps.filter((p) => /^tree_/.test(p.name)).length >= 6, '나무 군락');
  const flags = inProps.filter((p) => /^cheer_flag_/.test(p.name));
  assert.equal(flags.length, 8, '응원 깃발');
  assert.ok(flags.every((p) => trackDistance(p.x, p.y + 1) < -3 && trackDistance(p.x, p.y + 1) > -6), '깃발은 트랙 가장자리 안쪽');
  // 담요 2 는 벤치에서 2칸 안
  const benches = inProps.filter((p) => p.name === 'bench_park');
  for (const bl of blankets) assert.ok(benches.some((b) => Math.abs(b.x - bl.x) <= 3 && Math.abs(b.y - bl.y) <= 2), '담요는 벤치 옆');
});

test('빈 잔디 소품 밀도: 공원(왼쪽·아래)·동물원 여백에 흩뿌린 소품(꽃 군락·돌·통나무·낙엽·관목·그루터기)이 충분하고, 통과 불가 소품은 둘레가 비어 있다', () => {
  const scatterRe = /^(shrub_|stump|leaves_|log|rock_a|rock_b|flower_\d|flower_patch_|bush_)/;
  const region = (x0, y0, x1, y1) => outdoor.props.filter((p) => scatterRe.test(p.name) && inRect(p.x, p.y, { x0, y0, x1, y1 }));
  const west = region(0, 13, 13, 49);
  const south = region(14, 37, 47, 49);
  const zooS = region(0, 60, 99, 69);
  assert.ok(west.length >= 25, `왼쪽 공원 ${west.length}`);
  assert.ok(south.length >= 25, `아래 공원 ${south.length}`);
  assert.ok(zooS.length >= 25, `동물원 남쪽 ${zooS.length}`);
  const kinds = new Set([...west, ...south, ...zooS].map((p) => p.name.replace(/_?\d$/, '')));
  for (const k of ['shrub', 'stump', 'log', 'rock_a', 'flower']) assert.ok(kinds.has(k), `소품 종류 ${k}`);
  // 낙엽 바닥 변형
  let leaves = 0;
  for (let y = 13; y < outdoor.height; y++) for (let x = 0; x < outdoor.width; x++) if (/^leaves_/.test(objName('floor', x, y) || '')) leaves++;
  assert.ok(leaves >= 10, `낙엽 ${leaves}`);
  // 통과 불가 흩뿌림 소품(관목·그루터기·돌·통나무)은 8방 둘레에 다른 막힌 칸이 없다
  const inPen = (p) => ENCLOSURES.some((e) => p.x >= e.rect[0] && p.x <= e.rect[2] && p.y >= e.rect[1] && p.y <= e.rect[3]);
  for (const p of outdoor.props.filter((q) => /^(shrub_\d|stump|log)$/.test(q.name) && !inPen(q))) {
    for (let y = p.y - 1; y <= p.y + p.h; y++) {
      for (let x = p.x - 1; x <= p.x + p.w; x++) {
        if (x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h) continue;
        assert.ok(x >= 0 && y >= 0 && x < outdoor.width && y < outdoor.height && !outdoor.collision[y][x], `${p.name} (${p.x},${p.y}) 둘레 (${x},${y}) 가 막힘`);
      }
    }
  }
});

test('나비 제거: 자유 동물 정의·동물 시트·NPC 속도표에 나비 없음 · 꽃밭 주변엔 반딧불이 · 구름 그림자는 낮 0.13, 노을·밤 0', () => {
  assert.ok(!outdoor.animals.some((a) => a.kind === 'butterfly' || a.species === 'butterfly'));
  assert.equal(animalsMeta.species.butterfly, undefined);
  assert.equal(Object.keys(animalsMeta.species).length, 11);
  assert.equal(SPEED.butterfly, undefined);
  const fireflies = outdoor.animals.filter((a) => a.kind === 'firefly');
  assert.ok(fireflies.some((a) => a.id === 'firefly_track' && a.area.x0 <= 59 && a.area.x1 >= 68 && a.area.y0 <= 26 && a.area.y1 >= 35), '트랙 꽃밭 반딧불이');
  const ff = new FireflyNpc(outdoor, { id: 'f', area: fireflies[0].area, now: () => 0, random: () => 0.3 });
  assert.equal(ff.snapshot().glow, true);
  assert.equal(ff.snapshot().fly, true);
  assert.equal(ff.snapshot().sheet, undefined);
  const amb = (w) => Daylight.outdoorAmbient(w).clouds;
  assert.ok(Math.abs(amb({ day: 1, sunset: 0, night: 0 }) - 0.13) < 1e-9);
  assert.equal(amb({ day: 0, sunset: 1, night: 0 }), 0);
  assert.equal(amb({ day: 0, sunset: 0, night: 1 }), 0);
});
