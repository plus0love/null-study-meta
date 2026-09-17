'use strict';
/**
 * 7단계: 설정·UI 개선.
 *  - 뽀모도로 개인 타이머: configure 범위(집중 20~90 · 휴식 5~20), 진행 중 변경 불가, 월드가 플레이어마다 따로 들고 퇴장 시 정리, 재접속 유지.
 *  - 내 기록 초기화: 메모리 저장소 resetUser(세션·출석·목표·할 일만), StudyTracker.reset(진행 중 세션 폐기), World.resetProfile(토큰·닉네임 확인),
 *    소켓 profile:reset E2E(거부·삭제·playerGoal null·leaderboard:refresh·랭킹 0).
 *  - 브라우저: 카드 접기(localStorage 유지) · 채팅 카드 높이 · 뽀모도로 시간 입력(잠김·범위) · 화면 크기(줌)·넓게 보기 · 초기화 모달(닉네임 확인).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Pomodoro, FOCUS_RANGE, BREAK_RANGE } = require('../server/game/pomodoro');
const { World } = require('../server/game/world');
const { StudyTracker } = require('../server/game/study');
const { createMemoryStore } = require('../server/store/memory');
const { getStudyRoom } = require('../server/rooms/studyroom');
const { boot, connect, joinAs, ask, once, sleep, collect, pageUrl, openSettings, CHROME, CHROME_ARGS } = require('./helpers');

const room = getStudyRoom();
const TZ = 'Asia/Seoul';
const KST = (iso) => new Date(`${iso}+09:00`).getTime();
const quiet = { log() {}, warn() {}, error() {} };
const MIN = 60 * 1000;

function makeWorld(opts = {}) {
  let t = KST('2026-09-17T10:00:00');
  const store = createMemoryStore();
  const world = new World(room, { now: () => t, store, tz: TZ, npc: { autoStart: false }, study: { autoTick: false }, log: quiet, ...opts });
  const seat = room.seats[0];
  const sitDown = (p) => { p.x = (seat.x + 0.5) * 32; p.y = (seat.y + 1) * 32; return world.sit(p, seat.id); };
  return { world, store, advance: (ms) => { t += ms; }, now: () => t, seat, sitDown };
}

// ── 뽀모도로 ────────────────────────────────────────────────────────
test('뽀모도로 configure: 집중 20~90 · 휴식 5~20 (정수 분), 진행 중 거부, changed 플래그', () => {
  assert.deepEqual(FOCUS_RANGE, { min: 20, max: 90 });
  assert.deepEqual(BREAK_RANGE, { min: 5, max: 20 });
  const p = new Pomodoro();
  assert.deepEqual(p.configure({ focusMinutes: 25, breakMinutes: 5 }), { ok: true, changed: false, focusMinutes: 25, breakMinutes: 5 });
  assert.deepEqual(p.configure({ focusMinutes: 50, breakMinutes: 10 }), { ok: true, changed: true, focusMinutes: 50, breakMinutes: 10 });
  assert.equal(p.focusMs, 50 * MIN);
  assert.equal(p.breakMs, 10 * MIN);
  assert.equal(p.snapshot().focusMs, 50 * MIN);
  for (const bad of [19, 91, 25.5, '', NaN, null, undefined, 'abc']) assert.equal(p.configure({ focusMinutes: bad, breakMinutes: 5 }).error, 'invalid_focus', `focus=${bad}`);
  for (const bad of [4, 21, 7.5, '', NaN, null]) assert.equal(p.configure({ focusMinutes: 25, breakMinutes: bad }).error, 'invalid_break', `break=${bad}`);
  assert.equal(p.configure({ focusMinutes: '20', breakMinutes: '20' }).ok, true, '문자열 숫자도 허용');
  assert.equal(p.configure({ focusMinutes: 90, breakMinutes: 5 }).ok, true);
  assert.equal(p.focusMs, 90 * MIN, '거부된 값은 반영되지 않고 마지막 성공 값만');
  p.start('나');
  assert.deepEqual(p.configure({ focusMinutes: 30, breakMinutes: 5 }), { ok: false, error: 'running' });
  assert.equal(p.focusMs, 90 * MIN);
  p.stop();
  assert.equal(p.configure({ focusMinutes: 30, breakMinutes: 5 }).ok, true);
  p.dispose();
});

test('월드: 플레이어마다 타이머가 따로 돌고, 시작 때 설정, 퇴장하면 정리, 재접속은 유지', async () => {
  const { world } = makeWorld({ pomodoro: { focusMs: 40, breakMs: 30 } });
  const a = world.join({ nickname: 'A', socketId: 'sa' }).player;
  const b = world.join({ nickname: 'B', socketId: 'sb' }).player;
  const events = [];
  world.on('pomodoro', (snap, reason, player) => events.push([player.nickname, reason, snap.phase]));

  const sa = world.startPomodoro(a);
  assert.equal(sa.ok, true);
  assert.equal(sa.running, true);
  assert.equal(sa.startedBy, 'A');
  assert.equal(world.pomodoroOf(b).running, false, 'B 의 타이머는 그대로');
  assert.deepEqual(world.startPomodoro(a), { ok: false, error: 'running' });
  assert.equal(world.startPomodoro(a, { focusMinutes: 30, breakMinutes: 10 }).error, 'running', '진행 중엔 설정 포함 시작도 거부');

  // B: 잘못된 설정은 시작하지 않는다, 맞으면 설정 후 시작
  assert.equal(world.startPomodoro(b, { focusMinutes: 10, breakMinutes: 5 }).error, 'invalid_focus');
  assert.equal(world.pomodoroOf(b).running, false);
  const sb = world.startPomodoro(b, { focusMinutes: 45, breakMinutes: 15 });
  assert.equal(sb.ok, true);
  assert.equal(sb.focusMs, 45 * MIN);
  assert.equal(sb.breakMs, 15 * MIN);
  assert.equal(world.pomodoroOf(a).focusMs, 40, 'A 의 설정은 영향 없음');
  // 한쪽만 주면 나머지는 기존 값
  world.stopPomodoro(b);
  const sb2 = world.startPomodoro(b, { breakMinutes: 5 });
  assert.equal(sb2.focusMs, 45 * MIN);
  assert.equal(sb2.breakMs, 5 * MIN);

  await sleep(60); // A: focus 40ms → break
  assert.equal(world.pomodoroOf(a).phase, 'break');
  assert.ok(events.some(([n, r]) => n === 'A' && r === 'switch'));
  assert.ok(events.every(([n, r, ph]) => n !== 'B' || ph === 'focus'), 'B 는 45분짜리라 전환 없음');

  // 재접속(토큰 이어받기): 같은 플레이어 객체 → 타이머 유지
  const re = world.join({ nickname: 'A', token: a.token, socketId: 'sa2' });
  assert.equal(re.resumed, true);
  assert.equal(world.pomodoroOf(re.player).running, true);
  assert.equal(world.pomodoros.size, 2);

  // 퇴장 → 타이머 정리 (더 이상 이벤트 없음)
  world.remove(a.id, 'leave');
  assert.equal(world.pomodoros.size, 1);
  const n = events.length;
  await sleep(80);
  assert.equal(events.filter(([nick]) => nick === 'A').length, events.slice(0, n).filter(([nick]) => nick === 'A').length, '퇴장 후 A 이벤트 없음');
  assert.deepEqual(world.stopPomodoro(world.join({ nickname: 'C', socketId: 'sc' }).player), { ok: false, error: 'not_running' });
  await world.dispose();
});

// ── 기록 초기화 ─────────────────────────────────────────────────────
test('메모리 저장소 resetUser: 세션·출석·목표·할 일만 지우고 아바타·강아지 이름은 남긴다, 다른 사람은 그대로', async () => {
  const s = createMemoryStore();
  const t0 = KST('2026-09-17T10:00:00');
  await s.upsertUser('민수', { avatar: { hair: 'bob' }, dogName: '콩이' });
  await s.saveSession({ nickname: '민수', startedAt: t0, endedAt: t0 + 5 * MIN, seconds: 300 });
  await s.saveSession({ nickname: '민수', startedAt: t0 + 10 * MIN, endedAt: t0 + 20 * MIN, seconds: 600 });
  await s.saveSession({ nickname: '영희', startedAt: t0, endedAt: t0 + 5 * MIN, seconds: 300 });
  await s.recordAttendance('민수', '2026-09-16');
  await s.recordAttendance('민수', '2026-09-17');
  await s.recordAttendance('영희', '2026-09-17');
  await s.setGoal('민수', '2026-09-17', { goalText: 'x', targetMinutes: 30 });
  await s.setGoal('영희', '2026-09-17', { goalText: 'y', targetMinutes: 30 });
  await s.addTodo('민수', 'a', t0);
  await s.addTodo('민수', 'b', t0);
  await s.addTodo('민수2', 'c', t0); // 접두어가 같은 다른 닉네임
  await s.addTodo('영희', 'd', t0);

  assert.deepEqual(await s.resetUser('민수'), { sessions: 2, attendance: 2, goals: 1, todos: 2 });
  assert.deepEqual(await s.listSessions('민수'), []);
  assert.equal((await s.listSessions('영희')).length, 1);
  assert.deepEqual(await s.attendanceOf('민수', { tz: TZ, now: t0 }), { streak: 0, weekDays: 0, attendedToday: false });
  assert.equal((await s.attendanceOf('영희', { tz: TZ, now: t0 })).streak, 1);
  assert.equal(await s.getGoal('민수', '2026-09-17'), null);
  assert.ok(await s.getGoal('영희', '2026-09-17'));
  assert.deepEqual(await s.listTodos('민수', { tz: TZ, now: t0 }), []);
  assert.equal((await s.listTodos('민수2', { tz: TZ, now: t0 })).length, 1);
  assert.equal((await s.listTodos('영희', { tz: TZ, now: t0 })).length, 1);
  const u = await s.getUser('민수');
  assert.deepEqual(u.avatar, { hair: 'bob' });
  assert.equal(u.dogName, '콩이');
  assert.equal((await s.studyTotals({ tz: TZ, now: t0 })).find((r) => r.nickname === '민수'), undefined);
  assert.deepEqual(await s.resetUser('없는사람'), { sessions: 0, attendance: 0, goals: 0, todos: 0 });
});

test('StudyTracker.reset: 진행 중 세션은 저장하지 않고 버리고, 저장된 합계·목표 달성 기억을 지운다', async () => {
  let t = KST('2026-09-17T10:00:00');
  const store = createMemoryStore();
  const goals = new Map([['민수', { targetMinutes: 30 }]]);
  const st = new StudyTracker({ store, tz: TZ, now: () => t, log: quiet, autoTick: false, goalOf: (n) => goals.get(n) || null });
  const discarded = [];
  st.on('discarded', (e) => discarded.push(e));
  const p = { id: 'p1', nickname: '민수', seatId: 's1', status: 'study' };
  st.sync(p);
  t += 40 * MIN;
  assert.equal(st.todaySeconds('민수'), 40 * 60);
  assert.equal(st.checkGoal('민수', 'p1'), true);
  assert.equal(st.goalReached.size, 1);

  const live = st.reset('민수');
  assert.ok(live && live.nickname === '민수');
  assert.equal(st.live.has('민수'), false);
  assert.equal(st.todaySeconds('민수'), 0);
  assert.equal(st.goalReached.size, 0);
  assert.deepEqual(await store.listSessions('민수'), [], '버린 세션은 저장되지 않음');
  assert.equal(discarded.length, 1);
  assert.equal(discarded[0].reason, 'reset');
  assert.equal(st.reset('없음'), null);
  // 다시 sync 하면 지금부터 새 세션
  st.sync(p);
  assert.equal(st.liveSeconds('민수'), 0);
  t += 2 * MIN;
  await st.end('민수');
  assert.equal((await store.listSessions('민수'))[0].seconds, 120);
  st.dispose?.();
});

test('World.resetProfile: 토큰·닉네임이 모두 맞아야 하고, 목표 캐시도 비우며, 공부 중이면 새 세션을 센다', async () => {
  const { world, store, advance, sitDown } = makeWorld();
  const a = world.join({ nickname: '민수', socketId: 'sa' }).player;
  const b = world.join({ nickname: '영희', socketId: 'sb' }).player;
  await world.setGoal(a, { text: '목표', targetMinutes: 30 });
  await world.addTodo(a, '할 일');
  await world.addTodo(b, '영희 할 일');
  sitDown(a);
  advance(10 * MIN);
  assert.equal(world.study.todaySeconds('민수'), 600);

  assert.deepEqual(await world.resetProfile(a, { nickname: '민수', token: 'wrong' }), { ok: false, error: 'confirm_mismatch' });
  assert.deepEqual(await world.resetProfile(a, { nickname: '영희', token: a.token }), { ok: false, error: 'confirm_mismatch' });
  assert.deepEqual(await world.resetProfile(a, { nickname: '민수', token: b.token }), { ok: false, error: 'confirm_mismatch' }, '남의 토큰');
  assert.deepEqual(await world.resetProfile(a, {}), { ok: false, error: 'confirm_mismatch' });
  assert.ok(world.publicGoal('민수'), '거부되면 아무것도 안 지움');

  const r = await world.resetProfile(a, { nickname: '민수', token: a.token });
  assert.equal(r.ok, true);
  assert.deepEqual(r.counts, { sessions: 0, attendance: 0, goals: 1, todos: 1 });
  assert.equal(world.publicGoal('민수'), null);
  assert.deepEqual(await world.listTodos(a), []);
  assert.equal((await world.listTodos(b)).length, 1, '다른 사람 것은 그대로');
  assert.equal(world.study.todaySeconds('민수'), 0, '진행 중이던 10분은 버려짐');
  assert.ok(world.study.live.has('민수'), '앉아서 공부 중이면 새 세션 시작');
  advance(3 * MIN);
  assert.equal(world.study.todaySeconds('민수'), 180);
  await world.dispose();
});

test('소켓 E2E: profile:reset — 확인 실패 거부, 성공 시 삭제 + playerGoal null + leaderboard:refresh, 랭킹 0·할 일 비움', async (t) => {
  let now = KST('2026-09-17T10:00:00');
  const srv = await boot({ world: { now: () => now, npc: { autoStart: false }, study: { autoTick: false } } });
  t.after(() => srv.close());
  const a = connect(srv.port);
  const b = connect(srv.port);
  t.after(() => { a.close(); b.close(); });
  const ja = await joinAs(a, { nickname: '민수' });
  await joinAs(b, { nickname: '영희' });
  assert.equal((await ask(a, 'profile:reset', { nickname: '민수', token: ja.token })).ok, true, '빈 기록도 초기화는 ok');

  // 기록 만들기: 목표 · 할 일 · 앉아서 31분(출석·세션)
  await ask(a, 'goal:set', { text: '챕터 3', targetMinutes: 30 });
  await ask(a, 'todo:add', { text: '문제 풀기' });
  await ask(b, 'todo:add', { text: '영희 것' });
  const pa = srv.world.players.get(ja.self.id);
  const seat = room.seats[0];
  pa.x = (seat.x + 0.5) * 32;
  pa.y = (seat.y + 1) * 32;
  assert.equal((await ask(a, 'sit', { seatId: seat.id })).ok, true);
  now += 31 * MIN;
  await srv.world.study.tick();
  await ask(a, 'stand');
  await sleep(30);
  let st = await ask(a, 'stats');
  assert.equal(st.rows.find((r) => r.nickname === '민수').todaySeconds, 31 * 60);
  assert.equal(st.rows.find((r) => r.nickname === '민수').streak, 1);

  // 거부: 토큰/닉네임 불일치, 미입장
  assert.deepEqual(await ask(a, 'profile:reset', { nickname: '민수', token: 'nope' }), { ok: false, error: 'confirm_mismatch' });
  assert.deepEqual(await ask(a, 'profile:reset', { nickname: '민수2', token: ja.token }), { ok: false, error: 'confirm_mismatch' });
  const c = connect(srv.port);
  t.after(() => c.close());
  assert.equal((await ask(c, 'profile:reset', { nickname: '민수', token: ja.token })).error, 'not_joined');
  assert.ok((await ask(a, 'todo:list')).todos.length === 1, '거부됐으면 그대로');

  // 성공
  const goalSeen = once(b, 'playerGoal');
  const refreshSeen = once(b, 'leaderboard:refresh');
  const r = await ask(a, 'profile:reset', { nickname: '민수', token: ja.token });
  assert.equal(r.ok, true);
  assert.deepEqual(r.counts, { sessions: 1, attendance: 1, goals: 1, todos: 1 });
  assert.deepEqual(await goalSeen, { id: ja.self.id, goal: null });
  assert.deepEqual(await refreshSeen, { nickname: '민수', seconds: 0 });
  assert.deepEqual((await ask(a, 'todo:list')).todos, []);
  assert.equal((await ask(b, 'todo:list')).todos.length, 1);
  st = await ask(b, 'stats');
  const me = st.rows.find((r2) => r2.nickname === '민수');
  assert.equal(me.todaySeconds, 0);
  assert.equal(me.streak, 0);
  assert.equal(srv.world.listPlayers().find((p) => p.nickname === '민수').goal, null);
  // 재입장해도 목표는 없다
  await ask(a, 'leave');
  const a2 = connect(srv.port);
  t.after(() => a2.close());
  const j2 = await joinAs(a2, { nickname: '민수' });
  assert.equal(j2.profile.goal, null);
  assert.equal(j2.profile.streak.streak, 0);
});

// ── 브라우저 ────────────────────────────────────────────────────────
const hasChrome = Boolean(CHROME);
let puppeteer = null;
try { puppeteer = require('puppeteer-core'); } catch (_) { /* devDependency 없음 */ }

