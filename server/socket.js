'use strict';
/**
 * Socket.io 배선. 프로토콜 (클라이언트 → 서버는 ack 콜백으로 결과를 돌려준다):
 *   ── 11단계 로비 (입장 전) ──
 *   site:auth { password }                   → ack { ok } | { ok:false, error: password_required | wrong_password{remaining} | locked{retryAfterMs} }
 *             ROOM_PASSWORD(사이트 전체 비밀번호)가 설정돼 있으면 로비 전에 통과해야 한다. 통과한 소켓은 join 에서 다시 묻지 않는다.
 *   lobby:list { nickname }                  → ack { ok, mine: [스터디 카드], others: [공개 목록] }
 *   study:create { nickname, name, password?, maxPlayers?, weeklyGoalMinutes?, editPolicy? } → ack { ok, study, studyAccess? } | error invalid_name|invalid_password|invalid_max_players|invalid_goal|invalid_policy
 *             잠긴 스터디를 만들면 만든 기기의 접근 토큰(studyAccess)을 함께 준다.
 *   study:lookup { code }                    → ack { ok, study: { code, name, locked, online, maxPlayers } } | no_study
 *   join      { study(code|id), nickname, token?, avatar?, password?, studyPassword?, studyAccess? }
 *             → ack { ok, self, token, study, studyAccess?, players, seats, pomodoro, config, serverTime, resumed, profile{ goal, streak, coins, rewards } }
 *             | { ok:false, error: no_study | study_full | password_required | wrong_password{remaining} | locked{retryAfterMs} | 닉네임 오류 }
 *             password = 사이트 비밀번호(site:auth 대신 여기 실어도 됨), studyPassword = 잠긴 스터디 비밀번호,
 *             studyAccess = 이 기기가 전에 받은 접근 토큰(유효하면 studyPassword 생략). 비밀번호를 맞추면 ack.studyAccess 로 새 토큰을 준다
 *             (클라이언트가 localStorage 에 보관). 살아 있는 token 재접속은 아무것도 묻지 않는다.
 *   ── 스터디 안 (11단계) ──
 *   study:info                               → ack { ok, study{ ..., isOwner }, members[{ nickname, online, weekSeconds, lastSeenAt, isOwner }], week{ totalSeconds, targetSeconds, reached }, streak }
 *   study:update { name?, password?, maxPlayers?, weeklyGoalMinutes?, editPolicy?, roomLabel? } → ack { ok, study, studyAccess? } (방장만). 모두에게 study:update { study, passwordChanged }
 *             15단계: roomLabel = 스터디룸 문 명패(12자, 비우면 스터디 이름) — publicStudy.roomLabel. 클라이언트가 문 위에 그린다
 *             비밀번호를 바꾸면 그 스터디의 기기 토큰이 전부 무효가 되고 방장 기기만 ack.studyAccess 로 새 토큰을 받는다.
 *   study:kick { nickname }                  → ack { ok } (방장만). 내보내진 사람에게 kicked { by }
 *   study:delete                             → ack { ok } | not_empty (방장만, 다른 사람이 있으면 불가)
 *   서버 → studyGoal { weekStart, totalSeconds, targetSeconds, bonus } (그룹 주간 목표 달성: 연출 + 접속 중 멤버 코인) + 시스템 chat
 *   서버 → chat { system: true, notify?: true, text } — notify 면 알림 벨 목록에도 넣는다 (멤버 입장·펫 풀림 등)
 *   ── 이하 기존 ──
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
 *   wallet                                   → ack { ok, coins, carrySeconds, nextCoinAt|null, studying, ledger[≤10], inventory(placed/slot), tabs, categories, items, layoutLock } (8·9단계 지갑·상점.
 *             coins 는 입장 ack 의 profile.coins 와 같은 저장소 값. 공부 중이면 nextCoinAt(서버 ms) 로 "다음 코인까지" 카운트다운)
 *   shop:buy  { itemId, variant? }           → ack { ok, balance, item, inventory } | { ok:false, error: no_item | no_variant | insufficient, balance? }
 *   ── 9단계 가구 ──
 *   desk:equip { slots: [inventoryId|null x3] } → ack { ok, deskItems } | error invalid|no_item|not_desk|duplicate. 모두에게 playerDesk { id, deskItems }
 *   edit:mode { on }                         → ack { ok, editing } | forbidden(방장만 편집인 스터디), 모두에게 playerEdit { id, editing } (머리 위 🛠)
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
 *   npc:name  { id, name }                   → ack { ok, name?, error? }, 모두에게 npc:name { id, name } (강아지: 누구나·스터디별 저장 / 공용 펫: 푼 사람 / 개인 펫: 주인)
 *   ── 10단계 펫 ──
 *   shop:buy { itemId:'skill_*', target }    → 행동 업그레이드는 target('dog' | 's:<roomPetId>' | 내 개인 펫 inventoryId) 필수, 펫별 1회 (already_has)
 *   pet:config { active?, petId?, name?, cosmetics? } → ack { ok, petConfig, pet } — 활성 펫 바꾸면 따라다니는 펫이 생기고/사라진다 (npc:update / npc:remove)
 *   pet:release { inventoryId, name? }       → ack { ok, pet, roomPetId } | error not_shared_pet | already_released | room_full(3마리) | invalid_name
 *   pet:recall { id }                        → ack { ok } | forbidden(푼 사람만).  pet:deco { id(npc), slots: { head, neck, back } } → ack { ok, cosmetics }
 *   서버 → npc:update 스냅샷에 species · cosmetics · ownerId(개인 펫) · shoulder(앵무새) · bounce(슬라임). npc:remove { id } (펫 회수·주인 퇴장)
 *   stats { scope?: 'study'|'all' }          → ack { ok, store, tz, date, scope, rows: [{ nickname, todaySeconds, weekSeconds, streak, weekDays, live, online }] }
 *   goal:set  { text, targetMinutes }        → ack { ok, goal, reached } , 모두에게 playerGoal { id, goal }
 *   todo:list / todo:add { text } / todo:toggle { id, done } / todo:delete { id } → ack (본인 닉네임의 할 일, 이월 carried 포함)
 * 서버 → npc:update { id, kind, name, x, y, facing, state } (10Hz, 바뀔 때)
 * 서버 → leaderboard:refresh { nickname, seconds } (세션 저장 시), attendance { streak, weekDays } (본인에게, 출석 기록 시),
 *        goalReached { id, nickname } + 시스템 chat (오늘 목표 달성)
 * 서버 → coins { id, delta, reason, balance?, carrySeconds?, nextCoinAt? } (8단계: 코인 증감 — 모두에게 보내되 balance 는 본인에게만. 시간 코인은 앉아서 공부 중
 *        10분이 찰 때마다 즉시 오고, 본인에게는 다음 코인까지 정보가 함께 실린다. 클라이언트는 잔액을 스스로 계산하지 않고 balance 만 반영한다)
 *        coinProgress { studying, carrySeconds, nextCoinAt|null } (본인에게만: 세션 시작·종료 — 지갑 카운트다운 시작/정지)
 *        playerStatus { id, status, auto: true } (뽀모도로를 따라 상태가 자동 전환됨 — 집중 → study, 휴식 → rest)
 * 입장 ack 에 profile { goal, streak, coins, rewards }, store('memory'|'supabase'), tz 가 포함된다.
 * 서버 → 클라이언트 알림: playerJoined { player }, playerLeft { id, nickname, reason }, playerReconnected { id }, playerDisconnected { id }
 * 모든 방 안 이벤트는 Socket.io room `study:<id>` 안에서만 오간다 (다른 스터디 사람·가구·펫은 보이지 않는다).
 *   ── 12단계 야외 (Socket.io room 'outdoor' 하나 — 모든 스터디 사람이 만난다) ──
 *   door      { }                            → ack { ok, room: 'outdoor'|'studyroom', ...입장 ack 와 같은 세션 필드 } | error not_on_door | no_study | study_full
 *             발 위치가 to 가 있는 문 타일이면 스터디 ↔ 야외로 옮긴다. 옛 방에는 playerLeft { reason: 'outdoor' | 'inside' }, 새 방에는 playerJoined.
 *             입장/door ack 의 study 는 소속 스터디(야외에서도), room 은 지금 있는 맵 id.
 *   move      { ..., vehicle?: { type, angle, speed } } → 탑승 중이면 playerMoved 에 vehicle 이 실린다 (서버가 종류별 최고 속도로 검증)
 *   vehicle:mount / vehicle:dismount          → ack { ok, vehicle } | error seated | already_riding | no_vehicle | no_item | not_riding | not_outdoor. 모두에게 playerVehicle { id, vehicle }
 *   vehicle:config { active?, decal?, horn? } → ack { ok, vehicleConfig } (설정 → 내 탈것, 어디서나). 탑승 중이면 반영
 *   horn                                     → ack { ok, horn } | not_riding | no_horn. 모두에게 playerHorn { id, horn }
 *   track:board                              → ack { ok, today[≤5], all[≤5], myBest, track } (전광판). 새 기록이 저장되면 모두에게 track:board (다시 받으라는 신호)
 *   profile { id }                           → ack { ok, nickname, studyName, weekSeconds|null(비공개), statsPublic, vehicle }
 *   profile:visibility { public }            → ack { ok, statsPublic } (users.stats_public)
 *   서버 → lap:progress { event: 'start'|'checkpoint'|'reset'|'lap', next, total, ms?, startedAt } (본인), lap { id, nickname, ms, best, isBest, reward, vehicle } (모두, 완주 시)
 *   ── 14단계 동물원 (야외) ──
 *   zoo:feed  { id: 우리 id }                 → ack { ok, left, animal, enclosure } | error no_enclosure | too_far | riding | seated | limit(하루 3번) | busy
 *             동물이 먹이 지점으로 와 먹으면 모두에게 npc:pet { id, reaction, by: null } (❤️ 대신 종별 먹이 이모지) + 시스템 chat
 *   zoo:snack { item: 'icecream'|'churros' }  → ack { ok, snack{ item, emoji, until }, balance } | error no_item | too_far | insufficient. 모두에게 playerSnack { id, snack } (5분 뒤 클라이언트가 지운다)
 *   서버 → photo { ids, nicknames } (포토존 발자국 두 칸에 둘이 서면 · 같은 쌍 20초에 한 번) + 시스템 chat "OO님과 OO님이 사진을 찍었어요"
 *   npc:update 스냅샷에 sheet: 'animals'(동물 시트) · pettable · eating · fly · glow(반딧불이). 동물은 npc:pet 로 쓰다듬기(토끼·기니피그·다람쥐·고양이만)
 *   ── 14단계 낚시·별자리·도감 ──
 *   fish:cast { id: 자리 번호 }               → ack { ok, state: 'wait', spot, left, biteIn } | error no_spot | too_far | seated | riding | already | limit(하루 5마리)
 *             모두에게 playerFishing { id, fishing: { state: 'wait'|'bite', spot } | null, state, result }. 5~10초 뒤 state 'bite'("!"), 1.2초 안에 fish:reel
 *   fish:reel                                → ack { ok, fish{ id, name, rarity, emoji }, rare, left } | error not_fishing | early | late. 성공하면 모두에게 fish:caught { id, nickname, fish, rare } + 시스템 chat
 *             (희귀는 서버 전체 chat). 움직이면 낚시가 취소된다 (playerFishing result.reason 'moved')
 *   sky:view                                 → ack { ok, constellation{ id, name, desc, real, stars, lines }, index, first } | error too_far | daytime{ hour } (망원경 앞, 밤 19~06시 tz)
 *   codex                                    → ack { ok, fish[10]{ count, firstAt, ... }, caughtSpecies, catchesToday, catchLimit, constellations[{ id, name, desc, real, seenAt }], constellationsTotal, tank{ available, fish[], max } }
 *   fish:tank { fishId, on }                 → ack { ok, tank } | error no_study | no_tank | no_fish | not_caught | already | tank_full | not_in_tank | forbidden. 어항 물고기(FishNpc) 스냅샷에 tank: [fishId]
 *   ── 15단계 쪽지 · 커피 배달 · D-day (스터디 안) ──
 *   note:leave { to, text }                  → ack { ok, note, seatId, delivered } | error invalid_target | not_member | empty | too_long(60자) | no_seat | too_far. 상대 자리(마지막에 앉은 자리 / 스터디룸 의자) 앞 64px
 *             받는 사람이 그 자리에 앉아 있으면(또는 앉으면) 본인에게 note:waiting { seatId, notes[] } + 모두에게 seatItems. 접속 중이면 note:new { from, seatId } (알림 벨)
 *   note:read                                → ack { ok, notes[] } (앉은 채 E — 안 읽은 쪽지 전부 읽음 처리) | not_seated.  note:box → ack { ok, received[≤20], sent[≤20], unread }
 *   coffee:targets                           → ack { ok, price, menu[{ id, name, emoji }], members[{ nickname, self, online, seated, hasSeat }] }
 *   coffee:gift { menu, to }                 → ack { ok, gift, delivered, balance } | error too_far | invalid_menu | not_member | no_seat | insufficient{balance}. 1코인 차감(coins 이벤트)
 *             앉아 있는 상대(또는 본인)는 바로: 본인에게 coffee:received { gift, late }, 모두에게 playerBuff { id, coffeeBuffUntil }(10분 ❤️☕) + 시스템 chat(notify).
 *             비어 있으면 자리에 머그: 모두에게 seatItems { mugs: { seatId: [{ menu, from, to }] }, notes: { seatId: n } } + chat. 앉으면 받는다.
 *   dday:list                                → ack { ok, ddays[{ id, title, date, kind, daysLeft, label, soon, today, mine, shared }], board[≤3] }
 *   dday:add { title(12자), date(YYYY-MM-DD), kind: exam|anniversary|other, shared } → ack { ok, dday, ddays, board } | error invalid_title | invalid_date | invalid_kind
 *   dday:delete { id }                       → ack { ok, ddays, board } | not_found | forbidden(만든 사람만). 공용이 바뀌면 모두에게 dday:update
 *   입장 ack: seatItems · seatLast · profile.ddays { board, celebrate[] (오늘 D-day, 사람·날짜마다 1회) } · profile.unreadNotes[] · profile.pendingGifts[]
 */
