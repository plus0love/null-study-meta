'use strict';
/**
 * 14단계: 야외 다듬기(A) + 동물원·자유 동물(B) + 낚시·별자리(C).
 *  - 단위: 100x70 맵(동물원 우리 8개 · 울타리 안은 사람이 못 들어가고 만지기 코너만 들어감 · 안내판/먹이/매점 지점 · 포토존 · 낚시 자리 · 망원경) ·
 *    동물 NPC(우리 안에 머묾 · 상태 순환 · 먹이 → 다가와 먹음 → 반응) · 오리는 물 위 · 비둘기는 사람이 오면 날아오름 · 반딧불이 구역 (나비는 후속 수정에서 뺐다) ·
 *    OutdoorWorld 먹이 하루 3번 · 매점 1코인 · 포토존 쿨다운.
 *  - 소켓 E2E: zoo:feed → 채팅 + npc:pet 반응 · zoo:snack → playerSnack · 포토존 photo 방송 · 고양이 npc:pet.
 *  - 브라우저: 동물 시트 텍스처 + 동물 NPC 스프라이트 렌더 · 간식 아이콘 · 구름 그림자/별똥별 연출 객체.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { getOutdoor, ENCLOSURES, ZOO_PHOTO } = require('../server/rooms/outdoor');
const { canStand } = require('../server/game/movement');
const { OutdoorWorld, FEED_PER_DAY, SNACK_MS, PHOTO_COOLDOWN_MS } = require('../server/game/outdoor');
const { AnimalNpc, DuckNpc, PigeonNpc, FireflyNpc, CatNpc, createOutdoorAnimals, WATER_TILES, FLEE_PX } = require('../server/game/animals');
const { createMemoryStore } = require('../server/store/memory');
const { boot, connect, joinAs, ask, once, sleep, collect, CHROME, CHROME_ARGS } = require('./helpers');
const { pathTo } = require('../tools/lib/walk');

const T = 32;
const KST = (iso) => new Date(`${iso}+09:00`).getTime();
const outdoor = getOutdoor();
const quiet = { log() {}, warn() {}, error() {} };
const tileOf = (n) => ({ tx: Math.floor(n.x / T), ty: Math.floor((n.y - 1) / T) });
const inRect = (t, a) => t.tx >= a.x0 && t.tx <= a.x1 && t.ty >= a.y0 && t.ty <= a.y1;

/** 결정적 난수 */
function seeded(seed = 7) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}

function makeOutdoor(opts = {}) {
  let t = KST('2026-09-18T14:00:00');
  const store = opts.store || createMemoryStore();
  const world = new OutdoorWorld(outdoor, { now: () => t, store, tz: 'Asia/Seoul', npc: { autoStart: false, random: seeded(3), tickMs: 150 }, study: { autoTick: false }, log: quiet, ...opts });
  const advance = (ms) => { t += ms; };
  const tick = (n = 1) => { for (let i = 0; i < n; i++) { t += 150; for (const npc of world.npcs) npc.tick(); } };
  const settle = async () => { await Promise.all([...world.pendingAwards]); };
  return { world, store, advance, tick, settle, now: () => t };
}

