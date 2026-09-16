'use strict';
/**
 * 방 빌더.
 * public/assets/tiles.json 의 오브젝트 정의(크기·레이어·충돌·의자·문)를 읽어
 * 레이어별 2D 배열(floor / furniture / top) + collision + seats + doors 를 만든다.
 * 레이어 값은 아틀라스 타일 인덱스, 빈 칸은 -1.
 */
const path = require('node:path');

const TILES = require(path.join(__dirname, '..', '..', 'public', 'assets', 'tiles.json'));
const TILE = TILES.tileSize;

const FACING_DELTA = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

function grid(w, h, v) {
  return Array.from({ length: h }, () => new Array(w).fill(v));
}

class RoomBuilder {
  constructor({ id, name, width, height }) {
    this.id = id;
    this.name = name;
    this.width = width;
    this.height = height;
    this.layers = { floor: grid(width, height, -1), furniture: grid(width, height, -1), top: grid(width, height, -1) };
    this.collision = grid(width, height, false);
    this.seats = [];
    this.doors = [];
    this.lights = [];
    this.labels = [];
    this.spawn = { x: 0, y: 0 };
    this.placed = [];
  }

  obj(name) {
    const o = TILES.objects[name];
    if (!o) throw new Error(`알 수 없는 오브젝트: ${name}`);
    return o;
  }

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  /** 1x1 오브젝트(또는 변형 목록)로 사각형을 채운다. */
  fill(names, x0, y0, x1, y1, opts = {}) {
    const list = Array.isArray(names) ? names : [names];
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const pick = opts.checker ? list[(x + y) % list.length] : list[((x * 7 + y * 13) % list.length + list.length) % list.length];
        this.place(pick, x, y);
      }
    }
    return this;
  }

  /** 여러 오브젝트를 가로로 이어 붙인다. */
  row(names, x, y) {
    let cx = x;
    for (const n of names) {
      this.place(n, cx, y);
      cx += this.obj(n).w;
    }
    return this;
  }

  /**
   * 오브젝트 배치. top 행은 top 레이어(통과 가능), 나머지는 오브젝트 레이어.
   * 의자/문 셀은 통과 가능. opts.solid 로 충돌을 강제할 수 있다.
   */
  place(name, x, y, opts = {}) {
    const o = this.obj(name);
    const seatCells = new Set((o.seats || []).map((s) => `${s.dx},${s.dy}`));
    for (let dy = 0; dy < o.h; dy++) {
      for (let dx = 0; dx < o.w; dx++) {
        const tx = x + dx;
        const ty = y + dy;
        if (!this.inBounds(tx, ty)) throw new Error(`${name} 이(가) 맵 밖: (${tx},${ty})`);
        const idx = o.tiles[dy][dx];
        const isTop = dy < (o.top || 0) || o.layer === 'top';
        const layer = isTop ? 'top' : o.layer;
        this.layers[layer][ty][tx] = idx;
        if (isTop) continue;
        let solid = opts.solid !== undefined ? opts.solid : o.solid;
        if (seatCells.has(`${dx},${dy}`) || o.door) solid = false;
        if (o.layer === 'floor') {
          // 바닥/러그: 기존 충돌은 건드리지 않되, 통과 불가 바닥(외벽면·화단)은 막는다
          if (solid) this.collision[ty][tx] = true;
        } else {
          this.collision[ty][tx] = solid;
        }
        if (o.door) this.doors.push({ id: opts.doorId || `${name}@${tx},${ty}`, x: tx, y: ty, to: opts.to || null });
      }
    }
    for (const s of o.seats || []) {
      this.seats.push({ id: `seat-${this.seats.length}`, x: x + s.dx, y: y + s.dy, facing: s.facing, kind: name });
    }
    this.placed.push({ name, x, y });
    return this;
  }

  /** 조명 (타일 좌표, 반지름은 타일 단위). */
  light(x, y, r = 2.5, color = 0xffb85c, intensity = 0.55) {
    this.lights.push({ x: Math.round((x + 0.5) * TILE), y: Math.round((y + 0.5) * TILE), r: Math.round(r * TILE), color, intensity });
    return this;
  }

  /**
   * 보드/표지판 글자 (클라이언트가 웹폰트로 그림). (x, y) 는 글자 블록의 중심(타일 단위).
   * opts: font 'hand'|'sans', size(px, 월드 기준), weight, color, align, lineHeight, spacing(letterSpacing)
   */
  label(x, y, text, opts = {}) {
    this.labels.push({
      x: Math.round(x * TILE),
      y: Math.round(y * TILE),
      text,
      font: opts.font || 'sans',
      size: opts.size || 12,
      weight: opts.weight || 400,
      color: opts.color || '#f1e6d2',
      align: opts.align || 'center',
      lineHeight: opts.lineHeight || 1.2,
      spacing: opts.spacing || 0,
    });
    return this;
  }

  setSpawn(x, y) {
    this.spawn = { x: Math.round((x + 0.5) * TILE), y: Math.round((y + 1) * TILE) };
    return this;
  }

  setSolid(x0, y0, x1, y1, v = true) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.collision[y][x] = v;
    return this;
  }

  build() {
    return {
      id: this.id,
      name: this.name,
      width: this.width,
      height: this.height,
      tileSize: TILE,
      layers: this.layers,
      collision: this.collision,
      seats: this.seats,
      doors: this.doors,
      lights: this.lights,
      labels: this.labels,
      spawn: this.spawn,
    };
  }
}

// ── 공용 판정 함수 (다음 단계의 소켓 서버에서도 사용) ─────────────────────
function isBlocked(room, tx, ty) {
  if (tx < 0 || ty < 0 || tx >= room.width || ty >= room.height) return true;
  return room.collision[ty][tx];
}

function seatAt(room, tx, ty) {
  return room.seats.find((s) => s.x === tx && s.y === ty) || null;
}

function doorAt(room, tx, ty) {
  return room.doors.find((d) => d.x === tx && d.y === ty) || null;
}

module.exports = { RoomBuilder, TILES, TILE, FACING_DELTA, isBlocked, seatAt, doorAt };
