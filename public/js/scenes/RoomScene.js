/* global Phaser, Daylight, Layout, FurnitureLayer, VehicleView, Vehicles */
/**
 * 방 씬: 서버에서 받은 방 데이터(레이어별 타일 배열)를 타일맵으로 그리고,
 * 내 아바타(입력·충돌·20Hz 전송·서버 보정)와 다른 접속자 아바타(스냅샷 선형 보간)를 그린다.
 * 닉네임·상태 아이콘·채팅 말풍선·이모지는 아바타 머리 위에 붙는다. 조명/비네팅 포함.
 *
 * 외부 연결은 scene.hooks 콜백으로만 한다 (main.js 가 채움):
 *   onMove(payload) · onSit(seatId) · onStand() · onPet(npcId) · onUse(kind, id) · onInteract('sit'|'pet'|'coffee'|'music'|null)
 *   onEmojiKey(i) · onChatKey() · onPositions(map)
 * 강아지 NPC(서버가 행동 결정)는 npc:update 스냅샷을 100ms 늦게 선형 보간해 그린다.
 *
 * 3단계 연출:
 *  - 창밖 하늘: room.windows 사각형에 시간대(daylight.js) 그라데이션 + 별. 낮 창문 타일(windowDay 레이어)은 알파로 교차.
 *  - 유리 스터디룸(room.zones): 어둠 레이어를 더 지워 밝게 + 옅은 하늘빛 틴트 + 창가 쪽 사선 반사.
 *  - 화면(room.screens): 연결된 좌석이 점유되면 모니터/노트북이 켜진다 (서버 좌석 상태 기준).
 *  - 상호작용 지점(room.interactables): 커피머신·음악 패널 앞에서 E.
 *  - 뽀모도로 전환: flashLights() — 창문·펜던트가 1초 밝아졌다 돌아온다.
 * 4단계: 앉아 있고 오늘 목표가 있으면 발 아래에 작은 팻말(목표 텍스트, 말줄임) + 진행 바(오늘 누적/목표). 목표 달성 시 머리 위 🎉 3초.
 * 5단계: 아바타는 파츠 객체 → AvatarKit(avatar.js) 이 레이어를 겹친 시트를 만들고, 씬은 그 시트를 텍스처로 등록해 한 스프라이트로 그린다
 *        (레이어가 항상 같은 프레임을 보여 팻말·말풍선·상태 아이콘 위치는 그대로).
 * 8단계: 개인 뽀모도로가 돌면 상태 아이콘 왼쪽에 "🍅 18:32" / "☕ 4:10" (서버가 준 endsAt 으로 각자 계산, 1초마다 갱신 — 남의 것도 보인다).
 *        코인이 들어오면 머리 위 "+1 🪙" 가 떠오른다 (onCoins). hooks.serverNow 로 서버 시각을 받는다.
 * 9단계: 공용 가구는 FurnitureLayer(furniture.js) 가 그린다 (충돌 맵·가구 좌석 f:<id>·조명·애니). 편집 모드(setEditMode): 팔레트에서 고른 아이템이
 *        마우스를 따라 32px 스냅 미리보기(초록/빨강), 클릭 배치 · R 회전 · Esc 취소 · 놓인 가구 클릭-드래그 이동 · Del 회수. 편집 중이면 머리 위 🛠.
 *        책상 소품(player.deskItems): 앉으면 좌석 앞 책상 슬롯(Layout.deskSlots)에 표시. 침대(seat.kind 'bed')에 앉으면 눕기(회전 프레임 + 이불 오버레이 + 💤),
 *        안마의자('massage')는 앉은 동안 흔들린다.
 * 11단계: 그룹 주간 목표 달성 → celebrate(ms): 창밖(room.windows)에 불꽃놀이 (하늘 위 · 창틀 뒤, 0.35초마다 무작위 창에 터짐) + flashLights.
 * 12단계: 맵 전환 — 같은 씬을 scene.restart({ room, ... }) 로 다시 만든다 (hooks 는 유지, 아바타 텍스처는 전역이라 재사용).
 *  - 문: 발 위치가 to 가 있는 문 타일이면 hooks.onDoor() (문 타일을 벗어나야 다시 켜진다 — doorArmed).
 *  - 야외(room.outdoor): 하늘 띠 + 별 · 시간대 어둠/노을 틴트 · 물·분수 순환 애니(cycleTiles) · 전광판 글자(refreshBoard) · 머리 위 소속 스터디 이름 ·
 *    아바타 클릭 → hooks.onProfile(id) · V 소환/해제(hooks.onMount) · H 경적(hooks.onHorn) · 탑승 중 물리(Vehicles.step: 방향키 8방향 가속, 관성·마찰,
 *    진행 방향은 차종별 회전 속도로 부드럽게, 반대 방향은 브레이크 후 출발, 충돌 튕김) →
 *    move 에 vehicle { type, angle, speed }. 남의 탈것은 playerMoved 의 vehicle(각도·속도)로 8방향 프레임을 맞춘다 (VehicleView).
 * 15단계 실내: 가구 밑 반투명 타원 그림자(buildPropShadows) · 펜던트 아래 바닥 빛 웅덩이(light.pool) · 창밖 비(10%, setRain) ·
 *    커피머신 김(anchors.steam) · 벽시계 초침(wall_clock 소품) · 어항 물결(FishNpc) · 문 명패(setNameplate) · 코르크보드 목표 팻말(syncCorkboard) ·
 *    책상 위 쪽지/머그 아이콘(tiles 텍스처의 타일 프레임, setSeatNotes/setSeatMugs) · D-day 칠판(setDdays).
 * 18단계: 사람 NPC(sheet 'npcs': 매점 점원·바리스타 — 캐릭터별 6행 x 4프레임, 행동 애니 wave/wipe/machine/arrange) · NPC 말풍선(npc:say, 바리스타는 steam 으로 머신 김 강해짐) ·
 *    강아지 E 메뉴(hooks.onDogMenu — 쓰다듬기/산책/재주) · 재주 연출(npc:trick: 앉아·손🖐·빙글) · 산책 xp "🐾 +1"(dog:xp) · 이름 옆 ❤️Lv(snapshot.level).
 */