// ── 단위: 맵 ────────────────────────────────────────────────────────
test('야외 맵 14단계: 100x70 · 동물원 우리 8개(울타리 안은 사람 통과 불가, 만지기 코너만 문) · 안내판 8 · 먹이 지점 7 · 매점 2 · 포토존 · 정문 아치 · 낚시 자리 4 · 망원경 · 자유 동물 정의', () => {
  assert.equal(outdoor.width, 100);
  assert.equal(outdoor.height, 70);
  assert.equal(outdoor.zoo.enclosures.length, 8);
  assert.deepEqual(outdoor.zoo.enclosures.map((e) => e.id), ENCLOSURES.map((e) => e.id));
  const sp = { x: Math.floor(outdoor.spawn.x / T), y: Math.floor((outdoor.spawn.y - 1) / T) };
  for (const e of outdoor.zoo.enclosures) {
    // 안쪽 셀은 (사람이) 스폰에서 걸어서 못 들어간다 — 만지기 코너만 문이 있어 들어간다
    const inside = { x: Math.floor((e.area.x0 + e.area.x1) / 2), y: Math.floor((e.area.y0 + e.area.y1) / 2) };
    const path = pathTo(outdoor, sp.x, sp.y, (x, y) => x === inside.x && y === inside.y);
    if (e.enterable) assert.ok(path, `${e.id}: 문으로 들어갈 수 있다`);
    else assert.equal(path, null, `${e.id}: 울타리 안으로 못 들어간다`);
    // 안내판 지점은 걸어서 갈 수 있다
    const sign = outdoor.interactables.find((i) => i.id === `sign:${e.id}`);
    assert.ok(sign && sign.kind === 'sign');
    assert.ok(pathTo(outdoor, sp.x, sp.y, (x, y) => x === Math.floor(sign.x / T) && y === Math.floor((sign.y - 1) / T)), `${e.id}: 안내판 앞까지 경로`);
    const feed = outdoor.interactables.find((i) => i.id === `feed:${e.id}`);
    if (e.enterable) assert.equal(feed, undefined);
    else {
      assert.ok(feed && feed.kind === 'feed');
      assert.ok(inRect({ tx: e.feedTile.x, ty: e.feedTile.y }, e.area), '먹이 지점은 우리 안');
      assert.ok(!outdoor.collision[e.feedTile.y][e.feedTile.x], '먹이 지점은 동물이 설 수 있는 칸');
    }
    assert.ok(e.name && e.desc && e.species && e.count >= 2);
  }
  assert.ok(outdoor.interactables.some((i) => i.id === 'snack:icecream' && i.kind === 'snack_icecream'));
  assert.ok(outdoor.interactables.some((i) => i.id === 'snack:churros' && i.kind === 'snack_churros'));
  assert.deepEqual(outdoor.zoo.snacks.map((s) => [s.id, s.price]), [['icecream', 1], ['churros', 1]]);
  assert.deepEqual(outdoor.zoo.photo, ZOO_PHOTO);
  for (let x = ZOO_PHOTO.x0; x <= ZOO_PHOTO.x1; x++) assert.ok(pathTo(outdoor, sp.x, sp.y, (px, py) => px === x && py === ZOO_PHOTO.y0), '포토존 발자국까지 경로');
  assert.ok(outdoor.props.some((p) => p.name === 'zoo_banner') && outdoor.props.some((p) => p.name === 'snack_bar') && outdoor.props.some((p) => p.name === 'photo_board'));
  assert.ok(outdoor.props.filter((p) => p.name === 'glass_fence_h' || p.name === 'glass_fence_v').length >= 20, '유리 펜스');
  // A 단계: 연석·아치·관중석·피트·파사드 창문·자갈길
  for (const name of ['start_banner', 'arch_post', 'pit_box', 'stand_bench_s', 'tire_stack', 'corner_sign_1', 'corner_sign_4', 'facade_window_night', 'canopy', 'bike_rack', 'kart_garage', 'tree_round_big', 'tree_birch', 'reed']) {
    assert.ok(outdoor.props.some((p) => p.name === name), `소품 ${name}`);
  }
  assert.ok(outdoor.layers.windowDay.some((row) => row.some((i) => i !== -1)), '파사드 낮 창문 레이어');
  assert.ok(outdoor.seats.filter((s) => s.facing === 'down' && s.y <= 11).length >= 30, '언덕 관중석 2줄');
  assert.ok(outdoor.seats.every((s) => !outdoor.collision[s.y][s.x]));
  // 자유 동물 정의: 오리 2 + 트랙 안쪽 연못 오리 1 · 다람쥐 · 고양이 2 · 비둘기 떼 · 반딧불이 (나비 없음)
  const kinds = outdoor.animals.map((a) => a.kind);
  assert.deepEqual(kinds.filter((k) => k === 'duck').length, 3);
  assert.ok(kinds.includes('squirrel') && kinds.filter((k) => k === 'cat').length === 2 && kinds.includes('pigeon') && !kinds.includes('butterfly') && kinds.includes('firefly'));
});

