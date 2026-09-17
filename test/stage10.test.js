'use strict';
/**
 * 10단계: 펫 상점 + 펫 꾸미기.
 *  - 카탈로그: 개인 펫 10 · 공용 펫 3 · 꾸미기 8(슬롯·색) · 행동 3. pets.json 12종 앵커, petdeco.json 프레임.
 *  - FollowerNpc: 주인 뒤 1.5타일 따라오기(궤적), 벽·가구 통과 안 함, 못 따라오면/너무 멀면 순간이동, 멈추면 1초 뒤 앉기, 주인이 앉아 공부하면 발밑 (스킬이면 자기), 앵무새 어깨, 거북이 느림.
 *  - 월드: 구매 → 활성 펫 전환(npc 생성/교체/제거) · 이름 · 꾸미기(슬롯 검증) · 주인 퇴장 정리 · 재입장 복원.
 *  - 공용 펫: 풀기(3마리 제한·중복) · 회수/이름/꾸미기 권한(푼 사람) · 재시작 로드 · 강아지 꾸미기(누구나) 저장.
 *  - 스킬: 펫별 1회(already_has) · 이름 부르면 달려옴(onChat) · 하이파이브 반응.
 *  - 소켓 E2E: 다중 클라이언트 npc:update(ownerId·cosmetics) · npc:remove · pet:release/recall · npc:name 권한 · npc:pet 반응.
 *  - 브라우저: 펫 스프라이트·꾸미기 오버레이 렌더, 지갑 펫 탭 카드, 설정 내 펫.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createShop, ITEMS, PET_ITEMS, CATEGORIES } = require('../server/game/shop');
const { FollowerNpc, DogNpc, SPECIES, FOLLOW_GAP_PX, FOLLOW_TELEPORT_PX } = require('../server/game/npc');
const { World, MAX_SHARED_PETS } = require('../server/game/world');
const { createMemoryStore } = require('../server/store/memory');
const { getStudyRoom } = require('../server/rooms/studyroom');
const { isBlocked } = require('../server/rooms/build');
const { boot, connect, joinAs, ask, once, sleep, collect, pageUrl, openSettings, CHROME, CHROME_ARGS } = require('./helpers');

const room = getStudyRoom();
const shop = createShop();
const petsMeta = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'pets.json'), 'utf8'));
const decoAtlas = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'petdeco.json'), 'utf8'));
const KST = (iso) => new Date(`${iso}+09:00`).getTime();
const quiet = { log() {}, warn() {}, error() {} };
const T = 32;

function makeWorld(opts = {}) {
  let t = KST('2026-09-17T10:00:00');
  const store = opts.store || createMemoryStore();
  const world = new World(room, { now: () => t, store, tz: 'Asia/Seoul', npc: { autoStart: false, random: () => 0.5 }, study: { autoTick: false }, log: quiet, ...opts });
  const events = { removed: [], updates: [], pets: [] };
  world.on('npcRemoved', (e) => events.removed.push(e));
  world.on('npcUpdate', (e) => events.updates.push(e));
  world.on('npcPet', (e) => events.pets.push(e));
  const give = (nick, itemId, variant = null) => {
    const it = shop.get(itemId);
    return store.addInventory(nick, itemId, { name: it.name, price: it.price, tab: it.tab, category: it.category, variant: variant || (it.variants ? it.variants[0].id : null) }, t);
  };
  const at = (p, tx, ty) => { p.x = (tx + 0.5) * T; p.y = (ty + 1) * T; };
  const tick = (n = 1, ms = 100) => { for (let i = 0; i < n; i++) { t += ms; for (const npc of world.npcs) npc.tick(); } };
  return { world, store, events, give, at, tick, advance: (ms) => { t += ms; }, now: () => t };
}

// ── 카탈로그 · 에셋 ──────────────────────────────────────────────────
test('카탈로그: 개인 펫 10 · 공용 펫 3 · 꾸미기 8(슬롯/색) · 행동 3, 탭·카테고리', () => {
  assert.equal(PET_ITEMS.length, 24);
  assert.equal(ITEMS.length, 58); // 12단계: 탈것 5(인력거 포함) · 데칼 3 · 경적 3 추가
  const by = (c) => ITEMS.filter((i) => i.category === c);
  assert.equal(by('pet').length, 10);
  assert.equal(by('sharedPet').length, 3);
  assert.equal(by('petSkill').length, 3);
  assert.equal(by('petDeco').length, 8);
  assert.deepEqual(by('pet').map((i) => i.species), ['hamster', 'chick', 'turtle', 'rabbit', 'cat', 'maltese', 'poodle_black', 'shiba', 'parrot', 'slime']);
  assert.deepEqual(by('sharedPet').map((i) => [i.species, i.price]), [['cat', 35], ['turtle', 25], ['fish', 28]] // 12단계 30% 인하가);
  assert.deepEqual(by('petSkill').map((i) => [i.skill, i.price]), [['come', 7], ['sleep_beside', 7], ['high_five', 6]]);
  assert.deepEqual(by('petDeco').map((i) => [i.id, i.slot, i.variants ? i.variants.length : 0]), [
    ['deco_ribbon', 'head', 4], ['deco_collar', 'neck', 4], ['deco_scarf', 'neck', 4], ['deco_straw_hat', 'head', 0], ['deco_beanie', 'head', 0], ['deco_glasses', 'head', 0], ['deco_crown', 'head', 0], ['deco_wings', 'back', 0]]);
  assert.ok(by('pet').every((i) => i.tab === 'pet') && by('petDeco').every((i) => i.tab === 'petDeco'));
  assert.deepEqual(CATEGORIES.filter((c) => c.tab === 'pet').map((c) => c.id), ['pet', 'sharedPet', 'petSkill']);
  assert.equal(SPECIES.turtle.speed < SPECIES.rabbit.speed, true);
  assert.equal(SPECIES.parrot.shoulder, true);
});

test('에셋: pets.json 12종(기존 강아지 = 0)·6행 앵커, pets.png 크기, petdeco.json 모든 꾸미기·색·뷰 프레임', () => {
  const sp = petsMeta.species;
  assert.deepEqual(Object.keys(sp).sort(), ['cat', 'chick', 'dog', 'fish', 'hamster', 'maltese', 'parrot', 'poodle_black', 'rabbit', 'shiba', 'slime', 'turtle']);
  assert.equal(sp.dog.index, 0);
  assert.equal(petsMeta.framesPerRow, 24);
  assert.deepEqual(petsMeta.rows, { down: 0, right: 1, up: 2, left: 3, sit: 4, sleep: 5 });
  for (const [name, s] of Object.entries(sp)) {
    for (const row of ['down', 'right', 'up', 'left', 'sit', 'sleep']) {
      for (const a of ['head', 'face', 'neck', 'back']) assert.ok(Array.isArray(s.anchors[row][a]) && s.anchors[row][a].length === 2, `${name}.${row}.${a}`);
    }
  }
  for (const it of ITEMS.filter((i) => i.species)) assert.ok(sp[it.species], it.id);
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', 'assets', 'pets.png')));
  const has = (k) => Boolean(decoAtlas.frames[k]);
  for (const it of ITEMS.filter((i) => i.category === 'petDeco')) {
    const base = it.id.replace(/^deco_/, '');
    for (const v of it.variants ? it.variants.map((x) => x.id) : [null]) {
      for (const view of ['front', 'side', 'back']) assert.ok(has(`deco/${base}${v ? `/${v}` : ''}/${view}/f0`), `${base} ${v} ${view}`);
    }
  }
  assert.ok(has('deco/wings/front/f1'), '날개 2프레임');
  assert.deepEqual(decoAtlas.meta.slots.glasses, 'face');
});

// ── FollowerNpc ──────────────────────────────────────────────────────
function owner(x, y, extra = {}) {
  return { id: 'p1', nickname: '민수', x, y, facing: 'down', seatId: null, status: 'rest', connected: true, ...extra };
}
function mkFollower(o, species = 'cat', skills = []) {
  let t = 0;
  const npc = new FollowerNpc(room, o, { id: 'p:p1', species, name: '나비', now: () => t, skills });
  const tick = (n = 1, ms = 100) => { for (let i = 0; i < n; i++) { t += ms; npc.tick(); } };
  return { npc, tick, now: () => t };
}

test('FollowerNpc: 주인 뒤 1.5타일을 따라오고(궤적), 벽·가구에 들어가지 않으며, 멈추면 1초 뒤 앉는다', () => {
  const o = owner(22.5 * T, 21 * T);
  const { npc, tick } = mkFollower(o);
  assert.deepEqual(npc.snapshot().ownerId, 'p1');
  assert.equal(npc.state, 'sit');
  // 복도를 따라 위로 걷는다 (초당 150px, 틱마다 15px)
  const walked = [];
  for (let i = 0; i < 24; i++) {
    o.y -= 15;
    tick();
    const { tx, ty } = npc.tile();
    assert.equal(isBlocked(room, tx, ty), false, `벽 안 (${tx},${ty})`);
    walked.push(Math.hypot(o.x - npc.x, o.y - npc.y));
  }
  assert.equal(npc.state, 'walk');
  const d = walked.at(-1);
  assert.ok(d >= FOLLOW_GAP_PX * 0.6 && d <= FOLLOW_GAP_PX * 2.5, `주인과 거리 ${d}`);
  assert.equal(npc.teleports, 0, '순간이동 없이 따라옴');
  // 주인이 멈춤 → 1초 뒤 앉기, 주인을 바라본다
  tick(4);
  assert.notEqual(npc.state, 'sit');
  tick(10);
  assert.equal(npc.state, 'sit');
  assert.ok(Math.hypot(o.x - npc.x, o.y - npc.y) <= FOLLOW_GAP_PX * 2.5);
});

test('FollowerNpc: 너무 멀어지거나 경로가 없으면 주인 옆으로 순간이동, 주인이 앉아 공부하면 발밑에서 앉기/자기(스킬), 앵무새는 어깨 위, 거북이는 느리다', () => {
  const o = owner(22.5 * T, 21 * T);
  const { npc, tick } = mkFollower(o, 'rabbit', ['sleep_beside']);
  // 순간이동: 주인이 멀리 점프
  o.x = 38.5 * T; o.y = 22 * T;
  tick();
  assert.equal(npc.teleports, 1);
  assert.ok(Math.hypot(o.x - npc.x, o.y - npc.y) < 2 * T);
  // 경로 없음: 주인이 벽 안(유리 스터디룸 밖 → 안으로 순간이동해도 문이 있으니 경로 있음). 완전히 막힌 곳: 바깥 화단 (0,33) 은 충돌이라 tileBeside 로 근처
  o.x = 5.5 * T; o.y = 2 * T; // 상단 벽 안 (통과 불가) — 못 따라온다
  for (let i = 0; i < 3; i++) tick();
  assert.ok(npc.teleports >= 2, '경로가 없으면 순간이동');
  // 주인이 자리에 앉아 공부 → 발밑, 스킬이 있으니 잔다
  o.x = 15.5 * T; o.y = 15 * T; o.seatId = 'seat-8'; o.status = 'study';
  npc.x = 16.5 * T; npc.y = 17 * T;
  tick(40);
  assert.equal(npc.state, 'sleep');
  assert.ok(Math.hypot(o.x - npc.x, o.y - npc.y) <= 1.6 * T, '발밑');
  o.status = 'rest';
  tick(3);
  assert.equal(npc.state, 'sit', '휴식이면 앉기만');
  // 스킬 없으면 공부 중이어도 앉는다
  const nos = mkFollower(owner(15.5 * T, 15 * T, { seatId: 'seat-8', status: 'study' }), 'cat');
  nos.tick(40);
  assert.equal(nos.npc.state, 'sit');
  // 앵무새: 주인 어깨 위 (경로 없음)
  const po = owner(22.5 * T, 21 * T, { facing: 'right' });
  const parrot = mkFollower(po, 'parrot');
  parrot.tick();
  assert.deepEqual([parrot.npc.x, parrot.npc.y, parrot.npc.facing, parrot.npc.snapshot().shoulder], [po.x + 9, po.y - 36, 'right', true]);
  po.x += 300; po.facing = 'left';
  parrot.tick();
  assert.deepEqual([parrot.npc.x, parrot.npc.facing], [po.x - 9, 'left']);
  assert.equal(parrot.npc.teleports, 0);
  // 거북이: 느려서 걷는 동안 뒤처진다 (틱당 4.5px)
  const to = owner(22.5 * T, 21 * T);
  const turtle = mkFollower(to, 'turtle');
  for (let i = 0; i < 10; i++) { to.y -= 15; turtle.tick(); }
  const dr = Math.hypot(to.x - turtle.npc.x, to.y - turtle.npc.y);
  assert.ok(dr > FOLLOW_GAP_PX * 1.2, `거북이는 뒤처진다 ${dr}`);
  assert.ok(FOLLOW_TELEPORT_PX >= 6 * T);
  assert.equal(turtle.npc.snapshot().bounce, undefined);
  assert.equal(mkFollower(owner(22.5 * T, 21 * T), 'slime').npc.snapshot().bounce, true);
});

// ── 월드: 개인 펫 ─────────────────────────────────────────────────────
test('월드: 구매 → 활성 펫 전환(생성/교체/제거) · 이름 · 꾸미기(슬롯 검증) · 주인 퇴장 정리 · 재입장 복원', async () => {
  const { world, store, events, give } = makeWorld();
  const a = world.join({ nickname: '민수', socketId: 'sa' }).player;
  await store.adjustCoins('민수', 300, 'study', world.now());
  const cat = await world.purchase(a, 'pet_cat');
  const ham = await world.purchase(a, 'pet_hamster');
  const ribbon = await world.purchase(a, 'deco_ribbon', 'pink');
  const wings = await world.purchase(a, 'deco_wings');
  assert.equal(cat.ok && ham.ok && ribbon.ok && wings.ok, true);
  assert.equal(world.followerOf(a), null);
  assert.deepEqual(await world.setPetConfig(a, { active: 9999 }), { ok: false, error: 'no_item' });
  assert.deepEqual(await world.setPetConfig(a, { active: ribbon.inventory.id }), { ok: false, error: 'not_pet' });
  let r = await world.setPetConfig(a, { active: cat.inventory.id });
  assert.equal(r.ok, true);
  assert.deepEqual([r.pet.id, r.pet.species, r.pet.name, r.pet.ownerId], [`p:${a.id}`, 'cat', '고양이', a.id]);
  assert.ok(world.npcSnapshots().some((n) => n.id === `p:${a.id}`));
  assert.equal((await store.getUser('민수')).petConfig.active, cat.inventory.id);
  // 이름
  assert.deepEqual(await world.setPetConfig(a, { name: '아주긴이름이름이름' }), { ok: false, error: 'invalid_name' });
  r = await world.setPetConfig(a, { name: '나비' });
  assert.equal(r.pet.name, '나비');
  assert.equal(world.followerOf(a).name, '나비');
  assert.equal((await world.setNpcName(a, `p:${a.id}`, '냐옹')).name, '냐옹');
  // 꾸미기: 슬롯 검증
  assert.deepEqual(await world.setPetConfig(a, { cosmetics: { head: wings.inventory.id } }), { ok: false, error: 'wrong_slot' });
  assert.deepEqual(await world.setPetConfig(a, { cosmetics: { head: 9999 } }), { ok: false, error: 'no_item' });
  r = await world.setPetConfig(a, { cosmetics: { head: ribbon.inventory.id, back: wings.inventory.id } });
  assert.deepEqual(r.pet.cosmetics, { head: 'ribbon/pink', neck: null, back: 'wings' });
  assert.deepEqual((await world.setPetDeco(a, `p:${a.id}`, { head: null, back: wings.inventory.id })).pet.cosmetics, { head: null, neck: null, back: 'wings' });
  // 교체: 햄스터로 → 고양이 npc 제거·새 npc, 고양이 설정은 남는다
  r = await world.setPetConfig(a, { active: ham.inventory.id });
  assert.equal(r.pet.species, 'hamster');
  assert.equal(events.removed.length, 1);
  assert.equal(world.npcs.filter((n) => n.ownerId === a.id).length, 1);
  assert.equal(r.petConfig.pets[cat.inventory.id].name, '냐옹');
  const w = await world.wallet(a);
  assert.equal(w.inventory.find((i) => i.id === ham.inventory.id).active, true);
  assert.equal(w.inventory.find((i) => i.id === cat.inventory.id).active, false);
  assert.equal(w.inventory.find((i) => i.id === wings.inventory.id).equippedOn, `pet:${cat.inventory.id}`);
  assert.equal(w.pets.config.active, ham.inventory.id);
  // 활성 없음 → 제거
  r = await world.setPetConfig(a, { active: null });
  assert.equal(r.pet, null);
  assert.equal(world.followerOf(a), null);
  // 다시 켜고 퇴장 → 같이 사라진다
  await world.setPetConfig(a, { active: cat.inventory.id });
  assert.ok(world.followerOf(a));
  world.remove(a.id);
  assert.equal(world.npcs.some((n) => n.ownerId === a.id), false);
  assert.equal(events.removed.at(-1).id, `p:${a.id}`);
  // 재입장 → 저장된 활성 펫 복원 (이름·꾸미기 포함)
  const a2 = world.join({ nickname: '민수', socketId: 'sa2' }).player;
  await world.loadProfile(a2);
  const f = world.followerOf(a2);
  assert.deepEqual([f.species, f.name, f.publicCosmetics().back], ['cat', '냐옹', 'wings']);
  await world.dispose();
});

// ── 월드: 공용 펫 · 강아지 꾸미기 · 스킬 ─────────────────────────────
test('월드: 공용 펫 풀기(3마리 제한·중복) · 회수/이름/꾸미기 권한 · 강아지 꾸미기(누구나) · 재시작 로드', async () => {
  const store = createMemoryStore();
  const w1 = makeWorld({ store });
  const { world, give, events } = w1;
  const a = world.join({ nickname: '민수', socketId: 'sa' }).player;
  const b = world.join({ nickname: '영희', socketId: 'sb' }).player;
  const c1 = await give('민수', 'shared_cat');
  const t1 = await give('민수', 'shared_turtle');
  const f1 = await give('영희', 'shared_fish');
  const c2 = await give('영희', 'shared_cat');
  const pc = await give('민수', 'pet_cat');
  assert.deepEqual(await world.releasePet(a, { inventoryId: pc.id }), { ok: false, error: 'not_shared_pet' });
  assert.deepEqual(await world.releasePet(a, { inventoryId: f1.id }), { ok: false, error: 'no_item' }, '남의 것');
  assert.deepEqual(await world.releasePet(a, { inventoryId: c1.id, name: '너무긴이름이에요요' }), { ok: false, error: 'invalid_name' });
  const r1 = await world.releasePet(a, { inventoryId: c1.id, name: '치즈' });
  assert.equal(r1.ok, true);
  assert.deepEqual([r1.pet.species, r1.pet.name, r1.pet.id], ['cat', '치즈', `s:${r1.roomPetId}`]);
  assert.deepEqual(await world.releasePet(a, { inventoryId: c1.id }), { ok: false, error: 'already_released' });
  const r2 = await world.releasePet(a, { inventoryId: t1.id });
  assert.equal(r2.pet.name, '거북이', '이름 안 주면 아이템 이름(괄호 뺀)');
  const r3 = await world.releasePet(b, { inventoryId: f1.id, name: '금붕' });
  assert.equal(r3.pet.species, 'fish');
  assert.equal(world.sharedPetCount(), 3);
  assert.deepEqual(await world.releasePet(b, { inventoryId: c2.id }), { ok: false, error: 'room_full' });
  assert.equal(MAX_SHARED_PETS, 3);
  // 권한: 이름·꾸미기·회수는 푼 사람만
  assert.deepEqual(await world.setNpcName(b, r1.pet.id, '도둑'), { ok: false, error: 'forbidden' });
  assert.equal((await world.setNpcName(a, r1.pet.id, '치즈냥')).name, '치즈냥');
  assert.deepEqual(await world.recallPet(b, r1.roomPetId), { ok: false, error: 'forbidden' });
  const hat = await give('민수', 'deco_straw_hat');
  const hatB = await give('영희', 'deco_beanie');
  assert.deepEqual(await world.setPetDeco(b, r1.pet.id, { head: hatB.id }), { ok: false, error: 'forbidden' });
  assert.deepEqual(await world.setPetDeco(a, r1.pet.id, { head: hat.id }), { ok: true, cosmetics: { head: 'straw_hat', neck: null, back: null } });
  // 강아지는 누구나 꾸민다 (저장 행 생성)
  assert.deepEqual(await world.setPetDeco(b, 'dog', { head: hatB.id }), { ok: true, cosmetics: { head: 'beanie', neck: null, back: null } });
  assert.equal(world.dogRow.itemId, 'dog');
  const w = await world.wallet(a);
  assert.equal(w.pets.shared.length, 3);
  assert.equal(w.pets.shared.find((p) => p.id === r1.pet.id).mine, true);
  assert.equal(w.pets.shared.find((p) => p.id === r3.pet.id).mine, false);
  assert.equal(w.inventory.find((i) => i.id === c1.id).released, r1.roomPetId);
  assert.equal(w.inventory.find((i) => i.id === hat.id).equippedOn, r1.pet.id);
  assert.deepEqual(w.pets.dog.cosmetics.head.itemId, 'deco_beanie');
  // 회수 → npc 제거, 인벤토리는 그대로
  assert.deepEqual(await world.recallPet(a, r2.roomPetId), { ok: true, id: r2.roomPetId });
  assert.equal(events.removed.at(-1).id, r2.pet.id);
  assert.equal(world.sharedPetCount(), 2);
  assert.equal((await world.wallet(a)).inventory.find((i) => i.id === t1.id).released, null);
  await world.dispose();
  // 재시작: 공용 펫 2마리 + 강아지 꾸미기 복원
  const w2 = makeWorld({ store });
  await w2.world.init();
  const ids = w2.world.npcSnapshots().map((n) => [n.id, n.species, n.name, n.cosmetics.head]);
  assert.deepEqual(ids, [['dog', 'dog', '사랑', 'beanie'], [`s:${r1.roomPetId}`, 'cat', '치즈냥', 'straw_hat'], [`s:${r3.roomPetId}`, 'fish', '금붕', null]]);
  assert.equal(w2.world.sharedPetCount(), 2);
  await w2.world.dispose();
});

test('월드: 스킬 — 대상 필수·펫별 1회, 이름 부르면 달려옴(강아지·공용·개인), 하이파이브 반응, 공용 펫 행동(고양이 잠자리·거북이 속도·물고기 어항)', async () => {
  const { world, store, give, tick, events, at } = makeWorld();
  const a = world.join({ nickname: '민수', socketId: 'sa' }).player;
  const b = world.join({ nickname: '영희', socketId: 'sb' }).player;
  await store.adjustCoins('민수', 200, 'study', world.now());
  assert.deepEqual(await world.purchase(a, 'skill_come'), { ok: false, error: 'no_target' });
  assert.deepEqual(await world.purchase(a, 'skill_come', null, 's:999'), { ok: false, error: 'no_target' });
  assert.equal((await world.purchase(a, 'skill_come', null, 'dog')).ok, true);
  assert.deepEqual(await world.purchase(a, 'skill_come', null, 'dog'), { ok: false, error: 'already_has' });
  assert.equal((await store.getCoins('민수')), 200 - 7, '거부는 차감 없음 (이름 부르면 달려옴 7)');
  assert.ok(world.dog.skills.has('come'));
  assert.deepEqual(world.dogRow.skills, ['come']);
  // 개인 펫에 하이파이브 + 자기
  const cat = await give('민수', 'pet_cat');
  assert.equal((await world.purchase(a, 'skill_high_five', null, cat.id)).ok, true);
  assert.equal((await world.purchase(a, 'skill_sleep', null, cat.id)).ok, true);
  assert.deepEqual(await world.purchase(a, 'skill_sleep', null, cat.id), { ok: false, error: 'already_has' });
  await world.setPetConfig(a, { active: cat.id, name: '나비' });
  const f = world.followerOf(a);
  assert.deepEqual([...f.skills].sort(), ['high_five', 'sleep_beside']);
  // 공용 펫에 스킬
  const sc = await give('민수', 'shared_cat');
  const rel = await world.releasePet(a, { inventoryId: sc.id, name: '치즈' });
  assert.equal((await world.purchase(a, 'skill_come', null, rel.pet.id)).ok, true);
  assert.deepEqual(world.roomPets.get(rel.roomPetId).row.skills, ['come']);
  // 이름 부르면 달려옴: 강아지(누구나 부를 수 있음) · 공용 고양이 · 개인 펫은 주인만
  at(a, 22, 20);
  at(b, 30, 20);
  const called = world.onChat(b, '사랑아 이리와');
  assert.deepEqual(called, ['dog']);
  assert.equal(world.dog.state, 'walk');
  assert.ok(world.dog.path.length > 0);
  assert.deepEqual(world.onChat(b, '나비야'), [], '남의 개인 펫은 안 온다 (스킬도 없음)');
  assert.deepEqual(world.onChat(a, '치즈 나비'), [`s:${rel.roomPetId}`], '개인 펫은 come 스킬이 없어 안 옴');
  tick(400); // 강아지가 도착해서 쳐다본다
  assert.ok(Math.hypot(world.dog.x - b.x, world.dog.y - b.y) < 2.5 * T, '부른 사람 옆까지');
  // 하이파이브
  at(a, 22, 20);
  f.x = a.x + 20; f.y = a.y;
  const pr = f.pet(a);
  assert.deepEqual(pr, { ok: true, reaction: '😻', highFive: true });
  assert.deepEqual(events.pets.at(-1), { npc: f.id, by: '민수', playerId: a.id, name: '나비', reaction: '😻', highFive: true });
  const dr = world.dog.pet(b);
  assert.equal(dr.highFive, false);
  // 공용 펫 행동: 고양이 잠자리(책장 선반·소파) 는 특별 타일, 거북이는 느림, 물고기는 어항 위에서 안 움직임
  const catNpc = world.roomPets.get(rel.roomPetId).npc;
  assert.deepEqual(catNpc.spots, SPECIES.cat.spots);
  assert.equal(catNpc.walkable(35, 5), true, '책장 선반 (목적지로만)');
  assert.equal(catNpc.walkable(36, 5), false);
  assert.equal(SPECIES.turtle.sharedSpeed.wander < 20, true);
  const fishInv = await give('영희', 'shared_fish');
  const fr = await world.releasePet(b, { inventoryId: fishInv.id });
  const fish = world.roomPets.get(fr.roomPetId).npc;
  const { x, y } = fish;
  tick(50);
  assert.deepEqual([fish.x, fish.y], [x, y], '물고기는 어항 안');
  assert.ok(['walk', 'sleep', 'sit'].includes(fish.state));
  await world.dispose();
});

// ── 소켓 E2E ────────────────────────────────────────────────────────
test('소켓 E2E: pet:config → 모두 npc:update(ownerId·cosmetics) · 주인 퇴장 npc:remove · pet:release/recall · npc:name 권한 · npc:pet 반응 · shop:buy 스킬', async (t) => {
  const srv = await boot({ world: { npc: { autoStart: false }, study: { autoTick: false } } });
  t.after(() => srv.close());
  const a = connect(srv.port);
  const b = connect(srv.port);
  t.after(() => { a.close(); b.close(); });
  const ja = await joinAs(a, { nickname: '민수' });
  const jb = await joinAs(b, { nickname: '영희' });
  assert.deepEqual(ja.npcs.map((n) => n.id), ['dog']);
  assert.equal(ja.npcs[0].species, 'dog');
  assert.deepEqual(ja.npcs[0].cosmetics, { head: null, neck: null, back: null });
  await srv.world.store.adjustCoins('민수', 300, 'study', Date.now());
  const shiba = await ask(a, 'shop:buy', { itemId: 'pet_shiba' });
  const scarf = await ask(a, 'shop:buy', { itemId: 'deco_scarf', variant: 'navy' });
  assert.equal(shiba.ok && scarf.ok, true);
  // 활성 펫 → B 도 npc:update 로 본다
  const seenB = once(b, 'npc:update', { filter: (d) => d.id === `p:${ja.self.id}` });
  const cfg = await ask(a, 'pet:config', { active: shiba.inventory.id, name: '콩이', cosmetics: { neck: scarf.inventory.id } });
  assert.equal(cfg.ok, true);
  const snap = await seenB;
  assert.deepEqual([snap.species, snap.name, snap.ownerId, snap.cosmetics.neck], ['shiba', '콩이', ja.self.id, 'scarf/navy']);
  // 늦게 온 사람은 ack npcs 로
  const c = connect(srv.port);
  t.after(() => c.close());
  const jc = await joinAs(c, { nickname: '철수' });
  assert.ok(jc.npcs.some((n) => n.id === `p:${ja.self.id}` && n.name === '콩이'));
  // 이름 권한: 남의 개인 펫 → forbidden, 주인 → ok + npc:name
  assert.deepEqual(await ask(b, 'npc:name', { id: `p:${ja.self.id}`, name: '도둑' }), { ok: false, error: 'forbidden' });
  const nameC = once(c, 'npc:name');
  assert.equal((await ask(a, 'npc:name', { id: `p:${ja.self.id}`, name: '콩' })).ok, true);
  assert.deepEqual(await nameC, { id: `p:${ja.self.id}`, name: '콩' });
  // 쓰다듬기: 반응 이모지 (남의 펫도 쓰다듬는다)
  const pb = srv.world.players.get(jb.self.id);
  const pet = srv.world.followerOf(srv.world.players.get(ja.self.id));
  pb.x = pet.x + 10; pb.y = pet.y;
  const petSeen = once(c, 'npc:pet');
  const pr = await ask(b, 'npc:pet', { id: pet.id });
  assert.deepEqual(pr, { ok: true, reaction: '🔥', highFive: false });
  assert.deepEqual(await petSeen, { id: pet.id, by: '영희', playerId: jb.self.id, reaction: '🔥', highFive: false });
  // 스킬 구매 (대상: 강아지) + 채팅으로 부르기
  assert.equal((await ask(a, 'shop:buy', { itemId: 'skill_come', target: 'dog' })).ok, true);
  assert.deepEqual(await ask(a, 'shop:buy', { itemId: 'skill_come', target: 'dog' }), { ok: false, error: 'already_has' });
  await ask(a, 'chat', { text: '사랑아 와' });
  assert.equal(srv.world.dog.state, 'walk');
  // 공용 펫 풀기 → 모두 npc:update, 회수 권한, npc:remove
  await srv.world.store.adjustCoins('영희', 100, 'study', Date.now());
  const fish = await ask(b, 'shop:buy', { itemId: 'shared_fish' });
  const fishSeen = once(a, 'npc:update', { filter: (d) => d.species === 'fish' });
  const rel = await ask(b, 'pet:release', { inventoryId: fish.inventory.id, name: '금붕' });
  assert.equal(rel.ok, true);
  assert.equal((await fishSeen).name, '금붕');
  assert.deepEqual(await ask(a, 'pet:recall', { id: rel.roomPetId }), { ok: false, error: 'forbidden' });
  assert.deepEqual(await ask(a, 'pet:deco', { id: rel.pet.id, slots: { head: scarf.inventory.id } }), { ok: false, error: 'forbidden' });
  const wb = await ask(b, 'wallet');
  assert.equal(wb.pets.shared.length, 1);
  assert.equal(wb.pets.shared[0].mine, true);
  const rmA = once(a, 'npc:remove');
  assert.deepEqual(await ask(b, 'pet:recall', { id: rel.roomPetId }), { ok: true, id: rel.roomPetId });
  assert.deepEqual(await rmA, { id: rel.pet.id });
  // 주인 퇴장 → 개인 펫 npc:remove
  const rmC = once(c, 'npc:remove', { filter: (d) => d.id.startsWith('p:') });
  await ask(a, 'leave');
  assert.deepEqual(await rmC, { id: `p:${ja.self.id}` });
  // 재입장 → 다시 따라온다
  const a2 = connect(srv.port);
  t.after(() => a2.close());
  const ja2 = await joinAs(a2, { nickname: '민수' });
  await sleep(50);
  const f2 = srv.world.followerOf(srv.world.players.get(ja2.self.id));
  assert.deepEqual([f2.species, f2.name], ['shiba', '콩']);
});

// ── 브라우저 ────────────────────────────────────────────────────────
const hasChrome = Boolean(CHROME);
let puppeteer = null;
try { puppeteer = require('puppeteer-core'); } catch (_) { /* devDependency 없음 */ }

