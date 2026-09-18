'use strict';
/**
 * 12단계: 공용 야외 + 카트.
 *  - 단위: 야외 맵(80x50, 문·스폰·트랙 위 걷기 가능·체크포인트) · 탈것 물리(방향키 8방향 가속·관성·브레이크·회전 속도·최고 속도) · 페이로드 검증 ·
 *    랩 판정(정방향 완주 · 역주행 거부 · 쇼트컷 거부) · 메모리 저장소 track_records(상위 5 · 개인 최고 · 오늘 완주).
 *  - 소켓 E2E: 문 왕복(스터디 → 야외 → 스터디, playerLeft reason) · 격리(스터디 A·B 사람이 야외에서 같이 보이고 채팅은 야외끼리만) ·
 *    탑승/해제(활성 탈것 필요 · 앉은 채 불가 · 스터디 안 불가) · 속도 검증(최고 속도 초과 → move:correct) · 충돌(나무 안으로 못 들어감) ·
 *    랩 판정(체크포인트 순서 · 역주행 reset · 완주 → lap 방송 · 기록 저장 · 보상 하루 1회) · 전광판 · 프로필(공개 설정).
 *  - 브라우저: 이중문을 밟으면 야외 씬으로 바뀌고(미니맵·배지), V 로 탑승하면 탈것 스프라이트, 문으로 돌아오면 스터디룸.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { getOutdoor, isTrackCell, TRACK } = require('../server/rooms/outdoor');
const { getStudyRoom } = require('../server/rooms/studyroom');
const { canStand } = require('../server/game/movement');
const Vehicles = require('../server/game/vehicles');
const { advance, newLapState, validateTrack, crosses } = require('../server/game/track');
const { createMemoryStore } = require('../server/store/memory');
const { LAP_REWARD } = require('../server/game/outdoor');
const { boot, connect, joinAs, ask, once, sleep, collect, CHROME, CHROME_ARGS } = require('./helpers');
const { walk, pathTo } = require('../tools/lib/walk');

const T = 32;
const KST = (iso) => new Date(`${iso}+09:00`).getTime();
const outdoor = getOutdoor();
const room = getStudyRoom();

// ── 단위: 맵 ────────────────────────────────────────────────────────
test('야외 맵: 100x70 · 문 2개(→ studyroom) · 스폰/출발선/체크포인트 걷기 가능 · 트랙은 둥근 사각 흙길 · 하늘 띠는 통과 불가 · 스터디룸 입구는 → outdoor', () => {
  assert.equal(outdoor.width, 100);
  assert.equal(outdoor.height, 70);
  assert.equal(outdoor.outdoor, true);
  assert.deepEqual(outdoor.doors.map((d) => [d.x, d.y, d.to]), [[31, 19, 'studyroom'], [32, 19, 'studyroom']]);
  assert.ok(canStand(outdoor, outdoor.spawn.x, outdoor.spawn.y));
  assert.ok(canStand(outdoor, 31.5 * T, 20 * T), '문 타일까지 걸어갈 수 있다');
  assert.ok(validateTrack(outdoor.track));
  for (const c of outdoor.track.checkpoints) assert.ok(canStand(outdoor, c.x, c.y));
  assert.ok(canStand(outdoor, 49.5 * T, 32 * T), '출발선');
  assert.ok(isTrackCell(48, 31) && isTrackCell(49, 31) && isTrackCell(50, 31), '출발선 3칸이 트랙');
  assert.ok(!isTrackCell(51, 31) && !isTrackCell(47, 31), '트랙 폭은 3');
  assert.ok(isTrackCell(63, 14) && isTrackCell(77, 30) && isTrackCell(63, 47));
  assert.ok(!isTrackCell(63, 30), '안쪽 섬은 잔디');
  let cells = 0;
  for (let y = TRACK.y0; y <= TRACK.y1; y++) for (let x = TRACK.x0; x <= TRACK.x1; x++) if (isTrackCell(x, y)) cells++;
  assert.ok(cells > 300 && cells < 420, `트랙 셀 ${cells}`);
  for (let x = 0; x < 100; x++) assert.equal(outdoor.collision[0][x], true, '하늘');
  assert.ok(outdoor.seats.length >= 20, '벤치 좌석');
  assert.ok(outdoor.seats.every((s) => !outdoor.collision[s.y][s.x]));
  assert.ok(outdoor.interactables.some((i) => i.kind === 'board') && outdoor.interactables.some((i) => i.kind === 'shop'));
  assert.ok(outdoor.windows.length === 1 && outdoor.windows[0].w === 100 * T, '하늘 사각형');
  assert.ok(outdoor.props.some((p) => p.name === 'scoreboard') && outdoor.props.some((p) => p.name === 'kart_garage') && outdoor.props.some((p) => p.name === 'fountain_f0'));
  assert.ok(outdoor.layers.top.some((row) => row.some((i) => i !== -1)), '나무 윗부분은 top 레이어');
  // 스폰에서 출발선·전광판 앞·전망대까지 걸어서 도달
  const sp = { x: Math.floor(outdoor.spawn.x / T), y: Math.floor((outdoor.spawn.y - 1) / T) };
  for (const [gx, gy] of [[49, 31], [44, 30], [37, 7], [5, 38]]) assert.ok(pathTo(outdoor, sp.x, sp.y, (x, y) => x === gx && y === gy), `경로 (${gx},${gy})`);
  assert.deepEqual(room.doors.filter((d) => d.to).map((d) => [d.x, d.y, d.to]), [[22, 25, 'outdoor'], [23, 25, 'outdoor']]);
});

// ── 단위: 탈것 물리 ─────────────────────────────────────────────────
test('탈것 물리: 방향키 8방향 가속(대각선) · 최고 속도 걷기의 2/2.2/3/3.5배 · 회전은 차종별 속도로 부드럽게(스포츠가 가장 빠름) · 반대 방향은 브레이크 후 출발 · 관성·마찰 · 충돌 튕김', () => {
  const ok = () => true;
  assert.deepEqual(Vehicles.TYPE_IDS.map((id) => Math.round((Vehicles.TYPES[id].maxSpeed / Vehicles.WALK) * 10) / 10), [0.9, 2, 2.2, 3, 3.5]);
  // 낡은 인력거: 걷기보다 느리고 가속이 굼뜨고 덜컹거림(wobble), 색 고정, 1코인, 전광판 🛒
  const rick = Vehicles.TYPES.rickshaw;
  assert.ok(rick.maxSpeed < Vehicles.WALK && rick.accel < Vehicles.TYPES.bicycle.accel / 3 && rick.wobble && rick.color === 'wood' && rick.price === 1 && rick.icon === '🛒');
  assert.equal(Vehicles.colorOf('rickshaw', null), 'wood');
  assert.equal(Vehicles.colorOf('kart', 'blue'), 'blue');
  assert.equal(Vehicles.colorOf('kart', null), 'red');
  assert.ok(Vehicles.TYPES.sport.turn > Vehicles.TYPES.kart.turn && Vehicles.TYPES.sport.turn > Vehicles.TYPES.bicycle.turn && Vehicles.TYPES.sport.turn > Vehicles.TYPES.kickboard.turn);
  assert.equal(Vehicles.dir8(0), 'e');
  assert.equal(Vehicles.dir8(Math.PI / 2), 's');
  assert.equal(Vehicles.dir8(-Math.PI / 2), 'n');
  assert.equal(Vehicles.dir8(Math.PI / 4), 'se');
  assert.equal(Vehicles.dir8(Math.PI), 'w');
  assert.equal(Vehicles.facing4('nw'), 'up');
  assert.equal(Vehicles.inputAngle({ up: true, right: true }), -Math.PI / 4, '대각선 입력');
  assert.equal(Vehicles.inputAngle({}), null);
  // 가속 → 최고 속도에서 멈춘다, 방향은 입력 그대로
  let st = { x: 0, y: 0, angle: 0, speed: 0 };
  for (let i = 0; i < 60; i++) st = Vehicles.step('kart', st, { right: true }, 0.05, ok);
  assert.equal(Math.round(st.speed), Vehicles.TYPES.kart.maxSpeed);
  assert.equal(Vehicles.dir8(st.angle), 'e');
  assert.ok(st.x > 0 && Math.abs(st.y) < 1e-6);
  // 대각선: 각도 45°
  let d = { x: 0, y: 0, angle: -Math.PI / 4, speed: 0 };
  for (let i = 0; i < 10; i++) d = Vehicles.step('kart', d, { up: true, right: true }, 0.05, ok);
  assert.equal(Vehicles.dir8(d.angle), 'ne');
  assert.ok(d.x > 0 && d.y < 0);
  // 회전: 아래 키를 누르면 즉시 꺾이지 않고 turn 속도로 돈다 — 한 프레임 뒤엔 아직 동쪽 가까이, 스포츠 카트가 더 많이 돌아 있다
  const k1 = Vehicles.step('kart', { x: 0, y: 0, angle: 0, speed: 400 }, { down: true }, 0.05, ok);
  const s1 = Vehicles.step('sport', { x: 0, y: 0, angle: 0, speed: 400 }, { down: true }, 0.05, ok);
  assert.ok(k1.angle > 0 && k1.angle < Math.PI / 2, `카트 한 프레임 회전 ${k1.angle}`);
  assert.ok(Math.abs(k1.angle - Vehicles.TYPES.kart.turn * 0.05) < 1e-9, '회전량 = turn × dt');
  assert.ok(s1.angle > k1.angle, '스포츠 카트가 더 빨리 꺾인다');
  let k = { x: 0, y: 0, angle: 0, speed: 400 };
  for (let i = 0; i < 40; i++) k = Vehicles.step('kart', k, { down: true }, 0.05, ok);
  assert.ok(Math.abs(k.angle - Math.PI / 2) < 1e-9, '결국 남쪽을 본다');
  // 반대 방향: 브레이크(braking) → 멈춘 뒤 그 방향으로 출발
  let r = { x: 0, y: 0, angle: 0, speed: 400 };
  r = Vehicles.step('kart', r, { left: true }, 0.05, ok);
  assert.equal(r.braking, true);
  assert.equal(Vehicles.dir8(r.angle), 'e', '브레이크 중엔 방향 유지');
  assert.ok(r.speed < 400 && r.speed >= 0);
  for (let i = 0; i < 40; i++) r = Vehicles.step('kart', r, { left: true }, 0.05, ok);
  assert.equal(Vehicles.dir8(r.angle), 'w');
  assert.ok(r.speed > 0 && r.speed <= Vehicles.TYPES.kart.maxSpeed);
  assert.ok(r.speed >= 0, '후진 없음');
  // 관성: 키를 떼면 마찰로 서서히 멈춘다 (한 프레임에 0 이 되지 않는다)
  let c = { x: 0, y: 0, angle: 0, speed: 300 };
  c = Vehicles.step('kart', c, {}, 0.05, ok);
  assert.ok(c.speed > 250 && c.speed < 300);
  for (let i = 0; i < 100; i++) c = Vehicles.step('kart', c, {}, 0.05, ok);
  assert.equal(c.speed, 0);
  // 충돌: 막히면 반대로 튕기며 속도가 준다
  const wall = (x) => x < 100;
  const h = Vehicles.step('kart', { x: 95, y: 0, angle: 0, speed: 400 }, { right: true }, 0.05, wall);
  assert.equal(h.hit, true);
  assert.equal(Vehicles.dir8(h.angle), 'w');
  assert.ok(h.speed < 400 * 0.4);
  // 검증: 탑승 안 했으면 무시, 최고 속도 초과·음수·NaN 거부
  assert.deepEqual(Vehicles.validateVehiclePayload(null, { angle: 0, speed: 9999 }), { ok: true, vehicle: null });
  assert.equal(Vehicles.validateVehiclePayload({ type: 'kart' }, { angle: 0, speed: 451 }).ok, true);
  assert.equal(Vehicles.validateVehiclePayload({ type: 'kart' }, { angle: 0, speed: 460 }).reason, 'too_fast');
  assert.equal(Vehicles.validateVehiclePayload({ type: 'kart' }, { angle: 0, speed: -5 }).reason, 'too_fast');
  assert.equal(Vehicles.validateVehiclePayload({ type: 'kart' }, { angle: 'x', speed: 1 }).reason, 'invalid');
  assert.equal(Vehicles.validateVehiclePayload({ type: 'nope' }, { angle: 0, speed: 1 }).reason, 'no_vehicle');
  assert.deepEqual(Vehicles.validateVehiclePayload({ type: 'kart', angle: 1 }, null), { ok: true, vehicle: { type: 'kart', angle: 1, speed: 0 } });
});

// ── 단위: 랩 판정 ───────────────────────────────────────────────────
/** 트랙을 따라 시계 방향으로 한 바퀴 도는 경로 (출발선 아래 → 위로 통과 → 위 → 오른쪽 → 아래 → 왼쪽 → 다시 통과) */
function lapPath() {
  const P = (tx, ty) => ({ x: tx * T, y: ty * T });
  return [P(49.5, 34), P(49.5, 30), P(49.5, 24), P(52, 16), P(63.5, 14.5), P(75, 16), P(77.5, 30.5), P(75, 45), P(63.5, 47.5), P(52, 45), P(49.5, 40), P(49.5, 34), P(49.5, 30)];
}