// ── 단위: 동물 NPC ──────────────────────────────────────────────────
test('동물 NPC: 우리 안에 머물며 상태 순환(walk/idle/sit/eat/sleep) · 스냅샷 sheet/pettable · 먹이 → 먹이 지점으로 와서 eat + react · 먹는 중엔 중복 불가 · 쓰다듬기 종별 반응', () => {
  let t = 0;
  const e = outdoor.zoo.enclosures.find((x) => x.id === 'panda');
  const n = new AnimalNpc(outdoor, { id: 'p', species: 'panda', area: e.area, feedTile: e.feedTile, now: () => t, random: seeded(11), tickMs: 150 });
  const states = new Set();
  const reacts = [];
  n.on('react', (r) => reacts.push(r));
  for (let i = 0; i < 3000; i++) { t += 150; n.tick(); states.add(n.state); assert.ok(inRect(tileOf(n), e.area), `우리 안 (${n.state})`); }
  for (const s of ['walk', 'idle', 'sit', 'eat', 'sleep']) assert.ok(states.has(s), `상태 ${s}`);
  const snap = n.snapshot();
  assert.equal(snap.species, 'panda');
  assert.equal(snap.sheet, 'animals');
  assert.equal(snap.pettable, false);
  assert.equal(snap.kind, 'animal');
  // 먹이: 먹이 지점으로 걸어가 먹는다
  assert.equal(n.feed(), true);
  assert.equal(n.feed(), false, '먹는 중(가는 중)엔 중복 불가');
  let arrived = false;
  for (let i = 0; i < 400 && !arrived; i++) { t += 150; n.tick(); if (n.state === 'eat' && n.feeding && n.feeding.until) arrived = true; }
  assert.ok(arrived, '먹이 지점에 도착해 eat');
  const here = tileOf(n);
  assert.ok(Math.abs(here.tx - e.feedTile.x) <= 1 && Math.abs(here.ty - e.feedTile.y) <= 1, `먹이 지점 근처 ${JSON.stringify(here)}`);
  assert.deepEqual(reacts, [{ reaction: '🎋' }]);
  assert.equal(n.snapshot().eating, true);
  assert.equal(n.fedCount, 1);
  for (let i = 0; i < 40; i++) { t += 150; n.tick(); }
  assert.equal(n.feeding, null, '다 먹으면 풀린다');
  assert.equal(n.feed(), true);
  // 쓰다듬기 반응 (토끼는 pets 시트 · 만질 수 있음)
  const r = new AnimalNpc(outdoor, { id: 'r', species: 'rabbit', area: outdoor.zoo.enclosures.find((x) => x.id === 'petting').area, now: () => t, random: seeded(5) });
  assert.equal(r.snapshot().sheet, undefined, '토끼는 펫 시트');
  assert.equal(r.snapshot().pettable, true);
  const pet = r.pet({ x: r.x + 10, y: r.y, nickname: '민수', id: 'p1' });
  assert.equal(pet.ok, true);
  assert.equal(pet.reaction, '🥕');
});

