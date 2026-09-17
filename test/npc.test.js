'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DogNpc, CUSHION, HOME, PET_COOLDOWN_MS } = require('../server/game/npc');
const { getStudyRoom } = require('../server/rooms/studyroom');
const { isBlocked } = require('../server/rooms/build');
const { boot, connect, joinAs, ask, once, sleep, collect } = require('./helpers');

const room = getStudyRoom();

/** 결정적 난수 (테스트 재현용) */
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function makeDog(seed = 7) {
  let t = 1000000;
  const dog = new DogNpc(room, { now: () => t, random: lcg(seed), tickMs: 100 });
  const advance = (ms) => {
    for (let i = 0; i < ms / 100; i++) {
      t += 100;
      dog.tick();
    }
  };
  return { dog, advance, now: () => t };
}

test('강아지 NPC: 오래 돌려도 벽·가구 안으로 들어가지 않고 맵 안에 머문다 (쿠션 제외)', () => {
  for (const seed of [1, 7, 42]) {
    const { dog, advance } = makeDog(seed);
    const states = new Set();
    const tiles = new Set();
    dog.on('update', (s) => {
      states.add(s.state);
      const tx = Math.floor(s.x / 32);
      const ty = Math.floor((s.y - 1) / 32);
      tiles.add(`${tx},${ty}`);
      const onCushion = tx === CUSHION.x && ty === CUSHION.y;
      assert.ok(onCushion || !isBlocked(room, tx, ty), `seed ${seed}: 강아지가 막힌 칸 (${tx},${ty}) 에 있음 (state ${s.state})`);
      assert.ok(tx >= 0 && ty >= 0 && tx < room.width && ty < room.height);
      assert.ok(['walk', 'idle', 'sit', 'sleep', 'look'].includes(s.state));
    });
    advance(20 * 60 * 1000); // 20분
    assert.ok(states.has('walk') && states.has('sit') && states.has('sleep') && states.has('idle'), `seed ${seed}: 상태 ${[...states]}`);
    assert.ok(tiles.size > 8, `seed ${seed}: 방문 타일 ${tiles.size}`);
    // 산책으로 라운지 밖도 다녀온다
    const outside = [...tiles].some((k) => {
      const [x, y] = k.split(',').map(Number);
      return x < HOME.x0 || x > HOME.x1 || y < HOME.y0 || y > HOME.y1;
    });
    assert.ok(outside, `seed ${seed}: 라운지 밖 산책 없음`);
    dog.dispose();
  }
});

test('강아지 NPC: 걷는 속도는 느리고(한 틱 이동 ≤ 6px), 걷는 동안 매 틱 스냅샷을 보낸다', () => {
  const { dog, advance } = makeDog(3);
  let prev = null;
  let walkTicks = 0;
  dog.on('update', (s) => {
    if (prev && s.state === 'walk' && prev.state === 'walk') {
      const d = Math.hypot(s.x - prev.x, s.y - prev.y);
      assert.ok(d <= 6.01, `한 틱에 ${d}px 이동`);
      walkTicks++;
    }
    prev = s;
  });
  advance(5 * 60 * 1000);
  assert.ok(walkTicks > 50);
  dog.dispose();
});

test('강아지 NPC: 플레이어가 가까이 오면 멈춰서 쳐다보고(look), 떠나면 복귀', () => {
  const { dog, advance } = makeDog(5);
  advance(3000);
  const players = [];
  dog.players = () => players;
  // 강아지 왼쪽 30px 에 플레이어
  players.push({ id: 'p1', nickname: 'A', x: dog.x - 30, y: dog.y, connected: true });
  advance(200);
  assert.equal(dog.state, 'look');
  assert.equal(dog.facing, 'left');
  const { x, y } = dog;
  advance(3000);
  assert.deepEqual({ x: dog.x, y: dog.y }, { x, y }, '쳐다보는 동안 움직이지 않음');
  players.length = 0;
  advance(2000);
  assert.notEqual(dog.state, 'look');
  dog.dispose();
});

