/* global Vehicles */
/**
 * 탈것 표시 (12단계). 아바타 하나에 VehicleView 하나 — 'vehicles' 아틀라스의 8방향 프레임(<type>|<color>|<dir>) + 데칼(decal/<kind>).
 *  - 아바타는 탈것 위에 탄다: 아틀라스 메타 seat[type][dir] = 발 위치 오프셋(px). 데칼은 decal[type][dir] (없으면 숨김).
 *  - 각도(rad, 화면 좌표) → 8방향은 window.Vehicles.dir8 (서버 /js/vehicles.js 와 같은 파일).
 *  - 내 탈것의 물리는 씬(RoomScene.updateLocal)이 Vehicles.step 으로 돌리고, 여기서는 그림만 맡는다.
 */
(function () {
  'use strict';

  class VehicleView {
    /** meta: vehicles.json 의 meta (seat / decal 앵커) */
    constructor(scene, meta) {
      this.scene = scene;
      this.meta = meta || { seat: {}, decal: {} };
      this.sprite = null;
      this.decalSprite = null;
      this.vehicle = null; // { type, color, decal, angle, speed }
      this.dir = 's';
    }

    get active() {
      return Boolean(this.vehicle);
    }

    frameKey(type, color, dir) {
      const tex = this.scene.textures.get('vehicles');
      const tries = [`${type}|${color}|${dir}`, `${type}|red|${dir}`, `kart|red|${dir}`];
      return tries.find((k) => tex && tex.has(k)) || null;
    }

    /** 탈것을 씌우거나(v) 벗긴다(null) */
    set(v) {
      if (!v) return this.clear();
      const key = this.frameKey(v.type, v.color, Vehicles.dir8(v.angle || 0));
      if (!key) return this.clear();
      this.vehicle = { type: v.type, color: v.color || 'red', decal: v.decal || null, angle: v.angle || 0, speed: v.speed || 0 };
      if (!this.sprite) this.sprite = this.scene.add.sprite(0, 0, 'vehicles', key).setOrigin(0.5, 1);
      else this.sprite.setFrame(key);
      if (this.decalSprite) { this.decalSprite.destroy(); this.decalSprite = null; }
      if (this.vehicle.decal && this.scene.textures.get('vehicles').has(`decal/${this.vehicle.decal}`)) {
        this.decalSprite = this.scene.add.sprite(0, 0, 'vehicles', `decal/${this.vehicle.decal}`).setOrigin(0.5, 0.5);
      }
      this.setMotion(this.vehicle.angle, this.vehicle.speed);
      return this;
    }

    clear() {
      if (this.sprite) this.sprite.destroy();
      if (this.decalSprite) this.decalSprite.destroy();
      this.sprite = null;
      this.decalSprite = null;
      this.vehicle = null;
      return this;
    }

    /** 각도·속도 반영 → 8방향 프레임 */
    setMotion(angle, speed) {
      if (!this.vehicle) return;
      this.vehicle.angle = angle;
      this.vehicle.speed = speed;
      const dir = Vehicles.dir8(angle);
      if (dir !== this.dir || !this.sprite.frame || !this.sprite.frame.name.endsWith(`|${dir}`)) {
        this.dir = dir;
        const key = this.frameKey(this.vehicle.type, this.vehicle.color, dir);
        if (key) this.sprite.setFrame(key);
      }
    }

    /** 아바타 발 위치 (x, y) 기준으로 탈것·데칼을 놓고, 아바타가 앉을 발 위치를 돌려준다. wobble 종류는 달릴 때 좌우로 덜컹거린다 */
    place(x, y, depth) {
      if (!this.vehicle || !this.sprite) return { x, y };
      const t = Vehicles.TYPES[this.vehicle.type];
      const wob = t && t.wobble && this.vehicle.speed > 10 ? Math.round(Math.sin(performance.now() / 45) * 2) : 0;
      const rx = Math.round(x) + wob;
      const ry = Math.round(y);
      this.sprite.setPosition(rx, ry + 2).setDepth(depth - 0.00001);
      const seat = (this.meta.seat[this.vehicle.type] || {})[this.dir] || [0, -6];
      if (this.decalSprite) {
        const d = (this.meta.decal[this.vehicle.type] || {})[this.dir];
        if (d) {
          this.decalSprite.setVisible(true).setPosition(rx - this.sprite.width / 2 + d[0], ry + 2 - this.sprite.height + d[1]).setDepth(depth + 0.00003);
        } else this.decalSprite.setVisible(false);
      }
      return { x: rx + seat[0], y: ry + seat[1] };
    }

    /** 아바타 정지 프레임용 4방향 */
    facing() {
      return Vehicles.facing4(this.dir);
    }

    destroy() {
      this.clear();
    }
  }

  window.VehicleView = VehicleView;
})();