test('자유 동물: 오리는 물 타일에서만 헤엄(swim) · 비둘기는 사람이 가까이 오면 날아올라(fly) 멀리 내려앉음 · 반딧불이는 구역 안에서 떠다니고 glow · 고양이는 벤치 구역', () => {
  let t = 0;
  const defs = Object.fromEntries(outdoor.animals.map((a) => [a.id, a]));
  const duck = new DuckNpc(outdoor, { id: 'd', area: defs.duck1.area, now: () => t, random: seeded(2), tickMs: 150 });
  const swims = new Set();
  for (let i = 0; i < 2000; i++) {
    t += 150; duck.tick(); swims.add(duck.state);
    const { tx, ty } = tileOf(duck);
    assert.ok(WATER_TILES.has(outdoor.layers.floor[ty][tx]), `오리는 물 위 (${tx},${ty})`);
  }
  assert.ok(swims.has('swim') && swims.has('idle'));
  assert.equal(duck.snapshot().sheet, 'animals');
  // 비둘기
  const pg = new PigeonNpc(outdoor, { id: 'g', area: defs.pigeon.area, now: () => t, random: seeded(9), tickMs: 150 });
  let player = null;
  pg.players = () => (player ? [player] : []);
  for (let i = 0; i < 300; i++) { t += 150; pg.tick(); }
  assert.equal(pg.flights, 0);
  player = { x: pg.x + 20, y: pg.y, connected: true };
  t += 150; pg.tick();
  assert.equal(pg.state, 'fly');
  assert.equal(pg.flights, 1);
  const from = { x: pg.x, y: pg.y };
  for (let i = 0; i < 100 && pg.state === 'fly'; i++) { t += 150; pg.tick(); }
  assert.notEqual(pg.state, 'fly', '내려앉는다');
  assert.ok(Math.hypot(pg.x - player.x, pg.y - player.y) > FLEE_PX, `멀리 내려앉음 ${Math.hypot(pg.x - from.x, pg.y - from.y)}`);
  assert.ok(inRect(tileOf(pg), defs.pigeon.area));
  // 반딧불이 (트랙 안쪽 꽃밭 구역 포함)
  const ff = new FireflyNpc(outdoor, { id: 'f', area: defs.firefly.area, now: () => t, random: seeded(6), tickMs: 150 });
  const ft = new FireflyNpc(outdoor, { id: 'f2', area: defs.firefly_track.area, now: () => t, random: seeded(4), tickMs: 150 });
  const states = new Set();
  for (let i = 0; i < 1500; i++) {
    t += 150; ff.tick(); ft.tick(); states.add(ff.state);
    assert.ok(inRect(tileOf(ff), defs.firefly.area), '반딧불이 구역');
    assert.ok(inRect(tileOf(ft), defs.firefly_track.area), '트랙 꽃밭 반딧불이 구역');
  }
  assert.ok(states.has('fly'), '떠다닌다');
  assert.equal(ff.snapshot().fly, true);
  assert.equal(ff.snapshot().glow, true);
  assert.equal(ff.snapshot().sheet, undefined);
  assert.equal(ff.snapshot().pettable, false);
  // 고양이 (pets 시트, 쓰다듬기 가능, 자기 구역 안)
  const cat = new CatNpc(outdoor, { id: 'c', area: defs.cat1.area, spots: defs.cat1.spots, name: '나비', now: () => t, random: seeded(8) });
  for (let i = 0; i < 2000; i++) { t += 100; cat.tick(); assert.ok(inRect(tileOf(cat), { ...defs.cat1.area, x0: defs.cat1.area.x0 - 1, x1: defs.cat1.area.x1 + 1 }), '고양이 구역'); }
  assert.equal(cat.snapshot().pettable, true);
  assert.equal(cat.snapshot().species, 'cat');
  // 전체 생성: 우리 동물 + 자유 동물
  const all = createOutdoorAnimals(outdoor, { now: () => t, random: seeded(1) });
  assert.ok(all.length >= 30, `동물 ${all.length}`);
  assert.equal(all.filter((n) => n.enclosure === 'petting').length, 4, '토끼 2 + 기니피그 2');
});

