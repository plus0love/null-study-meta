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

test('의자/푸프/소파 좌석 20개 (2인 스터디룸 의자 2 + 2인 소파 2), 모두 통과 가능, 옛 좌석 id 별칭', () => {
  assert.equal(room.seats.length, 20);
  assert.deepEqual(room.seats.filter((s) => s.id.startsWith('study')).map((s) => [s.id, s.x, s.y, s.kind]), [['study-a', 21, 14, 'chair_n'], ['study-b', 23, 14, 'chair_n'], ['study-sofa-a', 26, 19, 'sofa_love_n'], ['study-sofa-b', 27, 19, 'sofa_love_n']]); // 17단계: 위를 보는 소파가 아래 벽
  assert.deepEqual(room.seatAliases, { 'study1-l': 'study-l', 'seat-8': 'study-a', 'seat-9': 'study-b' }, '옛 방 A/B 의자 id 는 별칭으로 남는다');
  assert.deepEqual(room.seats.find((s) => s.id === 'study-a').slots, [{ tx: 20, ty: 12 }, { tx: 20, ty: 13 }, { tx: 19, ty: 13 }]);
  for (const s of room.seats) assert.ok(!isBlocked(room, s.x, s.y), `좌석 ${s.id} (${s.x},${s.y})`);
  const facings = new Set(room.seats.map((s) => s.facing));
  for (const f of facings) assert.ok(['up', 'down', 'left', 'right'].includes(f));
});

test('유리문·입구는 통과 가능, 유리벽은 통과 불가', () => {
  for (const d of room.doors) assert.ok(!isBlocked(room, d.x, d.y), `문 ${d.id}`);
  assert.ok(room.doors.some((d) => d.id === 'study-l'));
  assert.ok(room.doors.some((d) => d.id === 'study-r'));
  assert.ok(room.doors.some((d) => d.id === 'entrance'));
  // 2인 스터디룸의 좌우 유리벽 (18단계: x 14 / 30, 가운데 y 16..17 은 문)
  for (let y = 12; y <= 20; y++) {
    if (y === 16 || y === 17) { assert.ok(!isBlocked(room, 14, y) && !isBlocked(room, 30, y), `좌우 문 (${y})`); continue; }
    assert.ok(isBlocked(room, 14, y));
    assert.ok(isBlocked(room, 30, y));
  }
});

test('스폰에서 모든 좌석·문·바깥까지 걸어서 도달 가능', () => {
  const tx = Math.floor(room.spawn.x / room.tileSize);
  const ty = Math.floor((room.spawn.y - 1) / room.tileSize);
  const reach = bfs(room, tx, ty);
  for (const s of room.seats) assert.ok(reach.has(`${s.x},${s.y}`), `좌석 ${s.kind} (${s.x},${s.y}) 도달 불가`);
  for (const d of room.doors) assert.ok(reach.has(`${d.x},${d.y}`), `문 ${d.id} 도달 불가`);
  assert.ok(reach.has('22,28'), '입구 밖 매트 도달 불가');
  // 스터디룸 안쪽 (책상 앞 · 소파 앞 · 왼쪽 구석 · 커튼 옆 통로)
  assert.ok(reach.has('22,15'));
  assert.ok(reach.has('26,18'));
  assert.ok(reach.has('16,17'));
  assert.ok(reach.has('15,20'));
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
  assert.ok(room.labels.length >= 8);
  const texts = room.labels.map((l) => l.text).join('|');
  for (const t of ['Good', 'Study', 'FOCUS', 'Music', 'COFFEE', 'Small Steps', 'WELCOME']) assert.match(texts, new RegExp(t));
  assert.doesNotMatch(texts, /수빈|선아/, '문 명패 글자는 타일·라벨이 아니라 스터디 설정(roomLabel)으로 클라이언트가 그린다');
  assert.deepEqual(room.anchors.nameplate, { x: 21 * 32, y: Math.round(19.05 * 32) });
  assert.deepEqual(room.anchors.corkboard, { x: Math.round(22.5 * 32), y: Math.round(11.05 * 32), seats: ['study-a', 'study-b'] });
  for (const l of room.labels) {
    assert.ok(['hand', 'sans'].includes(l.font));
    assert.ok(l.x >= 0 && l.x <= room.width * 32 && l.y >= 0 && l.y <= room.height * 32);
  }
});

