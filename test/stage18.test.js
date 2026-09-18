'use strict';
/**
 * 18단계 단위 테스트 (서버를 띄우지 않는다 → unit 그룹).
 *  1) 길·울타리 정합 (야외): 걸을 수 있는 길 타일(자갈 산책로·보도)에 울타리·펜스·기둥이 그려져 있으면 실패 ·
 *     길 타일이 울타리 줄을 가로지르는 모든 x/y 에 문(2칸, 양쪽 gate_post)이 있다 · 동쪽 세로 산책로(88..89) ↔ y 50 울타리 문.
 *  2) 매점 건물 4x3(어닝 top · 카운터 top+solid) · 메뉴 4종 1코인 · 창구 상호작용 하나 · 파라솔 테이블 2 + 의자 4(휴식 좌석) · 쓰레기통 · 간판 조명 · 점원 NPC(인사·감사).
 *  3) 바리스타 NPC: 카운터 뒤 · 손님이 카운터 앞에 서면 "뭐 드릴까요?" · 커피 마시기/배달이면 "맛있게 드세요 ☕"(steam) · 이름은 방장만 · 배달 채팅 문구.
 *  4) 2인 스터디룸 축소 + 문 3개: 폭 15 · 좌/우/아래 문 통과 · 각 문에서 의자·소파 앞까지 2타일 폭 · 실내 BFS · 좌석 id/좌표 유지 · 제거된 소품 · 옛 배치 회수.
 *  5) 강아지 산책: 따라오기 · 1인 제한 · 야외 이동(Hub) · 야외에서 남이 쓰다듬기 · 5분 xp · 실내 복귀/산책 끝/접속 종료 시 쿠션 복귀 · 해금(재주·같이 자기·리본) · 저장.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { getOutdoor, ZOO_GATES } = require('../server/rooms/outdoor');
const { getStudyRoom } = require('../server/rooms/studyroom');
const { TILES } = require('../server/rooms/build');
const { World } = require('../server/game/world');
const { Hub } = require('../server/game/hub');
const { HumanNpc, FollowerNpc, GREET_COOLDOWN_MS } = require('../server/game/npc');
const Affection = require('../server/game/affection');
const { createMemoryStore } = require('../server/store/memory');
const L = require('../server/game/layout');
const npcsMeta = require('../public/assets/npcs.json');

const T = 32;
const outdoor = getOutdoor();
const room = getStudyRoom();
const quiet = { log() {}, warn() {}, error() {} };
const objName = (r, layer, x, y) => Object.keys(TILES.objects).find((n) => TILES.objects[n].tiles.some((row) => row.includes(r.layers[layer][y][x]))) || null;
const propsAt = (r, x, y) => r.props.filter((p) => x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h);
const FENCE_RE = /^(fence_|glass_fence_|gate_post)/;
// 길 = 자갈 산책로 전부 + 보도(paver·kerb) 중 소품이 놓이지 않은 칸 (화단·벤치는 보도 위에 놓인 소품이라 제외)
const isPath = (x, y) => { const n = objName(outdoor, 'floor', x, y) || ''; return /^gravel_/.test(n) || (/^(paver_|kerb)/.test(n) && outdoor.occupant[y][x] === -1); };
const fenceAt = (x, y) => x >= 0 && y >= 0 && x < outdoor.width && y < outdoor.height && propsAt(outdoor, x, y).some((p) => FENCE_RE.test(p.name));
const postAt = (x, y) => x >= 0 && y >= 0 && x < outdoor.width && y < outdoor.height && propsAt(outdoor, x, y).some((p) => p.name === 'gate_post');

function reachable(r, from) {
  const seen = new Set([`${from.x},${from.y}`]);
  const q = [[from.x, from.y]];
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

// ── 1) 길·울타리 정합 ─────────────────────────────────────────────────
test('길·울타리 정합: 길 타일에 울타리·펜스·기둥이 없고 길 타일은 전부 통과 가능 · 울타리 줄을 가로지르는 길은 전부 2칸 문 + 양쪽 gate_post (맵 전체 스캔)', () => {
  const drawn = [];
  const blocked = [];
  const crossings = new Map(); // 문 시작 칸 → 폭
  for (let y = 0; y < outdoor.height; y++) {
    for (let x = 0; x < outdoor.width; x++) {
      if (!isPath(x, y)) continue;
      if (fenceAt(x, y)) drawn.push(`(${x},${y})`);
      if (outdoor.collision[y][x]) blocked.push(`(${x},${y})`);
    }
  }
  assert.deepEqual(drawn, [], `길 타일 위에 울타리가 그려진 곳: ${drawn.join(' ')}`);
  assert.deepEqual(blocked, [], `막힌 길 타일: ${blocked.join(' ')}`);
  // 가로 울타리 줄을 세로로 지나는 길: 같은 줄의 왼쪽/오른쪽 이웃이 울타리면 문이다 → 문 폭 2 + 양쪽 gate_post
  const bad = [];
  for (let y = 0; y < outdoor.height; y++) {
    for (let x = 0; x < outdoor.width; x++) {
      if (!isPath(x, y)) continue;
      // 가로 줄
      if (fenceAt(x - 1, y) && !isPath(x - 1, y)) {
        let w = 0;
        while (isPath(x + w, y) && !fenceAt(x + w, y)) w++;
        const ok = w === 2 && postAt(x - 1, y) && postAt(x + w, y);
        if (!ok) bad.push(`가로 (${x},${y}) 폭 ${w}`);
        crossings.set(`${x},${y}`, w);
      }
      // 세로 줄
      if (fenceAt(x, y - 1) && !isPath(x, y - 1)) {
        let h = 0;
        while (isPath(x, y + h) && !fenceAt(x, y + h)) h++;
        const ok = h === 2 && postAt(x, y - 1) && postAt(x, y + h);
        if (!ok) bad.push(`세로 (${x},${y}) 높이 ${h}`);
        crossings.set(`${x},${y}`, h);
      }
    }
  }
  assert.deepEqual(bad, [], `문이 없거나 기둥이 없는 교차점: ${bad.join(' ')}`);
  // 교차점은 정문(32,50) · 옆문(80,32) · 동쪽 세로 산책로(88,50) — 전부 ZOO_GATES 에 있다
  const gateStarts = new Set(ZOO_GATES.filter((g) => g.id !== 'petting').map((g) => `${g.cells[0][0]},${g.cells[0][1]}`));
  assert.deepEqual([...crossings.keys()].sort(), [...gateStarts].sort());
  const east = ZOO_GATES.find((g) => g.id === 'east');
  assert.deepEqual(east.cells, [[88, 50], [89, 50]]);
  for (const [x, y] of east.cells) { assert.ok(!outdoor.collision[y][x]); assert.match(objName(outdoor, 'floor', x, y), /^gravel_/); }
  for (const [x, y] of east.posts) assert.ok(postAt(x, y), `기둥 (${x},${y})`);
  // 세로 산책로로 동물원 남쪽(y 58) 에서 우리 사이 길(y 40) 까지 울타리 없이 걸어간다 (스폰 BFS)
  const seen = reachable(outdoor, { x: Math.floor(outdoor.spawn.x / T), y: Math.floor((outdoor.spawn.y - 1) / T) });
  for (let y = 18; y <= 59; y++) assert.ok(seen.has(`88,${y}`), `(88,${y}) 도달`);
});

// ── 2) 매점 ─────────────────────────────────────────────────────────
test('매점: 4x3 건물(어닝 top · 카운터 top+setSolid) · 창구 상호작용 하나 · 메뉴 4종 각 1코인 · 파라솔 테이블 2 + 의자 4(좌석) · 쓰레기통 · 간판 조명 2 · 점원 자리 · 옛 매대 없음 · 새 소품은 아틀라스 뒤쪽', () => {
  const shop = outdoor.props.find((p) => p.name === 'snack_shop');
  assert.deepEqual([shop.x, shop.y, shop.w, shop.h], [82, 61, 4, 2]);
  assert.ok(outdoor.layers.top[61][82] >= 0 && !outdoor.collision[61][82], '어닝 줄은 top(통과 가능)');
  for (let x = 82; x <= 85; x++) { assert.ok(outdoor.collision[62][x], '벽'); assert.ok(outdoor.collision[63][x], '카운터는 막힘'); assert.ok(outdoor.layers.top[63][x] >= 0, '카운터는 top 레이어 (점원 다리를 가린다)'); }
  assert.equal(outdoor.props.filter((p) => p.name === 'snack_bar').length, 0);
  const it = outdoor.interactables.filter((i) => /^snack/.test(i.id));
  assert.deepEqual(it.map((i) => [i.id, i.kind]), [['snack', 'snack']]);
  assert.ok(!outdoor.collision[Math.floor((it[0].y - 1) / T)][Math.floor(it[0].x / T)], '창구 앞은 걸을 수 있는 칸');
  assert.deepEqual(outdoor.zoo.snacks.map((s) => [s.id, s.emoji, s.price]), [['icecream', '🍦', 1], ['churros', '🥨', 1], ['hotdog', '🌭', 1], ['lemonade', '🍋', 1]]);
  assert.deepEqual(outdoor.props.filter((p) => p.name === 'parasol_table').map((p) => [p.x, p.y]), [[88, 62], [88, 66]]);
  const chairs = outdoor.seats.filter((s) => /^cafe_chair/.test(s.kind));
  assert.deepEqual(chairs.map((s) => [s.x, s.y, s.facing]).sort((a, b) => a[1] - b[1] || a[0] - b[0]), [[87, 63, 'right'], [90, 63, 'left'], [87, 67, 'right'], [90, 67, 'left']]);
  for (const s of chairs) assert.ok(!outdoor.collision[s.y][s.x]);
  assert.ok(outdoor.props.some((p) => p.name === 'park_bin' && p.x === 81 && p.y === 63));
  assert.ok(outdoor.props.some((p) => p.name === 'snack_menu' && p.x === 86));
  assert.ok(outdoor.labels.some((l) => /🍦/.test(l.text)), '메뉴판 글자는 클라이언트 라벨');
  assert.equal(outdoor.lights.filter((l) => l.y === Math.round((61.15 + 0.5) * T) && l.x > 82 * T && l.x < 86 * T).length, 2, '간판 조명 2');
  assert.deepEqual(outdoor.zoo.clerk, { x: 2687, y: 2048, greet: { x: 2688, y: 2080, range: 64 } });
  for (const n of ['snack_shop', 'snack_counter', 'snack_menu', 'parasol_table', 'cafe_chair_e', 'cafe_chair_w', 'park_bin', 'study_panel_v', 'door_open_v']) assert.ok(TILES.objects[n].tiles[0][0] >= 1496, `${n} 은 뒤쪽에 추가`);
  assert.equal(TILES.objects.door_open_v.door, true);
  // 점원 시트 메타
  assert.deepEqual(Object.keys(npcsMeta.chars), ['clerk', 'barista']);
  assert.equal(npcsMeta.framesPerChar, 24);
});

test('사람 NPC(HumanNpc): 제자리 · idle ↔ 행동(wave/wipe …) 전환 · 손님이 greet 지점에 서면 인사 말풍선(say) 1회(쿨다운) · thank · 쓰다듬기 불가 · 스냅샷 sheet npcs', () => {
  let t = 1000000;
  let r = 0.1;
  const npc = new HumanNpc(outdoor, { id: 'clerk', char: 'clerk', name: '사장님', x: 2687, y: 2048, greet: { x: 2688, y: 2080, range: 64 }, now: () => t, random: () => r, tickMs: 100 });
  const said = [];
  const states = new Set();
  npc.on('say', (e) => said.push(e.text));
  npc.on('update', (s) => states.add(s.state));
  const players = [];
  npc.players = () => players;
  const advance = (ms) => { for (let i = 0; i < ms / 100; i++) { t += 100; npc.tick(); } };
  advance(30000);
  assert.ok(states.has('wave') || states.has('wipe'), `행동 ${[...states]}`);
  assert.equal(npc.x, 2687, '움직이지 않는다');
  assert.deepEqual(said, []);
  players.push({ id: 'p1', nickname: 'A', x: 2688, y: 2080, connected: true });
  advance(200);
  assert.deepEqual(said, ['어서 오세요!']);
  assert.equal(npc.state, 'greet');
  advance(5000);
  assert.deepEqual(said, ['어서 오세요!'], '쿨다운 안엔 다시 인사하지 않는다');
  advance(GREET_COOLDOWN_MS);
  assert.deepEqual(said, ['어서 오세요!', '어서 오세요!']);
  assert.equal(npc.thank('맛있게 드세요 🍦').text, '맛있게 드세요 🍦');
  assert.equal(said.at(-1), '맛있게 드세요 🍦');
  assert.deepEqual(npc.pet({ x: npc.x, y: npc.y }), { ok: false, error: 'not_pettable' });
  const s = npc.snapshot();
  assert.equal(s.sheet, 'npcs');
  assert.equal(s.char, 'clerk');
  assert.equal(s.pettable, false);
  npc.dispose();
});

// ── 3) 바리스타 ─────────────────────────────────────────────────────
function makeWorld(opts = {}) {
  let t = new Date('2026-09-18T10:00:00+09:00').getTime();
  const store = opts.store || createMemoryStore();
  const world = new World(room, { now: () => t, store, tz: 'Asia/Seoul', npc: { autoStart: false }, study: { autoTick: false }, log: quiet, studyId: 1, studyInfo: () => ({ id: 1, name: '테스트', ownerNickname: '민수', editPolicy: 'anyone', weeklyGoalMinutes: 1200 }), members: async () => ['민수', '영희'], ...opts.world });
  return { world, store, advance: (ms) => { t += ms; }, now: () => t };
}

test('바리스타: 카운터 뒤(anchors.barista) · 스냅샷 char barista · 손님이 카운터 앞에 서면 "뭐 드릴까요?" · 커피 마시기/배달 → "맛있게 드세요 ☕" + steam · 이름은 방장만(room_pets barista 행, 재시작 복원)', async () => {
  const { world, store, advance } = makeWorld();
  assert.deepEqual(room.anchors.barista, { x: 8 * T, y: 14 * T, facing: 'down', greet: { x: 6.5, y: 16, range: 64 } });
  assert.ok(room.collision[13][7] && room.collision[13][8], '바리스타 자리는 사람이 못 들어간다');
  const b = world.barista;
  assert.equal(b.snapshot().char, 'barista');
  assert.equal(b.name, '바리스타');
  assert.deepEqual(world.npcSnapshots().map((n) => n.id), ['dog', 'barista']);
  const says = [];
  world.on('npcSay', (e) => says.push([e.npc, e.text, Boolean(e.steam)]));
  const a = world.join({ nickname: '민수', socketId: 'sa' }).player;
  a.x = 6.5 * T; a.y = 16 * T;
  for (let i = 0; i < 3; i++) { advance(100); b.tick(); }
  assert.deepEqual(says, [['barista', '뭐 드릴까요?', false]]);
  assert.equal(world.interact(a, 'coffee').status, 'coffee');
  assert.deepEqual(says.at(-1), ['barista', '맛있게 드세요 ☕', true]);
  await store.adjustCoins('민수', 3, 'test');
  const g = await world.giftCoffee(a, { menu: 'latte', to: '영희' });
  assert.equal(g.ok, true);
  assert.equal(says.filter((s) => s[1] === '맛있게 드세요 ☕').length, 2);
  assert.equal(world.baristaName(), '바리스타');
  // 이름: 방장만
  const c = world.join({ nickname: '영희', socketId: 'sb' }).player;
  assert.deepEqual(await world.setNpcName(c, 'barista', '민지'), { ok: false, error: 'forbidden' });
  assert.equal((await world.setNpcName(a, 'barista', '민지')).name, '민지');
  assert.equal(world.baristaName(), '민지');
  assert.equal((await store.roomPets(1)).find((r) => r.itemId === 'barista').name, '민지');
  await world.dispose();
  const w2 = makeWorld({ store }).world;
  await w2.init();
  assert.equal(w2.barista.name, '민지', '재시작 복원');
  await w2.dispose();
});

// ── 4) 스터디룸 축소 + 문 3개 ───────────────────────────────────────────
const seatSet = new Set(room.seats.map((s) => `${s.x},${s.y}`));
const walkable = (x, y) => x >= 0 && y >= 0 && x < room.width && y < room.height && !room.collision[y][x] && !seatSet.has(`${x},${y}`);
const block = (x, y) => walkable(x, y) && walkable(x + 1, y) && walkable(x, y + 1) && walkable(x + 1, y + 1);
/** 2x2 블록 BFS: from 블록에서 to 블록까지 (블록 좌상단 좌표) */
function wideReach(from, to, inside) {
  const q = [from];
  const seen = new Set([`${from[0]},${from[1]}`]);
  while (q.length) {
    const [x, y] = q.shift();
    if (x === to[0] && y === to[1]) return true;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inside(nx, ny) || !block(nx, ny) || seen.has(`${nx},${ny}`)) continue;
      seen.add(`${nx},${ny}`);
      q.push([nx, ny]);
    }
  }
  return false;
}

