'use strict';
/**
 * 8단계: 코인 시스템 (상점 뼈대).
 *  - 적립 계산: 10분 경계(599s → 0, 600s → 1), 세션 분할은 남은 초를 이월(9분 + 9분 = 1코인 + 480초 이월, users.coin_carry_seconds), 60초 미만 폐기 그대로.
 *    이월은 기록 초기화 때 0. 지갑에 carrySeconds.
 *  - 집중 완주 보너스: 사이클 시작부터 끝까지 앉아서 공부 중이어야 5코인. 중간에 일어나면 없음, 20분 미만 사이클 없음, 정지는 없음, 휴식 종료는 없음.
 *  - 이중 지급 방지: 같은 사이클 두 번 정산해도 한 번, 세션 end 두 번 호출해도 한 번.
 *  - 구매: 카탈로그 없음 → no_item, 잔액 부족 → insufficient (원장·인벤토리 기록 없음), 성공 시 차감·원장·인벤토리.
 *  - 저장소: adjustCoins 원자성(음수 불가), coinLedger 최근순, coinStats 이번 주 획득만.
 *  - 소켓 E2E: profile.coins, coins 이벤트(본인 balance / 남은 없음), wallet, shop:buy, stats.weekCoins, playerPomodoro 동기화.
 *  - 브라우저: 잔액 배지 · 지갑 모달(탭 4개, 가구 외 "준비 중" · 거래 내역) · 머리 위 🍅 남은 시간 · 코인 소리 설정.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { coinsForSession, settleStudy, focusBonusFor, FOCUS_BONUS, FOCUS_BONUS_MIN_MS } = require('../server/game/coins');
const { createShop, TABS } = require('../server/game/shop');
const { Pomodoro } = require('../server/game/pomodoro');
const { World } = require('../server/game/world');
const { createMemoryStore } = require('../server/store/memory');
const { getStudyRoom } = require('../server/rooms/studyroom');
const { boot, connect, joinAs, ask, once, sleep, collect } = require('./helpers');

const room = getStudyRoom();
const TZ = 'Asia/Seoul';
const KST = (iso) => new Date(`${iso}+09:00`).getTime();
const quiet = { log() {}, warn() {}, error() {} };
const MIN = 60 * 1000;
const ITEMS = [{ id: 'chair_basic', tab: 'furniture', name: '기본 의자', price: 10 }, { id: 'free_sticker', tab: 'petDeco', name: '공짜 스티커', price: 0 }];

function makeWorld(opts = {}) {
  let t = KST('2026-09-17T10:00:00'); // 목요일
  const store = createMemoryStore();
  const world = new World(room, { now: () => t, store, tz: TZ, npc: { autoStart: false }, study: { autoTick: false }, log: quiet, ...opts });
  const seat = room.seats[0];
  const sitDown = (p) => { p.x = (seat.x + 0.5) * 32; p.y = (seat.y + 1) * 32; return world.sit(p, seat.id); };
  const coins = [];
  world.on('coins', (e) => coins.push(e));
  return { world, store, coins, advance: (ms) => { t += ms; }, now: () => t, seat, sitDown };
}

/** 세션 저장(비동기)·코인 지급이 끝날 때까지 */
const settle = async (world) => { await Promise.all([...world.study.pending]); await Promise.all([...world.pendingAwards]); };

// ── 순수 규칙 ────────────────────────────────────────────────────────
test('coinsForSession: 10분당 1코인, 경계는 내림', () => {
  assert.equal(coinsForSession(0), 0);
  assert.equal(coinsForSession(59), 0);
  assert.equal(coinsForSession(599), 0);
  assert.equal(coinsForSession(600), 1);
  assert.equal(coinsForSession(1199), 1);
  assert.equal(coinsForSession(1200), 2);
  assert.equal(coinsForSession(3600), 6);
  assert.equal(coinsForSession(-5), 0);
  assert.equal(coinsForSession('abc'), 0);
});

test('settleStudy: 이월 초 + 이번 세션 초를 10분 단위로 정산하고 나머지를 돌려준다', () => {
  assert.deepEqual(settleStudy(0, 599), { coins: 0, carry: 599 });
  assert.deepEqual(settleStudy(599, 1), { coins: 1, carry: 0 });
  assert.deepEqual(settleStudy(0, 600), { coins: 1, carry: 0 });
  assert.deepEqual(settleStudy(540, 540), { coins: 1, carry: 480 }, '9분 + 9분');
  assert.deepEqual(settleStudy(300, 900), { coins: 2, carry: 0 });
  assert.deepEqual(settleStudy(0, 1250), { coins: 2, carry: 50 });
  assert.deepEqual(settleStudy(50, 3610), { coins: 6, carry: 60 });
  assert.deepEqual(settleStudy(-10, -5), { coins: 0, carry: 0 }, '음수·이상한 값은 0');
  assert.deepEqual(settleStudy('abc', null), { coins: 0, carry: 0 });
  assert.deepEqual(settleStudy(599.9, 0.9), { coins: 0, carry: 599 }, '소수점은 버림');
});