test('OutdoorWorld 동물원: 먹이는 우리 앞에서 하루 3번(limit) · 먹는 중엔 다른 동물 · 탑승/착석 불가 · 매점 1코인(부족하면 insufficient) 5분 간식 · 포토존 둘이 서면 photo(쿨다운) · 스냅샷 종류', async () => {
  const { world, store, tick, advance, settle } = makeOutdoor();
  const p1 = world.join({ nickname: '민수', socketId: 's1' }).player;
  const p2 = world.join({ nickname: '영희', socketId: 's2' }).player;
  const feed = world.room.interactables.find((i) => i.id === 'feed:lion');
  p1.x = feed.x; p1.y = feed.y;
  const events = [];
  world.on('zooFeed', (e) => events.push(['feed', e.player.nickname, e.enclosure.id]));
  world.on('npcReact', (e) => events.push(['react', e.npc, e.reaction]));
  world.on('snack', (e) => events.push(['snack', e.player.nickname]));
  world.on('photo', (e) => events.push(['photo', e.players.map((p) => p.nickname).sort().join('+')]));
  assert.equal(world.feed(p1, 'nope').error, 'no_enclosure');
  p1.x += 200;
  assert.equal(world.feed(p1, 'lion').error, 'too_far');
  p1.x = feed.x;
  p1.vehicle = { type: 'kart' };
  assert.equal(world.feed(p1, 'lion').error, 'riding');
  p1.vehicle = null;
  const r1 = world.feed(p1, 'lion');
  assert.equal(r1.ok, true);
  assert.equal(r1.left, FEED_PER_DAY - 1);
  assert.equal(r1.enclosure.name, '사자');
  const r2 = world.feed(p1, 'lion');
  assert.equal(r2.ok, true);
  assert.notEqual(r2.animal, r1.animal, '먹는 중인 동물 대신 다른 동물');
  assert.equal(world.feed(p1, 'lion').error, 'busy', '둘 다 먹는 중');
  tick(120); // 18초: 다 먹음
  assert.equal(world.feed(p1, 'lion').ok, true);
  assert.equal(world.feed(p1, 'lion').error, 'limit');
  assert.equal(world.feedsLeft(p1), 0);
  assert.ok(events.filter((e) => e[0] === 'react' && e[2] === '🍖').length >= 2, '동물이 먹으면 react');
  advance(24 * 3600 * 1000);
  assert.equal(world.feedsLeft(p1), FEED_PER_DAY, '다음 날 초기화');
  // 매점
  const snack = world.room.interactables.find((i) => i.id === 'snack:icecream');
  p1.x = snack.x; p1.y = snack.y;
  assert.equal((await world.snack(p1, 'icecream')).error, 'insufficient');
  await store.adjustCoins('민수', 3, 'test');
  const s1 = await world.snack(p1, 'icecream');
  assert.equal(s1.ok, true);
  assert.equal(s1.balance, 2);
  assert.equal(s1.snack.emoji, '🍦');
  assert.equal(s1.snack.until, world.now() + SNACK_MS);
  assert.equal(world.publicPlayer(p1).snack.item, 'icecream');
  assert.equal((await world.snack(p1, 'churros')).error, 'too_far');
  assert.equal((await world.snack(p1, 'pizza')).error, 'no_item');
  advance(SNACK_MS + 1);
  assert.equal(world.publicPlayer(p1).snack, null, '5분 뒤 사라짐');
  await settle();
  assert.equal((await store.coinLedger('민수', 5))[0].reason, 'purchase:snack_icecream');
  // 포토존
  const z = world.zoo.photo;
  const at = (p, tx, ty) => { p.x = (tx + 0.5) * T; p.y = (ty + 1) * T; p.budget = 10000; p.lastMoveAt = world.now() - 50; };
  at(p1, z.x0, z.y0);
  at(p2, z.x1, z.y0 + 1);
  advance(100);
  assert.equal(world.move(p2, { x: (z.x1 + 0.5) * T, y: (z.y0 + 1) * T, facing: 'down', moving: false }).ok, true);
  assert.deepEqual(events.filter((e) => e[0] === 'photo'), [['photo', '민수+영희']]);
  assert.equal(world.move(p2, { x: (z.x1 + 0.5) * T + 1, y: (z.y0 + 1) * T, facing: 'down', moving: false }).ok, true);
  assert.equal(events.filter((e) => e[0] === 'photo').length, 1, '쿨다운 안엔 한 번');
  advance(PHOTO_COOLDOWN_MS + 1);
  assert.equal(world.move(p2, { x: (z.x1 + 0.5) * T, y: (z.y0 + 1) * T, facing: 'down', moving: false }).ok, true);
  assert.equal(events.filter((e) => e[0] === 'photo').length, 2);
  // 스냅샷 종류
  const snaps = world.npcSnapshots();
  assert.ok(snaps.some((s) => s.sheet === 'animals' && s.kind === 'animal') && snaps.some((s) => s.glow) && snaps.some((s) => s.species === 'cat' && s.pettable) && snaps.some((s) => s.fly));
  await world.dispose();
});

