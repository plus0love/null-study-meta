/* global Phaser */
/**
 * 방 씬: 서버에서 받은 방 데이터(레이어별 타일 배열)를 타일맵으로 그리고,
 * 내 아바타를 걷게 한다. 조명(어두운 베이스 + 앰버 라이트 마스크)과 비네팅 포함.
 */
(function () {
  'use strict';

  const SPEED = 150; // px/s
  const FEET_W = 18; // 발 충돌 박스 (px)
  const FEET_H = 10;

  class RoomScene extends Phaser.Scene {
    constructor() {
      super('room');
    }

    init(data) {
      this.room = data.room;
      this.tilesMeta = data.tiles;
      this.playerMeta = data.player;
    }

    preload() {
      this.load.image('tiles', '/assets/tiles.png');
      this.load.spritesheet('player', '/assets/player.png', {
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
      this.buildLightTextures();
      this.buildPlayer();
      this.buildLighting();
      this.buildVignette();
      this.setupWindowTwinkle();

      const cam = this.cameras.main;
      cam.setBounds(0, 0, this.mapW, this.mapH);
      cam.setRoundPixels(true);
      cam.startFollow(this.player, true, 0.15, 0.15);
      cam.setBackgroundColor('#14111a');

      this.cursors = this.input.keyboard.createCursorKeys();
      this.wasd = this.input.keyboard.addKeys({ up: 'W', down: 'S', left: 'A', right: 'D' });

      const loading = document.getElementById('loading');
      if (loading) loading.classList.add('hidden');
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

    // ── 아바타 ─────────────────────────────────────────────────────
    buildPlayer() {
      const rows = this.playerMeta.rows;
      const per = this.playerMeta.framesPerRow;
      for (const dir of Object.keys(rows)) {
        const start = rows[dir] * per;
        this.anims.create({
          key: `walk-${dir}`,
          frames: this.anims.generateFrameNumbers('player', { start, end: start + per - 1 }),
          frameRate: 8,
          repeat: -1,
        });
      }
      const { x, y } = this.room.spawn;
      this.player = this.add.sprite(x, y, 'player', rows.down * per).setOrigin(0.5, 1).setDepth(10);
      this.facing = 'down';
      // 발 밑 그림자
      this.shadow = this.add.ellipse(x, y - 2, 22, 8, 0x000000, 0.28).setDepth(9);
    }

    blockedAt(px, py) {
      const T = this.T;
      const tx = Math.floor(px / T);
      const ty = Math.floor(py / T);
      if (tx < 0 || ty < 0 || tx >= this.room.width || ty >= this.room.height) return true;
      return this.room.collision[ty][tx];
    }

    canStand(x, y) {
      // (x, y) = 발 중심. 발 박스의 네 모서리를 검사한다.
      const hw = FEET_W / 2;
      return (
        !this.blockedAt(x - hw, y - FEET_H) &&
        !this.blockedAt(x + hw - 1, y - FEET_H) &&
        !this.blockedAt(x - hw, y - 1) &&
        !this.blockedAt(x + hw - 1, y - 1)
      );
    }

    update(_time, delta) {
      const dt = delta / 1000;
      let dx = 0;
      let dy = 0;
      if (this.cursors.left.isDown || this.wasd.left.isDown) dx -= 1;
      if (this.cursors.right.isDown || this.wasd.right.isDown) dx += 1;
      if (this.cursors.up.isDown || this.wasd.up.isDown) dy -= 1;
      if (this.cursors.down.isDown || this.wasd.down.isDown) dy += 1;

      const p = this.player;
      if (dx || dy) {
        const len = Math.hypot(dx, dy);
        const vx = (dx / len) * SPEED * dt;
        const vy = (dy / len) * SPEED * dt;
        // 축별로 따로 이동 → 벽에 붙어 미끄러지기
        const nx = p.x + vx;
        if (this.canStand(nx, p.y)) p.x = nx;
        const ny = p.y + vy;
        if (this.canStand(p.x, ny)) p.y = ny;

        if (Math.abs(dx) >= Math.abs(dy)) this.facing = dx < 0 ? 'left' : 'right';
        else this.facing = dy < 0 ? 'up' : 'down';
        p.anims.play(`walk-${this.facing}`, true);
      } else if (p.anims.isPlaying) {
        p.anims.stop();
        p.setFrame(this.playerMeta.rows[this.facing] * this.playerMeta.framesPerRow);
      }
      this.shadow.setPosition(p.x, p.y - 2);
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
      // 비네팅
      mk('vignette', 512, [
        [0, 'rgba(30,14,8,0)'],
        [0.55, 'rgba(30,14,8,0)'],
        [0.8, 'rgba(30,14,8,0.35)'],
        [1, 'rgba(24,10,6,0.8)'],
      ]);
    }

    buildLighting() {
      const lights = this.room.lights || [];
      // 1) 어두운 베이스 (RenderTexture) 에서 조명 위치를 지운다
      const rt = this.add.renderTexture(0, 0, this.mapW, this.mapH).setOrigin(0, 0).setDepth(30);
      rt.fill(0x0d0912, 0.46);
      const stamp = this.make.image({ key: 'lightmask', add: false });
      for (const l of lights) {
        stamp.setScale((l.r * 2.8) / 256).setAlpha(Math.min(1, l.intensity + 0.4));
        rt.erase(stamp, l.x, l.y);
      }
      // 창문 유리도 밤하늘이 보이게 살짝 밝힘
      this.darkness = rt;

      // 2) 앰버 글로우 (가산)
      this.glows = [];
      for (const l of lights) {
        const g = this.add.image(l.x, l.y, 'glow')
          .setScale((l.r * 2.2) / 256)
          .setAlpha(l.intensity * 0.55)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setDepth(31);
        this.glows.push(g);
        this.tweens.add({
          targets: g,
          alpha: { from: l.intensity * 0.45, to: l.intensity * 0.6 },
          duration: 1200 + Math.random() * 1200,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
      }
    }

    buildVignette() {
      const cam = this.cameras.main;
      this.vignette = this.add.image(cam.width / 2, cam.height / 2, 'vignette')
        .setScrollFactor(0)
        .setDepth(40)
        .setDisplaySize(cam.width * 1.05, cam.height * 1.05);
      this.scale.on('resize', () => {
        this.vignette.setPosition(cam.width / 2, cam.height / 2).setDisplaySize(cam.width * 1.05, cam.height * 1.05);
      });
    }

    // ── 창밖 불빛 깜빡임 ───────────────────────────────────────────
    setupWindowTwinkle() {
      const anim = this.tilesMeta.animTiles || {};
      const pairs = new Map();
      for (const [a, b] of Object.entries(anim)) {
        pairs.set(Number(a), b);
        pairs.set(b, Number(a));
      }
      const layer = this.layers.furniture;
      const targets = [];
      layer.forEachTile((tile) => {
        if (pairs.has(tile.index)) targets.push(tile);
      });
      if (!targets.length) return;
      this.time.addEvent({
        delay: 450,
        loop: true,
        callback: () => {
          for (const tile of targets) {
            if (Math.random() < 0.18) tile.index = pairs.get(tile.index);
          }
        },
      });
    }
  }

  window.RoomScene = RoomScene;
})();