test('랩 판정: 출발선 정방향 통과 → 체크포인트 3개 순서대로 → 다시 통과하면 완주(ms) · 역주행은 reset · 체크포인트를 건너뛴 쇼트컷은 완주 불가', () => {
  const track = outdoor.track;
  assert.ok(crosses({ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }, { x: 2, y: 0 }));
  assert.ok(!crosses({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 5, y: 5 }, { x: 6, y: 6 }));
  const st = newLapState();
  let now = 1000;
  const path = lapPath();
  const events = [];
  for (let i = 1; i < path.length; i++) {
    now += 1000;
    const r = advance(track, st, path[i - 1], path[i], now);
    if (r) events.push(r.event);
  }
  assert.deepEqual(events, ['start', 'checkpoint', 'checkpoint', 'checkpoint', 'lap']);
  assert.equal(st.laps, 1);
  assert.ok(st.startedAt === now, '완주 직후 다음 랩이 시작된다');
  // 역주행: 출발선을 아래로(남쪽) 지나면 reset
  const back = advance(track, st, { x: 49.5 * T, y: 30 * T }, { x: 49.5 * T, y: 34 * T }, now + 500);
  assert.equal(back.event, 'reset');
  assert.equal(st.startedAt, null);
  assert.equal(advance(track, st, { x: 49.5 * T, y: 34 * T }, { x: 49.5 * T, y: 36 * T }, now + 600), null, '진행 중이 아니면 조용');
  // 쇼트컷: 출발선 통과 → 위 체크포인트만 찍고 섬을 가로질러 아래로 → 다시 출발선: 완주가 아니라 새 랩 시작
  const s2 = newLapState();
  let t2 = 5000;
  const short = [{ x: 49.5 * T, y: 34 * T }, { x: 49.5 * T, y: 30 * T }, { x: 63.5 * T, y: 14.5 * T }, { x: 63.5 * T, y: 30 * T }, { x: 55 * T, y: 40 * T }, { x: 49.5 * T, y: 34 * T }, { x: 49.5 * T, y: 30 * T }];
  const ev2 = [];
  for (let i = 1; i < short.length; i++) { t2 += 1000; const r = advance(track, s2, short[i - 1], short[i], t2); if (r) ev2.push(r.event); }
  assert.deepEqual(ev2, ['start', 'checkpoint', 'start'], '체크포인트 2·3 을 건너뛰어 완주로 치지 않는다');
  assert.equal(s2.laps, 0);
  // 순서를 어기면(3번을 먼저) 세지 않는다
  const s3 = newLapState();
  advance(track, s3, { x: 49.5 * T, y: 34 * T }, { x: 49.5 * T, y: 30 * T }, 1);
  assert.equal(advance(track, s3, { x: 60 * T, y: 47.5 * T }, { x: 63.5 * T, y: 47.5 * T }, 2), null);
  assert.equal(s3.next, 0);
});

