/* global AvatarSchema */
/**
 * 아바타 파츠 합성 (5단계). catalog.json + 레이어 PNG 를 읽어 두고,
 * 아바타 객체 → 레이어를 같은 프레임으로 겹친 시트(4열 걷기 x 4행 방향, 32x64 프레임) 캔버스를 만든다.
 * 색은 팔레트 치환: 레이어 PNG 의 기준 톤(catalog.layers[*].palette) → 고른 색의 tones (명암 단계 유지).
 * Phaser 씬(방 안 아바타)과 DOM 빌더(미리보기·썸네일)가 같이 쓴다.
 */
(function () {
  'use strict';

  const BASE = '/assets/avatar/';

  function loadImage(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  class AvatarKit {
    constructor(catalog, images) {
      this.catalog = catalog;
      this.schema = AvatarSchema.createAvatarSchema(catalog);
      this.images = images; // 'hair/basic' → HTMLImageElement | null
      this.frame = catalog.frame; // { width, height, framesPerRow, rows }
      this.recolored = new Map(); // 'hair/basic|black' → canvas (아이템 x 색 만큼만 — 조합별 시트는 캐시하지 않는다)
    }

    /** catalog + 모든 레이어 PNG 를 읽는다. 일부가 실패해도 진행 (그 레이어는 비워 둔다). */
    static async load(version = '') {
      const v = version ? `?v=${version}` : '';
      const catalog = await fetch(`${BASE}catalog.json${v}`).then((r) => r.json());
      const jobs = [];
      for (const [name, layer] of Object.entries(catalog.layers)) {
        for (const it of layer.items) {
          if (it.file === null) continue;
          const key = `${name}/${it.id}`;
          jobs.push(loadImage(`${BASE}${key}.png${v}`).then((img) => [key, img]));
        }
      }
      const images = new Map(await Promise.all(jobs));
      return new AvatarKit(catalog, images);
    }

    normalize(avatar) { return this.schema.normalize(avatar); }
    key(avatar) { return this.schema.key(avatar); }
    random() { return this.schema.random(); }
    get defaults() { return this.schema.defaults; }

    colorOf(colorField, id) {
      return (this.catalog.colors[colorField] || []).find((c) => c.id === id) || null;
    }

    /** 레이어 한 장을 색상 옵션으로 리컬러한 캔버스 (캐시). 색이 없는 레이어(액세서리)는 원본 그대로. */
    layerCanvas(layerName, itemId, colorId) {
      const layer = this.catalog.layers[layerName];
      const img = this.images.get(`${layerName}/${itemId}`);
      if (!layer || !img) return null;
      const cacheKey = `${layerName}/${itemId}|${colorId || ''}`;
      const hit = this.recolored.get(cacheKey);
      if (hit) return hit;
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0);
      const color = layer.colorField ? this.colorOf(layer.colorField, colorId) : null;
      if (color && layer.palette.length) {
        const src = layer.palette.map(hexToRgb);
        const dst = color.tones.map(hexToRgb);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const d = data.data;
        for (let p = 0; p < d.length; p += 4) {
          if (d[p + 3] === 0) continue;
          for (let s = 0; s < src.length && s < dst.length; s++) {
            if (d[p] === src[s][0] && d[p + 1] === src[s][1] && d[p + 2] === src[s][2]) {
              d[p] = dst[s][0];
              d[p + 1] = dst[s][1];
              d[p + 2] = dst[s][2];
              break;
            }
          }
        }
        ctx.putImageData(data, 0, 0);
      }
      this.recolored.set(cacheKey, canvas);
      return canvas;
    }

    /** 아바타의 레이어 캔버스 목록 (그리는 순서대로) */
    layerStack(avatar) {
      const a = this.normalize(avatar);
      const out = [];
      for (const name of this.catalog.order) {
        const layer = this.catalog.layers[name];
        const itemId = layer.field ? a[layer.field] : layer.item;
        const item = layer.items.find((it) => it.id === itemId);
        if (!item || item.file === null) continue;
        const c = this.layerCanvas(name, itemId, layer.colorField ? a[layer.colorField] : null);
        if (c) out.push(c);
      }
      return out;
    }

    /** 전체 시트 합성 (Phaser 캔버스 텍스처에 그려 넣는 용도). 레이어 캔버스 6장을 겹치는 것뿐이라 캐시하지 않는다 */
    composeSheet(avatar) {
      const canvas = document.createElement('canvas');
      canvas.width = this.frame.width * this.frame.framesPerRow;
      canvas.height = this.frame.height * Object.keys(this.frame.rows).length;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      for (const layer of this.layerStack(avatar)) ctx.drawImage(layer, 0, 0);
      return canvas;
    }

    /** 한 프레임을 (dx, dy) 에 scale 배로 그린다 (미리보기·썸네일) */
    drawFrame(ctx, avatar, dir, frameIndex, dx, dy, scale = 1) {
      const { width, height, framesPerRow, rows } = this.frame;
      const row = rows[dir] ?? 0;
      const sx = (frameIndex % framesPerRow) * width;
      const sy = row * height;
      ctx.imageSmoothingEnabled = false;
      for (const layer of this.layerStack(avatar)) ctx.drawImage(layer, sx, sy, width, height, dx, dy, width * scale, height * scale);
    }
  }

  window.AvatarKit = AvatarKit;
})();
