/* global Phaser, RoomScene, Net, UI */
/**
 * 부트스트랩: 방 데이터 / 아틀라스 메타 / 아바타 메타를 받아 Phaser 게임을 만들고,
 * 소켓(Net) · HUD/사이드바(UI) · 씬(RoomScene) 을 서로 연결한다.
 *
 * 입장 흐름: localStorage 에 세션 토큰이 있으면 바로 재입장 시도(서버가 기억하면 이어받고, 재시작됐으면
 * 저장된 닉네임·아바타로 새 입장). 토큰이 없으면 입장 모달.
 */
(async function main() {
  'use strict';

  const loading = document.getElementById('loading');
  const fail = (msg) => {
    if (loading) loading.textContent = msg;
    console.error(msg);
  };

  let room;
  let tiles;
  let player;
  let dog;
  try {
    [room, tiles, player, dog] = await Promise.all([
      fetch('/api/rooms/studyroom').then((r) => r.json()),
      fetch('/assets/tiles.json').then((r) => r.json()),
      fetch('/assets/player.json').then((r) => r.json()),
      fetch('/assets/dog.json').then((r) => r.json()),
    ]);
  } catch (err) {
    fail(`방 데이터를 불러오지 못했습니다: ${err.message}`);
    return;
  }

  // 웹폰트(손글씨 Gaegu / 산세리프 Pretendard)가 준비된 뒤 텍스트를 그려야 폭이 맞는다. 실패해도 진행.
  try {
    await Promise.race([
      Promise.all([document.fonts.load('24px Gaegu'), document.fonts.load('600 14px Pretendard'), document.fonts.load('400 14px Pretendard')]),
      new Promise((r) => setTimeout(r, 3000)),
    ]);
  } catch (_) { /* 폰트 없이 진행 */ }

  const net = new Net();
  const ui = new UI({ room, serverNow: () => net.serverNow() });

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    pixelArt: true,
    roundPixels: true,
    antialias: false,
    backgroundColor: '#14111a',
    scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.NO_CENTER, width: '100%', height: '100%' },
    // 프레임이 크게 밀려도 한 프레임 이동량이 50ms 치(7.5px)를 넘지 않게 → 벽 뚫림/서버 거부 방지
    fps: { min: 20 },
    scene: [],
  });
  // 부팅 중에는 add() 가 인스턴스를 돌려주지 않으므로 직접 만들어 넘긴다
  const scene = new RoomScene();
  await new Promise((onReady) => game.scene.add('room', scene, true, { room, tiles, player, dog, onReady }));
  ui.hideLoading();

  // ── 씬 → 네트워크/UI ───────────────────────────────────────────
  scene.hooks.onMove = (p) => net.move(p);
  scene.hooks.onSit = (seatId) => net.sit(seatId).then((r) => { if (!r.ok && r.error === 'occupied') ui.notify('이미 누가 앉아 있어요.'); }).catch(() => {});
  scene.hooks.onStand = () => net.stand().catch(() => {});
  scene.hooks.onInteract = (mode) => ui.setSitHint(mode || (scene.me && scene.me.seated ? 'stand' : null));
  scene.hooks.onPet = (id) => net.petNpc(id).catch(() => {}); // 쿨다운/거리 거부는 조용히 무시
  scene.hooks.onEmojiKey = (i) => net.emoji(i).catch(() => {});
  scene.hooks.onChatKey = () => ui.focusChat();
  scene.hooks.onPositions = (map) => ui.drawMinimap(map);

  // 채팅/할 일 입력 중엔 게임 키 차단
  const isField = (el) => Boolean(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'));
  document.addEventListener('focusin', (e) => { if (isField(e.target)) scene.setInputEnabled(false); });
  document.addEventListener('focusout', (e) => { if (!isField(e.relatedTarget)) scene.setInputEnabled(true); });

  // ── UI → 네트워크 ──────────────────────────────────────────────
  ui.onChat = (text) => net.chat(text).then((r) => {
    if (r.ok) return;
    if (r.error === 'too_fast') ui.addChat({ system: true, text: '너무 빨라요. 잠시 후 다시 보내주세요.' });
    else if (r.error === 'too_long') ui.addChat({ system: true, text: '메시지는 200자까지예요.' });
  }).catch(() => {});
  ui.onEmoji = (i) => net.emoji(i).catch(() => {});
  ui.onToggleStatus = () => net.setStatus(ui.status === 'study' ? 'rest' : 'study').catch(() => {});
  ui.onAvatar = (i) => net.setAvatar(i).catch(() => {});
  ui.onPomodoro = (action) => (action === 'start' ? net.pomodoroStart() : net.pomodoroStop()).catch(() => {});
  ui.onLeave = async () => {
    await net.leave();
    scene.clearSession();
    ui.setPlayers([]);
    ui.setRoomCount(0);
    ui.setSitHint(null);
    startLogin({ error: '' });
  };
  ui.onRename = () => ui.onLeave();
  ui.onNpcName = (name) => net.setNpcName('dog', name).then((r) => { if (!r.ok) ui.notify(r.error || '이름을 바꾸지 못했어요.'); }).catch(() => {});

  // ── 네트워크 → 씬/UI ───────────────────────────────────────────
  const applySession = (ack) => {
    scene.applySession(ack);
    ui.setSelf(ack.self.id, ack.self.nickname);
    ui.setAvatar(ack.self.avatar);
    ui.setEmojis(ack.config.emojis);
    ui.setPlayers([ack.self, ...ack.players]);
    ui.setRoomCount([ack.self, ...ack.players].filter((p) => p.connected !== false).length);
    ui.setStatus(ack.self.status);
    ui.setPomodoro(ack.pomodoro);
    ui.setOffline(false);
    ui.setSitHint(ack.self.seatId ? 'stand' : null);
    ui.setNpcs(ack.npcs || []);
  };
  net.on('session', applySession);
  net.on('sessionLost', () => ui.addChat({ system: true, text: '서버가 다시 시작되어 새로 입장했어요.' }));
  net.on('offline', () => ui.setOffline(true)); // 배너는 재입장 ack(session) 에서 내린다

  net.on('playerJoined', ({ player: p }) => {
    scene.addRemote(p);
    ui.upsertPlayer(p);
    ui.notify(`${p.nickname} 님이 입장했어요.`);
    ui.addChat({ system: true, text: `${p.nickname} 님이 입장했어요.` });
  });
  net.on('playerLeft', ({ id, nickname }) => {
    scene.removeRemote(id);
    ui.removePlayer(id);
    ui.notify(`${nickname} 님이 나갔어요.`);
    ui.addChat({ system: true, text: `${nickname} 님이 나갔어요.` });
  });
  net.on('playerReconnected', ({ id, player: p }) => {
    if (scene.remotes.has(id)) {
      scene.onPresence(id, true);
      const a = scene.avatarOf(id);
      if (a) a.setPosition(p.x, p.y);
    } else scene.addRemote(p);
    ui.upsertPlayer(p);
  });
  net.on('playerDisconnected', ({ id }) => {
    scene.onPresence(id, false);
    ui.upsertPlayer({ id, connected: false });
  });
  net.on('roomCount', ({ count }) => ui.setRoomCount(count));
  net.on('playerMoved', (d) => scene.onRemoteMoved(d));
  net.on('move:correct', (d) => scene.onCorrect(d));
  net.on('playerSat', (d) => {
    scene.onSat(d);
    ui.upsertPlayer({ id: d.id, status: d.status, seatId: d.seatId });
    if (scene.me && d.id === scene.me.id) { ui.setStatus(d.status); ui.setSitHint('stand'); }
  });
  net.on('playerStood', (d) => {
    scene.onStood(d);
    ui.upsertPlayer({ id: d.id, status: d.status, seatId: null });
    if (scene.me && d.id === scene.me.id) { ui.setStatus(d.status); ui.setSitHint(null); }
  });
  net.on('playerStatus', (d) => {
    scene.onStatus(d);
    ui.upsertPlayer({ id: d.id, status: d.status });
    if (scene.me && d.id === scene.me.id) ui.setStatus(d.status);
  });
  net.on('playerAvatar', (d) => {
    scene.onAvatar(d);
    ui.upsertPlayer({ id: d.id, avatar: d.avatar });
  });
  net.on('playerEmoji', (d) => scene.onEmoji(d));
  net.on('chat', (d) => {
    if (d.system) return ui.addChat({ system: true, text: d.text });
    scene.onChat(d);
    ui.addChat({ nickname: d.nickname, text: d.text, ts: d.ts, self: scene.me && d.id === scene.me.id });
  });
  net.on('npc:update', (d) => scene.upsertNpc(d));
  net.on('npc:pet', (d) => scene.onNpcPet(d));
  net.on('npc:name', (d) => { scene.onNpcName(d); ui.setNpcName(d.id, d.name); });
  net.on('pomodoro', (snap) => {
    const prev = ui.pomodoro;
    ui.setPomodoro(snap);
    if (!prev) return;
    if (snap.running && !prev.running) ui.notify(`${snap.startedBy || '누군가'} 님이 뽀모도로를 시작했어요.`);
    else if (!snap.running && prev.running) ui.notify(`${snap.startedBy || '누군가'} 님이 뽀모도로를 정지했어요.`);
    else if (snap.running && snap.phase !== prev.phase) ui.notify(snap.phase === 'break' ? '휴식 시간이에요 ☕ (5분)' : '다시 집중할 시간이에요 📖 (25분)');
  });

  // 30초마다 서버 시각 재동기화 (뽀모도로 게이지)
  setInterval(() => { if (net.connected) net.syncTime(); }, 30000);

  // ── 입장 ───────────────────────────────────────────────────────
  function startLogin({ error = '' } = {}) {
    const saved = Net.saved();
    ui.showLogin({ nickname: saved.nickname, avatar: saved.avatar, error }, async ({ nickname, avatar }) => {
      net.connect();
      await net.join({ nickname, avatar });
    });
  }

  const saved = Net.saved();
  if (saved.token && saved.nickname) {
    net.connect();
    try {
      await net.join({ nickname: saved.nickname, avatar: saved.avatar });
    } catch (err) {
      startLogin({ error: err.message === 'not_connected' ? '서버에 연결할 수 없어요.' : err.message });
    }
  } else {
    startLogin();
  }

  // 디버그/테스트용 전역 핸들
  window.NSM = { game, room, net, ui, scene };
})();