test('스터디룸 축소: 벽 x 14/30 (안쪽 15칸, 옛 20칸) · 문 3개(아래·왼쪽·오른쪽 가운데, 슬라이딩 유리문 2타일) 전부 통과 가능 · 명패 앵커는 아래 문만 · 좌석 id/좌표 유지 · 제거 소품 · 좌우 복도에 소품 없음', () => {
  assert.equal(room.zones[0].w, 15 * T);
  const doors = room.doors.filter((d) => /^study-/.test(d.id));
  assert.deepEqual(doors.map((d) => [d.id, d.x, d.y]), [['study-w-a', 14, 16], ['study-w-b', 14, 17], ['study-e-a', 30, 16], ['study-e-b', 30, 17], ['study-l', 22, 21], ['study-r', 23, 21]]);
  for (const d of doors) assert.ok(!room.collision[d.y][d.x], `문 ${d.id}`);
  // 세로 패널(1x2, 막힘)은 문 바로 위
  for (const x of [14, 30]) { assert.ok(room.collision[14][x] && room.collision[15][x]); assert.ok(propsAt(room, x, 14).some((p) => p.name === 'study_panel_v')); }
  assert.deepEqual(room.anchors.nameplate, { x: 21 * T, y: Math.round(19.05 * T) });
  assert.deepEqual(room.seats.filter((s) => /^study-/.test(s.id)).map((s) => [s.id, s.x, s.y]), [['study-a', 21, 14], ['study-b', 23, 14], ['study-sofa-a', 26, 19], ['study-sofa-b', 27, 19]]);
  for (const n of ['whiteboard_small', 'mini_fridge', 'low_table_study']) assert.equal(room.props.filter((p) => p.name === n).length, 0, n);
  assert.equal(room.props.filter((p) => /^bookcase/.test(p.name) && p.y >= 12 && p.y <= 20).length, 1, '책장 1개');
  for (const n of ['desk_long', 'corkboard', 'rug_study_grid', 'sofa_love_n', 'coat_rack_cardigan', 'nightstand_books', 'nightstand_lamp', 'slippers_a', 'slippers_b']) assert.ok(room.props.some((p) => p.name === n) || Object.keys(TILES.objects).some((k) => k === n && room.layers.floor.some((row) => row.includes(TILES.objects[k].tiles[0][0]))), `${n} 유지`);
  assert.equal(room.props.filter((p) => p.name === 'standing_lamp' && p.y >= 12).length, 2, '사이드 램프 2');
  // 좌우 복도(x 12..13 · 31..35, y 10..21)는 소품 없이 전부 걸을 수 있다 (y 22..24 는 입구 복도 — 기존 소품)
  for (let y = 10; y <= 21; y++) for (const x of [12, 13, 31, 32, 33, 34, 35]) assert.ok(!room.collision[y][x] && room.occupant[y][x] === -1, `복도 (${x},${y})`);
});

