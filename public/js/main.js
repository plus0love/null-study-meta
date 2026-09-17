/* global Phaser, RoomScene, Net, UI, FX, AvatarKit */
/**
 * 부트스트랩: 방 데이터 / 아틀라스 메타 / 아바타 카탈로그·레이어 PNG 를 받아 Phaser 게임을 만들고,
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
  let dog;
  let avatarKit;
  let catalog; // 9단계: 상점 카탈로그 (가구 스프라이트 메타)
  let furn; // 9단계: 가구 아틀라스 (DOM 아이콘용) { img, frames }
  let pets; // 10단계: 펫 시트 메타 + 이미지 { meta, img }
  let petdeco; // 10단계: 꾸미기 아틀라스 { img, frames, slots }
  let config = { passwordRequired: false };
  try {
    room = await fetch('/api/rooms/studyroom').then((r) => r.json());
    const v = room.assetVersion ? `?v=${room.assetVersion}` : '';
    const loadImg = (src) => new Promise((resolve) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => resolve(null); img.src = src; });
    [tiles, dog, avatarKit, config, catalog, furn, pets, petdeco] = await Promise.all([
      fetch('/assets/tiles.json').then((r) => r.json()),
      fetch('/assets/dog.json').then((r) => r.json()),
      AvatarKit.load(room.assetVersion),
      fetch('/api/config').then((r) => r.json()).catch(() => ({ passwordRequired: false })),
      fetch('/api/shop').then((r) => r.json()).catch(() => ({ tabs: [], categories: [], items: [] })),
      fetch(`/assets/furniture.json${v}`).then((r) => r.json()).then((json) => new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ img, frames: json.frames });
        img.onerror = () => resolve({ img: null, frames: json.frames });
        img.src = `/assets/furniture.png${v}`;
      })).catch(() => ({ img: null, frames: {} })),
      fetch(`/assets/pets.json${v}`).then((r) => r.json()).then(async (meta) => ({ meta, img: await loadImg(`/assets/pets.png${v}`) })),
      fetch(`/assets/petdeco.json${v}`).then((r) => r.json()).then(async (json) => ({ img: await loadImg(`/assets/petdeco.png${v}`), frames: json.frames, slots: json.meta.slots })).catch(() => ({ img: null, frames: {}, slots: {} })),
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
  const ui = new UI({ room, serverNow: () => net.serverNow(), avatarKit, catalog, furn, pets, petdeco });
  const sound = new FX.Sound();

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
  await new Promise((onReady) => game.scene.add('room', scene, true, { room, tiles, avatarKit, dog, pets: pets.meta, catalog, onReady }));
  ui.hideLoading();

  // ── 씬 → 네트워크/UI ───────────────────────────────────────────
  scene.hooks.onMove = (p) => net.move(p);
  scene.hooks.onSit = (seatId) => net.sit(seatId).then((r) => { if (!r.ok && r.error === 'occupied') ui.notify('이미 누가 앉아 있어요.'); }).catch(() => {});
  scene.hooks.onStand = () => net.stand().catch(() => {});
  scene.hooks.onInteract = (mode) => ui.setSitHint(mode || (scene.me && scene.me.seated ? 'stand' : null));
  scene.hooks.onPet = (id) => net.petNpc(id).catch(() => {}); // 쿨다운/거리 거부는 조용히 무시
  scene.hooks.onUse = (kind, id) => {
    if (kind === 'music') return ui.openMusic(); // 소리는 본인에게만 → 서버는 모른다
    net.interact(id).then((r) => { if (!r.ok && r.error === 'too_far') ui.notify('조금 더 가까이 가 주세요.'); }).catch(() => {});
  };
  scene.hooks.onEmojiKey = (i) => net.emoji(i).catch(() => {});
  scene.hooks.onChatKey = () => ui.focusChat();
  scene.hooks.onPositions = (map) => ui.drawMinimap(map);
  scene.hooks.serverNow = () => net.serverNow(); // 머리 위 뽀모도로 남은 시간 (8단계)
  // 9단계 편집: 씬이 서버 판정을 기다린다 (배치·잡기·이동·회수). 거부 사유는 UI 가 안내한다
  scene.hooks.onPlace = (inventoryId, x, y, rotation) => net.layoutPlace(inventoryId, x, y, rotation).then((r) => { if (r.ok) ui.refreshEdit(); return r; }).catch(() => ({ ok: false }));
  scene.hooks.onGrab = (id) => net.layoutGrab(id).then((r) => { if (!r.ok) ui.editError(r.error); return r; }).catch(() => ({ ok: false }));
  scene.hooks.onRelease = (id) => net.layoutRelease(id).catch(() => {});
  scene.hooks.onMove2 = (id, x, y, rotation) => net.layoutMove(id, x, y, rotation).catch(() => ({ ok: false }));
  scene.hooks.onRemove = (id) => net.layoutRemove(id).then((r) => { if (r.ok) ui.refreshEdit(); return r; }).catch(() => ({ ok: false }));
  scene.hooks.onEditState = (st) => ui.setEditState(st);
  ui.getLayout = () => (scene.furniture ? [...scene.furniture.entries.values()] : []);
  ui.onEditToggle = (on) => net.setEditing(on).then((r) => { if (r.ok) { scene.setEditMode(r.editing); ui.setEditMode(r.editing); } }).catch(() => {});
  ui.onPlaceItem = (item, variant, inventoryId) => scene.startPlacing(item, variant, inventoryId);
  ui.onRemoveEntry = (id) => net.layoutRemove(id).then((r) => { if (!r.ok) ui.editError(r.error); else ui.refreshEdit(); }).catch(() => {});
  ui.onDeskEquip = (slots) => net.equipDesk(slots).then((r) => { if (!r.ok) ui.notify('책상 소품을 장착하지 못했어요.'); return r; }).catch(() => ({ ok: false }));
  ui.onLayoutLock = (on) => net.layoutLock(on).catch(() => {});
  net.on('layout:update', (e) => { scene.onLayoutUpdate(e); ui.onLayoutChanged(e); });
  net.on('playerDesk', (d) => { scene.onPlayerDesk(d); if (scene.me && d.id === scene.me.id) ui.setDeskItems(d.deskItems); });
  net.on('playerEdit', (d) => scene.onPlayerEdit(d));

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
  ui.onAvatar = (avatar) => net.setAvatar(avatar).catch(() => {});
  ui.onPomodoro = (action, cfg) => {
    // 시작 버튼(사용자 제스처)에서 브라우저 알림 권한을 한 번 물어본다
    if (action === 'start' && FX.Notify.permission() === 'default') FX.Notify.request().then((st) => ui.setNotifyPermission(st));
    return (action === 'start' ? net.pomodoroStart(cfg) : net.pomodoroStop()).then((r) => {
      if (r.ok) ui.setPomodoro(r); // ack 에 내 타이머 스냅샷이 실려 온다
      else if (r.error === 'invalid_focus' || r.error === 'invalid_break') ui.notify('집중 20~90분, 휴식 5~20분 사이로 정해 주세요.');
    }).catch(() => {});
  };
  // 화면 크기 / 넓게 보기 (7단계): 씬 카메라 줌 · 캔버스 크기 재계산
  ui.onZoom = (z) => scene.setZoom(z);
  // Phaser RESIZE 모드는 window resize 만 듣는다 → 사이드바를 접고 나서 그 이벤트를 흉내 내 캔버스를 다시 잰다
  const refit = () => requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  ui.onWide = refit;
  scene.setZoom(ui.zoom);
  refit();
  // 내 기록 초기화: 서버가 토큰·닉네임 확인 → 목표/할 일/랭킹 화면도 비운다
  ui.onReset = async (nickname) => {
    const r = await net.resetProfile(nickname);
    if (r.ok) {
      ui.setGoal(null);
      ui.setTodos([]);
      if (scene.me) scene.me.setGoal(null);
      ui.toast('내 기록을 초기화했어요 🧹');
      ui.addChat({ system: true, text: '공부 세션 · 출석 · 목표 · 할 일을 모두 지웠어요.' });
      refreshStats();
    }
    return r;
  };
  ui.onLeave = async () => {
    clearInterval(statsTimer);
    await net.leave();
    scene.clearSession();
    ui.setPlayers([]);
    ui.setRoomCount(0);
    ui.setSitHint(null);
    startLogin({ error: '' });
  };
  ui.onRename = () => ui.onLeave();
  ui.onNpcName = (name, id = 'dog') => net.setNpcName(id, name).then((r) => { if (!r.ok) ui.notify(r.error === 'forbidden' ? '이름은 푼 사람만 바꿀 수 있어요.' : r.error || '이름을 바꾸지 못했어요.'); else ui.refreshWallet(); return r; }).catch(() => ({ ok: false }));
  // ── 펫 (10단계) ──
  ui.onPetConfig = (cfg) => net.petConfig(cfg).then((r) => { if (!r.ok) ui.notify({ invalid_name: '펫 이름은 8자 이내 문자·숫자예요.', wrong_slot: '그 슬롯에 맞는 꾸미기가 아니에요.' }[r.error] || '펫 설정을 저장하지 못했어요.'); return r; }).catch(() => ({ ok: false }));
  ui.onPetRelease = (inventoryId, name) => net.petRelease(inventoryId, name).then((r) => { if (!r.ok) ui.notify({ room_full: '방에는 공용 펫을 3마리까지만 풀 수 있어요.', already_released: '이미 방에 있어요.', invalid_name: '펫 이름은 8자 이내예요.' }[r.error] || '풀지 못했어요.'); else ui.toast(`${r.pet.name} 을(를) 방에 풀었어요 🐾`); return r; }).catch(() => ({ ok: false }));
  ui.onPetRecall = (id) => net.petRecall(id).then((r) => { if (!r.ok) ui.notify(r.error === 'forbidden' ? '푼 사람만 회수할 수 있어요.' : '회수하지 못했어요.'); return r; }).catch(() => ({ ok: false }));
  ui.onPetDeco = (id, slots) => net.petDeco(id, slots).then((r) => { if (!r.ok) ui.notify(r.error === 'forbidden' ? '푼 사람만 꾸밀 수 있어요.' : '장착하지 못했어요.'); return r; }).catch(() => ({ ok: false }));
  net.on('npc:remove', (d) => { scene.removeNpc(d.id); ui.onNpcRemoved(d.id); });
  ui.onListening = (title) => net.setListening(title).catch(() => {});

  // ── 공부 기록: 할 일(서버 저장) · 오늘 목표 · 랭킹 (5초 폴링 + leaderboard:refresh) ──
  const STATS_POLL_MS = 5000;
  const storeError = () => ui.notify('저장소 오류가 났어요. 잠시 후 다시 시도해 주세요.');
  const reloadTodos = () => net.todoList().then((r) => { if (r.ok) ui.setTodos(r.todos); else storeError(); }).catch(() => {});
  ui.onTodoAdd = (text) => net.todoAdd(text).then((r) => (r.ok ? reloadTodos() : storeError())).catch(() => {});
  ui.onTodoToggle = (id, done) => net.todoToggle(id, done).then((r) => (r.ok ? reloadTodos() : storeError())).catch(() => {});
  ui.onTodoDelete = (id) => net.todoDelete(id).then((r) => (r.ok ? reloadTodos() : storeError())).catch(() => {});
  /** 3단계까지 localStorage 에 있던 할 일은 첫 접속 때 서버로 옮긴다 (서버 목록이 비어 있을 때만) */
  const migrateTodos = async () => {
    const r = await net.todoList();
    if (!r.ok) return storeError();
    const legacy = r.todos.length ? [] : ui.takeLegacyTodos();
    for (const t of legacy) {
      const added = await net.todoAdd(t.text);
      if (added.ok && t.done) await net.todoToggle(added.todo.id, true);
    }
    if (legacy.length) ui.addChat({ system: true, text: `예전 할 일 ${legacy.length}개를 서버로 옮겼어요.` });
    return reloadTodos();
  };
  ui.onGoalSave = (goal) => net.setGoal(goal).then((r) => {
    if (!r.ok) return ui.notify(r.error === 'text_too_long' ? '목표는 20자까지예요.' : r.error === 'invalid_minutes' ? '목표 시간은 30분~8시간, 30분 단위예요.' : '목표를 저장하지 못했어요.');
    ui.setGoal(r.goal);
    if (scene.me) scene.me.setGoal(r.goal);
    ui.toast('오늘 목표를 저장했어요 ✍️');
    refreshStats();
  }).catch(() => {});
  let statsTimer = null;
  const refreshStats = () => {
    if (!net.connected || !scene.me) return;
    net.stats().then((r) => {
      if (!r.ok) return;
      ui.setStats(r);
      scene.applyProgress(r.rows);
    }).catch(() => {});
  };
  const startStatsPolling = () => {
    clearInterval(statsTimer);
    statsTimer = setInterval(refreshStats, STATS_POLL_MS);
    refreshStats();
  };
  net.on('leaderboard:refresh', () => refreshStats());
  net.on('playerGoal', (d) => scene.onGoal(d));
  net.on('attendance', ({ streak }) => ui.toast(`${streak}일 연속 출석 🔥`));
  net.on('goalReached', (d) => {
    scene.onGoalReached(d);
    sound.chime('goal');
    if (scene.me && d.id === scene.me.id) ui.toast('오늘 목표 달성 🎉');
  });
  // 설정: 항상 밤 / 알림 소리 / 코인 소리 / 브라우저 알림
  scene.setAlwaysNight(ui.alwaysNight);
  ui.onAlwaysNight = (on) => scene.setAlwaysNight(on);
  ui.setSoundEnabled(sound.enabled);
  ui.onSound = (on) => sound.setEnabled(on);
  ui.setCoinSoundEnabled(sound.coinEnabled);
  ui.onCoinSound = (on) => sound.setCoinEnabled(on);

  // ── 코인 / 지갑 (8단계): 판정은 서버, 여기서는 결과만 보여준다 ──────────
  ui.onWallet = () => net.wallet();
  ui.onBuy = (itemId, variant, target) => net.buy(itemId, variant, target).catch(() => ({ ok: false }));
  net.on('coins', (d) => {
    scene.onCoins(d); // 머리 위 "+N 🪙" (남의 것도)
    if (!scene.me || d.id !== scene.me.id) return;
    if (d.balance !== undefined) ui.setCoins(d.balance, { bump: true });
    sound.coin(d.delta);
    if (d.delta > 0) ui.toast(d.reason === 'focus' ? `집중 완주 보너스 +${d.delta} 🪙` : `+${d.delta} 🪙`);
    if (ui.isWalletOpen()) ui.refreshWallet();
  });
  net.on('playerPomodoro', (d) => scene.onPlayerPomodoro(d));
  ui.setNotifyPermission(FX.Notify.permission());
  ui.onNotifyPerm = () => FX.Notify.request().then((st) => ui.setNotifyPermission(st));

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
    const profile = ack.profile || {};
    ui.setGoal(profile.goal || null);
    ui.setCoins(profile.coins || 0);
    ui.setDeskItems(ack.self.deskItems || [null, null, null]);
    ui.setEditMode(false);
    scene.setEditMode(false);
    if (profile.streak && profile.streak.attendedToday) ui.toast(`${profile.streak.streak}일 연속 출석 🔥`);
    migrateTodos();
    startStatsPolling();
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
  net.on('avatar:update', (d) => {
    scene.onAvatar(d);
    ui.upsertPlayer({ id: d.id, avatar: d.avatar });
    if (scene.me && d.id === scene.me.id) ui.setAvatar(d.avatar);
  });
  net.on('playerListening', (d) => {
    scene.onListening(d);
    ui.upsertPlayer({ id: d.id, listening: d.listening });
  });
  net.on('playerEmoji', (d) => scene.onEmoji(d));
  net.on('chat', (d) => {
    if (d.system) return ui.addChat({ system: true, text: d.text });
    scene.onChat(d);
    ui.addChat({ nickname: d.nickname, text: d.text, ts: d.ts, self: scene.me && d.id === scene.me.id });
  });
  net.on('npc:update', (d) => { scene.upsertNpc(d); ui.onNpcUpdate(d); });
  net.on('npc:pet', (d) => scene.onNpcPet(d));
  net.on('npc:name', (d) => { scene.onNpcName(d); ui.setNpcName(d.id, d.name); });
  net.on('pomodoro', (snap) => {
    // 7단계: 내 타이머만 온다 (시작/정지는 ack 로 이미 반영, 여기서는 자동 전환을 알린다)
    const prev = ui.pomodoro;
    ui.setPomodoro(snap);
    if (!prev) return;
    if (snap.running && prev.running && snap.phase !== prev.phase) {
      // 집중 ↔ 휴식 전환: 알림음 + 창문·펜던트 플래시 + 브라우저 알림(권한 있을 때)
      const isBreak = snap.phase === 'break';
      const mins = Math.round((isBreak ? snap.breakMs : snap.focusMs) / 60000);
      ui.notify(isBreak ? `휴식 시간이에요 ☕ (${mins}분)` : `다시 집중할 시간이에요 📖 (${mins}분)`);
      sound.chime(isBreak ? 'break' : 'focus');
      scene.flashLights();
      FX.Notify.show(isBreak ? '휴식 시간이에요 ☕' : '다시 집중할 시간이에요 📖', isBreak ? '5분 쉬고 와요.' : '25분 집중!');
    }
  });

  // 30초마다 서버 시각 재동기화 (뽀모도로 게이지)
  setInterval(() => { if (net.connected) net.syncTime(); }, 30000);

  // ── 입장 ───────────────────────────────────────────────────────
  /** 서버 join 거부 → 사용자에게 보여줄 Error (retryAfterMs / clearPassword 는 입장 모달이 읽는다) */
  function joinError(err) {
    const ack = err.ack || {};
    const out = new Error(err.message);
    if (err.message === 'not_connected') out.message = '서버에 연결할 수 없어요.';
    else if (err.message === 'password_required') { out.message = '방 비밀번호를 입력해 주세요.'; out.clearPassword = true; }
    else if (err.message === 'wrong_password') { out.message = `비밀번호가 틀렸어요. (남은 횟수 ${ack.remaining}회)`; out.clearPassword = true; }
    else if (err.message === 'locked') { out.message = '비밀번호를 여러 번 틀렸어요. 잠시 뒤에 다시 시도해 주세요.'; out.retryAfterMs = ack.retryAfterMs || 30000; out.clearPassword = true; }
    return out;
  }

  function startLogin({ error = '', retryAfterMs = 0 } = {}) {
    const saved = Net.saved();
    ui.showLogin({ nickname: saved.nickname, avatar: saved.avatar, error, passwordRequired: config.passwordRequired, password: saved.password }, async ({ nickname, avatar, password }) => {
      net.connect();
      try {
        await net.join({ nickname, avatar, password });
      } catch (err) {
        throw joinError(err);
      }
    });
    if (retryAfterMs > 0) ui.lockLogin(retryAfterMs);
  }

  const saved = Net.saved();
  ui.setAvatar(saved.avatar);
  // 비밀번호 방인데 기억한 비밀번호가 없으면 자동 재입장 대신 모달을 띄운다 (토큰이 살아 있으면 서버가 안 물어보지만, 재시작됐을 수 있다)
  if (saved.token && saved.nickname && (!config.passwordRequired || saved.password)) {
    net.connect();
    try {
      await net.join({ nickname: saved.nickname, avatar: saved.avatar, password: saved.password });
    } catch (err) {
      const e = joinError(err);
      startLogin({ error: e.message, retryAfterMs: e.retryAfterMs || 0 });
    }
  } else {
    startLogin();
  }

  // 디버그/테스트용 전역 핸들
  window.NSM = { game, room, net, ui, scene, sound, avatarKit, catalog };
})();