test('상점 12단계: 전체 30% 인하(반올림·최소 2·순서 유지) · 낡은 인력거 1코인·색 없음·설명', () => {
  const { createShop, sale, ITEMS } = require('../server/game/shop');
  const shop = createShop();
  assert.equal(sale(3), 2, '머그컵 3 → 2.1 → 2');
  assert.equal(sale(2), 2, '최소 2');
  assert.equal(sale(1), 1, '1코인은 그대로');
  assert.equal(sale(120), 84);
  for (const it of ITEMS) if (it.listPrice !== undefined) assert.equal(it.price, sale(it.listPrice), it.id);
  // 카테고리 안 상대 순서 유지 (정가 순 = 인하가 순, 동률 허용)
  for (const cat of shop.categories) {
    const items = shop.items.filter((i) => i.category === cat.id && i.listPrice !== undefined).sort((a, b) => a.listPrice - b.listPrice);
    for (let i = 1; i < items.length; i++) assert.ok(items[i].price >= items[i - 1].price, `${cat.id}: ${items[i - 1].id} ≤ ${items[i].id}`);
  }
  assert.deepEqual(['vehicle_bicycle', 'vehicle_kickboard', 'vehicle_kart', 'vehicle_sport', 'decal_flame', 'horn_beep'].map((id) => shop.get(id).price), [42, 49, 56, 84, 7, 4]);
  const r = shop.get('vehicle_rickshaw');
  assert.equal(r.price, 1);
  assert.equal(r.variants, undefined, '색 선택 없음');
  assert.equal(r.desc, '그래도 내 거야.');
  assert.equal(r.name, '낡은 인력거');
  assert.equal(shop.items.filter((i) => i.tab === 'mount').length, 11);
});