test('스터디룸 통행: 각 문 → 의자 앞 · 소파 앞까지 2타일 폭(2x2 블록 BFS, 방 안에서만) · 실내 전체 BFS 고립 0 · 세 문 모두 스폰에서 닿는다', () => {
  const inside = (x, y) => x >= 14 && x <= 30 && y >= 12 && y <= 21 && x + 1 <= 30 && y + 1 <= 21;
  // 문 블록: 아래(22,20) · 왼쪽(14,16) · 오른쪽(29,16). 의자 앞 블록 (21,15)·(22,15). 소파 앞 블록 (25,17)·(27,17)
  for (const [x, y] of [[22, 20], [14, 16], [29, 16]]) assert.ok(block(x, y), `문 블록 (${x},${y})`);
  const chair = [21, 15];
  const sofa = [27, 17];
  for (const [name, door] of [['아래', [22, 20]], ['왼쪽', [14, 16]], ['오른쪽', [29, 16]]]) {
    assert.ok(wideReach(door, chair, inside), `${name} 문 → 의자 앞 2타일 폭`);
    assert.ok(wideReach(door, sofa, inside), `${name} 문 → 소파 앞 2타일 폭`);
  }
  const seen = reachable(room, { x: 22, y: 23 });
  const isolated = [];
  for (let y = 0; y < room.height; y++) for (let x = 0; x < room.width; x++) if (!room.collision[y][x] && !seen.has(`${x},${y}`)) isolated.push(`(${x},${y})`);
  assert.deepEqual(isolated, []);
  for (const d of room.doors) assert.ok(seen.has(`${d.x},${d.y}`), `문 ${d.id}`);
  // 왼쪽 복도 → 왼쪽 문 → 방 안 → 오른쪽 문 → 오른쪽 복도 (2x2 블록으로)
  assert.ok(wideReach([12, 16], [31, 16], (x, y) => x >= 12 && x <= 35 && y >= 12 && y <= 21));
});

