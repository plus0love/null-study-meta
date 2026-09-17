'use strict';
/**
 * "공용 야외" (12단계) — 모든 스터디가 공유하는 80x50 타일 맵. Socket.io room 은 'outdoor' 하나.
 *
 * 구성 (타일 좌표, x 0..79 · y 0..49)
 *   y 0..2    하늘 띠 (통과 불가, 클라이언트가 시간대 그라데이션 + 밤 별)
 *   y 3..12   뒤쪽 언덕 (전망대 데크 x 35..40 · 망원경 · 침엽수), y 12 능선
 *   y 13..20  스터디룸 건물 외벽 x 18..46 (이중문 x 27..36, 문 타일 (31,19)(32,19) → 스터디로 복귀)
 *   y 21..25  건물 앞 보도 (매트·볼라드·화단·벤치) + 연석
 *   y 26..36  광장 x 14..47 (분수 3x3 애니 · 가로등 4 · 벤치 · 전광판 x 43..47 · 카트 정류장 x 45..46)
 *   좌측/하단 공원 (잔디 3톤 · 나무 3종 · 연못 x 3..10 y 39..45 · 산책로 · 피크닉 테이블 · 꽃 · 돌)
 *   우측 트랙 x 48..78 · y 13..48: 폭 3 둥근 사각 흙길(모서리 반지름 8), 출발선 (48..50, 31), 시계 방향(왼쪽 직선에서 위로),
 *     체크포인트 3개(위·오른쪽·아래 직선 가운데), 관중 벤치는 트랙 안쪽 섬. 한 바퀴 중심선 약 120타일.
 * 문(doors[].to): 'studyroom' 이면 자기 스터디로 복귀. spawn 은 이중문 앞 보도.
 * room.track: 랩 판정 정의 (server/game/track.js). room.outdoor = true.
 */
const { RoomBuilder, TILE } = require('./build');

const W = 80;
const H = 50;
const TRACK = { x0: 48, x1: 78, y0: 13, y1: 48, width: 3, radius: 8 };
const SANS = { font: 'sans' };

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