test('메모리 저장소 트랙 기록: 닉네임마다 최고 1건씩 오늘/역대 상위 · 개인 최고 · 오늘 완주 여부(tz)', async () => {
  const s = createMemoryStore();
  const now = KST('2026-09-17T10:00:00');
  const DAY = 86400 * 1000;
  await s.addTrackRecord({ nickname: '민수', studyId: 1, vehicle: 'kart', ms: 12000 }, now - 2 * DAY);
  await s.addTrackRecord({ nickname: '민수', studyId: 1, vehicle: 'sport', ms: 9000 }, now - 60000);
  await s.addTrackRecord({ nickname: '영희', studyId: 2, vehicle: 'bicycle', ms: 15000 }, now - 30000);
  await s.addTrackRecord({ nickname: '철수', studyId: null, vehicle: 'kart', ms: 11000 }, now - DAY);
  const all = await s.trackTop({ scope: 'all', tz: 'Asia/Seoul', now, limit: 5 });
  assert.deepEqual(all.map((r) => [r.nickname, r.ms]), [['민수', 9000], ['철수', 11000], ['영희', 15000]]);
  const today = await s.trackTop({ scope: 'today', tz: 'Asia/Seoul', now, limit: 5 });
  assert.deepEqual(today.map((r) => [r.nickname, r.ms]), [['민수', 9000], ['영희', 15000]]);
  assert.deepEqual((await s.trackTop({ scope: 'all', tz: 'Asia/Seoul', now, limit: 2 })).map((r) => r.nickname), ['민수', '철수']);
  assert.deepEqual(await s.trackBest('민수'), { ms: 9000, vehicle: 'sport', createdAt: now - 60000 });
  assert.equal(await s.trackBest('없음'), null);
  assert.equal(await s.hasLapToday('민수', { tz: 'Asia/Seoul', now }), true);
  assert.equal(await s.hasLapToday('철수', { tz: 'Asia/Seoul', now }), false, '어제 기록은 오늘이 아니다');
  const u = await s.upsertUser('민수', { vehicleConfig: { active: 3, decal: null, horn: 5 }, statsPublic: true });
  assert.deepEqual(u.vehicleConfig, { active: 3, decal: null, horn: 5 });
  assert.equal(u.statsPublic, true);
});

// ── 소켓 E2E ────────────────────────────────────────────────────────
const AT_DOOR = { x: 22.5 * T, y: 25 * T, facing: 'down', moving: false };
async function stepOut(socket, srv, id) {
  const p = srv.hub.worlds.get(srv.study.id).players.get(id);
  p.x = AT_DOOR.x; p.y = AT_DOOR.y;
  return ask(socket, 'door', {});
}

/** 경로를 한 이동이 maxPx 를 넘지 않게 잘게 나눈다 (소켓 테스트: 예산 상한 0.5초 × 최고 속도 × 1.5 안에서 보내려고) */
function densify(pts, maxPx = 256) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / maxPx));
    for (let k = 1; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  return out;
}

test('소켓 E2E: 문 왕복 — 스터디 → 야외(room·study 유지·playerLeft outdoor) → 문으로 복귀(inside) · 문에서 멀면 not_on_door · 야외에선 공부 상태 불가·벤치는 휴식', async (t) => {
  const srv = await boot({ world: { npc: { autoStart: false }, study: { autoTick: false } } });
  t.after(() => srv.close());
  const a = connect(srv.port);
  const b = connect(srv.port);
  t.after(() => { a.close(); b.close(); });
  const ja = await joinAs(a, { nickname: '민수' });
  await joinAs(b, { nickname: '영희' });
  assert.equal(ja.room, 'studyroom');
  assert.equal(ja.config.outdoor, false);
  assert.equal((await ask(a, 'door', {})).error, 'not_on_door');
  const left = once(b, 'playerLeft');
  const out = await stepOut(a, srv, ja.self.id);
  assert.equal(out.ok, true);
  assert.equal(out.room, 'outdoor');
  assert.equal(out.study.name, '테스트 스터디', '야외에서도 소속 스터디');
  assert.equal(out.self.studyName, '테스트 스터디');
  assert.equal(out.self.status, 'rest');
  assert.equal(out.config.outdoor, true);
  assert.deepEqual([out.self.x, out.self.y], [srv.hub.outdoor.room.spawn.x, srv.hub.outdoor.room.spawn.y]);
  assert.equal((await left).reason, 'outdoor');
  assert.equal(srv.hub.worlds.get(srv.study.id).players.has(ja.self.id), false);
  assert.ok(srv.hub.outdoor.players.has(ja.self.id));
  assert.equal(srv.hub.connectedCount, 2);
  // 야외: 공부 상태 불가, 벤치에 앉으면 휴식, 편집 불가, 스터디 정보는 소속 스터디
  assert.equal((await ask(a, 'status', { status: 'study' })).error, 'outdoor');
  assert.equal((await ask(a, 'edit:mode', { on: true })).error, 'forbidden');
  const seat = srv.hub.outdoor.room.seats[0];
  const p = srv.hub.outdoor.players.get(ja.self.id);
  p.x = (seat.x + 0.5) * T; p.y = (seat.y + 1) * T;
  const sat = await ask(a, 'sit', { seatId: seat.id });
  assert.equal(sat.ok, true);
  assert.equal(sat.status, 'rest');
  assert.equal((await ask(a, 'door', {})).error, 'seated');
  await ask(a, 'stand', {});
  assert.equal((await ask(a, 'study:info', {})).study.name, '테스트 스터디');
  // 문으로 복귀
  p.x = 31.5 * T; p.y = 20 * T;
  const joined = once(b, 'playerJoined');
  const back = await ask(a, 'door', {});
  assert.equal(back.ok, true);
  assert.equal(back.room, 'studyroom');
  assert.equal(back.self.studyName, null);
  assert.equal((await joined).player.id, ja.self.id);
  assert.ok(srv.hub.worlds.get(srv.study.id).players.has(ja.self.id));
  assert.equal(srv.hub.outdoor.players.size, 0);
  assert.equal((await ask(a, 'door', {})).error, 'not_on_door');
  // 재접속: 야외에 있는 동안 끊겨도 같은 토큰으로 야외 세션을 이어받는다
  await stepOut(a, srv, ja.self.id);
  const a2 = connect(srv.port);
  t.after(() => a2.close());
  const re = await joinAs(a2, { nickname: '민수', token: out.token });
  assert.equal(re.ok, true);
  assert.equal(re.resumed, true);
  assert.equal(re.room, 'outdoor');
  assert.equal(re.study.name, '테스트 스터디');
});