test('focusBonusFor: 집중 20분 이상 + 사이클 시작 이전부터 이어진 공부 세션일 때만 5', () => {
  const cycle = { phase: 'focus', startedAt: 1000, endsAt: 1000 + 25 * MIN, durationMs: 25 * MIN };
  assert.equal(FOCUS_BONUS, 5);
  assert.equal(FOCUS_BONUS_MIN_MS, 20 * MIN);
  assert.equal(focusBonusFor(cycle, { startedAt: 1000 }), 5, '동시에 시작해도 인정');
  assert.equal(focusBonusFor(cycle, { startedAt: 500 }), 5);
  assert.equal(focusBonusFor(cycle, { startedAt: 1001 }), 0, '사이클 도중에 앉음');
  assert.equal(focusBonusFor(cycle, null), 0, '공부 중 아님');
  assert.equal(focusBonusFor({ ...cycle, phase: 'break' }, { startedAt: 0 }), 0, '휴식 종료는 아님');
  assert.equal(focusBonusFor({ ...cycle, durationMs: 20 * MIN }, { startedAt: 0 }), 5, '정확히 20분은 인정');
  assert.equal(focusBonusFor({ ...cycle, durationMs: 20 * MIN - 1 }, { startedAt: 0 }), 0, '20분 미만');
  assert.equal(focusBonusFor(null, { startedAt: 0 }), 0);
});

test('Pomodoro: 자동 전환 때 phaseEnd(끝난 단계), 정지 때는 없음', async () => {
  let t = 1000;
  const p = new Pomodoro({ focusMs: 30, breakMs: 20, now: () => t });
  const ends = [];
  p.on('phaseEnd', (c) => ends.push(c));
  p.start('나');
  t += 30;
  p.advance(); // 타이머 대신 직접
  assert.deepEqual(ends, [{ phase: 'focus', startedAt: 1000, endsAt: 1030, durationMs: 30 }]);
  assert.equal(p.phase, 'break');
  p.stop();
  assert.equal(ends.length, 1, '정지는 phaseEnd 없음');
  p.dispose();
});

test('shop: 탭 4개 고정, 기본 카탈로그는 9단계 가구 23종(가구 탭만), 잘못된 아이템은 걸러짐', () => {
  assert.deepEqual(TABS.map((t) => t.id), ['furniture', 'pet', 'petDeco', 'mount']);
  const def = createShop();
  assert.equal(def.items.length, 23);
  assert.ok(def.items.every((i) => i.tab === 'furniture'), '펫·탈것 탭은 아직 준비 중');
  assert.equal(def.get('chair_basic'), null);
  const shop = createShop([...ITEMS, { id: 'bad', tab: 'nope', name: 'x', price: 1 }, { id: 'neg', tab: 'pet', name: 'x', price: -1 }, { id: 'frac', tab: 'pet', name: 'x', price: 1.5 }]);
  assert.deepEqual(shop.items.map((i) => i.id), ['chair_basic', 'free_sticker']);
  assert.equal(shop.get('chair_basic').price, 10);
  assert.equal(shop.get(null), null);
  assert.equal(shop.get({}), null);
});

