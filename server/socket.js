'use strict';
/**
 * Socket.io 배선. 프로토콜 (클라이언트 → 서버는 ack 콜백으로 결과를 돌려준다):
 *   join      { nickname, token?, avatar?, password? } → ack { ok, self, token, players, seats, pomodoro, config, serverTime, resumed } | { ok:false, error, remaining?, retryAfterMs? }
 *             ROOM_PASSWORD 가 설정돼 있으면 password 필수 (error: password_required | wrong_password{remaining} | locked{retryAfterMs}).
 *             살아 있는 token 으로 이어받는 재접속은 비밀번호를 다시 묻지 않는다.
 *   move      { x, y, facing, moving }       → 다른 사람에게 playerMoved. 거부 시 본인에게만 move:correct { x, y, reason }
 *   sit       { seatId } / stand             → ack { ok, error? }, 모두에게 playerSat / playerStood
 *   status    { status: 'study'|'rest' }     → 모두에게 playerStatus
 *   interact  { id }                         → ack { ok, kind, status?, error? }. coffee 면 모두에게 playerStatus (status 'coffee')
 *   listening { title|null }                 → 모두에게 playerListening { id, listening }
 *   avatar:update { avatar }                 → ack { ok, avatar(정규화됨) }, 모두에게 avatar:update { id, avatar } (본인 포함)
 *   chat      { text }                       → ack { ok, error? }, 모두에게 chat { id, nickname, text, ts }
 *   emoji     { index }                      → 모두에게 playerEmoji { id, emoji }
 *   pomodoro:start { focusMinutes?, breakMinutes? } / pomodoro:stop → ack { ok, ...snapshot | error }. 7단계: **개인 타이머** —
 *             본인에게만 pomodoro { ...snapshot } (자동 전환 때도). 집중 20~90분 · 휴식 5~20분, 진행 중엔 설정 변경 불가.
 *             8단계: 시작·정지·전환 때 모두에게 playerPomodoro { id, pomodoro: { phase, endsAt } | null } (머리 위 남은 시간 — 각자 서버 시각으로 계산)
 *   wallet                                   → ack { ok, coins, ledger[≤10], inventory(placed/slot), tabs, categories, items, layoutLock } (8·9단계 지갑·상점)
 *   shop:buy  { itemId, variant? }           → ack { ok, balance, item, inventory } | { ok:false, error: no_item | no_variant | insufficient, balance? }
 *   ── 9단계 가구 ──
 *   desk:equip { slots: [inventoryId|null x3] } → ack { ok, deskItems } | error invalid|no_item|not_desk|duplicate. 모두에게 playerDesk { id, deskItems }
 *   edit:mode { on }                         → ack { ok, editing }, 모두에게 playerEdit { id, editing } (머리 위 🛠)
 *   layout:place { inventoryId, x, y, rotation } → ack { ok, entry } | error no_item|not_placeable|already_placed|blocked|overlap|wall_only|needs_base|out_of_bounds|invalid_rotation|player_in_way
 *   layout:grab { id } / layout:release { id } → ack { ok } | error not_found|forbidden|locked{by}|occupied|not_holder (먼저 잡은 사람 우선, 30초 잠금)
 *   layout:move { id, x, y, rotation }       → ack { ok, entry } | 위 오류들.  layout:remove { id } → ack { ok, id } (놓은 사람 인벤토리로 회수)
 *   layout:lock { on }                       → ack { ok, layoutLock } — "내가 놓은 것만 이동·회수" 설정 (users.layout_lock)
 *   서버 → layout:update { op: add|move|remove|grab|release, entry?, id?, by } (모두에게). 입장 ack 에 layout: [entry...]
 *   profile:reset { nickname, token }        → ack { ok, counts?, error?: confirm_mismatch }. 본인 토큰·닉네임 확인 후 세션·출석·목표·할 일 삭제,
 *                                              모두에게 playerGoal { id, goal: null } + leaderboard:refresh
 *   time:ping { t0 }                         → ack { t0, serverTime }
 *   leave                                    → 즉시 정리 (유예 없음)
 *   npc:pet   { id }                         → ack { ok, reaction, highFive, error? }, 모두에게 npc:pet { id, by, playerId, reaction, highFive } + 시스템 chat
 *   npc:name  { id, name }                   → ack { ok, name?, error? }, 모두에게 npc:name { id, name } (강아지: 누구나·users.dog_name / 공용 펫: 푼 사람 / 개인 펫: 주인)
 *   ── 10단계 펫 ──
 *   shop:buy { itemId:'skill_*', target }    → 행동 업그레이드는 target('dog' | 's:<roomPetId>' | 내 개인 펫 inventoryId) 필수, 펫별 1회 (already_has)
 *   pet:config { active?, petId?, name?, cosmetics? } → ack { ok, petConfig, pet } — 활성 펫 바꾸면 따라다니는 펫이 생기고/사라진다 (npc:update / npc:remove)
 *   pet:release { inventoryId, name? }       → ack { ok, pet, roomPetId } | error not_shared_pet | already_released | room_full(3마리) | invalid_name
 *   pet:recall { id }                        → ack { ok } | forbidden(푼 사람만).  pet:deco { id(npc), slots: { head, neck, back } } → ack { ok, cosmetics }
 *   서버 → npc:update 스냅샷에 species · cosmetics · ownerId(개인 펫) · shoulder(앵무새) · bounce(슬라임). npc:remove { id } (펫 회수·주인 퇴장)
 *   stats                                    → ack { ok, store, tz, date, rows: [{ nickname, todaySeconds, weekSeconds, streak, weekDays, live, online }] }
 *   goal:set  { text, targetMinutes }        → ack { ok, goal, reached } , 모두에게 playerGoal { id, goal }
 *   todo:list / todo:add { text } / todo:toggle { id, done } / todo:delete { id } → ack (본인 닉네임의 할 일, 이월 carried 포함)
 * 서버 → npc:update { id, kind, name, x, y, facing, state } (10Hz, 바뀔 때)
 * 서버 → leaderboard:refresh { nickname, seconds } (세션 저장 시), attendance { streak, weekDays } (본인에게, 출석 기록 시),
 *        goalReached { id, nickname } + 시스템 chat (오늘 목표 달성)
 * 서버 → coins { id, delta, reason, balance? } (8단계: 코인 증감 — 모두에게 보내되 balance 는 본인에게만)
 * 입장 ack 에 profile { goal, streak, coins }, store('memory'|'supabase'), tz 가 포함된다.
 * 서버 → 클라이언트 알림: playerJoined { player }, playerLeft { id, nickname, reason }, playerReconnected { id }, playerDisconnected { id }
 */
