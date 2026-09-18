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
 * 3단계: 식물은 창가 양끝·스터디룸 각 1·커피 코너 1·입구 양옆·회의 구역 모서리만 남기고 액자/선반/수납장/러그로 채웠다.
 * 15단계: 유리 스터디룸 2개를 넓은 2인 스터디룸 하나로(x 12..33). 통로 러너는 방 앞 가로. 좌석 id 고정(study-a/b) + 옛 id 별칭.
 *         클라이언트가 동적으로 그리는 위치는 anchors (문 명패·코르크보드 목표 팻말·D-day 칠판·커피머신 김).
 * 17단계: 2인 스터디룸 안쪽 정리 — 러그는 책상 앞 4타일만(격자), 아래 벽에 위를 보는 2인 소파 코너, 왼쪽 벽 화이트보드·2단 책장, 오른쪽 벽 옷걸이·수납장·미니 냉장고.
 *         걸을 수 있는 모든 칸이 스폰에서 닿아야 하고(가구 사이 막힌 틈은 setSolid), 상점 가구도 고립 칸을 만들면 서버가 거부한다 (layout.js isolates).
 *         동선 규칙: 구역(커피 코너·푸프·라운지·회의·스터디룸·복도) 사이에는 2타일 폭 통로가 하나 이상 있어야 하고 소품이 통로를 좁히면 안 된다 (test/stage17.test.js 가 2x2 블록 BFS 로 검증).
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

  // ── 상단 좌: 칠판 + 프린터 수납장 + 좁은 책장 ──────────────────────
  b.place('wall_frames_c', 2, 1); // 15단계: 액자 3개 묶음
  b.place('shelf_narrow_a', 2, 3);
  b.place('shelf_narrow_b', 2, 5);
  b.place('chalkboard_big', 4, 1);
  b.label(7.5, 4.0, 'Good\nStudy\nBetter\nTomorrow', { ...HAND, size: 24, color: '#e8dcc4', lineHeight: 0.98 });
  b.label(4.9, 6.1, '♡', { ...SANS, size: 12, color: '#d9a98f' }); // 15단계: 오른쪽 아래는 D-day 목록 자리라 왼쪽으로
  b.light(7.5, 1.2, 3.4, 0xffc46a, 0.6);
  b.anchor('dday', 10.1, 5.6, { w: 64, lines: 3 }); // 15단계: D-day 목록 (칠판 오른쪽 아래, 최대 3개)
  // 17단계 동선: 프린터 수납장을 왼쪽 벽까지 붙인다(작은 수납장 자리) → 오른쪽 끝이 x 8 이 되어 커피 코너 통로(x 9..11)가 위쪽 복도(y 8..9)와 2칸 폭으로 꺾인다
  // (전에는 수납장 끝 x 10 과 스터디룸 벽 모서리 x 12 가 (11,9) 한 칸짜리 꺾임을 만들었다)
  b.place('cabinet_printer', 2, 7);
  b.place('wall_frames_a', 11, 1);
  b.place('wall_clock', 12, 1);
  b.place('wall_vine', 13, 1); // 벽 덩굴은 창문 좌우에만
  b.place('shelf_narrow_c', 11, 3);
  b.place('cabinet_small', 12, 5);

  // ── 상단 중앙: 창문 (14타일 폭, 5타일 높이, 펜던트 5개) ─────────────
  // 하늘은 타일에 없다 → windows 사각형에 클라이언트가 시간대(낮/노을/밤) 그라데이션을 그린다.
  // 밤 타일은 furniture 레이어(불빛 깜빡임), 낮 타일은 windowDay 레이어(클라이언트가 알파로 교차).
  const lampCols = new Set([16, 18, 21, 23, 25]);
  const windowTile = (x) => {
    if (x === 14) return 'window_l';
    if (x === 27) return 'window_r';
    const mi = (x - 15) % 4;
    return lampCols.has(x) ? `window_m_lamp_${mi}` : `window_m_${mi}`;
  };
  for (let x = 14; x <= 27; x++) {
    b.place(`${windowTile(x)}_f0`, x, 0);
    b.place(`${windowTile(x)}_day`, x, 0, { layer: 'windowDay' });
  }
  b.window(14, 0, 14, 4.5);
  b.place('wall_vine', 28, 1);
  for (const x of lampCols) b.light(x + 0.5, 1.9, 2.8, 0xffb85c, 0.5, { pool: 6.6 }); // 15단계: 펜던트 아래 바닥에 둥근 빛 웅덩이

  // ── 라운지 (소파 양옆: 스탠드 · 수납장 + 협탁, 창가 양끝 화분) ─────────
  b.place('plant_tall_3', 14, 5);
  b.place('standing_lamp', 16, 5);
  b.light(16.5, 5.2, 3.4, 0xffc46a, 0.55);
  b.place('sofa_wide', 17, 5);
  b.place('cabinet_small', 23, 5);
  b.light(24, 5.2, 2.2, 0xffc46a, 0.35);
  b.place('side_table_round', 25, 6);
  b.place('plant_tall_0', 27, 5);
  b.place('rug_lounge', 15, 7);
  b.place('round_table', 19, 8);
  b.light(21, 8.5, 3.2, 0xffc46a, 0.3);
  b.place('cushion', 24, 9); // 강아지 쿠션 — NPC 가 여기서 잔다 (server/game/npc.js)
  // 15단계 밀도: 바닥 슬리퍼·잡지 더미 · 사이드 테이블 램프 · 강아지 밥그릇·장난감
  b.place('magazines', 16, 9);
  b.place('slippers_b', 17, 8);
  b.place('table_lamp', 23, 7);
  b.light(23.5, 7.6, 2.0, 0xffc46a, 0.35);
  b.place('dog_bowl', 25, 9);
  b.place('dog_toy', 26, 9);
  b.anchor('tank', 20.5, 8.4); // 어항(공용 펫 물고기) 물결 위치

  // ── 상단 중앙 우: FOCUS/PLAN/STUDY/GROW 세로 표지판 ─────────────────
  b.place('board_focus_tall', 29, 1);
  b.label(31, 3.5, 'FOCUS\nPLAN\nSTUDY\nGROW', { ...SANS, size: 14, weight: 600, color: '#f1e6d2', lineHeight: 1.55, spacing: 1 });

  // ── 상단 우: 큰 책장 + 수납장 ───────────────────────────────────────
  b.place('bookshelf_big', 33, 1);
  b.light(35, 2.2, 1.8, 0xffc46a, 0.3);
  b.light(38, 2.2, 1.8, 0xffc46a, 0.3);
  b.place('cabinet_small', 38, 6);

  // ── 우측 세로 벽: 유리 패널 "Music Always Helps" (앞에서 E → 유튜브 카드) ──
  b.place('music_panel', 40, 1);
  b.label(42, 4.2, 'Music\nAlways\nHelps', { ...SANS, size: 13, color: '#efe6d6', lineHeight: 1.35 });
  b.light(42, 1.2, 3.6, 0xffc46a, 0.55);
  b.interactable('music', 'music', 42, 10, { hint: '음악 듣기' });

  // ── 좌측: 커피 코너 (커피머신 앞에서 E → ☕ 휴식) ────────────────────
  b.place('shelf_narrow_a', 2, 10);
  b.place('shelf_narrow_b', 2, 12);
  b.place('shelf_narrow_c', 2, 14);
  b.place('cabinet_small', 2, 16);
  b.light(2.5, 11, 1.8, 0xffc46a, 0.4);
  b.light(2.5, 15, 1.8, 0xffc46a, 0.4);
  b.place('menu_board_cream', 4, 10);
  b.label(4.55, 11.35, 'COFFEE\nFOR A\nSHARPER\nYOU', { ...SANS, size: 10, weight: 700, color: '#3b3540', align: 'left', lineHeight: 1.25 });
  b.place('cup_shelf', 4, 13);
  b.place('counter_cups', 4, 14);
  b.place('counter_bottles', 5, 14);
  b.place('coffee_machine', 6, 13);
  b.place('counter_grinder', 7, 14);
  b.place('counter_menu', 8, 14); // 15단계: 메뉴 카드·냅킨·시럽병·머그 진열
  b.place('display_case', 4, 16);
  b.light(6, 14.5, 2.8, 0xffd48a, 0.4);
  b.interactable('coffee', 'coffee', 6.5, 16, { hint: '커피' });
  b.anchor('steam', 6.5, 13.15); // 커피머신 김
  b.place('rug_coffee', 4, 17);
  // 17단계 동선: 카운터 오른쪽 끝(x 8) 옆 x 9..11 은 위(라운지)·아래(복도)로 이어지는 3칸 폭 통로 — 화분·원두 선반·우유 상자·쓰레기통을 치웠다.
  // 우유 상자·쓰레기통은 카운터 아래 벽 쪽 구석(수납장 밑, x 3..4 y 18)으로.
  b.place('trash_bin', 3, 18);
  b.place('milk_crate', 4, 18);

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
  b.place('side_table_games', 7, 22); // 15단계: 보드게임 + 간식 접시
  b.place('book_cart', 9, 21);
  b.light(7, 21.5, 3.2, 0xffc46a, 0.35);

  // ── 중앙: 2인 유리 스터디룸 (15단계: 두 방을 하나로 합침) ─────────────
  // 벽: x 12 / 33 (세로 유리, 3타일마다 기둥), y 10..11 위쪽 벽, y 21 아래 유리벽. 안쪽 x 13..32, y 12..20.
  // 슬라이딩 문 패널(x 20..21) + 열린 문 2타일(x 22..23) 은 방 앞 통로(스폰)와 이어진다. 명패 글자는 클라이언트가 스터디 설정(roomLabel)으로 그린다.
  // 좌석 id 는 'study-a' / 'study-b' 로 고정 (옛 방 A/B 의자 seat-8 / seat-9 는 별칭으로 계속 받는다).
  for (let x = 12; x <= 33; x++) b.place('wall_face', x, 10);
  b.fill(['floor_0_shadow', 'floor_1_shadow', 'floor_2_shadow'], 13, 12, 32, 12);
  // 위쪽 벽 장식: 액자·포스터·선반·스팟 조명 2·코르크보드(책상 위)·후크 가방·벽시계·스위치
  b.place('bean_shelf_wall', 12, 10); // 17단계 동선: 원두 선반은 스터디룸 위쪽 벽(모서리)에 건다 → 메뉴 보드 오른쪽 x 9..11 이 3칸 폭 통로
  b.place('wall_frames_a', 20, 10); // (18,10) 은 상점 벽 포스터 테스트가 쓰는 빈 벽이라 비워 둔다
  b.place('wall_poster', 14, 10);
  b.place('wall_shelf', 15, 10);
  b.place('wall_shelf_b', 16, 10);
  b.place('wall_hook_bag', 17, 10);
  b.place('wall_lamp', 19, 10);
  b.place('corkboard', 21, 10);
  b.anchor('corkboard', 22.5, 11.05, { seats: ['study-a', 'study-b'] });
  b.place('wall_lamp', 25, 10);
  b.place('wall_frames_b', 27, 10);
  b.place('wall_clock', 29, 10);
  b.place('wall_switch', 31, 10);
  b.light(19.5, 11.5, 2.8, 0xffc46a, 0.5);
  b.light(25.5, 11.5, 2.8, 0xffc46a, 0.5);
  // 좌우 유리벽 (기둥 3타일 간격) + 아래 유리벽
  for (let y = 12; y <= 20; y++) {
    const t = (y - 12) % 3 === 0 ? 'gpost_NS' : 'glass_NS';
    b.place(t, 12, y);
    b.place(t, 33, y);
  }
  b.place('gpost_NE', 12, 21);
  b.place('gpost_NW', 33, 21);
  for (const x of [13, 14, 15, 17, 18, 19]) b.place('glass_EW', x, 21);
  b.place('gpost_EW', 16, 21);
  b.place('study_panel_1', 20, 18);
  b.anchor('nameplate', 21, 19.05);
  b.place('door_open', 22, 21, { doorId: 'study-l' });
  b.place('door_open', 23, 21, { doorId: 'study-r' });
  b.alias('study1-l', 'study-l');
  b.light(23, 21.5, 2.2, 0xffb85c, 0.45);
  b.place('gpost_W', 24, 21);
  for (const x of [25, 26, 27, 29, 30, 31, 32]) b.place('glass_EW', x, 21);
  b.place('gpost_EW', 28, 21);
  b.zone('study', 13, 12, 32, 20, { kind: 'glass', bright: 0.6 });
  // 유리벽 안쪽 왼편에 얇은 커튼 레일 (반쯤 걷힌 커튼, top 레이어)
  b.place('curtain_top', 13, 12);
  b.place('curtain_body', 13, 13);
  b.place('curtain_body', 13, 14);
  b.place('curtain_end', 13, 15);
  for (let y = 16; y <= 19; y++) b.place('curtain_rail', 13, y);
  // 가구 (17단계 정리): 격자 러그는 책상 폭·4타일 깊이(x 19..25, y 14..17)만 — 러그 밖 바닥이 보인다.
  //   긴 책상(모니터 2·스탠드 2·공유 화분/시계) · 의자 2 (사이 1타일) · 협탁 2
  //   왼쪽 벽(x 14..15): 야자 · 작은 화이트보드(이젤) · 2단 책장 — 커튼 옆 x 13 은 세로 통로
  //   오른쪽 벽(x 31..32): 옷걸이(가디건) · 작은 수납장 · 미니 냉장고 · 잡지 더미
  //   아래 벽: 위를 보는 2인 소파(등받이가 유리벽, 문 오른쪽 x 25..28) + 앞 낮은 테이블(책·머그, 러그 옆 y 17, 소파 앞 y 18 은 통로) +
  //            양옆 스탠드 램프(y 18..19)·작은 사이드 테이블(y 20) · 바닥 슬리퍼 2·쿠션 2(통과 가능)
  //   통행: 문(22..23, y 21) → 문 패널(20..21)과 왼쪽 램프(24) 사이 2칸 폭 통로 → 러그 → 두 의자. 모든 바닥 칸이 스폰에서 닿는다 (test/stage17.test.js BFS).
  b.place('rug_study_grid', 19, 14);
  b.place('desk_long', 19, 12);
  b.place('nightstand_books', 18, 12);
  b.place('nightstand_lamp', 26, 12);
  b.light(26.5, 12.3, 1.6, 0xffd48a, 0.35);
  b.light(19.5, 12.4, 1.5, 0xffd48a, 0.3);
  b.light(25.5, 12.4, 1.5, 0xffd48a, 0.3);
  // 책상 슬롯: 두 사람이 겹치지 않게 명시 (가운데 화분·모니터 칸은 피한다)
  b.place('chair_n', 21, 14, { seatIds: ['study-a'], slots: [[20, 12], [20, 13], [19, 13]] });
  b.place('chair_n', 23, 14, { seatIds: ['study-b'], slots: [[24, 12], [24, 13], [25, 13]] });
  b.alias('seat-8', 'study-a');
  b.alias('seat-9', 'study-b');
  b.screen(21, 14, { x: 19 * 16 + 32, y: 12 * 16 + 2, w: 16, h: 8, kind: 'monitor' });
  b.screen(23, 14, { x: 19 * 16 + 64, y: 12 * 16 + 2, w: 16, h: 8, kind: 'monitor' });
  // 왼쪽 벽
  b.place('plant_palm_1', 14, 11);
  b.place('whiteboard_small', 14, 13);
  b.place('bookcase_2tier', 14, 16);
  b.place('plant_palm_0', 14, 19);
  // 오른쪽 벽
  b.place('coat_rack_cardigan', 32, 11);
  b.place('cabinet_small', 31, 13);
  b.place('mini_fridge', 32, 15);
  b.place('magazines', 32, 18);
  // 아래 벽: 소파 코너 (좌석 study-sofa-a/b = (26,19)·(27,19), 위를 본다)
  b.place('standing_lamp', 24, 18);
  b.light(24.5, 18.6, 2.6, 0xffc46a, 0.4);
  b.place('side_table_small', 24, 20);
  b.place('sofa_love_n', 25, 19, { seatIds: ['study-sofa-a', 'study-sofa-b'] });
  b.place('low_table_study', 26, 17);
  b.place('standing_lamp', 29, 18);
  b.light(29.5, 18.6, 2.6, 0xffc46a, 0.4);
  b.place('side_table_small', 29, 20);
  // 바닥 소품 (전부 통과 가능)
  b.place('slippers_a', 19, 20);
  b.place('slippers_b', 30, 20);
  b.place('cushion_floor_a', 16, 19);
  b.place('cushion_floor_b', 17, 20);
  // 방 앞 가로 러너 (통로)
  b.place('rug_runner_h', 18, 22);
  b.light(18.5, 22.8, 2.6, 0xffc46a, 0.22);
  b.light(27.5, 22.8, 2.6, 0xffc46a, 0.22);

  // ── 우측: 화이트보드 + 회의 테이블 8석 (노트북은 왼쪽 아래 의자 자리) ──
  b.place('ladder_shelf', 36, 10); // 17단계 동선: 스터디룸 벽 모서리(x 33) 옆 x 34..35 를 2칸 폭으로 (라운지 ↔ 회의 구역)
  b.place('whiteboard_big', 37, 11);
  b.label(39.2, 12.05, 'Small Steps\nBig Changes\n:)', { ...SANS, size: 10, weight: 500, color: '#4a5568', lineHeight: 1.3 });
  b.light(39.5, 12.2, 2.8, 0xffc46a, 0.35);
  b.place('rug_meeting', 36, 15);
  b.place('big_table_v', 37, 16);
  b.light(38.5, 18.5, 3.6, 0xffc46a, 0.4);
  b.place('chair_s', 38, 15);
  b.place('chair_s', 39, 15);
  for (const y of [16, 18, 20]) {
    b.place(y === 16 ? 'chair_e_bag' : 'chair_e', 36, y); // 15단계: 의자에 걸린 가방
    b.place('chair_w', 41, y);
  }
  b.place('projector_screen', 42, 10); // 15단계: 내려온 프로젝터 스크린
  b.place('wall_calendar', 33, 10); // 스터디룸 모서리 벽 = 회의 구역 쪽 벽 달력
  b.place('cable_box', 37, 22);
  b.screen(36, 20, { x: 37 * 16 + 13, y: 16 * 16 + 63, w: 7, h: 4, kind: 'laptop' });
  b.place('plant_palm_0', 43, 22);
  b.place('water_dispenser', 42, 22); // 17단계 동선: 정수기·쓰레기통은 야자 옆 오른쪽 아래 구석으로 → x 34..35 y 22..24 가 2칸 폭 (회의 구역 ↔ 복도)
  b.place('trash_bin', 41, 23);
  b.light(43.5, 13, 1.8, 0xffc46a, 0.45);
  b.light(43.5, 18, 1.8, 0xffc46a, 0.45);
  b.light(43.5, 20.5, 1.8, 0xffc46a, 0.4);

  // ── 하단: 입구 + 바깥 ──────────────────────────────────────────────
  b.place('coat_rack', 16, 23);
  b.place('umbrella_stand', 17, 24); // 15단계 복도 소품
  b.place('info_sign', 19, 23);
  b.anchor('infoSign', 19.5, 23.45);
  b.place('shoe_rack', 26, 24);
  b.place('cabinet_small', 28, 23);
  b.place('trash_bin', 30, 24);
  b.place('fire_extinguisher', 31, 24);
  b.place('entrance_wide', 18, 25);
  b.setSolid(22, 25, 23, 26, false); // 유리문 가운데는 통과 가능
  b.doors.push({ id: 'entrance', x: 22, y: 25, to: 'outdoor' }, { id: 'entrance', x: 23, y: 25, to: 'outdoor' }); // 12단계: 밟으면 공용 야외로
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

  // 17단계: 가구 사이 막힌 틈(어디서도 못 들어가는 칸)은 막아 둔다 — 통행 검증(스폰에서 BFS)이 고립 칸으로 잡지 않게
  b.setSolid(3, 3, 3, 6); // 좁은 책장 ↔ 칠판 사이
  b.setSolid(12, 3, 13, 4); // 좁은 책장 ↔ 창가 화분 사이
  b.setSolid(23, 9, 23, 9); // 라운지 사이드 램프 ↔ 강아지 쿠션 사이
  b.setSolid(7, 13, 8, 13); // 커피머신 뒤

  b.setSpawn(22, 23);
  return b.build();
}

let cached = null;
function getStudyRoom() {
  if (!cached) cached = buildStudyRoom();
  return cached;
}

module.exports = { buildStudyRoom, getStudyRoom };