function buildOutdoor() {
  const b = new RoomBuilder({ id: 'outdoor', name: '공용 야외', width: W, height: H });
  const pick = (list, x, y) => list[((x * 7 + y * 13) % list.length + list.length) % list.length];
  const GRASS = ['grass_a0', 'grass_b0', 'grass_a1', 'grass_c0', 'grass_b1', 'grass_a0', 'grass_c1', 'grass_a1'];

  // ── 바닥 ─────────────────────────────────────────────────────────────
  b.fill('sky', 0, 0, W - 1, 2);
  b.window(0, 0, W, 3.5);
  b.fill(['hill_a', 'hill_b', 'hill_a', 'hill_a'], 0, 3, W - 1, 11);
  b.fill('hill_edge', 0, 12, W - 1, 12);
  // 잔디 3톤을 해시로 섞는다 (fill 의 규칙적인 줄무늬를 피한다)
  for (let y = 13; y < H; y++) for (let x = 0; x < W; x++) b.place(GRASS[(((x * 73856093) ^ (y * 19349663)) >>> 0) % GRASS.length], x, y);
  // 트랙 (둥근 사각 흙길 — 가장자리 셀은 진한 흙)
  for (let y = TRACK.y0; y <= TRACK.y1; y++) {
    for (let x = TRACK.x0; x <= TRACK.x1; x++) {
      const d = trackDistance(x, y);
      if (d >= 0 || d < -TRACK.width) continue;
      b.place(d > -1 || d < -(TRACK.width - 1) ? 'dirt_b' : 'dirt_a', x, y);
    }
  }
  for (let x = 48; x <= 50; x++) b.place('start_line', x, 31);
  // 건물
  b.fill('facade', 18, 13, 46, 18);
  for (let x = 18; x <= 46; x++) b.place('wall_top', x, 13);
  // 보도 · 연석 · 광장
  b.fill(['paver_0', 'paver_1'], 14, 21, 47, 24);
  b.fill('kerb', 14, 25, 47, 25);
  b.fill(['plaza_a', 'plaza_b', 'plaza_a'], 14, 26, 47, 36);
  for (let y = 28; y <= 32; y++) for (let x = 30; x <= 34; x++) if (x === 30 || x === 34 || y === 28 || y === 32) b.place('plaza_ring', x, y);
  b.place('doormat_big', 28, 21);
  // 전망대 데크
  b.fill(['deck_a', 'deck_b'], 35, 5, 40, 8, { checker: true });
  // 산책로: 광장 서쪽 → 공원 → 연못, 광장 남쪽 → 공원 아래
  for (let x = 5; x <= 13; x++) b.place(pick(['stone_path_a', 'stone_path_b'], x, 31), x, 31);
  for (let y = 32; y <= 38; y++) b.place(pick(['stone_path_a', 'stone_path_b'], 5, y), 5, y);
  for (let y = 37; y <= 44; y++) b.place(pick(['stone_path_a', 'stone_path_b'], 32, y), 32, y);
  for (let x = 14; x <= 17; x++) b.place('stone_path_a', x, 40);
  // 연못 x 3..10, y 39..45 (물가 8방향 + 안쪽 물 2프레임 체크)
  for (let y = 39; y <= 45; y++) {
    for (let x = 3; x <= 10; x++) {
      const n = y === 39 ? 'N' : y === 45 ? 'S' : '';
      const e = x === 10 ? 'E' : x === 3 ? 'W' : '';
      const sides = n + e;
      if (sides) b.place(`shore_${sides}`, x, y);
      else b.place((x + y) % 2 ? 'water_f1' : 'water_f0', x, y);
    }
  }

  // ── 언덕: 전망대 · 망원경 · 침엽수 · 돌 ──────────────────────────────
  for (const x of [35, 36, 38, 39, 40]) b.place('railing_h', x, 5);
  b.place('telescope', 37, 4);
  for (let y = 6; y <= 8; y++) { b.place('railing_v', 35, y); b.place('railing_v', 40, y); }
  for (const [x, y] of [[3, 4], [9, 7], [16, 4], [23, 7], [55, 5], [62, 8], [69, 4], [75, 7]]) b.place('tree_pine', x, y);
  for (const [x, y] of [[28, 9], [48, 10], [12, 10], [66, 10]]) b.place('rock_a', x, y);
  b.place('rock_b', 43, 9);
  b.label(38, 9.6, 'OBSERVATORY', { ...SANS, size: 8, weight: 600, color: '#efe6d6', spacing: 1 });

  // ── 건물 앞: 이중문 · 매트 · 볼라드 · 화분 · 화단 · 벤치 ─────────────────
  b.place('entrance_wide', 27, 19);
  b.setSolid(31, 19, 32, 20, false);
  b.doors.push({ id: 'exit', x: 31, y: 19, to: 'studyroom' }, { id: 'exit', x: 32, y: 19, to: 'studyroom' });
  b.light(27.5, 19.3, 2.8, 0xffc46a, 0.55);
  b.light(36.5, 19.3, 2.8, 0xffc46a, 0.55);
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
  b.place('sign_left', 18, 14);
  b.label(19.5, 16.1, 'Same\nPlace\nBrighter\nUs\n♡', { ...SANS, size: 9, color: '#efe6d6', lineHeight: 1.25 });
  b.place('sign_right', 44, 14);
  b.label(45.5, 16.1, 'Good\nIdeas\nStart\nHere\n→', { ...SANS, size: 9, color: '#efe6d6', lineHeight: 1.25 });
  b.label(32, 15.5, 'STUDY ROOM', { ...SANS, size: 16, weight: 700, color: '#efe6d6', spacing: 2 });

  // ── 광장: 분수 · 가로등 · 벤치 · 전광판 · 카트 정류장 ────────────────────
  b.place('fountain_f0', 31, 29);
  b.light(32.5, 30.5, 3.2, 0x9fd0ff, 0.3);
  for (const [x, y] of [[17, 27], [46, 27], [17, 34], [46, 34], [24, 36], [39, 36]]) {
    b.place('lamp_post', x, y);
    b.light(x + 0.5, y + 0.3, 3.2, 0xffd48a, 0.55);
  }
  b.place('bench_park', 26, 30);
  b.place('bench_park', 36, 30);
  b.place('bench_park', 31, 34);
  b.place('plant_bush_0', 14, 26);
  b.place('plant_bush_1', 47, 36);
  b.place('trash_bin', 15, 36);
  b.place('scoreboard', 42, 26);
  b.light(44.5, 27, 3.4, 0xffb85c, 0.4);
  b.interactable('board', 'board', 44.5, 30, { hint: '기록 보기', range: 64 });
  b.place('kart_stop', 45, 31);
  b.label(46, 32.3, 'KART', { ...SANS, size: 7, weight: 700, color: '#ffb85c', spacing: 1 });
  b.interactable('kartstop', 'shop', 46, 34, { hint: '탈것 상점', range: 56 });

  // ── 공원: 나무 · 피크닉 · 꽃 · 돌 ─────────────────────────────────────
  for (const [x, y] of [[1, 14], [9, 14], [2, 22], [10, 26], [1, 33], [20, 39], [27, 41], [40, 39], [12, 46], [44, 45]]) b.place('tree_round', x, y);
  for (const [x, y] of [[6, 27], [44, 40], [22, 45], [1, 46]]) b.place('tree_pine', x, y);
  for (const [x, y] of [[12, 18], [8, 35], [24, 46], [36, 47], [47, 38], [15, 43], [1, 29]]) b.place('tree_small', x, y);
  b.place('picnic_table', 2, 17);
  b.place('picnic_table', 8, 21);
  b.place('picnic_table', 36, 44);
  b.place('bench_park', 12, 36);
  b.place('bench_park', 12, 42);
  for (const [x, y] of [[4, 15], [7, 19], [12, 15], [3, 26], [9, 29], [13, 33], [2, 37], [12, 38], [18, 43], [25, 39], [30, 40], [38, 42], [41, 47], [17, 47], [7, 47], [45, 43]]) b.place(`flower_${(x + y) % 3}`, x, y);
  for (const [x, y] of [[11, 24], [3, 35], [28, 47], [46, 48]]) b.place('rock_a', x, y);
  b.place('rock_b', 14, 46);
  // 트랙 안 섬: 관중 벤치 · 나무 · 돌
  for (const y of [27, 30, 33, 36]) b.place('stand_bench', 52, y);
  b.place('tree_round', 62, 22);
  b.place('tree_round', 62, 38);
  b.place('tree_small', 70, 30);
  b.place('rock_a', 56, 20);
  b.place('rock_a', 70, 42);
  b.place('lamp_post', 66, 30);
  b.light(66.5, 30.3, 3.2, 0xffd48a, 0.5);
  b.place('lamp_post', 75, 12);
  b.light(75.5, 12.3, 3.2, 0xffd48a, 0.5);

  b.setSpawn(31, 22);
  const room = b.build();
  room.outdoor = true;
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

let cached = null;
function getOutdoor() {
  if (!cached) cached = buildOutdoor();
  return cached;
}

module.exports = { buildOutdoor, getOutdoor, isTrackCell, trackDistance, TRACK };
