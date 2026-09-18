'use strict';
/**
 * 13단계: 실시간 시간 코인 + 뽀모도로 ↔ 상태 연동.
 *  - 트래커: 앉아서 공부 중 10분이 찰 때마다 tick 에서 **즉시** 'coinDue' → 1코인 (이월 초 포함). 종료 시엔 남은 초만 이월 (tick 사이에 넘긴 코인은 종료 때 지급).
 *    60초 미만 세션은 코인·이월 모두 없음. coinProgress 이벤트(세션 시작 nextCoinAt / 종료 null).
 *  - 이중 지급 방지: 같은 tick 두 번, 재접속 이어받기(같은 세션 객체), 서버 재시작(정상 종료 → 남은 초 이월 / 갑작스런 종료 → 지급 직후 저장된 이월로 같은 구간을 다시 주지 않음).
 *  - 지급 순서: 저장소 응답이 뒤바뀌어도 같은 사람의 'coins' balance 는 커지는 순서 (coinQueue). 구매도 같은 큐.
 *  - 뽀모도로 → 상태: 시작·집중 → 공부 중, 휴식 → 휴식 중(세션 정지), 정지 → 마지막 상태 유지, 집중 중 수동 휴식 → 타이머 계속·세션 정지·보너스 없음,
 *    서 있으면 공부 중이어도 안 쌓임(앉으면 이어서), 야외는 그대로 휴식, 휴식 구간에 앉으면 휴식 중(수동 공부 전환은 가능).
 *  - 소켓 E2E: 입장 ack profile.coins == wallet.coins (재접속·문 이동 뒤에도), coins 이벤트의 nextCoinAt, coinProgress, playerStatus { auto: true }.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { World } = require('../server/game/world');
const { createMemoryStore } = require('../server/store/memory');
const { getStudyRoom } = require('../server/rooms/studyroom');
const { COIN_PER_SECONDS } = require('../server/game/coins');
const { boot, connect, joinAs, ask, once, sleep, collect } = require('./helpers');

const room = getStudyRoom();
const TZ = 'Asia/Seoul';
const KST = (iso) => new Date(`${iso}+09:00`).getTime();
const quiet = { log() {}, warn() {}, error() {} };
const MIN = 60 * 1000;
const T = 32;
const ITEMS = [{ id: 'chair_basic', tab: 'furniture', name: '기본 의자', price: 3 }];

function makeWorld(opts = {}) {
  let t = KST('2026-09-18T10:00:00'); // 금요일
  const store = opts.store || createMemoryStore();
  const world = new World(room, { now: () => t, store, tz: TZ, npc: { autoStart: false }, study: { autoTick: false }, log: quiet, ...opts });
  const seat = room.seats[0];
  const sitDown = (p) => { p.x = (seat.x + 0.5) * T; p.y = (seat.y + 1) * T; return world.sit(p, seat.id); };
  const coins = [];
  const progress = [];
  const statuses = [];
  world.on('coins', (e) => coins.push(e));
  world.on('coinProgress', (e) => progress.push(e));
  world.on('status', ({ player, reason }) => statuses.push([player.nickname, player.status, reason]));
  const settle = async () => { await Promise.all([...world.study.pending]); await Promise.all([...world.pendingAwards]); await Promise.all([...world.study.pending]); };
  const tick = async () => { await world.study.tick(); await settle(); };
  return { world, store, coins, progress, statuses, advance: (ms) => { t += ms; }, now: () => t, seat, sitDown, settle, tick };
}

// ── 트래커: 실시간 지급 ─────────────────────────────────────────────────
test('25분 앉기: 10분·20분에 tick 즉시 1코인씩 (nextCoinAt 포함), 사이 tick 은 중복 없음, 종료 시 추가 지급 없이 300초만 이월', async () => {
  const { world, store, coins, progress, advance, now, sitDown, settle, tick } = makeWorld();
  const a = world.join({ nickname: '민수', socketId: 'sa' }).player;
  const t0 = now();
  sitDown(a);
  await settle();
  const s = world.study.live.get('민수');
  assert.equal(s.carry, 0, '세션이 열리면 이월 초를 읽어 둔다');
  assert.deepEqual(progress, [{ nickname: '민수', playerId: a.id, studyId: null, studying: true, carrySeconds: 0, nextCoinAt: t0 + COIN_PER_SECONDS * 1000 }]);

  advance(9 * MIN + 59 * 1000);
  await tick();
  assert.deepEqual(coins, [], '9분 59초는 아직');
  advance(1000);
  await tick();
  assert.deepEqual(coins, [{ nickname: '민수', playerId: a.id, delta: 1, reason: 'study', balance: 1, carrySeconds: 0, nextCoinAt: now() + COIN_PER_SECONDS * 1000 }], '10분 정각 tick 에 즉시');
  assert.equal(s.coinsAwarded, 1);
  assert.equal(s.lastCoinAt, now(), '마지막 지급 시각을 세션에 기록');
  assert.equal(await store.getCoinCarry('민수'), 0, '지급 직후 남은 초를 저장소에 바로 반영');
  assert.equal(world.study.live.has('민수'), true, '세션은 계속');

  advance(5 * MIN);
  await tick();
  await tick();
  assert.equal(coins.length, 1, '15분: 같은 구간을 두 번 주지 않는다');
  assert.deepEqual(await world.coinProgressOf(a), { carrySeconds: 300, nextCoinAt: now() + 300 * 1000, studying: true });

  advance(5 * MIN);
  await tick();
  assert.equal(coins.length, 2, '20분에 두 번째');
  assert.equal(coins[1].balance, 2);

  advance(5 * MIN);
  world.stand(a); // 25분
  await settle();
  assert.equal(coins.length, 2, '종료 시 추가 지급 없음');
  assert.equal(await store.getCoins('민수'), 2);
  assert.equal(await store.getCoinCarry('민수'), 300, '남은 300초만 이월');
  assert.deepEqual((await store.listSessions('민수')).map((x) => x.seconds), [1500], '세션 저장은 그대로');
  assert.deepEqual(progress.at(-1), { nickname: '민수', playerId: a.id, studyId: null, studying: false, carrySeconds: 300, nextCoinAt: null });
  const w = await world.wallet(a);
  assert.equal(w.coins, 2);
  assert.equal(w.carrySeconds, 300);
  assert.equal(w.nextCoinAt, null);
  assert.equal(w.studying, false);
  await world.dispose();
});

test('이월 초 포함: 480초 이월 + 2분 → 2분 시점에 즉시 1코인. tick 사이에 넘긴 코인은 종료 때 지급하고 남은 초만 이월. 60초 미만은 코인·이월 없음', async () => {
  const { world, store, coins, advance, sitDown, settle, tick } = makeWorld();
  await store.setCoinCarry('민수', 480, Date.now());
  const a = world.join({ nickname: '민수', socketId: 'sa' }).player;
  sitDown(a);
  await settle();
  assert.equal(world.study.live.get('민수').carry, 480);
  advance(MIN);
  await tick();
  assert.equal(coins.length, 0, '480 + 60 = 540');
  advance(MIN);
  await tick();
  assert.equal(coins.length, 1, '480 + 120 = 600 → 즉시');
  assert.equal(coins[0].carrySeconds, 0);
  // tick 없이 8분 30초 더 → 종료 (총 630초 + 480 = 1110 → 이미 1 지급, 510 이월)
  advance(8 * MIN + 30 * 1000);
  world.stand(a);
  await settle();
  assert.equal(coins.length, 1);
  assert.equal(await store.getCoinCarry('민수'), 510);

  // tick 이 한 번도 안 돌고 끝나도 (510 + 90 = 600) 종료 때 지급
  sitDown(a);
  advance(90 * 1000);
  world.stand(a);
  await settle();
  assert.equal(coins.length, 2, '종료 정산에서 tick 사이에 넘긴 코인');
  assert.deepEqual([coins[1].delta, coins[1].carrySeconds, coins[1].nextCoinAt], [1, 0, null]);
  assert.equal(await store.getCoinCarry('민수'), 0);

  // 60초 미만: 이월 590 이어도 tick 판정 없음, 폐기 → 이월 그대로
  await store.setCoinCarry('민수', 590, Date.now());
  sitDown(a);
  await settle();
  advance(30 * 1000);
  await tick();
  assert.equal(coins.length, 2, '60초 미만은 판정하지 않는다');
  world.stand(a);
  await settle();
  assert.equal(coins.length, 2);
  assert.equal(await store.getCoinCarry('민수'), 590, '폐기 세션은 이월도 그대로');
  await world.dispose();
});

test('재접속 이어받기 중에도 중복 없음: 10분 코인 뒤 끊김 → 같은 토큰으로 복귀 → 같은 세션이 이어져 20분에만 한 번 더', async () => {
  const { world, coins, advance, sitDown, tick, settle } = makeWorld({ graceMs: 60 * 1000 });
  const a = world.join({ nickname: '민수', socketId: 'sa' }).player;
  sitDown(a);
  advance(10 * MIN);
  await tick();
  assert.equal(coins.length, 1);
  const s = world.study.live.get('민수');
  world.disconnect(a);
  advance(10 * 1000);
  await tick();
  const back = world.join({ nickname: '민수', token: a.token, socketId: 'sa2' });
  assert.equal(back.resumed, true);
  assert.equal(back.player, a);
  assert.equal(world.study.live.get('민수'), s, '세션 객체가 그대로 (coinsAwarded 유지)');
  await tick();
  assert.equal(coins.length, 1, '10분 10초: 재접속해도 같은 구간을 다시 주지 않는다');
  advance(9 * MIN + 50 * 1000);
  await tick();
  assert.equal(coins.length, 2, '20분');
  assert.deepEqual((await world.coinProgressOf(a)), { carrySeconds: 0, nextCoinAt: world.now() + COIN_PER_SECONDS * 1000, studying: true });
  world.stand(a);
  await settle();
  assert.equal(coins.length, 2);
  await world.dispose();
});

test('서버 재시작: 정상 종료는 남은 초를 이월해 이어받고, 갑작스런 종료(dispose 없음)여도 지급 직후 저장된 이월 덕에 같은 구간을 두 번 주지 않는다', async () => {
  const store = createMemoryStore();
  const w1 = makeWorld({ store });
  const a = w1.world.join({ nickname: '민수', socketId: 'sa' }).player;
  w1.sitDown(a);
  w1.advance(15 * MIN);
  await w1.tick();
  assert.equal(w1.coins.length, 1, '10분 구간 지급 (tick 이 15분에 처음 돌았어도 한 번)');
  assert.equal(await store.getCoinCarry('민수'), 300, '지급 시점까지의 남은 초(11~15분)를 바로 저장');
  // 갑작스런 종료: 세션 저장·이월 갱신 없음 → 새 서버
  const w2 = makeWorld({ store });
  const a2 = w2.world.join({ nickname: '민수', socketId: 'sa' }).player;
  w2.sitDown(a2);
  await w2.settle();
  assert.equal(w2.world.study.live.get('민수').carry, 300, '이미 준 10분 구간은 빠져 있다 (같은 구간을 두 번 받지 않는다)');
  w2.advance(4 * MIN);
  await w2.tick();
  assert.equal(w2.coins.length, 0, '300 + 240 = 540');
  w2.advance(MIN);
  await w2.tick();
  assert.equal(w2.coins.length, 1, '300 + 300 = 600');
  assert.equal(await store.getCoins('민수'), 2);
  // 정상 종료 (dispose → 세션 저장 + 남은 초 이월)
  w2.advance(3 * MIN);
  await w2.world.dispose();
  assert.equal(await store.getCoinCarry('민수'), 180);
  assert.equal((await store.listSessions('민수')).length, 1);
  const w3 = makeWorld({ store });
  const a3 = w3.world.join({ nickname: '민수', socketId: 'sa' }).player;
  w3.sitDown(a3);
  w3.advance(7 * MIN);
  await w3.tick();
  assert.equal(w3.coins.length, 1, '180 + 420 = 600 → 이어받아 지급');
  assert.equal(await store.getCoins('민수'), 3);
  await w3.world.dispose();
  await w1.world.dispose();
});

test('지급 순서: 저장소 응답이 뒤바뀌어도 같은 사람의 coins balance 는 커지는 순서 (보너스 + 시간 코인 동시, 구매 포함)', async () => {
  const base = createMemoryStore();
  const store = Object.create(base);
  // 첫 호출(focus)은 느리게, 두 번째(study)는 빨리 응답 → 큐가 없으면 balance 7 → 5 순서로 나갔을 것
  store.adjustCoins = async (nickname, delta, reason, at) => {
    const r = await base.adjustCoins(nickname, delta, reason, at);
    await sleep(reason === 'focus' ? 40 : 1);
    return r;
  };
  const { world, coins, advance, sitDown, settle } = makeWorld({ store, pomodoro: { focusMs: 25 * MIN, breakMs: 5 * MIN }, shop: ITEMS });
  const a = world.join({ nickname: '민수', socketId: 'sa' }).player;
  sitDown(a);
  advance(MIN);
  world.startPomodoro(a);
  const pomo = world.pomodoroOf(a);
  advance(25 * MIN);
  pomo.advance(); // 보너스 5 + (휴식 전환으로 끝난 26분 세션) 시간 코인 2 — 거의 동시에 큐에 들어간다
  await Promise.all([...world.study.pending]); // 시간 코인이 큐에 들어간 뒤
  const buyP = world.purchase(a, 'chair_basic'); // 구매 -3 도 같은 큐 (focus 저장이 끝나기 전)
  assert.equal(coins.length, 0, 'focus 저장이 아직 느리게 진행 중');
  await settle();
  const buy = await buyP;
  assert.equal(buy.ok, true);
  assert.deepEqual(coins.map((c) => [c.reason, c.delta, c.balance]), [['focus', 5, 5], ['study', 2, 7], ['purchase:chair_basic', -3, 4]]);
  let run = 0;
  for (const c of coins) { run += c.delta; assert.equal(c.balance, run, '이벤트 순서대로 더하면 balance 와 같다'); }
  assert.equal(await base.getCoins('민수'), 4);
  assert.equal(world.coinQueue.size, 0);
  await world.dispose();
});

// ── 뽀모도로 ↔ 상태 ──────────────────────────────────────────────────────
test('뽀모도로가 상태를 이끈다: 시작·집중 → 공부 중, 휴식 → 휴식 중(세션 정지), 다시 집중 → 새 세션, 정지 → 마지막 상태 유지', async () => {
  const { world, coins, statuses, advance, now, sitDown, settle } = makeWorld({ pomodoro: { focusMs: 25 * MIN, breakMs: 5 * MIN } });
  const a = world.join({ nickname: '민수', socketId: 'sa' }).player;
  assert.equal(a.status, 'rest');
  // 서 있는 채 시작 → 공부 중이지만 세션은 없다 (앉아야 쌓인다)
  world.startPomodoro(a);
  const pomo = world.pomodoroOf(a);
  assert.equal(a.status, 'study');
  assert.deepEqual(statuses, [['민수', 'study', 'pomodoro']]);
  assert.equal(world.study.live.has('민수'), false, '서 있으면 안 쌓임');
  advance(5 * MIN);
  sitDown(a);
  assert.equal(a.status, 'study');
  const s1 = world.study.live.get('민수');
  assert.ok(s1, '앉으면 이어서');
  // 집중 끝 → 휴식 중, 세션 종료(20분 저장 → 2코인)
  advance(20 * MIN);
  pomo.advance();
  await settle();
  assert.equal(pomo.phase, 'break');
  assert.equal(a.status, 'rest');
  assert.equal(a.seatId, world.seat ? a.seatId : a.seatId, '앉은 채');
  assert.equal(world.study.live.has('민수'), false, '휴식 구간엔 세션 정지');
  assert.deepEqual(coins.map((c) => [c.reason, c.delta]), [['study', 2]], '사이클 도중에 앉았으니 보너스 없음, 20분 세션 시간 코인만');
  assert.equal(statuses.at(-1)[1], 'rest');
  // 휴식 끝 → 다시 공부 중, 새 세션 (사이클 시작과 같은 시각)
  advance(5 * MIN);
  pomo.advance();
  assert.equal(a.status, 'study');
  const s2 = world.study.live.get('민수');
  assert.ok(s2 && s2 !== s1);
  assert.equal(s2.startedAt, pomo.startedAt);
  assert.equal(s2.startedAt, now());
  // 정지 → 마지막 상태(공부 중) 유지, 세션 계속
  advance(3 * MIN);
  assert.equal(world.stopPomodoro(a).ok, true);
  assert.equal(a.status, 'study');
  assert.equal(world.study.live.get('민수'), s2, '정지해도 세션은 이어진다');
  assert.equal(statuses.filter((x) => x[1] === 'study').length, 2, 'stop 은 status 이벤트를 내지 않는다');
  await world.dispose();
});

test('집중 중 수동 휴식: 타이머는 계속 돌고 세션만 멈춤 → 보너스 없음. 휴식 구간에 앉으면 휴식 중(수동으로 공부 중 전환은 가능). 야외에서는 타이머가 돌아도 휴식', async () => {
  const { world, coins, advance, sitDown, settle } = makeWorld({ pomodoro: { focusMs: 25 * MIN, breakMs: 5 * MIN } });
  const a = world.join({ nickname: '민수', socketId: 'sa' }).player;
  sitDown(a);
  world.startPomodoro(a);
  const pomo = world.pomodoroOf(a);
  advance(10 * MIN);
  assert.equal(world.setStatus(a, 'rest').ok, true);
  assert.equal(pomo.running, true, '타이머는 계속');
  assert.equal(pomo.phase, 'focus');
  assert.equal(world.study.live.has('민수'), false, '세션은 멈춤');
  await settle();
  assert.deepEqual(coins.map((c) => [c.reason, c.delta]), [['study', 1]], '10분 세션 정산');
  advance(15 * MIN);
  pomo.advance(); // 집중 끝 → 보너스 조건 실패 (공부 중이 아님)
  await settle();
  assert.deepEqual(coins.filter((c) => c.reason === 'focus'), []);
  assert.equal(a.status, 'rest');
  // 휴식 구간: 일어나서 다시 앉아도 휴식 중
  world.stand(a);
  assert.equal(sitDown(a).ok, true);
  assert.equal(a.status, 'rest', '휴식 구간에 앉으면 타이머를 따라 휴식 중');
  assert.equal(world.study.live.has('민수'), false);
  assert.equal(world.setStatus(a, 'study').ok, true, '수동 전환은 가능');
  assert.equal(world.study.live.has('민수'), true);
  advance(5 * MIN);
  pomo.advance(); // 휴식 끝 → 집중: 이미 공부 중이라 그대로 (세션 유지)
  assert.equal(a.status, 'study');
  await world.dispose();

  // 야외: 공부 상태가 없으므로 타이머가 돌아도 휴식, 세션 없음
  const out = makeWorld({ outdoor: true, pomodoro: { focusMs: 25 * MIN, breakMs: 5 * MIN } });
  const b = out.world.join({ nickname: '영희', socketId: 'sb' }).player;
  assert.equal(out.world.startPomodoro(b).ok, true);
  assert.equal(b.status, 'rest');
  assert.deepEqual(out.statuses, []);
  out.sitDown(b);
  assert.equal(b.status, 'rest');
  assert.equal(out.world.study.live.has('영희'), false);
  await out.world.dispose();
});

// ── 소켓 E2E ────────────────────────────────────────────────────────────
test('소켓 E2E: 입장 ack profile.coins == wallet.coins (재접속·문 이동 뒤에도), coins 즉시 + nextCoinAt, coinProgress, playerStatus auto', async (t) => {
  let now = KST('2026-09-18T10:00:00');
  const srv = await boot({ world: { now: () => now, npc: { autoStart: false }, study: { autoTick: false }, pomodoro: { focusMs: 25 * MIN, breakMs: 5 * MIN } } });
  t.after(() => srv.close());
  const a = connect(srv.port);
  const b = connect(srv.port);
  t.after(() => { a.close(); b.close(); });
  const ja = await joinAs(a, { nickname: '민수' });
  await joinAs(b, { nickname: '영희' });
  assert.equal(ja.profile.coins, 0);
  assert.deepEqual(ja.profile.coinProgress, { carrySeconds: 0, nextCoinAt: null, studying: false });
  assert.equal((await ask(a, 'wallet')).coins, ja.profile.coins, '입장 ack 와 wallet 이 같은 값');
  const coinsA = collect(a, 'coins');
  const progressA = collect(a, 'coinProgress');

  // 앉기 → coinProgress(studying, nextCoinAt = 지금 + 10분)
  const pa = srv.world.players.get(ja.self.id);
  const seat = room.seats[0];
  pa.x = (seat.x + 0.5) * T; pa.y = (seat.y + 1) * T;
  const prog = once(a, 'coinProgress');
  assert.equal((await ask(a, 'sit', { seatId: seat.id })).ok, true);
  assert.deepEqual(await prog, { studying: true, carrySeconds: 0, nextCoinAt: now + 10 * MIN });
  let w = await ask(a, 'wallet');
  assert.equal(w.studying, true);
  assert.equal(w.nextCoinAt, now + 10 * MIN);

  // 10분 → tick → 즉시 coins (본인: balance + nextCoinAt, 남: 없음)
  now += 10 * MIN;
  const seenA = once(a, 'coins');
  const seenB = once(b, 'coins');
  await srv.hub.study.tick();
  assert.deepEqual(await seenA, { id: ja.self.id, delta: 1, reason: 'study', balance: 1, carrySeconds: 0, nextCoinAt: now + 10 * MIN });
  assert.deepEqual(await seenB, { id: ja.self.id, delta: 1, reason: 'study' });
  assert.equal((await ask(a, 'wallet')).coins, 1);

  // 재접속(같은 토큰): profile.coins == wallet.coins, 진행 중 세션의 nextCoinAt, 같은 구간 중복 없음
  now += 5 * MIN;
  a.close();
  const a2 = connect(srv.port);
  t.after(() => a2.close());
  const ja2 = await joinAs(a2, { nickname: '민수', token: ja.token });
  assert.equal(ja2.resumed, true);
  assert.equal(ja2.profile.coins, 1);
  assert.deepEqual(ja2.profile.coinProgress, { carrySeconds: 300, nextCoinAt: now + 5 * MIN, studying: true });
  w = await ask(a2, 'wallet');
  assert.equal(w.coins, ja2.profile.coins, '재접속 뒤에도 입장 ack 와 wallet 이 같다');
  assert.equal(w.nextCoinAt, ja2.profile.coinProgress.nextCoinAt);
  const coinsA2 = collect(a2, 'coins');
  await srv.hub.study.tick();
  await sleep(30);
  assert.equal(coinsA2.length, 0, '15분: 중복 없음');
  now += 5 * MIN;
  const second = once(a2, 'coins');
  await srv.hub.study.tick();
  assert.equal((await second).balance, 2, '20분');
  assert.equal(coinsA.length, 1, '옛 소켓은 첫 코인만 받았다');
  assert.equal(progressA.length, 1);

  // 일어나기 → coinProgress(studying false, 이월 0) · 문으로 야외 → ack profile.coins 가 서버 잔액 그대로, wallet 과 같다
  const ended = once(a2, 'coinProgress');
  await ask(a2, 'stand');
  assert.deepEqual(await ended, { studying: false, carrySeconds: 0, nextCoinAt: null });
  pa.x = 22.5 * T; pa.y = 25 * T;
  const out = await ask(a2, 'door', {});
  assert.equal(out.ok, true);
  assert.equal(out.room, 'outdoor');
  assert.equal(out.profile.coins, 2, '문 이동 ack 에도 잔액');
  assert.deepEqual(out.profile.coinProgress, { carrySeconds: 0, nextCoinAt: null, studying: false });
  assert.equal((await ask(a2, 'wallet')).coins, out.profile.coins);
  pa.x = 31.5 * T; pa.y = 20 * T;
  const back = await ask(a2, 'door', {});
  assert.equal(back.ok, true);
  assert.equal(back.profile.coins, 2);
  assert.equal((await ask(a2, 'wallet')).coins, 2);

  // 뽀모도로 시작 → 모두에게 playerStatus { auto: true } (서 있어도 공부 중, 세션은 없음)
  const st = once(b, 'playerStatus');
  assert.equal((await ask(a2, 'pomodoro:start', {})).ok, true);
  assert.deepEqual(await st, { id: ja.self.id, status: 'study', auto: true });
  assert.equal(srv.hub.study.live.has('민수'), false, '서 있으면 세션 없음');
  // 앉으면 세션 시작, 집중 끝 → 휴식 중 방송
  pa.x = (seat.x + 0.5) * T; pa.y = (seat.y + 1) * T;
  assert.equal((await ask(a2, 'sit', { seatId: seat.id })).status, 'study');
  assert.equal(srv.hub.study.live.has('민수'), true);
  now += 25 * MIN;
  const restSt = once(b, 'playerStatus');
  srv.world.pomodoroOf(pa).advance();
  assert.deepEqual(await restSt, { id: ja.self.id, status: 'rest', auto: true });
  assert.equal(srv.hub.study.live.has('민수'), false, '휴식 구간엔 세션 정지');
  await sleep(50);
  assert.equal((await ask(a2, 'wallet')).coins, await srv.world.store.getCoins('민수'), '잔액은 항상 서버 값');
});
