'use strict';
/**
 * 5단계 아바타 커스터마이징: 카탈로그 검증(없는 id → 기본값, 옛 정수 아바타 호환), avatar:update 브로드캐스트,
 * users.avatar 저장/복원(새 토큰 + 같은 닉네임 + 아바타 미전송 → 복원), 모든 레이어 PNG 존재·규격(32x64 프레임 4x4 시트).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { boot, connect, joinAs, ask, once, sleep } = require('./helpers');
const { catalog, schema, normalizeAvatar, DEFAULT_AVATAR, AVATAR_DIR, assetFiles } = require('../server/game/avatar');
const { World } = require('../server/game/world');
const { getStudyRoom } = require('../server/rooms/studyroom');
const { createMemoryStore } = require('../server/store/memory');

const room = getStudyRoom();

/** PNG 헤더에서 크기만 읽는다 (외부 의존 없이) */
function pngSize(file) {
  const buf = fs.readFileSync(file);
  assert.equal(buf.toString('latin1', 1, 4), 'PNG', `${file} 은 PNG 가 아님`);
  assert.equal(buf.toString('latin1', 12, 16), 'IHDR');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

test('아바타 카탈로그: 파츠·색상 수, 기본값이 유효한 id', () => {
  const L = catalog.layers;
  assert.ok(L.hair.items.length >= 10, `머리 모양 ${L.hair.items.length}종 (10 이상이어야 함)`);
  assert.ok(L.hair.items.some((it) => it.id === 'basic'), '기존 머리(basic) 포함');
  assert.ok(L.top.items.length >= 5, '상의: 기본 + 티셔츠·셔츠·후드·니트');
  assert.equal(L.acc.items.filter((it) => it.file !== null).length, 3, '안경 3종');
  assert.equal(L.acc.items[0].id, 'none');
  assert.equal(catalog.colors.skin.length, 6);
  assert.equal(catalog.colors.hairColor.length, 10);
  assert.equal(catalog.colors.topColor.length, 12);
  assert.equal(catalog.colors.bottomColor.length, 8);
  assert.equal(catalog.colors.shoesColor.length, 6);
  // 색상 옵션의 톤 수 = 레이어 기준 팔레트 수 (명암 단계 유지)
  for (const [name, layer] of Object.entries(L)) {
    if (!layer.colorField) continue;
    for (const c of catalog.colors[layer.colorField]) assert.equal(c.tones.length, layer.palette.length, `${name}/${c.id} 톤 수`);
  }
  assert.deepEqual(normalizeAvatar(DEFAULT_AVATAR), DEFAULT_AVATAR);
  assert.deepEqual(catalog.order, ['body', 'top', 'bottom', 'shoes', 'hair', 'acc']);
});

test('아바타 검증: 없는 id·잘못된 값 → 기본값, 옛 정수/{shirt} 아바타 → 상의 색, 여분 필드 제거', () => {
  assert.deepEqual(normalizeAvatar(undefined), DEFAULT_AVATAR);
  assert.deepEqual(normalizeAvatar(null), DEFAULT_AVATAR);
  assert.deepEqual(normalizeAvatar('bob'), DEFAULT_AVATAR);
  assert.deepEqual(normalizeAvatar({ hair: 'nope', hairColor: 42, top: null, acc: {} }), DEFAULT_AVATAR);
  const a = normalizeAvatar({ hair: 'twintail', hairColor: 'pink', top: 'hoodie', topColor: 'navy', acc: 'sunglasses', skin: 'tan', extra: 'x' });
  assert.deepEqual(a, { ...DEFAULT_AVATAR, hair: 'twintail', hairColor: 'pink', top: 'hoodie', topColor: 'navy', acc: 'sunglasses', skin: 'tan' });
  assert.equal('extra' in a, false);
  // 4단계까지: 0..3 = 흰색/앰버/세이지/블루 셔츠
  assert.equal(normalizeAvatar(0).topColor, 'white');
  assert.equal(normalizeAvatar(1).topColor, 'amber');
  assert.equal(normalizeAvatar(3).topColor, 'blue');
  assert.equal(normalizeAvatar(9).topColor, 'white');
  assert.deepEqual(normalizeAvatar({ shirt: 2 }), { ...DEFAULT_AVATAR, topColor: 'sage' });
  // key 는 필드 순서가 달라도 같다, random 은 항상 유효
  assert.equal(schema.key({ hairColor: 'pink', hair: 'bob' }), schema.key({ hair: 'bob', hairColor: 'pink' }));
  for (let i = 0; i < 20; i++) {
    const r = schema.random();
    assert.deepEqual(normalizeAvatar(r), r);
  }
});

test('월드: 아바타 변경은 users.avatar 에 저장되고, 아바타를 안 보낸 재입장에서 복원된다', async () => {
  const store = createMemoryStore();
  const w = new World(room, { store, npc: { autoStart: false }, study: { autoTick: false } });
  const a = w.join({ nickname: '민수', socketId: 's1', avatar: { hair: 'bun', hairColor: 'blue' } });
  await w.loadProfile(a.player);
  assert.equal(a.player.avatar.hair, 'bun');
  assert.equal((await store.getUser('민수')).avatar.hair, 'bun');
  w.setAvatar(a.player, { hair: 'cap', topColor: 'red' });
  await sleep(10);
  assert.deepEqual((await store.getUser('민수')).avatar, { ...DEFAULT_AVATAR, hair: 'cap', topColor: 'red' });
  w.remove(a.player.id);
  // 새 브라우저(토큰·localStorage 없음): avatar 없이 입장 → 저장된 것 복원
  const b = w.join({ nickname: '민수', socketId: 's2' });
  assert.deepEqual(b.player.avatar, DEFAULT_AVATAR);
  await w.loadProfile(b.player);
  assert.deepEqual(b.player.avatar, { ...DEFAULT_AVATAR, hair: 'cap', topColor: 'red' });
  // 옛 형식 { shirt } 도 복원 가능
  await store.upsertUser('영희', { avatar: { shirt: 3 } });
  const c = w.join({ nickname: '영희', socketId: 's3', avatar: null });
  await w.loadProfile(c.player);
  assert.equal(c.player.avatar.topColor, 'blue');
  await w.dispose();
});

test('소켓: avatar:update 는 ack 로 정규화된 값을 주고 본인 포함 모두에게 방송된다 · 입장 ack 에 복원된 아바타', async (t) => {
  const srv = await boot({ world: { graceMs: 200 } });
  t.after(() => srv.close());
  const a = connect(srv.port);
  const b = connect(srv.port);
  t.after(() => { a.close(); b.close(); });
  const ja = await joinAs(a, { nickname: '민수', avatar: { hair: 'long', hairColor: 'blonde', shoesColor: 'white' } });
  assert.equal(ja.self.avatar.hair, 'long');
  const jb = await joinAs(b, { nickname: '영희' });
  assert.equal(jb.players[0].avatar.hairColor, 'blonde');

  const seenA = once(a, 'avatar:update');
  const seenB = once(b, 'avatar:update');
  const res = await ask(a, 'avatar:update', { avatar: { hair: 'ponytail', acc: 'glasses_round', skin: 'deep', topColor: 'zzz' } });
  assert.equal(res.ok, true);
  assert.deepEqual(res.avatar, { ...DEFAULT_AVATAR, hair: 'ponytail', acc: 'glasses_round', skin: 'deep' });
  const [ua, ub] = await Promise.all([seenA, seenB]);
  assert.equal(ua.id, ja.self.id);
  assert.deepEqual(ua.avatar, res.avatar);
  assert.deepEqual(ub.avatar, res.avatar);
  // 완전히 잘못된 페이로드도 기본값으로 (거부하지 않는다)
  assert.deepEqual((await ask(a, 'avatar:update', { avatar: 'garbage' })).avatar, DEFAULT_AVATAR);
  assert.deepEqual((await ask(a, 'avatar:update', null)).avatar, DEFAULT_AVATAR);

  // A 가 나가고 같은 닉네임으로 아바타 없이 다시 입장 → 저장된 아바타(기본값으로 마지막 변경) 복원
  await ask(a, 'avatar:update', { avatar: { hair: 'beanie' } });
  await ask(a, 'leave', {});
  await sleep(50);
  const a2 = connect(srv.port);
  t.after(() => a2.close());
  const ja2 = await joinAs(a2, { nickname: '민수' });
  assert.equal(ja2.self.nickname, '민수');
  assert.equal(ja2.self.avatar.hair, 'beanie');
});

test('에셋: 카탈로그의 모든 레이어 PNG 가 있고 규격(4프레임 x 4방향, 32x64)이 맞는다', () => {
  const files = assetFiles();
  assert.ok(files.length >= 20, `레이어 PNG ${files.length}개`);
  const { width, height, framesPerRow, rows } = catalog.frame;
  assert.equal(width, 32);
  assert.equal(height, 64);
  assert.equal(framesPerRow, 4);
  assert.deepEqual(rows, { down: 0, right: 1, up: 2, left: 3 });
  for (const f of files) {
    assert.ok(fs.existsSync(f), `${path.relative(AVATAR_DIR, f)} 없음`);
    const size = pngSize(f);
    assert.deepEqual(size, { width: width * framesPerRow, height: height * 4 }, `${path.relative(AVATAR_DIR, f)} 크기`);
  }
  // 파츠 id 마다 파일이 하나씩 (none 제외)
  for (const [name, layer] of Object.entries(catalog.layers)) {
    for (const it of layer.items) {
      if (it.file === null) continue;
      assert.ok(files.includes(path.join(AVATAR_DIR, name, `${it.id}.png`)), `${name}/${it.id}`);
    }
  }
});