test('식물은 3단계 정리 후 7~12개 (창가 양끝·스터디룸·입구·회의 구역 — 17단계 동선 수정으로 커피 코너 통로의 화분은 뺐다), 벽 덩굴은 창문 좌우 2개뿐', () => {
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
  assert.ok(plants >= 7 && plants <= 12, `식물 ${plants}개`);
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

test('2인 유리 스터디룸: 프레임 기둥·유리 판·2타일 열린 문·슬라이딩 패널·커튼, 구역(zone) 1개', () => {
  const { objects } = TILES;
  const at = (x, y) => room.layers.furniture[y][x];
  const idx = (name) => objects[name].tiles[0][0];
  // 세로 유리벽 (x 14 / 30): 3타일마다 기둥. 18단계: 가운데 세로 슬라이딩 패널(y 14..15) + 열린 문 2칸(y 16..17)
  for (let y = 12; y <= 20; y++) {
    for (const x of [14, 30]) {
      if (y === 14) { assert.equal(at(x, y), objects.study_panel_v.tiles[0][0], `(${x},${y}) 세로 패널`); continue; }
      if (y === 15) { assert.equal(at(x, y), objects.study_panel_v.tiles[1][0]); continue; }
      if (y === 16 || y === 17) { assert.equal(at(x, y), idx('door_open_v')); assert.ok(!isBlocked(room, x, y)); continue; }
      assert.equal(at(x, y), idx((y - 12) % 3 === 0 ? 'gpost_NS' : 'glass_NS'), `(${x},${y})`);
    }
  }
  for (const [x, id] of [[14, 'study-w-a'], [30, 'study-e-a']]) assert.ok(room.doors.some((d) => d.id === id && d.x === x && d.y === 16), id);
  assert.equal(at(14, 21), idx('gpost_NE'));
  assert.equal(at(30, 21), idx('gpost_NW'));
  // 슬라이딩 문 패널 2x4 (x 20..21, y 18..21), 통과 불가. 열린 문 2타일은 패널 바로 옆 (22..23), 그 옆은 기둥
  assert.equal(objects.study_panel_1.w, 2);
  assert.equal(objects.study_panel_1.h, 4);
  assert.equal(at(20, 21), objects.study_panel_1.tiles[3][0]);
  assert.equal(at(21, 21), objects.study_panel_1.tiles[3][1]);
  assert.ok(isBlocked(room, 20, 21) && isBlocked(room, 21, 21) && isBlocked(room, 20, 18) && isBlocked(room, 21, 20));
  for (const [x, id] of [[22, 'study-l'], [23, 'study-r']]) {
    assert.equal(at(x, 21), idx('door_open'));
    assert.ok(!isBlocked(room, x, 21));
    assert.ok(room.doors.some((d) => d.id === id && d.x === x && d.y === 21), id);
  }
  assert.equal(at(24, 21), idx('gpost_W'));
  for (const x of [15, 16, 18, 19, 25, 26, 28, 29]) assert.equal(at(x, 21), idx('glass_EW'));
  assert.equal(at(17, 21), idx('gpost_EW'));
  assert.equal(at(27, 21), idx('gpost_EW'));
  // 위쪽 벽(y 10..11)은 x 14..30 전부 벽면, 덩굴 없음. 그 밖(12..13, 31..33)은 복도 바닥
  for (const x of [12, 13, 31, 32, 33]) assert.equal(at(x, 10), -1, `복도 (${x},10)`);
  for (let x = 14; x <= 30; x++) {
    assert.notEqual(at(x, 10), -1, `(${x},10)`);
    assert.notEqual(room.layers.top[10][x], idx('wall_vine'));
  }
  // 긴 책상 7x2 · 의자 2 (사이 1타일) · 협탁 2 · 위를 보는 2인 소파(아래 벽) · 왼쪽 벽 화이트보드·2단 책장 · 코르크보드 (17단계)
  assert.equal(at(19, 12), objects.desk_long.tiles[0][0]);
  assert.equal(at(25, 13), objects.desk_long.tiles[1][6]);
  assert.equal(at(21, 14), idx('chair_n'));
  assert.equal(at(23, 14), idx('chair_n'));
  assert.equal(at(22, 14), -1, '의자 사이 1타일');
  assert.equal(at(18, 12), idx('nightstand_books'));
  assert.equal(at(26, 12), idx('nightstand_lamp'));
  assert.equal(at(25, 19), objects.sofa_love_n.tiles[0][0]);
  assert.equal(at(28, 20), objects.sofa_love_n.tiles[1][3]);
  assert.equal(at(16, 13), objects.bookcase_2tier.tiles[0][0]);
  assert.equal(room.props.filter((p) => p.name === 'whiteboard_small' || p.name === 'mini_fridge' || p.name === 'low_table_study').length, 0, '18단계: 화이트보드·미니 냉장고·낮은 테이블 제거');
  assert.equal(room.layers.floor[14][19], objects.rug_study_grid.tiles[0][0]);
  assert.equal(room.layers.floor[17][25], objects.rug_study_grid.tiles[3][6]);
  assert.equal(at(21, 10), objects.corkboard.tiles[0][0]);
  // 유리벽 안쪽 커튼 (top 레이어, 통과 가능)
  assert.equal(room.layers.top[12][15], idx('curtain_top'));
  assert.equal(room.layers.top[15][15], idx('curtain_end'));
  assert.equal(room.layers.top[18][15], idx('curtain_rail'));
  assert.ok(!isBlocked(room, 15, 13));
  // 통로 러너는 방 앞 가로
  assert.equal(room.layers.floor[22][18], objects.rug_runner_h.tiles[0][0]);
  assert.equal(room.layers.floor[23][27], objects.rug_runner_h.tiles[1][9]);
  assert.equal(room.zones.length, 1);
  assert.deepEqual(room.zones[0], { id: 'study', kind: 'glass', x: 15 * 32, y: 12 * 32, w: 15 * 32, h: 9 * 32, bright: 0.6 });
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
  assert.deepEqual(monitorSeats.map((q) => [q.id, q.x, q.y, q.kind]), [['study-a', 21, 14, 'chair_n'], ['study-b', 23, 14, 'chair_n']]);

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
