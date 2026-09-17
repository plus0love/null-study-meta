'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, connect, joinAs, ask, once, sleep, collect } = require('./helpers');

test('소켓 E2E: 입장/중복 닉네임/다른 접속자 목록/이동 중계/퇴장', async (t) => {
  const srv = await boot({ world: { graceMs: 200 } });
  t.after(() => srv.close());
  const a = connect(srv.port);
  const b = connect(srv.port);
  t.after(() => { a.close(); b.close(); });

  // 입장 전에는 게임 이벤트 거부
  assert.equal((await ask(a, 'chat', { text: 'x' })).error, 'not_joined');

  const ja = await joinAs(a, { nickname: '민수', avatar: 1 });
  assert.equal(ja.ok, true);
  assert.equal(ja.resumed, false);
  assert.equal(ja.self.nickname, '민수');
  assert.equal(ja.self.avatar.topColor, 'amber'); // 옛 정수 아바타(1) → 상의 색
  assert.deepEqual(ja.players, []);
  assert.equal(ja.config.speed, 150);
  assert.equal(ja.config.emojis.length, 6);
  assert.equal(ja.pomodoro.running, false);
  assert.ok(Math.abs(ja.serverTime - Date.now()) < 2000);
  assert.ok(ja.token);

  const joinedSeen = once(a, 'playerJoined');
  const jb = await joinAs(b, { nickname: '민수' });
  assert.equal(jb.self.nickname, '민수2');
  assert.equal(jb.players.length, 1);
  assert.equal(jb.players[0].nickname, '민수');
  assert.equal((await joinedSeen).player.nickname, '민수2');
  assert.equal((await joinAs(a, { nickname: 'x' })).error, 'already_joined');

  const h = await fetch(`http://127.0.0.1:${srv.port}/healthz`).then((r) => r.json());
  assert.equal(h.players, 2);

  // 이동: 발신자에게는 되돌아오지 않고, 다른 사람에게만 간다
  const echoed = collect(a, 'playerMoved');
  const corrections = collect(a, 'move:correct');
  const moved = once(b, 'playerMoved');
  a.emit('move', { x: ja.self.x, y: ja.self.y - 6, facing: 'up', moving: true });
  const m = await moved;
  assert.equal(m.id, ja.self.id);
  assert.equal(m.y, ja.self.y - 6);
  assert.equal(m.facing, 'up');
  assert.equal(m.moving, true);
  await sleep(50);
  assert.equal(echoed.length, 0);
  assert.equal(corrections.length, 0);

  // 순간이동 → 본인에게만 move:correct, 다른 사람은 못 봄
  const bMoves = collect(b, 'playerMoved');
  const corr = once(a, 'move:correct');
  a.emit('move', { x: ja.self.x + 800, y: ja.self.y - 6, facing: 'right', moving: true });
  const c = await corr;
  assert.equal(c.reason, 'too_fast');
  assert.equal(c.x, ja.self.x);
  assert.equal(c.y, ja.self.y - 6);
  await sleep(50);
  assert.equal(bMoves.length, 0);

  // 벽 안으로 → blocked
  const corr2 = once(a, 'move:correct');
  a.emit('move', { x: 21.5 * 32, y: 26 * 32, facing: 'down', moving: true });
  assert.equal((await corr2).reason, 'blocked');

  // 퇴장(leave) → 즉시 playerLeft
  const left = once(a, 'playerLeft');
  await ask(b, 'leave');
  const l = await left;
  assert.equal(l.id, jb.self.id);
  assert.equal(l.reason, 'leave');
});