test('소켓 E2E: 격리 — 스터디 A·B 사람이 야외에서 서로 보이고 채팅·이모지가 오가지만, 스터디 안 사람에겐 야외 채팅이 안 간다 · 프로필(공개 설정) · 랭킹 이 스터디', async (t) => {
  const srv = await boot({ world: { npc: { autoStart: false }, study: { autoTick: false } } });
  t.after(() => srv.close());
  const other = (await srv.hub.createStudy({ name: '다른 스터디', ownerNickname: '방장2' })).study;
  const a = connect(srv.port);
  const b = connect(srv.port);
  const c = connect(srv.port);
  t.after(() => { a.close(); b.close(); c.close(); });
  const ja = await joinAs(a, { nickname: '민수' });
  const jb = await joinAs(b, { nickname: '영희', study: other.code });
  await joinAs(c, { nickname: '철수' }); // 스터디 A 안에 남는다
  const outA = await stepOut(a, srv, ja.self.id);
  assert.deepEqual(outA.players, []);
  const seenA = once(a, 'playerJoined');
  const pb = srv.hub.worlds.get(other.id).players.get(jb.self.id);
  pb.x = AT_DOOR.x; pb.y = AT_DOOR.y;
  const outB = await ask(b, 'door', {});
  assert.equal(outB.ok, true);
  assert.deepEqual(outB.players.map((p) => [p.nickname, p.studyName]), [['민수', '테스트 스터디']]);
  assert.equal((await seenA).player.studyName, '다른 스터디');
  // 채팅: 야외끼리만
  const chatsC = collect(c, 'chat');
  const gotB = once(b, 'chat', { filter: (m) => !m.system });
  await ask(a, 'chat', { text: '야외에서 안녕' });
  assert.equal((await gotB).text, '야외에서 안녕');
  await sleep(50);
  assert.equal(chatsC.filter((m) => !m.system).length, 0, '스터디 안 사람은 야외 채팅을 못 본다');
  const emo = once(b, 'playerEmoji');
  await ask(a, 'emoji', { index: 0 });
  assert.equal((await emo).id, ja.self.id);
  // 프로필: 기본은 비공개(weekSeconds null), 공개하면 보인다. 본인은 항상
  const pr = await ask(b, 'profile', { id: ja.self.id });
  assert.equal(pr.ok, true);
  assert.equal(pr.nickname, '민수');
  assert.equal(pr.studyName, '테스트 스터디');
  assert.equal(pr.weekSeconds, null);
  assert.equal((await ask(a, 'profile:visibility', { public: true })).statsPublic, true);
  assert.equal((await ask(b, 'profile', { id: ja.self.id })).weekSeconds, 0);
  assert.equal((await ask(a, 'profile', { id: ja.self.id })).weekSeconds, 0, '본인은 항상');
  assert.equal((await ask(b, 'profile', { id: 'nope' })).error, 'no_player');
  assert.equal((await ask(c, 'profile', { id: ja.self.id })).error, 'not_outdoor');
  assert.equal((await srv.hub.store.getUser('민수')).statsPublic, true);
  // 랭킹 '이 스터디' 는 소속 스터디 멤버 기준 (야외에서도)
  const st = await ask(a, 'stats', { scope: 'study' });
  assert.ok(st.rows.every((r) => ['민수', '철수', '방장'].includes(r.nickname)));
  assert.equal((await ask(a, 'stats', { scope: 'all' })).rows.some((r) => r.nickname === '영희'), true);
});

