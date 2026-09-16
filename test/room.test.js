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
  assert.ok(topCount > 20);
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
  for (const t of ['Good', 'Study', 'FOCUS', 'Music', 'COFFEE', '수빈s ROOM', '선아s ROOM', 'Small Steps', 'WELCOME']) assert.match(texts, new RegExp(t));
  for (const l of room.labels) {
    assert.ok(['hand', 'sans'].includes(l.font));
    assert.ok(l.x >= 0 && l.x <= room.width * 32 && l.y >= 0 && l.y <= room.height * 32);
  }
});

test('식물이 30개 이상, 창문은 3프레임 애니메이션', () => {
  const { objects, animTiles } = TILES;
  const plantTiles = new Set();
  for (const [name, o] of Object.entries(objects)) {
    if (/^(plant_|wall_vine)/.test(name)) plantTiles.add(o.tiles[o.h - 1][0]);
  }
  let plants = 0;
  for (const layer of ['furniture', 'top']) for (const row of room.layers[layer]) for (const idx of row) if (plantTiles.has(idx)) plants++;
  assert.ok(plants >= 30, `식물 ${plants}개`);
  const f0 = objects.window_l_f0.tiles[0][0];
  const f1 = animTiles[String(f0)];
  const f2 = animTiles[String(f1)];
  assert.equal(animTiles[String(f2)], f0);
});