// ── 저장소 ───────────────────────────────────────────────────────────
test('메모리 저장소: adjustCoins 는 0 아래로 못 내려가고(원장 없음), 원장은 최근순, coinStats 는 이번 주 양수만 합산', async () => {
  const s = createMemoryStore();
  const t0 = KST('2026-09-17T10:00:00');
  assert.equal(await s.getCoins('민수'), 0, '없는 사용자는 0');
  assert.deepEqual(await s.coinLedger('민수'), []);
  assert.equal((await s.adjustCoins('민수', -1, 'purchase:x', t0)).error, 'insufficient');
  assert.equal((await s.adjustCoins('민수', 0, 'x', t0)).error, 'invalid');
  assert.equal((await s.adjustCoins('민수', 1.5, 'x', t0)).error, 'invalid');
  assert.deepEqual(await s.coinLedger('민수'), [], '거부는 원장에 남지 않음');
  const a = await s.adjustCoins('민수', 3, 'study', t0);
  assert.equal(a.ok, true);
  assert.equal(a.balance, 3);
  assert.equal(a.entry.reason, 'study');
  await s.adjustCoins('민수', 5, 'focus', t0 + MIN);
  const buy = await s.adjustCoins('민수', -6, 'purchase:chair', t0 + 2 * MIN);
  assert.equal(buy.balance, 2);
  assert.equal((await s.adjustCoins('민수', -3, 'purchase:chair', t0 + 3 * MIN)).error, 'insufficient');
  assert.equal(await s.getCoins('민수'), 2);
  const led = await s.coinLedger('민수');
  assert.deepEqual(led.map((e) => [e.delta, e.reason]), [[-6, 'purchase:chair'], [5, 'focus'], [3, 'study']]);
  assert.equal((await s.coinLedger('민수', 2)).length, 2);
  // 지난주 획득은 이번 주 합계에 안 들어감 (2026-09-14 월요일이 주 시작)
  await s.adjustCoins('민수', 7, 'study', KST('2026-09-13T23:00:00'));
  await s.adjustCoins('영희', 4, 'study', KST('2026-09-14T00:30:00'));
  const stats = await s.coinStats({ tz: TZ, now: t0 + 5 * MIN });
  assert.deepEqual(stats.find((r) => r.nickname === '민수'), { nickname: '민수', coins: 9, weekCoins: 8 });
  assert.deepEqual(stats.find((r) => r.nickname === '영희'), { nickname: '영희', coins: 4, weekCoins: 4 });
  // 인벤토리
  const inv = await s.addInventory('민수', 'chair', { price: 6 }, t0);
  assert.equal(inv.itemId, 'chair');
  assert.deepEqual((await s.listInventory('민수')).map((i) => i.itemId), ['chair']);
  assert.deepEqual(await s.listInventory('영희'), []);
  // 이월 초: 없는 사용자는 0, 음수·소수는 눌러서 저장
  assert.equal(await s.getCoinCarry('없음'), 0);
  assert.equal(await s.setCoinCarry('민수', 480, t0), 480);
  assert.equal(await s.getCoinCarry('민수'), 480);
  assert.equal(await s.setCoinCarry('민수', -3, t0), 0);
  assert.equal(await s.setCoinCarry('민수', 12.7, t0), 12);
  assert.equal(await s.setCoinCarry('신규', 100, t0), 100, '없던 사용자도 만들어진다');
  assert.equal((await s.getUser('신규')).coinCarrySeconds, 100);
  await s.setCoinCarry('민수', 480, t0);
  // 기록 초기화는 코인 잔액·인벤토리는 건드리지 않고 이월 초만 0으로
  await s.resetUser('민수');
  assert.equal(await s.getCoins('민수'), 9);
  assert.equal((await s.listInventory('민수')).length, 1);
  assert.equal(await s.getCoinCarry('민수'), 0);
  assert.equal(await s.getCoinCarry('신규'), 100, '다른 사람 이월은 그대로');
});

// ── 월드: 적립 ───────────────────────────────────────────────────────
test('월드: 세션 저장 시 10분당 1코인 — 25분 → 2 (+300초 이월), 9분+9분 분할 → 이월 합산으로 1, 59초 → 폐기(이월 그대로)', async () => {
  const { world, store, coins, advance, sitDown } = makeWorld();
  const a = world.join({ nickname: '민수', socketId: 'sa' }).player;
  sitDown(a);
  advance(25 * MIN);
  world.stand(a);
  await settle(world);
  assert.deepEqual(coins, [{ nickname: '민수', playerId: a.id, delta: 2, reason: 'study', balance: 2 }]);
  assert.equal(await store.getCoins('민수'), 2);
  assert.equal(await store.getCoinCarry('민수'), 300, '25분 중 5분이 이월');

  sitDown(a); advance(9 * MIN); world.stand(a);
  await settle(world);
  assert.equal(coins.length, 2, '이월 300 + 540 = 840 → 1코인');
  assert.equal(coins.at(-1).delta, 1);
  assert.equal(await store.getCoinCarry('민수'), 240);
  sitDown(a); advance(9 * MIN); world.stand(a);
  await settle(world);
  assert.equal(coins.length, 3, '240 + 540 = 780 → 1코인');
  assert.equal(await store.getCoinCarry('민수'), 180);
  assert.equal((await store.listSessions('민수')).length, 3);

  sitDown(a); advance(59 * 1000); world.stand(a);
  await settle(world);
  assert.equal(coins.length, 3, '60초 미만은 세션 폐기 → 정산 없음');
  assert.equal(await store.getCoinCarry('민수'), 180, '폐기된 세션은 이월에도 안 들어감');

  sitDown(a); advance(7 * MIN); world.stand(a);
  await settle(world);
  assert.equal(coins.length, 4, '180 + 420 = 600 → 정확히 1코인');
  assert.equal(await store.getCoinCarry('민수'), 0);
  assert.equal(coins.at(-1).balance, 5);
  assert.equal((await store.coinLedger('민수')).length, 4);
  await world.dispose();
});

