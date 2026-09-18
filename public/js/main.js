/* global Phaser, RoomScene, Net, UI, FX, AvatarKit */
/**
 * 부트스트랩: 방 데이터 / 아틀라스 메타 / 아바타 카탈로그·레이어 PNG 를 받아 Phaser 게임을 만들고,
 * 소켓(Net) · HUD/사이드바(UI) · 씬(RoomScene) 을 서로 연결한다.
 *
 * 입장 흐름 (11단계): 닉네임·아바타(+사이트 비밀번호) → 로비(내 스터디 / 다른 스터디 / 만들기 / 코드) → 스터디.
 *  - ?study=CODE 링크면 로비를 건너뛰고 그 스터디로. 마지막 들어간 스터디(localStorage nsm.lastStudy)가 있으면 다음 접속 때 바로 입장.
 *  - 잠긴 스터디는 비밀번호 모달 → 맞춘 값은 스터디별 localStorage. 소속되면 서버가 다시 묻지 않는다 (방장이 바꾸면 다시).
 *  - 세션 토큰이 살아 있으면 서버가 이어받는다 (재접속). 나가기 → 로비. 내보내짐/삭제 → 로비.
 *  - 그룹 주간 목표 달성(studyGoal): 창밖 불꽃놀이 10초 + 조명 플래시 + 차임 + 토스트. 오프라인 사이 달성분은 입장 ack profile.rewards 로 토스트.
 * 12단계 야외: 세션 ack 의 room 이 지금 씬의 맵과 다르면 /api/rooms/<id> 를 받아(한 번만) 씬을 restart 하고 미니맵을 바꾼다 (ensureRoom).
 *  - 문 밟기 → net.door() → 'session' → 같은 흐름. 탈것 V(mount/dismount) · H(경적) · 아바타 클릭 프로필 · 전광판 E · 랩 HUD/완주 연출(🏁 + 차임 + 토스트).
 * 15단계: 남의 자리 앞 E → 앉기/쪽지 선택 → 쪽지 모달 → note:leave. 내 자리에 쪽지가 있으면(note:waiting) 앉은 채 E → note:read → 읽기 모달.
 *  - 커피 코너 E → 커피 모달(마시기 = interact / 배달 = coffee:gift). coffee:received 토스트, playerBuff → ❤️☕, seatItems → 책상 위 머그·쪽지 아이콘.
 *  - D-day: 입장 ack profile.ddays(칠판 목록 + 당일 연출: 기념일 하트 폭죽 · 시험 응원 문구), 설정에서 등록/삭제, 공용이 바뀌면 dday:update 로 다시 받는다.
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
  let vehicles; // 12단계: 탈것 아틀라스 { img, frames, meta }
  let animals; // 14단계: 동물 시트 메타 { meta, img }
  let fish; // 14단계: 물고기 시트 { meta, img } (도감 아이콘 · 어항)
  let npcs; // 18단계: 사람 NPC 시트 메타 (점원·바리스타)
  let config = { passwordRequired: false };
  try {
    room = await fetch('/api/rooms/studyroom').then((r) => r.json());
    const v = room.assetVersion ? `?v=${room.assetVersion}` : '';
    const loadImg = (src) => new Promise((resolve) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => resolve(null); img.src = src; });
    [tiles, dog, avatarKit, config, catalog, furn, pets, petdeco, vehicles, animals, fish, npcs] = await Promise.all([
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
      fetch(`/assets/vehicles.json${v}`).then((r) => r.json()).then(async (json) => ({ img: await loadImg(`/assets/vehicles.png${v}`), frames: json.frames, meta: json.meta })).catch(() => ({ img: null, frames: {}, meta: { seat: {}, decal: {} } })),
      fetch(`/assets/animals.json${v}`).then((r) => r.json()).then(async (meta) => ({ meta, img: await loadImg(`/assets/animals.png${v}`) })).catch(() => ({ meta: null, img: null })),
      fetch(`/assets/fish.json${v}`).then((r) => r.json()).then(async (meta) => ({ meta, img: await loadImg(`/assets/fish.png${v}`) })).catch(() => ({ meta: null, img: null })),
      fetch(`/assets/npcs.json${v}`).then((r) => r.json()).catch(() => null),
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
  const ui = new UI({ room, serverNow: () => net.serverNow(), avatarKit, catalog, furn, pets, petdeco, vehicles, tiles, fish });
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
  const sceneData = (r, onReady) => ({ room: r, tiles, avatarKit, dog, pets: pets.meta, vehicles: vehicles.meta, animals: animals.meta, fish: fish.meta, npcs, catalog, onReady });
  await new Promise((onReady) => game.scene.add('room', scene, true, sceneData(room, onReady)));
  ui.hideLoading();

  // ── 12단계: 맵 전환 (studyroom ↔ outdoor). 방 데이터는 한 번만 받아 둔다 ──
  const rooms = { [room.id]: room };
  const loadRoom = async (id) => {
    if (!rooms[id]) rooms[id] = await fetch(`/api/rooms/${id}`).then((r) => r.json());
    return rooms[id];
  };
  let switching = null;
  const ensureRoom = async (id) => {
    if (switching) await switching;
    if (scene.room && scene.room.id === id) return scene.room;
    switching = (async () => {
      const data = await loadRoom(id);
      ui.setRoom(data);
      await new Promise((onReady) => scene.scene.restart(sceneData(data, onReady)));
      scene.setZoom(ui.zoom);
      return data;
    })().finally(() => { switching = null; });
    return switching;
  };

  // ── 씬 → 네트워크/UI ───────────────────────────────────────────
  scene.hooks.onMove = (p) => net.move(p);
  scene.hooks.onSit = (seatId) => net.sit(seatId).then((r) => { if (!r.ok && r.error === 'occupied') ui.notify('이미 누가 앉아 있어요.'); }).catch(() => {});
  scene.hooks.onStand = () => net.stand().catch(() => {});
  scene.hooks.onInteract = (mode) => ui.setSitHint(mode || (scene.me && scene.me.seated ? 'stand' : null));
  scene.hooks.onPet = (id) => net.petNpc(id).catch(() => {}); // 쿨다운/거리 거부는 조용히 무시
  scene.hooks.onUse = (kind, id) => {
    if (kind === 'music') return ui.openMusic(); // 소리는 본인에게만 → 서버는 모른다
    if (kind === 'coffee') return ui.openCoffee(); // 15단계: 마시기 / 배달 메뉴
    if (kind === 'board') return ui.openBoard(); // 12단계: 전광판
    if (kind === 'shop') return ui.openWallet('mount'); // 12단계: 카트 정류장 → 탈것 상점
    // 14단계 동물원: 안내판(클라이언트 데이터) · 먹이 주기 · 매점
    if (kind === 'sign') return ui.showSign(((scene.room.zoo && scene.room.zoo.enclosures) || []).find((e) => e.id === String(id).slice(5)));
    if (kind === 'feed') {
      return net.zooFeed(String(id).slice(5)).then((r) => {
        if (r.ok) ui.toast(`${r.enclosure.name}에게 먹이를 줬어요 ❤️ (오늘 ${r.left}번 남음)`);
        else ui.notify({ limit: '오늘은 먹이를 다 줬어요. 내일 다시 와요!', busy: '지금은 다들 먹는 중이에요. 잠시 뒤에 다시!', too_far: '울타리 앞으로 조금 더 가까이.', riding: '탈것에서 내린 뒤 주세요.', seated: '일어나서 주세요.' }[r.error] || '먹이를 주지 못했어요.');
      }).catch(() => {});
    }
    // 14단계 낚시 · 별자리
    if (kind === 'fish') {
      return net.fishCast(String(id).slice(5)).then((r) => {
        if (r.ok) ui.toast(`🎣 낚싯대를 던졌어요. "!" 가 뜨면 바로 E! (오늘 ${r.left}마리 남음)`);
        else ui.notify({ limit: '오늘은 5마리를 다 잡았어요. 내일 다시 와요!', too_far: '물가 낚시 자리로 조금 더 가까이.', already: '이미 낚시 중이에요.', seated: '일어나서 던져요.', riding: '탈것에서 내린 뒤에요.' }[r.error] || '낚싯대를 던지지 못했어요.');
      }).catch(() => {});
    }
    if (kind === 'reel') {
      return net.fishReel().then((r) => {
        if (r.ok) { ui.toast(`${r.fish.emoji} ${r.fish.name}을(를) 낚았어요!${r.rare ? ' ✨ 희귀!' : ''} (오늘 ${r.left}마리 남음)`, 4000); sound.chime('lap'); }
        else ui.notify({ early: '너무 빨랐어요. "!" 가 뜰 때까지 기다려요.', late: '놓쳤어요… 다음엔 더 빨리!', not_fishing: '낚시 중이 아니에요.' }[r.error] || '놓쳤어요.');
      }).catch(() => {});
    }
    if (kind === 'telescope') {
      return net.skyView().then((r) => {
        if (r.ok) ui.openSky(r.constellation, { first: r.first, index: r.index });
        else ui.notify({ daytime: '낮에는 별이 안 보여요. 밤(19시~6시)에 다시 와요 🌙', too_far: '망원경 앞으로 조금 더 가까이.' }[r.error] || '하늘을 볼 수 없어요.');
      }).catch(() => {});
    }
    if (kind === 'snack') return ui.openSnack(); // 18단계: 매점 창구 → 메뉴 4종 모달
    net.interact(id).then((r) => { if (!r.ok && r.error === 'too_far') ui.notify('조금 더 가까이 가 주세요.'); }).catch(() => {});
  };
  // 18단계: 강아지 E 메뉴(쓰다듬기·산책·재주) · 매점 · NPC 말풍선 · 애정도
  scene.hooks.onDogMenu = (npcId) => ui.openDogMenu(npcId);
  ui.onPet = (id) => net.petNpc(id).catch(() => {});
  ui.onDogInfo = () => net.dogInfo();
  ui.onDogWalk = (on) => net.dogWalk(on).catch(() => ({ ok: false }));
  ui.onDogTrick = (trick) => net.dogTrick(trick).catch(() => ({ ok: false }));
  ui.onSnackMenu = () => net.zooMenu();
  ui.onSnackBuy = (item) => net.zooSnack(item).then((r) => { if (r.ok) { ui.toast(`${r.snack.emoji} 맛있게 드세요! (5분 동안 손에 들어요)`); sound.coin(-1); if (r.balance !== undefined) ui.setCoins(r.balance, { bump: true }); } return r; }).catch(() => ({ ok: false }));
  ui.onStaffName = (id, name) => net.setNpcName(id, name).then((r) => { if (!r.ok) ui.notify(r.error === 'forbidden' ? '방장만 바꿀 수 있어요.' : r.error || '이름을 바꾸지 못했어요.'); return r; }).catch(() => ({ ok: false }));
  net.on('npc:say', (d) => scene.onNpcSay(d));
  net.on('npc:trick', (d) => scene.onNpcTrick(d));
  net.on('dog:walk', (d) => { ui.setDogWalk(d); if (scene.me && d.playerId === scene.me.id && d.on) ui.setSitHint(null); });
  net.on('dog:xp', (d) => { scene.onDogXp(d); if (d.affection && ui.dogInfo) { ui.dogInfo.affection = d.affection; ui.renderDogAffection(ui.dogInfo); } });
  net.on('dog:level', (d) => { ui.toast(`❤️ ${d.dog || '강아지'} 애정도 Lv${d.level}!${d.unlocked && d.unlocked.length ? ` 해금: ${d.unlocked.map((u) => `${u.emoji} ${u.name}`).join(' · ')}` : ''}`, 6000); sound.chime('goal'); ui.refreshDogInfo(); });
  // 15단계: 쪽지 · 커피 · D-day
  const NOTE_ERR = { invalid_target: '자기 자신에게는 남길 수 없어요.', not_member: '스터디 멤버에게만 남길 수 있어요.', empty: '내용을 적어 주세요.', too_long: '쪽지는 60자까지예요.', no_seat: '상대의 자리를 찾지 못했어요.', too_far: '상대 자리 앞으로 조금 더 가까이.' };
  scene.hooks.onSeatChoice = async (seat, owner) => {
    const choice = await ui.askSeatChoice(owner);
    if (choice === 'sit') return scene.sitAt(seat.id);
    if (choice !== 'note') return null;
    const text = await ui.openNoteCompose(owner);
    if (!text) return null;
    scene.flushMove(false);
    return net.noteLeave(owner, text).then((r) => {
      if (r.ok) ui.toast(r.delivered ? `${owner} 님 책상에 쪽지를 놓았어요 ✉️` : `${owner} 님 자리에 쪽지를 남겼어요 ✉️ 앉으면 보여요`);
      else ui.notify(NOTE_ERR[r.error] || '쪽지를 남기지 못했어요.');
      return r;
    }).catch(() => null);
  };
  scene.hooks.onReadNote = () => net.noteRead().then((r) => { if (r.ok) { ui.showNotes(r.notes); scene.setMyNotes(0); ui.refreshNoteCount && ui.refreshNoteCount(); } }).catch(() => {});
  net.on('note:waiting', (d) => { scene.onNoteWaiting(d); ui.toast(`✉️ 책상 위에 쪽지 ${d.notes.length}개 — E 로 읽어요`, 4000); ui.notify(`${d.notes.map((n) => n.from).join(', ')} 님의 쪽지가 책상 위에 있어요 ✉️`); ui.setNoteboxCount(d.notes.length); });
  net.on('note:new', (d) => ui.notify(`${d.from} 님이 내 자리에 쪽지를 남겼어요 ✉️ (앉으면 읽을 수 있어요)`));
  net.on('seatItems', (d) => scene.setSeatItems(d));
  net.on('coffee:received', ({ gift, late }) => {
    const mine = gift.from === ui.selfNickname;
    ui.toast(mine ? `${gift.emoji} ${gift.menuName} 한 잔! 10분 동안 ❤️☕` : `${gift.from}님이 ${gift.emoji} ${gift.menuName}를 ${late ? '놓고 갔어요' : '건넸어요'} — 10분 동안 ❤️☕`, 5000);
    if (!mine) ui.notify(`${gift.from}님이 ${gift.emoji} ${gift.menuName}를 놓고 갔어요`);
    sound.chime('goal');
  });
  net.on('playerBuff', (d) => scene.onBuff(d));
  ui.onCoffeeTargets = () => net.coffeeTargets();
  ui.onCoffeeDrink = () => net.interact('coffee').then((r) => { if (!r.ok && r.error === 'too_far') ui.notify('조금 더 가까이 가 주세요.'); }).catch(() => {});
  ui.onCoffeeGift = (menu, to) => net.coffeeGift(menu, to).then((r) => {
    if (r.ok) { if (r.balance !== undefined) ui.setCoins(r.balance, { bump: true }); ui.toast(to === ui.selfNickname ? `${r.gift.emoji} ${r.gift.menuName} 한 잔 (-1 🪙)` : r.delivered ? `${to} 님에게 ${r.gift.emoji} ${r.gift.menuName}를 건넸어요 (-1 🪙)` : `${to} 님 자리에 ${r.gift.emoji} ${r.gift.menuName}를 놓았어요 (-1 🪙)`); sound.coin(-1); }
    return r;
  }).catch(() => ({ ok: false, error: 'store_error' }));
  ui.onNoteBox = () => net.noteBox();
  const refreshDdays = () => net.ddayList().then((r) => { if (r.ok) { scene.setDdays(r.board); ui.renderDdays(r.ddays); } }).catch(() => {});
  ui.onDdayAdd = (d) => net.ddayAdd(d).then((r) => { if (r.ok) scene.setDdays(r.board); return r; }).catch(() => ({ ok: false, error: 'store_error' }));
  ui.onDdayDelete = (id) => net.ddayDelete(id).then((r) => { if (r.ok) scene.setDdays(r.board); return r; }).catch(() => ({ ok: false, error: 'store_error' }));
  net.on('dday:update', () => { if (!scene.room.outdoor) refreshDdays(); });
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
  // 12단계: 문 · 탈것 · 경적 · 프로필
  scene.hooks.onDoor = () => net.door().then((r) => {
    if (!r.ok) ui.notify({ no_study: '돌아갈 스터디가 없어요. 로비로 가려면 나가기를 눌러 주세요.', study_full: '스터디 정원이 다 찼어요. 잠시 뒤 다시 들어가 보세요.' }[r.error] || '문을 지나지 못했어요.');
    return r;
  }).catch(() => ({ ok: false }));
  scene.hooks.onMount = () => {
    const riding = scene.me && scene.me.riding;
    return (riding ? net.dismount() : net.mount()).then((r) => {
      if (r.ok) return;
      ui.notify({ no_vehicle: '탈것이 없어요. 지갑 → 탈것에서 사고 설정 → 내 탈것에서 골라 주세요.', seated: '앉아 있을 땐 탈 수 없어요.', no_item: '고른 탈것을 찾지 못했어요.', not_outdoor: '탈것은 야외에서만 탈 수 있어요.' }[r.error] || '탈것을 소환하지 못했어요.');
    }).catch(() => {});
  };
  scene.hooks.onCreak = () => sound.creak();
  scene.hooks.onHorn = () => net.horn().then((r) => { if (!r.ok && r.error === 'no_horn') ui.notify('경적이 없어요. 지갑 → 탈것 → 경적'); }).catch(() => {});
  scene.hooks.onProfile = (id) => net.profile(id).then((r) => ui.showProfile(r)).catch(() => {});
  net.on('playerVehicle', (d) => {
    scene.onVehicle(d);
    ui.upsertPlayer({ id: d.id, vehicle: d.vehicle });
    if (scene.me && d.id === scene.me.id) { ui.toast(d.vehicle ? '탑승! 방향키로 달려요 (키를 떼면 미끄러져요) · H 경적 · V 내리기' : '내렸어요'); ui.setLap(null); }
  });
  net.on('playerHorn', (d) => { scene.onHorn(d); sound.horn(d.horn); });
  // 14단계 동물원: 손에 든 간식 · 포토존 플래시
  net.on('playerSnack', (d) => scene.onSnack(d));
  net.on('playerFishing', (d) => {
    scene.onFishing(d);
    if (scene.me && d.id === scene.me.id && d.result && !d.result.ok && d.result.reason === 'miss') ui.notify('놓쳤어요… "!" 가 뜨면 바로 E!');
    if (scene.me && d.id === scene.me.id && d.state === 'bite') sound.coin(1);
  });
  net.on('fish:caught', (d) => scene.onFishCaught(d));
  ui.onCodex = () => net.codex();
  ui.onFishTank = (fishId, on) => net.fishTank(fishId, on);
  net.on('photo', (d) => { scene.onPhoto(d); if (scene.me && d.ids.includes(scene.me.id)) sound.chime('lap'); });
  net.on('lap:progress', (d) => ui.setLap(d));
  net.on('lap', (d) => {
    scene.onLap(d);
    if (scene.me && d.id === scene.me.id) {
      sound.chime('lap');
      ui.setLapBest(d.best);
      ui.toast(`🏁 한 바퀴 ${(d.ms / 1000).toFixed(1)}초${d.isBest ? ' · 개인 최고!' : ''}${d.reward ? ` · 오늘 첫 완주 +${d.reward} 🪙` : ''}`, 4000);
    }
  });
  net.on('track:board', () => { net.trackBoard().then((r) => { if (!r.ok) return; scene.refreshBoard(r); if (ui.isBoardOpen()) ui.renderBoard(r); }).catch(() => {}); });
  ui.onBoard = () => net.trackBoard();
  ui.onVehicleConfig = (cfg) => net.vehicleConfig(cfg).then((r) => { if (!r.ok) ui.notify({ no_item: '없는 아이템이에요.', not_vehicle: '탈것이 아니에요.', not_decal: '데칼이 아니에요.', not_horn: '경적이 아니에요.' }[r.error] || '탈것 설정을 저장하지 못했어요.'); return r; }).catch(() => ({ ok: false }));
  ui.onStatsPublic = (on) => net.setStatsPublic(on).then((r) => { if (r.ok) ui.toast(r.statsPublic ? '이번 주 공부 시간을 공개해요' : '이번 주 공부 시간을 숨겨요'); }).catch(() => {});
  ui.getLayout = () => (scene.furniture ? [...scene.furniture.entries.values()] : []);
  ui.onEditToggle = (on) => net.setEditing(on).then((r) => {
    if (r.ok) { scene.setEditMode(r.editing); ui.setEditMode(r.editing); }
    else if (r.error === 'forbidden') ui.notify('이 스터디는 방장만 가구를 편집할 수 있어요.'); // 11단계 editPolicy 'owner'
  }).catch(() => {});
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
  ui.onToggleStatus = () => net.setStatus(ui.status === 'study' ? 'rest' : 'study').then((r) => { if (r && !r.ok && r.error === 'outdoor') ui.notify('야외에서는 휴식만 할 수 있어요. 공부는 스터디룸에서!'); }).catch(() => {});
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
  /** 방을 비운다 (나가기 · 내보내짐 · 삭제) → 로비 또는 입장 화면 */
  const leaveRoom = () => {
    clearInterval(statsTimer);
    scene.clearSession();
    ui.setPlayers([]);
    ui.setRoomCount(0);
    ui.setSitHint(null);
    ui.setStudy(null);
    ui.closePopovers();
    ui.setEditMode(false);
  };
  ui.onLeave = async () => {
    await net.leave({ keepSocket: true });
    leaveRoom();
    openLobby();
  };
  ui.onRename = async () => {
    await net.leave();
    leaveRoom();
    startLogin({ error: '' });
  };
  // ── 스터디 정보/설정 (11단계) ──
  ui.onNameplate = (text) => scene.setNameplate(text); // 15단계: 문 명패
  ui.onStudyInfo = () => net.studyInfo();
  ui.onStudyUpdate = (patch) => net.studyUpdate(patch).catch(() => ({ ok: false }));
  ui.onStudyKick = (nickname) => net.studyKick(nickname).catch(() => ({ ok: false }));
  ui.onStudyDelete = async () => {
    const r = await net.studyDelete().catch(() => ({ ok: false }));
    if (r.ok) {
      net.dropSession();
      leaveRoom();
      ui.toast('스터디를 삭제했어요');
      openLobby();
    }
    return r;
  };
  net.on('study:update', ({ study, passwordChanged }) => {
    ui.onStudyUpdated(study);
    // 방장이 비밀번호를 바꾸면 이 기기의 접근 토큰은 무효다 (방장 기기는 study:update ack 로 새 토큰을 받는다)
    if (passwordChanged && !study.isOwner && !(ui.study && ui.study.isOwner)) Net.saveStudyAccess(study.code, null);
    if (passwordChanged) ui.notify(study.locked ? '방장이 스터디 비밀번호를 바꿨어요. 다음 입장 때 다시 입력해요.' : '스터디 잠금이 풀렸어요.');
  });
  net.on('kicked', () => {
    if (net.study) Net.saveStudyAccess(net.study.code, null); // 내보내지면 서버가 이 닉네임의 기기 토큰도 지웠다
    net.dropSession();
    leaveRoom();
    openLobby({ error: '방장이 스터디에서 내보냈어요.' });
  });
  net.on('study:deleted', () => {
    net.dropSession();
    leaveRoom();
    openLobby({ error: '스터디가 삭제됐어요.' });
  });
  // 그룹 주간 목표 달성: 창밖 불꽃놀이 10초 + 조명 플래시 + 차임 + 토스트 (코인은 coins 이벤트로 따로 온다)
  net.on('studyGoal', (d) => {
    scene.celebrate(10000);
    scene.flashLights();
    sound.chime('goal');
    ui.toast(`🎆 이번 주 그룹 목표 ${Math.round(d.targetSeconds / 3600)}시간 달성! 멤버 모두 +${d.bonus} 🪙`, 6000);
    FX.Notify.show('그룹 목표 달성 🎆', `${d.name || '스터디'} — 이번 주 ${Math.round(d.targetSeconds / 3600)}시간을 함께 채웠어요`);
    if (!ui.lobbyOpen) ui.refreshStudyInfo();
  });
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
    net.stats(ui.rankScope).then((r) => {
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
  ui.onRankScope = () => refreshStats();
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
    if (d.balance !== undefined) ui.setCoins(d.balance, { bump: true }); // 잔액은 서버가 준 balance 만 (더하기 계산 없음)
    if (d.nextCoinAt !== undefined) ui.setCoinProgress({ carrySeconds: d.carrySeconds, nextCoinAt: d.nextCoinAt, studying: d.nextCoinAt !== null });
    sound.coin(d.delta);
    if (d.delta > 0) ui.toast(d.reason === 'focus' ? `집중 완주 보너스 +${d.delta} 🪙` : d.reason === 'weekly_goal' ? `그룹 목표 보너스 +${d.delta} 🪙` : `+${d.delta} 🪙`);
    if (ui.isWalletOpen()) ui.refreshWallet();
  });
  net.on('coinProgress', (d) => ui.setCoinProgress(d)); // 세션 시작·종료: 지갑 "다음 코인까지" 카운트다운 시작/정지
  net.on('playerPomodoro', (d) => scene.onPlayerPomodoro(d));
  ui.setNotifyPermission(FX.Notify.permission());
  ui.onNotifyPerm = () => FX.Notify.request().then((st) => ui.setNotifyPermission(st));

  // ── 네트워크 → 씬/UI ───────────────────────────────────────────
  const applySession = async (ack) => {
    ui.hideLobby();
    await ensureRoom(ack.room || 'studyroom'); // 12단계: 맵이 다르면 씬을 바꾼다
    if (net.session !== ack) return; // 기다리는 사이 더 새 세션이 왔다
    ui.setStudy(ack.study || null);
    ui.setOutdoor(Boolean(scene.room.outdoor));
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
    // 잔액은 서버가 준 값만. 문 이동 ack 처럼 profile 에 coins 가 없으면 지금 표시를 유지한다 (0 으로 튀지 않게)
    if (profile.coins !== undefined) ui.setCoins(profile.coins);
    if (profile.coinProgress) ui.setCoinProgress(profile.coinProgress);
    ui.setDeskItems(ack.self.deskItems || [null, null, null]);
    ui.setEditMode(false);
    scene.setEditMode(false);
    if (profile.streak && profile.streak.attendedToday) ui.toast(`${profile.streak.streak}일 연속 출석 🔥`);
    // 11단계: 오프라인 사이에 달성된 그룹 목표 보너스
    for (const r of profile.rewards || []) ui.toast(`🎆 ${r.studyName || '스터디'} 그룹 목표 달성 보너스 +${r.coins} 🪙`, 5000);
    if (profile.statsPublic !== undefined) ui.setStatsPublic(profile.statsPublic);
    // 15단계: D-day 칠판 + 당일 연출(서버가 사람·날짜마다 1회만 준다) · 자리에 있는 쪽지·커피는 알림 벨
    if (profile.ddays) {
      scene.setDdays(profile.ddays.board || []);
      for (const c of profile.ddays.celebrate || []) {
        ui.toast(c.text, 6000);
        ui.notify(c.text);
        scene.celebrate(10000, c.effect === 'hearts' ? 'hearts' : 'fireworks');
        scene.flashLights();
        sound.chime('goal');
      }
      refreshDdays();
    } else scene.setDdays([]);
    if (profile.unreadNotes && profile.unreadNotes.length) { ui.notify(`읽지 않은 쪽지 ${profile.unreadNotes.length}개가 자리에 있어요 ✉️ (앉으면 읽을 수 있어요)`); ui.setNoteboxCount(profile.unreadNotes.length); } else ui.setNoteboxCount(0);
    for (const g of profile.pendingGifts || []) ui.notify(`${g.from}님이 ${g.emoji} ${g.menuName}를 자리에 놓고 갔어요 (앉으면 받아요)`);
    if (scene.room.outdoor) {
      if (!ack.resumed) ui.addChat({ system: true, text: '🌳 공용 야외로 나왔어요. 다른 스터디 사람들도 여기서 만나요. 건물 이중문으로 들어가면 내 스터디로 돌아가요.' });
      net.trackBoard().then((r) => { if (r.ok) { scene.refreshBoard(r); ui.setLapBest(r.myBest ? r.myBest.ms : null); } }).catch(() => {});
    } else if (!ack.resumed && ack.study) ui.addChat({ system: true, text: `"${ack.study.name}" 스터디에 들어왔어요. 코드 ${ack.study.code}` });
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
  net.on('playerLeft', ({ id, nickname, reason }) => {
    scene.removeRemote(id);
    ui.removePlayer(id);
    const text = reason === 'outdoor' ? `${nickname} 님이 야외로 나갔어요.` : reason === 'inside' ? `${nickname} 님이 스터디룸으로 들어갔어요.` : `${nickname} 님이 나갔어요.`;
    ui.notify(text);
    ui.addChat({ system: true, text });
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
    if (d.system) {
      if (d.notify) ui.notify(d.text); // 11단계: 목표 달성·펫 풀림 등은 알림 벨에도
      return ui.addChat({ system: true, text: d.text });
    }
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

  // ── 입장: 닉네임 → (사이트 비밀번호) → 로비 / 링크·마지막 스터디로 바로 ───────────
  const params = new URLSearchParams(location.search);
  const linkCode = (params.get('study') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || null;

  /** 서버 거부 → 사용자에게 보여줄 Error (retryAfterMs / clearPassword 는 입장 모달이 읽는다) */
  function joinError(err) {
    const ack = err.ack || {};
    const out = new Error(err.message);
    out.ack = ack;
    if (err.message === 'not_connected') out.message = '서버에 연결할 수 없어요.';
    else if (err.message === 'password_required') { out.message = ack.scope === 'study' ? '스터디 비밀번호를 입력해 주세요.' : '사이트 비밀번호를 입력해 주세요.'; out.clearPassword = true; }
    else if (err.message === 'wrong_password') { out.message = `비밀번호가 틀렸어요. (남은 횟수 ${ack.remaining}회)`; out.clearPassword = true; }
    else if (err.message === 'locked') { out.message = '비밀번호를 여러 번 틀렸어요. 잠시 뒤에 다시 시도해 주세요.'; out.retryAfterMs = ack.retryAfterMs || 30000; out.clearPassword = true; }
    else if (err.message === 'no_study') out.message = '없는 스터디예요. 코드를 확인해 주세요.';
    else if (err.message === 'study_full') out.message = '스터디 정원이 다 찼어요.';
    else if (err.message === 'invalid' || err.message === 'too_short' || err.message === 'too_long') out.message = '닉네임은 문자·숫자·공백·_ - 12자 이내예요.';
    return out;
  }

  let creds = { nickname: '', avatar: null, password: '' }; // 로비에서 쓰는 내 정보

  /** 로비 열기 (소켓은 연결된 채로). 목록을 서버에서 받아 카드로 */
  async function openLobby({ error = '' } = {}) {
    net.connect();
    let data = { mine: [], others: [] };
    try {
      const r = await net.lobbyList(creds.nickname);
      if (r.ok) data = r;
      else if (r.error === 'password_required') return startLogin({ error: '사이트 비밀번호를 입력해 주세요.' });
    } catch (_) { error = error || '스터디 목록을 불러오지 못했어요.'; }
    ui.showLobby({ nickname: creds.nickname, mine: data.mine, others: data.others, error }, {
      onEnter: (code) => enterStudy(code),
      onCreate: async (form) => {
        const r = await net.studyCreate({ ...form, nickname: creds.nickname }).catch(() => ({ ok: false, error: 'store_error' }));
        if (r.ok) enterStudy(r.study.code); // 잠긴 스터디면 만든 기기의 접근 토큰을 net.studyCreate 가 저장해 뒀다
        return r;
      },
      onRename: () => ui.onRename(),
    });
  }

  /**
   * 스터디 입장 (로비·링크·자동). 잠겨 있으면 이 기기의 접근 토큰(localStorage)을 내고, 없거나 무효면 비밀번호 모달을 거듭 띄운다 (취소하면 로비).
   * @returns {Promise<boolean>} 들어갔는지
   */
  async function enterStudy(code, { studyPassword = '', quiet = false } = {}) {
    net.connect();
    let pass = studyPassword;
    let name = code;
    for (;;) {
      try {
        await net.join({ nickname: creds.nickname, avatar: creds.avatar, password: creds.password, study: code, studyPassword: pass });
        return true;
      } catch (err) {
        const e = joinError(err);
        const ack = e.ack || {};
        if (ack.scope === 'study' && (ack.error === 'password_required' || ack.error === 'wrong_password' || ack.error === 'locked')) {
          if (name === code) { try { const l = await net.studyLookup(code); if (l.ok) name = l.study.name; } catch (_) { /* 코드 그대로 */ } }
          const typed = await ui.askStudyPassword({ name, error: ack.error === 'password_required' ? '' : e.message, retryAfterMs: e.retryAfterMs || 0 });
          if (typed === null) { if (!quiet) openLobby(); return false; }
          pass = typed;
          continue;
        }
        if (ack.scope === 'site') { startLogin({ error: e.message, retryAfterMs: e.retryAfterMs || 0 }); return false; }
        if (!quiet || ack.error === 'study_full') openLobby({ error: e.message });
        else openLobby();
        return false;
      }
    }
  }

  function startLogin({ error = '', retryAfterMs = 0 } = {}) {
    const saved = Net.saved();
    const showLogin = (target) => ui.showLogin({ nickname: saved.nickname, avatar: saved.avatar, error, passwordRequired: config.passwordRequired, password: saved.password, target }, async ({ nickname, avatar, password }) => {
      net.connect();
      creds = { nickname, avatar, password };
      if (config.passwordRequired) {
        try { await net.siteAuth(password); } catch (err) { throw joinError(err); }
      }
      Net.save({ nickname, ...(avatar ? { avatar } : {}) });
      if (linkCode) await enterStudy(linkCode);
      else await openLobby();
    });
    if (linkCode && !config.passwordRequired) {
      net.connect();
      net.studyLookup(linkCode).then((l) => showLogin(l.ok ? l.study : null)).catch(() => showLogin(null));
    } else showLogin(null);
    if (retryAfterMs > 0) ui.lockLogin(retryAfterMs);
  }

  const saved = Net.saved();
  ui.setAvatar(saved.avatar);
  creds = { nickname: saved.nickname, avatar: saved.avatar, password: saved.password };
  const autoCode = linkCode || saved.lastStudy || null;
  // 닉네임을 알고(+사이트 비밀번호를 기억하고) 갈 스터디가 있으면 바로 입장 (토큰이 살아 있으면 서버가 이어받는다). 아니면 입장 화면
  if (saved.nickname && autoCode && (!config.passwordRequired || saved.password)) {
    enterStudy(autoCode, { quiet: !linkCode });
  } else {
    startLogin();
  }

  // 디버그/테스트용 전역 핸들
  window.NSM = { game, room, net, ui, scene, sound, avatarKit, catalog, enterStudy, openLobby, ensureRoom, rooms, npcs };
})();