test('소켓 E2E: 탑승/해제 — 활성 탈것 없음 · 스터디 안 불가 · 구매 → 설정 → 소환(방송) · 앉은 채 불가 · 속도 검증(최고 초과 → move:correct) · 벽·나무 충돌 거부 · 경적 · 데칼 반영 · 해제', async (t) => {
  const srv = await boot({ world: { npc: { autoStart: false }, study: { autoTick: false } } });
  t.after(() => srv.close());
  const a = connect(srv.port);
  const b = connect(srv.port);
  t.after(() => { a.close(); b.close(); });
  const ja = await joinAs(a, { nickname: '민수' });
  const jb = await joinAs(b, { nickname: '영희' });
  assert.equal((await ask(a, 'vehicle:mount', {})).error, 'not_outdoor');
  await stepOut(a, srv, ja.self.id);
  await stepOut(b, srv, jb.self.id);
  assert.equal((await ask(a, 'vehicle:mount', {})).error, 'no_vehicle');
  assert.equal((await ask(a, 'horn', {})).error, 'not_riding');
  await srv.hub.store.adjustCoins('민수', 200, 'test');
  const buy = await ask(a, 'shop:buy', { itemId: 'vehicle_kart', variant: 'blue' });
  assert.equal(buy.ok, true);
  assert.equal(buy.balance, 200 - 56, '12단계 30% 인하가: 기본 카트 80 → 56');
  assert.equal((await ask(a, 'shop:buy', { itemId: 'vehicle_kart', variant: 'rainbow' })).error, 'no_variant');
  const decal = await ask(a, 'shop:buy', { itemId: 'decal_star' });
  const horn = await ask(a, 'shop:buy', { itemId: 'horn_bell' });
  assert.equal((await ask(a, 'vehicle:config', { active: decal.inventory.id })).error, 'not_vehicle');
  assert.equal((await ask(a, 'vehicle:config', { decal: buy.inventory.id })).error, 'not_decal');
  assert.equal((await ask(a, 'vehicle:config', { active: 99999 })).error, 'no_item');
  const cfg = await ask(a, 'vehicle:config', { active: buy.inventory.id, decal: decal.inventory.id, horn: horn.inventory.id });
  assert.deepEqual(cfg.vehicleConfig, { active: buy.inventory.id, decal: decal.inventory.id, horn: horn.inventory.id });
  const w = await ask(a, 'wallet', {});
  assert.equal(w.outdoor, true);
  assert.equal(w.inventory.find((i) => i.id === buy.inventory.id).vehicleActive, true);
  assert.deepEqual(w.vehicleConfig, cfg.vehicleConfig);
  // 앉은 채 불가
  const seat = srv.hub.outdoor.room.seats[0];
  const p = srv.hub.outdoor.players.get(ja.self.id);
  p.x = (seat.x + 0.5) * T; p.y = (seat.y + 1) * T;
  await ask(a, 'sit', { seatId: seat.id });
  assert.equal((await ask(a, 'vehicle:mount', {})).error, 'seated');
  await ask(a, 'stand', {});
  // 소환 → 모두에게 playerVehicle
  const seen = once(b, 'playerVehicle');
  const m = await ask(a, 'vehicle:mount', {});
  assert.equal(m.ok, true);
  assert.deepEqual({ type: m.vehicle.type, color: m.vehicle.color, decal: m.vehicle.decal }, { type: 'kart', color: 'blue', decal: 'star' });
  assert.deepEqual((await seen).vehicle.type, 'kart');
  assert.equal((await ask(a, 'vehicle:mount', {})).error, 'already_riding');
  assert.equal((await ask(a, 'sit', { seatId: seat.id })).error, 'riding');
  // 경적: 모두에게
  const hornSeen = once(b, 'playerHorn');
  assert.deepEqual(await ask(a, 'horn', {}), { ok: true, horn: 'bell' });
  assert.equal((await hornSeen).horn, 'bell');
  // 이동 중계에 vehicle 이 실리고, 최고 속도(450)를 넘는 speed 는 move:correct
  p.x = 49.5 * T; p.y = 34 * T; p.budget = 10000;
  const moved = once(b, 'playerMoved', { filter: (d) => d.id === ja.self.id });
  a.emit('move', { x: 49.5 * T, y: 33.5 * T, facing: 'up', moving: true, vehicle: { type: 'kart', angle: -Math.PI / 2, speed: 300 } });
  const mv = await moved;
  assert.deepEqual(mv.vehicle, { angle: -Math.PI / 2, speed: 300 });
  const corr = once(a, 'move:correct');
  a.emit('move', { x: 49.5 * T, y: 33 * T, facing: 'up', moving: true, vehicle: { type: 'kart', angle: -Math.PI / 2, speed: 700 } });
  assert.equal((await corr).reason, 'too_fast');
  // 예산: 탑승 중엔 카트 최고 속도 기준이라 걷기보다 먼 이동도 통과, 그보다 더 멀면 거부
  p.budget = 0; p.lastMoveAt = srv.hub.now() - 100; // 0.1초 → 카트 예산 450*1.5*0.1 = 67px
  const c2 = collect(a, 'move:correct');
  a.emit('move', { x: 49.5 * T, y: p.y - 60, facing: 'up', moving: true, vehicle: { type: 'kart', angle: -Math.PI / 2, speed: 400 } });
  await sleep(40);
  assert.equal(c2.length, 0, '60px 는 카트 예산 안 (걷기 예산 22px 보다 멀다)');
  p.budget = 0; p.lastMoveAt = srv.hub.now() - 100;
  a.emit('move', { x: 49.5 * T, y: p.y - 200, facing: 'up', moving: true, vehicle: { type: 'kart', angle: -Math.PI / 2, speed: 400 } });
  await sleep(40);
  assert.equal(c2.length, 1, '200px 순간이동은 거부');
  assert.equal(c2[0].reason, 'too_fast');
  // 충돌: 나무(섬 안 58,19 둥근 나무 줄기 58..59, 21) 안으로는 못 들어간다
  const tree = { x: 58.5 * T, y: 22 * T };
  assert.equal(canStand(srv.hub.outdoor.room, tree.x, tree.y), false);
  p.x = 58.5 * T; p.y = 24 * T; p.budget = 10000;
  const c3 = once(a, 'move:correct');
  a.emit('move', { x: tree.x, y: tree.y, facing: 'up', moving: true, vehicle: { type: 'kart', angle: -Math.PI / 2, speed: 100 } });
  assert.equal((await c3).reason, 'blocked');
  // 데칼 설정 변경은 탑승 중에 바로 반영(playerVehicle), 활성 탈것을 없애면 내린다
  const dv = once(b, 'playerVehicle');
  await ask(a, 'vehicle:config', { decal: null });
  assert.equal((await dv).vehicle.decal, null);
  const off = once(b, 'playerVehicle');
  await ask(a, 'vehicle:config', { active: null });
  assert.equal((await off).vehicle, null);
  assert.equal(p.vehicle, null);
  assert.equal((await ask(a, 'vehicle:dismount', {})).error, 'not_riding');
  // 다시 타고 문으로 들어가면 내려진다
  await ask(a, 'vehicle:config', { active: buy.inventory.id });
  assert.equal((await ask(a, 'vehicle:mount', {})).ok, true);
  p.x = 31.5 * T; p.y = 20 * T;
  const back = await ask(a, 'door', {});
  assert.equal(back.room, 'studyroom');
  assert.equal(back.self.vehicle, null);
});