test('옛 배치 마이그레이션: 새 벽(x 14/30)·새 문 자리에 있던 room_layout 은 init() 에서 회수, 방 안 유효한 배치는 유지', async () => {
  const store = createMemoryStore();
  const inv1 = await store.addInventory('민수', 'floor_lamp', {});
  const inv2 = await store.addInventory('민수', 'floor_lamp', {});
  const inv3 = await store.addInventory('민수', 'beanbag', {});
  await store.addLayout(1, { itemId: 'floor_lamp', inventoryId: inv1.id, x: 13, y: 15, rotation: 0, meta: {}, placedBy: '민수' }); // 옛 커튼 옆 통로 → 지금은 왼쪽 복도 (유효)
  await store.addLayout(1, { itemId: 'floor_lamp', inventoryId: inv2.id, x: 30, y: 16, rotation: 0, meta: {}, placedBy: '민수' }); // 새 오른쪽 문 자리 → 회수
  await store.addLayout(1, { itemId: 'beanbag', inventoryId: inv3.id, x: 17, y: 17, rotation: 0, meta: {}, placedBy: '민수' }); // 방 안 빈 바닥 → 유지
  const { world } = makeWorld({ store });
  await world.init();
  assert.deepEqual(world.recalledLayout.map((e) => [e.itemId, e.x, e.y, e.error]), [['floor_lamp', 30, 16, 'blocked']]);
  assert.deepEqual(world.listLayout().map((e) => [e.itemId, e.x, e.y]), [['floor_lamp', 13, 15], ['beanbag', 17, 17]]);
  assert.equal(L.isFreeFloor(room, 30, 16), false, '문 칸엔 못 놓는다');
  await world.dispose();
});

