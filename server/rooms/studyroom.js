'use strict';
/**
 * "우리의 스터디룸" — design/studyroom.png 구도를 46x34 타일로 옮긴 방.
 *
 * 좌표는 타일 단위 (x 0..45, y 0..33). 목업을 46x34 격자로 나눠 읽은 위치를 그대로 쓴다.
 *   y 0      상단 벽 캡            y 1..2   벽면(보드·창문·책장이 여기서 시작)
 *   y 3..24  실내 바닥             y 25     하단 벽 + 입구
 *   y 26..30 바깥 보도             y 31     연석,  y 32..33 화단
 *   x 0 / 45 건물 외벽면(통과 불가), x 1 / 44 좌우 벽
 */
const { RoomBuilder } = require('./build');

function buildStudyRoom() {
  const b = new RoomBuilder({ id: 'studyroom', name: '우리의 스터디룸', width: 46, height: 34 });

  // ── 바닥 ───────────────────────────────────────────────────────────
  b.fill(['floor_wood_0', 'floor_wood_0', 'floor_wood_1', 'floor_wood_0', 'floor_wood_0', 'floor_wood_0', 'floor_wood_2'], 2, 1, 43, 24);
  b.fill('facade', 0, 0, 0, 25);
  b.fill('facade', 45, 0, 45, 25);
  b.fill(['paver_0', 'paver_1'], 0, 26, 45, 30);
  b.fill('kerb', 0, 31, 45, 31);
  b.fill(['grass_0', 'grass_1'], 0, 32, 45, 33);

  // ── 외벽 ───────────────────────────────────────────────────────────
  b.fill('wall_top', 1, 0, 44, 0);
  b.fill('wall_l', 1, 1, 1, 25);
  b.fill('wall_r', 44, 1, 44, 25);
  b.fill('wall_top', 2, 25, 43, 25);
  for (let x = 2; x <= 43; x++) b.place('wall_face', x, 1);

  // ── 상단 좌: 칠판 + 프린터 수납장 + 좁은 책장/식물 ───────────────────
  b.place('shelf_narrow_a', 2, 3);
  b.place('shelf_narrow_b', 2, 5);
  b.place('plant_tall_1', 2, 7);
  b.place('plant_tall_0', 3, 8);
  b.place('chalkboard_big', 4, 1);
  b.light(7.5, 1.2, 3.2, 0xffc46a, 0.6);
  b.place('cabinet_printer', 4, 7);
  b.place('wall_picture_b', 13, 1);
  b.place('shelf_narrow_c', 11, 3);
  b.place('plant_tall_2', 11, 5);
  b.place('plant_tall_3', 13, 4);
  b.place('plant_small_b', 12, 7);

  // ── 상단 중앙: 야경 창문 (펜던트 5개) + 라운지 ───────────────────────
  b.place('window_l', 15, 1);
  const lampCols = new Set([17, 19, 21, 23, 25]);
  let mi = 0;
  for (let x = 16; x <= 25; x++) {
    b.place(lampCols.has(x) ? `window_m_lamp_${mi % 4}` : `window_m_${mi % 4}`, x, 1);
    mi++;
  }
  b.place('window_r', 26, 1);
  b.place('plant_hanging', 15, 1);
  b.place('plant_hanging', 16, 1);
  for (const x of lampCols) b.light(x, 2.4, 2.6, 0xffb85c, 0.55);

  b.place('standing_lamp', 16, 5);
  b.light(16, 5.2, 3.2, 0xffc46a, 0.6);
  b.place('sofa_wide', 17, 5);
  b.place('plant_tall_0', 25, 5);
  b.place('plant_small_a', 26, 6);
  b.place('rug_lounge', 16, 7);
  b.place('round_table', 19, 8);
  b.light(20.5, 8.5, 3.0, 0xffc46a, 0.3);
  b.place('dog', 23, 8);

  // ── 상단 중앙 우: FOCUS/PLAN/STUDY/GROW 세로 표지판 ─────────────────
  b.place('board_focus_tall', 27, 1);

  // ── 상단 우: 큰 책장 + 화분 ─────────────────────────────────────────
  b.place('bookshelf_big', 31, 1);
  b.light(33, 2.2, 1.8, 0xffc46a, 0.3);
  b.light(36, 2.2, 1.8, 0xffc46a, 0.3);
  b.place('plant_tall_1', 38, 5);
  b.place('plant_small_a', 39, 7);

  // ── 우측 세로 벽: 유리 패널 "Music Always Helps" + 식물 ─────────────
  b.place('music_panel', 40, 1);
  b.light(41.5, 1.2, 3.4, 0xffc46a, 0.55);
  b.place('plant_tall_2', 43, 9);
  b.place('plant_tall_3', 39, 9);

  // ── 좌측: 커피 코너 ────────────────────────────────────────────────
  b.place('shelf_narrow_a', 2, 10);
  b.place('shelf_narrow_b', 2, 12);
  b.place('shelf_narrow_c', 2, 14);
  b.place('plant_tall_0', 2, 16);
  b.light(2.5, 11, 1.6, 0xffc46a, 0.4);
  b.light(2.5, 15, 1.6, 0xffc46a, 0.4);
  b.place('plant_tall_1', 3, 12);
  b.place('plant_small_b', 3, 15);
  b.place('menu_board_cream', 4, 10);
  b.place('counter_plates', 4, 14);
  b.place('counter_b', 5, 14);
  b.place('coffee_machine', 6, 13);
  b.place('counter_jars', 7, 14);
  b.place('display_case', 4, 15);
  b.light(5.5, 15.5, 2.2, 0xffd48a, 0.35);
  b.light(6.5, 12.5, 2.6, 0xffc46a, 0.45);
  b.place('plant_tall_2', 8, 12);
  b.place('rug_coffee', 4, 17);

  // ── 좌하단: 푸프 라운지 ────────────────────────────────────────────
  b.place('shelf_narrow_a', 2, 18);
  b.place('shelf_narrow_c', 2, 20);
  b.place('shelf_narrow_b', 2, 22);
  b.light(2.5, 21, 1.6, 0xffc46a, 0.4);
  b.place('rug_pouf', 4, 19);
  b.place('pouf_cream', 5, 20);
  b.place('pouf_cream', 5, 21);
  b.place('pouf_green', 5, 23);
  b.place('pouf_green', 7, 20);
  b.place('side_table_round', 7, 22);
  b.light(6.5, 21.5, 3.0, 0xffc46a, 0.35);

  // ── 중앙: 유리 스터디룸 2개 ─────────────────────────────────────────
  // 방 A: x 11..20, 방 B: x 25..34 (B 는 A 의 좌우 대칭, x' = 45 - x)
  const studyRoom = (mirror, panelName, doorId) => {
    const X = (x) => (mirror ? 45 - x : x);
    // 위쪽 벽 (액자·선반·스팟 조명)
    for (let x = 11; x <= 20; x++) b.place('wall_face', X(x), 10);
    b.place('wall_picture_a', X(12), 10);
    b.place('wall_lamp', X(14), 10);
    b.place('wall_shelf', X(15), 10);
    b.place('wall_shelf', X(16), 10);
    b.place('wall_lamp', X(17), 10);
    b.place('wall_picture_c', X(19), 10);
    b.light(X(14) + 0.5, 11.5, 2.6, 0xffc46a, 0.5);
    b.light(X(17) + 0.5, 11.5, 2.6, 0xffc46a, 0.5);
    // 유리벽
    for (let y = 12; y <= 20; y++) {
      b.place('glass_NS', X(11), y);
      b.place('glass_NS', X(20), y);
    }
    b.place(mirror ? 'glass_NW' : 'glass_NE', X(11), 21);
    b.place(mirror ? 'glass_NE' : 'glass_NW', X(20), 21);
    b.place('glass_EW', X(15), 21);
    b.place('glass_EW', X(18), 21);
    b.place('glass_EW', X(19), 21);
    // 미닫이 유리문 (2타일) — 통과 가능
    const doorX = mirror ? [X(17), X(16)] : [16, 17];
    b.place('glass_door_l', doorX[0], 21, { doorId: `${doorId}-l` });
    b.place('glass_door_r', doorX[1], 21, { doorId: `${doorId}-r` });
    b.light(doorX[0] + 1, 21.5, 2.0, 0xffb85c, 0.45);
    // 이름 패널 (STUDY 1 / STUDY 2)
    b.place(panelName, mirror ? X(14) : 12, 18);
    // 가구
    b.place('desk_monitor', mirror ? X(16) : 14, 12);
    b.place('chair_n', X(15), 13);
    b.place('nightstand', X(12), 13);
    b.place('nightstand', X(18), 13);
    b.light(X(18) + 0.5, 13.3, 1.5, 0xffd48a, 0.35);
    b.place('rug_study', mirror ? X(18) : 15, 15);
    b.place('plant_tall_2', X(12), 15);
    b.place('plant_tall_3', X(18), 16);
  };
  studyRoom(false, 'study_panel_1', 'study1');
  studyRoom(true, 'study_panel_2', 'study2');
  b.place('rug_corridor', 22, 12);
  b.light(23, 16.5, 3.0, 0xffc46a, 0.28);
  b.light(23, 23, 3.0, 0xffc46a, 0.25);

  // ── 우측: 화이트보드 + 회의 테이블 8석 ──────────────────────────────
  b.place('ladder_shelf', 35, 10);
  b.place('plant_tall_0', 35, 14);
  b.place('whiteboard_big', 37, 11);
  b.place('rug_meeting', 36, 15);
  b.place('big_table_v', 37, 16);
  b.light(38.5, 18.5, 3.4, 0xffc46a, 0.4);
  b.light(39.5, 12.2, 2.6, 0xffc46a, 0.35);
  b.place('chair_s', 38, 15);
  b.place('chair_s', 39, 15);
  for (const y of [17, 19, 21]) {
    b.place('chair_e', 36, y);
    b.place('chair_w', 41, y);
  }
  b.place('plant_tall_1', 43, 15);
  b.place('plant_tall_2', 43, 22);
  b.light(43.5, 12, 1.8, 0xffc46a, 0.45);
  b.light(43.5, 18, 1.8, 0xffc46a, 0.45);
  b.light(43.5, 20.5, 1.8, 0xffc46a, 0.4);

  // ── 하단: 입구 + 바깥 ──────────────────────────────────────────────
  b.place('entrance_wide', 18, 25);
  b.setSolid(22, 25, 23, 26, false); // 유리문 가운데는 통과 가능 (바깥은 장식, 추후 실외 연결)
  b.doors.push({ id: 'entrance', x: 22, y: 25, to: null }, { id: 'entrance', x: 23, y: 25, to: null });
  b.light(18.5, 25.3, 2.6, 0xffc46a, 0.55);
  b.light(27.5, 25.3, 2.6, 0xffc46a, 0.55);
  b.place('doormat_big', 20, 27);
  b.place('bollard', 16, 27);
  b.place('bollard', 30, 27);
  b.light(16.5, 27.6, 2.2, 0xffc46a, 0.5);
  b.light(30.5, 27.6, 2.2, 0xffc46a, 0.5);
  b.place('plant_tall_3', 17, 27);
  b.place('plant_tall_1', 28, 27);
  b.fill(['hedge_0', 'hedge_1', 'hedge_flower_0'], 5, 26, 15, 27);
  b.fill(['hedge_1', 'hedge_0', 'hedge_flower_1'], 31, 26, 40, 27);
  b.place('bench', 9, 28);
  b.place('bench', 32, 28);
  b.fill(['hedge_flower_0', 'hedge_flower_1'], 10, 30, 12, 30);
  b.fill(['hedge_flower_1', 'hedge_flower_0'], 33, 30, 35, 30);
  b.place('sign_left', 1, 26);
  b.place('sign_right', 42, 26);

  b.setSpawn(22, 23);
  return b.build();
}

let cached = null;
function getStudyRoom() {
  if (!cached) cached = buildStudyRoom();
  return cached;
}

module.exports = { buildStudyRoom, getStudyRoom };