// ── 소켓 E2E ────────────────────────────────────────────────────────
test('소켓 E2E 동물원: zoo:feed → 시스템 채팅 + npc:pet 반응(by null) · zoo:snack → playerSnack(모두) + 잔액 · 포토존 → photo + 채팅 · 고양이 npc:pet · 입장 ack 에 동물 스냅샷', async (t) => {
  const srv = await boot({ world: { npc: { autoStart: false, random: seeded(21), tickMs: 150 }, study: { autoTick: false } } });
  t.after(() => srv.close());
  const a = connect(srv.port);
  const b = connect(srv.port);
  t.after(() => { a.close(); b.close(); });
  await joinAs(a, { nickname: '민수' });
  await joinAs(b, { nickname: '영희' });
  await srv.hub.store.adjustCoins('민수', 5, 'test');
  const toOutdoor = async (s) => { s.emit('move', { x: 22.5 * T, y: 25 * T, facing: 'down', moving: false }); await sleep(30); const d = await ask(s, 'door', {}); assert.equal(d.ok, true); return d; };
  const da = await toOutdoor(a);
  await toOutdoor(b);
  assert.ok(da.npcs.some((n) => n.sheet === 'animals') && da.npcs.some((n) => n.glow), '입장 ack 에 동물');
  const out = srv.hub.outdoor;
  const pa = out.players.get(da.self.id);
  const pb = [...out.players.values()].find((p) => p.nickname === '영희');
  const tickAll = (n) => { for (let i = 0; i < n; i++) for (const npc of out.npcs) npc.tick(); };
  // 먹이
  const feed = out.room.interactables.find((i) => i.id === 'feed:panda');
  pa.x = feed.x; pa.y = feed.y;
  const chats = collect(b, 'chat');
  const reacts = collect(b, 'npc:pet');
  const r = await ask(a, 'zoo:feed', { id: 'panda' });
  assert.equal(r.ok, true);
  assert.equal(r.left, 2);
  for (let i = 0; i < 400 && !reacts.length; i++) { tickAll(1); await sleep(5); }
  assert.ok(reacts.length >= 1, '동물 반응 방송');
  assert.equal(reacts[0].reaction, '🎋');
  assert.equal(reacts[0].by, null);
  assert.equal(reacts[0].id, r.animal);
  assert.ok(chats.some((c) => c.system && /민수님이 판다에게 먹이를 줬어요/.test(c.text)));
  assert.equal((await ask(b, 'zoo:feed', { id: 'panda' })).error, 'too_far');
  // 매점
  const snack = out.room.interactables.find((i) => i.id === 'snack:churros');
  pa.x = snack.x; pa.y = snack.y;
  const ps = once(b, 'playerSnack');
  const coinsA = collect(a, 'coins');
  const s = await ask(a, 'zoo:snack', { item: 'churros' });
  assert.equal(s.ok, true);
  assert.equal(s.balance, 4);
  const got = await ps;
  assert.equal(got.id, da.self.id);
  assert.equal(got.snack.emoji, '🥨');
  await sleep(30);
  assert.equal(coinsA.find((c) => c.reason === 'purchase:snack_churros').balance, 4);
  assert.equal((await ask(b, 'zoo:snack', { item: 'churros' })).error, 'too_far');
  // 포토존: 둘이 서면 photo + 채팅
  const z = out.zoo.photo;
  pa.x = (z.x0 + 0.5) * T; pa.y = (z.y0 + 1) * T;
  pb.x = (z.x1 + 0.5) * T; pb.y = (z.y0 + 1) * T - 8; pb.budget = 10000; pb.lastMoveAt = srv.hub.now() - 50;
  const photo = once(a, 'photo');
  b.emit('move', { x: pb.x, y: (z.y0 + 1) * T, facing: 'down', moving: false });
  const ph = await photo;
  assert.deepEqual(ph.nicknames.sort(), ['민수', '영희']);
  await sleep(30);
  assert.ok(chats.some((c) => c.system && /영희님과 민수님이 사진을 찍었어요|민수님과 영희님이 사진을 찍었어요/.test(c.text)));
  // 고양이 쓰다듬기 (자유 동물) · 우리 안 판다는 거리 밖
  const cat = out.npcs.find((n) => n.kind === 'cat');
  pa.x = cat.x + 10; pa.y = cat.y;
  const pet = await ask(a, 'npc:pet', { id: cat.id });
  assert.equal(pet.ok, true);
  assert.equal(pet.reaction, '😻');
  await sleep(30);
  assert.ok(chats.some((c) => c.system && /민수님이 나비을\(를\) 쓰다듬었어요|민수님이 치즈을\(를\) 쓰다듬었어요/.test(c.text)));
  // 스터디 안에서는 동물원 이벤트 불가
  const c = connect(srv.port);
  t.after(() => c.close());
  await joinAs(c, { nickname: '철수' });
  assert.equal((await ask(c, 'zoo:feed', { id: 'panda' })).error, 'not_outdoor');
  assert.equal((await ask(c, 'zoo:snack', { item: 'churros' })).error, 'not_outdoor');
});

