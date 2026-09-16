'use strict';
/**
 * 인위적 지연 300ms (TCP 프록시, 왕복 600ms) 에서 두 명이 접속해 20Hz 로 이동해도
 * 서버가 이동을 거부(move:correct)하지 않고, 상대에게 위치가 그대로 전달되는지 확인한다.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, connect, joinAs, once, sleep, collect, startDelayProxy } = require('./helpers');

test('지연 300ms: 두 명 접속 후 20Hz 이동이 거부 없이 유지된다', async (t) => {
  const srv = await boot();
  t.after(() => srv.close());
  const proxy = await startDelayProxy(srv.port, 300);
  t.after(() => proxy.close());

  const a = connect(proxy.port, { timeout: 10000 });
  const b = connect(proxy.port, { timeout: 10000 });
  t.after(() => { a.close(); b.close(); });

  const t0 = Date.now();
  const ja = await joinAs(a, { nickname: '느린A' });
  assert.equal(ja.ok, true);
  assert.ok(Date.now() - t0 >= 500, `왕복 지연이 적용되어야 함 (${Date.now() - t0}ms)`);
  const jb = await joinAs(b, { nickname: '느린B' });
  assert.equal(jb.players.length, 1);
  assert.equal(jb.players[0].nickname, '느린A');

  const corrections = collect(a, 'move:correct');
  const seenByB = collect(b, 'playerMoved');
  const seenByA = collect(a, 'playerMoved');

  // A: 위로 2초 (20Hz × 7.5px = 150px/s), B: 왼쪽으로 1초 — 클라이언트와 같은 방식으로 절대 좌표 전송
  const speed = ja.config.speed;
  const step = speed / ja.config.sendHz;
  const posA = { x: ja.self.x, y: ja.self.y };
  const posB = { x: jb.self.x, y: jb.self.y };
  const ticksA = 40;
  const ticksB = 20;
  for (let i = 0; i < ticksA; i++) {
    posA.y -= step;
    a.emit('move', { x: posA.x, y: posA.y, facing: 'up', moving: i < ticksA - 1 });
    if (i < ticksB) {
      posB.x -= step;
      b.emit('move', { x: posB.x, y: posB.y, facing: 'left', moving: i < ticksB - 1 });
    }
    await sleep(1000 / ja.config.sendHz);
  }

  // 마지막 패킷이 지연을 거쳐 도착할 때까지 기다린다
  await sleep(900);
  assert.equal(corrections.length, 0, `거부된 이동: ${JSON.stringify(corrections.slice(0, 3))}`);
  assert.ok(seenByB.length >= ticksA * 0.9, `B 가 받은 A 이동 ${seenByB.length}/${ticksA}`);
  assert.ok(seenByA.length >= ticksB * 0.9, `A 가 받은 B 이동 ${seenByA.length}/${ticksB}`);
  const lastA = seenByB.at(-1);
  assert.equal(lastA.id, ja.self.id);
  assert.equal(lastA.x, posA.x);
  assert.equal(lastA.y, posA.y);
  assert.equal(lastA.moving, false);
  const lastB = seenByA.at(-1);
  assert.equal(lastB.x, posB.x);
  assert.equal(lastB.y, posB.y);

  // 서버 상태도 같은 위치
  const sa = srv.world.players.get(ja.self.id);
  assert.deepEqual({ x: sa.x, y: sa.y }, posA);
  assert.equal(sa.facing, 'up');
  // 새로 들어온 C 는 두 사람의 최종 위치를 받는다
  const c = connect(srv.port);
  t.after(() => c.close());
  const jc = await joinAs(c, { nickname: 'C' });
  const fromC = Object.fromEntries(jc.players.map((p) => [p.nickname, { x: p.x, y: p.y }]));
  assert.deepEqual(fromC['느린A'], posA);
  assert.deepEqual(fromC['느린B'], posB);

  // 지연 중 채팅도 정상 왕복
  const chat = once(b, 'chat', { timeout: 3000 });
  a.emit('chat', { text: '지연 테스트' });
  assert.equal((await chat).text, '지연 테스트');
});
