'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { getStudyRoom } = require('../server/rooms/studyroom');
const { TILES, isBlocked } = require('../server/rooms/build');

const room = getStudyRoom();

function bfs(room, sx, sy) {
  const seen = new Set([`${sx},${sy}`]);
  const q = [[sx, sy]];
  while (q.length) {
    const [x, y] = q.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (isBlocked(room, nx, ny) || seen.has(`${nx},${ny}`)) continue;
      seen.add(`${nx},${ny}`);
      q.push([nx, ny]);
    }
  }
  return seen;
}

test('방 크기와 레이어 형태', () => {
  assert.equal(room.name, '우리의 스터디룸');
  assert.equal(room.width, 46);
  assert.equal(room.height, 34);
  assert.equal(room.tileSize, 32);
  for (const name of ['floor', 'furniture', 'top']) {
    assert.equal(room.layers[name].length, 34);
    for (const row of room.layers[name]) assert.equal(row.length, 46);
  }
  assert.equal(room.collision.length, 34);
});

test('모든 타일 인덱스는 아틀라스 범위 안', () => {
  for (const name of ['floor', 'furniture', 'top']) {
    for (const row of room.layers[name]) {
      for (const idx of row) assert.ok(idx === -1 || (idx >= 0 && idx < TILES.count), `${name} 레이어에 잘못된 인덱스 ${idx}`);
    }
  }
});

test('바깥 테두리와 벽은 통과 불가', () => {
  for (let x = 0; x < room.width; x++) assert.ok(isBlocked(room, x, 0), `상단 벽 (${x},0)`);
  for (let y = 0; y <= 25; y++) {
    assert.ok(isBlocked(room, 0, y), `외벽면 (0,${y})`);
    assert.ok(isBlocked(room, 45, y), `외벽면 (45,${y})`);
    assert.ok(isBlocked(room, 1, y), `좌측 벽 (1,${y})`);
    assert.ok(isBlocked(room, 44, y), `우측 벽 (44,${y})`);
  }
});

test('스폰 위치는 통과 가능', () => {
  const tx = Math.floor(room.spawn.x / room.tileSize);
  const ty = Math.floor((room.spawn.y - 1) / room.tileSize);
  assert.ok(!isBlocked(room, tx, ty));
});

test('의자/푸프/소파 좌석 18개, 모두 통과 가능', () => {
  assert.equal(room.seats.length, 18);
  for (const s of room.seats) assert.ok(!isBlocked(room, s.x, s.y), `좌석 ${s.id} (${s.x},${s.y})`);
  const facings = new Set(room.seats.map((s) => s.facing));
  for (const f of facings) assert.ok(['up', 'down', 'left', 'right'].includes(f));
});

test('유리문·입구는 통과 가능, 유리벽은 통과 불가', () => {
  for (const d of room.doors) assert.ok(!isBlocked(room, d.x, d.y), `문 ${d.id}`);
  assert.ok(room.doors.some((d) => d.id === 'study1-l'));
  assert.ok(room.doors.some((d) => d.id === 'study2-r'));
  assert.ok(room.doors.some((d) => d.id === 'entrance'));
  // 스터디룸 A 의 좌우 유리벽
  for (let y = 12; y <= 20; y++) {
    assert.ok(isBlocked(room, 11, y));
    assert.ok(isBlocked(room, 20, y));
    assert.ok(isBlocked(room, 25, y));
    assert.ok(isBlocked(room, 34, y));
  }
});

test('스폰에서 모든 좌석·문·바깥까지 걸어서 도달 가능', () => {
  const tx = Math.floor(room.spawn.x / room.tileSize);
  const ty = Math.floor((room.spawn.y - 1) / room.tileSize);
  const reach = bfs(room, tx, ty);
  for (const s of room.seats) assert.ok(reach.has(`${s.x},${s.y}`), `좌석 ${s.kind} (${s.x},${s.y}) 도달 불가`);
  for (const d of room.doors) assert.ok(reach.has(`${d.x},${d.y}`), `문 ${d.id} 도달 불가`);
  assert.ok(reach.has('22,28'), '입구 밖 매트 도달 불가');
  // 스터디룸 안쪽
  assert.ok(reach.has('16,17'));
  assert.ok(reach.has('29,17'));
});

