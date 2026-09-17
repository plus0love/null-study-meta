'use strict';
/**
 * 9단계: 가구 상점 + 자유 배치.
 *  - 카탈로그 23종(책상 12 · 공용 11) · 변형(색/종류) · 아틀라스(furniture.json)에 아이콘·스프라이트·회전·애니·이불 프레임이 다 있다.
 *  - 배치 규칙(layout.js): 풋프린트 회전, 빈 바닥/벽 전용/소파·책장·커피머신 위/러그 겹침 허용/다른 가구 겹침 금지/사람이 서 있는 셀/맵 밖.
 *  - 월드: 구매(variant) · 책상 슬롯 장착(playerDesk) · 배치/이동/회수 · 잠금(먼저 잡은 사람 우선, 만료, 편집 종료·퇴장 시 해제) · 권한("내가 놓은 것만") ·
 *    충돌 맵 반영 · 침대/안마의자 좌석(자동 휴식, 세션 안 쌓임, 점유) · 서버 재시작 로드.
 *  - 소켓 E2E: 입장 ack layout, layout:update 브로드캐스트, playerEdit/playerDesk, 동시 잡기 locked, 끊기면 잠금 해제.
 *  - 브라우저: 지갑 가구 탭 카드 · 구매 · 편집 모드 배치(초록/빨강) · 침대에 눕기(회전 프레임·💤) · 책상 소품 표시.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createShop, ITEMS, CATEGORIES, pickVariant, frameKey, iconKey } = require('../server/game/shop');
const L = require('../server/game/layout');
const { World, LOCK_MS, RESTING_SEATS } = require('../server/game/world');
const { createMemoryStore } = require('../server/store/memory');
const { getStudyRoom } = require('../server/rooms/studyroom');
const { boot, connect, joinAs, ask, once, sleep, collect, pageUrl, openSettings, CHROME, CHROME_ARGS } = require('./helpers');

const room = getStudyRoom();
const shop = createShop();
const atlas = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'furniture.json'), 'utf8'));
const KST = (iso) => new Date(`${iso}+09:00`).getTime();
const quiet = { log() {}, warn() {}, error() {} };
const MIN = 60 * 1000;
const T = 32;

function makeWorld(opts = {}) {
  let t = KST('2026-09-17T10:00:00');
  const store = opts.store || createMemoryStore();
  const world = new World(room, { now: () => t, store, tz: 'Asia/Seoul', npc: { autoStart: false }, study: { autoTick: false }, log: quiet, ...opts });
  const events = { layout: [], desk: [], editing: [] };
  world.on('layout', (e) => events.layout.push(e));
  world.on('desk', (e) => events.desk.push(e));
  world.on('editing', (e) => events.editing.push(e));
  const give = (nick, itemId, variant = null) => {
    const it = shop.get(itemId);
    return store.addInventory(nick, itemId, { name: it.name, price: it.price, tab: it.tab, category: it.category, variant: variant || (it.variants ? it.variants[0].id : null) }, t);
  };
  const at = (p, tx, ty) => { p.x = (tx + 0.5) * T; p.y = (ty + 1) * T; };
  return { world, store, events, give, at, advance: (ms) => { t += ms; }, now: () => t };
}

// ── 카탈로그 · 아틀라스 ───────────────────────────────────────────────
test('카탈로그: 가구 23종 (책상 소품 12 · 공용 11), 가격·변형·스프라이트 메타', () => {
  const FURN = ITEMS.filter((i) => i.tab === 'furniture');
  assert.equal(FURN.length, 23);
  assert.equal(ITEMS.filter((i) => i.category === 'desk').length, 12);
  assert.equal(ITEMS.filter((i) => i.category === 'shared').length, 11);
  assert.deepEqual(CATEGORIES.filter((c) => c.tab === 'furniture').map((c) => c.id), ['desk', 'shared']);
  assert.equal(shop.get('mug').price, 2); // 12단계 30% 인하: 정가 3 → 2 (최소 2)
  assert.equal(shop.get('mug').variants.length, 5);
  assert.equal(shop.get('poster').variants.length, 5);
  assert.equal(shop.get('cushion').variants.length, 6);
  assert.equal(shop.get('wall_clock').variants.length, 3);
  assert.equal(shop.get('bed').variants.length, 3);
  assert.equal(shop.get('desk_lamp').variants.length, 3);
  assert.equal(shop.get('massage_chair').price, 31); // 인하가 (정가 45)
  assert.deepEqual(shop.get('bed').sprite.rotations, [0, 1]);
  assert.deepEqual(shop.get('rug_small').sprite.rotations, [0, 1]);
  assert.equal(shop.get('rug_small').sprite.layer, 'floor');
  assert.equal(shop.get('poster').sprite.wallOnly, true);
  assert.equal(shop.get('coffee_upgrade').sprite.replace, 'coffee_machine');
  assert.equal(shop.get('bed').sprite.seat.kind, 'bed');
  assert.equal(shop.get('massage_chair').sprite.seat.kind, 'massage');
  assert.equal(shop.get('beanbag').sprite.seat.kind, 'beanbag');
  for (const it of FURN) {
    assert.equal(it.tab, 'furniture');
    assert.ok(Number.isInteger(it.price) && it.price > 0, it.id);
    if (it.category === 'desk') assert.deepEqual([it.sprite.w, it.sprite.h, it.sprite.passable], [1, 1, true], it.id);
  }
  assert.deepEqual(pickVariant(shop.get('mug'), 'pink'), { ok: true, variant: 'pink' });
  assert.deepEqual(pickVariant(shop.get('mug'), undefined), { ok: true, variant: 'red' }, '안 고르면 첫 번째');
  assert.deepEqual(pickVariant(shop.get('mug'), 'gold'), { ok: false, error: 'no_variant' });
  assert.deepEqual(pickVariant(shop.get('figure'), 'x'), { ok: true, variant: null }, '변형 없는 아이템은 무시');
  assert.deepEqual(RESTING_SEATS, new Set(['bed', 'massage']));
});

test('아틀라스: 모든 아이템의 아이콘(32x32)·방 스프라이트·변형·회전·애니·이불 프레임이 있다', () => {
  const has = (k) => Boolean(atlas.frames[k]);
  for (const it of ITEMS.filter((i) => i.tab === 'furniture')) {
    assert.ok(has(iconKey(it.id)), `icon/${it.id}`);
    assert.deepEqual([atlas.frames[iconKey(it.id)].frame.w, atlas.frames[iconKey(it.id)].frame.h], [32, 32], it.id);
    const variants = it.variants ? it.variants.map((v) => v.id) : [null];
    for (const v of variants) {
      if (v) assert.ok(has(iconKey(it.id, v)), iconKey(it.id, v));
      for (const rot of it.sprite.rotations || [0]) {
        const fp = L.footprint(it.sprite, rot);
        for (let f = 0; f < (it.anim ? it.anim.frames : 1); f++) {
          const k = frameKey(it.id, v, rot, f);
          assert.ok(has(k), k);
          assert.deepEqual([atlas.frames[k].frame.w, atlas.frames[k].frame.h], [fp.w * T, fp.h * T], k);
        }
        if (it.sprite.top) assert.ok(has(frameKey(it.id, v, rot, 0, 'top')), frameKey(it.id, v, rot, 0, 'top'));
      }
    }
  }
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', 'assets', 'furniture.png')));
  assert.equal(Object.keys(atlas.frames).filter((k) => k.startsWith('icon/') && k.split('/').length === 2).length, 23, '아이콘 23개');
});

// ── 배치 규칙 (순수) ─────────────────────────────────────────────────
test('layout: 풋프린트·좌석 회전, 방 props/occupant, 책상 슬롯', () => {
  assert.deepEqual(L.footprint({ w: 3, h: 2 }, 1), { w: 2, h: 3 });
  assert.deepEqual(L.rotateCell({ w: 1, h: 2 }, 0, 1, 1), { dx: 0, dy: 0 }, '세로 침대의 발 쪽(0,1) → 가로에서 왼쪽(0,0)');
  assert.deepEqual(L.rotateCell({ w: 1, h: 2 }, 0, 0, 1), { dx: 1, dy: 0 }, '머리(0,0) → 오른쪽');
  assert.equal(L.rotateFacing('down', 1), 'left');
  assert.deepEqual(L.seatOf(shop.get('bed').sprite, 22, 14, 1), { tx: 22, ty: 14, facing: 'left', kind: 'bed' });
  assert.deepEqual(L.solidCells(shop.get('bed').sprite, 22, 14, 0).map((c) => [c.tx, c.ty]), [[22, 14]], '침대 머리 쪽만 충돌');
  assert.deepEqual(L.solidCells(shop.get('rug_small').sprite, 22, 14, 0), [], '러그는 통과 가능');
  assert.equal(L.occupantAt(room, 6, 13).name, 'coffee_machine');
  assert.equal(L.occupantAt(room, 14, 12).name, 'desk_wide');
  assert.equal(L.occupantAt(room, 22, 14), null);
  assert.equal(room.props.length > 100, true);
  assert.deepEqual(L.deskSlots(room, room.seats.find((s) => s.x === 15 && s.y === 14)), [{ tx: 14, ty: 12 }, { tx: 16, ty: 12 }, { tx: 15, ty: 12 }], '스터디룸 의자 → 책상 뒷줄 3칸 (모니터 자리는 마지막)');
  assert.deepEqual(L.deskSlots(room, room.seats.find((s) => s.x === 36 && s.y === 16)).length, 3, '회의 테이블 의자 → 테이블 셀 3개');
  assert.deepEqual(L.deskSlots(room, room.seats[0]).length, 1, '소파 앞은 라운드 테이블 한 칸');
});

test('layout: 배치 검증 — 빈 바닥/벽/좌석/문/스폰/맵 밖/기존 오브젝트/겹침/러그/벽 전용/소파·책장·커피머신 위/사람', () => {
  const v = (id, pl, others = [], occupied = new Set()) => L.validatePlacement(room, shop.get(id), pl, others, (i) => shop.get(i), { occupied });
  assert.equal(v('beanbag', { x: 22, y: 14 }).ok, true);
  assert.equal(v('beanbag', { x: 1, y: 14 }).error, 'blocked', '벽');
  assert.equal(v('beanbag', { x: 15, y: 13 }).error, 'blocked', '좌석 위');
  assert.equal(v('beanbag', { x: 14, y: 20 }).error, 'blocked', '문');
  assert.equal(v('beanbag', { x: 22, y: 22 }).error, 'blocked', '스폰');
  assert.equal(v('beanbag', { x: 24, y: 8 }).error, 'blocked', '강아지 쿠션');
  assert.equal(v('beanbag', { x: 45, y: 33 }).error, 'out_of_bounds');
  assert.equal(v('beanbag', { x: 'a', y: 1 }).error, 'out_of_bounds');
  assert.equal(v('beanbag', { x: 22, y: 14, rotation: 1 }).error, 'invalid_rotation');
  assert.equal(v('bed', { x: 22, y: 14, rotation: 2 }).error, 'invalid_rotation');
  assert.equal(v('bed', { x: 22, y: 14, rotation: 1 }).ok, true);
  assert.equal(v('floor_lamp', { x: 25, y: 6 }).error, 'blocked', '기존 협탁 위');
  // 겹침: 이미 놓인 침대(22,14 ~ 22,15) 위
  const bed = { id: 1, itemId: 'bed', x: 22, y: 14, rotation: 0 };
  assert.equal(v('beanbag', { x: 22, y: 15 }, [bed]).error, 'overlap');
  assert.equal(v('beanbag', { x: 22, y: 16 }, [bed]).ok, true);
  assert.equal(v('bed', { id: 1, x: 22, y: 15 }, [bed]).ok, true, '자기 자신과는 안 겹친다 (이동)');
  assert.equal(v('rug_small', { x: 22, y: 14 }, [bed]).ok, true, '러그는 가구 아래에');
  const rug = { id: 2, itemId: 'rug_small', x: 22, y: 14, rotation: 0 };
  assert.equal(v('beanbag', { x: 23, y: 14 }, [rug]).ok, true, '러그 위에 가구');
  assert.equal(v('rug_small', { x: 21, y: 16 }, [rug]).ok, true, '러그끼리도');
  // 벽 전용
  assert.equal(v('poster', { x: 13, y: 10 }).ok, true);
  assert.equal(v('wall_clock', { x: 11, y: 11 }).ok, true);
  assert.equal(v('poster', { x: 22, y: 14 }).error, 'wall_only', '바닥');
  assert.equal(v('poster', { x: 12, y: 10 }).error, 'wall_only', '액자가 걸린 벽');
  assert.equal(v('poster', { x: 13, y: 10 }, [{ id: 3, itemId: 'wall_clock', x: 13, y: 10, rotation: 0 }]).error, 'overlap');
  // 위에만: 소파·책장·커피머신
  assert.equal(v('blanket', { x: 18, y: 6 }).ok, true);
  assert.equal(v('blanket', { x: 22, y: 6 }).error, 'needs_base', '소파 밖으로 한 칸');
  assert.equal(v('cushion', { x: 18, y: 6 }).ok, true, '소파 위');
  assert.equal(v('cushion', { x: 4, y: 20 }).ok, true, '푸프 위');
  assert.equal(v('cushion', { x: 22, y: 14 }).ok, true, '빈 바닥');
  assert.equal(v('cushion', { x: 14, y: 12 }).error, 'needs_base', '책상 위는 안 됨');
  assert.equal(v('bookshelf_fill', { x: 34, y: 3 }).ok, true);
  assert.equal(v('bookshelf_fill', { x: 34, y: 1 }).error, 'needs_base', '책장 위 벽 부분');
  assert.equal(v('coffee_upgrade', { x: 6, y: 13 }).ok, true);
  assert.equal(v('coffee_upgrade', { x: 6, y: 14 }).error, 'needs_base');
  // 사람이 서 있는 셀
  assert.equal(v('beanbag', { x: 22, y: 14 }, [], new Set(['22,14'])).error, 'player_in_way');
  assert.equal(v('beanbag', { x: 22, y: 14 }, [], new Set(['22,15'])).ok, true, '좌석 셀은 통과 가능이라 괜찮다');
  assert.equal(v('rug_small', { x: 22, y: 14 }, [], new Set(['22,14'])).ok, true, '통과 가능 가구는 사람 위에도');
  assert.equal(v('ghost', { x: 1, y: 1 }).error, 'no_item');
  // 충돌 맵
  const grid = L.buildCollision(room, [bed, rug, { id: 4, itemId: 'floor_lamp', x: 30, y: 14, rotation: 0 }], (i) => shop.get(i));
  assert.equal(grid[14][22], true);
  assert.equal(grid[15][22], false, '침대 발 쪽(좌석)');
  assert.equal(grid[14][30], true);
  assert.equal(grid[15][30], true);
  assert.equal(room.collision[14][22], false, '원본은 그대로');
});

// ── 월드: 구매 · 장착 ─────────────────────────────────────────────────
test('월드: 구매(색 선택) → 인벤토리 meta.variant, 없는 색은 no_variant · 책상 슬롯 장착 · playerDesk', async () => {
  const { world, store, events } = makeWorld();
  const a = world.join({ nickname: '민수', socketId: 'sa' }).player;
  await store.adjustCoins('민수', 100, 'study', world.now());
  assert.deepEqual(await world.purchase(a, 'mug', 'gold'), { ok: false, error: 'no_variant' });
  const m = await world.purchase(a, 'mug', 'pink');
  assert.equal(m.ok, true);
  assert.equal(m.inventory.meta.variant, 'pink');
  assert.equal(m.inventory.meta.category, 'desk');
  const lamp = await world.purchase(a, 'desk_lamp');
  assert.equal(lamp.inventory.meta.variant, 'brass', '안 고르면 첫 번째 변형');
  const bed = await world.purchase(a, 'bed', 'rose');
  assert.equal(bed.balance, 100 - 2 - 6 - 28); // 인하가: 머그컵 2 · 탁상 램프 6 · 침대 28
  // 장착
  assert.deepEqual(await world.equipDesk(a, 'x'), { ok: false, error: 'invalid' });
  assert.deepEqual(await world.equipDesk(a, [m.inventory.id, m.inventory.id, null]), { ok: false, error: 'duplicate' });
  assert.deepEqual(await world.equipDesk(a, [9999, null, null]), { ok: false, error: 'no_item' });
  assert.deepEqual(await world.equipDesk(a, [bed.inventory.id, null, null]), { ok: false, error: 'not_desk' });
  const eq = await world.equipDesk(a, [m.inventory.id, null, lamp.inventory.id]);
  assert.deepEqual(eq, { ok: true, deskItems: [{ itemId: 'mug', variant: 'pink' }, null, { itemId: 'desk_lamp', variant: 'brass' }] });
  assert.deepEqual(world.publicPlayer(a).deskItems, eq.deskItems);
  assert.equal(events.desk.length, 1);
  const w = await world.wallet(a);
  assert.deepEqual(w.inventory.map((i) => [i.itemId, i.slot, i.placed]), [['mug', 0, false], ['desk_lamp', 2, false], ['bed', null, false]]);
  assert.deepEqual(w.categories.filter((c) => c.tab === 'furniture').map((c) => c.id), ['desk', 'shared']);
  assert.equal(w.items.filter((i) => i.tab === 'furniture').length, 23);
  // 재입장하면 저장된 슬롯이 복원된다 (users.desk_items)
  world.remove(a.id);
  const a2 = world.join({ nickname: '민수', socketId: 'sa2' }).player;
  assert.deepEqual(world.publicPlayer(a2).deskItems, [null, null, null], '로드 전');
  await world.loadProfile(a2);
  assert.deepEqual(world.publicPlayer(a2).deskItems, eq.deskItems);
  await world.dispose();
});

// ── 월드: 배치 · 이동 · 회수 · 충돌 ──────────────────────────────────
test('월드: 배치 검증(no_item/not_placeable/already_placed/규칙) · 충돌 맵 반영 · 이동 · 회수 → 인벤토리로 · 이벤트', async () => {
  const { world, store, events, give, at } = makeWorld();
  const a = world.join({ nickname: '민수', socketId: 'sa' }).player;
  const mug = await give('민수', 'mug');
  const lamp = await give('민수', 'floor_lamp');
  const rug = await give('민수', 'rug_small');
  assert.deepEqual(await world.placeFurniture(a, { inventoryId: 9999, x: 22, y: 14 }), { ok: false, error: 'no_item' });
  assert.deepEqual(await world.placeFurniture(a, { inventoryId: mug.id, x: 22, y: 14 }), { ok: false, error: 'not_placeable' });
  assert.equal((await world.placeFurniture(a, { inventoryId: lamp.id, x: 1, y: 1 })).error, 'blocked');
  // 내가 서 있는 자리엔 못 놓는다
  at(a, 22, 14);
  assert.equal((await world.placeFurniture(a, { inventoryId: lamp.id, x: 22, y: 13 })).error, 'player_in_way');
  at(a, 22, 17);
  assert.equal(world.canStand(22.5 * T, 15 * T), true);
  const p = await world.placeFurniture(a, { inventoryId: lamp.id, x: 22, y: 13 });
  assert.equal(p.ok, true);
  assert.equal(p.entry.itemId, 'floor_lamp');
  assert.equal(p.entry.placedBy, '민수');
  assert.equal(p.entry.rotation, 0);
  assert.equal(world.canStand(22.5 * T, 15 * T), false, '스탠드 조명 셀은 통과 불가');
  assert.equal(world.canStand(22.5 * T, 14 * T), false);
  assert.equal(world.move(a, { x: 22.5 * T, y: 15 * T }).reason, 'blocked', '이동 검증도 막힌다');
  assert.deepEqual(await world.placeFurniture(a, { inventoryId: lamp.id, x: 25, y: 14 }), { ok: false, error: 'already_placed' });
  assert.deepEqual(events.layout.at(-1).op, 'add');
  // 러그는 조명 아래로 들어간다
  const r = await world.placeFurniture(a, { inventoryId: rug.id, x: 21, y: 13, rotation: 1 });
  assert.equal(r.ok, true);
  assert.equal(r.entry.rotation, 1);
  assert.equal(world.listLayout().length, 2);
  // 이동: 겹치면 거부, 되면 이벤트 + 충돌 맵 갱신
  assert.equal((await world.moveFurniture(a, { id: p.entry.id, x: 24, y: 8 })).error, 'blocked', '강아지 쿠션');
  const mv = await world.moveFurniture(a, { id: p.entry.id, x: 26, y: 14 });
  assert.equal(mv.ok, true);
  assert.equal(world.canStand(22.5 * T, 15 * T), true, '옛 자리는 다시 통과 가능');
  assert.equal(world.canStand(26.5 * T, 16 * T), false);
  assert.equal(events.layout.at(-1).op, 'move');
  assert.equal((await store.roomLayout('studyroom')).find((e) => e.id === p.entry.id).x, 26, '저장소에도');
  assert.equal((await world.moveFurniture(a, { id: 9999, x: 1, y: 1 })).error, 'not_found');
  assert.equal((await world.moveFurniture(a, { id: r.entry.id, rotation: 0 })).ok, true, '회전만');
  // 회수 → 인벤토리에서 다시 안 놓인 상태
  let w = await world.wallet(a);
  assert.equal(w.inventory.find((i) => i.id === lamp.id).placed, true);
  const rm = await world.removeFurniture(a, p.entry.id);
  assert.deepEqual(rm, { ok: true, id: p.entry.id });
  assert.equal(world.canStand(26.5 * T, 16 * T), true);
  w = await world.wallet(a);
  assert.equal(w.inventory.find((i) => i.id === lamp.id).placed, false);
  assert.equal(events.layout.at(-1).op, 'remove');
  assert.equal(world.listLayout().length, 1);
  assert.equal((await world.removeFurniture(a, p.entry.id)).error, 'not_found');
  // 다시 놓을 수 있다
  assert.equal((await world.placeFurniture(a, { inventoryId: lamp.id, x: 26, y: 14 })).ok, true);
  await world.dispose();
});

test('월드: 잠금 — 먼저 잡은 사람 우선, 만료(30초), 편집 종료·퇴장 시 해제, 앉아 있는 가구는 못 잡음', async () => {
  const { world, events, give, advance } = makeWorld();
  const a = world.join({ nickname: '민수', socketId: 'sa' }).player;
  const b = world.join({ nickname: '영희', socketId: 'sb' }).player;
  const bag = await give('민수', 'beanbag');
  const { entry } = await world.placeFurniture(a, { inventoryId: bag.id, x: 22, y: 14 });
  assert.deepEqual(await world.grabFurniture(a, entry.id), { ok: true, id: entry.id });
  assert.deepEqual(await world.grabFurniture(b, entry.id), { ok: false, error: 'locked', by: a.id });
  assert.deepEqual(await world.moveFurniture(b, { id: entry.id, x: 23, y: 14 }), { ok: false, error: 'locked', by: a.id });
  assert.deepEqual(await world.removeFurniture(b, entry.id), { ok: false, error: 'locked', by: a.id });
  assert.equal(world.listLayout()[0].lockedBy, a.id);
  assert.equal((await world.grabFurniture(a, entry.id)).ok, true, '내가 다시 잡는 건 됨');
  assert.equal(events.layout.filter((e) => e.op === 'grab').length, 1, 'grab 이벤트는 처음 한 번');
  assert.deepEqual(world.releaseFurniture(b, entry.id), { ok: false, error: 'not_holder' });
  assert.deepEqual(world.releaseFurniture(a, entry.id), { ok: true });
  assert.equal(events.layout.at(-1).op, 'release');
  assert.equal((await world.grabFurniture(b, entry.id)).ok, true);
  // 만료
  advance(LOCK_MS + 1);
  assert.equal((await world.grabFurniture(a, entry.id)).ok, true, '30초 지나면 남이 잡을 수 있다');
  // 편집 종료 → 해제
  world.setEditing(a, true);
  assert.equal(world.publicPlayer(a).editing, true);
  assert.equal(events.editing.length, 1);
  world.setEditing(a, false);
  assert.equal(world.lockOwner(entry.id), null);
  assert.equal(events.layout.at(-1).op, 'release');
  // 퇴장 → 해제
  assert.equal((await world.grabFurniture(b, entry.id)).ok, true);
  world.remove(b.id);
  assert.equal(world.lockOwner(entry.id), null);
  // 앉아 있으면 못 잡는다 / 못 옮긴다 / 못 치운다
  const c = world.join({ nickname: '철수', socketId: 'sc' }).player;
  c.x = 22.5 * T; c.y = 16 * T;
  assert.equal(world.sit(c, `f:${entry.id}`).ok, true);
  assert.deepEqual(await world.grabFurniture(a, entry.id), { ok: false, error: 'occupied' });
  assert.equal((await world.removeFurniture(a, entry.id)).error, 'occupied');
  world.stand(c);
  assert.equal((await world.removeFurniture(a, entry.id)).ok, true);
  await world.dispose();
});

test('월드: 권한 — "내가 놓은 것만" 을 켠 사람의 가구는 남이 못 옮긴다 (접속 중이든 아니든), 끄면 누구나', async () => {
  const { world, store, give } = makeWorld();
  const a = world.join({ nickname: '민수', socketId: 'sa' }).player;
  const b = world.join({ nickname: '영희', socketId: 'sb' }).player;
  const bag = await give('민수', 'beanbag');
  const { entry } = await world.placeFurniture(a, { inventoryId: bag.id, x: 22, y: 14 });
  assert.equal((await world.moveFurniture(b, { id: entry.id, x: 23, y: 14 })).ok, true, '기본은 누구나');
  world.releaseFurniture(b, entry.id);
  assert.deepEqual(await world.setLayoutLock(a, true), { ok: true, layoutLock: true });
  assert.equal((await store.getUser('민수')).layoutLock, true);
  assert.deepEqual(await world.grabFurniture(b, entry.id), { ok: false, error: 'forbidden' });
  assert.deepEqual(await world.removeFurniture(b, entry.id), { ok: false, error: 'forbidden' });
  assert.equal((await world.moveFurniture(a, { id: entry.id, x: 22, y: 14 })).ok, true, '본인은 된다');
  world.releaseFurniture(a, entry.id);
  world.remove(a.id); // 오프라인이어도 저장된 설정을 본다
  assert.deepEqual(await world.grabFurniture(b, entry.id), { ok: false, error: 'forbidden' });
  await store.upsertUser('민수', { layoutLock: false });
  assert.equal((await world.grabFurniture(b, entry.id)).ok, true);
  assert.equal((await world.wallet(b)).layoutLock, false);
  await world.dispose();
});

test('월드: 침대·안마의자 — E 로 눕기/앉기(자동 휴식, 공부로 못 바꿈, 세션 안 쌓임), 1인 점유, 일어나면 이전 상태, 가로 침대 좌석 위치', async () => {
  const { world, give, advance } = makeWorld();
  const a = world.join({ nickname: '민수', socketId: 'sa' }).player;
  const b = world.join({ nickname: '영희', socketId: 'sb' }).player;
  const bed = await give('민수', 'bed', 'blue');
  const chair = await give('민수', 'massage_chair');
  const bag = await give('민수', 'beanbag');
  const pb = await world.placeFurniture(a, { inventoryId: bed.id, x: 22, y: 14 });
  const pc = await world.placeFurniture(a, { inventoryId: chair.id, x: 24, y: 14 });
  const pg = await world.placeFurniture(a, { inventoryId: bag.id, x: 21, y: 17 });
  assert.equal(pb.ok && pc.ok && pg.ok, true);
  const seats = world.allSeats().filter((s) => s.id.startsWith('f:'));
  assert.deepEqual(seats.map((s) => [s.id, s.x, s.y, s.kind]), [[`f:${pb.entry.id}`, 22, 15, 'bed'], [`f:${pc.entry.id}`, 24, 15, 'massage'], [`f:${pg.entry.id}`, 21, 18, 'beanbag']]);
  // 너무 멀면 못 눕는다
  assert.deepEqual(world.sit(a, `f:${pb.entry.id}`), { ok: false, error: 'too_far' });
  a.x = 22.5 * T; a.y = 17 * T;
  world.setStatus(a, 'study');
  const s = world.sit(a, `f:${pb.entry.id}`);
  assert.equal(s.ok, true);
  assert.equal(s.seat.kind, 'bed');
  assert.equal(a.status, 'rest', '침대는 자동 휴식');
  assert.equal(world.study.live.has('민수'), false, '세션 안 쌓임');
  assert.deepEqual(world.setStatus(a, 'study'), { ok: false, error: 'resting' });
  assert.equal(a.status, 'rest');
  assert.deepEqual([a.x, a.y], [22.5 * T, 16 * T], '발 위치는 좌석 셀');
  // 1인만
  b.x = 22.5 * T; b.y = 17 * T;
  assert.deepEqual(world.sit(b, `f:${pb.entry.id}`), { ok: false, error: 'occupied' });
  assert.deepEqual(world.seatSnapshot(), { [`f:${pb.entry.id}`]: a.id });
  advance(20 * MIN);
  world.stand(a);
  assert.equal(a.status, 'study', '일어나면 눕기 전 상태(공부)');
  assert.equal(world.study.live.has('민수'), false, '앉아 있지 않으니 세션 없음');
  // 안마의자도 자동 휴식
  a.x = 24.5 * T; a.y = 17 * T;
  assert.equal(world.sit(a, `f:${pc.entry.id}`).seat.kind, 'massage');
  assert.equal(a.status, 'rest');
  assert.deepEqual(world.setStatus(a, 'study'), { ok: false, error: 'resting' });
  world.stand(a);
  // 빈백은 보통 의자처럼 공부
  a.x = 21.5 * T; a.y = 20 * T;
  assert.equal(world.sit(a, `f:${pg.entry.id}`).ok, true);
  assert.equal(a.status, 'study');
  assert.equal(world.study.live.has('민수'), true);
  world.stand(a);
  // 가로 침대: 좌석은 왼쪽 칸, 머리 쪽(오른쪽)은 충돌
  a.x = 22.5 * T; a.y = 12 * T; // 비켜선다
  const mv = await world.moveFurniture(a, { id: pb.entry.id, x: 22, y: 20, rotation: 1 });
  assert.equal(mv.ok, true, mv.error);
  const hs = world.seat(`f:${pb.entry.id}`);
  assert.deepEqual([hs.x, hs.y, hs.facing], [22, 20, 'left']);
  assert.equal(world.canStand(23.5 * T, 21 * T), false, '머리 쪽');
  assert.equal(world.canStand(22.5 * T, 21 * T), true, '발 쪽(좌석)');
  assert.equal(world.seat('f:9999'), null);
  assert.equal(world.seat(null), null);
  await world.dispose();
});

test('월드: 서버 재시작 — 저장소의 배치를 init() 에서 로드하고 충돌 맵에 반영, 모르는 아이템은 무시', async () => {
  const store = createMemoryStore();
  const w1 = makeWorld({ store });
  const a = w1.world.join({ nickname: '민수', socketId: 'sa' }).player;
  const lamp = await w1.give('민수', 'floor_lamp');
  const bed = await w1.give('민수', 'bed', 'sage');
  await w1.world.placeFurniture(a, { inventoryId: lamp.id, x: 22, y: 13 });
  const pb = await w1.world.placeFurniture(a, { inventoryId: bed.id, x: 26, y: 14, rotation: 1 });
  await store.addLayout('studyroom', { itemId: 'ghost_item', inventoryId: null, x: 30, y: 14, rotation: 0, meta: {}, placedBy: '민수' });
  await store.addLayout('otherroom', { itemId: 'floor_lamp', inventoryId: null, x: 30, y: 14, rotation: 0, meta: {}, placedBy: '민수' });
  await w1.world.dispose();

  const w2 = makeWorld({ store });
  assert.equal(w2.world.canStand(22.5 * T, 15 * T), true, '로드 전');
  await w2.world.init();
  const list = w2.world.listLayout();
  assert.deepEqual(list.map((e) => [e.itemId, e.x, e.y, e.rotation, e.variant]), [['floor_lamp', 22, 13, 0, null], ['bed', 26, 14, 1, 'sage']]);
  assert.equal(w2.world.canStand(22.5 * T, 15 * T), false);
  assert.equal(w2.world.canStand(27.5 * T, 15 * T), false, '가로 침대 머리 쪽');
  assert.equal(w2.world.seat(`f:${pb.entry.id}`).kind, 'bed');
  assert.equal(w2.world.canStand(30.5 * T, 15 * T), true, '모르는 아이템·다른 방 항목은 무시');
  await w2.world.dispose();
});

// ── 소켓 E2E ────────────────────────────────────────────────────────
test('소켓 E2E: 입장 ack layout · shop:buy variant · desk:equip → playerDesk · edit:mode → playerEdit · layout:place/move/remove → layout:update · 동시 잡기 locked · 끊기면 해제', async (t) => {
  const srv = await boot({ world: { npc: { autoStart: false }, study: { autoTick: false } } });
  t.after(() => srv.close());
  const a = connect(srv.port);
  const b = connect(srv.port);
  t.after(() => { a.close(); b.close(); });
  const ja = await joinAs(a, { nickname: '민수' });
  const jb = await joinAs(b, { nickname: '영희' });
  assert.deepEqual(ja.layout, []);
  assert.deepEqual(ja.self.deskItems, [null, null, null]);
  assert.equal(ja.self.editing, false);
  await srv.world.store.adjustCoins('민수', 200, 'study', Date.now());

  // 구매 (색) + 장착 → 모두에게 playerDesk
  const mug = await ask(a, 'shop:buy', { itemId: 'mug', variant: 'blue' });
  assert.equal(mug.ok, true);
  assert.equal(mug.inventory.meta.variant, 'blue');
  assert.deepEqual(await ask(a, 'shop:buy', { itemId: 'mug', variant: 'nope' }), { ok: false, error: 'no_variant' });
  const deskB = once(b, 'playerDesk');
  const eq = await ask(a, 'desk:equip', { slots: [null, mug.inventory.id, null] });
  assert.deepEqual(eq, { ok: true, deskItems: [null, { itemId: 'mug', variant: 'blue' }, null] });
  assert.deepEqual(await deskB, { id: ja.self.id, deskItems: eq.deskItems });
  assert.deepEqual((await ask(a, 'desk:equip', { slots: [1, 1, null] })), { ok: false, error: 'duplicate' });

  // 편집 모드 → playerEdit
  const editB = once(b, 'playerEdit');
  assert.deepEqual(await ask(a, 'edit:mode', { on: true }), { ok: true, editing: true });
  assert.deepEqual(await editB, { id: ja.self.id, editing: true });

  // 배치 → layout:update (본인 포함 모두)
  const bed = await ask(a, 'shop:buy', { itemId: 'bed', variant: 'rose' });
  const upA = collect(a, 'layout:update');
  const upB = once(b, 'layout:update');
  const pl = await ask(a, 'layout:place', { inventoryId: bed.inventory.id, x: 22, y: 14, rotation: 0 });
  assert.equal(pl.ok, true);
  const gotB = await upB;
  assert.equal(gotB.op, 'add');
  assert.deepEqual(gotB.entry, pl.entry);
  assert.equal(gotB.by, ja.self.id);
  await sleep(20);
  assert.equal(upA.length, 1, '놓은 사람도 받는다');
  assert.deepEqual(await ask(a, 'layout:place', { inventoryId: bed.inventory.id, x: 25, y: 14 }), { ok: false, error: 'already_placed' });
  assert.deepEqual(await ask(b, 'layout:place', { inventoryId: bed.inventory.id, x: 25, y: 14 }), { ok: false, error: 'no_item' }, '남의 인벤토리는 못 놓는다');
  // 늦게 들어온 사람은 ack 로 받는다
  const c = connect(srv.port);
  t.after(() => c.close());
  const jc = await joinAs(c, { nickname: '철수' });
  assert.deepEqual(jc.layout.map((e) => [e.itemId, e.x, e.y, e.variant, e.placedBy]), [['bed', 22, 14, 'rose', '민수']]);
  assert.equal(jc.players.find((p) => p.id === ja.self.id).editing, true);
  assert.deepEqual(jc.players.find((p) => p.id === ja.self.id).deskItems, eq.deskItems);

  // 동시 잡기: A 가 먼저 → B 는 locked, B 의 이동도 locked
  const grabC = once(c, 'layout:update', { filter: (e) => e.op === 'grab' });
  assert.deepEqual(await ask(a, 'layout:grab', { id: pl.entry.id }), { ok: true, id: pl.entry.id });
  assert.deepEqual(await grabC, { op: 'grab', id: pl.entry.id, by: ja.self.id });
  assert.deepEqual(await ask(b, 'layout:grab', { id: pl.entry.id }), { ok: false, error: 'locked', by: ja.self.id });
  assert.deepEqual(await ask(b, 'layout:move', { id: pl.entry.id, x: 23, y: 14 }), { ok: false, error: 'locked', by: ja.self.id });
  // A 가 옮기고(회전) 놓으면 → move + release
  const mvC = once(c, 'layout:update', { filter: (e) => e.op === 'move' });
  const mv = await ask(a, 'layout:move', { id: pl.entry.id, x: 22, y: 16, rotation: 1 });
  assert.equal(mv.ok, true);
  assert.deepEqual((await mvC).entry, mv.entry);
  assert.deepEqual(await ask(a, 'layout:release', { id: pl.entry.id }), { ok: true });
  assert.equal((await ask(b, 'layout:grab', { id: pl.entry.id })).ok, true);
  assert.equal((await ask(a, 'layout:grab', { id: pl.entry.id })).error, 'locked');
  // B 가 끊기면 잠금 해제 (release 브로드캐스트) → A 가 회수
  const relA = once(a, 'layout:update', { filter: (e) => e.op === 'release' });
  await ask(b, 'edit:mode', { on: true });
  b.close();
  assert.deepEqual(await relA, { op: 'release', id: pl.entry.id, by: jb.self.id });
  const rmC = once(c, 'layout:update', { filter: (e) => e.op === 'remove' });
  assert.deepEqual(await ask(a, 'layout:remove', { id: pl.entry.id }), { ok: true, id: pl.entry.id });
  assert.equal((await rmC).id, pl.entry.id);
  const w = await ask(a, 'wallet');
  assert.equal(w.inventory.find((i) => i.id === bed.inventory.id).placed, false, '회수 → 인벤토리로');
  assert.equal(w.inventory.find((i) => i.id === mug.inventory.id).slot, 1);
  assert.deepEqual(await ask(a, 'layout:lock', { on: true }), { ok: true, layoutLock: true });
  assert.equal((await ask(a, 'wallet')).layoutLock, true);
  assert.equal((await ask(c, 'layout:place', {})).error, 'no_item');
  assert.equal((await ask(a, 'edit:mode', { on: false })).editing, false);
});

// ── 브라우저 ────────────────────────────────────────────────────────
const hasChrome = Boolean(CHROME);
let puppeteer = null;
try { puppeteer = require('puppeteer-core'); } catch (_) { /* devDependency 없음 */ }

