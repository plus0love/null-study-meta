'use strict';
/**
 * 방 빌더.
 * public/assets/tiles.json 의 오브젝트 정의(크기·레이어·충돌·의자·문)를 읽어
 * 레이어별 2D 배열(floor / furniture / top) + collision + seats + doors 를 만든다.
 * 레이어 값은 아틀라스 타일 인덱스, 빈 칸은 -1.
 * 3단계 추가: windowDay 레이어(낮 창문, 클라이언트가 시간대에 따라 알파를 조절), windows(하늘 사각형),
 * zones(유리 스터디룸 영역: 밝은 조명 + 유리 틴트), screens(좌석과 연결된 모니터/노트북 화면), interactables(커피머신·음악 패널).
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
    this.layers = { floor: grid(width, height, -1), furniture: grid(width, height, -1), top: grid(width, height, -1), windowDay: grid(width, height, -1) };
    this.collision = grid(width, height, false);
    this.seats = [];
    this.doors = [];
    this.lights = [];
    this.labels = [];
    this.windows = [];
    this.zones = [];
    this.screens = [];
    this.interactables = [];
    this.spawn = { x: 0, y: 0 };
    this.placed = [];
    // 9단계: 바닥이 아닌 오브젝트 목록(props) + 셀마다 마지막으로 놓인 오브젝트의 props 인덱스(occupant, 없으면 -1).
    // 가구 배치 검증(벽 전용·소파 위·책장 빈 칸·기존 커피머신 교체)과 책상 소품 슬롯(책상 셀 찾기)에 쓴다.
    this.props = [];
    this.occupant = grid(width, height, -1);
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
   * opts.layer 를 주면 그 레이어에만 타일을 쓰고 충돌·좌석·문은 건드리지 않는다 (낮 창문 등 겹침용).
   */
  place(name, x, y, opts = {}) {
    const o = this.obj(name);
    const seatCells = new Set((o.seats || []).map((s) => `${s.dx},${s.dy}`));
    const propIndex = !opts.layer && o.layer !== 'floor' ? this.props.push({ name, x, y, w: o.w, h: o.h }) - 1 : -1;
    for (let dy = 0; dy < o.h; dy++) {
      for (let dx = 0; dx < o.w; dx++) {
        const tx = x + dx;
        const ty = y + dy;
        if (!this.inBounds(tx, ty)) throw new Error(`${name} 이(가) 맵 밖: (${tx},${ty})`);
        const idx = o.tiles[dy][dx];
        if (opts.layer) {
          this.layers[opts.layer][ty][tx] = idx;
          continue;
        }
        const isTop = dy < (o.top || 0) || o.layer === 'top';
        const layer = isTop ? 'top' : o.layer;
        this.layers[layer][ty][tx] = idx;
        if (propIndex >= 0) this.occupant[ty][tx] = propIndex;
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

  /** 창밖 하늘 사각형 (타일 단위, h 는 소수 가능) — 클라이언트가 시간대 그라데이션을 그린다 */
  window(x, y, w, h) {
    this.windows.push({ x: Math.round(x * TILE), y: Math.round(y * TILE), w: Math.round(w * TILE), h: Math.round(h * TILE) });
    return this;
  }

  /** 유리 스터디룸 등 구역 (타일 단위, 포함 범위). kind 'glass': 밝은 조명 + 옅은 하늘빛 틴트 + 사선 반사 */
  zone(id, x0, y0, x1, y1, opts = {}) {
    this.zones.push({ id, kind: opts.kind || 'glass', x: x0 * TILE, y: y0 * TILE, w: (x1 - x0 + 1) * TILE, h: (y1 - y0 + 1) * TILE, bright: opts.bright ?? 0.6 });
    return this;
  }

  /**
   * 좌석에 연결된 화면 (모니터/노트북). 좌석이 점유되면 클라이언트가 화면을 켠다.
   * (seatX, seatY) 는 좌석 타일, rect 는 논리 픽셀(16px 타일 기준) 좌표 → 월드 픽셀로 변환.
   */
  screen(seatX, seatY, { x, y, w, h, kind = 'monitor' }) {
    const seat = this.seats.find((s) => s.x === seatX && s.y === seatY);
    if (!seat) throw new Error(`화면을 연결할 좌석이 없음: (${seatX},${seatY})`);
    const k = TILE / 16;
    this.screens.push({ seatId: seat.id, kind, x: Math.round(x * k), y: Math.round(y * k), w: Math.round(w * k), h: Math.round(h * k) });
    return this;
  }

  /** E 키 상호작용 지점 (커피머신 앞 등). (x, y) 는 발 위치 기준 타일 좌표(소수 가능). */
  interactable(id, kind, x, y, opts = {}) {
    this.interactables.push({ id, kind, x: Math.round(x * TILE), y: Math.round(y * TILE), hint: opts.hint || '', range: opts.range || 56 });
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
      windows: this.windows,
      zones: this.zones,
      screens: this.screens,
      interactables: this.interactables,
      spawn: this.spawn,
      props: this.props,
      occupant: this.occupant,
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

function interactableById(room, id) {
  return (room.interactables || []).find((i) => i.id === id) || null;
}

/** (tx, ty) 셀을 마지막으로 차지한 바닥 아닌 오브젝트 { name, x, y, w, h } 또는 null (9단계) */
function occupantAt(room, tx, ty) {
  if (tx < 0 || ty < 0 || tx >= room.width || ty >= room.height || !room.occupant) return null;
  const i = room.occupant[ty][tx];
  return i >= 0 ? room.props[i] : null;
}

module.exports = { RoomBuilder, TILES, TILE, FACING_DELTA, isBlocked, seatAt, doorAt, interactableById, occupantAt };
