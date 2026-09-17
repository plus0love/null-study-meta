/* global Phaser, Daylight */
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

  const DEPTH = { sky: 0.5, stars: 0.6, windowDay: 1.5, zone: 2, screen: 2.5, shadow: 9, avatar: 10, label: 25, bubble: 26, darkness: 30, glow: 31 };
  const SIGN_MAX_W = 96; // 팻말 최대 폭(px) — 넘치면 말줄임
  const DAYLIGHT_TICK = 1000; // ms — 시간대 가중치 재계산 주기

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
      this.chatBubble = null;
      this.chatTimer = null;
      this.emojiText = null;
      this.emojiTimer = null;
      this.sign = null; // 목표 팻말 (앉아 있을 때만)
      this.setPosition(p.x, p.y);
      this.setFacing(this.facing);
      this.setSeated(this.seated);
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
      this.sprite.setPosition(rx, ry).setDepth(DEPTH.avatar + y / this.scene.mapH);
      this.shadow.setPosition(rx, ry - 2);
      this.name.setPosition(rx, ry + 3);
      if (this.sign) this.sign.setPosition(rx, ry + 19);
      this.statusBubble.setPosition(rx + 16, ry - 66);
      if (this.chatBubble) this.chatBubble.setPosition(rx, ry - 78 - this.chatBubble.bubbleH / 2);
      if (this.emojiText) this.emojiText.setPosition(rx, ry - 74 - (this.emojiText.rise || 0));
    }

    setFacing(f) {
      this.facing = f;
      if (this.walking) this.sprite.anims.play(this.scene.walkKey(f, this.id), true);
      else this.sprite.setFrame(this.scene.idleFrame(this.seated ? 'down' : f));
    }

    setWalking(on) {
      if (this.seated) on = false;
      if (on) {
        this.walking = true;
        this.sprite.anims.play(this.scene.walkKey(this.facing, this.id), true); // 같은 애니메이션이면 무시
      } else if (this.walking) {
        this.walking = false;
        this.sprite.anims.stop();
        this.sprite.setFrame(this.scene.idleFrame(this.seated ? 'down' : this.facing));
      }
    }

    setSeated(on) {
      this.seated = on;
      if (on) {
        this.walking = false;
        this.sprite.anims.stop();
        // 앉은 자세 프레임이 없으므로 아래 방향 정지 프레임
        this.sprite.setFrame(this.scene.idleFrame('down'));
      } else this.sprite.setFrame(this.scene.idleFrame(this.facing));
      this.syncSign();
    }

    setStatus(s) {
      this.status = s;
      this.statusBubble.bubbleText.setText(STATUS_EMOJI[s] || '•');
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
      if (this.sign) this.sign.destroy();
      this.sprite.destroy();
      this.shadow.destroy();
      this.name.destroy();
      this.statusBubble.destroy();
      this.scene.releaseAvatarTexture(this.id);
    }
  }


  // ── 강아지 NPC 표시 ─────────────────────────────────────────────────
  class Npc {
    constructor(scene, snap) {
      this.scene = scene;
      this.id = snap.id;
      this.name = snap.name;
      this.state = snap.state;
      this.facing = snap.facing || 'down';
      this.x = snap.x;
      this.y = snap.y;
      this.buffer = [];
      this.animKey = null;
      const meta = scene.dogMeta;
      this.sprite = scene.add.sprite(snap.x, snap.y, 'dog', meta.rows.sit * meta.framesPerRow).setOrigin(0.5, 1);
      this.shadow = scene.add.ellipse(snap.x, snap.y - 2, 18, 6, 0x000000, 0.25).setDepth(DEPTH.shadow);
      this.nameText = scene.add.text(snap.x, snap.y + 2, snap.name, {
        fontFamily: FONTS.sans, fontSize: '10px', fontStyle: 'bold', color: '#ffd9a8',
        stroke: '#14111a', strokeThickness: 3, resolution: ZOOM,
      }).setOrigin(0.5, 0).setDepth(DEPTH.label);
      this.heart = null;
      this.heartTimer = null;
      this.setPosition(snap.x, snap.y);
      this.applyState();
    }

    setPosition(x, y) {
      this.x = x;
      this.y = y;
      const rx = Math.round(x);
      const ry = Math.round(y);
      this.sprite.setPosition(rx, ry).setDepth(DEPTH.avatar + y / this.scene.mapH);
      this.shadow.setPosition(rx, ry - 2);
      this.nameText.setPosition(rx, ry + 2);
      if (this.heart) this.heart.setPosition(rx, ry - 52 - (this.heart.rise || 0));
    }

    setName(name) {
      this.name = name;
      this.nameText.setText(name);
    }

    /** 서버 스냅샷 반영: 위치는 보간 버퍼에, 상태/방향은 즉시 */
    push(snap) {
      this.buffer.push({ x: snap.x, y: snap.y, t: performance.now() });
      if (this.buffer.length > 30) this.buffer.splice(0, this.buffer.length - 30);
      if (snap.name !== this.name) this.setName(snap.name);
      if (snap.state !== this.state || snap.facing !== this.facing) {
        this.state = snap.state;
        this.facing = snap.facing;
        this.applyState();
      }
    }

    applyState() {
      const meta = this.scene.dogMeta;
      const per = meta.framesPerRow;
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
      switch (this.state) {
        case 'walk': play(`dog-walk-${this.facing}`); break;
        case 'look': play('dog-wag'); break; // 앉아서 꼬리 흔들기
        case 'sleep': play('dog-sleep'); break;
        case 'sit': still(meta.rows.sit * per); break;
        default: still(meta.rows[this.facing] * per); // idle: 서서 정지
      }
    }

    /** INTERP_DELAY 만큼 과거 시각을 두 스냅샷 사이에서 선형 보간 */
    update() {
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

    showHeart() {
      this.clearHeart();
      const t = this.scene.add.text(0, 0, '❤️', { fontSize: '16px', resolution: ZOOM }).setOrigin(0.5, 1).setDepth(DEPTH.bubble);
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
      this.sprite.destroy();
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
      this.dogMeta = data.dog;
      this.onReady = data.onReady || (() => {});
      this.hooks = { onMove() {}, onSit() {}, onStand() {}, onPet() {}, onUse() {}, onInteract() {}, onEmojiKey() {}, onChatKey() {}, onPositions() {} };
      this.npcs = new Map();
      this.nearNpc = null;
      this.nearItem = null; // 가까운 상호작용 지점 (커피머신·음악 패널)
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
      this.load.image('tiles', `/assets/tiles.png${v}`);
      this.load.spritesheet('dog', `/assets/dog.png${v}`, { frameWidth: this.dogMeta.frameWidth, frameHeight: this.dogMeta.frameHeight });
    }

    create() {
      const room = this.room;
      const T = room.tileSize;
      this.T = T;
      this.mapW = room.width * T;
      this.mapH = room.height * T;

      this.buildLayers();
      this.buildSky();
      this.buildZones();
      this.buildLabels();
      this.buildLightTextures();
      this.buildDogAnims();
      this.buildLighting();
      this.buildScreens();
      this.syncVignette();
      this.setupWindowTwinkle();
      this.applyDaylight(this.currentWeights());

      // 카메라 2배 줌 → 타일은 정수 배로 또렷하고, 텍스트는 고해상도로 그려진다. 캔버스는 사이드바를 뺀 영역에 꽉 찬다(RESIZE).
      const cam = this.cameras.main;
      cam.setZoom(ZOOM);
      cam.setBounds(0, 0, this.mapW, this.mapH);
      cam.setRoundPixels(true);
      cam.centerOn(room.spawn.x, room.spawn.y);
      cam.setBackgroundColor('#14111a');
      this.scale.on('resize', () => this.syncVignette());

      this.cursors = this.input.keyboard.createCursorKeys();
      this.wasd = this.input.keyboard.addKeys({ up: 'W', down: 'S', left: 'A', right: 'D' });
      this.input.keyboard.on('keydown-E', () => this.toggleSeat());
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
      this.config = { ...this.config, ...ack.config };
      this.clearSession();
      this.seatOwners = { ...(ack.seats || {}) };
      this.me = new Avatar(this, ack.self);
      this.lastSent = null;
      this.correction = null;
      this.nearSeat = null;
      this.nearNpc = null;
      this.nearItem = null;
      this.hooks.onInteract(null);
      for (const p of ack.players) this.addRemote(p);
      for (const n of ack.npcs || []) this.upsertNpc(n);
      this.syncScreens();
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
      this.cameras.main.stopFollow();
    }

    addRemote(p) {
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
      r.buffer.push({ x: d.x, y: d.y, facing: d.facing, moving: d.moving, t: performance.now() });
      if (r.buffer.length > 30) r.buffer.splice(0, r.buffer.length - 30);
      r.lastMoving = Boolean(d.moving);
    }

    onCorrect(d) {
      this.correction = { x: d.x, y: d.y };
    }

    onSat(d) {
      this.seatOwners[d.seatId] = d.id;
      const a = this.avatarOf(d.id);
      if (!a) return;
      const r = this.remotes.get(d.id);
      if (r) r.buffer = [];
      a.setWalking(false);
      a.setPosition(d.x, d.y);
      a.setFacing(d.facing);
      a.setSeated(true);
      a.setStatus(d.status);
      this.syncScreens();
    }

    onStood(d) {
      for (const [seatId, owner] of Object.entries(this.seatOwners)) if (owner === d.id) delete this.seatOwners[seatId];
      this.syncScreens();
      const a = this.avatarOf(d.id);
      if (!a) return;
      a.setSeated(false);
      a.setStatus(d.status);
      if (a === this.me) this.lastSent = null;
    }

    onListening(d) {
      const a = this.avatarOf(d.id);
      if (a) a.setListening(d.listening);
    }

    onGoal(d) {
      const a = this.avatarOf(d.id);
      if (a) a.setGoal(d.goal);
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
      let n = this.npcs.get(snap.id);
      if (!n) {
        n = new Npc(this, snap);
        this.npcs.set(snap.id, n);
      }
      n.push(snap);
    }

    onNpcPet(d) {
      const n = this.npcs.get(d.id);
      if (n) n.showHeart();
    }

    onNpcName(d) {
      const n = this.npcs.get(d.id);
      if (n) n.setName(d.name);
    }

    findNearNpc() {
      if (!this.me) return null;
      let best = null;
      let bestD = SIT_RANGE;
      for (const n of this.npcs.values()) {
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
      const T = this.T;
      const cands = [];
      if (this.nearSeat) cands.push({ kind: 'sit', target: this.nearSeat, d: Math.hypot((this.nearSeat.x + 0.5) * T - me.x, (this.nearSeat.y + 1) * T - me.y) });
      if (this.nearNpc) cands.push({ kind: 'pet', target: this.nearNpc, d: Math.hypot(this.nearNpc.x - me.x, this.nearNpc.y - me.y) });
      if (this.nearItem) cands.push({ kind: this.nearItem.kind, target: this.nearItem, d: Math.hypot(this.nearItem.x - me.x, this.nearItem.y - me.y) });
      if (!cands.length) return null;
      cands.sort((a, b) => a.d - b.d);
      return cands[0];
    }

    buildDogAnims() {
      const meta = this.dogMeta;
      const per = meta.framesPerRow;
      const mk = (key, row, frameRate) => {
        if (this.anims.exists(key)) return;
        const start = meta.rows[row] * per;
        this.anims.create({ key, frames: this.anims.generateFrameNumbers('dog', { start, end: start + per - 1 }), frameRate, repeat: -1 });
      };
      for (const dir of ['down', 'right', 'up', 'left']) mk(`dog-walk-${dir}`, dir, 5);
      mk('dog-wag', 'sit', 6);
      mk('dog-sleep', 'sleep', 1.2);
    }

    // ── 좌석 ────────────────────────────────────────────────────────
    findNearSeat() {
      if (!this.me) return null;
      const T = this.T;
      let best = null;
      let bestD = SIT_RANGE;
      for (const s of this.room.seats) {
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

    toggleSeat() {
      if (!this.me) return;
      if (this.me.seated) return this.hooks.onStand();
      const pick = this.pickTarget();
      if (!pick) return;
      if (pick.kind === 'pet') return this.hooks.onPet(pick.target.id);
      if (pick.kind === 'sit') {
        if (this.sitPending) return;
        // 앉기 요청 전에 마지막 위치를 보내고, 응답이 올 때까지는 위치 전송을 멈춘다 (착석 뒤 도착한 move 가 거부되지 않도록)
        this.flushMove(false);
        this.sitPending = true;
        Promise.resolve(this.hooks.onSit(pick.target.id)).finally(() => { this.sitPending = false; });
        return;
      }
      // 커피머신·음악 패널: 서버가 거리를 확인하므로 마지막 위치를 먼저 보낸다
      this.flushMove(false);
      this.hooks.onUse(pick.kind, pick.target.id);
    }

    /** 현재 위치/방향이 마지막 전송과 다르면 즉시 보낸다 */
    flushMove(moving) {
      const me = this.me;
      if (!me || me.seated) return;
      const snap = { x: round2(me.x), y: round2(me.y), facing: me.facing, moving };
      const last = this.lastSent;
      if (!last || last.x !== snap.x || last.y !== snap.y || last.facing !== snap.facing || last.moving !== snap.moving) {
        this.lastSent = snap;
        this.hooks.onMove(snap);
      }
    }

    // ── 매 프레임 ───────────────────────────────────────────────────
    update(_time, delta) {
      const dt = delta / 1000;
      if (this.me) {
        this.updateLocal(dt, delta);
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
      for (const n of this.npcs.values()) n.update();
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
        for (const [id, n] of this.npcs) map[id] = { x: n.x, y: n.y, npc: true };
        this.hooks.onPositions(map);
      }
    }

    updateLocal(dt, delta) {
      const me = this.me;
      const kb = this.input.keyboard;
      let dx = 0;
      let dy = 0;
      if (kb.enabled && !me.seated) {
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

      // 20Hz 전송 (움직였거나 방향/정지 상태가 바뀐 경우만)
      this.sendAcc += delta;
      if (this.sendAcc >= SEND_INTERVAL) {
        this.sendAcc = 0;
        if (!this.sitPending) this.flushMove(moving);
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
        if (facing !== a.facing) a.setFacing(facing);
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
        for (let k = 0; k < 26; k++) {
          const sx = w.x + 4 + rnd() * (w.w - 8);
          const sy = w.y + 4 + rnd() * (w.h * 0.45);
          stars.fillStyle(rnd() < 0.3 ? 0xdfe6f5 : 0xb9c4dd, 0.6 + rnd() * 0.4);
          stars.fillRect(Math.round(sx), Math.round(sy), 2, 2);
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
      const amb = Daylight.ambient(w);
      this.ambient = amb;
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

    syncGlows() {
      const k = (this.glowScale || 1) * (1 + this.fx.flash * 1.4);
      for (const g of this.glows || []) g.setAlpha(g.baseAlpha * k);
      if (this.windowFlash) this.windowFlash.setAlpha(this.fx.flash * 0.35);
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

    /** 플레이어가 나가면 텍스처·애니메이션 정리 (렌더러가 이번 프레임에 쓰고 있을 수 있어 잠시 뒤에) */
    releaseAvatarTexture(ownerId) {
      const key = this.texKey(ownerId);
      this.time.delayedCall(250, () => {
        if (!this.textures.exists(key)) return;
        for (const dir of Object.keys(this.playerMeta.rows)) this.anims.remove(`walk-${dir}-${key}`);
        this.textures.remove(key);
      });
    }

    // ── 충돌 ────────────────────────────────────────────────────────
    blockedAt(px, py) {
      const T = this.T;
      const tx = Math.floor(px / T);
      const ty = Math.floor(py / T);
      if (tx < 0 || ty < 0 || tx >= this.room.width || ty >= this.room.height) return true;
      return this.room.collision[ty][tx];
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
      for (const l of lights) {
        const g = this.add.image(l.x, l.y, 'glow')
          .setScale((l.r * 2.2) / 256)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setDepth(DEPTH.glow);
        g.baseAlpha = l.intensity * 0.5;
        g.setAlpha(g.baseAlpha * this.glowScale);
        this.glows.push(g);
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
      rt.fill(0x0d0912, alpha);
      for (const { z, g } of this.zoneStamps) rt.erase(g, z.x - 12, z.y - 12);
      for (const l of this.room.lights || []) {
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