test('브라우저: 카드 접기 유지 · 채팅 높이 · 뽀모도로 시간 입력 · 화면 크기/넓게 보기 · 기록 초기화 모달', { skip: !hasChrome || !puppeteer ? 'Chrome/puppeteer-core 없음' : false, timeout: 120000 }, async (t) => {
  const srv = await boot({ world: { pomodoro: { focusMs: 25 * MIN, breakMs: 5 * MIN }, study: { autoTick: false } } });
  t.after(() => srv.close());
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: CHROME_ARGS,
  });
  t.after(() => browser.close());
  const errors = [];
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewport({ width: 1200, height: 800 });
  const url = pageUrl(srv);
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForSelector('#login:not([hidden])', { timeout: 30000 });
  await page.type('#login-nick', '설정테스트');
  await page.click('#login-submit');
  await page.waitForFunction(() => window.NSM && window.NSM.scene.me, { timeout: 30000 });
  const ls = (k) => page.evaluate((key) => localStorage.getItem(key), k);

  // 채팅 카드: 최소 224px (160 → +40%)
  const chatH = await page.$eval('#card-chat', (el) => el.getBoundingClientRect().height);
  assert.ok(chatH >= 224, `채팅 카드 높이 ${chatH}`);

  // 카드 접기: 모든 카드에 토글, 미니맵을 접으면 제목 줄만 남고 localStorage 에 기억 → 새로고침 후에도 접힘
  assert.equal(await page.$$eval('#sidebar .card .card-toggle', (els) => els.length), 7);
  const openH = await page.$eval('#card-minimap', (el) => el.getBoundingClientRect().height);
  await page.click('#card-minimap .card-toggle');
  const closedH = await page.$eval('#card-minimap', (el) => el.getBoundingClientRect().height);
  assert.ok(closedH < 60 && closedH < openH / 3, `접힌 높이 ${closedH} (펼침 ${openH})`);
  assert.equal(await page.$eval('#minimap', (el) => getComputedStyle(el).display), 'none');
  assert.equal(await ls('nsm.card.card-minimap'), '1');
  await page.click('#card-chat .card-toggle');
  assert.equal(await ls('nsm.card.card-chat'), '1');
  // Enter 로 채팅 포커스 → 채팅 카드는 다시 펼쳐진다
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.activeElement.id === 'chat-input', { timeout: 3000 });
  assert.equal(await page.$eval('#card-chat', (el) => el.classList.contains('collapsed')), false);
  assert.equal(await ls('nsm.card.card-chat'), '0');
  await page.keyboard.press('Escape');

  // 뽀모도로: 기본 25/5, 범위 밖 값은 눌리고, 시작하면 서버 ack 값으로 표시 + 입력 잠김, 정지하면 풀림
  assert.equal(await page.$eval('#pomo-focus', (el) => el.value), '25');
  assert.equal(await page.$eval('#pomo-time', (el) => el.textContent), '25:00');
  await page.$eval('#pomo-focus', (el) => { el.value = '200'; el.dispatchEvent(new Event('change')); });
  assert.equal(await page.$eval('#pomo-focus', (el) => el.value), '90', '90분으로 눌림');
  assert.equal(await page.$eval('#pomo-time', (el) => el.textContent), '90:00', '대기 중 표시도 내 설정');
  await page.$eval('#pomo-focus', (el) => { el.value = '40'; el.dispatchEvent(new Event('change')); });
  await page.$eval('#pomo-break', (el) => { el.value = '2'; el.dispatchEvent(new Event('change')); });
  assert.equal(await page.$eval('#pomo-break', (el) => el.value), '5', '5분으로 눌림');
  await page.$eval('#pomo-break', (el) => { el.value = '10'; el.dispatchEvent(new Event('change')); });
  assert.deepEqual(JSON.parse(await ls('nsm.pomo')), { focus: 40, break: 10 });
  await page.click('#btn-pomo');
  await page.waitForFunction(() => window.NSM.ui.pomodoro && window.NSM.ui.pomodoro.running, { timeout: 5000 });
  const snap = srv.world.pomodoroOf([...srv.world.players.values()][0]).snapshot();
  assert.equal(snap.focusMs, 40 * MIN);
  assert.equal(snap.breakMs, 10 * MIN);
  assert.equal(await page.$eval('#pomo-focus', (el) => el.disabled), true);
  assert.match(await page.$eval('#pomo-hint', (el) => el.textContent), /집중 40분 · 휴식 10분/);
  assert.match(await page.$eval('#pomo-time', (el) => el.textContent), /^(40:00|39:5\d)$/);
  assert.equal(await page.$eval('#pomo-badge', (el) => el.hidden), false);
  await page.click('#btn-pomo');
  await page.waitForFunction(() => window.NSM.ui.pomodoro && !window.NSM.ui.pomodoro.running, { timeout: 5000 });
  assert.equal(await page.$eval('#pomo-focus', (el) => el.disabled), false);

  // 화면 크기: 크게(2.5) → 카메라 줌·텍스트 해상도, localStorage. 넓게 보기 → 사이드바 숨김·캔버스 전체 폭
  await openSettings(page);
  await page.click('#zoom-tabs button[data-zoom="2.5"]');
  await page.waitForFunction(() => window.NSM.scene.cameras.main.zoom === 2.5, { timeout: 3000 });
  assert.equal(await ls('nsm.zoom'), '2.5');
  assert.equal(await page.evaluate(() => window.NSM.scene.me.name.style.resolution), 2.5, '이름표 텍스트 해상도가 줌을 따라감');
  await page.click('#opt-wide');
  await page.waitForFunction(() => document.querySelector('#game canvas').clientWidth === window.innerWidth, { timeout: 3000 });
  assert.equal(await page.$eval('#sidebar', (el) => getComputedStyle(el).display), 'none');
  assert.equal(await ls('nsm.wide'), '1');
  assert.equal(await page.$eval('#btn-wide', (el) => el.classList.contains('active')), true);
  await page.click('#btn-wide'); // 우상단 버튼으로도 해제
  await page.waitForFunction(() => document.querySelector('#game canvas').clientWidth < window.innerWidth, { timeout: 3000 });
  assert.equal(await ls('nsm.wide'), '0');
  assert.equal(await page.$eval('#opt-wide', (el) => el.checked), false);

  // 새로고침: 접힌 미니맵 · 줌 2.5 · 뽀모도로 40/10 이 유지된다
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.NSM && window.NSM.scene.me, { timeout: 30000 });
  assert.equal(await page.$eval('#card-minimap', (el) => el.classList.contains('collapsed')), true);
  assert.equal(await page.evaluate(() => window.NSM.scene.cameras.main.zoom), 2.5);
  assert.equal(await page.$eval('#zoom-tabs button.active', (el) => el.dataset.zoom), '2.5');
  assert.equal(await page.$eval('#pomo-focus', (el) => el.value), '40');
  assert.equal(await page.$eval('#pomo-time', (el) => el.textContent), '40:00');

  // 기록 초기화: 목표 저장 → 설정 → 모달 → 닉네임이 다르면 삭제 버튼 비활성 → 맞으면 삭제 → 목표·팻말 사라짐
  await page.type('#goal-text', '챕터 정리');
  await page.click('#goal-form button[type="submit"]');
  await page.waitForFunction(() => window.NSM.ui.goal && window.NSM.ui.goal.text === '챕터 정리', { timeout: 5000 });
  await page.type('#todo-input', '할 일 하나');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.NSM.ui.todos.length === 1, { timeout: 5000 });
  await openSettings(page);
  await page.click('#btn-reset');
  await page.waitForSelector('#reset-modal:not([hidden])', { timeout: 3000 });
  assert.equal(await page.$eval('#reset-nick-label', (el) => el.textContent), '설정테스트');
  assert.equal(await page.$eval('#reset-submit', (el) => el.disabled), true);
  await page.type('#reset-nick', '설정테스');
  assert.equal(await page.$eval('#reset-submit', (el) => el.disabled), true, '닉네임이 다르면 비활성');
  await page.type('#reset-nick', '트');
  assert.equal(await page.$eval('#reset-submit', (el) => el.disabled), false);
  await page.click('#reset-submit');
  await page.waitForSelector('#reset-modal[hidden]', { timeout: 5000 });
  assert.equal(await page.evaluate(() => window.NSM.ui.goal), null);
  assert.equal(await page.$eval('#goal-text', (el) => el.value), '');
  assert.deepEqual(await page.evaluate(() => window.NSM.ui.todos), []);
  assert.match(await page.$eval('#chat-log', (el) => el.textContent), /모두 지웠어요/);
  assert.equal(await srv.world.store.getGoal('설정테스트', srv.world.today()), null);
  assert.deepEqual(errors, []);
});