test('상단 레이어에 화분 윗부분·펜던트 등이 있고, 그 칸은 통과 가능', () => {
  let topCount = 0;
  for (let y = 0; y < room.height; y++) {
    for (let x = 0; x < room.width; x++) {
      if (room.layers.top[y][x] !== -1) {
        topCount++;
        // 화분 윗부분 아래 칸(화분)은 막혀 있고, 윗부분 자체는 furniture 가 없으면 통과 가능해야 한다
        if (room.layers.furniture[y][x] === -1 && room.layers.floor[y][x] !== -1 && y > 2) {
          assert.ok(!isBlocked(room, x, y), `top 전용 칸 (${x},${y}) 이 막혀 있음`);
        }
      }
    }
  }
  assert.ok(topCount > 12, `top 레이어 칸 ${topCount}`);
});

test('조명 목록이 있고 픽셀 좌표가 맵 안', () => {
  assert.ok(room.lights.length >= 20);
  for (const l of room.lights) {
    assert.ok(l.x >= 0 && l.x <= room.width * 32);
    assert.ok(l.y >= 0 && l.y <= room.height * 32);
    assert.ok(l.r > 0);
  }
});

test('보드/표지판 라벨은 웹폰트용 데이터로 내려간다 (타일에 굽지 않음)', () => {
  assert.ok(room.labels.length >= 10);
  const texts = room.labels.map((l) => l.text).join('|');
  for (const t of ['Good', 'Study', 'FOCUS', 'Music', 'COFFEE', '수빈s\nROOM', '선아s\nROOM', 'Small Steps', 'WELCOME']) assert.match(texts, new RegExp(t));
  for (const l of room.labels) {
    assert.ok(['hand', 'sans'].includes(l.font));
    assert.ok(l.x >= 0 && l.x <= room.width * 32 && l.y >= 0 && l.y <= room.height * 32);
  }
});

test('식물은 3단계 정리 후 8~12개 (창가 양끝·스터디룸·커피·입구·회의 구역), 벽 덩굴은 창문 좌우 2개뿐', () => {
  const { objects } = TILES;
  const plantTiles = new Set();
  const vineTiles = new Set();
  for (const [name, o] of Object.entries(objects)) {
    if (/^plant_/.test(name)) plantTiles.add(o.tiles[o.h - 1][0]);
    if (name === 'wall_vine') vineTiles.add(o.tiles[0][0]);
  }
  let plants = 0;
  const vines = [];
  for (const layer of ['furniture', 'top']) {
    room.layers[layer].forEach((row, y) => row.forEach((idx, x) => {
      if (plantTiles.has(idx)) plants++;
      if (vineTiles.has(idx)) vines.push([x, y]);
    }));
  }
  assert.ok(plants >= 8 && plants <= 12, `식물 ${plants}개`);
  assert.deepEqual(vines, [[13, 1], [28, 1]]);
});

test('창문: 밤 타일은 3프레임 애니메이션, 낮 타일은 windowDay 레이어에 같은 위치, 하늘 사각형은 창 폭과 같다', () => {
  const { objects, animTiles } = TILES;
  const f0 = objects.window_l_f0.tiles[0][0];
  const f1 = animTiles[String(f0)];
  const f2 = animTiles[String(f1)];
  assert.equal(animTiles[String(f2)], f0);
  assert.equal(animTiles[String(objects.window_l_day.tiles[0][0])], undefined, '낮 창문은 깜빡이지 않는다');
  assert.ok(Array.isArray(room.layers.windowDay));
  let dayCount = 0;
  for (let y = 0; y < room.height; y++) {
    for (let x = 0; x < room.width; x++) {
      const d = room.layers.windowDay[y][x];
      if (d === -1) continue;
      dayCount++;
      assert.notEqual(room.layers.furniture[y][x], -1, `낮 창문 (${x},${y}) 아래에 밤 창문이 있어야 함`);
    }
  }
  assert.equal(dayCount, 14 * 5);
  assert.equal(room.windows.length, 1);
  assert.deepEqual(room.windows[0], { x: 14 * 32, y: 0, w: 14 * 32, h: 144 });
});