(function () {
  'use strict';

  let ZOOM = 2; // 카메라 줌 = 텍스트 해상도. 7단계: 설정(작게/보통/크게 = 1.5/2/2.5)으로 바뀐다 (setZoom)
  const SEND_INTERVAL = 50; // ms (20Hz)
  const INTERP_DELAY = 100; // ms — 원격 아바타는 이만큼 과거를 그린다 (두 스냅샷 사이 선형 보간)
  const SIT_RANGE = 56; // px, 서버 SIT_RANGE_PX 와 동일
  const CORRECT_RATE = 10; // 서버 보정 시 초당 수렴 비율
  const FONTS = { hand: '"Gaegu", "Nanum Pen Script", cursive', sans: '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif' };
  const STATUS_EMOJI = { study: '📖', rest: '🌿', coffee: '☕' }; // coffee: 커피머신 앞 E → 컵 든 모양
  const POMO_EMOJI = { focus: '🍅', break: '☕' };
  const POMO_TICK = 1000; // ms — 머리 위 타이머 글자 갱신 주기

  const ZOO_ANIMAL_SCALE = 1.4; // 후속 수정: 우리 안 동물 크기
  const DEPTH = { sky: 0.5, stars: 0.6, fireworks: 0.7, windowDay: 1.5, zone: 2, screen: 2.5, shadow: 9, avatar: 10, label: 25, bubble: 26, darkness: 30, glow: 31 };
  const FIREWORK_COLORS = [0xffb85c, 0xff8a7a, 0x9fd39a, 0xcfe8f5, 0xffd08a, 0xf2a0d6];
  const HINT_KIND = { bed: 'lie', massage: 'massage' }; // 가구 좌석 종류 → E 힌트
  const NOTE_MS = 1400; // 스피커 ♪ 간격
  const SIGN_MAX_W = 96; // 팻말 최대 폭(px) — 넘치면 말줄임
  const DAYLIGHT_TICK = 1000; // ms — 시간대 가중치 재계산 주기
  const CYCLE_MS = 400; // 물·분수 타일 순환 주기
  const BOARD_ROWS = 5;
  const RAIN_CHANCE = 0.1; // 15단계: 방에 들어올 때 이 확률로 창밖에 비
  const CLOCK_TICK = 1000;
  // 가구 밑 그림자를 그리지 않는 오브젝트 (벽·유리·창·바닥에 붙은 것·의자·작은 소품)
  const NO_SHADOW = /^(wall_|gpost_|glass_|door_open|window_|study_panel|entrance_wide|chalkboard|board_|music_panel|bookshelf_big|cabinet_printer|menu_board|whiteboard|sign_|hedge|bollard|bench$|corkboard|curtain_|cup_shelf|counter_|display_case|shelf_narrow|coffee_machine|cushion$|cushion_floor|slippers|magazines|dog_bowl|dog_toy|cable_box|milk_crate|fire_ext|chair_|pouf_|note_icon|mug_|bean_shelf|projector|facade|kerb|grass|paver)/;

  // ── 아바타 (내 것/원격 공용 표시 요소) ────────────────────────────────
  class Avatar {
    constructor(scene, p) {
      this.scene = scene;
      this.id = p.id;
      this.nickname = p.nickname;
      this.avatar = scene.avatarKit.normalize(p.avatar); // 파츠 객체
      this.facing = p.facing || 'down';
      this.status = p.status || 'rest';
      this.seated = Boolean(p.seatId);
      this.listening = Boolean(p.listening);
      this.goal = p.goal || null; // { text, targetMinutes }
      this.progress = 0; // 오늘 누적 / 목표 (0..1)
      this.x = p.x;
      this.y = p.y;
      this.walking = false;

      this.sprite = scene.add.sprite(p.x, p.y, scene.avatarTexture(this.id, this.avatar), scene.idleFrame('down')).setOrigin(0.5, 1);
      this.shadow = scene.add.ellipse(p.x, p.y - 2, 22, 8, 0x000000, 0.28).setDepth(DEPTH.shadow);
      // 닉네임은 발 아래, 상태 아이콘은 머리 위 오른쪽, 채팅/이모지는 머리 위
      this.name = scene.add.text(p.x, p.y + 3, this.labelText(), {
        fontFamily: FONTS.sans, fontSize: '11px', fontStyle: 'bold', color: '#f1e6d2',
        stroke: '#14111a', strokeThickness: 3, resolution: ZOOM,
      }).setOrigin(0.5, 0).setDepth(DEPTH.label);
      this.statusBubble = this.makeBubble(STATUS_EMOJI[this.status], { pad: 3, fontSize: 10, radius: 6 });
      this.statusBubble.setDepth(DEPTH.label);
      // 뽀모도로 남은 시간 (상태 아이콘 왼쪽, 진행 중일 때만 보임)
      this.pomo = null; // { phase, endsAt } | null
      this.pomoText = scene.add.text(0, 0, '', {
        fontFamily: FONTS.sans, fontSize: '9px', fontStyle: 'bold', color: '#ffd08a',
        stroke: '#14111a', strokeThickness: 3, resolution: ZOOM,
      }).setOrigin(1, 0.5).setDepth(DEPTH.label).setVisible(false);
      this.coinText = null;
      this.coinTimer = null;
      this.chatBubble = null;
      this.chatTimer = null;
      this.emojiText = null;
      this.emojiTimer = null;
      this.sign = null; // 목표 팻말 (앉아 있을 때만)
      // 9단계
      this.seat = null; // 앉은 좌석 객체 (kind 로 눕기/안마 판정, 책상 슬롯 계산)
      this.lying = null; // { rect, rotation } 침대에 누움
      this.wobble = 0; // 안마의자 흔들림 (px)
      this.wobbleTween = null;
      this.zzz = null;
      this.editMark = null; // 머리 위 🛠
      this.deskItems = Array.isArray(p.deskItems) ? p.deskItems : [null, null, null];
      this.deskSprites = [];
      this.noteTimer = null;
      // 12단계: 탈것 + 야외 머리 위 소속 스터디 이름 + 클릭 프로필
      this.vehicle = new VehicleView(scene, scene.vehiclesMeta);
      this.studyName = p.studyName || null;
      this.studyText = null;
      if (scene.room.outdoor && this.studyName) {
        this.studyText = scene.add.text(0, 0, this.studyName, { fontFamily: FONTS.sans, fontSize: '8px', color: '#cfe8f5', stroke: '#14111a', strokeThickness: 2, resolution: ZOOM }).setOrigin(0.5, 1).setDepth(DEPTH.label);
      }
      if (scene.room.outdoor) {
        this.sprite.setInteractive({ useHandCursor: true });
        this.sprite.on('pointerdown', (pointer) => scene.onAvatarClick(this, pointer));
      }
      this.setPosition(p.x, p.y);
      this.setFacing(this.facing);
      this.setSeated(this.seated, scene.seatById(p.seatId));
      this.setPomodoro(p.pomodoro || null);
      this.setEditing(Boolean(p.editing));
      this.setVehicle(p.vehicle || null);
      this.snackText = null; // 14단계: 손에 든 간식 { item, emoji, until }
      this.snack = null;
      this.setSnack(p.snack || null);
      this.fishing = null; // 14단계: 낚시 { state: 'wait'|'bite', spot } | null
      this.rod = null;
      this.bang = null;
      this.setFishing(p.fishing || null);
      this.coffeeBuffUntil = p.coffeeBuffUntil || null; // 15단계: 커피를 받으면 10분 동안 휴식 아이콘이 ❤️☕
      this.refreshStatus();
    }

    /** 15단계: 커피 버프 (서버 ms). 만료는 tickBuff 가 1초마다 본다 */
    setBuff(until) {
      this.coffeeBuffUntil = until || null;
      this.refreshStatus();
    }

    get buffed() {
      return Boolean(this.coffeeBuffUntil && this.coffeeBuffUntil > this.scene.hooks.serverNow());
    }

    statusEmoji() {
      if (this.status !== 'study' && this.buffed) return '❤️☕';
      return STATUS_EMOJI[this.status] || '•';
    }

    refreshStatus() {
      const t = this.statusEmoji();
      if (this.statusBubble.bubbleText.text !== t) this.statusBubble.bubbleText.setText(t);
    }

    tickBuff() {
      if (this.coffeeBuffUntil && !this.buffed) { this.coffeeBuffUntil = null; this.refreshStatus(); }
    }

    /** 14단계: 낚시 자세 — 낚싯대(선 + 찌) + 입질이면 머리 위 "!" */
    setFishing(f) {
      this.fishing = f && f.state ? f : null;
      if (this.rod) { this.rod.destroy(); this.rod = null; }
      if (this.bang) { this.bang.destroy(); this.bang = null; }
      if (this.fishing) {
        this.rod = this.scene.add.graphics().setDepth(DEPTH.avatar + 0.5);
        if (this.fishing.state === 'bite') {
          this.bang = this.scene.add.text(0, 0, '❗', { fontSize: '20px', resolution: ZOOM }).setOrigin(0.5, 1).setDepth(DEPTH.bubble);
          this.scene.tweens.add({ targets: this.bang, scaleX: 1.3, scaleY: 1.3, duration: 160, yoyo: true, repeat: -1 });
        }
        this.setPosition(this.x, this.y);
      }
    }

    drawRod() {
      const g = this.rod;
      if (!g) return;
      const rx = Math.round(this.x);
      const ry = Math.round(this.y);
      const dir = this.facing === 'left' ? -1 : this.facing === 'right' ? 1 : this.facing === 'up' ? 0 : 0;
      const down = this.facing !== 'up';
      const hx = rx + (dir || 0.6) * 8;
      const hy = ry - 26;
      const tipX = hx + (dir || 1) * 30;
      const tipY = hy - 22;
      const floatX = tipX + (dir || 1) * 4;
      const floatY = down ? ry + 22 + Math.round(Math.sin(performance.now() / 300) * 2) : ry - 44;
      g.clear();
      g.lineStyle(2, 0x5e4331, 1);
      g.lineBetween(hx, hy, tipX, tipY);
      g.lineStyle(1, 0xdfe6f5, 0.8);
      g.lineBetween(tipX, tipY, floatX, floatY);
      g.fillStyle(this.fishing && this.fishing.state === 'bite' ? 0xffd08a : 0xe2605e, 1);
      g.fillCircle(floatX, floatY, 2.5);
      if (this.bang) this.bang.setPosition(rx, ry - 70 - (this.studyText ? 10 : 0));
    }

    /** 14단계: 매점 간식 — 손 위치에 이모지, until(서버 ms)이 지나면 사라진다 */
    setSnack(snack) {
      this.snack = snack && snack.until > this.scene.hooks.serverNow() ? snack : null;
      if (this.snackText) { this.snackText.destroy(); this.snackText = null; }
      if (this.snack) {
        this.snackText = this.scene.add.text(0, 0, this.snack.emoji || '🍦', { fontSize: '12px', resolution: ZOOM }).setOrigin(0.5, 1).setDepth(DEPTH.label);
        this.setPosition(this.x, this.y);
      }
    }

    tickSnack(now) {
      if (this.snack && this.snack.until <= now) this.setSnack(null);
    }

    // ── 12단계: 탈것 ────────────────────────────────────────────────
    get riding() {
      return this.vehicle.active;
    }

    /** 서버가 확정한 탈것 { type, color, decal, angle, speed } | null */
    setVehicle(v) {
      this.vehicle.set(v);
      if (this.riding) {
        this.walking = false;
        this.sprite.anims.stop();
        this.facing = this.vehicle.facing();
        this.sprite.setFrame(this.scene.idleFrame(this.facing));
      } else this.sprite.setFrame(this.scene.idleFrame(this.facing));
      this.setPosition(this.x, this.y);
    }

    /** 각도·속도 (내 물리 / 남의 playerMoved) → 8방향 프레임 + 아바타 4방향 정지 프레임 */
    setVehicleMotion(angle, speed) {
      if (!this.riding) return;
      this.vehicle.setMotion(angle, speed);
      const f = this.vehicle.facing();
      if (f !== this.facing) {
        this.facing = f;
        this.sprite.setFrame(this.scene.idleFrame(f));
      }
      this.setPosition(this.x, this.y);
    }

    // ── 9단계: 편집 표시 · 책상 소품 · 눕기 · 안마 ────────────────────
    setEditing(on) {
      const want = Boolean(on);
      if (want && !this.editMark) {
        this.editMark = this.scene.add.text(0, 0, '🛠', { fontSize: '13px', resolution: ZOOM }).setOrigin(0.5, 1).setDepth(DEPTH.bubble);
        this.setPosition(this.x, this.y);
      } else if (!want && this.editMark) {
        this.editMark.destroy();
        this.editMark = null;
      }
      this.editing = want;
    }

    setDesk(items) {
      this.deskItems = Array.isArray(items) ? items : [null, null, null];
      this.syncDesk();
    }

    /** 앉아 있으면 좌석 앞 책상 슬롯에 장착한 소품을 그린다 (일어나면 사라짐) */
    syncDesk() {
      this.clearDesk();
      const scene = this.scene;
      const furn = scene.furniture;
      if (!this.seated || !this.seat || !furn) return;
      const slots = Layout.deskSlots(scene.room, this.seat);
      const T = scene.T;
      this.deskItems.forEach((d, i) => {
        const slot = slots[i];
        if (!d || !slot) return;
        const item = furn.itemOf(d.itemId);
        const key = item && furn.frameKey(item.id, d.variant, 0, 0);
        if (!key) return;
        const sp = scene.add.sprite(slot.tx * T + T / 2, (slot.ty + 1) * T, 'furn', key).setOrigin(0.5, 1).setDepth(DEPTH.avatar + ((slot.ty + 1) * T) / scene.mapH + 0.0002);
        const anim = furn.animKeyFor(item, d.variant, 0);
        if (anim) sp.anims.play(anim);
        this.deskSprites.push(sp);
        if (item.fx === 'notes') this.startNotes(sp);
      });
    }

    clearDesk() {
      for (const sp of this.deskSprites) sp.destroy();
      this.deskSprites = [];
      if (this.noteTimer) this.noteTimer.remove(false);
      this.noteTimer = null;
    }

    /** 스피커: ♪ 가 주기적으로 떠오른다 */
    startNotes(sp) {
      const scene = this.scene;
      this.noteTimer = scene.time.addEvent({
        delay: NOTE_MS,
        loop: true,
        callback: () => {
          const t = scene.add.text(sp.x + (Math.random() * 10 - 5), sp.y - 20, '♪', { fontFamily: FONTS.sans, fontSize: '10px', color: '#ffd08a', stroke: '#14111a', strokeThickness: 2, resolution: ZOOM }).setOrigin(0.5, 1).setDepth(DEPTH.bubble);
          scene.tweens.add({ targets: t, y: t.y - 16, alpha: 0, duration: 1200, ease: 'Sine.easeOut', onComplete: () => t.destroy() });
        },
      });
    }

    /** 침대에 눕기: 스프라이트를 침대 가운데에 (가로 침대는 90° 회전) + 💤 */
    setLying(seat) {
      const furn = this.scene.furniture;
      const entry = furn && seat && seat.layoutId !== undefined ? furn.entries.get(seat.layoutId) : null;
      if (!entry) return this.clearLying();
      this.lying = { rect: furn.rectOf(entry), rotation: entry.rotation || 0 };
      this.sprite.setOrigin(0.5, 0.5).setAngle(this.lying.rotation ? 90 : 0).setFrame(this.scene.idleFrame('down'));
      this.shadow.setVisible(false);
      if (!this.zzz) {
        this.zzz = this.scene.add.text(0, 0, '💤', { fontSize: '13px', resolution: ZOOM }).setOrigin(0.5, 1).setDepth(DEPTH.bubble);
        this.zzz.rise = 0;
        this.scene.tweens.add({ targets: this.zzz, rise: 6, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut', onUpdate: () => this.setPosition(this.x, this.y) });
      }
      this.setPosition(this.x, this.y);
    }

    clearLying() {
      if (!this.lying) return;
      this.lying = null;
      this.sprite.setOrigin(0.5, 1).setAngle(0);
      this.shadow.setVisible(true);
      if (this.zzz) { this.scene.tweens.killTweensOf(this.zzz); this.zzz.destroy(); this.zzz = null; }
      this.setPosition(this.x, this.y);
    }

    setWobble(on) {
      if (this.wobbleTween) { this.wobbleTween.stop(); this.wobbleTween = null; }
      this.wobble = 0;
      if (on) this.wobbleTween = this.scene.tweens.add({ targets: this, wobble: { from: -1, to: 1 }, duration: 70, yoyo: true, repeat: -1, onUpdate: () => this.setPosition(this.x, this.y) });
      else this.setPosition(this.x, this.y);
    }

    // ── 뽀모도로 머리 위 표시 / 코인 (8단계) ──────────────────────────
    /** 서버가 준 { phase, endsAt } (진행 중) 또는 null. 글자는 tickPomo 가 1초마다 채운다 */
    setPomodoro(pomo) {
      this.pomo = pomo && pomo.endsAt ? { phase: pomo.phase, endsAt: pomo.endsAt } : null;
      this.pomoText.setVisible(Boolean(this.pomo));
      this.tickPomo(this.scene.hooks.serverNow());
    }

    /** 남은 시간 텍스트 갱신 ("🍅 18:32" / "☕ 4:10"). 바뀌었을 때만 setText */
    tickPomo(now) {
      if (!this.pomo) return;
      const remain = Math.max(0, this.pomo.endsAt - now);
      const s = Math.ceil(remain / 1000);
      const txt = `${POMO_EMOJI[this.pomo.phase] || '⏱'} ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      if (this.pomoText.text !== txt) this.pomoText.setText(txt);
    }

    /** 코인 증감: 머리 위 "+1 🪙" 가 1.4초 동안 떠오르며 사라진다 (음수는 붉게) */
    showCoin(delta) {
      this.clearCoin();
      const plus = delta > 0;
      const t = this.scene.add.text(0, 0, `${plus ? '+' : ''}${delta} 🪙`, {
        fontFamily: FONTS.sans, fontSize: '12px', fontStyle: 'bold', color: plus ? '#ffd08a' : '#ff8a7a',
        stroke: '#14111a', strokeThickness: 3, resolution: ZOOM,
      }).setOrigin(0.5, 1).setDepth(DEPTH.bubble);
      t.rise = 0;
      this.coinText = t;
      this.setPosition(this.x, this.y);
      this.scene.tweens.add({ targets: t, rise: 22, duration: 1400, ease: 'Sine.easeOut', onUpdate: () => this.setPosition(this.x, this.y) });
      this.scene.tweens.add({ targets: t, alpha: 0, delay: 800, duration: 600 });
      this.coinTimer = this.scene.time.delayedCall(1400, () => this.clearCoin());
    }

    clearCoin() {
      if (this.coinTimer) this.coinTimer.remove(false);
      this.coinTimer = null;
      if (this.coinText) this.coinText.destroy();
      this.coinText = null;
    }

    // ── 목표 팻말 ────────────────────────────────────────────────────
    setGoal(goal) {
      this.goal = goal && (goal.text || goal.targetMinutes) ? goal : null;
      this.syncSign();
    }

    setProgress(ratio) {
      this.progress = Phaser.Math.Clamp(Number(ratio) || 0, 0, 1);
      if (this.sign) this.drawSignBar();
    }

    /** 팻말은 앉아 있고 목표가 있을 때만 */
    syncSign() {
      const want = this.seated && this.goal;
      if (!want) {
        if (this.sign) this.sign.destroy();
        this.sign = null;
        return;
      }
      if (this.sign) this.sign.destroy();
      const scene = this.scene;
      const label = this.goal.text || `${this.goal.targetMinutes}분 목표`;
      const t = scene.add.text(0, 0, label, { fontFamily: FONTS.sans, fontSize: '9px', color: '#3b2f22', resolution: ZOOM, align: 'center' }).setOrigin(0.5, 0);
      // 넘치면 말줄임
      if (t.width > SIGN_MAX_W - 8) {
        let s = label;
        while (s.length > 1 && t.width > SIGN_MAX_W - 8) {
          s = s.slice(0, -1);
          t.setText(`${s}…`);
        }
      }
      const w = Math.ceil(t.width) + 8;
      const h = Math.ceil(t.height) + 9;
      const g = scene.add.graphics();
      g.fillStyle(0xf1e6d2, 0.95);
      g.lineStyle(1, 0x8a6a52, 0.9);
      g.fillRoundedRect(-w / 2, 0, w, h, 3);
      g.strokeRoundedRect(-w / 2, 0, w, h, 3);
      g.fillStyle(0x8a6a52, 1);
      g.fillRect(-1, -3, 2, 3); // 꽂이
      t.setPosition(0, 2);
      const bar = scene.add.graphics();
      const c = scene.add.container(0, 0, [g, t, bar]).setDepth(DEPTH.label);
      c.signW = w;
      c.signH = h;
      c.bar = bar;
      this.sign = c;
      this.drawSignBar();
      this.setPosition(this.x, this.y);
    }

    drawSignBar() {
      const c = this.sign;
      if (!c) return;
      const bw = c.signW - 8;
      const y = c.signH - 4;
      c.bar.clear();
      c.bar.fillStyle(0xd9c29d, 1);
      c.bar.fillRect(-bw / 2, y, bw, 2);
      c.bar.fillStyle(this.progress >= 1 ? 0x6faa62 : 0xffb85c, 1);
      c.bar.fillRect(-bw / 2, y, Math.round(bw * this.progress), 2);
    }

    makeBubble(text, { pad = 6, fontSize = 11, radius = 7, maxWidth = 0, fill = 0x1c1824, stroke = 0xffb85c } = {}) {
      const scene = this.scene;
      const t = scene.add.text(0, 0, text, {
        fontFamily: FONTS.sans, fontSize: `${fontSize}px`, color: '#f1e6d2', resolution: ZOOM, align: 'center',
        wordWrap: maxWidth ? { width: maxWidth, useAdvancedWrap: true } : undefined,
      }).setOrigin(0.5, 0.5);
      const w = Math.ceil(t.width) + pad * 2;
      const h = Math.ceil(t.height) + pad * 2;
      const g = scene.add.graphics();
      g.fillStyle(fill, 0.88);
      g.lineStyle(1, stroke, 0.55);
      g.fillRoundedRect(-w / 2, -h / 2, w, h, radius);
      g.strokeRoundedRect(-w / 2, -h / 2, w, h, radius);
      const c = scene.add.container(0, 0, [g, t]);
      c.bubbleW = w;
      c.bubbleH = h;
      c.bubbleText = t;
      return c;
    }

    setPosition(x, y) {
      this.x = x;
      this.y = y;
      const rx = Math.round(x);
      const ry = Math.round(y);
      if (this.lying) {
        // 침대 가운데에 눕는다. 머리 위 요소는 침대 위쪽(세로) / 오른쪽 머리 쪽(가로) 기준
        const r = this.lying.rect;
        const cx = r.x + r.w / 2;
        const cy = r.y + r.h / 2;
        this.sprite.setPosition(Math.round(cx), Math.round(cy)).setDepth(DEPTH.avatar + (r.y + r.h) / this.scene.mapH);
        this.name.setPosition(Math.round(cx), r.y + r.h + 1);
        const hx = this.lying.rotation ? r.x + r.w - 10 : cx;
        const hy = this.lying.rotation ? cy - 10 : r.y + 2;
        if (this.zzz) this.zzz.setPosition(Math.round(hx - 14), Math.round(hy - 6 - (this.zzz.rise || 0)));
        this.statusBubble.setPosition(Math.round(hx + 16), Math.round(hy - 18));
        this.pomoText.setPosition(Math.round(hx + 16 - this.statusBubble.bubbleW / 2 - 2), Math.round(hy - 18));
        if (this.chatBubble) this.chatBubble.setPosition(Math.round(cx), hy - 30 - this.chatBubble.bubbleH / 2);
        if (this.emojiText) this.emojiText.setPosition(Math.round(cx), hy - 26 - (this.emojiText.rise || 0));
        if (this.coinText) this.coinText.setPosition(Math.round(cx) - 14, hy - 22 - (this.coinText.rise || 0));
        if (this.editMark) this.editMark.setPosition(Math.round(cx) - 16, hy - 24);
        if (this.sign) this.sign.setPosition(Math.round(cx), r.y + r.h + 19);
        return;
      }
      const depth = DEPTH.avatar + y / this.scene.mapH;
      if (this.riding) {
        const seat = this.vehicle.place(rx, ry, depth);
        this.sprite.setPosition(seat.x, seat.y).setDepth(depth + 0.00002);
        this.shadow.setPosition(rx, ry - 1).setScale(1.35, 1.25);
      } else {
        this.sprite.setPosition(rx + Math.round(this.wobble || 0), ry).setDepth(depth);
        this.shadow.setPosition(rx, ry - 2).setScale(1, 1);
      }
      this.name.setPosition(rx, ry + 3);
      if (this.studyText) this.studyText.setPosition(rx, ry - 82);
      if (this.sign) this.sign.setPosition(rx, ry + 19);
      this.statusBubble.setPosition(rx + 16, ry - 66);
      this.pomoText.setPosition(rx + 16 - this.statusBubble.bubbleW / 2 - 2, ry - 66);
      const lift = this.studyText ? 10 : 0; // 스터디 이름이 있으면 말풍선·이모지는 그 위로
      if (this.chatBubble) this.chatBubble.setPosition(rx, ry - 78 - lift - this.chatBubble.bubbleH / 2);
      if (this.emojiText) this.emojiText.setPosition(rx, ry - 74 - lift - (this.emojiText.rise || 0));
      if (this.coinText) this.coinText.setPosition(rx - 14, ry - 70 - (this.coinText.rise || 0));
      if (this.editMark) this.editMark.setPosition(rx - 16, ry - 70);
      if (this.snackText) this.snackText.setPosition(rx + (this.facing === 'left' ? -11 : 11), ry - 24).setDepth(depth + (this.facing === 'up' ? -0.00001 : 0.00003));
      if (this.rod) this.drawRod();
    }

    setFacing(f) {
      if (this.riding) return; // 탑승 중엔 탈것 각도가 방향을 정한다
      this.facing = f;
      if (this.walking) this.sprite.anims.play(this.scene.walkKey(f, this.id), true);
      else this.sprite.setFrame(this.scene.idleFrame(this.seated ? 'down' : f));
    }

    setWalking(on) {
      if (this.seated || this.riding) on = false;
      if (on) {
        this.walking = true;
        this.sprite.anims.play(this.scene.walkKey(this.facing, this.id), true); // 같은 애니메이션이면 무시
      } else if (this.walking) {
        this.walking = false;
        this.sprite.anims.stop();
        this.sprite.setFrame(this.scene.idleFrame(this.seated ? 'down' : this.facing));
      }
    }

    /** seat: 좌석 객체 (방 좌석 또는 가구 좌석 { kind, layoutId }) — 침대면 눕고, 안마의자면 흔들린다 */
    setSeated(on, seat = null) {
      this.seated = on;
      this.seat = on ? seat : null;
      if (on) {
        this.walking = false;
        this.sprite.anims.stop();
        // 앉은 자세 프레임이 없으므로 아래 방향 정지 프레임
        this.sprite.setFrame(this.scene.idleFrame('down'));
      } else this.sprite.setFrame(this.scene.idleFrame(this.facing));
      const kind = on && seat ? seat.kind : null;
      if (kind === 'bed') this.setLying(seat);
      else this.clearLying();
      this.setWobble(kind === 'massage');
      this.syncSign();
      this.syncDesk();
    }

    setStatus(s) {
      this.status = s;
      this.refreshStatus();
    }

    labelText() {
      return this.listening ? `${this.nickname} ♪` : this.nickname;
    }

    /** 유튜브 재생 중이면 닉네임 옆에 ♪ */
    setListening(on) {
      this.listening = Boolean(on);
      this.name.setText(this.labelText());
    }

    /** 파츠가 바뀌면 같은 텍스처를 다시 그린다 → 프레임·애니메이션·머리 위 요소는 그대로 */
    setAvatar(avatar) {
      this.avatar = this.scene.avatarKit.normalize(avatar);
      this.scene.avatarTexture(this.id, this.avatar);
    }

    showChat(text) {
      this.clearChat();
      this.chatBubble = this.makeBubble(text, { pad: 6, fontSize: 11, radius: 8, maxWidth: 150 }).setDepth(DEPTH.bubble);
      this.setPosition(this.x, this.y);
      this.chatBubble.setAlpha(0);
      this.scene.tweens.add({ targets: this.chatBubble, alpha: 1, duration: 120 });
      this.chatTimer = this.scene.time.delayedCall(4000, () => this.clearChat());
    }

    clearChat() {
      if (this.chatTimer) this.chatTimer.remove(false);
      this.chatTimer = null;
      if (this.chatBubble) this.chatBubble.destroy();
      this.chatBubble = null;
    }

    showEmoji(emoji, duration = 2000) {
      this.clearEmoji();
      const t = this.scene.add.text(0, 0, emoji, { fontSize: '18px', resolution: ZOOM }).setOrigin(0.5, 1).setDepth(DEPTH.bubble);
      t.rise = 0;
      this.emojiText = t;
      this.setPosition(this.x, this.y);
      this.scene.tweens.add({ targets: t, rise: 10, duration: 500, ease: 'Sine.easeOut', onUpdate: () => this.setPosition(this.x, this.y) });
      this.scene.tweens.add({ targets: t, alpha: 0, delay: duration - 500, duration: 500 });
      this.emojiTimer = this.scene.time.delayedCall(duration, () => this.clearEmoji());
    }

    clearEmoji() {
      if (this.emojiTimer) this.emojiTimer.remove(false);
      this.emojiTimer = null;
      if (this.emojiText) this.emojiText.destroy();
      this.emojiText = null;
    }

    destroy() {
      this.clearChat();
      this.clearEmoji();
      this.clearCoin();
      this.clearDesk();
      this.clearLying();
      this.setWobble(false);
      if (this.editMark) this.editMark.destroy();
      if (this.snackText) this.snackText.destroy();
      if (this.rod) this.rod.destroy();
      if (this.bang) this.bang.destroy();
      if (this.sign) this.sign.destroy();
      if (this.studyText) this.studyText.destroy();
      this.vehicle.destroy();
      this.sprite.destroy();
      this.shadow.destroy();
      this.name.destroy();
      this.statusBubble.destroy();
      this.pomoText.destroy();
      this.scene.releaseAvatarTexture(this.id);
    }
  }


  // ── 펫 NPC 표시 (강아지 · 공용 펫 · 개인 펫) ─────────────────────────
  // 스프라이트시트 'pets': 프레임 = row*framesPerRow + species*2 + f. 꾸미기는 'petdeco' 아틀라스를 종별 앵커(pets.json)에 겹친다.
  const DECO_ORDER = ['back', 'neck', 'head'];
  class Npc {
    constructor(scene, snap) {
      this.scene = scene;
      this.id = snap.id;
      this.name = snap.name;
      this.state = snap.state;
      this.facing = snap.facing || 'down';
      this.species = snap.species || 'dog';
      this.ownerId = snap.ownerId || null;
      this.shoulder = Boolean(snap.shoulder);
      this.bounce = Boolean(snap.bounce);
      this.x = snap.x;
      this.y = snap.y;
      this.buffer = [];
      this.animKey = null;
      this.bounceT = 0;
      // 14단계: 동물 시트(sheet 'animals') · 반딧불이(glow) · 쓰다듬기 가능 여부. 18단계: 사람 NPC 시트(sheet 'npcs')
      this.sheet = snap.sheet === 'animals' && scene.animalsMeta && scene.textures.exists('animals') ? 'animals' : snap.sheet === 'npcs' && scene.npcsMeta && scene.textures.exists('npcs') ? 'npcs' : 'pets';
      this.char = snap.char || null;
      this.level = snap.level !== undefined ? snap.level : null;
      this.walk = Boolean(snap.walk);
      this.bubble = null;
      this.bubbleTimer = null;
      this.xpText = null;
      this.spinTween = null;
      this.glow = Boolean(snap.glow);
      this.pettable = snap.pettable !== false;
      this.fly = Boolean(snap.fly);
      this.flyT = Math.random() * 6;
      const meta = scene.petsMeta;
      this.spIndex = (meta.species[this.species] || meta.species.dog).index;
      if (this.glow) {
        // 반딧불이: 작은 점 + 가산 글로우, 밤에만 보인다
        this.sprite = scene.add.image(snap.x, snap.y, 'glow').setScale(0.09).setBlendMode(Phaser.BlendModes.ADD).setTint(0xfff0a0).setOrigin(0.5, 0.5);
        this.dot = scene.add.rectangle(snap.x, snap.y, 2, 2, 0xfff6c0, 1).setOrigin(0.5, 0.5);
        this.sprite.anims = { play() {}, stop() {}, currentAnim: null };
        this.sprite.setFrame = () => this.sprite;
        this.nightAlpha = 0;
      } else if (this.sheet === 'animals') {
        const am = scene.animalsMeta;
        this.animalBase = (am.species[this.species] || am.species.panda).index * am.framesPerSpecies;
        this.sprite = scene.add.sprite(snap.x, snap.y, 'animals', this.animalBase + am.frames.idle).setOrigin(0.5, 1);
      } else if (this.sheet === 'npcs') {
        const nm = scene.npcsMeta;
        this.humanBase = ((nm.chars[this.char] || nm.chars.clerk).index) * nm.framesPerChar;
        this.sprite = scene.add.sprite(snap.x, snap.y, 'npcs', this.humanBase + nm.rows.down * nm.framesPerRow).setOrigin(0.5, 1);
      } else this.sprite = scene.add.sprite(snap.x, snap.y, 'pets', this.frameIndex('sit', 0)).setOrigin(0.5, 1);
      // 우리 안 동물은 1.4배 (후속 수정) — 그림자도 같이
      this.zooScale = snap.kind === 'animal' ? ZOO_ANIMAL_SCALE : 1;
      if (this.zooScale !== 1) this.sprite.setScale(this.zooScale);
      const small = this.glow || this.fly;
      this.shadow = scene.add.ellipse(snap.x, snap.y - 2, (this.sheet === 'animals' && !small ? 24 : this.sheet === 'npcs' ? 22 : 18) * this.zooScale, (small ? 4 : this.sheet === 'npcs' ? 8 : 6) * this.zooScale, 0x000000, small ? 0.12 : 0.28).setDepth(DEPTH.shadow);
      if (this.glow) this.shadow.setVisible(false);
      this.nameText = scene.add.text(snap.x, snap.y + 2, this.labelText(snap.name), {
        fontFamily: FONTS.sans, fontSize: this.ownerId && !this.walk ? '9px' : '10px', fontStyle: 'bold', color: this.sheet === 'npcs' ? '#f1e6d2' : this.ownerId && !this.walk ? '#d9eeff' : '#ffd9a8',
        stroke: '#14111a', strokeThickness: 3, resolution: ZOOM,
      }).setOrigin(0.5, 0).setDepth(DEPTH.label);
      // 우리 안 동물·새·반딧불이는 이름표를 숨긴다 (쓰다듬을 수 있는 자유 동물만 표시)
      if ((this.sheet === 'animals' || this.glow || snap.kind === 'animal') && !this.pettable) this.nameText.setVisible(false);
      this.deco = { head: null, neck: null, back: null }; // 슬롯 → { key, sprite }
      this.cosmetics = {};
      this.heart = null;
      this.heartTimer = null;
      this.setCosmetics(snap.cosmetics || {});
      this.setPosition(snap.x, snap.y);
      this.applyState();
      if (this.glow) this.setNight(scene.weights ? scene.weights.night : 0);
    }

    frameIndex(row, f) {
      const meta = this.scene.petsMeta;
      return meta.rows[row] * meta.framesPerRow + this.spIndex * meta.framesPerSpecies + f;
    }

    /** 18단계: 이름 옆 ❤️Lv (강아지·산책 강아지) */
    labelText(name = this.name) {
      return this.level !== null && this.level !== undefined ? `${name} ❤️${this.level}` : name;
    }

    get isDog() {
      return this.id === 'dog' || this.walk;
    }

    /** 18단계: 말풍선 (NPC 가 말한다) */
    say(text, ms = 2500) {
      this.clearBubble();
      const scene = this.scene;
      const t = scene.add.text(0, 0, text, { fontFamily: FONTS.sans, fontSize: '11px', color: '#f1e6d2', resolution: ZOOM, align: 'center', wordWrap: { width: 150, useAdvancedWrap: true } }).setOrigin(0.5, 0.5);
      const w = Math.ceil(t.width) + 12;
      const h = Math.ceil(t.height) + 12;
      const g = scene.add.graphics();
      g.fillStyle(0x1c1824, 0.88);
      g.lineStyle(1, 0xffb85c, 0.55);
      g.fillRoundedRect(-w / 2, -h / 2, w, h, 8);
      g.strokeRoundedRect(-w / 2, -h / 2, w, h, 8);
      const c = scene.add.container(0, 0, [g, t]).setDepth(DEPTH.bubble);
      c.bubbleH = h;
      c.setAlpha(0);
      scene.tweens.add({ targets: c, alpha: 1, duration: 120 });
      this.bubble = c;
      this.setPosition(this.x, this.y);
      this.bubbleTimer = scene.time.delayedCall(ms, () => this.clearBubble());
    }

    clearBubble() {
      if (this.bubbleTimer) this.bubbleTimer.remove(false);
      this.bubbleTimer = null;
      if (this.bubble) this.bubble.destroy();
      this.bubble = null;
    }

    /** 18단계: 산책 xp — 머리 위 "🐾 +1" 가 떠오른다 */
    showXp(amount = 1) {
      if (this.xpText) this.xpText.destroy();
      const t = this.scene.add.text(0, 0, `🐾 +${amount}`, { fontFamily: FONTS.sans, fontSize: '11px', fontStyle: 'bold', color: '#ffd08a', stroke: '#14111a', strokeThickness: 3, resolution: ZOOM }).setOrigin(0.5, 1).setDepth(DEPTH.bubble);
      t.rise = 0;
      this.xpText = t;
      this.setPosition(this.x, this.y);
      this.scene.tweens.add({ targets: t, rise: 22, duration: 1600, ease: 'Sine.easeOut', onUpdate: () => this.setPosition(this.x, this.y) });
      this.scene.tweens.add({ targets: t, alpha: 0, delay: 1000, duration: 600, onComplete: () => { if (this.xpText === t) this.xpText = null; t.destroy(); } });
    }

    /** 18단계: 재주 연출 — 손(🖐) · 빙글(프레임을 돌린다) · 앉아(상태 프레임) */
    showTrick(trick, ms = 1400) {
      if (trick === 'paw') this.showHeart('🖐', false);
      if (trick === 'spin' && this.sheet === 'pets') {
        if (this.spinTween) this.spinTween.remove();
        const dirs = ['down', 'left', 'up', 'right'];
        let i = 0;
        this.animKey = null;
        this.sprite.anims.stop();
        this.spinTween = this.scene.time.addEvent({ delay: Math.max(60, ms / 8), repeat: 7, callback: () => { i++; this.sprite.setFrame(this.frameIndex(dirs[i % 4], 0)); this.syncDeco(); } });
      }
      if (trick === 'sit') this.showHeart('🐾', false);
    }

    rowName() {
      if (this.state === 'sleep') return 'sleep';
      if (this.state === 'sit' || this.state === 'look' || this.state === 'trick_sit' || this.state === 'trick_paw') return 'sit';
      return this.facing;
    }

    /** 앵커 (프레임 안 논리 px) → 스프라이트 원점(발 가운데) 기준 월드 오프셋 */
    anchorOffset(row, name) {
      const meta = this.scene.petsMeta;
      const sp = meta.species[this.species] || meta.species.dog;
      const a = (sp.anchors[row] || sp.anchors.down)[name] || [8, 12];
      return { dx: (a[0] - 8) * 2, dy: (a[1] - 24) * 2 };
    }

    /** cosmetics: { head: 'ribbon/red' | null, neck, back } */
    setCosmetics(c) {
      const next = c || {};
      for (const slot of DECO_ORDER) {
        const key = next[slot] || null;
        const cur = this.deco[slot];
        if (cur && cur.key === key) continue;
        if (cur) { cur.sprite.destroy(); this.deco[slot] = null; }
        if (!key) continue;
        const sp = this.scene.add.sprite(0, 0, 'petdeco', this.decoFrame(key, 'front', 0)).setOrigin(0.5, 0.5);
        sp.setVisible(false);
        this.deco[slot] = { key, sprite: sp, item: key.split('/')[0] };
        const anim = this.scene.decoAnimKey(key);
        if (anim) sp.anims.play(anim);
      }
      this.cosmetics = next;
      this.syncDeco();
    }

    decoFrame(key, view, f) {
      const k = `deco/${key}/${view}/f${f}`;
      return this.scene.textures.get('petdeco').has(k) ? k : `deco/${key}/front/f0`;
    }

    /** 방향/상태에 맞춰 꾸미기 프레임·위치·깊이 */
    syncDeco() {
      const row = this.rowName();
      const view = row === 'up' ? 'back' : row === 'left' || row === 'right' || row === 'sleep' ? 'side' : 'front';
      const flip = row === 'right' || (row === 'sleep' && false);
      for (const slot of DECO_ORDER) {
        const d = this.deco[slot];
        if (!d) continue;
        const anchor = d.item === 'glasses' ? 'face' : slot;
        const off = this.anchorOffset(row, anchor);
        const base = this.sprite.depth;
        const behind = (slot === 'back' && view === 'front') || (slot === 'head' && view === 'back' && d.item === 'glasses');
        const hidden = d.item === 'glasses' && view === 'back';
        d.sprite.setVisible(!hidden);
        if (hidden) continue;
        const animKey = this.scene.decoAnimKey(d.key, view);
        if (animKey) { if (d.sprite.anims.currentAnim?.key !== animKey) d.sprite.anims.play(animKey); } else d.sprite.setFrame(this.decoFrame(d.key, view, 0));
        d.sprite.setFlipX(flip);
        const fx = flip ? -off.dx : off.dx;
        d.sprite.setPosition(Math.round(this.sprite.x + fx), Math.round(this.sprite.y + off.dy)).setDepth(base + (behind ? -0.00002 : 0.00002 + DECO_ORDER.indexOf(slot) * 0.000001));
      }
    }

    setPosition(x, y) {
      this.x = x;
      this.y = y;
      const rx = Math.round(x);
      const ry = Math.round(y);
      const hop = this.bounce && this.state === 'walk' ? Math.round(Math.abs(Math.sin(this.bounceT)) * 6) : this.fly || this.glow ? Math.round(10 + Math.sin(this.flyT) * 4) : this.state === 'swim' ? Math.round(Math.sin(this.flyT) * 1.5) : 0;
      // 어깨 위 앵무새는 주인보다 앞에 그린다
      let depth = DEPTH.avatar + y / this.scene.mapH;
      if (this.shoulder && this.ownerId) {
        const o = this.scene.avatarOf(this.ownerId);
        if (o) depth = DEPTH.avatar + o.y / this.scene.mapH + 0.00005;
      }
      this.sprite.setPosition(rx, ry - hop).setDepth(depth);
      if (this.dot) this.dot.setPosition(rx, ry - hop).setDepth(depth + 0.00001);
      this.shadow.setPosition(rx, ry - 2).setVisible(!this.shoulder && !this.glow);
      this.nameText.setPosition(rx, ry + (this.shoulder ? -46 : 2));
      const top = this.sheet === 'npcs' ? 70 : 52;
      if (this.heart) this.heart.setPosition(rx, ry - top - (this.heart.rise || 0));
      if (this.xpText) this.xpText.setPosition(rx, ry - top - 4 - (this.xpText.rise || 0));
      if (this.bubble) this.bubble.setPosition(rx, ry - top - 6 - this.bubble.bubbleH / 2);
      this.syncDeco();
      this.syncTank();
    }

    setName(name) {
      this.name = name;
      this.nameText.setText(this.labelText(name));
    }

    setLevel(level) {
      this.level = level;
      this.nameText.setText(this.labelText());
    }

    /** 서버 스냅샷 반영: 위치는 보간 버퍼에, 상태/방향은 즉시 */
    push(snap) {
      this.buffer.push({ x: snap.x, y: snap.y, t: performance.now() });
      if (this.buffer.length > 30) this.buffer.splice(0, this.buffer.length - 30);
      if (snap.name !== this.name) this.setName(snap.name);
      if (snap.level !== undefined && snap.level !== this.level) this.setLevel(snap.level);
      if (snap.pettable !== undefined) this.pettable = snap.pettable !== false;
      if (Array.isArray(snap.tank)) this.setTank(snap.tank);
      if (snap.cosmetics) {
        const a = JSON.stringify(snap.cosmetics);
        if (a !== JSON.stringify(this.cosmetics)) this.setCosmetics(snap.cosmetics);
      }
      if (snap.state !== this.state || snap.facing !== this.facing) {
        this.state = snap.state;
        this.facing = snap.facing;
        this.applyState();
      }
    }

    applyState() {
      const play = (key) => {
        if (this.animKey === key) return;
        this.animKey = key;
        this.sprite.anims.play(key, true);
      };
      const still = (frame) => {
        this.animKey = null;
        this.sprite.anims.stop();
        this.sprite.setFrame(frame);
      };
      const sp = this.species;
      if (this.glow) { this.animKey = null; return; }
      if (this.sheet === 'npcs') {
        // 사람 NPC: 행동 상태(wave/wipe/machine/arrange)는 2프레임 애니, 나머지는 방향 정지 프레임
        const nm = this.scene.npcsMeta;
        if (nm.actions[this.state]) play(`npc-${this.char}-${this.state}`);
        else still(this.humanBase + (nm.rows[this.facing] ?? 0) * nm.framesPerRow);
        return;
      }
      if (this.sheet === 'animals') {
        // 동물 시트: 옆모습 하나로 방향은 flipX (왼쪽이 기본)
        const am = this.scene.animalsMeta;
        const base = this.animalBase;
        if (this.facing === 'left' || this.facing === 'right') this.sprite.setFlipX(this.facing === 'right');
        switch (this.state) {
          case 'walk': play(`animal-${sp}-walk`); break;
          case 'swim': play(`animal-${sp}-swim`); break;
          case 'fly': play(`animal-${sp}-fly`); break;
          case 'eat': play(`animal-${sp}-eat`); break;
          case 'sleep': still(base + am.frames.sleep); break;
          case 'sit': case 'look': still(base + am.frames.sit); break;
          default: still(base + am.frames.idle);
        }
        return;
      }
      switch (this.state) {
        case 'walk': play(`pet-${sp}-walk-${this.facing}`); break;
        case 'look': case 'trick_paw': play(`pet-${sp}-wag`); break; // 앉아서 꼬리 흔들기
        case 'sleep': play(`pet-${sp}-sleep`); break;
        case 'sit': case 'trick_sit': still(this.frameIndex('sit', 0)); break;
        case 'trick_spin': break; // showTrick 이 프레임을 돌린다
        default: still(this.frameIndex(this.facing, 0)); // idle: 서서 정지
      }
      this.syncDeco();
    }

    /** INTERP_DELAY 만큼 과거 시각을 두 스냅샷 사이에서 선형 보간 */
    update(delta = 16) {
      if (this.bounce) this.bounceT += delta / 90;
      if (this.fly || this.glow || this.state === 'swim') { this.flyT += delta / (this.glow ? 700 : 260); if (!this.buffer.length) this.setPosition(this.x, this.y); if (this.glow) this.setNight(this.nightAlpha); }
      if (this.tankFish && this.tankFish.length) this.syncTank();
      if (this.species === 'fish') this.tickRipple(delta);
      const buf = this.buffer;
      if (!buf.length) return;
      const rt = performance.now() - INTERP_DELAY;
      while (buf.length >= 2 && buf[1].t <= rt) buf.shift();
      const s0 = buf[0];
      const s1 = buf[1];
      if (s1 && s1.t > s0.t) {
        const k = Phaser.Math.Clamp((rt - s0.t) / (s1.t - s0.t), 0, 1);
        this.setPosition(s0.x + (s1.x - s0.x) * k, s0.y + (s1.y - s0.y) * k);
      } else this.setPosition(s0.x, s0.y);
    }

    /** 15단계: 어항 수면 물결 — 스프라이트 위쪽에 흔들리는 밝은 선 2개 */
    tickRipple(delta) {
      this.rippleT = (this.rippleT || 0) + delta / 1000;
      if (!this.ripple) this.ripple = this.scene.add.graphics().setDepth(this.sprite.depth + 0.00004);
      const g = this.ripple;
      const t = this.rippleT;
      const x = Math.round(this.x);
      const y = Math.round(this.y) - 24;
      g.clear();
      g.setDepth(this.sprite.depth + 0.00004);
      g.lineStyle(1, 0xdff4ff, 0.55);
      for (let i = 0; i < 2; i++) {
        const yy = y + i * 3 + Math.round(Math.sin(t * 2.2 + i) * 1.2);
        const x0 = x - 6 + Math.round(Math.sin(t * 1.7 + i * 2) * 2);
        g.lineBetween(x0, yy, x0 + 5, yy);
      }
    }

    /** 14단계: 어항 물고기 (FishNpc 스냅샷 tank: [fishId]) — 어항 안에서 작은 물고기가 헤엄친다 */
    setTank(ids) {
      const key = ids.join(',');
      if (key === this.tankKey) return;
      this.tankKey = key;
      for (const t of this.tankFish || []) t.sprite.destroy();
      this.tankFish = [];
      const meta = this.scene.fishMeta;
      if (!meta || !this.scene.textures.exists('fish')) return;
      ids.slice(0, 3).forEach((id, i) => {
        const sp = meta.species[id];
        if (!sp) return;
        const sprite = this.scene.add.sprite(this.x, this.y, 'fish', sp.index * meta.framesPerSpecies).setOrigin(0.5, 0.5).setScale(0.5);
        this.tankFish.push({ sprite, base: sp.index * meta.framesPerSpecies, phase: i * 2.1, speed: 0.7 + i * 0.2 });
      });
      this.setPosition(this.x, this.y);
    }

    syncTank() {
      if (!this.tankFish || !this.tankFish.length) return;
      const t = performance.now() / 1000;
      for (const f of this.tankFish) {
        const dx = Math.sin(t * f.speed + f.phase) * 7;
        const dy = Math.cos(t * f.speed * 0.8 + f.phase) * 3;
        f.sprite.setPosition(Math.round(this.x + dx), Math.round(this.y - 15 + dy)).setDepth(this.sprite.depth + 0.00003);
        f.sprite.setFlipX(Math.cos(t * f.speed + f.phase) > 0);
        f.sprite.setFrame(f.base + (Math.floor(t * 4 + f.phase) % 2));
      }
    }

    /** 반딧불이: 밤 가중치만큼 보인다 (깜빡임은 flyT) */
    setNight(night) {
      this.nightAlpha = night;
      if (!this.glow) return;
      const a = night * (0.55 + 0.45 * Math.abs(Math.sin(this.flyT * 1.7)));
      this.sprite.setAlpha(a);
      if (this.dot) this.dot.setAlpha(a);
    }

    /** 쓰다듬기 반응: 종별 이모지 (+ 하이파이브 🖐) */
    showHeart(reaction = '❤️', highFive = false) {
      this.clearHeart();
      const t = this.scene.add.text(0, 0, highFive ? `${reaction}🖐` : reaction, { fontSize: '16px', resolution: ZOOM }).setOrigin(0.5, 1).setDepth(DEPTH.bubble);
      t.rise = 0;
      this.heart = t;
      this.setPosition(this.x, this.y);
      this.scene.tweens.add({ targets: t, rise: 10, duration: 400, ease: 'Sine.easeOut', onUpdate: () => this.setPosition(this.x, this.y) });
      this.scene.tweens.add({ targets: t, alpha: 0, delay: 700, duration: 300 });
      this.heartTimer = this.scene.time.delayedCall(1000, () => this.clearHeart());
    }

    clearHeart() {
      if (this.heartTimer) this.heartTimer.remove(false);
      this.heartTimer = null;
      if (this.heart) this.heart.destroy();
      this.heart = null;
    }

    destroy() {
      this.clearHeart();
      this.clearBubble();
      if (this.xpText) this.xpText.destroy();
      if (this.spinTween) this.spinTween.remove();
      for (const slot of DECO_ORDER) if (this.deco[slot]) this.deco[slot].sprite.destroy();
      this.sprite.destroy();
      if (this.dot) this.dot.destroy();
      for (const t of this.tankFish || []) t.sprite.destroy();
      if (this.ripple) this.ripple.destroy();
      this.shadow.destroy();
      this.nameText.destroy();
    }
  }

  // ── 씬 ─────────────────────────────────────────────────────────────
  class RoomScene extends Phaser.Scene {
    constructor() {
      super('room');
    }

    init(data) {
      this.room = data.room;
      this.tilesMeta = data.tiles;
      this.avatarKit = data.avatarKit; // AvatarKit (catalog + 레이어 PNG)
      this.playerMeta = { frameWidth: this.avatarKit.frame.width, frameHeight: this.avatarKit.frame.height, framesPerRow: this.avatarKit.frame.framesPerRow, rows: this.avatarKit.frame.rows };
      this.petsMeta = data.pets; // 10단계: 펫 스프라이트시트 메타 (종별 인덱스·앵커)
      this.vehiclesMeta = data.vehicles || { seat: {}, decal: {} }; // 12단계: 탈것 아틀라스 메타 (앉는 위치·데칼 앵커)
      this.animalsMeta = data.animals || null; // 14단계: 동물 시트 메타 (종별 인덱스·프레임 이름)
      this.fishMeta = data.fish || null; // 14단계: 물고기 시트 메타 (어항 물고기)
      this.npcsMeta = data.npcs || null; // 18단계: 사람 NPC 시트 메타 (점원·바리스타)
      this.catalog = data.catalog || { items: [] }; // 9단계: 상점 카탈로그 (가구 스프라이트 메타)
      this.onReady = data.onReady || (() => {});
      // 맵 전환(restart)에도 main.js 가 채운 hooks 는 유지한다
      this.hooks = this.hooks || {
        onMove() {}, onSit() {}, onStand() {}, onPet() {}, onUse() {}, onInteract() {}, onEmojiKey() {}, onChatKey() {}, onPositions() {}, serverNow: () => Date.now(),
        // 9단계 편집: 서버 판정 결과(Promise<{ ok, error? }>)를 돌려준다. onEditState 는 UI 안내용
        onPlace: async () => ({ ok: false }), onGrab: async () => ({ ok: false }), onRelease() {}, onMove2: async () => ({ ok: false }), onRemove: async () => ({ ok: false }), onEditState() {},
        // 12단계
        onDoor() {}, onMount() {}, onHorn() {}, onProfile() {}, onVehicleMove() {}, onCreak() {},
        // 18단계
        onDogMenu() {},
      };
      this.doorArmed = false; // 문 타일을 벗어나면 켜진다 (도착 직후 되돌아가지 않도록)
      this.transferring = false; // 문 통과 중 (서버 응답 대기)
      this.boardTexts = null; // 전광판 글자
      this.boardData = null;
      this.cycleAcc = 0;
      this.cycleTargets = [];
      this.fireworks = null;
      this.celebrateUntil = 0;
      this.pendingReleases = null;
      this.ready = false; // create() 가 끝나면 true (맵 전환 중 들어오는 이벤트는 무시)
      this.furniture = null;
      this.extraLights = []; // 가구 조명 (스탠드 조명)
      this.editMode = false;
      this.dragging = false;
      this.pomoAcc = 0;
      this.npcs = new Map();
      this.nearNpc = null;
      this.nearItem = null; // 가까운 상호작용 지점 (커피머신·음악 패널)
      this.seatItemSprites = []; // 15단계: 책상 위 쪽지·머그 아이콘
      this.seatItems = { mugs: {}, notes: {} };
      this.myNotes = 0; // 내 자리에 놓인 안 읽은 쪽지 수 (앉아 있을 때 E = 읽기)
      this.ddayTexts = [];
      this.fireworkStyle = 'fireworks';
      this.screens = []; // { def, rect, line, glow, on }
      this.skies = [];
      this.zoneFx = [];
      this.clockOverride = null; // 스크린샷/테스트용 시각 고정 (시)
      this.alwaysNight = false;
      this.daylightAcc = DAYLIGHT_TICK;
      this.weights = null;
      this.fx = { flash: 0 };
      this.config = { speed: 150, feetW: 18, feetH: 10 };
      this.me = null;
      this.remotes = new Map();
      this.correction = null;
      this.nearSeat = null;
      this.seatOwners = {};
      this.sitPending = false;
      this.sendAcc = 0;
      this.lastSent = null;
      this.seatAcc = 0;
      this.posAcc = 0;
    }

    preload() {
      const v = this.room.assetVersion ? `?v=${this.room.assetVersion}` : '';
      // 맵 전환(restart) 때는 이미 올라온 텍스처를 다시 받지 않는다
      if (!this.textures.exists('tiles')) this.load.image('tiles', `/assets/tiles.png${v}`);
      if (!this.textures.exists('pets')) this.load.spritesheet('pets', `/assets/pets.png${v}`, { frameWidth: this.petsMeta.frameWidth, frameHeight: this.petsMeta.frameHeight });
      if (!this.textures.exists('petdeco')) this.load.atlas('petdeco', `/assets/petdeco.png${v}`, `/assets/petdeco.json${v}`);
      if (!this.textures.exists('furn')) this.load.atlas('furn', `/assets/furniture.png${v}`, `/assets/furniture.json${v}`);
      if (!this.textures.exists('vehicles')) this.load.atlas('vehicles', `/assets/vehicles.png${v}`, `/assets/vehicles.json${v}`);
      if (this.animalsMeta && !this.textures.exists('animals')) this.load.spritesheet('animals', `/assets/animals.png${v}`, { frameWidth: this.animalsMeta.frameWidth, frameHeight: this.animalsMeta.frameHeight });
      if (this.fishMeta && !this.textures.exists('fish')) this.load.spritesheet('fish', `/assets/fish.png${v}`, { frameWidth: this.fishMeta.frameWidth, frameHeight: this.fishMeta.frameHeight });
      if (this.npcsMeta && !this.textures.exists('npcs')) this.load.spritesheet('npcs', `/assets/npcs.png${v}`, { frameWidth: this.npcsMeta.frameWidth, frameHeight: this.npcsMeta.frameHeight });
    }

    create() {
      const room = this.room;
      const T = room.tileSize;
      this.T = T;
      this.mapW = room.width * T;
      this.mapH = room.height * T;

      this.buildLayers();
      if (!room.outdoor) this.buildPropShadows();
      this.buildSky();
      this.buildZones();
      this.buildLabels();
      this.buildAnchors();
      this.buildLightTextures();
      this.buildPetAnims();
      this.buildAnimalAnims();
      this.buildNpcAnims();
      this.buildLighting();
      this.buildScreens();
      this.furniture = new FurnitureLayer(this, this.catalog);
      this.bindEditInput();
      this.syncVignette();
      this.setupWindowTwinkle();
      this.setupTileCycles();
      if (room.outdoor) this.buildOutdoorFx();
      else this.buildIndoorFx();
      this.applyDaylight(this.currentWeights(), true);

      // 카메라 2배 줌 → 타일은 정수 배로 또렷하고, 텍스트는 고해상도로 그려진다. 캔버스는 사이드바를 뺀 영역에 꽉 찬다(RESIZE).
      const cam = this.cameras.main;
      cam.setZoom(ZOOM);
      cam.setBounds(0, 0, this.mapW, this.mapH);
      cam.setRoundPixels(true);
      cam.centerOn(room.spawn.x, room.spawn.y);
      cam.setBackgroundColor(room.outdoor ? '#101626' : '#14111a');
      if (!this.resizeBound) { this.resizeBound = true; this.scale.on('resize', () => this.syncVignette()); }

      this.cursors = this.input.keyboard.createCursorKeys();
      this.wasd = this.input.keyboard.addKeys({ up: 'W', down: 'S', left: 'A', right: 'D' });
      this.input.keyboard.on('keydown-E', () => this.toggleSeat());
      this.input.keyboard.on('keydown-V', () => { if (this.me && this.room.outdoor && !this.transferring) this.hooks.onMount(); });
      this.ready = true;
      this.input.keyboard.on('keydown-H', () => { if (this.me && this.me.riding) this.hooks.onHorn(); });
      this.input.keyboard.on('keydown-ENTER', () => this.hooks.onChatKey());
      ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX'].forEach((k, i) => this.input.keyboard.on(`keydown-${k}`, () => this.hooks.onEmojiKey(i)));
      this.onReady(this);
    }

    /** 채팅 입력 중엔 게임 키를 완전히 끈다 (눌린 키 상태도 초기화) */
    setInputEnabled(on) {
      const kb = this.input.keyboard;
      if (!kb) return;
      kb.enabled = on;
      if (!on) kb.resetKeys();
      if (on) kb.enableGlobalCapture();
      else kb.disableGlobalCapture();
    }

    // ── 세션 (입장/재입장 ack 적용) ──────────────────────────────────
    applySession(ack) {
      if (!this.ready) return;
      this.config = { ...this.config, ...ack.config };
      this.clearSession();
      this.seatOwners = { ...(ack.seats || {}) };
      this.lastSent = null;
      this.correction = null;
      this.nearSeat = null;
      this.nearNpc = null;
      this.nearItem = null;
      this.hooks.onInteract(null);
      this.doorArmed = false;
      this.transferring = false;
      this.furniture.setEntries(ack.layout || []); // 아바타보다 먼저 (누운 사람은 침대 사각형이 필요)
      this.me = new Avatar(this, ack.self);
      for (const p of ack.players) this.addRemote(p);
      for (const n of ack.npcs || []) this.upsertNpc(n);
      this.syncScreens();
      this.furniture.syncSeated(this.seatOwners);
      this.seatLast = { ...(ack.seatLast || {}) }; // 15단계: 좌석마다 마지막에 앉았던 닉네임
      this.myNotes = 0;
      this.setSeatItems(ack.seatItems || { mugs: {}, notes: {} });
      this.syncCorkboard();
      const cam = this.cameras.main;
      cam.startFollow(this.me.sprite, true, 0.15, 0.15);
      cam.centerOn(this.me.x, this.me.y);
    }

    clearSession() {
      for (const r of this.remotes.values()) r.avatar.destroy();
      this.remotes.clear();
      for (const n of this.npcs.values()) n.destroy();
      this.npcs.clear();
      if (this.me) this.me.destroy();
      this.me = null;
      this.setEditMode(false);
      this.cameras.main.stopFollow();
    }

    addRemote(p) {
      if (!this.ready) return;
      if (this.remotes.has(p.id)) this.removeRemote(p.id);
      const avatar = new Avatar(this, p);
      avatar.sprite.setAlpha(p.connected === false ? 0.5 : 1);
      this.remotes.set(p.id, { avatar, buffer: [], lastMoving: Boolean(p.moving) });
    }

    removeRemote(id) {
      const r = this.remotes.get(id);
      if (!r) return;
      r.avatar.destroy();
      this.remotes.delete(id);
      // 앉은 채로 나간 사람의 자리는 비운다 (화면도 꺼진다)
      for (const [seatId, owner] of Object.entries(this.seatOwners)) if (owner === id) delete this.seatOwners[seatId];
      this.syncScreens();
    }

    avatarOf(id) {
      if (this.me && this.me.id === id) return this.me;
      const r = this.remotes.get(id);
      return r ? r.avatar : null;
    }

    // ── 서버 이벤트 ─────────────────────────────────────────────────
    onRemoteMoved(d) {
      const r = this.remotes.get(d.id);
      if (!r) return;
      r.buffer.push({ x: d.x, y: d.y, facing: d.facing, moving: d.moving, vehicle: d.vehicle || null, t: performance.now() });
      if (r.buffer.length > 30) r.buffer.splice(0, r.buffer.length - 30);
      r.lastMoving = Boolean(d.moving);
    }

    // ── 12단계: 탈것 · 경적 · 랩 · 프로필 · 전광판 ──────────────────
    onVehicle(d) {
      const a = this.avatarOf(d.id);
      if (a) a.setVehicle(d.vehicle || null);
      if (a === this.me) this.lastSent = null;
    }

    onHorn(d) {
      const a = this.avatarOf(d.id);
      if (a) a.showEmoji('📣', 700);
    }

    /** 누군가 완주: 머리 위 🏁 */
    onLap(d) {
      const a = this.avatarOf(d.id);
      if (a) a.showEmoji('🏁', 2500);
    }

    onAvatarClick(avatar, pointer) {
      if (this.editMode || !this.room.outdoor || (pointer && pointer.rightButtonDown())) return;
      this.hooks.onProfile(avatar.id);
    }

    /** 전광판 글자: { today: [...], all: [...] } (닉네임 · 초). 야외가 아니면 무시 */
    refreshBoard(data) {
      this.boardData = data || this.boardData;
      if (!this.boardTexts || !this.boardData) return;
      const fmt = (r) => `${r.vehicle === 'rickshaw' ? '🛒' : ''}${r.nickname.length > 5 ? `${r.nickname.slice(0, 5)}…` : r.nickname} ${(r.ms / 1000).toFixed(1)}`;
      const fill = (list, rows) => rows.map((t, i) => t.setText(list[i] ? `${i + 1}. ${fmt(list[i])}` : `${i + 1}. -`));
      fill(this.boardData.today || [], this.boardTexts.today);
      fill(this.boardData.all || [], this.boardTexts.all);
    }

    buildBoard() {
      const prop = (this.room.props || []).find((p) => p.name === 'scoreboard');
      if (!prop) return;
      const T = this.T;
      const x0 = prop.x * T;
      const y0 = prop.y * T;
      const style = { fontFamily: FONTS.sans, fontSize: '8px', color: '#ffd08a', resolution: ZOOM };
      const head = { ...style, fontStyle: 'bold', color: '#ffb85c' };
      const mk = (x, y, text, st) => this.add.text(x, y, text, st).setOrigin(0, 0).setDepth(5);
      mk(x0 + 8, y0 + 16, 'TODAY', head);
      mk(x0 + 84, y0 + 16, 'ALL TIME', head);
      const today = [];
      const all = [];
      for (let i = 0; i < BOARD_ROWS; i++) {
        today.push(mk(x0 + 8, y0 + 27 + i * 10, `${i + 1}. -`, style));
        all.push(mk(x0 + 84, y0 + 27 + i * 10, `${i + 1}. -`, style));
      }
      this.boardTexts = { today, all };
      this.refreshBoard(null);
    }

    /** 야외 연출: 노을 틴트 · 낮 톤 · 구름 그림자 · 분수 물보라 · 별똥별 + 전광판 (14단계) */
    buildOutdoorFx() {
      this.sunsetTint = this.add.rectangle(0, 0, this.mapW, this.mapH, 0xf0a45c, 1).setOrigin(0, 0).setDepth(DEPTH.darkness - 0.5).setAlpha(0).setBlendMode(Phaser.BlendModes.MULTIPLY);
      this.toneTint = this.add.rectangle(0, 0, this.mapW, this.mapH, 0xffe9c4, 1).setOrigin(0, 0).setDepth(DEPTH.darkness - 0.6).setAlpha(0).setBlendMode(Phaser.BlendModes.MULTIPLY);
      this.buildBoard();
      this.buildClouds();
      this.buildFountainSpray();
      this.shootAcc = 0;
      this.shootingStars = 0; // 지금까지 떨어진 별똥별 수 (테스트용)
    }

    /**
     * 낮에 아주 천천히 지나가는 구름 그림자 3개 (후속 수정): 화면 폭의 40~60% 크기, 가장자리가 부드러운 방사형 그라데이션 덩어리(MULTIPLY).
     * 진하기는 Daylight.outdoorAmbient().clouds (낮 0.13, 노을·밤 0 → 밤엔 없음). 맵을 돌며 순환한다.
     */
    buildClouds() {
      this.clouds = [];
      let seed = 99;
      const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
      const viewW = this.scale.width / (ZOOM || 2); // 화면 폭 (월드 px, 설정 줌 기준 — 씬 생성 시점의 카메라 줌은 아직 1일 수 있다)
      for (let i = 0; i < 3; i++) {
        const w = Math.round(viewW * (0.4 + rnd() * 0.2));
        const h = Math.round(w * (0.5 + rnd() * 0.15));
        const key = `cloud-${i}-${w}x${h}`;
        if (!this.textures.exists(key)) this.makeCloudTexture(key, w, h, rnd);
        const g = this.add.image(0, 0, key).setOrigin(0, 0).setDepth(DEPTH.darkness - 0.7).setBlendMode(Phaser.BlendModes.MULTIPLY).setAlpha(0);
        const c = { g, w, h, x: rnd() * this.mapW, y: 2 * this.T + rnd() * (this.mapH - 6 * this.T), vx: 2 + rnd() * 2.5, vy: 0.3 + rnd() * 0.6 };
        g.setPosition(c.x, c.y);
        this.clouds.push(c);
      }
    }

    /** 구름 그림자 텍스처: 방사형 그라데이션 덩어리 여러 개를 겹쳐 가운데는 진하고 가장자리는 알파 0 으로 흩어진다 */
    makeCloudTexture(key, w, h, rnd) {
      const tex = this.textures.createCanvas(key, w, h);
      const ctx = tex.getContext();
      const blobs = [[0.5, 0.5, 0.5], [0.3, 0.46, 0.36], [0.7, 0.56, 0.34], [0.48, 0.3, 0.3], [0.4, 0.7, 0.28], [0.62, 0.72, 0.26]];
      for (const [bx, by, br] of blobs) {
        const cx = bx * w + (rnd() - 0.5) * w * 0.08;
        const cy = by * h + (rnd() - 0.5) * h * 0.08;
        const r = br * w;
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, 'rgba(154,166,191,0.85)');
        grad.addColorStop(0.45, 'rgba(154,166,191,0.5)');
        grad.addColorStop(0.8, 'rgba(154,166,191,0.12)');
        grad.addColorStop(1, 'rgba(154,166,191,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
      }
      tex.refresh();
    }

    tickClouds(dt) {
      for (const c of this.clouds) {
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        if (c.x > this.mapW + 20) c.x = -c.w - 20;
        if (c.y > this.mapH + 20) c.y = -c.h;
        c.g.setPosition(Math.round(c.x), Math.round(c.y));
      }
    }

    /** 분수 물보라: 가운데 물기둥 끝에서 물방울이 튀어 떨어진다 */
    buildFountainSpray() {
      const prop = (this.room.props || []).find((p) => p.name === 'fountain_f0');
      if (!prop) return;
      if (!this.textures.exists('drop')) {
        const tex = this.textures.createCanvas('drop', 4, 4);
        const ctx = tex.getContext();
        ctx.fillStyle = 'rgba(255,255,255,1)';
        ctx.beginPath();
        ctx.arc(2, 2, 2, 0, Math.PI * 2);
        ctx.fill();
        tex.refresh();
      }
      const T = this.T;
      const cx = (prop.x + 1.5) * T;
      const cy = (prop.y + 1.0) * T;
      this.spray = this.add.particles(cx, cy - 6, 'drop', {
        speedX: { min: -30, max: 30 }, speedY: { min: -80, max: -45 }, gravityY: 150,
        lifespan: { min: 520, max: 820 }, frequency: 40, quantity: 2,
        scale: { start: 0.9, end: 0.25 }, alpha: { start: 0.85, end: 0 },
        tint: [0xdff4ff, 0xffffff, 0xbfe4ff],
      }).setDepth(6);
    }

    /** 밤에 가끔 별똥별: 하늘 띠 안에서 대각선으로 스쳐 사라진다 (카메라가 보는 범위에 맞춰 위치를 고른다) */
    tickShootingStars(delta) {
      if (!this.room.outdoor || !this.weights || this.weights.night < 0.6) return;
      this.shootAcc += delta;
      if (this.shootAcc < 900) return;
      this.shootAcc = 0;
      if (Math.random() < 0.16) this.spawnShootingStar();
    }

    spawnShootingStar() {
      const win = this.skies[0];
      if (!win) return null;
      if (!this.textures.exists('streak')) {
        const tex = this.textures.createCanvas('streak', 32, 2);
        const ctx = tex.getContext();
        const g = ctx.createLinearGradient(0, 0, 32, 0);
        g.addColorStop(0, 'rgba(255,255,255,0)');
        g.addColorStop(1, 'rgba(255,255,255,1)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 32, 2);
        tex.refresh();
      }
      const view = this.cameras.main.worldView;
      const x0 = Phaser.Math.Clamp(view.x + Math.random() * Math.max(1, view.width), 0, this.mapW);
      const y0 = win.def.y + 4 + Math.random() * (win.def.h * 0.5);
      const len = 60 + Math.random() * 50;
      const img = this.add.image(x0, y0, 'streak').setOrigin(1, 0.5).setDepth(DEPTH.stars + 0.1).setRotation(Math.PI / 7).setScale(len / 32, 1).setAlpha(0.9);
      this.tweens.add({ targets: img, x: x0 + len * 1.5, y: y0 + len * 0.68, alpha: 0, duration: 650, ease: 'Sine.easeIn', onComplete: () => img.destroy() });
      this.shootingStars++;
      return img;
    }

    /** 물·분수 타일: cycleTiles(인덱스 → 다음) 를 일정 속도로 돌린다 (floor + furniture 레이어) */
    setupTileCycles() {
      const next = this.tilesMeta.cycleTiles || {};
      this.cycleTargets = [];
      for (const name of ['floor', 'furniture']) {
        const layer = this.layers[name];
        if (!layer) continue;
        layer.forEachTile((tile) => { if (next[tile.index] !== undefined) this.cycleTargets.push(tile); });
      }
      this.cycleNext = next;
    }

    tickCycles(delta) {
      if (!this.cycleTargets.length) return;
      this.cycleAcc += delta;
      if (this.cycleAcc < CYCLE_MS) return;
      this.cycleAcc = 0;
      for (const t of this.cycleTargets) t.index = this.cycleNext[t.index];
    }

    onCorrect(d) {
      this.correction = { x: d.x, y: d.y };
    }

    onSat(d) {
      this.seatOwners[d.seatId] = d.id;
      const a = this.avatarOf(d.id);
      if (!a) return;
      if (this.seatLast) { for (const [k, v] of Object.entries(this.seatLast)) if (v === a.nickname) delete this.seatLast[k]; this.seatLast[d.seatId] = a.nickname; }
      const r = this.remotes.get(d.id);
      if (r) r.buffer = [];
      a.setWalking(false);
      a.setPosition(d.x, d.y);
      a.setFacing(d.facing);
      a.setSeated(true, this.seatById(d.seatId));
      a.setStatus(d.status);
      this.syncScreens();
      this.furniture.syncSeated(this.seatOwners);
      this.syncCorkboard();
    }

    onStood(d) {
      for (const [seatId, owner] of Object.entries(this.seatOwners)) if (owner === d.id) delete this.seatOwners[seatId];
      this.syncScreens();
      this.furniture.syncSeated(this.seatOwners);
      const a = this.avatarOf(d.id);
      if (!a) return;
      a.setSeated(false, null);
      a.setPosition(d.x, d.y);
      a.setStatus(d.status);
      if (a === this.me) this.lastSent = null;
      this.syncCorkboard();
    }

    // ── 9단계: 가구 · 책상 소품 · 편집 모드 ─────────────────────────
    onLayoutUpdate(e) {
      if (!this.furniture) return;
      if (e.op === 'add' || e.op === 'move') this.furniture.upsert(e.entry);
      else if (e.op === 'remove') this.furniture.remove(e.id);
      else if (e.op === 'grab') this.furniture.setLock(e.id, e.by);
      else if (e.op === 'release') this.furniture.setLock(e.id, null);
      // 남이 옮긴 침대에 누워 있던 사람은 새 자리로
      if (e.op === 'move' || e.op === 'remove') for (const a of this.allAvatars()) if (a.seated && a.seat && a.seat.layoutId === (e.entry ? e.entry.id : e.id)) a.setSeated(true, this.seatById(a.seat.id));
      this.hooks.onEditState(this.editState());
    }

    onPlayerDesk(d) {
      const a = this.avatarOf(d.id);
      if (a) a.setDesk(d.deskItems);
    }

    onPlayerEdit(d) {
      const a = this.avatarOf(d.id);
      if (a) a.setEditing(d.editing);
    }

    allAvatars() {
      return [this.me, ...[...this.remotes.values()].map((r) => r.avatar)].filter(Boolean);
    }

    /** 가구가 바뀌면: 충돌 맵(FurnitureLayer.collision) · 조명 · 앉은 사람 애니 갱신 */
    onFurnitureChanged() {
      if (this.darkness && this.ambient) this.renderDarkness(this.ambient.darkness);
      if (this.furniture) this.furniture.syncSeated(this.seatOwners);
    }

    addFurnitureLight(l) {
      const g = this.add.image(l.x, l.y, 'glow').setScale((l.r * 2.2) / 256).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.glow);
      g.baseAlpha = l.intensity * 0.5;
      g.setAlpha(g.baseAlpha * (this.glowScale || 1));
      g.light = l;
      this.glows.push(g);
      this.extraLights.push(l);
      return g;
    }

    removeFurnitureLight(g) {
      this.glows = this.glows.filter((x) => x !== g);
      this.extraLights = this.extraLights.filter((l) => l !== g.light);
      g.destroy();
      if (this.darkness && this.ambient) this.renderDarkness(this.ambient.darkness);
    }

    /** 방 좌석 + 가구 좌석 */
    allSeats() {
      return this.furniture ? [...this.room.seats, ...this.furniture.seats()] : this.room.seats;
    }

    seatById(id) {
      if (!id) return null;
      return this.room.seats.find((s) => s.id === id) || (this.furniture ? this.furniture.seatById(id) : null);
    }

    editState() {
      const f = this.furniture;
      const p = f && f.preview;
      if (!this.editMode) return { on: false, mode: 'off' };
      if (p) return { on: true, mode: p.mode, item: p.item, ok: p.ok, error: p.error || null, rotatable: (p.item.sprite.rotations || []).length > 1 };
      if (f && f.selectedId !== null && f.entries.has(f.selectedId)) {
        const e = f.entries.get(f.selectedId);
        const item = f.itemOf(e.itemId);
        return { on: true, mode: 'selected', item, id: e.id, rotatable: (item.sprite.rotations || []).length > 1 };
      }
      return { on: true, mode: 'idle' };
    }

    setEditMode(on) {
      const want = Boolean(on);
      if (this.editMode === want) return;
      this.editMode = want;
      if (!want) {
        this.furniture.cancelPreview();
        this.deselect();
        this.dragging = false;
      }
      this.hooks.onEditState(this.editState());
    }

    /** 팔레트에서 고른 아이템 놓기 시작 (UI → 씬) */
    startPlacing(item, variant, inventoryId) {
      if (!this.editMode) return;
      this.deselect();
      this.furniture.startPlacing({ item, variant, inventoryId });
      this.hooks.onEditState(this.editState());
    }

    deselect() {
      const f = this.furniture;
      if (!f || f.selectedId === null) return;
      const id = f.selectedId;
      f.select(null);
      this.hooks.onRelease(id);
    }

    bindEditInput() {
      const kb = this.input.keyboard;
      kb.on('keydown-R', () => { if (this.editMode) this.rotateSelection(); });
      kb.on('keydown-ESC', () => { if (this.editMode) this.cancelEdit(); });
      kb.on('keydown-DELETE', () => { if (this.editMode) this.removeSelection(); });
      kb.on('keydown-BACKSPACE', () => { if (this.editMode) this.removeSelection(); });
      this.input.on('pointermove', (pointer) => {
        const p = this.furniture && this.furniture.preview;
        if (!this.editMode || !p) return;
        const snap = this.furniture.snap(pointer.worldX, pointer.worldY);
        if (snap.x !== p.x || snap.y !== p.y) {
          this.furniture.moveTo(snap.x, snap.y);
          this.hooks.onEditState(this.editState());
        }
      });
      this.input.on('pointerdown', (pointer) => {
        if (!this.editMode) return;
        if (pointer.rightButtonDown()) return this.cancelEdit();
        const p = this.furniture.preview;
        if (p && p.mode === 'place') return this.confirmPlace();
        // 놓인 가구를 잡는다 → 드래그
        const tx = Math.floor(pointer.worldX / this.T);
        const ty = Math.floor(pointer.worldY / this.T);
        const entry = this.furniture.entryAt(tx, ty);
        if (!entry) return this.deselect();
        if (this.furniture.selectedId !== entry.id) this.deselect();
        Promise.resolve(this.hooks.onGrab(entry.id)).then((r) => {
          if (!r || !r.ok || !this.editMode) return;
          this.furniture.select(entry.id);
          this.furniture.startDragging(this.furniture.entries.get(entry.id));
          this.dragging = true;
          this.hooks.onEditState(this.editState());
        });
      });
      this.input.on('pointerup', () => {
        if (!this.editMode || !this.dragging) return;
        this.dragging = false;
        const p = this.furniture.preview;
        if (!p || p.mode !== 'drag') return;
        const entry = this.furniture.entries.get(p.id);
        const moved = entry && (p.x !== entry.x || p.y !== entry.y || p.rotation !== (entry.rotation || 0));
        const { id, x, y, rotation, ok } = p;
        this.furniture.cancelPreview();
        if (moved && ok) Promise.resolve(this.hooks.onMove2(id, x, y, rotation)).then(() => this.hooks.onEditState(this.editState()));
        this.hooks.onEditState(this.editState());
      });
    }

    confirmPlace() {
      const p = this.furniture.preview;
      if (!p || p.mode !== 'place' || p.x === null) return;
      if (!p.ok) return this.hooks.onEditState({ ...this.editState(), rejected: p.error });
      const { inventoryId, x, y, rotation } = p;
      Promise.resolve(this.hooks.onPlace(inventoryId, x, y, rotation)).then((r) => {
        if (r && r.ok) this.furniture.cancelPreview();
        this.hooks.onEditState({ ...this.editState(), rejected: r && !r.ok ? r.error : null });
      });
    }

    rotateSelection() {
      const f = this.furniture;
      if (f.preview) {
        if (f.rotatePreview()) this.hooks.onEditState(this.editState());
        return;
      }
      if (f.selectedId === null) return;
      const e = f.entries.get(f.selectedId);
      const item = e && f.itemOf(e.itemId);
      const rots = item ? item.sprite.rotations || [0] : [0];
      if (rots.length < 2) return;
      const next = rots[(rots.indexOf(e.rotation || 0) + 1) % rots.length];
      Promise.resolve(this.hooks.onMove2(e.id, e.x, e.y, next)).then((r) => this.hooks.onEditState({ ...this.editState(), rejected: r && !r.ok ? r.error : null }));
    }

    removeSelection() {
      const f = this.furniture;
      const id = f.preview && f.preview.mode === 'drag' ? f.preview.id : f.selectedId;
      if (id === null || id === undefined) return;
      f.cancelPreview();
      this.dragging = false;
      Promise.resolve(this.hooks.onRemove(id)).then((r) => {
        if (r && r.ok) f.select(null);
        this.hooks.onEditState({ ...this.editState(), rejected: r && !r.ok ? r.error : null });
      });
    }

    cancelEdit() {
      this.furniture.cancelPreview();
      this.dragging = false;
      this.deselect();
      this.hooks.onEditState(this.editState());
    }

    onListening(d) {
      const a = this.avatarOf(d.id);
      if (a) a.setListening(d.listening);
    }

    onGoal(d) {
      const a = this.avatarOf(d.id);
      if (a) a.setGoal(d.goal);
      this.syncCorkboard();
    }

    /** 랭킹 통계(닉네임 → 오늘 누적 초)로 팻말 진행 바 갱신 */
    applyProgress(rows) {
      const by = new Map(rows.map((r) => [r.nickname, r.todaySeconds]));
      const all = [this.me, ...[...this.remotes.values()].map((r) => r.avatar)].filter(Boolean);
      for (const a of all) {
        if (!a.goal || !a.goal.targetMinutes) continue;
        a.setProgress((by.get(a.nickname) || 0) / (a.goal.targetMinutes * 60));
      }
    }

    /** 목표 달성: 머리 위 🎉 3초 */
    onGoalReached(d) {
      const a = this.avatarOf(d.id);
      if (a) {
        a.showEmoji('🎉', 3000);
        a.setProgress(1);
      }
    }

    onStatus(d) {
      const a = this.avatarOf(d.id);
      if (a) a.setStatus(d.status);
    }

    /** 8단계: 누군가의 뽀모도로가 시작/정지/전환됐다 → 머리 위 표시 */
    onPlayerPomodoro(d) {
      const a = this.avatarOf(d.id);
      if (a) a.setPomodoro(d.pomodoro);
    }

    /** 8단계: 코인 증감 → 머리 위 "+N 🪙" */
    onCoins(d) {
      const a = this.avatarOf(d.id);
      if (a && d.delta) a.showCoin(d.delta);
    }

    /** 머리 위 타이머 글자 (1초마다) */
    tickPomodoros() {
      const now = this.hooks.serverNow();
      if (this.me) { this.me.tickPomo(now); this.me.tickSnack(now); this.me.tickBuff(); }
      for (const r of this.remotes.values()) { r.avatar.tickPomo(now); r.avatar.tickSnack(now); r.avatar.tickBuff(); }
    }

    onAvatar(d) {
      const a = this.avatarOf(d.id);
      if (a) a.setAvatar(d.avatar);
    }

    onEmoji(d) {
      const a = this.avatarOf(d.id);
      if (a) a.showEmoji(d.emoji);
    }

    onChat(d) {
      const a = this.avatarOf(d.id);
      if (a) a.showChat(unescapeHtml(d.text));
    }

    onPresence(id, connected) {
      const r = this.remotes.get(id);
      if (r) r.avatar.sprite.setAlpha(connected ? 1 : 0.5);
    }

    // ── NPC ─────────────────────────────────────────────────────────
    upsertNpc(snap) {
      if (!this.ready) return;
      let n = this.npcs.get(snap.id);
      if (!n) {
        n = new Npc(this, snap);
        this.npcs.set(snap.id, n);
      }
      n.push(snap);
    }

    onNpcPet(d) {
      const n = this.npcs.get(d.id);
      if (n) n.showHeart(d.reaction || '❤️', Boolean(d.highFive));
    }

    /** 펫 회수 · 주인 퇴장 (10단계) */
    removeNpc(id) {
      const n = this.npcs.get(id);
      if (!n) return;
      n.destroy();
      this.npcs.delete(id);
    }

    onNpcName(d) {
      const n = this.npcs.get(d.id);
      if (n) n.setName(d.name);
    }

    /** 18단계: NPC 말풍선 (바리스타가 커피를 내주면 머신 김이 잠깐 강해진다) */
    onNpcSay(d) {
      const n = this.npcs.get(d.id);
      if (n) n.say(d.text, d.ms || 2500);
      if (d.steam) this.steamBurst();
    }

    onNpcTrick(d) {
      const n = this.npcs.get(d.id);
      if (n) n.showTrick(d.trick, d.ms);
    }

    /** 18단계: 산책 xp — 산책 강아지(또는 라운지 강아지) 머리 위 "🐾 +1" */
    onDogXp(d) {
      const n = this.npcs.get(d.id) || [...this.npcs.values()].find((x) => x.walk) || this.npcs.get('dog');
      if (n) n.showXp(d.amount || 1);
    }

    /** 18단계: 커피머신 김 2초 동안 강하게 */
    steamBurst() {
      if (!this.steam) return;
      this.steamBursts = (this.steamBursts || 0) + 1;
      this.steam.frequency = 60;
      this.steam.quantity = 2;
      if (this.steamTimer) this.steamTimer.remove(false);
      this.steamTimer = this.time.delayedCall(2000, () => { if (this.steam) { this.steam.frequency = 240; this.steam.quantity = 1; } });
    }

    /** 18단계: 사람 NPC 행동 애니 (캐릭터 x 행동, 2프레임) */
    buildNpcAnims() {
      const nm = this.npcsMeta;
      if (!nm || !this.textures.exists('npcs')) return;
      for (const [name, ch] of Object.entries(nm.chars)) {
        const base = ch.index * nm.framesPerChar;
        for (const [act, frames] of Object.entries(nm.actions)) {
          const key = `npc-${name}-${act}`;
          if (this.anims.exists(key)) continue;
          this.anims.create({ key, frames: frames.map((f) => ({ key: 'npcs', frame: base + f })), frameRate: act === 'wave' ? 4 : 2.5, repeat: -1 });
        }
      }
    }

    findNearNpc() {
      if (!this.me) return null;
      let best = null;
      let bestD = SIT_RANGE;
      for (const n of this.npcs.values()) {
        if (!n.pettable) continue; // 14단계: 우리 안 동물·새는 쓰다듬기 대상이 아니다
        const d = Math.hypot(n.x - this.me.x, n.y - this.me.y);
        if (d < bestD) {
          bestD = d;
          best = n;
        }
      }
      return best;
    }

    npcCloser() {
      const T = this.T;
      const ds = Math.hypot((this.nearSeat.x + 0.5) * T - this.me.x, (this.nearSeat.y + 1) * T - this.me.y);
      const dn = Math.hypot(this.nearNpc.x - this.me.x, this.nearNpc.y - this.me.y);
      return dn < ds;
    }

    // ── 상호작용 지점 (커피머신 앞 · 음악 패널 앞) ───────────────────
    findNearItem() {
      if (!this.me) return null;
      let best = null;
      let bestD = Infinity;
      for (const it of this.room.interactables || []) {
        const d = Math.hypot(it.x - this.me.x, it.y - this.me.y);
        if (d <= (it.range || SIT_RANGE) && d < bestD) {
          bestD = d;
          best = it;
        }
      }
      return best;
    }

    /** E 키 대상: 좌석·강아지·상호작용 지점 중 가장 가까운 것 → { kind, target } | null */
    pickTarget() {
      const me = this.me;
      if (!me) return null;
      if (me.fishing) return { kind: me.fishing.state === 'bite' ? 'reel' : 'reel', target: { id: 'reel' }, d: 0 }; // 14단계: 낚시 중엔 E = 낚아채기
      const T = this.T;
      const cands = [];
      if (this.nearSeat) cands.push({ kind: this.seatActionKind(this.nearSeat), target: this.nearSeat, d: Math.hypot((this.nearSeat.x + 0.5) * T - me.x, (this.nearSeat.y + 1) * T - me.y) });
      if (this.nearNpc) cands.push({ kind: this.nearNpc.isDog ? 'dog' : 'pet', target: this.nearNpc, d: Math.hypot(this.nearNpc.x - me.x, this.nearNpc.y - me.y) }); // 18단계: 강아지는 E 메뉴
      if (this.nearItem) cands.push({ kind: this.nearItem.kind, target: this.nearItem, d: Math.hypot(this.nearItem.x - me.x, this.nearItem.y - me.y) });
      if (!cands.length) return null;
      cands.sort((a, b) => a.d - b.d);
      return cands[0];
    }

    /** 14단계: 동물 시트 애니 — 걷기(walk_a/b) · 먹기(eat/idle) · 날기(sit(fly)/idle). 프레임 = species.index*6 + f */
    buildAnimalAnims() {
      const meta = this.animalsMeta;
      if (!meta || !this.textures.exists('animals')) return;
      const F = meta.frames;
      for (const [name, sp] of Object.entries(meta.species)) {
        const base = sp.index * meta.framesPerSpecies;
        const mk = (key, list, frameRate) => {
          if (this.anims.exists(key)) return;
          this.anims.create({ key, frames: list.map((f) => ({ key: 'animals', frame: base + F[f] })), frameRate, repeat: -1 });
        };
        mk(`animal-${name}-walk`, ['walk_a', 'walk_b'], name === 'squirrel' ? 8 : 4);
        mk(`animal-${name}-eat`, ['eat', 'idle'], 2);
        mk(`animal-${name}-fly`, ['sit', 'idle'], 9);
        mk(`animal-${name}-swim`, ['sit', 'sit'], 1);
      }
    }

    /** 14단계: 낚시 자세/입질/종료 (playerFishing) */
    onFishing(d) {
      const a = this.avatarOf(d.id);
      if (!a) return;
      a.setFishing(d.fishing || null);
      if (a === this.me) { this.lastSent = null; this.hooks.onInteract(this.pickTarget() ? this.pickTarget().kind : null); }
    }

    /** 14단계: 누가 물고기를 잡았다 → 머리 위 물고기 아이콘 */
    onFishCaught(d) {
      const a = this.avatarOf(d.id);
      if (a) a.showEmoji(d.fish && d.fish.emoji ? d.fish.emoji : '🐟', 3000);
    }

    /** 14단계: 손에 든 간식 (playerSnack) */
    onSnack(d) {
      const a = this.avatarOf(d.id);
      if (a) a.setSnack(d.snack || null);
    }

    /** 14단계: 포토존 플래시 — 화면이 하얗게 번쩍 + 두 사람 머리 위 📸 */
    onPhoto(d) {
      for (const id of d.ids || []) {
        const a = this.avatarOf(id);
        if (a) a.showEmoji('📸', 2500);
      }
      this.cameras.main.flash(420, 255, 255, 255);
      this.photos = (this.photos || 0) + 1;
    }

    /** 종마다 걷기 4방향·꼬리 흔들기·자기 애니메이션 (pets 시트: row*framesPerRow + species*2 + f) */
    buildPetAnims() {
      const meta = this.petsMeta;
      const per = meta.framesPerRow;
      const n = meta.framesPerSpecies;
      for (const [name, sp] of Object.entries(meta.species)) {
        const mk = (key, row, frameRate) => {
          if (this.anims.exists(key)) return;
          const start = meta.rows[row] * per + sp.index * n;
          this.anims.create({ key, frames: this.anims.generateFrameNumbers('pets', { start, end: start + n - 1 }), frameRate, repeat: -1 });
        };
        const fast = name === 'slime' || name === 'chick' || name === 'hamster';
        for (const dir of ['down', 'right', 'up', 'left']) mk(`pet-${name}-walk-${dir}`, dir, fast ? 7 : 5);
        mk(`pet-${name}-wag`, 'sit', 6);
        mk(`pet-${name}-sleep`, 'sleep', 1.2);
      }
    }

    /** 꾸미기 애니(날개 펄럭임): 프레임이 2개 이상인 키만 */
    decoAnimKey(key, view = 'front') {
      const tex = this.textures.get('petdeco');
      if (!tex.has(`deco/${key}/${view}/f1`)) return null;
      const animKey = `deco-${key}-${view}`;
      if (!this.anims.exists(animKey)) this.anims.create({ key: animKey, frames: [{ key: 'petdeco', frame: `deco/${key}/${view}/f0` }, { key: 'petdeco', frame: `deco/${key}/${view}/f1` }], frameRate: 4, repeat: -1 });
      return animKey;
    }

    // ── 좌석 ────────────────────────────────────────────────────────
    findNearSeat() {
      if (!this.me) return null;
      const T = this.T;
      let best = null;
      let bestD = SIT_RANGE;
      for (const s of this.allSeats()) {
        const owner = this.seatOwners[s.id];
        if (owner && owner !== this.me.id) continue;
        const d = Math.hypot((s.x + 0.5) * T - this.me.x, (s.y + 1) * T - this.me.y);
        if (d < bestD) {
          bestD = d;
          best = s;
        }
      }
      return best;
    }

    /** 15단계: 빈 좌석의 E 종류 — 남(멤버)의 자리면 '앉기 · 쪽지' 선택, 아니면 앉기/눕기/안마 */
    seatActionKind(seat) {
      const owner = this.seatLast && !this.room.outdoor ? this.seatLast[seat.id] : null;
      if (owner && this.me && owner !== this.me.nickname && !this.seatOwners[seat.id]) return 'seatChoice';
      return HINT_KIND[seat.kind] || 'sit';
    }

    /** 앉기 요청 (자리 선택 모달에서도 쓴다) */
    sitAt(seatId) {
      if (this.sitPending || !this.me || this.me.seated) return Promise.resolve();
      // 앉기 요청 전에 마지막 위치를 보내고, 응답이 올 때까지는 위치 전송을 멈춘다 (착석 뒤 도착한 move 가 거부되지 않도록)
      this.flushMove(false);
      this.sitPending = true;
      return Promise.resolve(this.hooks.onSit(seatId)).finally(() => { this.sitPending = false; });
    }

    /** 15단계: 내 자리에 놓인 쪽지 수 (앉아 있으면 E = 읽기) */
    setMyNotes(n) {
      this.myNotes = Number(n) || 0;
      if (this.me && this.me.seated) this.hooks.onInteract(this.myNotes > 0 ? 'read' : 'stand');
    }

    toggleSeat() {
      if (!this.me) return;
      if (this.me.seated) return this.myNotes > 0 ? this.hooks.onReadNote() : this.hooks.onStand();
      const pick = this.pickTarget();
      if (!pick) return;
      if (pick.kind === 'pet') return this.hooks.onPet(pick.target.id);
      if (pick.kind === 'dog') { this.flushMove(false); return this.hooks.onDogMenu(pick.target.id); }
      if (pick.kind === 'seatChoice') {
        this.flushMove(false);
        return this.hooks.onSeatChoice(pick.target, this.seatLast[pick.target.id]);
      }
      if (pick.kind === 'sit' || pick.kind === 'lie' || pick.kind === 'massage') return this.sitAt(pick.target.id);
      // 커피머신·음악 패널: 서버가 거리를 확인하므로 마지막 위치를 먼저 보낸다
      this.flushMove(false);
      this.hooks.onUse(pick.kind, pick.target.id);
    }

    /** 현재 위치/방향이 마지막 전송과 다르면 즉시 보낸다 */
    flushMove(moving) {
      const me = this.me;
      if (!me || me.seated) return;
      const snap = { x: round2(me.x), y: round2(me.y), facing: me.facing, moving };
      if (me.riding) {
        const v = me.vehicle.vehicle;
        snap.vehicle = { type: v.type, angle: Math.round(v.angle * 1000) / 1000, speed: Math.round(v.speed) };
      }
      const last = this.lastSent;
      const vChanged = Boolean(snap.vehicle) !== Boolean(last && last.vehicle) || (snap.vehicle && (snap.vehicle.angle !== last.vehicle.angle || snap.vehicle.speed !== last.vehicle.speed));
      if (!last || last.x !== snap.x || last.y !== snap.y || last.facing !== snap.facing || last.moving !== snap.moving || vChanged) {
        this.lastSent = snap;
        this.hooks.onMove(snap);
      }
    }

    // ── 매 프레임 ───────────────────────────────────────────────────
    update(_time, delta) {
      if (this.fireworks && (this.fireworks.length || this.celebrating)) this.tickFireworks();
      const dt = delta / 1000;
      if (this.me) {
        this.updateLocal(dt, delta);
        if (this.me.rod) this.me.drawRod();
        this.seatAcc += delta;
        if (this.seatAcc >= 150) {
          this.seatAcc = 0;
          const s = this.me.seated ? null : this.findNearSeat();
          const n = this.me.seated ? null : this.findNearNpc();
          const it = this.me.seated ? null : this.findNearItem();
          if ((s && s.id) !== (this.nearSeat && this.nearSeat.id) || (n && n.id) !== (this.nearNpc && this.nearNpc.id) || (it && it.id) !== (this.nearItem && this.nearItem.id)) {
            this.nearSeat = s;
            this.nearNpc = n;
            this.nearItem = it;
            const pick = this.pickTarget();
            this.hooks.onInteract(pick ? pick.kind : null);
          }
        }
      }
      this.updateRemotes();
      for (const n of this.npcs.values()) n.update(delta);
      this.tickCycles(delta);
      if (this.rain) this.tickRain(delta);
      if (this.clocks) this.tickClocks(delta);
      if (this.clouds) this.tickClouds(dt);
      if (this.room.outdoor) this.tickShootingStars(delta);
      this.pomoAcc += delta;
      if (this.pomoAcc >= POMO_TICK) {
        this.pomoAcc = 0;
        this.tickPomodoros();
      }
      this.daylightAcc += delta;
      if (this.daylightAcc >= DAYLIGHT_TICK) {
        this.daylightAcc = 0;
        this.applyDaylight(this.currentWeights());
      }
      this.posAcc += delta;
      if (this.posAcc >= 100) {
        this.posAcc = 0;
        const map = {};
        if (this.me) map[this.me.id] = { x: this.me.x, y: this.me.y };
        for (const [id, r] of this.remotes) map[id] = { x: r.avatar.x, y: r.avatar.y };
        for (const [id, n] of this.npcs) map[id] = { x: n.x, y: n.y, npc: true, species: n.species };
        this.hooks.onPositions(map);
      }
    }

    updateLocal(dt, delta) {
      const me = this.me;
      if (me.riding) return this.updateVehicle(dt, delta);
      const kb = this.input.keyboard;
      let dx = 0;
      let dy = 0;
      if (kb.enabled && !me.seated && !this.transferring && !me.fishing) {
        if (this.cursors.left.isDown || this.wasd.left.isDown) dx -= 1;
        if (this.cursors.right.isDown || this.wasd.right.isDown) dx += 1;
        if (this.cursors.up.isDown || this.wasd.up.isDown) dy -= 1;
        if (this.cursors.down.isDown || this.wasd.down.isDown) dy += 1;
      }
      let x = me.x;
      let y = me.y;
      const moving = Boolean(dx || dy);
      if (moving) {
        const len = Math.hypot(dx, dy);
        const vx = (dx / len) * this.config.speed * dt;
        const vy = (dy / len) * this.config.speed * dt;
        // 축별로 따로 이동 → 벽에 붙어 미끄러지기
        if (this.canStand(x + vx, y)) x += vx;
        if (this.canStand(x, y + vy)) y += vy;
        const f = Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down';
        if (f !== me.facing) me.setFacing(f);
      }
      // 서버 보정: 순간이동 없이 서버 위치로 부드럽게 수렴
      if (this.correction) {
        const c = this.correction;
        const k = Math.min(1, dt * CORRECT_RATE);
        x += (c.x - x) * k;
        y += (c.y - y) * k;
        if (Math.hypot(c.x - x, c.y - y) < 0.5) {
          x = c.x;
          y = c.y;
          this.correction = null;
        }
      }
      me.setPosition(x, y);
      me.setWalking(moving);
      this.checkDoor();

      // 20Hz 전송 (움직였거나 방향/정지 상태가 바뀐 경우만)
      this.sendAcc += delta;
      if (this.sendAcc >= SEND_INTERVAL) {
        this.sendAcc = 0;
        if (!this.sitPending) this.flushMove(moving);
      }
    }

    /** 12단계: 발 위치가 to 가 있는 문 타일이면 문을 통과한다 (문을 벗어나야 다시 켜진다) */
    checkDoor() {
      const me = this.me;
      const T = this.T;
      const tx = Math.floor(me.x / T);
      const ty = Math.floor((me.y - 1) / T);
      const door = (this.room.doors || []).find((d) => d.to && d.x === tx && d.y === ty);
      if (!door) { this.doorArmed = true; return; }
      if (!this.doorArmed || this.transferring || me.seated) return;
      this.transferring = true;
      me.setWalking(false);
      this.flushMove(false);
      Promise.resolve(this.hooks.onDoor(door)).then((r) => { if (!r || !r.ok) { this.transferring = false; this.doorArmed = false; } });
    }

    /** 12단계: 탑승 중 물리 — 방향키(8방향)로 가속, 키를 떼면 관성·마찰, 반대 방향은 브레이크 (Vehicles.step, 서버와 같은 상수). 충돌은 튕김 */
    updateVehicle(dt, delta) {
      const me = this.me;
      const kb = this.input.keyboard;
      const v = me.vehicle.vehicle;
      const input = { up: false, down: false, left: false, right: false };
      if (kb.enabled && !this.transferring) {
        input.left = this.cursors.left.isDown || this.wasd.left.isDown;
        input.right = this.cursors.right.isDown || this.wasd.right.isDown;
        input.up = this.cursors.up.isDown || this.wasd.up.isDown;
        input.down = this.cursors.down.isDown || this.wasd.down.isDown;
      }
      const next = Vehicles.step(v.type, { x: me.x, y: me.y, angle: v.angle, speed: v.speed }, input, Math.min(dt, 0.05), (x, y) => this.canStand(x, y));
      let { x, y } = next;
      if (this.correction) {
        const c = this.correction;
        const k = Math.min(1, dt * CORRECT_RATE);
        x += (c.x - x) * k;
        y += (c.y - y) * k;
        if (Math.hypot(c.x - x, c.y - y) < 0.5) { x = c.x; y = c.y; this.correction = null; }
      }
      me.setPosition(x, y);
      me.setVehicleMotion(next.angle, next.speed);
      if (next.hit && next.speed > 20) this.cameras.main.shake(80, 0.002);
      // 낡은 인력거: 달릴 때 삐걱 (덜컹거림은 VehicleView 가 그린다)
      if (Vehicles.TYPES[v.type].wobble && next.speed > 10) {
        this.creakAcc = (this.creakAcc || 0) + delta;
        if (this.creakAcc >= 650) { this.creakAcc = 0; this.hooks.onCreak(); }
      }
      this.checkDoor();
      this.sendAcc += delta;
      if (this.sendAcc >= SEND_INTERVAL) {
        this.sendAcc = 0;
        this.flushMove(next.speed > 1);
      }
    }

    /** 원격 아바타: INTERP_DELAY 만큼 과거 시각을 두 스냅샷 사이에서 선형 보간 */
    updateRemotes() {
      const rt = performance.now() - INTERP_DELAY;
      for (const r of this.remotes.values()) {
        const a = r.avatar;
        const buf = r.buffer;
        if (!buf.length || a.seated) {
          if (!a.seated) a.setWalking(false);
          continue;
        }
        // 렌더 시각보다 오래된 스냅샷은 하나만 남기고 버린다
        while (buf.length >= 2 && buf[1].t <= rt) buf.shift();
        const s0 = buf[0];
        const s1 = buf[1];
        let x;
        let y;
        let facing = s0.facing;
        if (s1 && s1.t > s0.t) {
          const k = Phaser.Math.Clamp((rt - s0.t) / (s1.t - s0.t), 0, 1);
          x = s0.x + (s1.x - s0.x) * k;
          y = s0.y + (s1.y - s0.y) * k;
          facing = s1.facing;
        } else {
          x = s0.x;
          y = s0.y;
        }
        const movedNow = Math.hypot(x - a.x, y - a.y) > 0.05;
        a.setPosition(x, y);
        const vs = (s1 && s1.vehicle) || s0.vehicle;
        if (a.riding && vs) a.setVehicleMotion(vs.angle, vs.speed);
        else if (facing !== a.facing) a.setFacing(facing);
        // 다음 스냅샷이 아직 없어도 마지막 패킷이 '이동 중' 이면 짧게 걷기 유지 (지연 흔들림 방지)
        const stale = performance.now() - buf[buf.length - 1].t > 250;
        a.setWalking(movedNow || (r.lastMoving && !stale));
      }
    }

    // ── 타일맵 ─────────────────────────────────────────────────────
    buildLayers() {
      const room = this.room;
      const T = this.T;
      const map = this.make.tilemap({ tileWidth: T, tileHeight: T, width: room.width, height: room.height });
      const tileset = map.addTilesetImage('tiles', 'tiles', T, T, 0, 0);
      this.map = map;
      this.layers = {};
      const depths = { floor: 0, furniture: 1, windowDay: DEPTH.windowDay, top: 20 };
      for (const name of ['floor', 'furniture', 'windowDay', 'top']) {
        if (!room.layers[name]) continue;
        const layer = map.createBlankLayer(name, tileset, 0, 0);
        layer.putTilesAt(room.layers[name], 0, 0);
        layer.setDepth(depths[name]);
        this.layers[name] = layer;
      }
      if (this.layers.windowDay) this.layers.windowDay.setAlpha(0);
    }

    // ── 창밖 하늘 (시간대 그라데이션 + 별) ─────────────────────────
    buildSky() {
      this.skies = [];
      (this.room.windows || []).forEach((w, i) => {
        const key = `sky-${i}`;
        if (this.textures.exists(key)) this.textures.remove(key);
        const tex = this.textures.createCanvas(key, w.w, w.h);
        const img = this.add.image(w.x, w.y, key).setOrigin(0, 0).setDepth(DEPTH.sky);
        // 별: 결정적 위치(창마다 고정), 밤에만 보인다
        const stars = this.add.graphics().setDepth(DEPTH.stars);
        let seed = 17 + i * 31;
        const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
        const outdoor = Boolean(this.room.outdoor);
        const count = outdoor ? Math.round(w.w / 5) : Math.max(26, Math.round(w.w / 24));
        for (let k = 0; k < count; k++) {
          const sx = w.x + 4 + rnd() * (w.w - 8);
          const sy = w.y + 4 + rnd() * (w.h * (outdoor ? 0.7 : 0.45));
          stars.fillStyle(rnd() < 0.3 ? 0xdfe6f5 : 0xb9c4dd, 0.5 + rnd() * 0.5);
          const size = outdoor && rnd() < 0.6 ? 1 : 2;
          stars.fillRect(Math.round(sx), Math.round(sy), size, size);
        }
        this.skies.push({ def: w, tex, img, stars });
      });
    }

    paintSky(weights) {
      const stops = Daylight.skyStops(weights);
      for (const s of this.skies) {
        const ctx = s.tex.getContext();
        const g = ctx.createLinearGradient(0, 0, 0, s.def.h);
        stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, s.def.w, s.def.h);
        s.tex.refresh();
        s.stars.setAlpha(weights.night);
      }
    }

    // ── 유리 스터디룸 구역: 틴트 + 창가 쪽 사선 반사 (밝기는 buildLighting 에서) ──
    buildZones() {
      this.zoneFx = [];
      for (const z of this.room.zones || []) {
        if (z.kind !== 'glass') continue;
        const tint = this.add.rectangle(z.x, z.y, z.w, z.h, 0xcfe8f5, 0.07).setOrigin(0, 0).setDepth(DEPTH.zone);
        const g = this.add.graphics().setDepth(DEPTH.zone);
        // 창(위쪽)에서 들어온 빛이 유리에 비친 한 줄: 왼쪽 위 → 오른쪽 아래 사선 띠
        g.fillStyle(0xffffff, 0.06);
        g.fillPoints([
          { x: z.x + z.w * 0.12, y: z.y }, { x: z.x + z.w * 0.24, y: z.y },
          { x: z.x + z.w * 0.66, y: z.y + z.h * 0.58 }, { x: z.x + z.w * 0.54, y: z.y + z.h * 0.58 },
        ], true);
        g.lineStyle(1, 0xffffff, 0.12);
        g.lineBetween(z.x + z.w * 0.27, z.y, z.x + z.w * 0.69, z.y + z.h * 0.58);
        this.zoneFx.push({ def: z, tint, g });
      }
    }

    // ── 화면 (좌석 점유 시 모니터/노트북 켜짐) ─────────────────────
    buildScreens() {
      this.screens = [];
      for (const def of this.room.screens || []) {
        const rect = this.add.rectangle(def.x, def.y, def.w, def.h, 0xd9eeff, 1).setOrigin(0, 0).setDepth(DEPTH.screen).setAlpha(0);
        const line = this.add.rectangle(def.x + 2, def.y + Math.floor(def.h / 2), Math.max(2, def.w - 6), 2, 0xa9d6f2, 1).setOrigin(0, 0).setDepth(DEPTH.screen).setAlpha(0);
        const glow = this.add.image(def.x + def.w / 2, def.y + def.h / 2 + 4, 'glow-cool')
          .setScale((def.w * 3.2) / 256)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setDepth(DEPTH.glow)
          .setAlpha(0);
        this.screens.push({ def, rect, line, glow, on: false });
      }
    }

    /** 서버 좌석 상태(seatOwners) 기준으로 화면 on/off 동기화 */
    syncScreens() {
      for (const s of this.screens) {
        const on = Boolean(this.seatOwners[s.def.seatId]);
        if (on === s.on) continue;
        s.on = on;
        this.tweens.killTweensOf([s.rect, s.line, s.glow]);
        this.tweens.add({ targets: [s.rect, s.line], alpha: on ? 0.95 : 0, duration: on ? 220 : 350, ease: 'Sine.easeOut' });
        this.tweens.add({ targets: s.glow, alpha: on ? 0.55 : 0, duration: on ? 400 : 350, ease: 'Sine.easeOut' });
      }
    }

    screenStates() {
      return this.screens.map((s) => ({ seatId: s.def.seatId, kind: s.def.kind, on: s.on, alpha: s.rect.alpha }));
    }

    // ── 시간대 ─────────────────────────────────────────────────────
    currentWeights() {
      if (this.alwaysNight) return { day: 0, sunset: 0, night: 1 };
      const hour = this.clockOverride !== null ? this.clockOverride : Daylight.hourOf(new Date());
      return Daylight.weightsAt(hour);
    }

    /** 설정 '항상 밤' */
    setAlwaysNight(on) {
      this.alwaysNight = Boolean(on);
      this.applyDaylight(this.currentWeights(), true);
    }

    /** 스크린샷/테스트용: 시각(시, 소수) 고정. null 이면 실제 시각 */
    setClockOverride(hour) {
      this.clockOverride = hour === null || hour === undefined ? null : Number(hour);
      this.applyDaylight(this.currentWeights(), true);
    }

    applyDaylight(w, force = false) {
      const prev = this.weights;
      if (!force && prev && Math.abs(prev.day - w.day) < 0.004 && Math.abs(prev.sunset - w.sunset) < 0.004 && Math.abs(prev.night - w.night) < 0.004) return;
      this.weights = w;
      this.paintSky(w);
      const amb = this.room.outdoor ? Daylight.outdoorAmbient(w) : Daylight.ambient(w);
      this.ambient = amb;
      if (this.sunsetTint) this.sunsetTint.setAlpha(amb.sunsetTint || 0);
      if (this.toneTint) this.toneTint.setAlpha(amb.tone || 0);
      if (this.clouds) for (const c of this.clouds) c.g.setAlpha(amb.clouds || 0);
      if (this.spray) this.spray.setAlpha(0.55 + 0.45 * (w.day + w.sunset));
      for (const n of this.npcs.values()) if (n.glow) n.setNight(w.night);
      if (this.layers.windowDay) this.layers.windowDay.setAlpha(amb.dayLayer);
      if (this.darkness) this.renderDarkness(amb.darkness);
      this.glowScale = amb.glow;
      this.syncGlows();
    }

    /** 현재 시간대 이름 (디버그/테스트) */
    get phase() {
      return this.weights ? Daylight.phaseOf(this.weights) : 'night';
    }

    /** 뽀모도로 전환: 창문·펜던트가 1초 밝아졌다 돌아온다 */
    flashLights() {
      if (this.flashTween) this.flashTween.stop();
      this.fx.flash = 0;
      this.flashTween = this.tweens.add({
        targets: this.fx, flash: 1, duration: 300, yoyo: true, hold: 200, ease: 'Sine.easeOut',
        onUpdate: () => this.syncGlows(),
        onComplete: () => { this.fx.flash = 0; this.syncGlows(); },
      });
    }

    /** 11단계: 창밖 불꽃놀이 (ms 동안). 이미 진행 중이면 시간만 늘린다. 실제 시각(Date.now) 기준으로 update() 가 굴린다 */
    celebrate(ms = 10000, style = 'fireworks') {
      this.fireworkStyle = style === 'hearts' ? 'hearts' : 'fireworks';
      const until = Date.now() + ms;
      this.celebrateUntil = Math.max(this.celebrateUntil || 0, until);
      if (!this.fireworks) this.fireworks = [];
      if (!(this.room.windows || []).length) return;
      if (!this.lastFirework) this.lastFirework = 0;
      this.tickFireworks(true);
    }

    get celebrating() {
      return Boolean(this.celebrateUntil && Date.now() < this.celebrateUntil);
    }

    /** 매 프레임: 350ms 마다 무작위 창 하늘 띠에 새 불꽃, 살아 있는 불꽃은 1.1초 동안 퍼졌다 사라진다 */
    tickFireworks(force = false) {
      const now = Date.now();
      const list = this.fireworks;
      if (!list) return;
      if (this.celebrateUntil && now < this.celebrateUntil && (force || now - this.lastFirework >= 350)) {
        const windows = this.room.windows || [];
        const w = windows[Math.floor(Math.random() * windows.length)];
        if (w) this.spawnFirework(w.x + 24 + Math.random() * Math.max(1, w.w - 48), w.y + 14 + Math.random() * Math.max(1, w.h * 0.3));
        this.lastFirework = now;
      }
      for (let i = list.length - 1; i >= 0; i--) {
        const f = list[i];
        const t = Math.min(1, (now - f.startedAt) / 1100);
        this.drawFirework(f, t);
        if (t >= 1) { f.g.destroy(); list.splice(i, 1); }
      }
    }

    /** 두 겹(16 + 8개)의 점이 퍼졌다 사라지는 불꽃 (창 안에 머물도록 반지름 14~22px). 중심은 잠깐 하얗게 */
    spawnFirework(cx, cy) {
      if (!this.fireworks) this.fireworks = [];
      const pick = () => FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)];
      const hearts = this.fireworkStyle === 'hearts';
      const heartPick = () => [0xff8a9a, 0xf2a0d6, 0xffb3c6, 0xff6f8e][Math.floor(Math.random() * 4)];
      const f = { g: this.add.graphics().setDepth(DEPTH.fireworks), cx, cy, color: hearts ? heartPick() : pick(), color2: hearts ? 0xfff0f5 : pick(), radius: 14 + Math.random() * 8, spin: Math.random() * Math.PI, startedAt: Date.now(), style: this.fireworkStyle };
      this.fireworks.push(f);
      this.drawFirework(f, 0);
      return f;
    }

    drawFirework(f, t) {
      const g = f.g;
      g.clear();
      const k = 1 - (1 - t) * (1 - t); // 반지름: 빨리 퍼지고 천천히 멈춤
      const a = t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45; // 밝게 머물다 마지막에 사라짐
      const drop = t * t * 8; // 끝에서 살짝 떨어진다
      if (t < 0.25) { g.fillStyle(0xffffff, 1); g.fillRect(Math.round(f.cx) - 2, Math.round(f.cy) - 2, 4, 4); }
      if (f.style === 'hearts') {
        // 하트 폭죽: 하트 곡선 위의 점 20개가 퍼진다 (기념일)
        g.fillStyle(f.color, a);
        const s = (f.radius * k) / 17;
        for (let i = 0; i < 20; i++) {
          const th = (i / 20) * Math.PI * 2;
          const hx = 16 * Math.sin(th) ** 3;
          const hy = -(13 * Math.cos(th) - 5 * Math.cos(2 * th) - 2 * Math.cos(3 * th) - Math.cos(4 * th));
          g.fillRect(Math.round(f.cx + hx * s) - 1, Math.round(f.cy + hy * s + drop) - 1, 3, 3);
        }
        g.fillStyle(f.color2, a * 0.9);
        g.fillRect(Math.round(f.cx) - 1, Math.round(f.cy + drop * 0.5) - 1, 2, 2);
        return;
      }
      g.fillStyle(f.color, a);
      for (let i = 0; i < 16; i++) {
        const ang = f.spin + (i / 16) * Math.PI * 2;
        const r = f.radius * k;
        g.fillRect(Math.round(f.cx + Math.cos(ang) * r) - 1, Math.round(f.cy + Math.sin(ang) * r + drop) - 1, 3, 3);
      }
      g.fillStyle(f.color2, a);
      for (let i = 0; i < 8; i++) {
        const ang = f.spin + Math.PI / 8 + (i / 8) * Math.PI * 2;
        const r = f.radius * 0.55 * k;
        g.fillRect(Math.round(f.cx + Math.cos(ang) * r) - 1, Math.round(f.cy + Math.sin(ang) * r + drop * 0.5) - 1, 2, 2);
      }
    }

    syncGlows() {
      const k = (this.glowScale || 1) * (1 + this.fx.flash * 1.4);
      for (const g of this.glows || []) g.setAlpha(g.baseAlpha * k);
      if (this.windowFlash) this.windowFlash.setAlpha(this.fx.flash * 0.35);
    }

    // ── 15단계 실내 밀도: 가구 그림자 · 비 · 김 · 시계 · 어항 물결 ─────────────────────────
    /** 바닥이 아닌 오브젝트(벽·유리·의자·작은 소품 제외) 밑에 반투명 타원 그림자 (바닥 위, 가구 아래) */
    buildPropShadows() {
      const T = this.T;
      this.propShadows = []; // { x, y, w, h } (그리기는 Graphics 하나 — 오브젝트 수십 개를 따로 만들지 않는다)
      const g = this.add.graphics().setDepth(0.85);
      g.fillStyle(0x000000, 0.2);
      for (const p of this.room.props || []) {
        if (p.y <= 2 || NO_SHADOW.test(p.name)) continue;
        const o = this.tilesMeta.objects[p.name];
        if (!o || o.layer !== 'furniture') continue;
        const h = o.h - (o.top || 0);
        if (h <= 0) continue;
        const w = o.w * T;
        const sh = { x: p.x * T + w / 2, y: (p.y + o.h) * T - 3, w: Math.max(20, w * 0.92), h: Math.min(14, 6 + h * 3) };
        g.fillEllipse(sh.x, sh.y, sh.w, sh.h);
        this.propShadows.push(sh);
      }
      this.propShadowGfx = g;
    }

    /** 실내 연출: 창밖 비(10%) · 커피머신 김 · 벽시계 초침 · 어항 물결 위치 */
    buildIndoorFx() {
      this.rain = null;
      this.rainDrops = [];
      this.setRain(Math.random() < RAIN_CHANCE);
      this.buildSteam();
      this.buildClocks();
    }

    /** 창밖 빗줄기만 (하늘 위, 창틀 뒤). on 으로 강제 (설정·스크린샷) */
    setRain(on) {
      const want = Boolean(on) && (this.room.windows || []).length > 0;
      if (this.rain && !want) { this.rain.destroy(); this.rain = null; this.rainDrops = []; return; }
      if (!want || this.rain) return;
      this.rain = this.add.graphics().setDepth(DEPTH.stars + 0.05);
      this.rainDrops = [];
      for (const w of this.room.windows) {
        const n = Math.max(6, Math.round(w.w / 10));
        for (let i = 0; i < n; i++) this.rainDrops.push({ win: w, x: w.x + Math.random() * w.w, y: w.y + Math.random() * w.h, len: 5 + Math.random() * 6, v: 90 + Math.random() * 60 });
      }
      this.rainAcc = 0;
      this.tickRain(0, true);
    }

    get raining() {
      return Boolean(this.rain);
    }

    tickRain(delta, force = false) {
      this.rainAcc += delta;
      if (!force && this.rainAcc < 40) return;
      const dt = this.rainAcc / 1000;
      this.rainAcc = 0;
      const g = this.rain;
      g.clear();
      g.lineStyle(1, 0xdfe9f5, 0.38);
      for (const d of this.rainDrops) {
        d.y += d.v * dt;
        d.x -= d.v * dt * 0.12;
        if (d.y > d.win.y + d.win.h) { d.y = d.win.y - d.len; d.x = d.win.x + Math.random() * d.win.w; }
        if (d.x < d.win.x) d.x += d.win.w;
        const x0 = Math.round(d.x);
        const y0 = Math.round(d.y);
        g.lineBetween(x0, y0, x0 - 1, Math.min(d.win.y + d.win.h, y0 + d.len));
      }
    }

    /** 커피머신 김: 작은 흰 점이 올라가며 퍼져 사라진다 (상시) */
    buildSteam() {
      const a = (this.room.anchors || {}).steam;
      if (!a) return;
      if (!this.textures.exists('steam')) {
        const tex = this.textures.createCanvas('steam', 8, 8);
        const ctx = tex.getContext();
        const g = ctx.createRadialGradient(4, 4, 0, 4, 4, 4);
        g.addColorStop(0, 'rgba(255,255,255,0.9)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 8, 8);
        tex.refresh();
      }
      this.steam = this.add.particles(a.x, a.y, 'steam', {
        speedX: { min: -4, max: 4 }, speedY: { min: -18, max: -9 },
        lifespan: { min: 1100, max: 1600 }, frequency: 240, quantity: 1,
        scale: { start: 0.5, end: 1.3 }, alpha: { start: 0.42, end: 0 },
      }).setDepth(2.6);
    }

    /** 벽시계 초침: wall_clock 소품마다 시계 면 가운데에서 1초마다 도는 붉은 바늘 */
    buildClocks() {
      this.clocks = [];
      const T = this.T;
      for (const p of this.room.props || []) {
        if (p.name !== 'wall_clock') continue;
        const cx = p.x * T + 16; // 시계 면 중심 (논리 8,11 → 2배)
        const cy = p.y * T + 22;
        const g = this.add.graphics().setDepth(1.3);
        this.clocks.push({ cx, cy, g });
      }
      this.clockAcc = CLOCK_TICK;
      if (this.clocks.length) this.tickClocks(0);
    }

    tickClocks(delta) {
      this.clockAcc += delta;
      if (this.clockAcc < CLOCK_TICK) return;
      this.clockAcc = 0;
      const sec = Math.floor(this.hooks.serverNow() / 1000) % 60;
      const ang = (sec / 60) * Math.PI * 2 - Math.PI / 2;
      for (const c of this.clocks) {
        c.g.clear();
        c.g.lineStyle(1, 0xe2605e, 1);
        c.g.lineBetween(c.cx, c.cy, Math.round(c.cx + Math.cos(ang) * 7), Math.round(c.cy + Math.sin(ang) * 7));
      }
    }

    // ── 15단계: 책상 위 쪽지·머그 아이콘 · D-day 칠판 · 커피 버프 ─────────────────────────
    /** 타일 아틀라스의 오브젝트(1x1)를 스프라이트 프레임으로 (없으면 만든다) */
    tileFrame(name) {
      const o = this.tilesMeta.objects[name];
      if (!o) return null;
      const idx = o.tiles[0][0];
      const key = `tile:${idx}`;
      const tex = this.textures.get('tiles');
      if (!tex.has(key)) {
        const cols = this.tilesMeta.columns;
        tex.add(key, 0, (idx % cols) * this.T, Math.floor(idx / cols) * this.T, this.T, this.T);
      }
      return key;
    }

    /** 좌석 앞 책상 칸 i (책상이 없으면 좌석이 보는 방향 앞 칸) */
    itemSpot(seat, i) {
      const slots = Layout.deskSlots(this.room, seat);
      if (slots[i]) return slots[i];
      if (slots.length) return slots[slots.length - 1];
      const d = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[seat.facing] || [0, 1];
      return { tx: seat.x + d[0], ty: seat.y + d[1] };
    }

    /** 서버 seatItems { mugs: { seatId: [{ menu, from, to }] }, notes: { seatId: n } } → 책상 위 아이콘 */
    setSeatItems(items) {
      this.seatItems = items || { mugs: {}, notes: {} };
      for (const s of this.seatItemSprites) s.destroy();
      this.seatItemSprites = [];
      const T = this.T;
      const put = (seat, i, frameName, dx = 0) => {
        const key = this.tileFrame(frameName);
        if (!key) return;
        const spot = this.itemSpot(seat, i);
        const sp = this.add.sprite(spot.tx * T + T / 2 + dx, (spot.ty + 1) * T, 'tiles', key).setOrigin(0.5, 1).setDepth(DEPTH.avatar + ((spot.ty + 1) * T) / this.mapH + 0.0004);
        this.seatItemSprites.push(sp);
      };
      for (const [seatId, list] of Object.entries(this.seatItems.mugs || {})) {
        const seat = this.seatById(seatId);
        if (!seat) continue;
        list.slice(0, 2).forEach((m, i) => put(seat, 1 + i, `mug_${m.menu}`, i ? 6 : 0));
      }
      for (const [seatId, n] of Object.entries(this.seatItems.notes || {})) {
        const seat = this.seatById(seatId);
        if (seat && n > 0) put(seat, 0, 'note_icon');
      }
      if (this.me && this.me.seated && this.me.seat) this.setMyNotes(this.seatItems.notes[this.me.seat.id] || 0);
    }

    /** 내 자리에 쪽지가 있다 (note:waiting) */
    onNoteWaiting(d) {
      this.setMyNotes(d && d.notes ? d.notes.length : 0);
    }

    /** playerBuff → ❤️☕ */
    onBuff(d) {
      const a = this.avatarOf(d.id);
      if (a) a.setBuff(d.coffeeBuffUntil || null);
    }

    /** D-day 칠판 목록 (anchors.dday 오른쪽 아래, 최대 3줄. D-7 이하는 강조색) */
    setDdays(board) {
      for (const t of this.ddayTexts) t.destroy();
      this.ddayTexts = [];
      const a = (this.room.anchors || {}).dday;
      if (!a) return;
      const rows = (board || []).slice(0, a.lines || 3);
      rows.forEach((d, i) => {
        const color = d.today ? '#ff8a7a' : d.soon ? '#ffd08a' : '#d9cfbf';
        const t = this.add.text(a.x, a.y + i * 10, `${d.label} ${d.title}`, { fontFamily: FONTS.hand, fontSize: '10px', color, resolution: ZOOM }).setOrigin(1, 0.5).setDepth(5);
        this.ddayTexts.push(t);
      });
    }

    get ddayLines() {
      return this.ddayTexts.map((t) => t.text);
    }

    // ── 15단계: 앵커에 동적으로 그리는 것 — 문 명패(스터디 설정) · 코르크보드 목표 팻말 2장 ────────
    buildAnchors() {
      const a = this.room.anchors || {};
      this.nameplateText = null;
      this.corkNotes = [];
      if (a.nameplate) {
        this.nameplateText = this.add.text(a.nameplate.x, a.nameplate.y, this.nameplate || '', { fontFamily: FONTS.sans, fontSize: '9px', fontStyle: 'bold', color: '#efe6d6', align: 'center', resolution: ZOOM, wordWrap: { width: 60, useAdvancedWrap: true } }).setOrigin(0.5, 0.5).setDepth(5);
        this.nameplateText.setLineSpacing(2);
        this.nameplateText.setLetterSpacing(0.5);
        this.setNameplate(this.nameplate || '');
      }
      if (a.corkboard) {
        const seats = a.corkboard.seats || [];
        seats.forEach((seatId, i) => {
          const x = a.corkboard.x + (i - (seats.length - 1) / 2) * 40;
          const y = a.corkboard.y;
          const paper = this.add.graphics().setDepth(5);
          const t = this.add.text(x, y, '', { fontFamily: FONTS.hand, fontSize: '9px', color: '#3b2f22', align: 'center', resolution: ZOOM, wordWrap: { width: 34, useAdvancedWrap: true } }).setOrigin(0.5, 0.5).setDepth(5.1);
          this.corkNotes.push({ seatId, x, y, paper, text: t, value: null });
        });
        this.syncCorkboard();
      }
    }

    /** 문 명패 글자 (방장 설정 roomLabel, 기본은 스터디 이름). 두 줄까지 */
    setNameplate(text) {
      this.nameplate = String(text || '');
      if (!this.nameplateText) return;
      const s = this.nameplate.length > 12 ? `${this.nameplate.slice(0, 12)}…` : this.nameplate;
      this.nameplateText.setText(s ? `${s}` : '');
    }

    /** 코르크보드: 두 의자(study-a/b)에 앉은(또는 마지막에 앉았던) 사람의 오늘 목표를 팻말 2장에 나란히 */
    syncCorkboard() {
      if (!this.corkNotes || !this.corkNotes.length) return;
      for (const n of this.corkNotes) {
        const ownerId = this.seatOwners[n.seatId];
        let av = ownerId ? this.avatarOf(ownerId) : null;
        if (!av && this.seatLast && this.seatLast[n.seatId]) av = this.allAvatars().find((x) => x.nickname === this.seatLast[n.seatId]) || null;
        const goal = av && av.goal ? (av.goal.text || (av.goal.targetMinutes ? `${av.goal.targetMinutes}분` : '')) : '';
        const label = av ? `${av.nickname.slice(0, 5)}\n${goal || '·'}` : '';
        if (label === n.value) continue;
        n.value = label;
        n.text.setText(label);
        n.paper.clear();
        if (!label) continue;
        const w = 36;
        const h = Math.max(18, Math.ceil(n.text.height) + 6);
        n.paper.fillStyle(0xfff7e0, 1);
        n.paper.fillRect(n.x - w / 2, n.y - h / 2, w, h);
        n.paper.lineStyle(1, 0xd8c9a6, 1);
        n.paper.strokeRect(n.x - w / 2, n.y - h / 2, w, h);
        n.paper.fillStyle(0xe2605e, 1);
        n.paper.fillRect(n.x - 1, n.y - h / 2 - 1, 3, 3);
      }
    }

    // ── 보드/표지판 글자 (웹폰트) ───────────────────────────────────
    buildLabels() {
      this.labelObjects = [];
      for (const l of this.room.labels || []) {
        const style = {
          fontFamily: FONTS[l.font] || FONTS.sans,
          fontSize: `${l.size}px`,
          fontStyle: l.weight >= 600 ? 'bold' : 'normal',
          color: l.color,
          align: l.align,
          resolution: ZOOM,
        };
        const t = this.add.text(l.x, l.y, l.text, style).setDepth(5);
        t.setLineSpacing(Math.round(l.size * (l.lineHeight - 1.15)));
        if (l.spacing) t.setLetterSpacing(l.spacing);
        if (l.align === 'left') t.setOrigin(0, 0.5);
        else if (l.align === 'right') t.setOrigin(1, 0.5);
        else t.setOrigin(0.5, 0.5);
        this.labelObjects.push(t);
      }
    }

    // ── 아바타 텍스처/애니메이션 (플레이어마다 캔버스 텍스처 하나, 파츠가 바뀌면 다시 그려서 refresh) ──
    /**
     * 플레이어(ownerId)의 스프라이트시트 텍스처 키. 처음이면 캔버스 텍스처 + 16프레임 + 걷기 애니메이션을 만들고,
     * 이후에는 같은 캔버스에 새 조합을 그려 GL 텍스처만 갱신한다 (텍스처 생성/삭제를 반복하지 않는다).
     */
    avatarTexture(ownerId, avatar) {
      const key = `av:${ownerId}`;
      const meta = this.playerMeta;
      const sheet = this.avatarKit.composeSheet(avatar);
      // 같은 사람이 곧바로 다시 들어오면(재입장·이어받기) 예약된 텍스처 삭제를 취소하고 재사용한다
      const pending = this.pendingReleases && this.pendingReleases.get(key);
      if (pending) { pending.remove(false); this.pendingReleases.delete(key); }
      let tex = this.textures.exists(key) ? this.textures.get(key) : null;
      if (!tex) {
        tex = this.textures.createCanvas(key, sheet.width, sheet.height);
        const per = meta.framesPerRow;
        for (const dir of Object.keys(meta.rows)) {
          const row = meta.rows[dir];
          for (let i = 0; i < per; i++) tex.add(row * per + i, 0, i * meta.frameWidth, row * meta.frameHeight, meta.frameWidth, meta.frameHeight);
          const start = row * per;
          this.anims.create({ key: `walk-${dir}-${key}`, frames: this.anims.generateFrameNumbers(key, { start, end: start + per - 1 }), frameRate: 8, repeat: -1 });
        }
      }
      const ctx = tex.context;
      ctx.clearRect(0, 0, tex.width, tex.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(sheet, 0, 0);
      tex.refresh();
      return key;
    }

    texKey(ownerId) {
      return `av:${ownerId}`;
    }

    walkKey(dir, ownerId) {
      return `walk-${dir}-${this.texKey(ownerId)}`;
    }

    idleFrame(dir) {
      return this.playerMeta.rows[dir] * this.playerMeta.framesPerRow;
    }

    /**
     * 플레이어가 나가면 텍스처·애니메이션 정리 (렌더러가 이번 프레임에 쓰고 있을 수 있어 잠시 뒤에).
     * 그 사이 같은 id 의 아바타가 다시 생겼으면(재입장·이어받기, 백그라운드 탭에서 씬 시계가 멈췄다 풀릴 때) 지우지 않는다.
     */
    releaseAvatarTexture(ownerId) {
      const key = this.texKey(ownerId);
      if (!this.pendingReleases) this.pendingReleases = new Map();
      const prev = this.pendingReleases.get(key);
      if (prev) prev.remove(false);
      const ev = this.time.delayedCall(250, () => {
        this.pendingReleases.delete(key);
        if (!this.textures.exists(key) || this.avatarOf(ownerId)) return;
        for (const dir of Object.keys(this.playerMeta.rows)) this.anims.remove(`walk-${dir}-${key}`);
        this.textures.remove(key);
      });
      this.pendingReleases.set(key, ev);
    }

    // ── 충돌 ────────────────────────────────────────────────────────
    blockedAt(px, py) {
      const T = this.T;
      const tx = Math.floor(px / T);
      const ty = Math.floor(py / T);
      if (tx < 0 || ty < 0 || tx >= this.room.width || ty >= this.room.height) return true;
      return (this.furniture ? this.furniture.collision : this.room.collision)[ty][tx];
    }

    canStand(x, y) {
      // (x, y) = 발 중심. 발 박스의 네 모서리를 검사한다 (서버와 동일).
      const hw = this.config.feetW / 2;
      const fh = this.config.feetH;
      return (
        !this.blockedAt(x - hw, y - fh) &&
        !this.blockedAt(x + hw - 1, y - fh) &&
        !this.blockedAt(x - hw, y - 1) &&
        !this.blockedAt(x + hw - 1, y - 1)
      );
    }

    // ── 조명 ───────────────────────────────────────────────────────
    buildLightTextures() {
      const mk = (key, size, stops) => {
        if (this.textures.exists(key)) return;
        const tex = this.textures.createCanvas(key, size, size);
        const ctx = tex.getContext();
        const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        for (const [pos, color] of stops) g.addColorStop(pos, color);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, size, size);
        tex.refresh();
      };
      // 어둠을 지우는 마스크 (흰색, 알파 감쇠)
      mk('lightmask', 256, [
        [0, 'rgba(255,255,255,1)'],
        [0.35, 'rgba(255,255,255,0.75)'],
        [0.7, 'rgba(255,255,255,0.25)'],
        [1, 'rgba(255,255,255,0)'],
      ]);
      // 앰버 글로우 (가산 합성)
      mk('glow', 256, [
        [0, 'rgba(255,200,120,0.9)'],
        [0.3, 'rgba(255,170,80,0.45)'],
        [0.7, 'rgba(255,140,60,0.1)'],
        [1, 'rgba(255,140,60,0)'],
      ]);
      // 모니터 글로우 (푸른빛)
      mk('glow-cool', 256, [
        [0, 'rgba(210,235,255,0.9)'],
        [0.3, 'rgba(160,205,255,0.4)'],
        [0.7, 'rgba(120,170,255,0.08)'],
        [1, 'rgba(120,170,255,0)'],
      ]);
    }

    buildLighting() {
      const lights = this.room.lights || [];
      // 1) 어두운 베이스 (RenderTexture) 에서 조명 위치와 유리 스터디룸 구역을 지운다. 시간대에 따라 다시 그린다.
      this.darkness = this.add.renderTexture(0, 0, this.mapW, this.mapH).setOrigin(0, 0).setDepth(DEPTH.darkness);
      this.lightStamp = this.make.image({ key: 'lightmask', add: false });
      this.zoneStamps = (this.room.zones || []).map((z) => {
        // 부드러운 테두리: 바깥(연하게) + 안쪽(진하게) 둥근 사각형 두 겹
        const g = this.make.graphics({ add: false });
        g.fillStyle(0xffffff, z.bright * 0.45);
        g.fillRoundedRect(0, 0, z.w + 24, z.h + 24, 18);
        g.fillStyle(0xffffff, z.bright);
        g.fillRoundedRect(12, 12, z.w, z.h, 12);
        return { z, g };
      });
      this.renderDarkness((this.ambient && this.ambient.darkness) || 0.2);

      // 2) 앰버 글로우 (가산) — baseAlpha 에 시간대 배율(glowScale)과 뽀모도로 플래시를 곱한다
      this.glows = [];
      this.glowScale = (this.ambient && this.ambient.glow) || 1;
      this.pools = [];
      for (const l of lights) {
        const g = this.add.image(l.x, l.y, 'glow')
          .setScale((l.r * 2.2) / 256)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setDepth(DEPTH.glow);
        g.baseAlpha = l.intensity * 0.5;
        g.setAlpha(g.baseAlpha * this.glowScale);
        this.glows.push(g);
        if (l.pool !== undefined) {
          // 15단계: 펜던트 아래 바닥의 둥근 빛 웅덩이 (바닥 위 · 가구 아래, 납작한 타원)
          const p = this.add.image(l.x, l.pool, 'glow').setScale((l.r * 1.9) / 256, (l.r * 0.9) / 256).setBlendMode(Phaser.BlendModes.ADD).setDepth(0.95);
          p.baseAlpha = l.intensity * 0.42;
          p.setAlpha(p.baseAlpha * this.glowScale);
          this.glows.push(p);
          this.pools.push(p);
        }
        this.tweens.add({
          targets: g,
          baseAlpha: { from: l.intensity * 0.4, to: l.intensity * 0.55 },
          duration: 1200 + Math.random() * 1200,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
          onUpdate: () => g.setAlpha(g.baseAlpha * (this.glowScale || 1) * (1 + this.fx.flash * 1.4)),
        });
      }
      // 3) 뽀모도로 플래시용 창문 오버레이 (평소엔 투명)
      const win = (this.room.windows || [])[0];
      if (win) this.windowFlash = this.add.rectangle(win.x, win.y, win.w, win.h + 16, 0xfff1d0, 1).setOrigin(0, 0).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.glow).setAlpha(0);
    }

    /** 어둠 레이어 다시 칠하기 (시간대가 바뀔 때만 — 1초에 한 번 이하) */
    renderDarkness(alpha) {
      const rt = this.darkness;
      rt.clear();
      rt.fill(this.room.outdoor ? 0x0b1226 : 0x0d0912, alpha);
      for (const { z, g } of this.zoneStamps) rt.erase(g, z.x - 12, z.y - 12);
      for (const l of [...(this.room.lights || []), ...this.extraLights]) {
        this.lightStamp.setScale((l.r * 2.8) / 256).setAlpha(Math.min(1, l.intensity + 0.45));
        rt.erase(this.lightStamp, l.x, l.y);
      }
    }

    /**
     * 화면 크기(7단계): 카메라 줌을 바꾸고, 이미 만들어진 모든 텍스트의 해상도를 줌에 맞춰 다시 그린다 (흐려지지 않게).
     * 이후 만들어지는 텍스트(말풍선·이모지·이름표)는 ZOOM 을 읽으므로 자동으로 맞는다.
     */
    setZoom(z) {
      const zoom = [1.5, 2, 2.5].includes(z) ? z : 2;
      ZOOM = zoom;
      const cam = this.cameras.main;
      if (cam) cam.setZoom(zoom);
      const res = zoom; // 해상도 = 줌 → 텍스처 픽셀이 화면 픽셀과 1:1
      const walk = (list) => {
        for (const obj of list) {
          if (obj.type === 'Text' && obj.style && obj.style.resolution !== res) obj.setResolution(res);
          else if (obj.type === 'Container' && obj.list) walk(obj.list);
        }
      };
      walk(this.children.list);
      this.syncVignette();
    }

    get zoom() {
      return ZOOM;
    }

    syncVignette() {
      const el = document.getElementById('vignette');
      const canvas = this.game.canvas;
      const stage = document.getElementById('stage');
      if (!el || !canvas || !stage) return;
      const r = canvas.getBoundingClientRect();
      const s = stage.getBoundingClientRect();
      el.style.left = `${r.left - s.left}px`;
      el.style.top = `${r.top - s.top}px`;
      el.style.width = `${r.width}px`;
      el.style.height = `${r.height}px`;
    }

    // ── 창밖 불빛 깜빡임 ───────────────────────────────────────────
    setupWindowTwinkle() {
      const next = this.tilesMeta.animTiles || {};
      const layer = this.layers.furniture;
      const targets = [];
      layer.forEachTile((tile) => {
        if (next[tile.index] !== undefined) targets.push({ tile, phase: Math.random() });
      });
      if (!targets.length) return;
      this.time.addEvent({
        delay: 380,
        loop: true,
        callback: () => {
          for (const t of targets) {
            // 타일마다 다른 확률로 다음 프레임으로 → 창 불빛이 제각각 깜빡인다
            if (Math.random() < 0.12 + t.phase * 0.18) t.tile.index = next[t.tile.index];
          }
        },
      });
    }
  }

  function round2(v) {
    return Math.round(v * 100) / 100;
  }

  function unescapeHtml(s) {
    return String(s).replace(/&(amp|lt|gt|quot|#39);/g, (m, k) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }[k]));
  }

  window.RoomScene = RoomScene;
})();
