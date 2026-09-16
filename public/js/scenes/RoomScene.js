/* global Phaser */
/**
 * 방 씬: 서버에서 받은 방 데이터(레이어별 타일 배열)를 타일맵으로 그리고,
 * 내 아바타(입력·충돌·20Hz 전송·서버 보정)와 다른 접속자 아바타(스냅샷 선형 보간)를 그린다.
 * 닉네임·상태 아이콘·채팅 말풍선·이모지는 아바타 머리 위에 붙는다. 조명/비네팅 포함.
 *
 * 외부 연결은 scene.hooks 콜백으로만 한다 (main.js 가 채움):
 *   onMove(payload) · onSit(seatId) · onStand() · onNearSeat(seat|null) · onEmojiKey(i) · onChatKey() · onPositions(map)
 */
(function () {
  'use strict';

  const ZOOM = 2;
  const SEND_INTERVAL = 50; // ms (20Hz)
  const INTERP_DELAY = 100; // ms — 원격 아바타는 이만큼 과거를 그린다 (두 스냅샷 사이 선형 보간)
  const SIT_RANGE = 56; // px, 서버 SIT_RANGE_PX 와 동일
  const CORRECT_RATE = 10; // 서버 보정 시 초당 수렴 비율
  const FONTS = { hand: '"Gaegu", "Nanum Pen Script", cursive', sans: '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif' };
  const STATUS_EMOJI = { study: '📖', rest: '☕' };
  // 셔츠 색 변형 (player.png 의 셔츠 3톤을 바꿔 아바타 텍스처를 만든다)
  const SHIRT_SRC = [[241, 238, 232], [201, 196, 187], [169, 163, 154]];
  const SHIRT_VARIANTS = [
    null, // 0: 원본(흰색)
    [[255, 196, 110], [214, 152, 70], [178, 120, 52]], // 앰버
    [[168, 196, 150], [122, 152, 106], [92, 120, 80]], // 세이지
    [[150, 180, 220], [104, 134, 184], [78, 104, 150]], // 블루
  ];

  const DEPTH = { shadow: 9, avatar: 10, label: 25, bubble: 26 };

  // ── 아바타 (내 것/원격 공용 표시 요소) ────────────────────────────────
  class Avatar {
    constructor(scene, p) {
      this.scene = scene;
      this.id = p.id;
      this.nickname = p.nickname;
      this.avatar = p.avatar || 0;
      this.facing = p.facing || 'down';
      this.status = p.status || 'rest';
      this.seated = Boolean(p.seatId);
      this.x = p.x;
      this.y = p.y;
      this.walking = false;

      this.sprite = scene.add.sprite(p.x, p.y, scene.texKey(this.avatar), scene.idleFrame('down')).setOrigin(0.5, 1);
      this.shadow = scene.add.ellipse(p.x, p.y - 2, 22, 8, 0x000000, 0.28).setDepth(DEPTH.shadow);
      // 닉네임은 발 아래, 상태 아이콘은 머리 위 오른쪽, 채팅/이모지는 머리 위
      this.name = scene.add.text(p.x, p.y + 3, p.nickname, {
        fontFamily: FONTS.sans, fontSize: '11px', fontStyle: 'bold', color: '#f1e6d2',
        stroke: '#14111a', strokeThickness: 3, resolution: ZOOM,
      }).setOrigin(0.5, 0).setDepth(DEPTH.label);
      this.statusBubble = this.makeBubble(STATUS_EMOJI[this.status], { pad: 3, fontSize: 10, radius: 6 });
      this.statusBubble.setDepth(DEPTH.label);
      this.chatBubble = null;
      this.chatTimer = null;
      this.emojiText = null;
      this.emojiTimer = null;
      this.setPosition(p.x, p.y);
      this.setFacing(this.facing);
      this.setSeated(this.seated);
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
      this.statusBubble.setPosition(rx + 16, ry - 66);
      if (this.chatBubble) this.chatBubble.setPosition(rx, ry - 78 - this.chatBubble.bubbleH / 2);
      if (this.emojiText) this.emojiText.setPosition(rx, ry - 74 - (this.emojiText.rise || 0));
    }

    setFacing(f) {
      this.facing = f;
      if (this.walking) this.sprite.anims.play(this.scene.walkKey(f, this.avatar), true);
      else this.sprite.setFrame(this.scene.idleFrame(this.seated ? 'down' : f));
    }

    setWalking(on) {
      if (this.seated) on = false;
      if (on) {
        this.walking = true;
        this.sprite.anims.play(this.scene.walkKey(this.facing, this.avatar), true); // 같은 애니메이션이면 무시
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
    }

    setStatus(s) {
      this.status = s;
      this.statusBubble.bubbleText.setText(STATUS_EMOJI[s] || '•');
    }

    setAvatar(i) {
      this.avatar = i;
      const frame = this.sprite.frame.name;
      this.sprite.setTexture(this.scene.texKey(i), frame);
      if (this.walking) this.sprite.anims.play(this.scene.walkKey(this.facing, i), true);
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

    showEmoji(emoji) {
      this.clearEmoji();
      const t = this.scene.add.text(0, 0, emoji, { fontSize: '18px', resolution: ZOOM }).setOrigin(0.5, 1).setDepth(DEPTH.bubble);
      t.rise = 0;
      this.emojiText = t;
      this.setPosition(this.x, this.y);
      this.scene.tweens.add({ targets: t, rise: 10, duration: 500, ease: 'Sine.easeOut', onUpdate: () => this.setPosition(this.x, this.y) });
      this.scene.tweens.add({ targets: t, alpha: 0, delay: 1500, duration: 500 });
      this.emojiTimer = this.scene.time.delayedCall(2000, () => this.clearEmoji());
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
      this.sprite.destroy();
      this.shadow.destroy();
      this.name.destroy();
      this.statusBubble.destroy();
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
      this.playerMeta = data.player;
      this.onReady = data.onReady || (() => {});
      this.hooks = { onMove() {}, onSit() {}, onStand() {}, onNearSeat() {}, onEmojiKey() {}, onChatKey() {}, onPositions() {} };
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
      this.load.spritesheet('player-0', `/assets/player.png${v}`, {
        frameWidth: this.playerMeta.frameWidth,
        frameHeight: this.playerMeta.frameHeight,
      });
    }

    create() {
      const room = this.room;
      const T = room.tileSize;
      this.T = T;
      this.mapW = room.width * T;
      this.mapH = room.height * T;

      this.buildLayers();
      this.buildLabels();
      this.buildLightTextures();
      this.buildAvatarTextures();
      this.buildLighting();
      this.syncVignette();
      this.setupWindowTwinkle();

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
      this.hooks.onNearSeat(null);
      for (const p of ack.players) this.addRemote(p);
      const cam = this.cameras.main;
      cam.startFollow(this.me.sprite, true, 0.15, 0.15);
      cam.centerOn(this.me.x, this.me.y);
    }

    clearSession() {
      for (const r of this.remotes.values()) r.avatar.destroy();
      this.remotes.clear();
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
    }

    onStood(d) {
      for (const [seatId, owner] of Object.entries(this.seatOwners)) if (owner === d.id) delete this.seatOwners[seatId];
      const a = this.avatarOf(d.id);
      if (!a) return;
      a.setSeated(false);
      a.setStatus(d.status);
      if (a === this.me) this.lastSent = null;
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
      if (this.me.seated) this.hooks.onStand();
      else if (this.nearSeat && !this.sitPending) {
        // 앉기 요청 전에 마지막 위치를 보내고, 응답이 올 때까지는 위치 전송을 멈춘다 (착석 뒤 도착한 move 가 거부되지 않도록)
        this.flushMove(false);
        this.sitPending = true;
        Promise.resolve(this.hooks.onSit(this.nearSeat.id)).finally(() => { this.sitPending = false; });
      }
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
          if ((s && s.id) !== (this.nearSeat && this.nearSeat.id)) {
            this.nearSeat = s;
            this.hooks.onNearSeat(s);
          }
        }
      }
      this.updateRemotes();
      this.posAcc += delta;
      if (this.posAcc >= 100) {
        this.posAcc = 0;
        const map = {};
        if (this.me) map[this.me.id] = { x: this.me.x, y: this.me.y };
        for (const [id, r] of this.remotes) map[id] = { x: r.avatar.x, y: r.avatar.y };
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
      const depths = { floor: 0, furniture: 1, top: 20 };
      for (const name of ['floor', 'furniture', 'top']) {
        const layer = map.createBlankLayer(name, tileset, 0, 0);
        layer.putTilesAt(room.layers[name], 0, 0);
        layer.setDepth(depths[name]);
        this.layers[name] = layer;
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

    // ── 아바타 텍스처/애니메이션 (셔츠 색 4종) ──────────────────────
    texKey(avatar) {
      return this.textures.exists(`player-${avatar}`) ? `player-${avatar}` : 'player-0';
    }

    walkKey(dir, avatar) {
      return `walk-${dir}-${this.textures.exists(`player-${avatar}`) ? avatar : 0}`;
    }

    idleFrame(dir) {
      return this.playerMeta.rows[dir] * this.playerMeta.framesPerRow;
    }

    buildAvatarTextures() {
      const meta = this.playerMeta;
      const src = this.textures.get('player-0').getSourceImage();
      SHIRT_VARIANTS.forEach((variant, i) => {
        if (i === 0 || this.textures.exists(`player-${i}`)) return;
        const canvas = document.createElement('canvas');
        canvas.width = src.width;
        canvas.height = src.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(src, 0, 0);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const d = img.data;
        for (let p = 0; p < d.length; p += 4) {
          if (d[p + 3] === 0) continue;
          for (let s = 0; s < SHIRT_SRC.length; s++) {
            const [r, g, b] = SHIRT_SRC[s];
            if (d[p] === r && d[p + 1] === g && d[p + 2] === b) {
              [d[p], d[p + 1], d[p + 2]] = variant[s];
              break;
            }
          }
        }
        ctx.putImageData(img, 0, 0);
        this.textures.addSpriteSheet(`player-${i}`, canvas, { frameWidth: meta.frameWidth, frameHeight: meta.frameHeight });
      });
      const per = meta.framesPerRow;
      SHIRT_VARIANTS.forEach((_v, i) => {
        for (const dir of Object.keys(meta.rows)) {
          const key = `walk-${dir}-${i}`;
          if (this.anims.exists(key)) continue;
          const start = meta.rows[dir] * per;
          this.anims.create({ key, frames: this.anims.generateFrameNumbers(`player-${i}`, { start, end: start + per - 1 }), frameRate: 8, repeat: -1 });
        }
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
    }

    buildLighting() {
      const lights = this.room.lights || [];
      // 1) 어두운 베이스 (RenderTexture) 에서 조명 위치를 지운다
      const rt = this.add.renderTexture(0, 0, this.mapW, this.mapH).setOrigin(0, 0).setDepth(30);
      rt.fill(0x0d0912, 0.2);
      const stamp = this.make.image({ key: 'lightmask', add: false });
      for (const l of lights) {
        stamp.setScale((l.r * 2.8) / 256).setAlpha(Math.min(1, l.intensity + 0.45));
        rt.erase(stamp, l.x, l.y);
      }
      this.darkness = rt;

      // 2) 앰버 글로우 (가산)
      this.glows = [];
      for (const l of lights) {
        const g = this.add.image(l.x, l.y, 'glow')
          .setScale((l.r * 2.2) / 256)
          .setAlpha(l.intensity * 0.5)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setDepth(31);
        this.glows.push(g);
        this.tweens.add({
          targets: g,
          alpha: { from: l.intensity * 0.4, to: l.intensity * 0.55 },
          duration: 1200 + Math.random() * 1200,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
      }
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