// ── 5) 강아지 산책 ───────────────────────────────────────────────────────
function makeHub() {
  let t = new Date('2026-09-18T10:00:00+09:00').getTime();
  const store = createMemoryStore();
  const hub = new Hub({ room, store, tz: 'Asia/Seoul', now: () => t, log: quiet, world: { npc: { autoStart: false }, study: { autoTick: false } }, goalCheckMs: 0, releaseMs: 1000 });
  return { hub, store, advance: (ms) => { t += ms; }, now: () => t };
}

test('산책: 옆에서 시작(멀면 too_far) → 강아지는 숨고(npcRemoved) 산책 강아지(dogwalk:<sid>, walk, ownerId)가 따라온다 · 다른 사람은 busy · 산책 끝 → 쿠션으로 복귀 + 이벤트', async () => {
  const { hub, advance } = makeHub();
  await hub.init();
  const st = (await hub.createStudy({ name: '테스트', ownerNickname: '민수' })).study;
  const { world: w, player: p } = await hub.join({ study: st.code, nickname: '민수', socketId: 's1' });
  const { player: q } = await hub.join({ study: st.code, nickname: '영희', socketId: 's2' });
  const ev = [];
  w.on('npcRemoved', (e) => ev.push(['removed', e.id]));
  w.on('dogWalk', (e) => ev.push(['walk', e.on, e.reason]));
  w.on('npcUpdate', (s) => { if (s.id === 'dog' && !w.dog.hidden && ev.at(-1) && ev.at(-1)[0] === 'walk' && !ev.at(-1)[1]) ev.push(['dog-back', s.state]); });
  p.x = w.dog.x + 300; p.y = w.dog.y;
  assert.deepEqual(w.startWalk(p), { ok: false, error: 'too_far' });
  p.x = w.dog.x + 20;
  const r = w.startWalk(p);
  assert.equal(r.ok, true);
  assert.deepEqual(r.walk, { by: '민수', playerId: p.id, since: w.now() });
  assert.equal(w.dog.hidden, true);
  assert.deepEqual(w.npcSnapshots().map((n) => n.id), ['barista', `dogwalk:${st.id}`], '강아지는 스냅샷에서 빠지고 산책 강아지가 들어간다');
  const walker = w.walker;
  assert.equal(walker instanceof FollowerNpc, true);
  const snap = walker.snapshot();
  assert.equal(snap.ownerId, p.id);
  assert.equal(snap.walk, true);
  assert.equal(snap.name, '사랑');
  assert.equal(snap.level, 1);
  assert.deepEqual(p.dogWalk, { studyId: st.id });
  q.x = walker.x + 10; q.y = walker.y;
  assert.deepEqual(w.startWalk(q), { ok: false, error: 'busy', by: '민수', playerId: p.id });
  // 따라오기: 주인이 오른쪽으로 걸어가면 뒤따라온다
  const x0 = walker.x;
  for (let i = 0; i < 50; i++) { if (i < 40) p.x += 4; advance(100); walker.tick(); }
  assert.ok(walker.x > x0 + 60, `따라옴 ${walker.x - x0}`);
  assert.ok(Math.abs(p.x - walker.x) <= 70);
  // 산책 끝 → 쿠션에서 잔다
  assert.equal(w.endWalk('end').ok, true);
  assert.equal(w.walk, null);
  assert.equal(w.dog.hidden, false);
  assert.equal(w.dog.state, 'sleep');
  assert.deepEqual([Math.floor(w.dog.x / T), Math.floor((w.dog.y - 1) / T)], [24, 9], '쿠션');
  assert.equal(w.npcById(`dogwalk:${st.id}`), null);
  assert.equal(p.dogWalk, null);
  assert.deepEqual(ev.filter((e) => e[0] !== 'dog-back'), [['removed', 'dog'], ['walk', true, 'start'], ['removed', `dogwalk:${st.id}`], ['walk', false, 'end']]);
  assert.ok(ev.some((e) => e[0] === 'dog-back' && e[1] === 'sleep'), '복귀 스냅샷');
  assert.deepEqual(w.endWalk(), { ok: false, error: 'not_walking' });
  await hub.dispose();
});