// ── 브라우저 ────────────────────────────────────────────────────────
let puppeteer = null;
try { puppeteer = require('puppeteer-core'); } catch (_) { /* devDependency 없음 */ }

test('브라우저 14단계: 야외에서 동물 시트·동물 NPC 스프라이트(flipX)·반딧불이 글로우·구름 그림자·분수 물보라·별똥별 · 간식 아이콘 · 포토 플래시 · 안내판 모달', { skip: !CHROME || !puppeteer ? 'Chrome/puppeteer-core 없음' : false, timeout: 180000 }, async (t) => {
  const srv = await boot({ world: { npc: { autoStart: false, random: seeded(33), tickMs: 150 }, study: { autoTick: false } } });
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
  // 소켓으로 문을 지난다 (씬은 세션 ack 로 야외로 전환)
  await page.evaluate(() => { window.NSM.net.move({ x: 22.5 * 32, y: 25 * 32, facing: 'down', moving: false }); });
  await sleep(60);
  await page.evaluate(() => window.NSM.net.door());
  await page.waitForFunction(() => window.NSM.net.room === 'outdoor' && window.NSM.scene.room.id === 'outdoor' && window.NSM.scene.me && window.NSM.scene.ready, { timeout: 30000 });
  await sleep(500);
  const info = await page.evaluate(() => {
    const s = window.NSM.scene;
    const npcs = [...s.npcs.values()];
    const animal = npcs.find((n) => n.sheet === 'animals');
    const glow = npcs.find((n) => n.glow);
    return {
      hasTex: s.textures.exists('animals'), total: npcs.length, animals: npcs.filter((n) => n.sheet === 'animals').length, glows: npcs.filter((n) => n.glow).length,
      animalTex: animal ? animal.sprite.texture.key : null, animalName: animal ? animal.nameText.visible : null, catName: (npcs.find((n) => n.species === 'cat') || { nameText: { visible: null } }).nameText.visible,
      glowBlend: glow ? glow.sprite.blendMode : null, clouds: s.clouds ? s.clouds.length : 0, spray: Boolean(s.spray), zoo: s.room.zoo.enclosures.length,
    };
  });
  assert.equal(info.hasTex, true);
  assert.ok(info.animals >= 20, `동물 ${info.animals}`);
  assert.ok(info.glows >= 6);
  assert.equal(info.animalTex, 'animals');
  assert.equal(info.animalName, false, '우리 동물은 이름표 숨김');
  assert.equal(info.catName, true, '고양이는 이름표');
  assert.equal(info.glowBlend, 1, '반딧불이 ADD 블렌드');
  assert.equal(info.clouds, 3, '구름 그림자 3개');
  assert.equal(info.spray, true);
  assert.equal(info.zoo, 8);
  // 서버에서 동물을 걷게 하고(오른쪽) flipX 확인
  const out = srv.hub.outdoor;
  const panda = out.animalsOf('panda')[0];
  panda.facing = 'right'; panda.setState('walk'); panda.dirty = true; panda.emitIfNeeded(srv.hub.now());
  await page.waitForFunction((id) => { const n = window.NSM.scene.npcs.get(id); return n && n.state === 'walk' && n.sprite.flipX === true; }, { timeout: 5000 }, panda.id);
  // 밤: 반딧불이 보임 + 별똥별 생성 함수
  await page.evaluate(() => window.NSM.scene.setClockOverride(22));
  await sleep(300);
  const night = await page.evaluate(() => { const s = window.NSM.scene; const g = [...s.npcs.values()].find((n) => n.glow); const star = s.spawnShootingStar(); return { alpha: g.sprite.alpha, star: Boolean(star), count: s.shootingStars, phase: s.phase }; });
  assert.equal(night.phase, 'night');
  assert.ok(night.alpha > 0.4, `반딧불이 알파 ${night.alpha}`);
  assert.equal(night.star, true);
  assert.equal(night.count, 1);
  await page.evaluate(() => window.NSM.scene.setClockOverride(13));
  await sleep(300);
  const day = await page.evaluate(() => { const s = window.NSM.scene; const g = [...s.npcs.values()].find((n) => n.glow); return { alpha: g.sprite.alpha, cloud: s.clouds[0].g.alpha }; });
  assert.ok(day.alpha < 0.05, '낮엔 반딧불이 안 보임');
  assert.ok(day.cloud > 0.08 && day.cloud < 0.2, `낮엔 옅은 구름 그림자 ${day.cloud}`);
  // 간식: 서버에서 사면 손에 아이콘
  await srv.hub.store.adjustCoins('민수', 2, 'test');
  const me = out.players.get(await page.evaluate(() => window.NSM.scene.me.id));
  const snack = out.room.interactables.find((i) => i.id === 'snack:icecream');
  me.x = snack.x; me.y = snack.y;
  await page.evaluate(() => window.NSM.net.zooSnack('icecream'));
  await page.waitForFunction(() => window.NSM.scene.me.snackText && window.NSM.scene.me.snackText.text === '🍦', { timeout: 5000 });
  // 포토 플래시 이벤트 → 📸 + 플래시 카운트
  await page.evaluate((id) => window.NSM.net.emitLocal('photo', { ids: [id], nicknames: ['민수'] }), me.id);
  await page.waitForFunction(() => window.NSM.scene.photos === 1 && window.NSM.scene.me.emojiText && window.NSM.scene.me.emojiText.text === '📸', { timeout: 3000 });
  // 안내판 모달 (E → onUse('sign'))
  await page.evaluate(() => window.NSM.scene.hooks.onUse('sign', 'sign:panda'));
  await page.waitForFunction(() => !document.getElementById('sign-modal').hidden, { timeout: 3000 });
  assert.equal(await page.$eval('#sign-name', (el) => el.textContent), '판다');
  assert.match(await page.$eval('#sign-hint', (el) => el.textContent), /판다 2마리/);
  assert.deepEqual(errors, []);
});