test('브라우저: 펫 스프라이트·꾸미기 오버레이 렌더 · 지갑 펫/꾸미기 탭 카드 · 설정 내 펫 선택 · npc:remove', { skip: !hasChrome || !puppeteer ? 'Chrome/puppeteer-core 없음' : false, timeout: 180000 }, async (t) => {
  const srv = await boot({ world: { study: { autoTick: false } } }); // NPC 틱이 돌아야 꾸미기 변경이 npc:update 로 나간다
  t.after(() => srv.close());
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: CHROME_ARGS });
  t.after(() => browser.close());
  const errors = [];
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewport({ width: 1300, height: 850 });
  await page.goto(pageUrl(srv), { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForSelector('#login:not([hidden])', { timeout: 30000 });
  await page.type('#login-nick', '펫테스트');
  await page.click('#login-submit');
  await page.waitForFunction(() => window.NSM && window.NSM.scene.me && window.NSM.scene.npcs.has('dog'), { timeout: 30000 });
  const me = [...srv.world.players.values()][0];
  await srv.world.store.adjustCoins('펫테스트', 300, 'study', Date.now());
  await srv.world.award('펫테스트', me.id, 1, 'study');
  // 지갑 펫 탭: 카테고리 3개, 개인 펫 카드 10 → 토끼 구매 → 꾸미기 탭 리본(분홍) 구매
  await page.click('#btn-wallet');
  await page.waitForFunction(() => window.NSM.ui.wallet, { timeout: 5000 });
  await page.click('#wallet-tabs button[data-tab="pet"]');
  await page.waitForFunction(() => document.querySelectorAll('#wallet-items .wallet-item').length === 10, { timeout: 5000 });
  assert.deepEqual(await page.$$eval('#wallet-cats button', (els) => els.map((b) => b.textContent)), ['개인 펫', '공용 펫', '행동 업그레이드']);
  await page.click('#wallet-items .wallet-item[data-item="pet_rabbit"] .btn');
  await page.waitForFunction(() => /보유 1/.test(document.querySelector('#wallet-items .wallet-item[data-item="pet_rabbit"] .count').textContent), { timeout: 5000 });
  await page.click('#wallet-cats button[data-cat="petSkill"]');
  await page.waitForFunction(() => document.querySelectorAll('#wallet-items .wallet-item .skill-target').length === 3, { timeout: 5000 });
  await page.click('#wallet-tabs button[data-tab="petDeco"]');
  await page.waitForFunction(() => document.querySelectorAll('#wallet-items .wallet-item').length === 8, { timeout: 5000 });
  await page.click('#wallet-items .wallet-item[data-item="deco_ribbon"] .swatch[data-variant="pink"]');
  await page.click('#wallet-items .wallet-item[data-item="deco_ribbon"] .btn');
  await page.waitForFunction(() => /보유 1/.test(document.querySelector('#wallet-items .wallet-item[data-item="deco_ribbon"] .count').textContent), { timeout: 5000 });
  // 미리보기(걷기 애니)
  await page.click('#wallet-items .wallet-item[data-item="deco_ribbon"] .furn-icon');
  await page.waitForSelector('#item-preview:not([hidden])');
  await page.click('#preview-close');
  await page.click('#wallet-close');
  // 설정 → 내 펫: 토끼 선택 → 씬에 p: npc 생성, 리본 장착 → 오버레이 스프라이트
  await openSettings(page);
  await page.waitForFunction(() => document.querySelectorAll('#mypet-active option').length === 2, { timeout: 5000 });
  await page.select('#mypet-active', String((await srv.world.store.listInventory('펫테스트')).find((i) => i.itemId === 'pet_rabbit').id));
  await page.waitForFunction((id) => window.NSM.scene.npcs.has(`p:${id}`), { timeout: 5000 }, me.id);
  assert.equal(await page.evaluate((id) => window.NSM.scene.npcs.get(`p:${id}`).species, me.id), 'rabbit');
  await page.waitForFunction(() => document.querySelectorAll('#mypet-deco select').length === 3, { timeout: 5000 });
  const ribbonId = (await srv.world.store.listInventory('펫테스트')).find((i) => i.itemId === 'deco_ribbon').id;
  await page.select('#mypet-deco select[data-slot="head"]', String(ribbonId));
  await page.waitForFunction((id) => { const n = window.NSM.scene.npcs.get(`p:${id}`); return n && n.deco.head && n.deco.head.key === 'ribbon/pink' && n.deco.head.sprite.visible; }, { timeout: 5000 }, me.id);
  await page.click('#btn-settings'); // 닫기
  // 강아지에 리본을 옮겨 달면 개인 펫에선 빠진다(서버 설정 우선순위는 없음 — 둘 다 달 수 있음), 강아지 오버레이 확인
  await srv.world.setPetDeco(me, 'dog', { head: ribbonId });
  await page.waitForFunction(() => { const n = window.NSM.scene.npcs.get('dog'); return n && n.deco.head && n.deco.head.key === 'ribbon/pink'; }, { timeout: 5000 });
  // 활성 해제 → npc:remove
  await srv.world.setPetConfig(me, { active: null });
  await page.waitForFunction((id) => !window.NSM.scene.npcs.has(`p:${id}`), { timeout: 5000 }, me.id);
  assert.deepEqual(errors, []);
});