const { Server } = require('socket.io');
const { Hub } = require('./game/hub');
const { createGate, clientKey } = require('./gate');

const PASSWORD_ERRORS = new Set(['password_required', 'wrong_password', 'locked']); // join ack 에 scope('site'|'study') 를 붙여 어느 비밀번호인지 알린다

function attachSocket(httpServer, { room, world: worldOpts = {}, hub: hubOpts = {}, gate = createGate(), log = console } = {}) {
  const io = new Server(httpServer, {
    serveClient: true,
    pingInterval: 10000,
    pingTimeout: 8000,
    maxHttpBufferSize: 16 * 1024,
  });
  const { store, tz, ...restWorld } = worldOpts;
  const hub = new Hub({ room, store, tz, log, now: restWorld.now, world: restWorld, ...hubOpts }); // world.now(테스트 시계)는 허브·트래커도 같이 쓴다
  const roomOf = (world) => (world.outdoor ? 'outdoor' : `study:${world.studyId}`);
  const TRANSFER = new Set(['outdoor', 'inside']); // 다른 월드로 옮겨 가는 퇴장 — 소켓은 그대로 (transfer 가 방을 바꾼다)
  const to = (world) => io.to(roomOf(world));
  const socketOf = (p) => (p ? io.sockets.sockets.get(p.socketId) : undefined);
  const roomCount = (world) => to(world).emit('roomCount', { count: world.connectedCount });
  const chat = (world, text, extra = {}) => to(world).emit('chat', { system: true, text, ts: world.now(), ...extra });

  /** 스터디 월드가 만들어질 때 그 방(room)으로만 나가는 이벤트를 붙인다 */
  function bindWorld(world) {
    world.on('playerLeft', (player, reason) => {
      const s = socketOf(player);
      if (s && s.data.player === player && !TRANSFER.has(reason)) {
        s.data.player = null;
        s.leave(roomOf(world));
        if (reason === 'kicked') s.emit('kicked', { study: world.studyId });
        else if (reason === 'deleted') s.emit('study:deleted', { study: world.studyId });
      }
      to(world).emit('playerLeft', { id: player.id, nickname: player.nickname, reason });
      roomCount(world);
    });
    world.on('pomodoro', (snap, reason, player) => {
      socketOf(player)?.emit('pomodoro', snap);
      if (reason !== 'config') to(world).emit('playerPomodoro', { id: player.id, pomodoro: world.publicPomodoro(player) });
    });
    // 문을 지나는 순간 정산된 코인은 옛 월드에서 나오므로, 이 월드에 없으면 다른 월드(야외 등)에서 찾아 본인에게 보낸다
    const playerAnywhere = (id) => world.players.get(id) || hub.allPlayers().find((x) => x.id === id) || null;
    world.on('coins', ({ playerId, delta, reason, balance, carrySeconds, nextCoinAt }) => {
      const p = playerAnywhere(playerId);
      const self = socketOf(p);
      // 본인에게만 balance (+ 시간 코인이면 다음 코인까지) — 클라이언트는 잔액을 스스로 더하지 않고 이 값만 반영한다
      if (self) self.emit('coins', { id: playerId, delta, reason, balance, ...(nextCoinAt !== undefined ? { carrySeconds, nextCoinAt } : {}) });
      (self ? self.to(roomOf(world)) : to(world)).emit('coins', { id: playerId, delta, reason });
      if (delta > 0) to(world).emit('leaderboard:refresh', { nickname: p ? p.nickname : null, seconds: 0 });
    });
    // 세션 시작·종료: 지갑 "다음 코인까지" 카운트다운 (본인에게만)
    world.on('coinProgress', ({ playerId, studying, carrySeconds, nextCoinAt }) => socketOf(playerAnywhere(playerId))?.emit('coinProgress', { studying, carrySeconds, nextCoinAt }));
    // 뽀모도로를 따라 상태가 자동으로 바뀜 (본인 포함 모두에게)
    world.on('status', ({ player }) => to(world).emit('playerStatus', { id: player.id, status: player.status, auto: true }));
    world.on('npcUpdate', (snap) => to(world).emit('npc:update', snap));
    world.on('npcPet', ({ npc, by, playerId, name, reaction, highFive }) => {
      to(world).emit('npc:pet', { id: npc, by, playerId, reaction, highFive });
      chat(world, `${by}님이 ${name}을(를) 쓰다듬었어요${highFive ? ' 🖐' : ''}`);
    });
    world.on('npcRemoved', ({ id }) => to(world).emit('npc:remove', { id }));
    world.on('npcName', ({ npc, name }) => to(world).emit('npc:name', { id: npc, name }));
    world.on('sessionSaved', ({ nickname, seconds }) => to(world).emit('leaderboard:refresh', { nickname, seconds }));
    world.on('layout', (e) => to(world).emit('layout:update', e));
    world.on('desk', ({ player }) => to(world).emit('playerDesk', { id: player.id, deskItems: world.publicDeskItems(player) }));
    world.on('editing', ({ player }) => to(world).emit('playerEdit', { id: player.id, editing: Boolean(player.editing) }));
    world.on('attendance', ({ playerId, streak, weekDays, inserted }) => {
      const p = world.players.get(playerId);
      if (!p || !inserted) return;
      socketOf(p)?.emit('attendance', { streak, weekDays });
      to(world).emit('leaderboard:refresh', { nickname: p.nickname, seconds: 0 });
    });
    world.on('goalReached', ({ nickname, playerId }) => {
      to(world).emit('goalReached', { id: playerId, nickname });
      chat(world, `${nickname}님이 오늘 목표를 달성했어요 🎉`, { notify: true });
    });
    // 12단계 야외
    world.on('vehicle', ({ player }) => to(world).emit('playerVehicle', { id: player.id, vehicle: world.publicVehicle(player) }));
    world.on('horn', ({ player, horn }) => to(world).emit('playerHorn', { id: player.id, horn }));
    world.on('lap', ({ player, event, ms, next, total }) => socketOf(player)?.emit('lap:progress', { event, next, total, ms, startedAt: world.lapOf ? world.lapOf(player).startedAt : null }));
    world.on('lapDone', ({ player, ms, best, isBest, reward }) => {
      to(world).emit('lap', { id: player.id, nickname: player.nickname, ms, best, isBest, reward, vehicle: player.vehicle ? player.vehicle.type : null });
      chat(world, `${player.nickname}님이 트랙 한 바퀴 완주 🏁 ${(ms / 1000).toFixed(1)}초${isBest ? ' (개인 최고!)' : ''}`);
    });
    world.on('board', () => to(world).emit('track:board', {}));
    // 14단계 동물원: 동물 반응(먹이) · 먹이 준 사람 채팅 · 손에 든 간식 · 포토존 플래시
    world.on('npcReact', ({ npc, reaction }) => to(world).emit('npc:pet', { id: npc, by: null, playerId: null, reaction, highFive: false }));
    world.on('zooFeed', ({ player, enclosure }) => chat(world, `${player.nickname}님이 ${enclosure.name}에게 먹이를 줬어요 ❤️`));
    world.on('snack', ({ player }) => to(world).emit('playerSnack', { id: player.id, snack: world.publicSnack(player) }));
    world.on('photo', ({ players }) => {
      to(world).emit('photo', { ids: players.map((p) => p.id), nicknames: players.map((p) => p.nickname) });
      chat(world, `${players[0].nickname}님과 ${players[1].nickname}님이 사진을 찍었어요 📸`);
    });
    // 14단계 낚시: 자세/입질/종료 방송 · 잡으면 시스템 채팅 (희귀는 서버 전체)
    world.on('fishing', ({ player, state, result }) => to(world).emit('playerFishing', { id: player.id, fishing: world.publicFishing(player), state, result: result || null }));
    world.on('fishCaught', ({ player, fish, rare }) => {
      to(world).emit('fish:caught', { id: player.id, nickname: player.nickname, fish, rare });
      chat(world, `${player.nickname}님이 ${fish.name}을(를) 낚았어요 🎣`);
      if (rare) io.emit('chat', { system: true, notify: true, text: `✨ ${player.nickname}님이 희귀한 ${fish.name}을(를) 낚았어요! 🎣`, ts: world.now() });
    });
    // 15단계: 쪽지 · 커피 · D-day
    world.on('notesWaiting', ({ player, seatId, notes }) => socketOf(player)?.emit('note:waiting', { seatId, notes }));
    world.on('note', ({ note, seatId, by, recipient }) => {
      const s = socketOf(recipient);
      if (s && recipient.seatId !== seatId) s.emit('note:new', { from: by.nickname, seatId }); // 접속 중이지만 자리에 없으면 알림 벨로만
    });
    world.on('seatItems', (items) => to(world).emit('seatItems', items));
    world.on('buff', ({ player }) => to(world).emit('playerBuff', { id: player.id, coffeeBuffUntil: world.coffeeBuffOf(player) }));
    world.on('coffee', ({ gift, recipient, delivered, self, late }) => {
      if (delivered && recipient) socketOf(recipient)?.emit('coffee:received', { gift, late: Boolean(late) });
      if (self) return;
      if (delivered && !late) chat(world, `${gift.from}님이 ${gift.to}님에게 ${gift.emoji} ${gift.menuName}를 건넸어요`, { notify: true });
      else if (!delivered) chat(world, `${gift.from}님이 ${gift.to}님 자리에 ${gift.emoji} ${gift.menuName}를 놓고 갔어요`, { notify: true });
    });
    world.on('ddays', () => to(world).emit('dday:update', {}));
    world.on('weeklyGoal', (e) => {
      const info = world.studyInfo();
      to(world).emit('studyGoal', { weekStart: e.weekStart, totalSeconds: e.totalSeconds, targetSeconds: e.targetSeconds, bonus: e.bonus, name: info ? info.name : '' });
      chat(world, `이번 주 그룹 목표 ${Math.round(e.targetSeconds / 3600)}시간을 달성했어요! 🎆 멤버 모두에게 +${e.bonus} 🪙`, { notify: true });
      to(world).emit('leaderboard:refresh', { nickname: null, seconds: 0 });
    });
  }
  hub.on('worldCreated', bindWorld);
  hub.on('worldReleased', (world) => world.removeAllListeners());
  hub.on('studyUpdated', ({ study, world, passwordChanged }) => {
    if (world) to(world).emit('study:update', { study: hub.publicStudy(study), passwordChanged: Boolean(passwordChanged) });
  });

  const ackOf = (cb) => (typeof cb === 'function' ? cb : () => {});

  /** 입장·door ack 공용 세션 필드 */
  const sessionAck = (world, player, study, extra = {}) => ({
    ok: true,
    room: world.room.id,
    token: player.token,
    self: world.publicPlayer(player),
    study: study ? hub.publicStudy(study, { isOwner: hub.isOwner(study, player.nickname) }) : null,
    players: world.listPlayers().filter((p) => p.id !== player.id),
    seats: world.seatSnapshot(),
    seatLast: world.seatLastSnapshot(), // 15단계: 좌석마다 마지막에 앉았던 닉네임
    seatItems: world.seatItems(), // 15단계: 좌석에 놓인 머그·안 읽은 쪽지 수
    pomodoro: world.pomodoroOf(player).snapshot(),
    npcs: world.npcSnapshots(),
    layout: world.listLayout(),
    config: world.config,
    serverTime: world.now(),
    store: world.store.kind,
    tz: world.tz,
    ...extra,
  });

  io.on('connection', (socket) => {
    socket.data.player = null;
    socket.data.world = null;
    socket.data.siteOk = !gate.enabled;

    const current = () => {
      const p = socket.data.player;
      return p && p.socketId === socket.id && !p.removed ? p : null;
    };
    const requirePlayer = (fn) => (payload, cb) => {
      const player = current();
      if (!player) return ackOf(cb)({ ok: false, error: 'not_joined' });
      return fn(payload, ackOf(cb), player, socket.data.world);
    };
    const requireSite = (fn) => (payload, cb) => {
      if (!socket.data.siteOk) return ackOf(cb)({ ok: false, error: 'password_required' });
      return fn(payload, ackOf(cb));
    };
    const safe = (fn) => async (payload, ack, player, world) => {
      try {
        ack(await fn(payload, player, world));
      } catch (err) {
        log.warn(`[socket] 저장소 오류: ${err.message}`);
        ack({ ok: false, error: 'store_error' });
      }
    };

    // ── 로비 (11단계) ────────────────────────────────────────────────
    socket.on('site:auth', async (payload, cb) => {
      const ack = ackOf(cb);
      if (socket.data.siteOk) return ack({ ok: true });
      const g = await gate.check(clientKey(socket), payload && payload.password);
      if (g.ok) socket.data.siteOk = true;
      ack(g.ok ? g : { ...g, scope: 'site' });
    });
    socket.on('lobby:list', requireSite(safe(async (payload) => hub.lobby(String((payload && payload.nickname) || '').trim()))));
    socket.on('study:create', requireSite(safe(async (payload) => {
      const p = payload || {};
      const r = await hub.createStudy({ name: p.name, password: p.password, maxPlayers: p.maxPlayers, weeklyGoalMinutes: p.weeklyGoalMinutes, editPolicy: p.editPolicy, ownerNickname: p.nickname });
      if (!r.ok) return r;
      return r.access ? { ok: true, study: r.study, studyAccess: r.access } : { ok: true, study: r.study };
    })));
    socket.on('study:lookup', requireSite((payload, ack) => ack(hub.lookup(payload && payload.code))));

    socket.on('join', async (payload, cb) => {
      const ack = ackOf(cb);
      if (current()) return ack({ ok: false, error: 'already_joined' });
      const { password, studyPassword, studyAccess, ...rest } = payload || {};
      // 사이트 비밀번호: 살아 있는 세션을 이어받는 게 아니면 통과해야 한다 (평문은 로그·월드 어디에도 넘기지 않는다)
      if (!socket.data.siteOk && !hub.findSession(rest.token)) {
        const g = await gate.check(clientKey(socket), password);
        if (!g.ok) return ack({ ...g, scope: 'site' });
        socket.data.siteOk = true;
        if (current()) return ack({ ok: false, error: 'already_joined' }); // 해시 계산 사이에 다른 join 이 먼저 끝남
        if (!socket.connected) return;
      }
      let res;
      try {
        res = await hub.join({ study: rest.study, nickname: rest.nickname, token: rest.token, avatar: rest.avatar, socketId: socket.id, studyPassword, studyAccess, key: clientKey(socket) });
      } catch (err) {
        log.warn(`[socket] 입장 실패: ${err.message}`);
        return ack({ ok: false, error: 'store_error' });
      }
      if (!res.ok) return ack(PASSWORD_ERRORS.has(res.error) ? { ...res, scope: 'study' } : res);
      if (current()) { res.world.remove(res.player.id, 'leave'); return ack({ ok: false, error: 'already_joined' }); }
      const { world, player } = res;
      socket.data.player = player;
      socket.data.world = world;
      socket.join(roomOf(world));
      // 같은 토큰으로 온 새 연결 → 옛 소켓은 즉시 정리 (옛 소켓의 disconnect 핸들러는 socketId 가 달라 무시된다)
      if (res.oldSocketId && res.oldSocketId !== socket.id) {
        const old = io.sockets.sockets.get(res.oldSocketId);
        if (old) { old.data.player = null; old.disconnect(true); }
      }
      const profile = await world.loadProfile(player); // 오늘 목표 · 출석 스트릭 · 코인 · 그룹 보너스 (저장소)
      if (!socket.connected || player.socketId !== socket.id || player.removed) return; // 기다리는 사이 끊김
      ack(sessionAck(world, player, res.study, { resumed: res.resumed, profile, ...(res.access ? { studyAccess: res.access } : {}) }));
      if (res.resumed) socket.to(roomOf(world)).emit('playerReconnected', { id: player.id, player: world.publicPlayer(player) });
      else socket.to(roomOf(world)).emit('playerJoined', { player: world.publicPlayer(player) }); // 입장 시스템 채팅·알림은 클라이언트가 만든다
      roomCount(world);
      log.log(`[socket] ${res.resumed ? '재접속' : '입장'} ${player.nickname} (${player.id}) → ${res.study ? res.study.name : '(야외)'}`);
    });

    // ── 야외 (12단계): 문 · 탈것 · 랩 · 전광판 · 프로필 ────────────────────
    socket.on('door', requirePlayer(async (_payload, ack, player, world) => {
      const T = world.room.tileSize;
      const tx = Math.floor(player.x / T);
      const ty = Math.floor((player.y - 1) / T);
      if (player.seatId) return ack({ ok: false, error: 'seated' });
      const door = (world.room.doors || []).find((d) => d.to && Math.abs(d.x - tx) <= 1 && Math.abs(d.y - ty) <= 1);
      if (!door) return ack({ ok: false, error: 'not_on_door' });
      let res;
      try {
        socket.leave(roomOf(world)); // 옛 방 방송(playerLeft)은 나 빼고
        res = world.outdoor ? await hub.goInside(player, world) : await hub.goOutdoor(player, world);
      } catch (err) {
        log.warn(`[socket] 문 이동 실패: ${err.message}`);
        res = { ok: false, error: 'store_error' };
      }
      if (!res.ok) { socket.join(roomOf(world)); return ack(res); }
      const next = res.world;
      socket.data.world = next;
      socket.join(roomOf(next));
      roomCount(world);
      // 잔액은 항상 서버 값 (문을 지나도 배지가 0 으로 튀지 않게 coins 를 실어 보낸다)
      let coins;
      let coinProgress;
      try { [coins, coinProgress] = await Promise.all([next.store.getCoins(player.nickname), next.coinProgressOf(player)]); } catch (err) { log.warn(`[socket] 잔액 조회 실패: ${err.message}`); }
      ack(sessionAck(next, player, res.study, { resumed: false, profile: { vehicleConfig: next.vehicleConfigOf(player), statsPublic: Boolean(player.statsPublic), ...(coins !== undefined ? { coins, coinProgress } : {}) } }));
      socket.to(roomOf(next)).emit('playerJoined', { player: next.publicPlayer(player) });
      roomCount(next);
      log.log(`[socket] ${player.nickname} → ${next.outdoor ? '야외' : res.study.name}`);
    }));
    socket.on('vehicle:mount', requirePlayer(safe(async (_p, player, world) => (world.outdoor ? world.mount(player) : { ok: false, error: 'not_outdoor' }))));
    socket.on('vehicle:dismount', requirePlayer((_p, ack, player, world) => ack(world.dismount(player))));
    socket.on('vehicle:config', requirePlayer(safe((payload, player, world) => world.setVehicleConfig(player, payload || {}))));
    socket.on('horn', requirePlayer((_p, ack, player, world) => ack(world.outdoor ? world.horn(player) : { ok: false, error: 'not_outdoor' })));
    socket.on('track:board', requirePlayer(safe(async (_p, player) => hub.ensureOutdoor().board(player))));
    socket.on('profile', requirePlayer(safe((payload, player, world) => (world.outdoor ? world.profile(player, payload && payload.id) : { ok: false, error: 'not_outdoor' }))));
    socket.on('profile:visibility', requirePlayer(safe((payload, player, world) => world.setStatsPublic(player, payload && payload.public))));
    // ── 동물원 (14단계 B) ────────────────────────────────────────────────
    socket.on('zoo:feed', requirePlayer((payload, ack, player, world) => ack(world.outdoor ? world.feed(player, payload && payload.id) : { ok: false, error: 'not_outdoor' })));
    socket.on('zoo:snack', requirePlayer(safe(async (payload, player, world) => (world.outdoor ? world.snack(player, payload && payload.item) : { ok: false, error: 'not_outdoor' }))));
    // ── 낚시 · 별자리 · 도감 (14단계 C) ─────────────────────────────────
    socket.on('fish:cast', requirePlayer(safe(async (payload, player, world) => (world.outdoor ? world.cast(player, payload && payload.id) : { ok: false, error: 'not_outdoor' }))));
    socket.on('fish:reel', requirePlayer(safe(async (_p, player, world) => (world.outdoor ? world.reel(player) : { ok: false, error: 'not_outdoor' }))));
    socket.on('sky:view', requirePlayer(safe(async (_p, player, world) => (world.outdoor ? world.viewSky(player) : { ok: false, error: 'not_outdoor' }))));
    // 어항은 내 스터디 방의 공용 펫 물고기 (야외에서도 소속 스터디 월드를 찾는다)
    const tankWorld = async (player, world) => {
      if (!world.outdoor) return world;
      const sid = hub.studyIdOf(world, player);
      return sid !== null && sid !== undefined ? hub.ensureWorld(sid) : null;
    };
    socket.on('codex', requirePlayer(safe(async (_p, player, world) => {
      const base = await world.codex(player);
      const tw = await tankWorld(player, world);
      return { ...base, tank: tw ? tw.tankInfo() : { available: false, fish: [], max: 3 } };
    })));
    socket.on('fish:tank', requirePlayer(safe(async (payload, player, world) => {
      const tw = await tankWorld(player, world);
      if (!tw) return { ok: false, error: 'no_study' };
      return tw.setTank(player, payload && payload.fishId, !(payload && payload.on === false));
    })));

    // ── 스터디 정보/설정 (11단계) ─────────────────────────────────────
    socket.on('study:info', requirePlayer(safe((_p, player, world) => hub.info(hub.studyIdOf(world, player), player.nickname))));
    socket.on('study:update', requirePlayer(safe(async (payload, player, world) => {
      const r = await hub.updateStudy(hub.studyIdOf(world, player), player.nickname, payload || {});
      if (!r.ok) return r;
      return r.access ? { ok: true, study: r.study, studyAccess: r.access } : { ok: true, study: r.study };
    })));
    socket.on('study:kick', requirePlayer(safe(async (payload, player, world) => {
      const r = await hub.kickMember(hub.studyIdOf(world, player), player.nickname, String((payload && payload.nickname) || ''));
      if (r.ok) chat(world, `${payload.nickname} 님이 스터디에서 내보내졌어요.`);
      return r;
    })));
    socket.on('study:delete', requirePlayer(safe(async (_p, player, world) => {
      const r = await hub.deleteStudy(hub.studyIdOf(world, player), player.nickname);
      if (r.ok) { socket.data.player = null; socket.data.world = null; socket.leave(roomOf(world)); }
      return r;
    })));

    socket.on('move', requirePlayer((payload, _ack, player, world) => {
      const res = world.move(player, payload);
      if (!res.ok) {
        socket.emit('move:correct', { x: res.x, y: res.y, reason: res.reason });
        return;
      }
      // 발신자에게는 되돌려 보내지 않는다 (탑승 중이면 각도·속도도)
      const out = { id: player.id, x: player.x, y: player.y, facing: player.facing, moving: player.moving };
      if (player.vehicle) out.vehicle = { angle: player.vehicle.angle, speed: player.vehicle.speed };
      socket.to(roomOf(world)).emit('playerMoved', out);
    }));

    socket.on('sit', requirePlayer((payload, ack, player, world) => {
      const res = world.sit(player, payload && payload.seatId);
      if (!res.ok) return ack({ ok: false, error: res.error });
      ack({ ok: true, x: player.x, y: player.y, facing: player.facing, status: player.status });
      to(world).emit('playerSat', { id: player.id, nickname: player.nickname, seatId: player.seatId, x: player.x, y: player.y, facing: player.facing, status: player.status });
    }));

    socket.on('stand', requirePlayer((_payload, ack, player, world) => {
      const res = world.stand(player);
      if (!res.ok) return ack({ ok: false, error: res.error });
      ack({ ok: true, status: player.status });
      to(world).emit('playerStood', { id: player.id, status: player.status, x: player.x, y: player.y });
    }));

    socket.on('status', requirePlayer((payload, ack, player, world) => {
      const res = world.setStatus(player, payload && payload.status);
      if (!res.ok) return ack(res);
      ack({ ok: true });
      to(world).emit('playerStatus', { id: player.id, status: player.status });
    }));

    socket.on('interact', requirePlayer((payload, ack, player, world) => {
      const res = world.interact(player, payload && payload.id);
      ack(res);
      if (res.ok && res.status) to(world).emit('playerStatus', { id: player.id, status: player.status });
    }));

    socket.on('listening', requirePlayer((payload, ack, player, world) => {
      const res = world.setListening(player, payload ? payload.title : null);
      ack(res);
      if (res.ok) to(world).emit('playerListening', { id: player.id, listening: player.listening });
    }));

    socket.on('avatar:update', requirePlayer((payload, ack, player, world) => {
      const res = world.setAvatar(player, payload && payload.avatar);
      ack(res);
      to(world).emit('avatar:update', { id: player.id, avatar: player.avatar });
    }));

    socket.on('chat', requirePlayer((payload, ack, player, world) => {
      const res = world.chat(player, payload && payload.text);
      if (!res.ok) return ack({ ok: false, error: res.error });
      ack({ ok: true });
      to(world).emit('chat', { id: player.id, nickname: player.nickname, text: res.text, ts: res.ts });
      world.onChat(player, String((payload && payload.text) || '')); // 10단계: 이름을 부르면 달려오는 펫
    }));

    socket.on('emoji', requirePlayer((payload, ack, player, world) => {
      const emoji = world.emoji(payload && payload.index);
      if (!emoji) return ack({ ok: false, error: 'invalid' });
      ack({ ok: true });
      to(world).emit('playerEmoji', { id: player.id, emoji });
    }));

    socket.on('pomodoro:start', requirePlayer((payload, ack, player, world) => ack(world.startPomodoro(player, payload || {}))));
    socket.on('pomodoro:stop', requirePlayer((_p, ack, player, world) => ack(world.stopPomodoro(player))));

    socket.on('npc:pet', requirePlayer((payload, ack, player, world) => {
      const npc = world.npcById(payload && payload.id);
      if (!npc) return ack({ ok: false, error: 'no_npc' });
      ack(npc.pet(player));
    }));

    // ── 공부 기록: 랭킹 · 오늘 목표 · 할 일 (영구 저장소) ────────────────
    socket.on('stats', requirePlayer(safe(async (payload, player, world) => {
      const scope = payload && payload.scope === 'study' ? 'study' : 'all';
      if (!world.outdoor || scope !== 'study') return world.stats({ scope });
      // 야외에서 '이 스터디' 는 소속 스터디 멤버 기준
      const sid = hub.studyIdOf(world, player);
      const names = new Set(sid !== null ? await hub.memberNames(sid) : []);
      names.add(player.nickname);
      const all = await world.stats({ scope: 'all' });
      return { ...all, scope: 'study', rows: all.rows.filter((r) => names.has(r.nickname)) };
    })));
    socket.on('npc:name', requirePlayer(safe((payload, player, world) => world.setNpcName(player, payload && payload.id, payload && payload.name))));
    // ── 펫 (10단계) ─────────────────────────────────────────────────
    socket.on('pet:config', requirePlayer(safe((payload, player, world) => world.setPetConfig(player, payload || {}))));
    socket.on('pet:release', requirePlayer(safe(async (payload, player, world) => {
      const r = await world.releasePet(player, payload || {});
      if (r.ok) chat(world, `${player.nickname}님이 ${r.pet.name}을(를) 방에 풀었어요 🐾`, { notify: true });
      return r;
    })));
    socket.on('pet:recall', requirePlayer(safe((payload, player, world) => world.recallPet(player, payload && payload.id))));
    socket.on('pet:deco', requirePlayer(safe((payload, player, world) => world.setPetDeco(player, payload && payload.id, payload && payload.slots))));
    socket.on('goal:set', requirePlayer(safe(async (payload, player, world) => {
      const res = await world.setGoal(player, payload || {});
      if (res.ok) to(world).emit('playerGoal', { id: player.id, goal: res.goal });
      return res;
    })));
    socket.on('todo:list', requirePlayer(safe(async (_p, player, world) => ({ ok: true, todos: await world.listTodos(player) }))));
    socket.on('wallet', requirePlayer(safe((_p, player, world) => world.wallet(player))));
    socket.on('shop:buy', requirePlayer(safe((payload, player, world) => world.purchase(player, payload && payload.itemId, payload && payload.variant, payload && payload.target))));
    // ── 가구 (9단계) ────────────────────────────────────────────────
    socket.on('desk:equip', requirePlayer(safe((payload, player, world) => world.equipDesk(player, payload && payload.slots))));
    socket.on('edit:mode', requirePlayer((payload, ack, player, world) => ack(world.setEditing(player, payload && payload.on))));
    socket.on('layout:place', requirePlayer(safe((payload, player, world) => world.placeFurniture(player, payload || {}))));
    socket.on('layout:grab', requirePlayer(safe((payload, player, world) => world.grabFurniture(player, payload && payload.id))));
    socket.on('layout:release', requirePlayer((payload, ack, player, world) => ack(world.releaseFurniture(player, payload && payload.id))));
    socket.on('layout:move', requirePlayer(safe((payload, player, world) => world.moveFurniture(player, payload || {}))));
    socket.on('layout:remove', requirePlayer(safe((payload, player, world) => world.removeFurniture(player, payload && payload.id))));
    socket.on('layout:lock', requirePlayer(safe((payload, player, world) => world.setLayoutLock(player, payload && payload.on))));
    // ── 15단계: 쪽지 · 커피 배달 · D-day ────────────────────────────────
    socket.on('note:leave', requirePlayer(safe((payload, player, world) => world.leaveNote(player, payload || {}))));
    socket.on('note:read', requirePlayer(safe((_p, player, world) => world.readNotes(player))));
    socket.on('note:box', requirePlayer(safe((_p, player, world) => world.noteBox(player))));
    socket.on('coffee:targets', requirePlayer(safe((_p, player, world) => world.coffeeTargets(player))));
    socket.on('coffee:gift', requirePlayer(safe((payload, player, world) => world.giftCoffee(player, payload || {}))));
    socket.on('dday:list', requirePlayer(safe((_p, player, world) => world.listDdays(player))));
    socket.on('dday:add', requirePlayer(safe((payload, player, world) => world.addDday(player, payload || {}))));
    socket.on('dday:delete', requirePlayer(safe((payload, player, world) => world.deleteDday(player, payload && payload.id))));
    socket.on('todo:add', requirePlayer(safe((payload, player, world) => world.addTodo(player, payload && payload.text))));
    socket.on('todo:toggle', requirePlayer(safe((payload, player, world) => world.setTodoDone(player, payload && payload.id, payload && payload.done))));
    socket.on('todo:delete', requirePlayer(safe((payload, player, world) => world.deleteTodo(player, payload && payload.id))));
    socket.on('profile:reset', requirePlayer(safe(async (payload, player, world) => {
      const res = await world.resetProfile(player, payload || {});
      if (res.ok) {
        to(world).emit('playerGoal', { id: player.id, goal: null });
        to(world).emit('leaderboard:refresh', { nickname: player.nickname, seconds: 0 });
      }
      return res;
    })));

    socket.on('time:ping', (payload, cb) => {
      ackOf(cb)({ t0: payload && payload.t0, serverTime: hub.now() });
    });

    socket.on('leave', requirePlayer((_p, ack, player, world) => {
      socket.data.player = null;
      socket.data.world = null;
      socket.leave(roomOf(world));
      world.remove(player.id, 'leave');
      ack({ ok: true });
    }));

    socket.on('disconnect', () => {
      const player = current();
      const world = socket.data.world;
      if (!player || !world) return;
      if (player.editing) world.setEditing(player, false); // 끊기면 편집 모드·잠금 해제
      world.disconnect(player);
      socket.to(roomOf(world)).emit('playerDisconnected', { id: player.id });
      roomCount(world);
      socket.data.player = null;
    });
  });

  return { io, hub };
}

module.exports = { attachSocket };