test('소켓 E2E: 랩 — 체크포인트 순서대로 lap:progress · 역주행 reset · 완주 → lap 방송(ms·best·reward) + 시스템 채팅 + 기록 저장 · 하루 첫 완주만 +1 코인 · 전광판(오늘/역대 상위 5 · 스터디 이름) · track:board 신호', async (t) => {
  let now = KST('2026-09-17T10:00:00');
  const srv = await boot({ world: { now: () => now, npc: { autoStart: false }, study: { autoTick: false } } });
  t.after(() => srv.close());
  const a = connect(srv.port);
  const b = connect(srv.port);
  t.after(() => { a.close(); b.close(); });
  const ja = await joinAs(a, { nickname: '민수' });
  const jb = await joinAs(b, { nickname: '영희' });
  await stepOut(a, srv, ja.self.id);
  await stepOut(b, srv, jb.self.id);
  await srv.hub.store.adjustCoins('민수', 200, 'test');
  const buy = await ask(a, 'shop:buy', { itemId: 'vehicle_sport', variant: 'red' });
  assert.equal(buy.ok, true);
  await ask(a, 'vehicle:config', { active: buy.inventory.id });
  await ask(a, 'vehicle:mount', {});
  const V = { type: 'sport', angle: -Math.PI / 2, speed: 400 };
  const p = srv.hub.outdoor.players.get(ja.self.id);
  const progress = collect(a, 'lap:progress');
  const boardSignals = collect(b, 'track:board');
  const lapSeen = once(b, 'lap', { timeout: 5000 });
  const lapChat = once(b, 'chat', { filter: (m) => m.system && /완주/.test(m.text), timeout: 5000 });
  const coin = once(a, 'coins', { filter: (c) => c.reason === 'lap', timeout: 5000 });
  const path = densify(lapPath());
  const drive = async (stepMs) => {
    for (let i = 1; i < path.length; i++) {
      now += stepMs; p.budget = 10000;
      a.emit('move', { x: path[i].x, y: path[i].y, facing: 'up', moving: true, vehicle: V });
      await sleep(15);
    }
  };
  p.x = path[0].x; p.y = path[0].y;
  await drive(1000);
  const lap = await lapSeen;
  assert.equal(lap.id, ja.self.id);
  const LAP1 = (path.length - 2) * 1000; // 출발선 통과(첫 이동)부터 다시 통과(마지막 이동)까지
  assert.equal(lap.ms, LAP1, '출발선 통과부터 다시 통과까지 (테스트 시계)');
  assert.equal(lap.best, LAP1);
  assert.equal(lap.isBest, true);
  assert.equal(lap.reward, LAP_REWARD);
  assert.equal(lap.vehicle, 'sport');
  assert.ok((await lapChat).text.includes(`민수님이 트랙 한 바퀴 완주 🏁 ${(LAP1 / 1000).toFixed(1)}초 (개인 최고!)`));
  assert.equal((await coin).delta, 1);
  assert.deepEqual(progress.map((e) => e.event), ['start', 'checkpoint', 'checkpoint', 'checkpoint', 'lap']);
  assert.equal(progress[1].next, 1);
  assert.equal(progress[1].total, 3);
  assert.ok(progress[0].startedAt);
  await sleep(50);
  assert.equal(boardSignals.length, 1, '기록 저장 뒤 모두에게 track:board');
  assert.equal(await srv.hub.store.getCoins('민수'), 200 - 84 + 1, '스포츠 카트 84 · 첫 완주 +1');
  const recs = await srv.hub.store.trackTop({ scope: 'all', tz: 'Asia/Seoul', now });
  assert.deepEqual(recs.map((r) => [r.nickname, r.vehicle, r.ms, r.studyId]), [['민수', 'sport', LAP1, srv.study.id]]);
  // 두 번째 완주 (더 빠름): 보상 없음, 개인 최고 갱신
  const lap2 = once(b, 'lap', { timeout: 5000 });
  const coins2 = collect(a, 'coins');
  await drive(500);
  const l2 = await lap2;
  const LAP2 = (path.length - 1) * 500; // 완주 직후 시작된 다음 랩
  assert.equal(l2.ms, LAP2);
  assert.equal(l2.isBest, true);
  assert.equal(l2.reward, 0, '하루 첫 완주만 보상');
  await sleep(50);
  assert.equal(coins2.filter((c) => c.reason === 'lap').length, 0);
  // 역주행: 출발선을 거꾸로 지나면 reset (완주 직후 시작된 랩이 취소)
  progress.length = 0;
  p.budget = 10000;
  a.emit('move', { x: 49.5 * T, y: 34 * T, facing: 'down', moving: true, vehicle: { ...V, angle: Math.PI / 2 } });
  await sleep(40);
  assert.deepEqual(progress.map((e) => e.event), ['reset']);
  // 내리면 진행 취소 (reset), 탑승 안 한 채 지나가면 아무것도 없다
  await ask(a, 'vehicle:mount', {}).catch(() => {});
  await ask(a, 'vehicle:dismount', {});
  progress.length = 0;
  p.x = 49.5 * T; p.y = 34 * T; p.budget = 10000;
  a.emit('move', { x: 49.5 * T, y: 30 * T, facing: 'up', moving: true });
  await sleep(40);
  assert.deepEqual(progress, [], '걸어서 지나면 랩이 아니다');
  // 다음 날 첫 완주는 다시 +1 (기록에 tz 날짜 기준)
  now += 24 * 3600 * 1000;
  await ask(a, 'vehicle:mount', {});
  const coin3 = once(a, 'coins', { filter: (c) => c.reason === 'lap', timeout: 5000 });
  p.x = path[0].x; p.y = path[0].y;
  await drive(1000);
  assert.equal((await coin3).delta, 1);
  // 전광판: 오늘(다음 날) 1건 · 역대 최고 5.5초 · 스터디 이름 · 내 최고
  await srv.hub.store.addTrackRecord({ nickname: '영희', studyId: null, vehicle: 'bicycle', ms: 20000 }, now);
  const board = await ask(b, 'track:board', {});
  assert.equal(board.ok, true);
  assert.deepEqual(board.all.map((r) => [r.nickname, r.studyName, r.vehicle, r.ms]), [['민수', '테스트 스터디', 'sport', LAP2], ['영희', null, 'bicycle', 20000]]);
  assert.deepEqual(board.today.map((r) => [r.nickname, r.ms]), [['민수', LAP1], ['영희', 20000]]);
  assert.equal(board.myBest.ms, 20000, '영희 본인 최고 (직접 넣은 기록)');
  assert.equal((await ask(a, 'track:board', {})).myBest.ms, LAP2);
  assert.equal(board.track.checkpoints, 3);
  const w = await ask(a, 'wallet', {});
  assert.equal(w.trackBest.ms, LAP2);
});

