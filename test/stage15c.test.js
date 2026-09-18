'use strict';
/**
 * 15단계 C: 쪽지 · 커피 배달 · D-day.
 *  - D-day 순수 함수: daysLeft(자정 경계, tz) · 7일 뒤 숨김 · 칠판 정렬 · 검증 · 당일 연출 키.
 *  - 월드: 쪽지(상대 자리 판정·거리·60자·저장·앉으면 알림·읽음·쪽지함) · 커피(잔액 차감·부족·바로/자리에 놓기·앉으면 받기·10분 버프 만료) ·
 *    D-day(등록·공용·삭제 권한·당일 연출 1회·자정 넘김).
 *  - 소켓 E2E: note:leave → note:waiting/seatItems · note:read · coffee:gift → coins/coffee:received/playerBuff/seatItems/chat · dday:add → dday:update · 입장 ack profile.
 *  - 브라우저: 남의 자리 앞 E → 자리 선택 → 쪽지 모달 → 상대가 앉으면 책상 위 쪽지 아이콘 + 토스트 → E 로 읽기 · 커피 코너 E → 메뉴 모달 → 배달 → 머그 아이콘 · ❤️☕ ·
 *    D-day 칠판 글자 · 실내 연출(가구 그림자·빛 웅덩이·비·김·시계·명패·코르크보드).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const Dday = require('../server/game/dday');
const { World, NOTE_MAX, COFFEE_BUFF_MS } = require('../server/game/world');
const { createMemoryStore } = require('../server/store/memory');
const { getStudyRoom } = require('../server/rooms/studyroom');
const { boot, connect, joinAs, ask, once, sleep, collect, pageUrl, openSettings, CHROME, CHROME_ARGS } = require('./helpers');

const room = getStudyRoom();
const T = 32;
const KST = (iso) => new Date(`${iso}+09:00`).getTime();
const quiet = { log() {}, warn() {}, error() {} };
const MIN = 60 * 1000;

function makeWorld(opts = {}) {
  let t = KST('2026-09-17T10:00:00');
  const store = opts.store || createMemoryStore();
  const events = {};
  const world = new World(room, { store, npc: { autoStart: false }, study: { autoTick: false }, now: () => t, log: quiet, tz: 'Asia/Seoul', members: opts.members || null, ...opts.world });
  for (const ev of ['note', 'notesWaiting', 'seatItems', 'coffee', 'buff', 'coins', 'ddays']) { events[ev] = []; world.on(ev, (e) => events[ev].push(e)); }
  const at = (p, tx, ty) => { p.x = (tx + 0.5) * T; p.y = (ty + 1) * T; };
  return { world, store, events, at, now: () => t, advance: (ms) => { t += ms; }, set: (ms) => { t = ms; } };
}

// ── D-day 순수 ───────────────────────────────────────────────────────
test('D-day: 자정 경계(tz)·남은 날·7일 뒤 숨김·칠판 정렬(최대 3)·검증·당일 연출 키/문구', () => {
  const tz = 'Asia/Seoul';
  assert.equal(Dday.daysLeft('2026-09-20', KST('2026-09-17T10:00:00'), tz), 3);
  assert.equal(Dday.daysLeft('2026-09-17', KST('2026-09-17T23:59:59'), tz), 0, '자정 직전은 오늘');
  assert.equal(Dday.daysLeft('2026-09-17', KST('2026-09-18T00:00:00'), tz), -1, '자정이 지나면 어제');
  assert.equal(Dday.daysLeft('2026-09-18', KST('2026-09-17T23:59:59'), tz), 1);
  assert.equal(Dday.daysLeft('2026-09-18', KST('2026-09-18T00:00:01'), tz), 0);
  assert.equal(Dday.daysLeft('2026-09-17', KST('2026-09-18T08:59:59'), 'UTC'), 0, 'UTC 로는 아직 17일');
  assert.equal(Dday.daysLeft('2027-01-01', KST('2026-12-31T12:00:00'), tz), 1, '연도 경계');
  assert.equal(Dday.label(0), 'D-DAY');
  assert.equal(Dday.label(7), 'D-7');
  assert.equal(Dday.label(-2), 'D+2');
  const now = KST('2026-09-17T10:00:00');
  const mk = (id, date, kind = 'other') => ({ id, title: `t${id}`, date, kind, nickname: 'a', studyId: null });
  assert.equal(Dday.visible(mk(1, '2026-09-10'), now, tz), true, '7일 전은 아직 보인다');
  assert.equal(Dday.visible(mk(1, '2026-09-09'), now, tz), false, '8일 전은 숨김');
  const list = [mk(1, '2026-09-30'), mk(2, '2026-09-17'), mk(3, '2026-09-15'), mk(4, '2026-09-20'), mk(5, '2026-09-01'), mk(6, '2026-10-05'), mk(7, '2026-09-12')];
  const board = Dday.forBoard(list, now, tz);
  assert.deepEqual(board.map((d) => [d.id, d.label, d.soon, d.today]), [[2, 'D-DAY', true, true], [4, 'D-3', true, false], [1, 'D-13', false, false]], '오늘 → 가까운 미래 순, 3개');
  assert.deepEqual(Dday.forBoard([mk(3, '2026-09-15'), mk(7, '2026-09-12'), mk(5, '2026-09-01')], now, tz).map((d) => d.label), ['D+2', 'D+5'], '지난 것은 최근 순, 8일 넘은 건 없음');
  assert.deepEqual(Dday.validate({ title: '  기말  고사 ', date: '2026-12-01', kind: 'exam', shared: 1 }), { ok: true, values: { title: '기말 고사', date: '2026-12-01', kind: 'exam', shared: true } });
  assert.equal(Dday.validate({ title: '', date: '2026-12-01' }).error, 'invalid_title');
  assert.equal(Dday.validate({ title: '가'.repeat(13), date: '2026-12-01' }).error, 'invalid_title');
  assert.equal(Dday.validate({ title: 'x', date: '2026-02-30' }).error, 'invalid_date');
  assert.equal(Dday.validate({ title: 'x', date: '20261201' }).error, 'invalid_date');
  assert.equal(Dday.validate({ title: 'x', date: '2026-12-01', kind: 'party' }).error, 'invalid_kind');
  assert.equal(Dday.validate({ title: 'x', date: '2026-12-01' }).values.kind, 'other');
  assert.equal(Dday.celebrationKey(mk(9, '2026-09-17'), '2026-09-17'), '9|2026-09-17');
  assert.match(Dday.celebration(mk(1, '2026-09-17', 'exam')).text, /오늘 잘 보고 와요/);
  assert.equal(Dday.celebration(mk(1, '2026-09-17', 'anniversary')).effect, 'hearts');
  assert.equal(Dday.celebration(mk(1, '2026-09-17', 'other')).effect, 'fireworks');
});

// ── 월드: 쪽지 ───────────────────────────────────────────────────────
test('월드 쪽지: 상대 자리(마지막에 앉은 자리 → 스터디룸 의자) 앞에서만, 멤버·60자·본인 제외, 저장, 앉으면 notesWaiting + seatItems, E 로 읽음, 쪽지함, 입장 ack', async () => {
  const { world, store, events, at } = makeWorld({ members: async () => ['민수', '영희', '철수'] });
  const a = world.join({ nickname: '민수', socketId: 'sa' }).player;
  const b = world.join({ nickname: '영희', socketId: 'sb' }).player;
  // 영희가 소파(seat-0)에 앉았다 일어난다 → 영희의 자리 = seat-0
  at(b, 18, 7);
  assert.equal(world.sit(b, 'seat-0').ok, true);
  world.stand(b);
  assert.equal(world.seatFor('영희').id, 'seat-0');
  assert.equal(world.seatFor('철수').id, 'study-a', '앉은 적 없는 멤버는 스터디룸 의자 (주인 없는 쪽)');
  // 검증
  at(a, 18, 8);
  assert.deepEqual(await world.leaveNote(a, { to: '민수', text: 'x' }), { ok: false, error: 'invalid_target' });
  assert.deepEqual(await world.leaveNote(a, { to: '누구', text: 'x' }), { ok: false, error: 'not_member' });
  assert.deepEqual(await world.leaveNote(a, { to: '영희', text: '   ' }), { ok: false, error: 'empty' });
  assert.deepEqual(await world.leaveNote(a, { to: '영희', text: '가'.repeat(NOTE_MAX + 1) }), { ok: false, error: 'too_long' });
  at(a, 30, 8);
  assert.deepEqual(await world.leaveNote(a, { to: '영희', text: '힘내' }), { ok: false, error: 'too_far' });
  at(a, 18, 8);
  const r = await world.leaveNote(a, { to: '영희', text: '  오늘도 파이팅!  ' });
  assert.equal(r.ok, true);
  assert.deepEqual([r.note.from, r.note.to, r.note.text, r.seatId, r.delivered], ['민수', '영희', '오늘도 파이팅!', 'seat-0', false]);
  assert.equal((await store.unreadNotes('영희', world.scopeId)).length, 1, '저장');
  assert.equal(events.notesWaiting.length, 0, '아직 앉지 않았으니 알림 없음');
  assert.deepEqual(world.seatItems(), { mugs: {}, notes: {} }, '아이콘은 앉아야 보인다');
  // 앉으면 알림 + 아이콘
  at(b, 18, 7);
  assert.equal(world.sit(b, 'seat-0').ok, true);
  await sleep(10);
  assert.equal(events.notesWaiting.length, 1);
  assert.deepEqual(events.notesWaiting[0].notes.map((n) => n.text), ['오늘도 파이팅!']);
  assert.deepEqual(world.seatItems().notes, { 'seat-0': 1 }, '앉은 자리에 쪽지 아이콘');
  assert.deepEqual(await world.readNotes(a), { ok: false, error: 'not_seated' });
  const read = await world.readNotes(b);
  assert.equal(read.notes.length, 1);
  assert.ok(read.notes[0].readAt);
  assert.deepEqual(world.seatItems().notes, {}, '읽으면 아이콘 사라짐');
  assert.equal((await store.unreadNotes('영희', world.scopeId)).length, 0);
  // 앉아 있는 상대에게 남기면 바로 전달
  const r2 = await world.leaveNote(a, { to: '영희', text: '두 번째' });
  assert.equal(r2.delivered, true);
  await sleep(10);
  assert.equal(events.notesWaiting.length, 2);
  assert.deepEqual(world.seatItems().notes, { 'seat-0': 1 });
  world.stand(b);
  assert.deepEqual(world.seatItems().notes, {}, '일어나면 아이콘은 사라진다 (쪽지는 남는다)');
  // 쪽지함
  const boxB = await world.noteBox(b);
  assert.deepEqual(boxB.received.map((n) => [n.text, Boolean(n.readAt)]), [['두 번째', false], ['오늘도 파이팅!', true]], '새 것부터');
  assert.equal(boxB.unread, 1);
  const boxA = await world.noteBox(a);
  assert.deepEqual(boxA.sent.map((n) => n.to), ['영희', '영희']);
  assert.equal(boxA.received.length, 0);
  // 앉은 적 없는 멤버 → 스터디룸 의자 앞에서, 입장 ack 에 안 읽은 쪽지
  const c = world.join({ nickname: '철수', socketId: 'sc' }).player;
  at(a, 21, 15);
  assert.equal((await world.leaveNote(a, { to: '철수', text: '환영' })).seatId, 'study-a');
  const prof = await world.loadProfile(c);
  assert.deepEqual(prof.unreadNotes.map((n) => n.text), ['환영']);
  assert.deepEqual(prof.pendingGifts, []);
  await world.dispose();
});

// ── 월드: 커피 배달 ───────────────────────────────────────────────────
test('월드 커피: 커피 코너 앞에서만, 메뉴·멤버 검증, 1코인 차감(부족 거부), 앉은 상대는 바로 + 10분 ❤️☕, 빈 자리엔 머그 → 앉으면 받음, 본인, 만료, 재시작', async () => {
  const store = createMemoryStore();
  const { world, events, at, advance } = makeWorld({ store, members: async () => ['민수', '영희'] });
  const a = world.join({ nickname: '민수', socketId: 'sa' }).player;
  const b = world.join({ nickname: '영희', socketId: 'sb' }).player;
  await store.adjustCoins('민수', 3, 'test');
  at(a, 30, 8);
  assert.deepEqual(await world.giftCoffee(a, { menu: 'latte', to: '영희' }), { ok: false, error: 'too_far' });
  at(a, 6, 15); // 커피머신 앞
  assert.deepEqual(await world.giftCoffee(a, { menu: 'tea', to: '영희' }), { ok: false, error: 'invalid_menu' });
  assert.deepEqual(await world.giftCoffee(a, { menu: 'latte', to: '외부인' }), { ok: false, error: 'not_member' });
  // 영희는 앉아 있지 않다 → 자리(스터디룸 의자 study-a)에 머그
  const g1 = await world.giftCoffee(a, { menu: 'latte', to: '영희' });
  assert.equal(g1.ok, true);
  assert.equal(g1.delivered, false);
  assert.equal(g1.balance, 2);
  assert.deepEqual([g1.gift.from, g1.gift.to, g1.gift.menu, g1.gift.menuName, g1.gift.seatId], ['민수', '영희', 'latte', '라떼', 'study-a']);
  assert.deepEqual(events.coins.map((e) => [e.delta, e.reason]), [[-1, 'coffee:latte']]);
  assert.deepEqual(world.seatItems().mugs, { 'study-a': [{ id: g1.gift.id, menu: 'latte', from: '민수', to: '영희' }] });
  assert.equal(world.coffeeBuffOf(b), null, '아직 안 받았다');
  assert.equal(world.publicPlayer(b).coffeeBuffUntil, null);
  // 영희가 다른 자리(소파)에 앉아도 받는다 (커피는 사람에게)
  at(b, 18, 7);
  assert.equal(world.sit(b, 'seat-0').ok, true);
  await sleep(10);
  assert.deepEqual(world.seatItems().mugs, {}, '받으면 머그가 사라진다');
  assert.equal(world.coffeeBuffOf(b), world.now() + COFFEE_BUFF_MS);
  assert.equal(events.coffee.filter((e) => e.delivered && e.late).length, 1);
  assert.equal(events.buff.length, 1);
  assert.equal((await store.pendingGifts(world.scopeId)).length, 0, '저장소에도 받음 처리');
  // 앉아 있는 상대에게는 바로
  const g2 = await world.giftCoffee(a, { menu: 'cocoa', to: '영희' });
  assert.equal(g2.delivered, true);
  assert.equal(g2.gift.seatId, 'seat-0');
  assert.equal(events.coffee.at(-1).late, false);
  // 만료: 10분 뒤
  advance(COFFEE_BUFF_MS - 1);
  assert.ok(world.coffeeBuffOf(b));
  advance(2);
  assert.equal(world.coffeeBuffOf(b), null, '10분이 지나면 끝');
  // 본인에게 (그냥 커피)
  const g3 = await world.giftCoffee(a, { menu: 'americano' });
  assert.equal(g3.delivered, true);
  assert.equal(g3.balance, 0);
  assert.ok(world.coffeeBuffOf(a));
  assert.equal(events.coffee.at(-1).self, true);
  // 잔액 부족
  assert.deepEqual(await world.giftCoffee(a, { menu: 'latte', to: '영희' }), { ok: false, error: 'insufficient', balance: 0 });
  assert.equal(events.coins.length, 3);
  // 재시작: 자리에 놓인 머그는 저장소에서 다시 로드된다
  await store.adjustCoins('민수', 1, 'test');
  world.stand(b);
  world.remove(b.id, 'leave');
  const g4 = await world.giftCoffee(a, { menu: 'latte', to: '영희' });
  assert.equal(g4.delivered, false);
  assert.equal(g4.gift.seatId, 'seat-0', '마지막에 앉았던 자리');
  await world.dispose();
  const w2 = makeWorld({ store, members: async () => ['민수', '영희'] });
  await w2.world.init();
  assert.deepEqual(Object.keys(w2.world.seatItems().mugs), ['seat-0']);
  const b2 = w2.world.join({ nickname: '영희', socketId: 'sb2' }).player;
  const prof = await w2.world.loadProfile(b2);
  assert.deepEqual(prof.pendingGifts.map((g) => g.menu), ['latte']);
  await w2.world.dispose();
});

// ── 월드: D-day ─────────────────────────────────────────────────────
test('월드 D-day: 등록(개인/공용)·목록·칠판 3개·삭제 권한·당일 연출은 사람·날짜마다 1회(자정을 넘기면 다시)', async () => {
  const { world, events, set } = makeWorld({ members: async () => ['민수', '영희'] });
  const a = world.join({ nickname: '민수', socketId: 'sa' }).player;
  const b = world.join({ nickname: '영희', socketId: 'sb' }).player;
  assert.equal((await world.addDday(a, { title: '', date: '2026-09-20' })).error, 'invalid_title');
  const d1 = await world.addDday(a, { title: '기말고사', date: '2026-09-20', kind: 'exam', shared: false });
  assert.equal(d1.ok, true);
  assert.deepEqual([d1.dday.label, d1.dday.soon], ['D-3', true]);
  assert.equal(events.ddays.length, 0, '개인 D-day 는 방송하지 않는다');
  const d2 = await world.addDday(b, { title: '스터디 100일', date: '2026-09-17', kind: 'anniversary', shared: true });
  assert.equal(events.ddays.length, 1, '공용은 방송');
  await world.addDday(b, { title: '영희 시험', date: '2026-10-01', kind: 'exam', shared: false });
  await world.addDday(a, { title: '옛날', date: '2026-09-05', kind: 'other', shared: true });
  const la = await world.listDdays(a);
  assert.deepEqual(la.ddays.map((d) => [d.title, d.label, d.mine, d.shared]), [['스터디 100일', 'D-DAY', false, true], ['기말고사', 'D-3', true, false]], '민수: 내 것 + 공용 (8일 넘은 건 숨김, 영희 개인 것은 안 보임)');
  assert.deepEqual(la.board.map((d) => d.label), ['D-DAY', 'D-3']);
  const lb = await world.listDdays(b);
  assert.deepEqual(lb.ddays.map((d) => d.title), ['스터디 100일', '영희 시험']);
  // 삭제 권한
  assert.deepEqual(await world.deleteDday(a, d2.dday.id), { ok: false, error: 'forbidden' });
  assert.equal((await world.deleteDday(a, 99999)).error, 'not_found');
  assert.equal((await world.deleteDday(a, d1.dday.id)).ok, true);
  assert.deepEqual((await world.listDdays(a)).ddays.map((d) => d.title), ['스터디 100일']);
  // 당일 연출: 오늘(9/17)인 공용 100일 → 민수·영희 각각 1회. 같은 날 다시 물으면 없음, 자정을 넘기면 D+1 이라 없음
  const c1 = await world.ddayCelebrations(a);
  assert.deepEqual(c1.map((c) => [c.title, c.effect]), [['스터디 100일', 'hearts']]);
  assert.deepEqual(await world.ddayCelebrations(a), [], '같은 날 두 번은 없다');
  assert.equal((await world.ddayCelebrations(b)).length, 1, '다른 사람은 따로');
  set(KST('2026-09-18T00:00:01'));
  assert.deepEqual(await world.ddayCelebrations(a), [], '자정을 넘기면 D+1');
  await world.addDday(a, { title: '내 시험', date: '2026-09-18', kind: 'exam' });
  const c2 = await world.ddayCelebrations(a);
  assert.deepEqual(c2.map((c) => [c.title, c.effect, /오늘 잘 보고 와요/.test(c.text)]), [['내 시험', 'fireworks', true]]);
  // 입장 ack (loadProfile) 에 칠판 + 연출 (이미 연출한 것은 빠진다)
  const prof = await world.loadProfile(a);
  assert.deepEqual(prof.ddays.board.map((d) => d.label), ['D-DAY', 'D+1']);
  assert.deepEqual(prof.ddays.celebrate, []);
  await world.dispose();
});

// ── 소켓 E2E ────────────────────────────────────────────────────────
test('소켓 E2E: note:leave → note:waiting/seatItems → note:read · coffee:gift → coins/coffee:received/playerBuff/seatItems/chat · dday:add → dday:update · 입장 ack', async (t) => {
  const srv = await boot({ world: { npc: { autoStart: false }, study: { autoTick: false } } });
  t.after(() => srv.close());
  const a = connect(srv.port);
  const b = connect(srv.port);
  t.after(() => { a.close(); b.close(); });
  const ja = await joinAs(a, { nickname: '민수' });
  const jb = await joinAs(b, { nickname: '영희' });
  assert.deepEqual(ja.seatItems, { mugs: {}, notes: {} });
  assert.deepEqual(ja.seatLast, {});
  assert.deepEqual(ja.profile.ddays, { board: [], celebrate: [] });
  const world = srv.world;
  const pa = world.players.get(ja.self.id);
  const pb = world.players.get(jb.self.id);
  const itemsA = collect(a, 'seatItems');
  const chatsA = collect(a, 'chat');
  // 영희가 스터디룸 의자 study-b 에 앉았다 일어남 → seatLast
  pb.x = 23.5 * T; pb.y = 15 * T;
  const sat = await ask(b, 'sit', { seatId: 'study-b' });
  assert.equal(sat.ok, true);
  const satEv = await once(a, 'playerSat');
  assert.equal(satEv.nickname, '영희');
  await ask(b, 'stand', {});
  // 민수가 study-b 앞에서 쪽지
  pa.x = 23.5 * T; pa.y = 16 * T;
  const newP = once(b, 'note:new'); // ack 보다 먼저 올 수 있으니 미리 기다린다
  assert.equal((await ask(a, 'note:leave', { to: '영희', text: '힘내요' })).error, undefined);
  const newEv = await newP;
  assert.deepEqual(newEv, { from: '민수', seatId: 'study-b' });
  // 영희가 앉으면 note:waiting + seatItems
  pb.x = 23.5 * T; pb.y = 15 * T;
  const waiting = once(b, 'note:waiting');
  await ask(b, 'sit', { seatId: 'study-b' });
  const w = await waiting;
  assert.equal(w.seatId, 'study-b');
  assert.deepEqual(w.notes.map((n) => n.text), ['힘내요']);
  await sleep(30);
  assert.deepEqual(itemsA.at(-1).notes, { 'study-b': 1 });
  const read = await ask(b, 'note:read', {});
  assert.deepEqual(read.notes.map((n) => n.text), ['힘내요']);
  await sleep(30);
  assert.deepEqual(itemsA.at(-1).notes, {});
  const box = await ask(b, 'note:box', {});
  assert.equal(box.received.length, 1);
  assert.equal(box.unread, 0);
  // 커피: 민수가 커피 코너에서 앉아 있는 영희에게 → 바로 (coins · coffee:received · playerBuff · chat notify)
  await srv.hub.store.adjustCoins('민수', 2, 'test');
  pa.x = 6.5 * T; pa.y = 16 * T;
  const targets = await ask(a, 'coffee:targets', {});
  assert.deepEqual(targets.menu.map((m) => m.id), ['americano', 'latte', 'cocoa']);
  assert.deepEqual(targets.members.find((m) => m.nickname === '영희'), { nickname: '영희', self: false, online: true, seated: true, hasSeat: true });
  const recv = once(b, 'coffee:received');
  const buff = once(a, 'playerBuff');
  const coin = once(a, 'coins', { filter: (d) => d.reason === 'coffee:latte' });
  const g = await ask(a, 'coffee:gift', { menu: 'latte', to: '영희' });
  assert.equal(g.ok, true);
  assert.equal(g.delivered, true);
  assert.equal(g.balance, 1);
  assert.equal((await recv).gift.menuName, '라떼');
  assert.equal((await buff).id, jb.self.id);
  assert.equal((await coin).balance, 1);
  await sleep(30);
  assert.ok(chatsA.some((c) => c.system && c.notify && /민수님이 영희님에게 ☕ 라떼를 건넸어요/.test(c.text)));
  assert.ok(world.publicPlayer(pb).coffeeBuffUntil > world.now());
  // 영희가 일어나 나가면 → 자리에 머그 (seatItems mugs)
  await ask(b, 'stand', {});
  const g2 = await ask(a, 'coffee:gift', { menu: 'cocoa', to: '영희' });
  assert.equal(g2.delivered, false);
  await sleep(30);
  assert.deepEqual(itemsA.at(-1).mugs, { 'study-b': [{ id: g2.gift.id, menu: 'cocoa', from: '민수', to: '영희' }] });
  assert.ok(chatsA.some((c) => /바리스타 바리스타가 민수님이 보낸 코코아를 놓고 갔어요/.test(c.text))); // 18단계 문구
  assert.deepEqual(await ask(a, 'coffee:gift', { menu: 'latte', to: '영희' }), { ok: false, error: 'insufficient', balance: 0 });
  // 늦게 들어온 사람의 입장 ack 에 머그가 실린다
  const c = connect(srv.port);
  t.after(() => c.close());
  const jc = await joinAs(c, { nickname: '철수' });
  assert.deepEqual(Object.keys(jc.seatItems.mugs), ['study-b']);
  assert.equal(jc.players.find((p) => p.id === jb.self.id).coffeeBuffUntil > 0, true);
  // D-day: 공용 등록 → 모두에게 dday:update, 목록에 보임
  const upd = once(c, 'dday:update');
  const dd = await ask(a, 'dday:add', { title: '스터디 시험', date: '2099-12-31', kind: 'exam', shared: true });
  assert.equal(dd.ok, true);
  await upd;
  const listC = await ask(c, 'dday:list', {});
  assert.deepEqual(listC.ddays.map((d) => [d.title, d.shared, d.mine]), [['스터디 시험', true, false]]);
  assert.deepEqual(await ask(c, 'dday:delete', { id: dd.dday.id }), { ok: false, error: 'forbidden' });
  assert.equal((await ask(a, 'dday:add', { title: 'x', date: 'nope' })).error, 'invalid_date');
});

// ── 브라우저 ─────────────────────────────────────────────────────────
test('브라우저 15단계: 남의 자리 앞 E → 자리 선택 → 쪽지 → 상대 착석 시 아이콘·토스트 → E 읽기 · 커피 코너 E → 모달 → 배달 머그 · ❤️☕ · D-day 칠판 · 실내 연출', { skip: !CHROME && 'Chrome 없음' }, async (t) => {
  const puppeteer = require('puppeteer-core');
  const srv = await boot({ world: { npc: { autoStart: false }, study: { autoTick: false } } });
  t.after(() => srv.close());
  const world = srv.world;
  await srv.hub.store.adjustCoins('브라우저', 5, 'test');
  // 영희(소켓 봇)가 study-b 에 앉았다 일어난다 → 영희의 자리
  const b = connect(srv.port);
  t.after(() => b.close());
  const jb = await joinAs(b, { nickname: '영희' });
  const pb = world.players.get(jb.self.id);
  pb.x = 23.5 * T; pb.y = 15 * T;
  assert.equal((await ask(b, 'sit', { seatId: 'study-b' })).ok, true);
  await ask(b, 'stand', {});
  // D-day: 오늘(당일) 기념일 공용 + 내 시험 D-3
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const in3 = new Date(Date.now() + 9 * 3600 * 1000 + 3 * 86400000).toISOString().slice(0, 10);
  await ask(b, 'dday:add', { title: '스터디 100일', date: today, kind: 'anniversary', shared: true });

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: CHROME_ARGS });
  t.after(() => browser.close());
  const page = await (await browser.createBrowserContext()).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(pageUrl(srv), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#login:not([hidden])', { timeout: 60000 });
  await page.type('#login-nick', '브라우저');
  await page.click('#login-submit');
  await page.waitForFunction(() => window.NSM && window.NSM.scene.me && document.getElementById('lobby').hidden, { timeout: 30000 });
  await sleep(500);
  const meId = await page.evaluate(() => window.NSM.scene.me.id);
  const me = world.players.get(meId);
  // 당일 연출: 하트 폭죽 + 토스트 · 칠판 D-day 줄
  await page.waitForFunction(() => window.NSM.scene.celebrating && window.NSM.scene.fireworkStyle === 'hearts', { timeout: 8000 });
  await page.waitForFunction(() => window.NSM.scene.ddayLines.length === 1 && /D-DAY 스터디 100일/.test(window.NSM.scene.ddayLines[0]), { timeout: 8000 });
  assert.match(await page.$eval('#notify-list', (el) => el.textContent), /스터디 100일 D-DAY/);
  // 실내 연출: 가구 그림자 · 빛 웅덩이 5 · 김 · 시계 · 비(강제) · 명패(스터디 이름) · 코르크보드 팻말
  const fx = await page.evaluate(() => { const s = window.NSM.scene; s.setRain(true); return { shadows: s.propShadows.length, pools: s.pools.length, steam: Boolean(s.steam), clocks: s.clocks.length, rain: s.raining, drops: s.rainDrops.length, nameplate: s.nameplateText.text, cork: s.corkNotes.length }; });
  assert.ok(fx.shadows > 30, `가구 그림자 ${fx.shadows}`);
  assert.equal(fx.pools, 5);
  assert.equal(fx.steam, true);
  assert.equal(fx.clocks, 2);
  assert.equal(fx.rain, true);
  assert.ok(fx.drops > 20);
  assert.equal(fx.nameplate, '테스트 스터디');
  assert.equal(fx.cork, 2);
  await page.evaluate(() => window.NSM.scene.setRain(false));
  assert.equal(await page.evaluate(() => window.NSM.scene.raining), false);
  // 설정에서 D-day 등록 (내 시험 D-3) → 칠판 2줄
  await openSettings(page);
  await page.type('#dday-title', '기말고사');
  await page.evaluate((d) => { const el = document.getElementById('dday-date'); el.value = d; }, in3);
  await page.select('#dday-kind', 'exam');
  await page.click('#dday-form button[type=submit]');
  await page.waitForFunction(() => window.NSM.scene.ddayLines.length === 2 && /D-3 기말고사/.test(window.NSM.scene.ddayLines[1]), { timeout: 8000 });
  await page.waitForFunction(() => document.querySelectorAll('#dday-list li .dd').length === 2, { timeout: 5000 });
  await page.click('#btn-settings');
  // 남의 자리(study-b) 앞으로 → E → 자리 선택 모달 → 쪽지 → 입력 → 남기기
  me.x = 23.5 * T; me.y = 16 * T;
  await page.evaluate((x, y) => { const s = window.NSM.scene; s.me.setPosition(x, y); s.lastSent = null; }, me.x, me.y);
  await page.waitForFunction(() => /쪽지 남기기/.test(document.getElementById('sit-hint').textContent), { timeout: 5000 });
  await page.keyboard.press('KeyE');
  await page.waitForSelector('#seat-choice-modal:not([hidden])', { timeout: 5000 });
  assert.match(await page.$eval('#seat-choice-title', (el) => el.textContent), /영희/);
  await page.click('#seat-choice-note');
  await page.waitForSelector('#note-modal:not([hidden])', { timeout: 5000 });
  await page.type('#note-text', '오늘도 파이팅');
  await page.click('#note-submit');
  // 토스트는 순서대로 나온다 (앞의 D-day 연출 토스트가 길다) → 지금 보이는 것 + 대기열까지 본다
  const toastSeen = (re) => page.waitForFunction((src) => { const re2 = new RegExp(src); const t = document.getElementById('toast').textContent; const q = (window.NSM.ui.toastQueue || []).map((x) => x.text).join(' '); return re2.test(t + ' ' + q); }, { timeout: 8000 }, re.source);
  await toastSeen(/쪽지를 남겼어요/);
  assert.equal((await srv.hub.store.unreadNotes('영희')).length, 1);
  // 영희가 앉으면 브라우저 화면에 책상 위 쪽지 아이콘
  pb.x = 23.5 * T; pb.y = 15 * T;
  await ask(b, 'sit', { seatId: 'study-b' });
  await page.waitForFunction(() => window.NSM.scene.seatItemSprites.length === 1 && window.NSM.scene.seatItems.notes['study-b'] === 1, { timeout: 5000 });
  const noteSprite = await page.evaluate(() => { const s = window.NSM.scene.seatItemSprites[0]; return { x: s.x, y: s.y, frame: s.frame.name }; });
  assert.deepEqual([noteSprite.x, noteSprite.y], [24.5 * T, 13 * T], '영희 첫 슬롯 (24,12) 위');
  assert.match(noteSprite.frame, /^tile:/);
  await ask(b, 'note:read', {});
  await page.waitForFunction(() => window.NSM.scene.seatItemSprites.length === 0, { timeout: 5000 });
  // 커피 코너 E → 모달 → 라떼 → 영희(앉아 있음) → 배달 → ❤️☕ (영희 상태 아이콘)
  me.x = 6.5 * T; me.y = 16 * T;
  await page.evaluate((x, y) => { const s = window.NSM.scene; s.me.setPosition(x, y); s.lastSent = null; }, me.x, me.y);
  await page.waitForFunction(() => /커피/.test(document.getElementById('sit-hint').textContent), { timeout: 5000 });
  await page.keyboard.press('KeyE');
  await page.waitForSelector('#coffee-modal:not([hidden])', { timeout: 5000 });
  await page.waitForFunction(() => document.querySelectorAll('#coffee-menu button').length === 3 && document.querySelectorAll('#coffee-to option').length >= 2, { timeout: 5000 });
  await page.click('#coffee-menu button[data-menu="latte"]');
  await page.select('#coffee-to', '영희');
  await page.click('#coffee-send');
  await page.waitForFunction(() => document.getElementById('coffee-modal').hidden, { timeout: 5000 });
  await toastSeen(/라떼를 건넸어요/);
  await page.waitForFunction((id) => { const a = window.NSM.scene.remotes.get(id).avatar; return a.buffed && a.statusBubble.bubbleText.text === '📖'; }, { timeout: 5000 }, jb.self.id); // 공부 중엔 📖 그대로
  await ask(b, 'status', { status: 'rest' });
  await page.waitForFunction((id) => window.NSM.scene.remotes.get(id).avatar.statusBubble.bubbleText.text === '❤️☕', { timeout: 5000 }, jb.self.id); // 휴식으로 바꾸면 ❤️☕
  assert.equal(await page.evaluate(() => window.NSM.ui.coins), 4);
  // 영희가 일어나면 → 코코아는 자리에 머그로
  await ask(b, 'stand', {});
  await page.keyboard.press('KeyE');
  await page.waitForSelector('#coffee-modal:not([hidden])', { timeout: 5000 });
  await page.waitForFunction(() => document.querySelectorAll('#coffee-menu button').length === 3, { timeout: 5000 });
  await page.click('#coffee-menu button[data-menu="cocoa"]');
  await page.select('#coffee-to', '영희');
  await page.click('#coffee-send');
  await page.waitForFunction(() => window.NSM.scene.seatItemSprites.length === 1 && window.NSM.scene.seatItems.mugs['study-b'], { timeout: 5000 });
  // 내 자리에 쪽지가 오면 앉은 채 E = 읽기 (영희 → 나)
  me.x = 21.5 * T; me.y = 15 * T;
  await page.evaluate((x, y) => { const s = window.NSM.scene; s.me.setPosition(x, y); s.lastSent = null; }, me.x, me.y);
  await page.waitForFunction(() => /앉기/.test(document.getElementById('sit-hint').textContent), { timeout: 5000 });
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => window.NSM.scene.me.seated, { timeout: 5000 });
  pb.x = 21.5 * T; pb.y = 16 * T;
  assert.equal((await ask(b, 'note:leave', { to: '브라우저', text: '고마워요' })).delivered, true);
  await page.waitForFunction(() => /쪽지 읽기/.test(document.getElementById('sit-hint').textContent) && window.NSM.scene.myNotes === 1, { timeout: 5000 });
  await page.keyboard.press('KeyE');
  await page.waitForSelector('#note-read-modal:not([hidden])', { timeout: 5000 });
  assert.match(await page.$eval('#note-read-list', (el) => el.textContent), /영희 님.*고마워요/s);
  assert.equal(await page.evaluate(() => window.NSM.scene.me.seated), true, '읽기는 일어나지 않는다');
  await page.click('#note-read-close');
  await page.waitForFunction(() => /일어나기/.test(document.getElementById('sit-hint').textContent), { timeout: 5000 });
  // 쪽지함
  await openSettings(page);
  await page.click('#btn-notebox');
  await page.waitForSelector('#notebox-modal:not([hidden])', { timeout: 5000 });
  await page.waitForFunction(() => /고마워요/.test(document.getElementById('notebox-list').textContent), { timeout: 5000 });
  await page.click('#notebox-tabs button[data-tab="sent"]');
  await page.waitForFunction(() => /오늘도 파이팅/.test(document.getElementById('notebox-list').textContent), { timeout: 5000 });
  assert.deepEqual(errors, []);
});