test('월드: 이월은 사람마다 따로, 서버 재시작(새 월드·같은 저장소) 뒤에도 이어지고, 기록 초기화하면 0', async () => {
  const store = createMemoryStore();
  const w1 = makeWorld({ store });
  const a = w1.world.join({ nickname: '민수', socketId: 'sa' }).player;
  const b = w1.world.join({ nickname: '영희', socketId: 'sb' }).player;
  w1.sitDown(a); w1.advance(8 * MIN); w1.world.stand(a);
  b.x = a.x; b.y = a.y; // 다른 자리
  const seat2 = room.seats[1];
  b.x = (seat2.x + 0.5) * 32; b.y = (seat2.y + 1) * 32;
  w1.world.sit(b, seat2.id); w1.advance(4 * MIN); w1.world.stand(b);
  await settle(w1.world);
  assert.equal(await store.getCoinCarry('민수'), 480);
  assert.equal(await store.getCoinCarry('영희'), 240);
  assert.deepEqual(w1.coins, [], '아직 아무도 10분을 못 채움');
  await w1.world.dispose();

  // 재시작: 새 World, 같은 store → 이월이 이어진다
  const w2 = makeWorld({ store });
  const a2 = w2.world.join({ nickname: '민수', socketId: 'sa2' }).player;
  w2.sitDown(a2); w2.advance(2 * MIN); w2.world.stand(a2);
  await settle(w2.world);
  assert.deepEqual(w2.coins.map((c) => [c.nickname, c.delta]), [['민수', 1]], '480 + 120 = 600');
  assert.equal(await store.getCoinCarry('민수'), 0);
  assert.equal(await store.getCoinCarry('영희'), 240, '영희 것은 그대로');
  assert.equal((await w2.world.wallet(a2)).carrySeconds, 0);

  // 기록 초기화 → 이월 0, 코인 잔액은 유지
  w2.sitDown(a2); w2.advance(5 * MIN); w2.world.stand(a2);
  await settle(w2.world);
  assert.equal((await w2.world.wallet(a2)).carrySeconds, 300);
  const r = await w2.world.resetProfile(a2, { nickname: '민수', token: a2.token });
  assert.equal(r.ok, true);
  assert.equal(await store.getCoinCarry('민수'), 0);
  assert.equal(await store.getCoins('민수'), 1);
  assert.equal((await w2.world.wallet(a2)).carrySeconds, 0);
  // 초기화 뒤 9분은 다시 처음부터 (이월 0 + 540 → 0코인, 540 이월)
  w2.sitDown(a2); w2.advance(9 * MIN); w2.world.stand(a2);
  await settle(w2.world);
  assert.equal(await store.getCoins('민수'), 1);
  assert.equal(await store.getCoinCarry('민수'), 540);
  await w2.world.dispose();
});

test('월드: 휴식 전환·퇴장·서버 종료로 끝난 세션도 정산되고, 종료(dispose)는 코인 저장을 기다린다', async () => {
  const { world, store, advance, sitDown } = makeWorld();
  const a = world.join({ nickname: '민수', socketId: 'sa' }).player;
  sitDown(a);
  advance(10 * MIN);
  world.setStatus(a, 'rest'); // 앉은 채 휴식 → 세션 종료
  await settle(world);
  assert.equal(await store.getCoins('민수'), 1);
  world.setStatus(a, 'study');
  advance(30 * MIN);
  world.remove(a.id, 'leave'); // 앉은 채 퇴장
  await settle(world);
  assert.equal(await store.getCoins('민수'), 4);
  const b = world.join({ nickname: '영희', socketId: 'sb' }).player;
  sitDown(b);
  advance(20 * MIN);
  await world.dispose(); // flushAll → 세션 저장 → 코인
  assert.equal(await store.getCoins('영희'), 2);
  assert.equal(world.pendingAwards.size, 0);
});

// ── 월드: 집중 완주 보너스 ────────────────────────────────────────────
test('월드: 집중 사이클 완주 보너스 5코인 — 시작 전부터 끝까지 앉아서 공부 중일 때만', async () => {
  const { world, coins, advance, sitDown } = makeWorld({ pomodoro: { focusMs: 25 * MIN, breakMs: 5 * MIN } });
  const a = world.join({ nickname: '민수', socketId: 'sa' }).player;
  sitDown(a);
  advance(MIN);
  assert.equal(world.startPomodoro(a).ok, true);
  const pomo = world.pomodoroOf(a);
  advance(25 * MIN);
  pomo.advance(); // 실제 setTimeout 대신 직접 전환 (dispose 가 타이머를 지운다)
  await settle(world);
  assert.equal(pomo.phase, 'break');
  assert.deepEqual(coins, [{ nickname: '민수', playerId: a.id, delta: 5, reason: 'focus', balance: 5 }]);
  assert.equal(a.focusBonusAt, pomo.startedAt - 25 * MIN);

  // 휴식이 끝나도 보너스 없음
  advance(5 * MIN);
  pomo.advance();
  await settle(world);
  assert.equal(coins.length, 1);
  assert.equal(pomo.phase, 'focus');

  // 두 번째 집중 사이클: 계속 앉아 있었으므로 또 5
  advance(25 * MIN);
  pomo.advance();
  await settle(world);
  assert.equal(coins.length, 2);
  assert.equal(coins[1].balance, 10);
  await world.dispose();
});