test('산책 야외 이동: 이중문으로 나가면 산책 강아지가 야외 월드에 다시 생겨 따라오고, 남이 쓰다듬으면 소속 스터디 애정도 +1(하루 첫 3번) · 산책 중인 스터디 월드는 비어도 해제되지 않음 · 건물 문으로 들어오면 쿠션 복귀 · 접속 종료도 복귀', async () => {
  const { hub, store, advance } = makeHub();
  await hub.init();
  const st = (await hub.createStudy({ name: '테스트', ownerNickname: '민수' })).study;
  const { world: w, player: p } = await hub.join({ study: st.code, nickname: '민수', socketId: 's1' });
  p.x = w.dog.x + 20; p.y = w.dog.y;
  assert.equal(w.startWalk(p).ok, true);
  const o = await hub.goOutdoor(p, w);
  assert.equal(o.ok, true);
  const ow = o.world;
  const id = `dogwalk:${st.id}`;
  assert.equal(w.npcById(id), null, '스터디 월드엔 없다');
  const walker = ow.npcById(id);
  assert.ok(walker && walker.walk && walker.ownerId === p.id && walker.home === w);
  assert.equal(w.walker, walker);
  assert.ok(w.walk, '산책은 계속');
  assert.equal(w.players.size, 0);
  hub.scheduleRelease(st.id);
  assert.equal(hub.releaseTimers.has(st.id), false, '산책 중이면 해제 예약 없음');
  assert.equal(await hub.releaseWorld(st.id), false);
  // 야외에서 따라오기
  for (let i = 0; i < 60; i++) { if (i < 50) p.x += 4; advance(100); walker.tick(); }
  assert.ok(Math.abs(p.x - walker.x) <= 70, '야외에서도 따라온다');
  // 남이 쓰다듬기 (야외 월드) → 소속 스터디 애정도
  const { player: q } = await hub.join({ study: st.code, nickname: '영희', socketId: 's2' });
  await hub.goOutdoor(q, w);
  q.x = walker.x + 10; q.y = walker.y;
  const xp = [];
  w.on('dogXp', (e) => xp.push([e.reason, e.amount, e.affection.level, e.affection.xp]));
  for (let i = 0; i < 5; i++) { assert.equal(walker.pet(q).ok, true); advance(3100); }
  assert.deepEqual(xp, [['pet', 1, 1, 1], ['pet', 1, 1, 2], ['pet', 1, 1, 3]], '하루 첫 3번만');
  assert.deepEqual(await store.getDogAffection(st.id), { studyId: st.id, level: 1, xp: 3, updatedAt: w.now() - 3100 * 3 });
  assert.equal(walker.snapshot().level, 1);
  // 실내로 → 산책 끝, 쿠션
  p.x = 31.5 * T; p.y = 20 * T;
  const i = await hub.goInside(p, ow);
  assert.equal(i.ok, true);
  assert.equal(ow.npcById(id), null, '야외의 산책 강아지는 사라진다');
  assert.equal(w.walk, null);
  assert.equal(w.dog.hidden, false);
  assert.equal(p.dogWalk, null);
  assert.equal(w.walker, null);
  // 접속 종료 (야외에서): 산책 다시 시작 → 나가서 → remove → 복귀
  p.x = w.dog.x + 20; p.y = w.dog.y;
  assert.equal(w.startWalk(p).ok, true);
  await hub.goOutdoor(p, w);
  assert.ok(ow.npcById(id));
  ow.remove(p.id, 'timeout');
  assert.equal(ow.npcById(id), null);
  assert.equal(w.walk, null, '접속이 끊기면 복귀');
  assert.equal(w.dog.hidden, false);
  hub.scheduleRelease(st.id);
  assert.equal(hub.releaseTimers.has(st.id), true, '이제 해제 예약');
  await hub.dispose();
});