test('유리 스터디룸: 프레임 기둥·유리 판·2타일 열린 문·2타일 슬라이딩 패널, 구역(zone) 2개', () => {
  const { objects } = TILES;
  const at = (x, y) => room.layers.furniture[y][x];
  const idx = (name) => objects[name].tiles[0][0];
  // 방 A (x 11..20): 세로 유리벽은 3타일마다 기둥
  for (let y = 12; y <= 20; y++) {
    const want = (y - 12) % 3 === 0 ? 'gpost_NS' : 'glass_NS';
    assert.equal(at(11, y), idx(want), `(11,${y})`);
    assert.equal(at(20, y), idx(want), `(20,${y})`);
    assert.equal(at(25, y), idx(want), `(25,${y})`);
    assert.equal(at(34, y), idx(want), `(34,${y})`);
  }
  assert.equal(at(11, 21), idx('gpost_NE'));
  assert.equal(at(20, 21), idx('gpost_NW'));
  assert.equal(at(34, 21), idx('gpost_NW'));
  assert.equal(at(25, 21), idx('gpost_NE'));
  // 슬라이딩 문 패널은 2타일 폭 (x 12..13 / 32..33), 통과 불가
  assert.equal(objects.study_panel_1.w, 2);
  assert.equal(objects.study_panel_1.h, 4);
  assert.equal(at(12, 21), objects.study_panel_1.tiles[3][0]);
  assert.equal(at(13, 21), objects.study_panel_1.tiles[3][1]);
  assert.ok(isBlocked(room, 12, 21) && isBlocked(room, 13, 21));
  // 열린 문 2타일은 패널 바로 옆 (A: 14..15, B: 30..31), 그 옆은 기둥
  for (const [x, id] of [[14, 'study1-l'], [15, 'study1-r'], [31, 'study2-l'], [30, 'study2-r']]) {
    assert.equal(at(x, 21), idx('door_open'));
    assert.ok(!isBlocked(room, x, 21));
    assert.ok(room.doors.some((d) => d.id === id && d.x === x && d.y === 21), id);
  }
  assert.equal(at(16, 21), idx('gpost_E'));
  assert.equal(at(29, 21), idx('gpost_W'));
  for (const x of [17, 18, 19, 26, 27, 28]) assert.equal(at(x, 21), idx('glass_EW'));
  // 위쪽 벽 덩굴 없음
  for (let x = 11; x <= 20; x++) assert.notEqual(room.layers.top[10][x], idx('wall_vine'));
  assert.equal(room.zones.length, 2);
  assert.deepEqual(room.zones.map((z) => z.id), ['study1', 'study2']);
  assert.deepEqual(room.zones[0], { id: 'study1', kind: 'glass', x: 12 * 32, y: 12 * 32, w: 8 * 32, h: 9 * 32, bright: 0.6 });
});

test('화면(모니터 2 + 노트북 1)은 좌석에 연결되고, 상호작용 지점(커피·음악)은 통과 가능한 칸 위', () => {
  assert.equal(room.screens.length, 3);
  const kinds = room.screens.map((s) => s.kind).sort();
  assert.deepEqual(kinds, ['laptop', 'monitor', 'monitor']);
  for (const s of room.screens) {
    const seat = room.seats.find((q) => q.id === s.seatId);
    assert.ok(seat, `좌석 ${s.seatId}`);
    assert.ok(s.w > 0 && s.h > 0);
    // 화면은 좌석에서 2타일 안
    assert.ok(Math.hypot(s.x + s.w / 2 - (seat.x + 0.5) * 32, s.y + s.h / 2 - (seat.y + 0.5) * 32) < 96, `화면-좌석 거리 ${s.seatId}`);
  }
  const monitorSeats = room.screens.filter((s) => s.kind === 'monitor').map((s) => room.seats.find((q) => q.id === s.seatId));
  assert.deepEqual(monitorSeats.map((q) => [q.x, q.y, q.kind]), [[15, 14, 'chair_n'], [30, 14, 'chair_n']]);

  assert.deepEqual(room.interactables.map((i) => i.id).sort(), ['coffee', 'music']);
  for (const it of room.interactables) {
    const tx = Math.floor(it.x / 32);
    const ty = Math.floor((it.y - 1) / 32);
    assert.ok(!isBlocked(room, tx, ty), `${it.id} 지점 (${tx},${ty}) 이 막혀 있음`);
    assert.ok(it.hint);
    assert.equal(it.range, 56);
  }
  const coffee = room.interactables.find((i) => i.id === 'coffee');
  assert.deepEqual([Math.floor(coffee.x / 32), Math.floor((coffee.y - 1) / 32)], [6, 15], '커피머신(6,13~14) 바로 앞');
});
