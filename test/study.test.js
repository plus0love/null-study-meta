'use strict';
/**
 * 4단계: 공부 세션 규칙(60초·전환·재접속·종료 저장), 출석 스트릭(경계일·주 시작), 목표 달성 이벤트, 할 일 이월,
 * 메모리 저장소 인터페이스, 소켓 E2E(랭킹·목표·할 일·leaderboard:refresh). 모두 STORE=memory.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { dateKey, addDays, weekStart, streakOf, totalsOf } = require('../server/store/stats');
const { createMemoryStore } = require('../server/store/memory');
const { createStore } = require('../server/store');
const { StudyTracker } = require('../server/game/study');
const { World } = require('../server/game/world');
const { getStudyRoom } = require('../server/rooms/studyroom');
const { boot, connect, joinAs, ask, once, sleep } = require('./helpers');

const room = getStudyRoom();
const TZ = 'Asia/Seoul';
const KST = (iso) => new Date(`${iso}+09:00`).getTime();

function makeWorld(opts = {}) {
  let t = KST('2026-09-16T10:00:00');
  const store = createMemoryStore();
  const world = new World(room, { now: () => t, store, tz: TZ, npc: { autoStart: false }, study: { autoTick: false }, log: { warn() {}, log() {} }, ...opts });
  const advance = (ms) => { t += ms; };
  const seat = room.seats[0];
  const sitDown = (p) => { p.x = (seat.x + 0.5) * 32; p.y = (seat.y + 1) * 32; return world.sit(p, seat.id); };
  return { world, store, advance, now: () => t, seat, sitDown };
}

const flush = () => new Promise((r) => setImmediate(r));

test('날짜 규칙: 시간대 기준 0시 경계, 월요일 주 시작, 세션은 시작 시각의 날짜로 집계', () => {
  // KST 2026-09-16 00:30 = UTC 09-15 15:30 → 서울 기준 16일
  assert.equal(dateKey(KST('2026-09-16T00:30:00'), TZ), '2026-09-16');
  assert.equal(dateKey(KST('2026-09-16T00:30:00'), 'UTC'), '2026-09-15');
  assert.equal(dateKey(KST('2026-09-15T23:59:59'), TZ), '2026-09-15');
  assert.equal(addDays('2026-09-16', -16), '2026-08-31');
  assert.equal(weekStart('2026-09-16'), '2026-09-14', '수요일 → 월요일'); // 2026-09-14 은 월요일
  assert.equal(weekStart('2026-09-14'), '2026-09-14');
  assert.equal(weekStart('2026-09-13'), '2026-09-07', '일요일은 지난 월요일');
  const now = KST('2026-09-16T12:00:00');
  const t = totalsOf([
    { nickname: 'A', startedAt: KST('2026-09-16T01:00:00'), seconds: 600 },
    { nickname: 'A', startedAt: KST('2026-09-15T23:50:00'), seconds: 1200 }, // 어제 시작 → 어제
    { nickname: 'A', startedAt: KST('2026-09-13T10:00:00'), seconds: 5000 }, // 지난 주
    { nickname: 'B', startedAt: KST('2026-09-14T10:00:00'), seconds: 300 },
  ], now, TZ);
  assert.deepEqual(t.get('A'), { nickname: 'A', todaySeconds: 600, weekSeconds: 1800 });
  assert.deepEqual(t.get('B'), { nickname: 'B', todaySeconds: 0, weekSeconds: 300 });
});

test('출석 스트릭: 오늘 출석했으면 오늘부터, 아니면 어제부터 연속, 이번 주 출석 일수', () => {
  assert.deepEqual(streakOf(['2026-09-14', '2026-09-15', '2026-09-16'], '2026-09-16'), { streak: 3, weekDays: 3, attendedToday: true });
  assert.deepEqual(streakOf(['2026-09-14', '2026-09-15'], '2026-09-16'), { streak: 2, weekDays: 2, attendedToday: false }, '오늘 아직 안 왔으면 어제까지');
  assert.deepEqual(streakOf(['2026-09-13', '2026-09-14'], '2026-09-16'), { streak: 0, weekDays: 1, attendedToday: false }, '하루 건너뛰면 끊김');
  assert.deepEqual(streakOf(['2026-08-30', '2026-08-31', '2026-09-01'], '2026-09-01'), { streak: 3, weekDays: 2, attendedToday: true }, '월 경계·주 경계(8/31 월요일)');
  assert.deepEqual(streakOf([], '2026-09-16'), { streak: 0, weekDays: 0, attendedToday: false });
  const many = [];
  for (let i = 0; i < 40; i++) many.push(addDays('2026-09-16', -i));
  assert.equal(streakOf(many, '2026-09-16').streak, 40);
});

test('메모리 저장소: 세션·출석·목표·할 일(이월)·강아지 이름', async () => {
  const s = createMemoryStore();
  const now = KST('2026-09-16T10:00:00');
  await s.saveSession({ nickname: 'A', startedAt: now - 3600e3, endedAt: now - 3000e3, seconds: 600 });
  await s.saveSession({ nickname: 'A', startedAt: KST('2026-09-14T10:00:00'), endedAt: 0, seconds: 100 });
  assert.deepEqual(await s.studyTotals({ tz: TZ, now }), [{ nickname: 'A', todaySeconds: 600, weekSeconds: 700 }]);
  assert.deepEqual(await s.recordAttendance('A', '2026-09-16'), { inserted: true });
  assert.deepEqual(await s.recordAttendance('A', '2026-09-16'), { inserted: false });
  await s.recordAttendance('A', '2026-09-15');
  assert.deepEqual(await s.attendanceOf('A', { tz: TZ, now }), { streak: 2, weekDays: 2, attendedToday: true });
  assert.deepEqual(await s.attendanceStats({ tz: TZ, now }), [{ nickname: 'A', streak: 2, weekDays: 2, attendedToday: true }]);
  assert.equal(await s.getGoal('A', '2026-09-16'), null);
  await s.setGoal('A', '2026-09-16', { goalText: '알고리즘 3문제', targetMinutes: 90 });
  assert.deepEqual(await s.getGoal('A', '2026-09-16'), { nickname: 'A', date: '2026-09-16', goalText: '알고리즘 3문제', targetMinutes: 90 });
  // 할 일: 어제 만든 미완료 → 이월(맨 위), 어제 완료한 것은 안 보임, 오늘 완료한 것은 보임
  const old = await s.addTodo('A', '어제 것', KST('2026-09-15T09:00:00'));
  const oldDone = await s.addTodo('A', '어제 끝냄', KST('2026-09-15T09:00:00'));
  await s.setTodoDone('A', oldDone.id, true, KST('2026-09-15T20:00:00'));
  const fresh = await s.addTodo('A', '오늘 것', now);
  const doneToday = await s.addTodo('A', '오늘 끝냄', now + 1);
  await s.setTodoDone('A', doneToday.id, true, now + 2);
  const list = await s.listTodos('A', { tz: TZ, now });
  assert.deepEqual(list.map((t) => [t.text, t.carried, t.done]), [['어제 것', true, false], ['오늘 것', false, false], ['오늘 끝냄', false, true]]);
  assert.equal(list[2].doneAt, now + 2);
  assert.equal(await s.setTodoDone('B', old.id, true), null, '남의 할 일은 못 바꿈');
  assert.equal(await s.deleteTodo('A', fresh.id), true);
  assert.equal(await s.deleteTodo('A', fresh.id), false);
  assert.equal(await s.getLatestDogName(), null);
  await s.upsertUser('A', { dogName: '초코' });
  await sleep(2);
  await s.upsertUser('B', { dogName: '몽이' });
  assert.equal(await s.getLatestDogName(), '몽이', '마지막 변경값');
  const u = await s.getUser('A');
  assert.equal(u.dogName, '초코');
});

test('세션 규칙: 앉아서 공부 중인 구간만, 60초 미만 폐기, 휴식·커피 전환/일어나기/퇴장 시 저장, 재접속 이어받기 시 유지', async () => {
  const { world, store, advance, sitDown } = makeWorld();
  const saved = [];
  const discarded = [];
  world.study.on('saved', (e) => saved.push(e));
  world.study.on('discarded', (e) => discarded.push(e));
  const p = world.join({ nickname: '민수', socketId: 's1' }).player;
  assert.equal(sitDown(p).ok, true);
  assert.ok(world.study.live.has('민수'), '앉으면 세션 시작');
  advance(59 * 1000);
  world.stand(p);
  await flush();
  assert.equal(saved.length, 0);
  assert.equal(discarded.length, 1, '59초는 폐기');
  // 다시 앉아 70초 → 휴식으로 전환하면 저장
  sitDown(p);
  advance(70 * 1000);
  await world.setStatus(p, 'rest');
  await flush();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].seconds, 70);
  assert.ok(!world.study.live.has('민수'));
  // 앉은 채 다시 공부 → 새 세션. 연결 끊김(유예)에도 이어진다
  world.setStatus(p, 'study');
  assert.ok(world.study.live.has('민수'));
  advance(30 * 1000);
  world.disconnect(p);
  assert.ok(world.study.live.has('민수'), '유예 중엔 유지');
  const re = world.join({ nickname: '민수', token: p.token, socketId: 's2' });
  assert.equal(re.resumed, true);
  advance(40 * 1000);
  // 유예 만료로 정리되면 저장 (70초)
  world.remove(p.id, 'timeout');
  await flush();
  assert.equal(saved.length, 2);
  assert.equal(saved[1].seconds, 70);
  const sessions = await store.listSessions('민수');
  assert.equal(sessions.length, 2);
  // 서버 종료(dispose) 시 진행 중 세션 저장
  const q = world.join({ nickname: '영희', socketId: 's3' }).player;
  sitDown(q);
  advance(120 * 1000);
  await world.dispose();
  assert.equal(saved.length, 3);
  assert.equal(saved[2].nickname, '영희');
  assert.equal(saved[2].reason, 'shutdown');
});

test('출석: 첫 세션 저장 또는 진행 중 60초에 기록(하루 한 번), 스트릭 이벤트, 입장 프로필', async () => {
  const { world, advance, sitDown } = makeWorld();
  const att = [];
  world.on('attendance', (e) => att.push(e));
  const p = world.join({ nickname: '민수', socketId: 's1' }).player;
  assert.deepEqual((await world.loadProfile(p)).streak, { streak: 0, weekDays: 0, attendedToday: false });
  sitDown(p);
  advance(61 * 1000);
  await world.study.tick(); // 진행 중 60초 → 출석
  assert.equal(att.length, 1);
  assert.deepEqual({ inserted: att[0].inserted, streak: att[0].streak, attendedToday: att[0].attendedToday }, { inserted: true, streak: 1, attendedToday: true });
  advance(60 * 1000);
  world.stand(p);
  await flush();
  assert.equal(att.length, 1, '저장 때 다시 기록하지 않음 (이미 출석)');
  sitDown(p);
  advance(120 * 1000);
  world.stand(p);
  await flush();
  assert.equal(att.length, 2);
  assert.equal(att[1].inserted, false, '같은 날 두 번째는 inserted=false');
  assert.deepEqual((await world.loadProfile(p)).streak, { streak: 1, weekDays: 1, attendedToday: true });
  // 다음 날 → 스트릭 2, 주가 넘어가면(9/21 월) weekDays 리셋
  advance(24 * 3600 * 1000);
  sitDown(p);
  advance(90 * 1000);
  world.stand(p);
  await flush();
  assert.equal(att.at(-1).streak, 2);
  assert.equal(att.at(-1).weekDays, 2);
  advance(5 * 24 * 3600 * 1000); // 9/22 화 — 9/17 이후 안 왔으므로 끊김
  assert.deepEqual((await world.loadProfile(p)).streak, { streak: 0, weekDays: 0, attendedToday: false });
  await world.dispose();
});

test('오늘 목표: 검증(20자·30분 단위·30분~8시간), 누적이 목표에 닿는 순간 한 번만 goalReached, 다음 날 리셋', async () => {
  const { world, advance, sitDown } = makeWorld();
  const reached = [];
  world.on('goalReached', (e) => reached.push(e));
  const p = world.join({ nickname: '민수', socketId: 's1' }).player;
  assert.equal((await world.setGoal(p, { text: 'a'.repeat(21), targetMinutes: 30 })).error, 'text_too_long');
  assert.equal((await world.setGoal(p, { text: '', targetMinutes: 45 })).error, 'invalid_minutes');
  assert.equal((await world.setGoal(p, { text: '', targetMinutes: 20 })).error, 'invalid_minutes');
  assert.equal((await world.setGoal(p, { text: '', targetMinutes: 510 })).error, 'invalid_minutes');
  const g = await world.setGoal(p, { text: '  영어 단어 50개 ', targetMinutes: 30 });
  assert.deepEqual(g, { ok: true, goal: { text: '영어 단어 50개', targetMinutes: 30 }, reached: false });
  assert.deepEqual(world.publicPlayer(p).goal, { text: '영어 단어 50개', targetMinutes: 30 });
  sitDown(p);
  advance(29 * 60 * 1000);
  await world.study.tick();
  assert.equal(reached.length, 0);
  advance(61 * 1000); // 30분 1초 → 달성
  await world.study.tick();
  assert.equal(reached.length, 1);
  assert.equal(reached[0].nickname, '민수');
  assert.equal(reached[0].targetMinutes, 30);
  advance(10 * 60 * 1000);
  await world.study.tick();
  world.stand(p);
  await flush();
  assert.equal(reached.length, 1, '하루에 한 번');
  // 이미 넘긴 목표를 다시 잡으면 reached=true 지만 🎉 는 없음, 더 높게 잡으면 그 목표에 닿을 때 다시 달성
  assert.equal((await world.setGoal(p, { text: '', targetMinutes: 30 })).reached, true);
  assert.equal(reached.length, 1);
  assert.equal((await world.setGoal(p, { text: '', targetMinutes: 60 })).reached, false);
  sitDown(p);
  advance(25 * 60 * 1000); // 누적 40+25 = 65분
  await world.study.tick();
  assert.equal(reached.length, 2);
  world.stand(p);
  await flush();
  // 다음 날: 목표는 날짜별, 누적 0 부터
  advance(24 * 3600 * 1000);
  assert.equal((await world.loadProfile(p)).goal, null);
  await world.study.tick();
  assert.equal(world.study.todaySeconds('민수'), 0);
  assert.equal((await world.setGoal(p, { text: '새 목표', targetMinutes: 30 })).reached, false);
  await world.dispose();
});

test('랭킹 통계: 저장분 + 진행 중 초, 진행 중/접속 표시, 스트릭 포함', async () => {
  const { world, advance, sitDown } = makeWorld();
  const a = world.join({ nickname: 'A', socketId: 's1' }).player;
  const b = world.join({ nickname: 'B', socketId: 's2' }).player;
  sitDown(a);
  advance(100 * 1000);
  world.stand(a);
  await flush();
  b.x = a.x; b.y = a.y;
  world.sit(b, room.seats[0].id);
  advance(30 * 1000);
  const st = await world.stats();
  assert.equal(st.store, 'memory');
  assert.equal(st.tz, TZ);
  assert.equal(st.date, '2026-09-16');
  const rows = Object.fromEntries(st.rows.map((r) => [r.nickname, r]));
  assert.deepEqual(rows.A, { nickname: 'A', todaySeconds: 100, weekSeconds: 100, streak: 1, weekDays: 1, live: false, online: true, coins: 0, weekCoins: 0 });
  assert.deepEqual(rows.B, { nickname: 'B', todaySeconds: 30, weekSeconds: 30, streak: 0, weekDays: 0, live: true, online: true, coins: 0, weekCoins: 0 });
  await world.dispose();
});

test('저장소 폴백: 키가 없으면 메모리, 같은 인터페이스', async () => {
  const s = await createStore({ STORE: 'supabase' }, { warn() {}, log() {} });
  assert.equal(s.kind, 'memory');
  for (const m of ['ping', 'upsertUser', 'getUser', 'getLatestDogName', 'saveSession', 'studyTotals', 'recordAttendance', 'attendanceOf', 'attendanceStats', 'listTodos', 'addTodo', 'setTodoDone', 'deleteTodo', 'getGoal', 'setGoal', 'close']) {
    assert.equal(typeof s[m], 'function', m);
  }
  const { createSupabaseStore } = require('../server/store/supabase');
  const sb = createSupabaseStore({ url: 'https://example.supabase.co', key: 'k' });
  assert.equal(sb.kind, 'supabase');
  for (const m of Object.keys(s)) assert.equal(typeof sb[m], typeof s[m], `supabase 저장소에 ${m} 없음`);
});

test('소켓 E2E: 입장 ack 프로필/저장소, 목표 브로드캐스트, 세션 저장 → leaderboard:refresh·출석·목표 달성, 할 일 CRUD', async (t) => {
  let now = KST('2026-09-16T10:00:00');
  const srv = await boot({ world: { now: () => now, npc: { autoStart: false }, study: { autoTick: false } } });
  t.after(() => srv.close());
  const a = connect(srv.port);
  const b = connect(srv.port);
  t.after(() => { a.close(); b.close(); });
  const ja = await joinAs(a, { nickname: '민수' });
  await joinAs(b, { nickname: '영희' });
  assert.equal(ja.store, 'memory');
  assert.equal(ja.tz, 'Asia/Seoul');
  assert.deepEqual(ja.profile, { goal: null, streak: { streak: 0, weekDays: 0, attendedToday: false }, coins: 0, rewards: [], coinProgress: { carrySeconds: 0, nextCoinAt: null, studying: false }, vehicleConfig: { active: null, decal: null, horn: null }, statsPublic: false, ddays: { board: [], celebrate: [] }, unreadNotes: [], pendingGifts: [] });

  // 목표 설정 → 모두에게 playerGoal, 다른 사람 입장 목록에도 포함
  const goalSeen = once(b, 'playerGoal');
  assert.deepEqual(await ask(a, 'goal:set', { text: '리액트 챕터 3', targetMinutes: 30 }), { ok: true, goal: { text: '리액트 챕터 3', targetMinutes: 30 }, reached: false });
  assert.deepEqual(await goalSeen, { id: ja.self.id, goal: { text: '리액트 챕터 3', targetMinutes: 30 } });
  assert.equal((await ask(a, 'goal:set', { text: 'x', targetMinutes: 7 })).error, 'invalid_minutes');

  // 앉아서 31분 → 출석(본인) + 목표 달성(모두) + 시스템 채팅, 일어나면 세션 저장 → leaderboard:refresh
  const pa = srv.world.players.get(ja.self.id);
  const seat = room.seats[0];
  pa.x = (seat.x + 0.5) * 32;
  pa.y = (seat.y + 1) * 32;
  assert.equal((await ask(a, 'sit', { seatId: seat.id })).ok, true);
  now += 31 * 60 * 1000;
  const attSeen = once(a, 'attendance');
  const reachedSeen = once(b, 'goalReached');
  const chatSeen = once(b, 'chat', { filter: (c) => c.system });
  await srv.world.study.tick();
  assert.deepEqual(await attSeen, { streak: 1, weekDays: 1 });
  assert.deepEqual(await reachedSeen, { id: ja.self.id, nickname: '민수' });
  assert.equal((await chatSeen).text, '민수님이 오늘 목표를 달성했어요 🎉');
  const refresh = once(b, 'leaderboard:refresh', { filter: (r) => r.seconds > 0 });
  await ask(a, 'stand');
  assert.deepEqual(await refresh, { nickname: '민수', seconds: 31 * 60 });
  const st = await ask(b, 'stats');
  assert.equal(st.ok, true);
  const me = st.rows.find((r) => r.nickname === '민수');
  assert.equal(me.todaySeconds, 31 * 60);
  assert.equal(me.streak, 1);
  assert.equal(me.live, false);
  // 재입장하면 프로필에 출석·목표가 실린다
  const c = connect(srv.port);
  t.after(() => c.close());
  const jc = await joinAs(c, { nickname: '민수' }); // 중복 닉 → 민수2 (다른 사용자)
  assert.equal(jc.self.nickname, '민수2');
  assert.equal(jc.players.find((p) => p.id === ja.self.id).goal.text, '리액트 챕터 3');

  // 할 일
  assert.deepEqual(await ask(a, 'todo:list'), { ok: true, todos: [] });
  const added = await ask(a, 'todo:add', { text: '  단어 외우기 ' });
  assert.equal(added.ok, true);
  assert.equal(added.todo.text, '단어 외우기');
  assert.equal((await ask(a, 'todo:add', { text: '   ' })).error, 'empty');
  const toggled = await ask(a, 'todo:toggle', { id: added.todo.id, done: true });
  assert.equal(toggled.todo.done, true);
  assert.ok(toggled.todo.doneAt);
  assert.equal((await ask(b, 'todo:toggle', { id: added.todo.id, done: false })).error, 'not_found', '남의 할 일');
  assert.equal((await ask(a, 'todo:list')).todos.length, 1);
  assert.deepEqual(await ask(a, 'todo:delete', { id: added.todo.id }), { ok: true });
  assert.deepEqual(await ask(a, 'todo:list'), { ok: true, todos: [] });

  // 강아지 이름 → 저장소 (마지막 값)
  await ask(a, 'npc:name', { id: 'dog', name: '초코' });
  await sleep(10);
  assert.equal(await srv.store.getLatestDogName(), '초코');
});