// ── 브라우저 ────────────────────────────────────────────────────────
let puppeteer = null;
try { puppeteer = require('puppeteer-core'); } catch (_) { /* devDependency 없음 */ }

test('브라우저: 이중문을 밟으면 야외 씬(배지·미니맵·하늘)으로 바뀌고, V 로 탑승하면 탈것 스프라이트 + 방향키로 움직이며, 건물 문으로 돌아오면 스터디룸', { skip: !CHROME || !puppeteer ? 'Chrome/puppeteer-core 없음' : false, timeout: 180000 }, async (t) => {
  const srv = await boot({ world: { npc: { autoStart: false }, study: { autoTick: false } } });
  t.after(() => srv.close());
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: CHROME_ARGS });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.stack || e.message));
  await page.setViewport({ width: 1200, height: 800 });
  await page.goto(`http://127.0.0.1:${srv.port}/?study=${srv.code}`, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForSelector('#login:not([hidden])', { timeout: 30000 });
  await page.type('#login-nick', '민수');
  await page.click('#login-submit');
  await page.waitForFunction(() => window.NSM && window.NSM.scene.me && document.getElementById('lobby').hidden, { timeout: 30000 });
  assert.equal(await page.$eval('#place-badge', (el) => el.hidden), true);
  const mmW = await page.$eval('#minimap', (el) => el.width);
  // 문까지 걸어가서 아래로 (헤드리스는 프레임이 낮아 될 때까지 누른다)
  const me = await page.evaluate(() => ({ x: window.NSM.scene.me.x, y: window.NSM.scene.me.y }));
  await walk(page, pathTo(room, Math.floor(me.x / T), Math.floor((me.y - 1) / T), (x, y) => x === 22 && y === 24));
  await page.keyboard.down('ArrowDown');
  await page.waitForFunction(() => window.NSM.scene.transferring || window.NSM.net.room === 'outdoor', { timeout: 20000, polling: 100 });
  await page.keyboard.up('ArrowDown');
  await page.waitForFunction(() => window.NSM.net.room === 'outdoor' && window.NSM.scene.room.id === 'outdoor' && window.NSM.scene.me && window.NSM.scene.ready, { timeout: 30000 });
  assert.equal(await page.$eval('#place-badge', (el) => el.hidden), false);
  assert.equal(await page.$eval('#study-name', (el) => el.textContent), '테스트 스터디', '소속 스터디 배지는 그대로');
  assert.notEqual(await page.$eval('#minimap', (el) => el.width), mmW, '미니맵이 야외 크기로');
  assert.ok(await page.evaluate(() => window.NSM.scene.skies.length === 1 && window.NSM.scene.boardTexts !== null && document.body.classList.contains('outdoor')));
  assert.equal(srv.hub.outdoor.players.size, 1);
  // 탑승: 카트 구매 → 활성 → V → 스프라이트 · 방향키로 움직임 (오른쪽으로 가속)
  await srv.store.adjustCoins('민수', 100, 'test');
  const buy = await page.evaluate(() => window.NSM.net.buy('vehicle_kart', 'green'));
  await page.evaluate((id) => window.NSM.net.vehicleConfig({ active: id }), buy.inventory.id);
  await page.keyboard.press('KeyV');
  await page.waitForFunction(() => window.NSM.scene.me.riding && window.NSM.scene.me.vehicle.sprite, { timeout: 5000 });
  assert.match(await page.evaluate(() => window.NSM.scene.me.vehicle.sprite.frame.name), /^kart\|green\|/);
  const x0 = await page.evaluate(() => window.NSM.scene.me.x);
  await page.keyboard.down('ArrowRight');
  await page.waitForFunction((x) => window.NSM.scene.me.x > x + 40, { timeout: 10000, polling: 100 }, x0);
  await page.keyboard.up('ArrowRight');
  assert.equal(await page.evaluate(() => window.NSM.scene.me.vehicle.dir), 'e');
  await page.waitForFunction(() => window.NSM.scene.me.vehicle.vehicle.speed === 0, { timeout: 10000, polling: 100 });
  const sp = srv.hub.outdoor.players.get(await page.evaluate(() => window.NSM.scene.me.id));
  assert.ok(sp.vehicle && sp.vehicle.type === 'kart', '서버도 탑승 상태');
  assert.ok(Math.abs(sp.x - (await page.evaluate(() => window.NSM.scene.me.x))) < 20, '서버 위치가 따라온다');
  await page.keyboard.press('KeyV');
  await page.waitForFunction(() => !window.NSM.scene.me.riding, { timeout: 5000 });
  // 건물 문으로 복귀: 서버 위치를 문 앞으로 옮기고 위로 걷는다
  sp.x = 31.5 * T; sp.y = 22 * T;
  await page.evaluate((x, y) => { window.NSM.scene.me.setPosition(x, y); window.NSM.scene.lastSent = null; window.NSM.scene.doorArmed = true; }, sp.x, sp.y);
  await page.keyboard.down('ArrowUp');
  await page.waitForFunction(() => window.NSM.scene.transferring || window.NSM.net.room === 'studyroom', { timeout: 20000, polling: 100 });
  await page.keyboard.up('ArrowUp');
  await page.waitForFunction(() => window.NSM.net.room === 'studyroom' && window.NSM.scene.room.id === 'studyroom' && window.NSM.scene.me && window.NSM.scene.ready, { timeout: 30000 });
  assert.equal(await page.$eval('#place-badge', (el) => el.hidden), true);
  assert.equal(await page.$eval('#minimap', (el) => el.width), mmW);
  assert.equal(srv.hub.outdoor.players.size, 0);
  assert.deepEqual(errors, []);
});