test('월드: 사이클 도중 일어나면(다시 앉아도) 보너스 없음, 앉지 않았으면 없음, 정지하면 없음', async () => {
  const { world, coins, advance, sitDown } = makeWorld({ pomodoro: { focusMs: 25 * MIN, breakMs: 5 * MIN } });
  const a = world.join({ nickname: '민수', socketId: 'sa' }).player;
  sitDown(a);
  world.startPomodoro(a);
  const pomo = world.pomodoroOf(a);
  advance(10 * MIN);
  world.stand(a); // 10분 세션 저장 → 'study' 1코인은 들어온다
  sitDown(a);
  advance(15 * MIN);
  pomo.advance();
  await settle(world);
  assert.deepEqual(coins.map((c) => c.reason), ['study'], '중간에 일어났으면 focus 보너스 없음');

  // 앉지 않은 채 사이클 완주
  world.stand(a);
  advance(5 * MIN);
  pomo.advance(); // break → focus
  advance(25 * MIN);
  pomo.advance(); // focus → break
  await settle(world);
  assert.deepEqual(coins.filter((c) => c.reason === 'focus'), []);

  // 앉아서 공부 중이지만 수동 정지 → phaseEnd 없음
  sitDown(a);
  world.stopPomodoro(a);
  advance(30 * MIN);
  world.startPomodoro(a);
  advance(24 * MIN);
  assert.equal(world.stopPomodoro(a).ok, true);
  await settle(world);
  assert.deepEqual(coins.filter((c) => c.reason === 'focus'), []);
  await world.dispose();
});

test('월드: 집중 20분 미만 사이클은 보너스 없음, 같은 사이클 이중 정산은 한 번만, 다른 플레이어에게 새지 않음', async () => {
  const short = makeWorld({ pomodoro: { focusMs: 15 * MIN, breakMs: 5 * MIN } }); // configure 는 20분 미만을 막지만 옵션으로는 들어올 수 있다
  const a = short.world.join({ nickname: '민수', socketId: 'sa' }).player;
  short.sitDown(a);
  short.world.startPomodoro(a);
  short.advance(15 * MIN);
  short.world.pomodoroOf(a).advance();
  await settle(short.world);
  assert.deepEqual(short.coins, []);
  await short.world.dispose();

  const { world, store, coins, advance, sitDown } = makeWorld({ pomodoro: { focusMs: 25 * MIN, breakMs: 5 * MIN } });
  const p = world.join({ nickname: '민수', socketId: 'sa' }).player;
  const q = world.join({ nickname: '영희', socketId: 'sb' }).player;
  sitDown(p);
  world.startPomodoro(p);
  const cycle = { phase: 'focus', startedAt: world.pomodoroOf(p).startedAt, endsAt: world.pomodoroOf(p).endsAt, durationMs: 25 * MIN };
  advance(25 * MIN);
  assert.ok(world.settleFocusCycle(p, cycle), '첫 정산은 지급');
  assert.equal(world.settleFocusCycle(p, cycle), null, '같은 사이클 두 번째는 무시');
  assert.equal(world.settleFocusCycle(p, { ...cycle }), null, '복사본이어도 startedAt 이 같으면 무시');
  await settle(world);
  assert.equal(coins.length, 1);
  assert.equal(await store.getCoins('민수'), 5);
  assert.equal(await store.getCoins('영희'), 0);
  assert.equal(world.settleFocusCycle(q, cycle), null, '영희는 앉지 않았음');
  // 세션 end 이중 호출도 한 번만 저장·정산
  advance(20 * MIN);
  const e1 = world.study.end('민수', 'x');
  const e2 = world.study.end('민수', 'x');
  await Promise.all([e1, e2]);
  await settle(world);
  assert.equal((await store.listSessions('민수')).length, 1);
  assert.equal(coins.filter((c) => c.reason === 'study').length, 1);
  await world.dispose();
});