test('애정도: 산책 5분마다 +1(tickWalk) · 레벨업 필요 xp(3+L) · 해금 Lv2 앉아/Lv3 손/Lv5 빙글/Lv8 같이 자기/Lv10 리본 · 재주는 해금 전 locked · Lv8 산책 강아지는 주인이 앉아 공부하면 잔다 · Lv10 리본 장착 + 인벤토리 지급 · 정보(dogInfo)', async () => {
  assert.deepEqual([Affection.needFor(1), Affection.needFor(2), Affection.needFor(9)], [4, 5, 12]);
  assert.deepEqual(Affection.gain({ level: 1, xp: 3 }, 1), { level: 2, xp: 0, gained: 1, unlocked: [Affection.UNLOCKS[0]] });
  assert.deepEqual(Affection.gain({ level: 10, xp: 0 }, 5), { level: 10, xp: 0, gained: 0, unlocked: [] });
  assert.equal(Affection.summary({ level: 10, xp: 0 }).need, null);
  const { hub, store, advance, now } = makeHub();
  await hub.init();
  const st = (await hub.createStudy({ name: '테스트', ownerNickname: '민수' })).study;
  const { world: w, player: p } = await hub.join({ study: st.code, nickname: '민수', socketId: 's1' });
  assert.deepEqual(w.dogInfo(), { ok: true, name: '사랑', walk: null, affection: { level: 1, xp: 0, need: 4, max: 10, unlocked: [], unlocks: Affection.UNLOCKS } });
  p.x = w.dog.x + 20; p.y = w.dog.y;
  assert.deepEqual(w.dogTrick(p, 'sit'), { ok: false, error: 'locked', level: 2 });
  assert.deepEqual(w.dogTrick(p, 'fly'), { ok: false, error: 'no_trick' });
  assert.equal(w.startWalk(p).ok, true);
  const levels = [];
  w.on('dogLevel', (e) => levels.push([e.level, e.unlocked.map((u) => u.id)]));
  assert.equal(w.tickWalk(now()), 0);
  advance(4 * 60 * 1000);
  assert.equal(w.tickWalk(now()), 0, '5분 전');
  advance(60 * 1000 + 1);
  assert.equal(w.tickWalk(now()), 1, '5분 → +1');
  assert.deepEqual(w.affection, { level: 1, xp: 1 });
  advance(3 * 5 * 60 * 1000);
  assert.equal(w.tickWalk(now()), 3, '15분 → +3 (묶어서)');
  assert.deepEqual(w.affection, { level: 2, xp: 0 });
  assert.deepEqual(levels, [[2, ['sit']]]);
  assert.equal(w.walker.snapshot().level, 2);
  // 재주 (Lv2 앉아 OK, 손은 Lv3)
  const walker = w.walker;
  p.x = walker.x + 10; p.y = walker.y;
  const tricks = [];
  w.on('npcTrick', (e) => tricks.push([e.npc, e.trick]));
  assert.equal(w.dogTrick(p, 'sit').ok, true);
  assert.equal(walker.state, 'trick_sit');
  assert.deepEqual(w.dogTrick(p, 'paw'), { ok: false, error: 'locked', level: 3 });
  assert.deepEqual(tricks, [[`dogwalk:${st.id}`, 'sit']]);
  p.x = walker.x + 200;
  assert.deepEqual(w.dogTrick(p, 'sit'), { ok: false, error: 'too_far' });
  // Lv8: 주인이 앉아 공부 중이면 발밑에서 잔다
  w.addAffection(60, 'test', p);
  assert.ok(w.affection.level >= 8 && w.affection.level < 10, `Lv${w.affection.level}`);
  assert.equal(walker.sleepBeside, true);
  p.x = 21.5 * T; p.y = 15 * T;
  assert.equal(w.sit(p, 'study-a').ok, true);
  walker.x = p.x - 30; walker.y = p.y;
  for (let i = 0; i < 30; i++) { advance(100); walker.tick(); }
  assert.equal(walker.state, 'sleep', 'Lv8 같이 자기');
  // Lv10: 리본 + 인벤토리
  w.addAffection(40, 'test', p);
  assert.deepEqual(w.affection, { level: 10, xp: 0 });
  assert.ok(levels.at(-1)[1].includes('ribbon'));
  await Promise.all([...w.pendingAwards]);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(w.dog.cosmetics.head, { itemId: 'deco_ribbon', variant: 'red', inventoryId: null });
  assert.equal(w.dog.publicCosmetics().head, 'ribbon/red');
  assert.equal((await store.listInventory('민수')).filter((i) => i.itemId === 'deco_ribbon').length, 1, '리본 무료 지급');
  assert.equal((await store.roomPets(st.id)).find((r) => r.itemId === 'dog').cosmetics.head.itemId, 'deco_ribbon');
  assert.deepEqual(await store.getDogAffection(st.id), { studyId: st.id, level: 10, xp: 0, updatedAt: now() });
  assert.deepEqual(w.dogInfo().affection.unlocked, ['sit', 'paw', 'spin', 'sleep_beside', 'ribbon']);
  await hub.dispose();
  // 재시작: 애정도 복원 → 강아지 스냅샷 level
  const w2 = makeWorld({ store }).world;
  await w2.init();
  assert.equal(w2.dog.snapshot().level, 10);
  await w2.dispose();
});
