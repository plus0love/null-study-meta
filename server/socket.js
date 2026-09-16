'use strict';
/**
 * Socket.io 배선. 프로토콜 (클라이언트 → 서버는 ack 콜백으로 결과를 돌려준다):
 *   join      { nickname, token?, avatar? }  → ack { ok, self, token, players, seats, pomodoro, config, serverTime, resumed } | { ok:false, error }
 *   move      { x, y, facing, moving }       → 다른 사람에게 playerMoved. 거부 시 본인에게만 move:correct { x, y, reason }
 *   sit       { seatId } / stand             → ack { ok, error? }, 모두에게 playerSat / playerStood
 *   status    { status: 'study'|'rest' }     → 모두에게 playerStatus
 *   interact  { id }                         → ack { ok, kind, status?, error? }. coffee 면 모두에게 playerStatus (status 'coffee')
 *   listening { title|null }                 → 모두에게 playerListening { id, listening }
 *   avatar    { avatar }                     → 모두에게 playerAvatar
 *   chat      { text }                       → ack { ok, error? }, 모두에게 chat { id, nickname, text, ts }
 *   emoji     { index }                      → 모두에게 playerEmoji { id, emoji }
 *   pomodoro:start / pomodoro:stop           → 모두에게 pomodoro { ...snapshot }
 *   time:ping { t0 }                         → ack { t0, serverTime }
 *   leave                                    → 즉시 정리 (유예 없음)
 *   npc:pet   { id }                         → ack { ok, error? }, 모두에게 npc:pet { id, by, nickname } + 시스템 chat
 *   npc:name  { id, name }                   → ack { ok, name?, error? }, 모두에게 npc:name { id, name } (users.dog_name 에 저장)
 *   stats                                    → ack { ok, store, tz, date, rows: [{ nickname, todaySeconds, weekSeconds, streak, weekDays, live, online }] }
 *   goal:set  { text, targetMinutes }        → ack { ok, goal, reached } , 모두에게 playerGoal { id, goal }
 *   todo:list / todo:add { text } / todo:toggle { id, done } / todo:delete { id } → ack (본인 닉네임의 할 일, 이월 carried 포함)
 * 서버 → npc:update { id, kind, name, x, y, facing, state } (10Hz, 바뀔 때)
 * 서버 → leaderboard:refresh { nickname, seconds } (세션 저장 시), attendance { streak, weekDays } (본인에게, 출석 기록 시),
 *        goalReached { id, nickname } + 시스템 chat (오늘 목표 달성)
 * 입장 ack 에 profile { goal, streak }, store('memory'|'supabase'), tz 가 포함된다.
 * 서버 → 클라이언트 알림: playerJoined { player }, playerLeft { id, nickname, reason }, playerReconnected { id }, playerDisconnected { id }
 */
const { Server } = require('socket.io');
const { World } = require('./game/world');