test('강아지 NPC: 쓰다듬기 — 거리 검사, 3초 쿨다운, 이벤트', () => {
  const { dog, advance, now } = makeDog(9);
  const pets = [];
  dog.on('pet', (e) => pets.push(e));
  const far = { id: 'p', nickname: '민수', x: dog.x + 200, y: dog.y };
  assert.equal(dog.pet(far).error, 'too_far');
  const near = { id: 'p', nickname: '민수', x: dog.x + 20, y: dog.y };
  assert.equal(dog.pet(near).ok, true);
  assert.equal(dog.facing, 'right');
  assert.equal(dog.pet(near).error, 'cooldown');
  advance(PET_COOLDOWN_MS - 100);
  assert.equal(dog.pet(near).error, 'cooldown');
  advance(200);
  assert.equal(dog.pet(near).ok, true);
  assert.deepEqual(pets, [{ by: '민수', id: 'p', reaction: '❤️', highFive: false }, { by: '민수', id: 'p', reaction: '❤️', highFive: false }]);
  assert.ok(now() > 0);
  dog.dispose();
});

test('강아지 NPC: 이름 변경 (기본 "사랑", 8자, 닉네임과 같은 문자 규칙)', () => {
  const { dog } = makeDog(1);
  assert.equal(dog.name, '사랑');
  assert.equal(dog.snapshot().name, '사랑');
  const names = [];
  dog.on('name', (n) => names.push(n));
  assert.equal(dog.setName('  초코 ').name, '초코');
  assert.equal(dog.setName('').ok, false);
  assert.equal(dog.setName('아홉글자이름입니다').ok, false);
  assert.equal(dog.setName('<b>').ok, false);
  assert.equal(dog.setName('Mochi 2').ok, true);
  assert.deepEqual(names, ['초코', 'Mochi 2']);
  dog.dispose();
});

test('소켓 E2E: 두 클라이언트가 같은 npc:update 를 받고, 쓰다듬기·이름 변경이 모두에게 간다', async (t) => {
  const srv = await boot({ world: { npc: { tickMs: 50 } } });
  t.after(() => srv.close());
  const a = connect(srv.port);
  const b = connect(srv.port);
  t.after(() => { a.close(); b.close(); });
  const ja = await joinAs(a, { nickname: '민수' });
  const jb = await joinAs(b, { nickname: '영희' });
  assert.equal(ja.npcs.length, 1);
  assert.equal(ja.npcs[0].id, 'dog');
  assert.equal(ja.npcs[0].name, '사랑');
  assert.deepEqual(jb.npcs[0], srv.world.dog.snapshot());

  const seenA = collect(a, 'npc:update');
  const seenB = collect(b, 'npc:update');
  await sleep(1500);
  assert.ok(seenA.length >= 1, 'npc:update 를 받아야 함 (1초 키프레임 포함)');
  await sleep(50);
  assert.equal(seenA.length, seenB.length, '두 클라이언트가 같은 수의 업데이트를 받음');
  for (let i = 0; i < seenA.length; i++) assert.deepEqual(seenA[i], seenB[i]);
  const last = seenA.at(-1);
  assert.equal(last.id, 'dog');
  assert.ok(Number.isFinite(last.x) && Number.isFinite(last.y));

  // 쓰다듬기: 멀면 거부, 서버 위치를 강아지 옆으로 옮긴 뒤 성공 → npc:pet + 시스템 채팅, 쿨다운
  assert.equal((await ask(a, 'npc:pet', { id: 'dog' })).error, 'too_far');
  assert.equal((await ask(a, 'npc:pet', { id: 'cat' })).error, 'no_npc');
  const pa = srv.world.players.get(ja.self.id);
  pa.x = srv.world.dog.x + 24;
  pa.y = srv.world.dog.y;
  const petSeen = once(b, 'npc:pet');
  const chatSeen = once(b, 'chat');
  assert.equal((await ask(a, 'npc:pet', { id: 'dog' })).ok, true);
  const pet = await petSeen;
  assert.equal(pet.id, 'dog');
  assert.equal(pet.by, '민수');
  assert.equal(pet.playerId, ja.self.id);
  const chat = await chatSeen;
  assert.equal(chat.system, true);
  assert.equal(chat.text, '민수님이 사랑을(를) 쓰다듬었어요');
  assert.equal((await ask(a, 'npc:pet', { id: 'dog' })).error, 'cooldown');

  // 이름 변경
  const nameSeen = once(b, 'npc:name');
  assert.equal((await ask(a, 'npc:name', { id: 'dog', name: '초코' })).name, '초코');
  assert.deepEqual(await nameSeen, { id: 'dog', name: '초코' });
  assert.equal((await ask(a, 'npc:name', { id: 'dog', name: '' })).ok, false);
  const c = connect(srv.port);
  t.after(() => c.close());
  assert.equal((await joinAs(c, { nickname: 'C' })).npcs[0].name, '초코');
});