// ── 월드: 지갑 / 구매 ────────────────────────────────────────────────
test('월드: purchase — 없는 아이템 거부, 잔액 부족 거부(원장·인벤토리 없음), 성공 시 차감·원장·인벤토리·coins 이벤트, 0코인 아이템도 가능', async () => {
  const { world, store, coins, advance, sitDown } = makeWorld({ shop: ITEMS });
  const a = world.join({ nickname: '민수', socketId: 'sa' }).player;
  assert.deepEqual(await world.purchase(a, 'nope'), { ok: false, error: 'no_item' });
  assert.deepEqual(await world.purchase(a, undefined), { ok: false, error: 'no_item' });
  assert.deepEqual(await world.purchase(a, 'chair_basic'), { ok: false, error: 'insufficient', balance: 0 });
  let w = await world.wallet(a);
  assert.equal(w.ok, true);
  assert.equal(w.coins, 0);
  assert.deepEqual(w.ledger, []);
  assert.deepEqual(w.inventory, []);
  assert.deepEqual(w.tabs.map((t) => t.label), ['가구', '펫', '펫 꾸미기', '탈것']);
  assert.equal(w.items.length, 2);

  sitDown(a); advance(95 * MIN); world.stand(a); // 9코인
  await settle(world);
  assert.deepEqual(await world.purchase(a, 'chair_basic'), { ok: false, error: 'insufficient', balance: 9 }, '1코인 모자람');
  assert.equal((await store.coinLedger('민수')).length, 1, '거부는 원장에 없음');
  sitDown(a); advance(10 * MIN); world.stand(a); // +1 → 10
  await settle(world);
  const r = await world.purchase(a, 'chair_basic');
  assert.equal(r.ok, true);
  assert.equal(r.balance, 0);
  assert.equal(r.item.id, 'chair_basic');
  assert.equal(r.inventory.itemId, 'chair_basic');
  assert.deepEqual(r.inventory.meta, { name: '기본 의자', price: 10, tab: 'furniture', category: 'shared', variant: null });
  assert.deepEqual(coins.at(-1), { nickname: '민수', playerId: a.id, delta: -10, reason: 'purchase:chair_basic', balance: 0 });
  w = await world.wallet(a);
  assert.equal(w.coins, 0);
  assert.deepEqual(w.ledger.map((e) => [e.delta, e.reason]), [[-10, 'purchase:chair_basic'], [1, 'study'], [9, 'study']]);
  assert.deepEqual(w.inventory.map((i) => i.itemId), ['chair_basic']);
  assert.deepEqual(await world.purchase(a, 'chair_basic'), { ok: false, error: 'insufficient', balance: 0 }, '다시 사려면 또 10코인');
  assert.equal((await world.purchase(a, 'free_sticker')).error, 'invalid', '0코인 아이템은 delta 0 → 저장소가 거부 (원장에 남길 게 없음)');
  await world.dispose();
});

test('월드: stats 에 coins · weekCoins 가 붙고 "이번 주 코인" 정렬 재료가 된다, 최근 거래는 10개까지', async () => {
  const { world, store, advance, sitDown } = makeWorld();
  const a = world.join({ nickname: '민수', socketId: 'sa' }).player;
  for (let i = 0; i < 12; i++) { sitDown(a); advance(10 * MIN); world.stand(a); }
  await settle(world);
  await store.adjustCoins('지난주', 30, 'study', KST('2026-09-10T10:00:00'));
  await store.adjustCoins('민수', 20, 'study', KST('2026-09-10T10:00:00')); // 지난주 것
  const st = await world.stats();
  const me = st.rows.find((r) => r.nickname === '민수');
  assert.equal(me.coins, 32);
  assert.equal(me.weekCoins, 12);
  assert.equal(me.todaySeconds, 120 * 60);
  assert.equal(st.rows.find((r) => r.nickname === '지난주'), undefined, '이번 주 획득이 없고 공부 기록도 없으면 랭킹 행에 안 나옴');
  assert.equal((await world.wallet(a)).ledger.length, 10);
  await world.dispose();
});

test('월드: publicPlayer.pomodoro 는 진행 중일 때만 { phase, endsAt }, 입장 ack 프로필에 coins', async () => {
  const { world, store, advance, sitDown } = makeWorld({ pomodoro: { focusMs: 25 * MIN, breakMs: 5 * MIN } });
  const a = world.join({ nickname: '민수', socketId: 'sa' }).player;
  assert.equal(world.publicPlayer(a).pomodoro, null);
  world.startPomodoro(a);
  assert.deepEqual(world.publicPlayer(a).pomodoro, { phase: 'focus', endsAt: world.now() + 25 * MIN });
  advance(25 * MIN);
  world.pomodoroOf(a).advance();
  assert.deepEqual(world.publicPlayer(a).pomodoro, { phase: 'break', endsAt: world.now() + 5 * MIN });
  world.stopPomodoro(a);
  assert.equal(world.publicPlayer(a).pomodoro, null);
  await store.adjustCoins('민수', 7, 'study', world.now());
  const prof = await world.loadProfile(a);
  assert.equal(prof.coins, 7);
  sitDown(a);
  await world.dispose();
});

