/* global Phaser, Layout */
/**
 * 방 안 공용 가구 (9단계). 서버 layout 항목을 furniture 아틀라스 스프라이트로 그리고, 충돌 맵·동적 좌석·조명·애니메이션·편집 미리보기를 관리한다.
 *  - 깊이: 러그(floor) 는 바닥 위(0.9), 벽 소품은 가구 타일 위(1.2), 그 외는 아바타와 같은 규칙(10 + 아래쪽 y / mapH) — 아래에 있는 것이 앞.
 *    침대 이불(|top) 은 그 위(+ε) 라 누운 아바타를 덮는다.
 *  - 충돌: Layout.buildCollision 으로 방 기본 충돌 + 통과 불가 가구 셀 (서버와 같은 규칙).
 *  - 좌석: seat 가 있는 가구(빈백·안마의자·침대)는 'f:<id>' 좌석이 된다 (씬의 findNearSeat 가 같이 본다).
 *  - 애니: item.anim { frames, fps, whenSeated } — whenSeated 면 그 좌석에 누가 앉았을 때만 (안마의자).
 *  - 조명: item.sprite.glow → 씬의 조명(어둠 지우기 + 앰버 글로우)에 더한다.
 *  - 편집 미리보기: startPlacing / startDragging → 마우스를 따라 32px 스냅, 놓을 수 있으면 초록·아니면 빨강 (Layout.validatePlacement).
 */