test('소켓 E2E: 좌석 점유 (E키 앉기/일어나기), 상태, 아바타', async (t) => {
  const srv = await boot();
  t.after(() => srv.close());
  const a = connect(srv.port);
  const b = connect(srv.port);
  t.after(() => { a.close(); b.close(); });
  const ja = await joinAs(a, { nickname: 'A' });
  const jb = await joinAs(b, { nickname: 'B' });
  const seat = srv.world.room.seats[0];
  const cx = (seat.x + 0.5) * 32;
  const cy = (seat.y + 1) * 32;

  // 서버 위치를 좌석 옆으로 강제 (이동 검증을 우회하는 테스트용 셋업)
  const pa = srv.world.players.get(ja.self.id);
  pa.x = cx + 32;
  pa.y = cy;
  assert.equal((await ask(a, 'sit', { seatId: seat.id })).error, undefined);
  assert.equal(pa.seatId, seat.id);

  const satSeen = once(b, 'playerSat');
  await ask(a, 'stand');
  const stood = await once(b, 'playerStood');
  assert.equal(stood.status, 'rest');
  // 다시 앉고 B 가 같은 자리에 시도 → occupied
  const sit2 = await ask(a, 'sit', { seatId: seat.id });
  assert.equal(sit2.ok, true);
  assert.equal(sit2.status, 'study');
  const s = await satSeen;
  assert.equal(s.seatId, seat.id);
  const pb = srv.world.players.get(jb.self.id);
  pb.x = cx;
  pb.y = cy;
  assert.equal((await ask(b, 'sit', { seatId: seat.id })).error, 'occupied');
  assert.equal((await ask(b, 'sit', { seatId: 'nope' })).error, 'no_seat');
  // 앉은 채로 move → seated 보정
  const corr = once(a, 'move:correct');
  a.emit('move', { x: cx + 3, y: cy, facing: 'down', moving: true });
  assert.equal((await corr).reason, 'seated');

  // 상태 토글 브로드캐스트
  const st = once(b, 'playerStatus');
  assert.equal((await ask(a, 'status', { status: 'rest' })).ok, true);
  assert.equal((await st).status, 'rest');
  assert.equal((await ask(a, 'status', { status: 'zzz' })).ok, false);
  // 아바타 변경 (파츠 객체) → 모두에게 avatar:update. 없는 id 는 기본값으로
  const av = once(b, 'avatar:update');
  const upd = await ask(a, 'avatar:update', { avatar: { hair: 'bob', hairColor: 'pink', top: 'nope' } });
  assert.equal(upd.ok, true);
  assert.equal(upd.avatar.top, 'basic');
  assert.deepEqual((await av).avatar, upd.avatar);
  assert.equal((await av).avatar.hair, 'bob');

  // A 가 끊기면(유예 없이 leave) 자리 해제
  await ask(a, 'leave');
  assert.deepEqual(srv.world.seatSnapshot(), {});
  assert.equal((await ask(b, 'sit', { seatId: seat.id })).ok, true);
});

test('소켓 E2E: 채팅(이스케이프·200자·도배), 이모지', async (t) => {
  const srv = await boot();
  t.after(() => srv.close());
  const a = connect(srv.port);
  const b = connect(srv.port);
  t.after(() => { a.close(); b.close(); });
  const ja = await joinAs(a, { nickname: 'A' });
  await joinAs(b, { nickname: 'B' });

  const gotB = once(b, 'chat');
  const gotA = once(a, 'chat');
  assert.equal((await ask(a, 'chat', { text: '<img src=x onerror=1> 안녕' })).ok, true);
  const m = await gotB;
  assert.equal(m.id, ja.self.id);
  assert.equal(m.nickname, 'A');
  assert.equal(m.text, '&lt;img src=x onerror=1&gt; 안녕');
  assert.equal((await gotA).text, m.text); // 본인도 받는다
  assert.equal((await ask(a, 'chat', { text: 'spam' })).error, 'too_fast');
  await sleep(320);
  assert.equal((await ask(a, 'chat', { text: 'a'.repeat(201) })).error, 'too_long');
  assert.equal((await ask(a, 'chat', { text: '   ' })).error, 'empty');
  assert.equal((await ask(a, 'chat', { text: 'ok' })).ok, true);

  const em = once(b, 'playerEmoji');
  assert.equal((await ask(a, 'emoji', { index: 5 })).ok, true);
  assert.deepEqual(await em, { id: ja.self.id, emoji: '🔥' });
  assert.equal((await ask(a, 'emoji', { index: 6 })).ok, false);
});