// ── 소켓 E2E ────────────────────────────────────────────────────────
test('소켓 E2E: coins 이벤트(본인 balance · 남은 없음) · wallet · shop:buy · stats.weekCoins · playerPomodoro 동기화', async (t) => {
  let now = KST('2026-09-17T10:00:00');
  const srv = await boot({ world: { now: () => now, npc: { autoStart: false }, study: { autoTick: false }, shop: ITEMS, pomodoro: { focusMs: 25 * MIN, breakMs: 5 * MIN } } });
  t.after(() => srv.close());
  const a = connect(srv.port);
  const b = connect(srv.port);
  t.after(() => { a.close(); b.close(); });
  const ja = await joinAs(a, { nickname: '민수' });
  const jb = await joinAs(b, { nickname: '영희' });
  assert.equal(ja.profile.coins, 0);
  assert.equal(ja.self.pomodoro, null);
  const coinsA = collect(a, 'coins');
  const coinsB = collect(b, 'coins');

  // 타이머 시작 → 모두에게 playerPomodoro
  const ppB = once(b, 'playerPomodoro');
  const ps = await ask(a, 'pomodoro:start', { focusMinutes: 25, breakMinutes: 5 });
  assert.equal(ps.ok, true);
  assert.deepEqual(await ppB, { id: ja.self.id, pomodoro: { phase: 'focus', endsAt: now + 25 * MIN } });
  // 늦게 들어온 사람도 입장 ack 의 players 에서 본다
  const c = connect(srv.port);
  t.after(() => c.close());
  const jc = await joinAs(c, { nickname: '철수' });
  assert.deepEqual(jc.players.find((p) => p.id === ja.self.id).pomodoro, { phase: 'focus', endsAt: now + 25 * MIN });
  const ppStop = once(b, 'playerPomodoro');
  await ask(a, 'pomodoro:stop');
  assert.deepEqual(await ppStop, { id: ja.self.id, pomodoro: null });

  // 앉아서 25분 → 2코인
  const pa = srv.world.players.get(ja.self.id);
  const seat = room.seats[0];
  pa.x = (seat.x + 0.5) * 32;
  pa.y = (seat.y + 1) * 32;
  assert.equal((await ask(a, 'sit', { seatId: seat.id })).ok, true);
  now += 25 * MIN;
  const seenA = once(a, 'coins');
  const seenB = once(b, 'coins');
  await ask(a, 'stand');
  assert.deepEqual(await seenA, { id: ja.self.id, delta: 2, reason: 'study', balance: 2 });
  assert.deepEqual(await seenB, { id: ja.self.id, delta: 2, reason: 'study' }, '남에게는 잔액 없이');
  await sleep(30);
  assert.equal(coinsA.length, 1);
  assert.equal(coinsB.length, 1);

  // 지갑 · 구매
  let w = await ask(a, 'wallet');
  assert.equal(w.ok, true);
  assert.equal(w.coins, 2);
  assert.equal(w.carrySeconds, 300, '25분 중 5분 이월');
  assert.equal(w.ledger.length, 1);
  assert.equal(w.tabs.length, 4);
  assert.deepEqual(await ask(a, 'shop:buy', { itemId: 'chair_basic' }), { ok: false, error: 'insufficient', balance: 2 });
  assert.deepEqual(await ask(a, 'shop:buy', { itemId: 'ghost' }), { ok: false, error: 'no_item' });
  assert.deepEqual(await ask(a, 'shop:buy', {}), { ok: false, error: 'no_item' });
  assert.equal((await ask(c, 'wallet')).coins, 0);
  const d = connect(srv.port);
  t.after(() => d.close());
  assert.equal((await ask(d, 'wallet')).error, 'not_joined');
  assert.equal((await ask(d, 'shop:buy', { itemId: 'chair_basic' })).error, 'not_joined');
  await srv.world.store.adjustCoins('민수', 8, 'study', now); // 10코인 채우기 (저장소 직접)
  const buy = await ask(a, 'shop:buy', { itemId: 'chair_basic' });
  assert.equal(buy.ok, true);
  assert.equal(buy.balance, 0);
  await sleep(30);
  assert.deepEqual(coinsA.at(-1), { id: ja.self.id, delta: -10, reason: 'purchase:chair_basic', balance: 0 });
  assert.deepEqual(coinsB.at(-1), { id: ja.self.id, delta: -10, reason: 'purchase:chair_basic' });
  w = await ask(a, 'wallet');
  assert.equal(w.coins, 0);
  assert.deepEqual(w.inventory.map((i) => i.itemId), ['chair_basic']);
  assert.deepEqual(w.ledger.map((e) => e.delta), [-10, 8, 2]);

  // 랭킹: 이번 주 코인 (구매는 빼지 않는다)
  const st = await ask(b, 'stats');
  const me = st.rows.find((r) => r.nickname === '민수');
  assert.equal(me.weekCoins, 10);
  assert.equal(me.coins, 0);
  assert.equal(st.rows.find((r) => r.nickname === '영희').weekCoins, 0);
  assert.equal(jb.profile.coins, 0);
  // 재입장하면 잔액이 프로필에 실려 온다
  await srv.world.store.adjustCoins('민수', 3, 'focus', now);
  await ask(a, 'leave');
  const a2 = connect(srv.port);
  t.after(() => a2.close());
  assert.equal((await joinAs(a2, { nickname: '민수' })).profile.coins, 3);
});

// ── 브라우저 ────────────────────────────────────────────────────────
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const hasChrome = fs.existsSync(CHROME);
let puppeteer = null;
try { puppeteer = require('puppeteer-core'); } catch (_) { /* devDependency 없음 */ }