function attachSocket(httpServer, { room, world: worldOpts = {}, log = console } = {}) {
  const io = new Server(httpServer, {
    serveClient: true,
    pingInterval: 10000,
    pingTimeout: 8000,
    maxHttpBufferSize: 16 * 1024,
  });
  const world = new World(room, worldOpts);

  world.on('playerLeft', (player, reason) => {
    io.emit('playerLeft', { id: player.id, nickname: player.nickname, reason });
    io.emit('roomCount', { count: world.connectedCount });
  });
  world.on('pomodoro', (snap) => io.emit('pomodoro', snap));
  world.on('npcUpdate', (snap) => io.emit('npc:update', snap));
  world.on('npcPet', ({ npc, by, playerId, name }) => {
    io.emit('npc:pet', { id: npc, by, playerId });
    io.emit('chat', { system: true, text: `${by}님이 강아지를 쓰다듬었어요`, ts: world.now() });
  });
  world.on('npcName', ({ npc, name }) => io.emit('npc:name', { id: npc, name }));
  world.on('sessionSaved', ({ nickname, seconds }) => io.emit('leaderboard:refresh', { nickname, seconds }));
  world.on('attendance', ({ playerId, streak, weekDays, inserted }) => {
    const p = world.players.get(playerId);
    if (!p || !inserted) return;
    io.sockets.sockets.get(p.socketId)?.emit('attendance', { streak, weekDays });
    io.emit('leaderboard:refresh', { nickname: p.nickname, seconds: 0 });
  });
  world.on('goalReached', ({ nickname, playerId }) => {
    io.emit('goalReached', { id: playerId, nickname });
    io.emit('chat', { system: true, text: `${nickname}님이 오늘 목표를 달성했어요 🎉`, ts: world.now() });
  });

  const ackOf = (cb) => (typeof cb === 'function' ? cb : () => {});

  io.on('connection', (socket) => {
    let player = null;

    const requirePlayer = (fn) => (payload, cb) => {
      if (!player || player.socketId !== socket.id) return ackOf(cb)({ ok: false, error: 'not_joined' });
      return fn(payload, ackOf(cb));
    };

    socket.on('join', async (payload, cb) => {
      const ack = ackOf(cb);
      if (player) return ack({ ok: false, error: 'already_joined' });
      const res = world.join({ ...(payload || {}), socketId: socket.id });
      if (!res.ok) return ack({ ok: false, error: res.error });
      player = res.player;
      // 같은 토큰으로 온 새 연결 → 옛 소켓은 즉시 정리 (옛 소켓의 disconnect 핸들러는 socketId 가 달라 무시된다)
      if (res.oldSocketId) io.sockets.sockets.get(res.oldSocketId)?.disconnect(true);
      const profile = await world.loadProfile(player); // 오늘 목표 · 출석 스트릭 (저장소)
      if (!socket.connected || player.socketId !== socket.id) return; // 기다리는 사이 끊김
      ack({
        ok: true,
        resumed: res.resumed,
        token: player.token,
        self: world.publicPlayer(player),
        players: world.listPlayers().filter((p) => p.id !== player.id),
        seats: world.seatSnapshot(),
        pomodoro: world.pomodoro.snapshot(),
        npcs: world.npcSnapshots(),
        config: world.config,
        serverTime: world.now(),
        profile,
        store: world.store.kind,
        tz: world.tz,
      });
      if (res.resumed) socket.broadcast.emit('playerReconnected', { id: player.id, player: world.publicPlayer(player) });
      else socket.broadcast.emit('playerJoined', { player: world.publicPlayer(player) });
      io.emit('roomCount', { count: world.connectedCount });
      log.log(`[socket] ${res.resumed ? '재접속' : '입장'} ${player.nickname} (${player.id})`);
    });

    socket.on('move', requirePlayer((payload) => {
      const res = world.move(player, payload);
      if (!res.ok) {
        socket.emit('move:correct', { x: res.x, y: res.y, reason: res.reason });
        return;
      }
      // 발신자에게는 되돌려 보내지 않는다
      socket.broadcast.emit('playerMoved', { id: player.id, x: player.x, y: player.y, facing: player.facing, moving: player.moving });
    }));

    socket.on('sit', requirePlayer((payload, ack) => {
      const res = world.sit(player, payload && payload.seatId);
      if (!res.ok) return ack({ ok: false, error: res.error });
      ack({ ok: true, x: player.x, y: player.y, facing: player.facing, status: player.status });
      io.emit('playerSat', { id: player.id, seatId: player.seatId, x: player.x, y: player.y, facing: player.facing, status: player.status });
    }));

    socket.on('stand', requirePlayer((_payload, ack) => {
      const res = world.stand(player);
      if (!res.ok) return ack({ ok: false, error: res.error });
      ack({ ok: true, status: player.status });
      io.emit('playerStood', { id: player.id, status: player.status, x: player.x, y: player.y });
    }));

    socket.on('status', requirePlayer((payload, ack) => {
      const res = world.setStatus(player, payload && payload.status);
      if (!res.ok) return ack(res);
      ack({ ok: true });
      io.emit('playerStatus', { id: player.id, status: player.status });
    }));

    socket.on('interact', requirePlayer((payload, ack) => {
      const res = world.interact(player, payload && payload.id);
      ack(res);
      if (res.ok && res.status) io.emit('playerStatus', { id: player.id, status: player.status });
    }));

    socket.on('listening', requirePlayer((payload, ack) => {
      const res = world.setListening(player, payload ? payload.title : null);
      ack(res);
      if (res.ok) io.emit('playerListening', { id: player.id, listening: player.listening });
    }));

    socket.on('avatar', requirePlayer((payload, ack) => {
      const res = world.setAvatar(player, payload && payload.avatar);
      if (!res.ok) return ack(res);
      ack({ ok: true });
      io.emit('playerAvatar', { id: player.id, avatar: player.avatar });
    }));

    socket.on('chat', requirePlayer((payload, ack) => {
      const res = world.chat(player, payload && payload.text);
      if (!res.ok) return ack({ ok: false, error: res.error });
      ack({ ok: true });
      io.emit('chat', { id: player.id, nickname: player.nickname, text: res.text, ts: res.ts });
    }));

    socket.on('emoji', requirePlayer((payload, ack) => {
      const emoji = world.emoji(payload && payload.index);
      if (!emoji) return ack({ ok: false, error: 'invalid' });
      ack({ ok: true });
      io.emit('playerEmoji', { id: player.id, emoji });
    }));

    socket.on('pomodoro:start', requirePlayer((_p, ack) => {
      ack({ ok: world.pomodoro.start(player.nickname) });
    }));
    socket.on('pomodoro:stop', requirePlayer((_p, ack) => {
      ack({ ok: world.pomodoro.stop(player.nickname) });
    }));

    socket.on('npc:pet', requirePlayer((payload, ack) => {
      const npc = world.npcById(payload && payload.id);
      if (!npc) return ack({ ok: false, error: 'no_npc' });
      ack(npc.pet(player));
    }));

    socket.on('npc:name', requirePlayer((payload, ack) => {
      const npc = world.npcById(payload && payload.id);
      if (!npc) return ack({ ok: false, error: 'no_npc' });
      ack(world.setDogName(player, payload && payload.name));
    }));

    // ── 공부 기록: 랭킹 · 오늘 목표 · 할 일 (영구 저장소) ────────────────
    const safe = (fn) => async (payload, ack) => {
      try {
        ack(await fn(payload));
      } catch (err) {
        log.warn(`[socket] 저장소 오류: ${err.message}`);
        ack({ ok: false, error: 'store_error' });
      }
    };
    socket.on('stats', requirePlayer(safe(() => world.stats())));
    socket.on('goal:set', requirePlayer(safe(async (payload) => {
      const res = await world.setGoal(player, payload || {});
      if (res.ok) io.emit('playerGoal', { id: player.id, goal: res.goal });
      return res;
    })));
    socket.on('todo:list', requirePlayer(safe(async () => ({ ok: true, todos: await world.listTodos(player) }))));
    socket.on('todo:add', requirePlayer(safe((payload) => world.addTodo(player, payload && payload.text))));
    socket.on('todo:toggle', requirePlayer(safe((payload) => world.setTodoDone(player, payload && payload.id, payload && payload.done))));
    socket.on('todo:delete', requirePlayer(safe((payload) => world.deleteTodo(player, payload && payload.id))));

    socket.on('time:ping', (payload, cb) => {
      ackOf(cb)({ t0: payload && payload.t0, serverTime: world.now() });
    });

    socket.on('leave', requirePlayer((_p, ack) => {
      const id = player.id;
      player = null;
      world.remove(id, 'leave');
      ack({ ok: true });
    }));

    socket.on('disconnect', () => {
      if (!player || player.socketId !== socket.id) return;
      world.disconnect(player);
      socket.broadcast.emit('playerDisconnected', { id: player.id });
      io.emit('roomCount', { count: world.connectedCount });
      player = null;
    });
  });

  return { io, world };
}

module.exports = { attachSocket };