test('소켓 E2E: 개인 뽀모도로 — 내 타이머만 받고, 각자 따로 돌고, 자동 전환, 서버 시각 동기화', async (t) => {
  const srv = await boot({ world: { pomodoro: { focusMs: 120, breakMs: 80 } } });
  t.after(() => srv.close());
  const a = connect(srv.port);
  const b = connect(srv.port);
  t.after(() => { a.close(); b.close(); });
  await joinAs(a, { nickname: 'A' });
  const jb = await joinAs(b, { nickname: 'B' });
  assert.equal(jb.pomodoro.running, false);

  const pong = await ask(a, 'time:ping', { t0: 42 });
  assert.equal(pong.t0, 42);
  assert.ok(Math.abs(pong.serverTime - Date.now()) < 1000);

  const seenB = collect(b, 'pomodoro');
  const seenA = collect(a, 'pomodoro');
  const s = await ask(a, 'pomodoro:start');
  assert.equal(s.ok, true);
  assert.equal(s.running, true);
  assert.equal(s.phase, 'focus');
  assert.equal(s.startedBy, 'A');
  assert.equal(s.endsAt - s.startedAt, 120);
  assert.equal((await ask(a, 'pomodoro:start')).error, 'running'); // 내 것은 이미 실행 중
  assert.equal((await ask(b, 'pomodoro:start')).ok, true); // B 는 자기 타이머를 따로 시작
  assert.equal((await ask(b, 'pomodoro:stop')).ok, true);
  assert.equal((await ask(b, 'pomodoro:stop')).error, 'not_running');
  await once(a, 'pomodoro', { filter: (p) => p.phase === 'break' });
  await once(a, 'pomodoro', { filter: (p) => p.phase === 'focus' && p.running });
  const stopped = await ask(a, 'pomodoro:stop');
  assert.equal(stopped.ok, true);
  assert.equal(stopped.running, false);
  await sleep(50);
  assert.ok(seenA.length >= 3, 'A 는 자기 타이머의 시작·전환·정지를 받는다');
  assert.ok(seenB.every((p) => p.startedBy === 'B'), 'B 에게는 A 의 타이머 이벤트가 오지 않는다');
  // 새로 들어온 사람은 자기(비어 있는) 타이머를 받는다
  const c = connect(srv.port);
  t.after(() => c.close());
  const jc = await joinAs(c, { nickname: 'C' });
  assert.equal(jc.pomodoro.running, false);
});

test('소켓 E2E: 재접속 — 같은 토큰이면 기존 플레이어를 이어받고 옛 소켓은 즉시 정리, 유예 지나면 퇴장', async (t) => {
  const srv = await boot({ world: { graceMs: 250 } });
  t.after(() => srv.close());
  const a = connect(srv.port);
  const b = connect(srv.port);
  t.after(() => { a.close(); b.close(); });
  const ja = await joinAs(a, { nickname: 'A' });
  await joinAs(b, { nickname: 'B' });
  const seat = srv.world.room.seats[0];
  const pa = srv.world.players.get(ja.self.id);
  pa.x = (seat.x + 0.5) * 32;
  pa.y = (seat.y + 1) * 32;
  await ask(a, 'sit', { seatId: seat.id });

  // 1) 옛 소켓이 살아 있는 채로 같은 토큰으로 새 연결 → 옛 소켓 강제 종료
  const a2 = connect(srv.port);
  t.after(() => a2.close());
  const oldClosed = new Promise((r) => a.on('disconnect', r));
  const reconSeen = once(b, 'playerReconnected');
  const j2 = await joinAs(a2, { nickname: '다른이름', token: ja.token });
  assert.equal(j2.ok, true);
  assert.equal(j2.resumed, true);
  assert.equal(j2.self.id, ja.self.id);
  assert.equal(j2.self.nickname, 'A');
  assert.equal(j2.self.seatId, seat.id);
  assert.equal(j2.token, ja.token);
  assert.equal((await reconSeen).id, ja.self.id);
  await oldClosed;
  assert.equal(srv.world.connectedCount, 2);
  assert.equal(srv.world.listPlayers().length, 2);

  // 2) 끊김 → 유예 안에 재접속하면 playerLeft 없이 유지
  const lefts = collect(b, 'playerLeft');
  const disc = once(b, 'playerDisconnected');
  a2.close();
  assert.equal((await disc).id, ja.self.id);
  await sleep(100);
  const a3 = connect(srv.port);
  t.after(() => a3.close());
  const j3 = await joinAs(a3, { nickname: 'A', token: ja.token });
  assert.equal(j3.resumed, true);
  assert.equal(lefts.length, 0);

  // 3) 유예가 지나면 퇴장 + 자리 해제
  a3.close();
  const gone = await once(b, 'playerLeft', { timeout: 2000 });
  assert.equal(gone.id, ja.self.id);
  assert.equal(gone.reason, 'timeout');
  assert.deepEqual(srv.world.seatSnapshot(), {});
  // 이제 그 토큰은 새 입장 처리
  const a4 = connect(srv.port);
  t.after(() => a4.close());
  const j4 = await joinAs(a4, { nickname: 'A', token: ja.token });
  assert.equal(j4.resumed, false);
  assert.notEqual(j4.token, ja.token);
});
