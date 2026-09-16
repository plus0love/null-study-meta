'use strict';
/**
 * "우리의 스터디룸" — design/studyroom.png 구도를 46x34 타일로 옮긴 방.
 *
 * 좌표는 타일 단위 (x 0..45, y 0..33). 목업을 46x34 격자로 나눠 읽은 위치를 그대로 쓴다.
 *   y 0      상단 벽 캡 (창문은 여기서 시작)   y 1..2   벽면(몰딩·보드·책장이 여기서 시작)
 *   y 3..24  실내 바닥                          y 25     하단 벽 + 입구
 *   y 26..30 바깥 보도                          y 31     연석,  y 32..33 화단
 *   x 0 / 45 건물 외벽면(통과 불가), x 1 / 44 좌우 벽
 *
 * 보드/표지판 글자는 타일에 굽지 않고 labels 로 내려보내 클라이언트가 웹폰트로 그린다.
 */
const { RoomBuilder } = require('./build');

const HAND = { font: 'hand' };
const SANS = { font: 'sans' };

function buildStudyRoom() {
  const b = new RoomBuilder({ id: 'studyroom', name: '우리의 스터디룸', width: 46, height: 34 });

  // ── 바닥: 널빤지 3톤 + 이음새 ───────────────────────────────────────
  b.fill(['floor_0', 'floor_1', 'floor_0', 'floor_2', 'floor_0_seam', 'floor_1', 'floor_2_seam', 'floor_0', 'floor_1_seam', 'floor_2'], 2, 1, 43, 24);
  b.fill(['floor_0_shadow', 'floor_1_shadow', 'floor_2_shadow'], 2, 3, 43, 3); // 상단 벽 아래 그림자
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
  b.place('wall_frames_b', 2, 1);
  b.place('wall_vine', 3, 1);
  b.place('shelf_narrow_a', 2, 3);
  b.place('shelf_narrow_b', 2, 5);
  b.place('plant_tall_1', 2, 7);
  b.place('plant_palm_0', 3, 8);
  b.place('chalkboard_big', 4, 1);
  b.label(7.5, 4.0, 'Good\nStudy\nBetter\nTomorrow', { ...HAND, size: 24, color: '#e8dcc4', lineHeight: 0.98 });
  b.label(9.4, 6.15, '♡', { ...SANS, size: 12, color: '#d9a98f' });
  b.light(7.5, 1.2, 3.4, 0xffc46a, 0.6);
  b.place('cabinet_printer', 4, 7);
  b.place('wall_frames_a', 11, 1);
  b.place('wall_clock', 12, 1);
  b.place('wall_picture_b', 13, 1);
  b.place('shelf_narrow_c', 11, 3);
  b.place('plant_tall_2', 11, 5);
  b.place('plant_tall_3', 13, 4);
  b.place('plant_bush_0', 12, 7);
  b.place('plant_small_b', 13, 7);

  // ── 상단 중앙: 야경 창문 (14타일 폭, 5타일 높이, 펜던트 5개) ─────────
  b.place('window_l_f0', 14, 0);
  const lampCols = new Set([16, 18, 21, 23, 25]);
  let mi = 0;
  for (let x = 15; x <= 26; x++) {
    b.place(lampCols.has(x) ? `window_m_lamp_${mi % 4}_f0` : `window_m_${mi % 4}_f0`, x, 0);
    mi++;
  }
  b.place('window_r_f0', 27, 0);
  b.place('wall_vine', 14, 1);
  b.place('wall_vine', 15, 1);
  for (const x of lampCols) b.light(x + 0.5, 1.9, 2.8, 0xffb85c, 0.5);

  // ── 라운지 ─────────────────────────────────────────────────────────
  b.place('standing_lamp', 16, 5);
  b.light(16.5, 5.2, 3.4, 0xffc46a, 0.55);
  b.place('sofa_wide', 17, 5);
  b.place('plant_tall_0', 23, 5);
  b.place('plant_bush_1', 24, 6);
  b.place('plant_small_a', 25, 6);
  b.place('rug_lounge', 16, 7);
  b.place('round_table', 19, 8);
  b.light(21, 8.5, 3.2, 0xffc46a, 0.3);
  b.place('cushion', 24, 9); // 강아지 쿠션 — NPC 가 여기서 잔다 (server/game/npc.js)
  b.place('plant_bush_0', 26, 9);

  // ── 상단 중앙 우: FOCUS/PLAN/STUDY/GROW 세로 표지판 ─────────────────
  b.place('board_focus_tall', 28, 1);
  b.label(30, 3.5, 'FOCUS\nPLAN\nSTUDY\nGROW', { ...SANS, size: 14, weight: 600, color: '#f1e6d2', lineHeight: 1.55, spacing: 1 });

  // ── 상단 우: 큰 책장 + 화분 ─────────────────────────────────────────
  b.place('bookshelf_big', 32, 1);
  b.light(34, 2.2, 1.8, 0xffc46a, 0.3);
  b.light(37, 2.2, 1.8, 0xffc46a, 0.3);
  b.place('plant_tall_1', 39, 5);
  b.place('plant_bush_1', 39, 7);

  // ── 우측 세로 벽: 유리 패널 "Music Always Helps" + 식물 ─────────────
  b.place('music_panel', 40, 1);
  b.label(42, 4.2, 'Music\nAlways\nHelps', { ...SANS, size: 13, color: '#efe6d6', lineHeight: 1.35 });
  b.light(42, 1.2, 3.6, 0xffc46a, 0.55);
  b.place('plant_tall_2', 43, 9);
  b.place('plant_palm_1', 39, 9);
  b.place('plant_bush_0', 41, 9);

  // ── 좌측: 커피 코너 ────────────────────────────────────────────────
  b.place('shelf_narrow_a', 2, 10);
  b.place('shelf_narrow_b', 2, 12);
  b.place('shelf_narrow_c', 2, 14);
  b.place('plant_tall_0', 2, 16);
  b.light(2.5, 11, 1.8, 0xffc46a, 0.4);
  b.light(2.5, 15, 1.8, 0xffc46a, 0.4);
  b.place('plant_tall_1', 3, 12);
  b.place('plant_small_b', 3, 15);
  b.place('menu_board_cream', 4, 10);
  b.label(4.55, 11.35, 'COFFEE\nFOR A\nSHARPER\nYOU', { ...SANS, size: 10, weight: 700, color: '#3b3540', align: 'left', lineHeight: 1.25 });
  b.place('cup_shelf', 4, 13);
  b.place('counter_cups', 4, 14);
  b.place('counter_bottles', 5, 14);
  b.place('coffee_machine', 6, 13);
  b.place('counter_grinder', 7, 14);
  b.place('counter_plates', 8, 14);
  b.place('display_case', 4, 15);
  b.light(6, 14.5, 2.8, 0xffd48a, 0.4);
  b.place('plant_tall_2', 9, 11);
  b.place('trash_bin', 8, 16);
  b.place('rug_coffee', 4, 17);

  // ── 좌하단: 푸프 라운지 ────────────────────────────────────────────
  b.place('shelf_narrow_a', 2, 18);
  b.place('shelf_narrow_c', 2, 20);
  b.place('shelf_narrow_b', 2, 22);
  b.light(2.5, 21, 1.8, 0xffc46a, 0.4);
  b.place('rug_pouf', 4, 19);
  b.place('pouf_cream', 4, 19);
  b.place('pouf_green', 7, 19);
  b.place('pouf_cream', 4, 21);
  b.place('pouf_green', 4, 23);
  b.place('side_table_round', 7, 22);
  b.light(7, 21.5, 3.2, 0xffc46a, 0.35);
  b.place('plant_palm_0', 10, 23);

  // ── 중앙: 유리 스터디룸 2개 ─────────────────────────────────────────
  // 방 A: x 11..20, 방 B: x 25..34 (B 는 A 의 좌우 대칭, x' = 45 - x)
  const studyRoom = (mirror, panelName, doorId, label) => {
    const X = (x) => (mirror ? 45 - x : x);
    const XW = (x, w) => (mirror ? 45 - x - (w - 1) : x); // 폭 w 오브젝트의 좌상단
    // 위쪽 벽 (액자 2·선반 1·덩굴·스팟 조명 2) + 벽 아래 그림자
    for (let x = 11; x <= 20; x++) b.place('wall_face', X(x), 10);
    b.fill(['floor_0_shadow', 'floor_1_shadow', 'floor_2_shadow'], XW(12, 8), 12, XW(12, 8) + 7, 12);
    b.place('wall_frames_a', X(12), 10);
    b.place('wall_lamp', X(14), 10);
    b.place('wall_shelf', X(15), 10);
    b.place('wall_vine', X(16), 10);
    b.place('wall_lamp', X(17), 10);
    b.place('wall_frames_b', X(19), 10);
    b.light(X(14) + 0.5, 11.5, 2.8, 0xffc46a, 0.5);
    b.light(X(17) + 0.5, 11.5, 2.8, 0xffc46a, 0.5);
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
    b.light(doorX[0] + 1, 21.5, 2.2, 0xffb85c, 0.45);
    // 이름 패널 (STUDY 1 / STUDY 2)
    b.place(panelName, XW(12, 3), 18);
    b.label(XW(12, 3) + 1.5, 18.95, label, { ...SANS, size: 11, weight: 600, color: '#efe6d6', spacing: 1 });
    // 가구: 넓은 책상(모니터·키보드·램프·머그) + 리턴, 검정 의자, 협탁 2, 러그(책상 앞까지), 화분 3
    b.place('desk_wide', XW(14, 3), 12);
    b.place('desk_return', X(16), 13);
    b.place('chair_n', X(15), 13);
    b.place('nightstand', X(12), 13);
    b.place('nightstand', X(18), 13);
    b.light(X(18) + 0.5, 13.3, 1.6, 0xffd48a, 0.35);
    b.place('rug_study', XW(14, 5), 14);
    b.place('plant_tall_2', X(12), 15);
    b.place('plant_palm_1', X(18), 16);
    b.place('plant_bush_1', X(19), 19);
  };
  studyRoom(false, 'study_panel_1', 'study1', '수빈s ROOM');
  studyRoom(true, 'study_panel_2', 'study2', '선아s ROOM');
  b.place('rug_corridor', 22, 12);
  b.place('plant_palm_0', 21, 11);
  b.place('plant_palm_1', 24, 11);
  b.light(23, 16.5, 3.2, 0xffc46a, 0.28);
  b.light(23, 23, 3.2, 0xffc46a, 0.25);

  // ── 우측: 화이트보드 + 회의 테이블 8석 ──────────────────────────────
  b.place('ladder_shelf', 35, 10);
  b.place('plant_tall_0', 35, 14);
  b.place('whiteboard_big', 37, 11);
  b.label(39.2, 12.05, 'Small Steps\nBig Changes\n:)', { ...SANS, size: 10, weight: 500, color: '#4a5568', lineHeight: 1.3 });
  b.light(39.5, 12.2, 2.8, 0xffc46a, 0.35);
  b.place('rug_meeting', 36, 15);
  b.place('big_table_v', 37, 16);
  b.light(38.5, 18.5, 3.6, 0xffc46a, 0.4);
  b.place('chair_s', 38, 15);
  b.place('chair_s', 39, 15);
  for (const y of [16, 18, 20]) {
    b.place('chair_e', 36, y);
    b.place('chair_w', 41, y);
  }
  b.place('plant_tall_1', 43, 15);
  b.place('plant_palm_0', 43, 11);
  b.place('plant_tall_2', 43, 22);
  b.place('plant_bush_0', 35, 24);
  b.place('water_dispenser', 35, 22);
  b.light(43.5, 13, 1.8, 0xffc46a, 0.45);
  b.light(43.5, 18, 1.8, 0xffc46a, 0.45);
  b.light(43.5, 20.5, 1.8, 0xffc46a, 0.4);

  // ── 하단: 입구 + 바깥 ──────────────────────────────────────────────
  b.place('coat_rack', 16, 23);
  b.place('plant_palm_1', 17, 23);
  b.place('plant_palm_0', 28, 23);
  b.place('trash_bin', 29, 24);
  b.place('entrance_wide', 18, 25);
  b.setSolid(22, 25, 23, 26, false); // 유리문 가운데는 통과 가능 (바깥은 장식, 추후 실외 연결)
  b.doors.push({ id: 'entrance', x: 22, y: 25, to: null }, { id: 'entrance', x: 23, y: 25, to: null });
  b.light(18.5, 25.3, 2.8, 0xffc46a, 0.55);
  b.light(27.5, 25.3, 2.8, 0xffc46a, 0.55);
  b.place('doormat_big', 20, 27);
  b.label(23.5, 28.45, 'WELCOME\nTO\nOUR STUDY ROOM\n♡', { ...SANS, size: 9, weight: 600, color: '#e4d3b4', lineHeight: 1.2, spacing: 1 });
  b.place('bollard', 16, 27);
  b.place('bollard', 30, 27);
  b.light(16.5, 27.6, 2.4, 0xffc46a, 0.5);
  b.light(30.5, 27.6, 2.4, 0xffc46a, 0.5);
  b.place('plant_tall_3', 17, 27);
  b.place('plant_tall_1', 28, 27);
  b.fill(['hedge_0', 'hedge_1', 'hedge_flower_0'], 5, 26, 15, 27);
  b.fill(['hedge_1', 'hedge_0', 'hedge_flower_1'], 31, 26, 40, 27);
  b.place('bench', 9, 28);
  b.place('bench', 32, 28);
  b.fill(['hedge_flower_0', 'hedge_flower_1'], 10, 30, 12, 30);
  b.fill(['hedge_flower_1', 'hedge_flower_0'], 33, 30, 35, 30);
  b.place('sign_left', 1, 26);
  b.label(2.5, 28.1, 'Same\nPlace\nBrighter\nUs\n♡', { ...SANS, size: 9, color: '#efe6d6', lineHeight: 1.25 });
  b.place('sign_right', 42, 26);
  b.label(43.5, 28.1, 'Good\nIdeas\nStart\nHere\n→', { ...SANS, size: 9, color: '#efe6d6', lineHeight: 1.25 });

  b.setSpawn(22, 23);
  return b.build();
}

let cached = null;
function getStudyRoom() {
  if (!cached) cached = buildStudyRoom();
  return cached;
}

module.exports = { buildStudyRoom, getStudyRoom };
