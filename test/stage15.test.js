'use strict';
/**
 * 15단계 A: 2인 스터디룸 구조 변경 — 좌석 id 마이그레이션(별칭) · 기존 room_layout 마이그레이션(놓을 수 없게 된 가구 회수) ·
 *           모니터 연결 · 문 명패(roomLabel, 방장 설정) · 마지막에 앉은 자리 기억(seatLast).
 * 순수 로직만 (서버를 띄우지 않는다 → unit 그룹).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { World } = require('../server/game/world');
const { Hub, ROOM_LABEL_MAX } = require('../server/game/hub');
const { createMemoryStore } = require('../server/store/memory');
const { getStudyRoom } = require('../server/rooms/studyroom');
const { canonicalSeatId } = require('../server/rooms/build');

const room = getStudyRoom();
const quiet = { log() {}, warn() {}, error() {} };
const T = 32;

function makeWorld(opts = {}) {
  let t = new Date('2026-09-17T10:00:00+09:00').getTime();
  const store = opts.store || createMemoryStore();
  const logs = [];
  const log = { log: (m) => logs.push(m), warn: (m) => logs.push(m), error() {} };
  const world = new World(room, { store, npc: { autoStart: false }, study: { autoTick: false }, now: () => t, log, tz: 'Asia/Seoul', ...opts.world });
  return { world, store, logs, advance: (ms) => { t += ms; } };
}

test('좌석 마이그레이션: 옛 방 A/B 의자 id(seat-8/seat-9)로 앉기 요청이 와도 새 좌석(study-a/b)에 앉고, 점유·화면은 새 id 기준', async () => {
  assert.equal(canonicalSeatId(room, 'seat-8'), 'study-a');
  assert.equal(canonicalSeatId(room, 'seat-9'), 'study-b');
  assert.equal(canonicalSeatId(room, 'seat-0'), 'seat-0', '별칭이 없으면 그대로');
  const { world } = makeWorld();
  const a = world.join({ nickname: '민수', socketId: 'sa' }).player;
  const b = world.join({ nickname: '영희', socketId: 'sb' }).player;
  a.x = 21.5 * T; a.y = 15 * T;
  const r = world.sit(a, 'seat-8');
  assert.equal(r.ok, true);
  assert.equal(r.seat.id, 'study-a');
  assert.equal(a.seatId, 'study-a', '플레이어에는 새 id 로 기록');
  assert.deepEqual(world.seatSnapshot(), { 'study-a': a.id });
  b.x = 21.5 * T; b.y = 15 * T;
  assert.deepEqual(world.sit(b, 'study-a'), { ok: false, error: 'occupied' }, '옛 id 로 앉은 자리는 새 id 로도 점유');
  assert.deepEqual(world.sit(b, 'seat-8'), { ok: false, error: 'occupied' });
  b.x = 23.5 * T; b.y = 15 * T;
  assert.equal(world.sit(b, 'seat-9').seat.id, 'study-b');
  // 모니터는 새 좌석에 연결
  assert.deepEqual(room.screens.filter((s) => s.kind === 'monitor').map((s) => s.seatId), ['study-a', 'study-b']);
  // 마지막에 앉은 자리 기억 (seatLast)
  assert.deepEqual(world.seatLastSnapshot(), { 'study-a': '민수', 'study-b': '영희' });
  world.stand(a);
  assert.deepEqual(world.seatLastSnapshot(), { 'study-a': '민수', 'study-b': '영희' }, '일어나도 남는다');
  a.x = 18.5 * T; a.y = 7 * T;
  assert.equal(world.sit(a, 'seat-0').ok, true);
  assert.deepEqual(world.seatLastSnapshot(), { 'seat-0': '민수', 'study-b': '영희' }, '다른 자리에 앉으면 옛 자리는 지운다');
  assert.equal(world.seat('seat-999'), null);
  await world.dispose();
});

test('room_layout 마이그레이션: 맵 개편으로 놓을 수 없게 된 가구는 init() 에서 회수(저장소 삭제 → 인벤토리로), 나머지는 유지', async () => {
  const store = createMemoryStore();
  const inv1 = await store.addInventory('민수', 'floor_lamp', {});
  const inv2 = await store.addInventory('민수', 'beanbag', {});
  const inv3 = await store.addInventory('민수', 'poster', {});
  const inv4 = await store.addInventory('민수', 'bed', {});
  // 옛 방 A 책상 옆 (지금은 긴 책상 위) · 옛 통로 (지금은 빈 바닥) · 옛 방 A 위쪽 벽(지금은 바닥) · 새 슬라이딩 패널 자리
  await store.addLayout('studyroom', { itemId: 'floor_lamp', inventoryId: inv1.id, x: 22, y: 12, rotation: 0, meta: {}, placedBy: '민수' });
  await store.addLayout('studyroom', { itemId: 'beanbag', inventoryId: inv2.id, x: 17, y: 16, rotation: 0, meta: {}, placedBy: '민수' });
  await store.addLayout('studyroom', { itemId: 'poster', inventoryId: inv3.id, x: 11, y: 10, rotation: 0, meta: {}, placedBy: '민수' });
  await store.addLayout('studyroom', { itemId: 'bed', inventoryId: inv4.id, x: 20, y: 19, rotation: 0, meta: {}, placedBy: '민수' });
  const { world, logs } = makeWorld({ store });
  await world.init();
  assert.deepEqual(world.recalledLayout.map((e) => [e.itemId, e.error]).sort(), [['bed', 'blocked'], ['floor_lamp', 'blocked'], ['poster', 'wall_only']]);
  assert.deepEqual(world.listLayout().map((e) => e.itemId), ['beanbag']);
  assert.deepEqual((await store.roomLayout('studyroom')).map((e) => e.itemId), ['beanbag'], '저장소에서도 지워진다');
  assert.equal((await store.listInventory('민수')).length, 4, '인벤토리 행은 그대로 → 팔레트에 다시 보인다');
  const w = await world.wallet(world.join({ nickname: '민수', socketId: 'sa' }).player);
  assert.deepEqual(w.inventory.map((i) => [i.itemId, i.placed]), [['floor_lamp', false], ['beanbag', true], ['poster', false], ['bed', false]]);
  assert.equal(logs.filter((m) => /맵 개편으로 가구 회수/.test(m)).length, 3);
  await world.dispose();
});

test('문 명패(roomLabel): 방장만 설정, 12자 이내·공백 정리, 비우면 null(스터디 이름 표시), publicStudy 에 실린다', async () => {
  let t = Date.now();
  const store = createMemoryStore();
  const hub = new Hub({ room, store, tz: 'Asia/Seoul', now: () => t, log: quiet, world: { npc: { autoStart: false }, study: { autoTick: false } }, goalCheckMs: 0, releaseMs: 1000 });
  await hub.init();
  const r = await hub.createStudy({ name: '새벽 코딩방', ownerNickname: '민수' });
  assert.equal(r.study.roomLabel, null, '기본은 없음 (클라이언트가 스터디 이름을 쓴다)');
  assert.equal(ROOM_LABEL_MAX, 12);
  assert.deepEqual(await hub.updateStudy(r.study.code, '영희', { roomLabel: 'x' }), { ok: false, error: 'forbidden' });
  assert.deepEqual(await hub.updateStudy(r.study.code, '민수', { roomLabel: '가'.repeat(13) }), { ok: false, error: 'invalid_label' });
  assert.deepEqual(await hub.updateStudy(r.study.code, '민수', { roomLabel: 123 }), { ok: false, error: 'invalid_label' });
  const u = await hub.updateStudy(r.study.code, '민수', { roomLabel: '  새벽팀   ROOM ' });
  assert.equal(u.ok, true);
  assert.equal(u.study.roomLabel, '새벽팀 ROOM');
  assert.equal((await store.getStudy(r.study.id)).roomLabel, '새벽팀 ROOM', '저장소에도');
  assert.equal(hub.publicStudy(hub.resolve(r.study.code)).roomLabel, '새벽팀 ROOM');
  const u2 = await hub.updateStudy(r.study.code, '민수', { roomLabel: '' });
  assert.equal(u2.study.roomLabel, null, '비우면 다시 스터디 이름');
  const u3 = await hub.updateStudy(r.study.code, '민수', { name: '이름만' });
  assert.equal(u3.study.roomLabel, null, '다른 설정만 바꾸면 명패는 그대로');
  await hub.dispose();
});

test('2인 책상 슬롯: 방 데이터가 명시한 슬롯은 두 사람이 겹치지 않고 모니터·공유 화분 칸을 피한다', () => {
  const L = require('../server/game/layout');
  const a = L.deskSlots(room, room.seats.find((s) => s.id === 'study-a'));
  const b = L.deskSlots(room, room.seats.find((s) => s.id === 'study-b'));
  const key = (c) => `${c.tx},${c.ty}`;
  assert.equal(new Set([...a.map(key), ...b.map(key)]).size, 6, '6칸 모두 다르다');
  for (const c of [...a, ...b]) {
    assert.equal(L.occupantAt(room, c.tx, c.ty).name, 'desk_long', key(c));
    assert.ok(![21, 22, 23].includes(c.tx) || c.ty !== 12, `모니터·화분 칸이 아니다 ${key(c)}`);
  }
});