test('브라우저: 잔액 배지 · 코인 획득 연출 · 지갑 모달(탭 준비 중 · 거래 내역) · 머리 위 🍅 남은 시간 · 랭킹 코인 탭 · 코인 소리 설정', { skip: !hasChrome || !puppeteer ? 'Chrome/puppeteer-core 없음' : false, timeout: 120000 }, async (t) => {
  const srv = await boot({ world: { pomodoro: { focusMs: 25 * MIN, breakMs: 5 * MIN }, study: { autoTick: false }, npc: { autoStart: false } } });
  t.after(() => srv.close());
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  t.after(() => browser.close());
  const errors = [];
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewport({ width: 1200, height: 800 });
  await page.goto(`http://127.0.0.1:${srv.port}/`, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForSelector('#login:not([hidden])', { timeout: 30000 });
  await page.type('#login-nick', '코인테스트');
  await page.click('#login-submit');
  await page.waitForFunction(() => window.NSM && window.NSM.scene.me, { timeout: 30000 });
  const me = [...srv.world.players.values()][0];

  // 잔액 배지: 0 으로 시작, 서버가 코인을 주면 배지·머리 위 "+2 🪙"·토스트
  assert.equal(await page.$eval('#coin-badge span', (el) => el.textContent), '0');
  assert.equal(await page.$eval('#coin-badge', (el) => el.hidden), false);
  await srv.world.award('코인테스트', me.id, 2, 'study');
  await page.waitForFunction(() => document.querySelector('#coin-badge span').textContent === '2', { timeout: 5000 });
  assert.equal(await page.evaluate(() => window.NSM.scene.me.coinText && window.NSM.scene.me.coinText.text), '+2 🪙');
  await srv.world.award('코인테스트', me.id, 5, 'focus');
  await page.waitForFunction(() => document.querySelector('#coin-badge span').textContent === '7', { timeout: 5000 });

  // 지갑 모달: 탭 4개, 가구 탭은 카드(9단계) · 나머지 탭 "준비 중", 거래 내역 2건(최근순)
  await page.click('#btn-wallet');
  await page.waitForSelector('#wallet-modal:not([hidden])', { timeout: 3000 });
  await page.waitForFunction(() => document.querySelectorAll('#wallet-ledger li').length === 2, { timeout: 5000 });
  assert.equal(await page.$eval('#wallet-balance', (el) => el.textContent), '7');
  await srv.world.store.setCoinCarry('코인테스트', 480);
  await page.click('#wallet-close');
  await page.click('#btn-wallet');
  await page.waitForFunction(() => /다음 코인까지 2분 00초/.test(document.querySelector('#wallet-carry').textContent), { timeout: 5000 });
  assert.deepEqual(await page.$$eval('#wallet-tabs button', (els) => els.map((b) => b.textContent)), ['가구', '펫', '펫 꾸미기', '탈것']);
  assert.match(await page.$eval('#wallet-items', (el) => el.textContent), /머그컵/);
  await page.click('#wallet-tabs button[data-tab="mount"]');
  assert.match(await page.$eval('#wallet-items', (el) => el.textContent), /준비 중/);
  assert.equal(await page.$eval('#wallet-tabs button.active', (el) => el.dataset.tab), 'mount');
  const ledger = await page.$$eval('#wallet-ledger li', (els) => els.map((li) => li.textContent));
  assert.match(ledger[0], /\+5/);
  assert.match(ledger[0], /집중 완주/);
  assert.match(ledger[1], /\+2/);
  assert.match(ledger[1], /공부/);
  await page.click('#wallet-close');
  await page.waitForSelector('#wallet-modal[hidden]', { timeout: 3000 });

  // 머리 위 타이머: 시작하면 "🍅 25:00" 근처, 정지하면 사라짐
  assert.equal(await page.evaluate(() => window.NSM.scene.me.pomoText.visible), false);
  await page.click('#btn-pomo');
  await page.waitForFunction(() => window.NSM.scene.me.pomoText.visible && window.NSM.scene.me.pomoText.text.startsWith('🍅'), { timeout: 5000 });
  assert.match(await page.evaluate(() => window.NSM.scene.me.pomoText.text), /^🍅 (25:0[01]|24:5\d)$/, '서버 시각 오차 ±1초 허용');
  await page.click('#btn-pomo');
  await page.waitForFunction(() => !window.NSM.scene.me.pomoText.visible, { timeout: 5000 });

  // 랭킹 "이번 주 코인" 탭
  await page.click('#rank-tabs button[data-tab="coins"]');
  await page.waitForFunction(() => /🪙\s*7/.test(document.querySelector('#rank-list').textContent), { timeout: 8000 });

  // 설정: 코인 소리 끄기 → localStorage
  await page.click('#btn-settings');
  await page.click('#opt-coin-sound');
  assert.equal(await page.evaluate(() => localStorage.getItem('nsm.sound.coin')), '0');
  assert.equal(await page.evaluate(() => window.NSM.sound.coinEnabled), false);
  assert.deepEqual(errors, []);
});