test('브라우저: 지갑 가구 탭(카테고리·카드·색 선택·구매) · 편집 모드 배치(초록/빨강·R 회전·Del 회수) · 침대 눕기(💤·회전) · 책상 소품 · 🛠 표시', { skip: !hasChrome || !puppeteer ? 'Chrome/puppeteer-core 없음' : false, timeout: 180000 }, async (t) => {
  const srv = await boot({ world: { study: { autoTick: false }, npc: { autoStart: false } } });
  t.after(() => srv.close());
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: CHROME_ARGS });
  t.after(() => browser.close());
  const errors = [];
  const open = async (nick) => {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewport({ width: 1300, height: 850 });
    await page.goto(pageUrl(srv), { waitUntil: 'networkidle0', timeout: 60000 });
    await page.waitForSelector('#login:not([hidden])', { timeout: 30000 });
    await page.type('#login-nick', nick);
    await page.click('#login-submit');
    await page.waitForFunction(() => window.NSM && window.NSM.scene.me, { timeout: 30000 });
    return page;
  };
  const page = await open('가구테스트');
  const me = [...srv.world.players.values()][0];
  await srv.world.store.adjustCoins('가구테스트', 300, 'study', Date.now());
  await srv.world.award('가구테스트', me.id, 1, 'study'); // 배지 갱신

  // 지갑 가구 탭: 카테고리 2개, 책상 카드 12 / 공용 11, 색 선택 후 구매
  await page.click('#btn-wallet');
  await page.waitForFunction(() => window.NSM.ui.wallet && document.querySelectorAll('#wallet-items .wallet-item').length === 12, { timeout: 5000 });
  assert.deepEqual(await page.$$eval('#wallet-cats button', (els) => els.map((b) => b.textContent)), ['책상 소품', '공용 가구']);
  await page.click('#wallet-items .wallet-item[data-item="mug"] .swatch[data-variant="green"]');
  await page.click('#wallet-items .wallet-item[data-item="mug"] .btn');
  await page.waitForFunction(() => /보유 1/.test(document.querySelector('#wallet-items .wallet-item[data-item="mug"] .count').textContent), { timeout: 5000 });
  await page.click('#wallet-items .wallet-item[data-item="fishbowl"] .btn');
  await page.waitForFunction(() => /보유 1/.test(document.querySelector('#wallet-items .wallet-item[data-item="fishbowl"] .count').textContent), { timeout: 5000 });
  await page.click('#wallet-cats button[data-cat="shared"]');
  await page.waitForFunction(() => document.querySelectorAll('#wallet-items .wallet-item').length === 11, { timeout: 5000 });
  await page.click('#wallet-items .wallet-item[data-item="bed"] .swatch[data-variant="blue"]');
  await page.click('#wallet-items .wallet-item[data-item="bed"] .btn');
  await page.waitForFunction(() => /보유 1/.test(document.querySelector('#wallet-items .wallet-item[data-item="bed"] .count').textContent), { timeout: 5000 });
  await page.click('#wallet-items .wallet-item[data-item="floor_lamp"] .btn');
  await page.waitForFunction(() => /보유 1/.test(document.querySelector('#wallet-items .wallet-item[data-item="floor_lamp"] .count').textContent), { timeout: 5000 });
  // 미리보기
  await page.click('#wallet-items .wallet-item[data-item="bed"] .furn-icon');
  await page.waitForSelector('#item-preview:not([hidden])');
  assert.match(await page.$eval('#preview-meta', (el) => el.textContent), /눕기 가능/);
  await page.click('#preview-close');
  await page.click('#wallet-close');
  const inv = await srv.world.store.listInventory('가구테스트');
  const mugId = inv.find((i) => i.itemId === 'mug').id;
  const fishId = inv.find((i) => i.itemId === 'fishbowl').id;
  assert.equal(inv.find((i) => i.itemId === 'mug').meta.variant, 'green');

  // 편집 모드: 🛠 → 편집 바 + 팔레트 2개, 머리 위 🛠
  await page.click('#btn-edit');
  await page.waitForSelector('#edit-bar:not([hidden])', { timeout: 5000 });
  await page.waitForFunction(() => document.querySelectorAll('#edit-palette .palette-item').length === 2, { timeout: 5000 });
  assert.equal(await page.evaluate(() => Boolean(window.NSM.scene.me.editMark)), true);
  assert.equal(me.editing, true);
  // 침대 배치: 벽 위는 빨강, 빈 바닥은 초록 → 클릭 → 서버 layout 1개, 충돌 반영
  await page.click('#edit-palette .palette-item[data-item="bed"]');
  await page.evaluate(() => { const f = window.NSM.scene.furniture; f.moveTo(1, 5); });
  assert.equal(await page.evaluate(() => window.NSM.scene.furniture.preview.ok), false);
  await page.evaluate(() => window.NSM.scene.furniture.moveTo(22, 14));
  assert.equal(await page.evaluate(() => window.NSM.scene.furniture.preview.ok), true);
  await page.keyboard.press('KeyR'); // 회전 → 가로
  await page.waitForFunction(() => window.NSM.scene.furniture.preview.rotation === 1, { timeout: 3000 });
  await sleep(200); // 같은 프레임에 들어온 키는 한 번으로 친다
  await page.keyboard.press('KeyR');
  await page.waitForFunction(() => window.NSM.scene.furniture.preview.rotation === 0, { timeout: 3000 });
  await page.evaluate(() => window.NSM.scene.confirmPlace());
  await page.waitForFunction(() => window.NSM.scene.furniture.entries.size === 1 && !window.NSM.scene.furniture.preview, { timeout: 5000 });
  assert.equal(srv.world.listLayout().length, 1);
  assert.equal(await page.evaluate(() => window.NSM.scene.furniture.collision[14][22]), true, '클라이언트 충돌 맵');
  assert.equal(await page.evaluate(() => window.NSM.scene.blockedAt(22.5 * 32, 14.5 * 32)), true);
  await page.waitForFunction(() => document.querySelectorAll('#edit-placed li[data-id]').length === 1, { timeout: 5000 });
  // 스탠드 조명: 배치 → 조명 추가, 선택 후 Del 회수
  await page.click('#edit-palette .palette-item[data-item="floor_lamp"]');
  await page.evaluate(() => window.NSM.scene.furniture.moveTo(26, 13));
  await page.evaluate(() => window.NSM.scene.confirmPlace());
  await page.waitForFunction(() => window.NSM.scene.furniture.entries.size === 2, { timeout: 5000 });
  assert.equal(await page.evaluate(() => window.NSM.scene.extraLights.length), 1);
  const lampEntry = srv.world.listLayout().find((e) => e.itemId === 'floor_lamp');
  await page.evaluate((id) => { const s = window.NSM.scene; s.furniture.select(id); }, lampEntry.id);
  await page.keyboard.press('Delete');
  await page.waitForFunction(() => window.NSM.scene.furniture.entries.size === 1, { timeout: 5000 });
  assert.equal(await page.evaluate(() => window.NSM.scene.extraLights.length), 0);
  await page.click('#edit-close');
  await page.waitForSelector('#edit-bar[hidden]', { timeout: 5000 });
  assert.equal(await page.evaluate(() => Boolean(window.NSM.scene.me.editMark)), false);

  // 침대에 눕기: 서버에서 앉히면 회전 없는 세로 침대 → 각도 0 · 💤 · 상태 휴식
  const bedEntry = srv.world.listLayout()[0];
  me.x = 22.5 * 32; me.y = 17 * 32;
  srv.world.sit(me, `f:${bedEntry.id}`);
  srv.io.emit('playerSat', { id: me.id, seatId: me.seatId, x: me.x, y: me.y, facing: me.facing, status: me.status });
  await page.waitForFunction(() => window.NSM.scene.me.lying && window.NSM.scene.me.zzz, { timeout: 5000 });
  assert.equal(await page.evaluate(() => window.NSM.scene.me.sprite.angle), 0);
  assert.equal(await page.evaluate(() => window.NSM.scene.me.lying.rect.h), 64);
  assert.equal(await page.$eval('#btn-status span', (el) => el.textContent), '휴식 중');
  srv.world.stand(me);
  srv.io.emit('playerStood', { id: me.id, status: me.status, x: me.x, y: me.y });
  await page.waitForFunction(() => !window.NSM.scene.me.lying, { timeout: 5000 });

  // 책상 소품: 설정에서 슬롯 장착 → 의자에 앉으면 책상 위에 2개
  await srv.world.equipDesk(me, [mugId, fishId, null]);
  await page.waitForFunction(() => window.NSM.scene.me.deskItems[0] && window.NSM.scene.me.deskItems[0].itemId === 'mug', { timeout: 5000 });
  await openSettings(page);
  await page.waitForFunction(() => document.querySelectorAll('#desk-slots select').length === 3 && document.querySelectorAll('#desk-slots select')[0].value !== '', { timeout: 5000 });
  await page.click('#btn-settings'); // 닫기
  const seat = srv.world.room.seats.find((s) => s.x === 15 && s.y === 14);
  me.x = 15.5 * 32; me.y = 15 * 32;
  srv.world.sit(me, seat.id);
  srv.io.emit('playerSat', { id: me.id, seatId: me.seatId, x: me.x, y: me.y, facing: me.facing, status: me.status });
  await page.waitForFunction(() => window.NSM.scene.me.deskSprites.length === 2, { timeout: 5000 });
  assert.deepEqual(await page.evaluate(() => window.NSM.scene.me.deskSprites.map((s) => [s.x, s.y, s.anims.isPlaying])), [[14.5 * 32, 13 * 32, false], [16.5 * 32, 13 * 32, true]], '뒷줄 책상 셀 · 어항은 애니');
  srv.world.stand(me);
  srv.io.emit('playerStood', { id: me.id, status: me.status, x: me.x, y: me.y });
  await page.waitForFunction(() => window.NSM.scene.me.deskSprites.length === 0, { timeout: 5000 });
  assert.deepEqual(errors, []);
});