(function () {
  'use strict';

  const DEPTH = { rug: 0.9, wall: 1.2, base: 10 };
  const EPS = 0.0001;
  const COLOR_OK = 0x9be0a0;
  const COLOR_BAD = 0xff8a7a;

  class FurnitureLayer {
    constructor(scene, catalog) {
      this.scene = scene;
      this.room = scene.room;
      this.T = scene.room.tileSize;
      this.items = new Map((catalog && catalog.items ? catalog.items : []).map((it) => [it.id, it]));
      this.entries = new Map(); // id → entry (서버 publicLayout)
      this.views = new Map(); // id → { sprite, top, glow, animKey }
      this.collision = Layout.buildCollision(this.room, [], () => null);
      this.preview = null; // { sprite, box, item, variant, rotation, inventoryId, id, x, y, ok }
      this.selectedId = null;
      this.notes = []; // ♪ 텍스트 (스피커) — 아바타 쪽에서 쓴다
    }

    itemOf(id) {
      return this.items.get(id) || null;
    }

    hasFrame(key) {
      return this.scene.textures.exists('furn') && this.scene.textures.get('furn').has(key);
    }

    /** 프레임 키 (없으면 회전 0 / 프레임 0 으로 대체) */
    frameKey(itemId, variant, rotation = 0, frame = 0, suffix = '') {
      const mk = (v, r, f) => `${itemId}|${v || '-'}|r${r}|f${f}${suffix ? `|${suffix}` : ''}`;
      const tries = [mk(variant, rotation, frame), mk(variant, rotation, 0), mk(variant, 0, frame), mk(variant, 0, 0), mk(null, 0, 0)];
      for (const k of tries) if (this.hasFrame(k)) return k;
      return null;
    }

    iconKey(itemId, variant) {
      const k = variant ? `icon/${itemId}/${variant}` : `icon/${itemId}`;
      return this.hasFrame(k) ? k : this.hasFrame(`icon/${itemId}`) ? `icon/${itemId}` : null;
    }

    // ── 항목 관리 ────────────────────────────────────────────────────
    setEntries(list) {
      for (const id of [...this.views.keys()]) this.destroyView(id);
      this.entries.clear();
      for (const e of list || []) this.entries.set(e.id, e);
      for (const e of this.entries.values()) this.buildView(e);
      this.afterChange();
    }

    upsert(entry) {
      const prev = this.entries.get(entry.id);
      this.entries.set(entry.id, { ...prev, ...entry });
      this.destroyView(entry.id);
      this.buildView(this.entries.get(entry.id));
      this.afterChange();
    }

    remove(id) {
      this.destroyView(id);
      this.entries.delete(id);
      if (this.selectedId === id) this.selectedId = null;
      this.afterChange();
    }

    setLock(id, by) {
      const e = this.entries.get(id);
      if (!e) return;
      e.lockedBy = by || null;
      this.applyLockLook(e);
    }

    applyLockLook(e) {
      const v = this.views.get(e.id);
      if (!v) return;
      const me = this.scene.me && this.scene.me.id;
      const heldByOther = e.lockedBy && e.lockedBy !== me;
      const selected = this.selectedId === e.id;
      for (const s of [v.sprite, v.top]) {
        if (!s) continue;
        s.setAlpha(heldByOther ? 0.6 : 1);
        if (heldByOther) s.setTint(0xffc46a);
        else if (selected) s.setTint(0xa8d8ff);
        else s.clearTint();
      }
    }

    afterChange() {
      this.collision = Layout.buildCollision(this.room, [...this.entries.values()], (id) => this.itemOf(id));
      this.scene.onFurnitureChanged();
    }

    /** 항목 → 월드 픽셀 사각형 { x, y, w, h } */
    rectOf(entry) {
      const item = this.itemOf(entry.itemId);
      const fp = Layout.footprint(item ? item.sprite : { w: 1, h: 1 }, entry.rotation || 0);
      return { x: entry.x * this.T, y: entry.y * this.T, w: fp.w * this.T, h: fp.h * this.T };
    }

    depthOf(item, rect, top = false) {
      if (item.sprite.layer === 'floor') return DEPTH.rug;
      if (item.sprite.wallOnly) return DEPTH.wall;
      return DEPTH.base + (rect.y + rect.h) / this.scene.mapH + (top ? EPS : -EPS);
    }

    animKeyFor(item, variant, rotation) {
      if (!item.anim || !item.anim.frames) return null;
      const key = `furn-${item.id}-${variant || '-'}-r${rotation}`;
      if (!this.scene.anims.exists(key)) {
        const frames = [];
        for (let f = 0; f < item.anim.frames; f++) {
          const k = this.frameKey(item.id, variant, rotation, f);
          if (k) frames.push({ key: 'furn', frame: k });
        }
        if (frames.length < 2) return null;
        this.scene.anims.create({ key, frames, frameRate: item.anim.fps || 4, repeat: -1 });
      }
      return key;
    }

    buildView(e) {
      const item = this.itemOf(e.itemId);
      if (!item) return;
      const rect = this.rectOf(e);
      const key = this.frameKey(item.id, e.variant, e.rotation || 0, 0);
      if (!key) return;
      const sprite = this.scene.add.sprite(rect.x, rect.y, 'furn', key).setOrigin(0, 0).setDepth(this.depthOf(item, rect));
      const v = { sprite, top: null, glow: null, animKey: this.animKeyFor(item, e.variant, e.rotation || 0), item };
      if (v.animKey && !(item.anim && item.anim.whenSeated)) sprite.anims.play(v.animKey);
      const topKey = item.sprite.top ? this.frameKey(item.id, e.variant, e.rotation || 0, 0, 'top') : null;
      if (topKey) v.top = this.scene.add.image(rect.x, rect.y, 'furn', topKey).setOrigin(0, 0).setDepth(this.depthOf(item, rect, true));
      if (item.sprite.glow) v.glow = this.scene.addFurnitureLight({ x: rect.x + rect.w / 2, y: rect.y + Math.round(rect.h * 0.3), r: (item.sprite.glow.r || 2.5) * this.T, intensity: item.sprite.glow.intensity || 0.5 });
      this.views.set(e.id, v);
      this.applyLockLook(e);
    }

    destroyView(id) {
      const v = this.views.get(id);
      if (!v) return;
      v.sprite.destroy();
      if (v.top) v.top.destroy();
      if (v.glow) this.scene.removeFurnitureLight(v.glow);
      this.views.delete(id);
    }

    /** 좌석 점유 상태에 따라 whenSeated 애니(안마의자) 켜고 끄기 */
    syncSeated(seatOwners) {
      for (const [id, v] of this.views) {
        if (!v.animKey || !(v.item.anim && v.item.anim.whenSeated)) continue;
        const on = Boolean(seatOwners[`f:${id}`]);
        if (on && !v.sprite.anims.isPlaying) v.sprite.anims.play(v.animKey);
        else if (!on && v.sprite.anims.isPlaying) {
          v.sprite.anims.stop();
          v.sprite.setFrame(this.frameKey(v.item.id, this.entries.get(id).variant, this.entries.get(id).rotation || 0, 0));
        }
      }
    }

    /** 가구 좌석 목록 [{ id: 'f:<id>', x, y, facing, kind, layoutId }] */
    seats() {
      const out = [];
      for (const e of this.entries.values()) {
        const item = this.itemOf(e.itemId);
        const s = item && Layout.seatOf(item.sprite, e.x, e.y, e.rotation || 0);
        if (s) out.push({ id: `f:${e.id}`, x: s.tx, y: s.ty, facing: s.facing, kind: s.kind, layoutId: e.id });
      }
      return out;
    }

    seatById(seatId) {
      if (typeof seatId !== 'string' || !seatId.startsWith('f:')) return null;
      return this.seats().find((s) => s.id === seatId) || null;
    }

    /** 타일 (tx, ty) 를 덮는 항목 (위에 그려지는 것 우선: 러그는 마지막) */
    entryAt(tx, ty) {
      let best = null;
      for (const e of this.entries.values()) {
        const item = this.itemOf(e.itemId);
        if (!item) continue;
        if (!Layout.cellsOf(item.sprite, e.x, e.y, e.rotation || 0).some((c) => c.tx === tx && c.ty === ty)) continue;
        if (!best || (item.sprite.layer !== 'floor' && this.itemOf(best.itemId).sprite.layer === 'floor')) best = e;
      }
      return best;
    }

    /** 사람·강아지가 서 있는 셀 (서버 occupiedTiles 와 같은 규칙) */
    occupiedTiles() {
      const scene = this.scene;
      const T = this.T;
      const set = new Set();
      const add = (px, py) => set.add(`${Math.floor(px / T)},${Math.floor(py / T)}`);
      const feet = (a) => {
        if (a.seated) return;
        const hw = scene.config.feetW / 2;
        const fh = scene.config.feetH;
        add(a.x - hw, a.y - fh); add(a.x + hw - 1, a.y - fh); add(a.x - hw, a.y - 1); add(a.x + hw - 1, a.y - 1);
      };
      if (scene.me) feet(scene.me);
      for (const r of scene.remotes.values()) feet(r.avatar);
      for (const n of scene.npcs.values()) add(n.x, n.y - 1);
      return set;
    }

    validate(item, placement) {
      return Layout.validatePlacement(this.room, item, placement, [...this.entries.values()], (id) => this.itemOf(id), { occupied: this.occupiedTiles() });
    }

    // ── 편집 미리보기 ────────────────────────────────────────────────
    /** 팔레트에서 고른 아이템을 놓기 시작 */
    startPlacing({ item, variant, inventoryId }) {
      this.cancelPreview();
      this.preview = { item, variant: variant || null, inventoryId, rotation: 0, id: null, x: null, y: null, ok: false, mode: 'place' };
      this.buildPreview();
    }

    /** 놓인 가구를 잡아서 옮기기 시작 */
    startDragging(entry) {
      this.cancelPreview();
      const item = this.itemOf(entry.itemId);
      if (!item) return;
      this.preview = { item, variant: entry.variant || null, inventoryId: null, rotation: entry.rotation || 0, id: entry.id, x: entry.x, y: entry.y, ok: true, mode: 'drag' };
      this.buildPreview();
      this.moveTo(entry.x, entry.y);
    }

    buildPreview() {
      const p = this.preview;
      const key = this.frameKey(p.item.id, p.variant, p.rotation, 0);
      p.sprite = this.scene.add.image(0, 0, 'furn', key).setOrigin(0, 0).setDepth(40).setAlpha(0.7).setVisible(false);
      p.box = this.scene.add.graphics().setDepth(40).setVisible(false);
    }

    rotatePreview() {
      const p = this.preview;
      if (!p) return false;
      const rots = p.item.sprite.rotations || [0];
      if (rots.length < 2) return false;
      p.rotation = rots[(rots.indexOf(p.rotation) + 1) % rots.length];
      p.sprite.setFrame(this.frameKey(p.item.id, p.variant, p.rotation, 0));
      if (p.x !== null) this.moveTo(p.x, p.y);
      return true;
    }

    /** 마우스 월드 좌표 → 풋프린트 가운데가 오도록 스냅 */
    snap(wx, wy) {
      const p = this.preview;
      const fp = Layout.footprint(p.item.sprite, p.rotation);
      return { x: Math.floor(wx / this.T) - Math.floor((fp.w - 1) / 2), y: Math.floor(wy / this.T) - Math.floor((fp.h - 1) / 2) };
    }

    moveTo(x, y) {
      const p = this.preview;
      if (!p) return;
      p.x = x;
      p.y = y;
      const v = this.validate(p.item, { x, y, rotation: p.rotation, id: p.id === null ? undefined : p.id });
      p.ok = v.ok;
      p.error = v.ok ? null : v.error;
      const fp = Layout.footprint(p.item.sprite, p.rotation);
      p.sprite.setPosition(x * this.T, y * this.T).setVisible(true).setTint(v.ok ? COLOR_OK : COLOR_BAD);
      p.box.clear().setVisible(true);
      p.box.lineStyle(2, v.ok ? COLOR_OK : COLOR_BAD, 0.9);
      p.box.strokeRect(x * this.T + 1, y * this.T + 1, fp.w * this.T - 2, fp.h * this.T - 2);
      p.box.fillStyle(v.ok ? COLOR_OK : COLOR_BAD, 0.15);
      p.box.fillRect(x * this.T, y * this.T, fp.w * this.T, fp.h * this.T);
    }

    cancelPreview() {
      const p = this.preview;
      if (!p) return;
      if (p.sprite) p.sprite.destroy();
      if (p.box) p.box.destroy();
      this.preview = null;
    }

    select(id) {
      const prev = this.selectedId;
      this.selectedId = id;
      for (const eid of [prev, id]) if (eid !== null && this.entries.has(eid)) this.applyLockLook(this.entries.get(eid));
    }

    destroy() {
      this.cancelPreview();
      for (const id of [...this.views.keys()]) this.destroyView(id);
    }
  }

  window.FurnitureLayer = FurnitureLayer;
})();