const { Server } = require('socket.io');
const { World } = require('./game/world');
const { createGate, clientKey } = require('./gate');

function attachSocket(httpServer, { room, world: worldOpts = {}, gate = createGate(), log = console } = {}) {
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
  world.on('pomodoro', (snap, reason, player) => {
    io.sockets.sockets.get(player.socketId)?.emit('pomodoro', snap);
    if (reason !== 'config') io.emit('playerPomodoro', { id: player.id, pomodoro: world.publicPomodoro(player) });
  });
  world.on('coins', ({ playerId, delta, reason, balance }) => {
    const p = world.players.get(playerId);
    const self = p && io.sockets.sockets.get(p.socketId);
    if (self) self.emit('coins', { id: playerId, delta, reason, balance });
    (self ? self.broadcast : io).emit('coins', { id: playerId, delta, reason });
    if (delta > 0) io.emit('leaderboard:refresh', { nickname: p ? p.nickname : null, seconds: 0 });
  });
  world.on('npcUpdate', (snap) => io.emit('npc:update', snap));
  world.on('npcPet', ({ npc, by, playerId, name, reaction, highFive }) => {
    io.emit('npc:pet', { id: npc, by, playerId, reaction, highFive });
    io.emit('chat', { system: true, text: `${by}님이 ${name}을(를) 쓰다듬었어요${highFive ? ' 🖐' : ''}`, ts: world.now() });
  });
  world.on('npcRemoved', ({ id }) => io.emit('npc:remove', { id }));
  world.on('npcName', ({ npc, name }) => io.emit('npc:name', { id: npc, name }));
  world.on('sessionSaved', ({ nickname, seconds }) => io.emit('leaderboard:refresh', { nickname, seconds }));
  world.on('layout', (e) => io.emit('layout:update', e));
  world.on('desk', ({ player }) => io.emit('playerDesk', { id: player.id, deskItems: world.publicDeskItems(player) }));
  world.on('editing', ({ player }) => io.emit('playerEdit', { id: player.id, editing: Boolean(player.editing) }));
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
      const { password, ...rest } = payload || {};
      // 비밀번호: 살아 있는 세션을 이어받는 게 아니면 게이트를 통과해야 한다 (평문은 로그·월드 어디에도 넘기지 않는다)
      if (gate.enabled && !world.hasSession(rest.token)) {
        const g = await gate.check(clientKey(socket), password);
        if (!g.ok) return ack(g);
        if (player) return ack({ ok: false, error: 'already_joined' }); // 해시 계산 사이에 다른 join 이 먼저 끝남
        if (!socket.connected) return;
      }
      const res = world.join({ ...rest, socketId: socket.id });
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
        pomodoro: world.pomodoroOf(player).snapshot(),
        npcs: world.npcSnapshots(),
        layout: world.listLayout(),
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

    socket.on('avatar:update', requirePlayer((payload, ack) => {
      const res = world.setAvatar(player, payload && payload.avatar);
      ack(res);
      io.emit('avatar:update', { id: player.id, avatar: player.avatar });
    }));

    socket.on('chat', requirePlayer((payload, ack) => {
      const res = world.chat(player, payload && payload.text);
      if (!res.ok) return ack({ ok: false, error: res.error });
      ack({ ok: true });
      io.emit('chat', { id: player.id, nickname: player.nickname, text: res.text, ts: res.ts });
      world.onChat(player, String((payload && payload.text) || '')); // 10단계: 이름을 부르면 달려오는 펫
    }));

    socket.on('emoji', requirePlayer((payload, ack) => {
      const emoji = world.emoji(payload && payload.index);
      if (!emoji) return ack({ ok: false, error: 'invalid' });
      ack({ ok: true });
      io.emit('playerEmoji', { id: player.id, emoji });
    }));

    socket.on('pomodoro:start', requirePlayer((payload, ack) => ack(world.startPomodoro(player, payload || {}))));
    socket.on('pomodoro:stop', requirePlayer((_p, ack) => ack(world.stopPomodoro(player))));

    socket.on('npc:pet', requirePlayer((payload, ack) => {
      const npc = world.npcById(payload && payload.id);
      if (!npc) return ack({ ok: false, error: 'no_npc' });
      ack(npc.pet(player));
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
    socket.on('npc:name', requirePlayer(safe((payload) => world.setNpcName(player, payload && payload.id, payload && payload.name))));
    // ── 펫 (10단계) ─────────────────────────────────────────────────
    socket.on('pet:config', requirePlayer(safe((payload) => world.setPetConfig(player, payload || {}))));
    socket.on('pet:release', requirePlayer(safe((payload) => world.releasePet(player, payload || {}))));
    socket.on('pet:recall', requirePlayer(safe((payload) => world.recallPet(player, payload && payload.id))));
    socket.on('pet:deco', requirePlayer(safe((payload) => world.setPetDeco(player, payload && payload.id, payload && payload.slots))));
    socket.on('goal:set', requirePlayer(safe(async (payload) => {
      const res = await world.setGoal(player, payload || {});
      if (res.ok) io.emit('playerGoal', { id: player.id, goal: res.goal });
      return res;
    })));
    socket.on('todo:list', requirePlayer(safe(async () => ({ ok: true, todos: await world.listTodos(player) }))));
    socket.on('wallet', requirePlayer(safe(() => world.wallet(player))));
    socket.on('shop:buy', requirePlayer(safe((payload) => world.purchase(player, payload && payload.itemId, payload && payload.variant, payload && payload.target))));
    // ── 가구 (9단계) ────────────────────────────────────────────────
    socket.on('desk:equip', requirePlayer(safe((payload) => world.equipDesk(player, payload && payload.slots))));
    socket.on('edit:mode', requirePlayer((payload, ack) => ack(world.setEditing(player, payload && payload.on))));
    socket.on('layout:place', requirePlayer(safe((payload) => world.placeFurniture(player, payload || {}))));
    socket.on('layout:grab', requirePlayer(safe((payload) => world.grabFurniture(player, payload && payload.id))));
    socket.on('layout:release', requirePlayer((payload, ack) => ack(world.releaseFurniture(player, payload && payload.id))));
    socket.on('layout:move', requirePlayer(safe((payload) => world.moveFurniture(player, payload || {}))));
    socket.on('layout:remove', requirePlayer(safe((payload) => world.removeFurniture(player, payload && payload.id))));
    socket.on('layout:lock', requirePlayer(safe((payload) => world.setLayoutLock(player, payload && payload.on))));
    socket.on('todo:add', requirePlayer(safe((payload) => world.addTodo(player, payload && payload.text))));
    socket.on('todo:toggle', requirePlayer(safe((payload) => world.setTodoDone(player, payload && payload.id, payload && payload.done))));
    socket.on('todo:delete', requirePlayer(safe((payload) => world.deleteTodo(player, payload && payload.id))));
    socket.on('profile:reset', requirePlayer(safe(async (payload) => {
      const res = await world.resetProfile(player, payload || {});
      if (res.ok) {
        io.emit('playerGoal', { id: player.id, goal: null });
        io.emit('leaderboard:refresh', { nickname: player.nickname, seconds: 0 });
      }
      return res;
    })));

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
      if (player.editing) world.setEditing(player, false); // 끊기면 편집 모드·잠금 해제
      world.disconnect(player);
      socket.broadcast.emit('playerDisconnected', { id: player.id });
      io.emit('roomCount', { count: world.connectedCount });
      player = null;
    });
  });

  return { io, world };
}

module.exports = { attachSocket };
