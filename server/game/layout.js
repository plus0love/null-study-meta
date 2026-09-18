'use strict';
/**
 * 공용 가구 배치 규칙 (9단계, 순수 함수). 판정은 전부 서버가 하고, 클라이언트는 미리보기 색(초록/빨강)에 같은 함수를 쓴다
 * — 서버가 이 파일을 /js/layout.js 로 그대로 내려보내 브라우저에서는 window.Layout 이 된다 (사본 없음).
 *
 * 배치 항목(entry): { id, itemId, x, y, rotation, meta: { variant }, placedBy, placedAt }
 * 카탈로그(item.sprite): w, h, passable, seat, rotations, wallOnly, on, replace, layer
 *
 * 규칙
 *  - 풋프린트는 (x, y) 좌상단 + 회전(1 = 시계 90°, w/h 교환). seat 셀도 같이 회전한다.
 *  - 일반 가구: 모든 셀이 맵 안 · 충돌 아님 · 좌석/문/스폰 아님 · 기존 오브젝트(props) 없음 · 다른 배치 가구와 안 겹침.
 *  - wallOnly: 모든 셀이 맨 벽(wall_face). on: 모든 셀이 목록의 오브젝트 위(null 은 빈 바닥). replace: 그 오브젝트 자리에 정확히.
 *  - 러그(layer 'floor')는 다른 가구와 겹쳐도 된다 (아래에 깔린다). 그 외 가구끼리는 셀이 겹치면 안 된다.
 *  - 통과 불가 가구(passable=false)의 셀은 충돌 맵에 들어간다. seat 셀은 예외(앉으러 들어가야 하니까).
 *    사람(발 위치)·강아지가 서 있는 셀에는 통과 불가 가구를 놓을 수 없다.
 *  - 17단계 통행: 통과 불가 가구를 놓아서(또는 옮겨서) 스폰에서 닿던 칸이 못 가는 곳이 되면 거부한다 ('isolates').
 *    기준은 "놓기 전 스폰에서 BFS 로 닿던 칸" — 원래부터 못 가던 틈은 상관없다. 새 가구의 좌석 칸도 닿아야 한다. opts.connectivity = false 로 끌 수 있다.
 */
const WALL_NAMES = new Set(['wall_face']);
const ERRORS = ['no_item', 'invalid_rotation', 'out_of_bounds', 'wall_only', 'needs_base', 'blocked', 'overlap', 'player_in_way', 'isolates'];
const ROT_FACING = { up: 'right', right: 'down', down: 'left', left: 'up' }; // 시계 90° 마다

function footprint(sprite, rotation = 0) {
  const w = sprite.w || 1;
  const h = sprite.h || 1;
  return rotation % 2 ? { w: h, h: w } : { w, h };
}

/** 스프라이트 좌표 (dx, dy) 를 rotation 만큼 시계 방향으로 돌린 좌표 */
function rotateCell(sprite, dx, dy, rotation = 0) {
  let w = sprite.w || 1;
  let h = sprite.h || 1;
  let x = dx;
  let y = dy;
  for (let i = 0; i < (rotation % 4); i++) {
    [x, y] = [h - 1 - y, x];
    [w, h] = [h, w];
  }
  return { dx: x, dy: y };
}

function rotateFacing(facing, rotation = 0) {
  let f = facing;
  for (let i = 0; i < (rotation % 4); i++) f = ROT_FACING[f] || f;
  return f;
}

/** 배치 항목이 차지하는 셀 목록 [{ tx, ty, dx, dy }] (dx, dy 는 회전 전 스프라이트 좌표) */
function cellsOf(sprite, x, y, rotation = 0) {
  const out = [];
  for (let dy = 0; dy < (sprite.h || 1); dy++) {
    for (let dx = 0; dx < (sprite.w || 1); dx++) {
      const r = rotateCell(sprite, dx, dy, rotation);
      out.push({ tx: x + r.dx, ty: y + r.dy, dx, dy });
    }
  }
  return out;
}

/** 앉기 셀 (있으면) → { tx, ty, facing, kind } */
function seatOf(sprite, x, y, rotation = 0) {
  if (!sprite.seat) return null;
  const r = rotateCell(sprite, sprite.seat.dx, sprite.seat.dy, rotation);
  return { tx: x + r.dx, ty: y + r.dy, facing: rotateFacing(sprite.seat.facing, rotation), kind: sprite.seat.kind || 'seat' };
}

/** 충돌 맵에 넣을 셀 (통과 불가 가구의 seat 아닌 셀) */
function solidCells(sprite, x, y, rotation = 0) {
  if (sprite.passable) return [];
  const seat = seatOf(sprite, x, y, rotation);
  return cellsOf(sprite, x, y, rotation).filter((c) => !(seat && c.tx === seat.tx && c.ty === seat.ty));
}

function occupantAt(room, tx, ty) {
  if (tx < 0 || ty < 0 || tx >= room.width || ty >= room.height || !room.occupant) return null;
  const i = room.occupant[ty][tx];
  return i >= 0 ? room.props[i] : null;
}

function inBounds(room, tx, ty) {
  return tx >= 0 && ty >= 0 && tx < room.width && ty < room.height;
}

function isSeatOrDoor(room, tx, ty) {
  return room.seats.some((s) => s.x === tx && s.y === ty) || (room.doors || []).some((d) => d.x === tx && d.y === ty);
}

function isSpawn(room, tx, ty) {
  return Math.floor(room.spawn.x / room.tileSize) === tx && Math.floor((room.spawn.y - 1) / room.tileSize) === ty;
}

/** 빈 바닥인가: 충돌 아님 · 좌석/문/스폰 아님 · 바닥 아닌 오브젝트 없음 */
function isFreeFloor(room, tx, ty) {
  return inBounds(room, tx, ty) && !room.collision[ty][tx] && !isSeatOrDoor(room, tx, ty) && !isSpawn(room, tx, ty) && !occupantAt(room, tx, ty);
}

function matchesOn(room, rule, tx, ty) {
  const occ = occupantAt(room, tx, ty);
  if (rule === null) return isFreeFloor(room, tx, ty);
  if (typeof rule === 'string') return Boolean(occ && occ.name === rule);
  if (!occ || occ.name !== rule.name) return false;
  if (rule.dyMin !== undefined && ty - occ.y < rule.dyMin) return false;
  if (rule.dxMin !== undefined && tx - occ.x < rule.dxMin) return false;
  return true;
}

/**
 * 배치/이동 검증.
 * @param room 방 데이터 (props/occupant 포함)
 * @param item 카탈로그 아이템
 * @param placement { x, y, rotation, id? } — id 가 있으면(이동) 그 항목 자신과의 겹침은 무시
 * @param others 다른 배치 항목 [{ id, itemId, x, y, rotation }] + itemOf(itemId) → item
 * @param opts { occupied: Set<'tx,ty'> (사람·강아지가 서 있는 셀) }
 * @returns {{ ok: true, cells, seat, solid } | { ok: false, error }}
 */
function validatePlacement(room, item, placement, others = [], itemOf = () => null, opts = {}) {
  if (!item || !item.sprite) return { ok: false, error: 'no_item' };
  const sprite = item.sprite;
  const rotation = Number(placement.rotation) || 0;
  const rotations = sprite.rotations || [0];
  if (!Number.isInteger(rotation) || !rotations.includes(rotation)) return { ok: false, error: 'invalid_rotation' };
  const x = Number(placement.x);
  const y = Number(placement.y);
  if (!Number.isInteger(x) || !Number.isInteger(y)) return { ok: false, error: 'out_of_bounds' };
  const cells = cellsOf(sprite, x, y, rotation);
  for (const c of cells) if (!inBounds(room, c.tx, c.ty)) return { ok: false, error: 'out_of_bounds' };

  if (sprite.replace) {
    const base = (room.props || []).find((p) => p.name === sprite.replace && p.x === x && p.y === y);
    const fp = footprint(sprite, rotation);
    if (!base || base.w !== fp.w || base.h !== fp.h) return { ok: false, error: 'needs_base' };
  } else if (sprite.wallOnly) {
    for (const c of cells) {
      const occ = occupantAt(room, c.tx, c.ty);
      if (!occ || !WALL_NAMES.has(occ.name)) return { ok: false, error: 'wall_only' };
    }
  } else if (sprite.on) {
    for (const c of cells) if (!sprite.on.some((rule) => matchesOn(room, rule, c.tx, c.ty))) return { ok: false, error: 'needs_base' };
  } else {
    for (const c of cells) if (!isFreeFloor(room, c.tx, c.ty)) return { ok: false, error: 'blocked' };
  }

  // 다른 배치 가구와 겹침 (러그는 예외)
  const isRug = sprite.layer === 'floor';
  const mine = new Set(cells.map((c) => `${c.tx},${c.ty}`));
  for (const o of others) {
    if (placement.id !== undefined && o.id === placement.id) continue;
    const oi = itemOf(o.itemId);
    if (!oi || !oi.sprite) continue;
    if (isRug || oi.sprite.layer === 'floor') continue;
    for (const c of cellsOf(oi.sprite, o.x, o.y, o.rotation || 0)) if (mine.has(`${c.tx},${c.ty}`)) return { ok: false, error: 'overlap' };
  }

  const solid = solidCells(sprite, x, y, rotation);
  if (opts.occupied && opts.occupied.size) {
    for (const c of solid) if (opts.occupied.has(`${c.tx},${c.ty}`)) return { ok: false, error: 'player_in_way' };
  }
  if (opts.connectivity !== false && isolates(room, others, itemOf, solid, placement.id)) return { ok: false, error: 'isolates' };
  return { ok: true, cells, seat: seatOf(sprite, x, y, rotation), solid };
}

/** 스폰 타일 좌표 (isSpawn 과 같은 규칙) */
function spawnTile(room) {
  return { tx: Math.floor(room.spawn.x / room.tileSize), ty: Math.floor((room.spawn.y - 1) / room.tileSize) };
}

/** 충돌 격자에서 (sx, sy) 로부터 4방향으로 닿는 칸 — Uint8Array(width * height), 1 = 닿음. 시작 칸이 막혀 있으면 전부 0 */
function reachable(grid, width, height, sx, sy) {
  const seen = new Uint8Array(width * height);
  if (sx < 0 || sy < 0 || sx >= width || sy >= height || grid[sy][sx]) return seen;
  const q = [sx, sy];
  seen[sy * width + sx] = 1;
  for (let i = 0; i < q.length; i += 2) {
    const x = q[i];
    const y = q[i + 1];
    if (x > 0 && !grid[y][x - 1] && !seen[y * width + x - 1]) { seen[y * width + x - 1] = 1; q.push(x - 1, y); }
    if (x < width - 1 && !grid[y][x + 1] && !seen[y * width + x + 1]) { seen[y * width + x + 1] = 1; q.push(x + 1, y); }
    if (y > 0 && !grid[y - 1][x] && !seen[(y - 1) * width + x]) { seen[(y - 1) * width + x] = 1; q.push(x, y - 1); }
    if (y < height - 1 && !grid[y + 1][x] && !seen[(y + 1) * width + x]) { seen[(y + 1) * width + x] = 1; q.push(x, y + 1); }
  }
  return seen;
}

/**
 * 통과 불가 셀(solid)을 더하면 고립되는 칸이 생기는가 (17단계).
 * 놓기 전 스폰에서 닿던 칸 중, 놓은 뒤에도 걸을 수 있는데(가구 셀이 아닌데) 닿지 않게 되는 칸이 하나라도 있으면 true.
 * @param entries 다른 배치 항목 (skipId 가 있으면 그 항목은 제외 — 이동 중인 가구)
 */
function isolates(room, entries, itemOf, solid, skipId) {
  if (!solid.length || !room.spawn || !room.collision) return false;
  const grid = buildCollision(room, entries.filter((e) => skipId === undefined || e.id !== skipId), itemOf);
  const { tx, ty } = spawnTile(room);
  const before = reachable(grid, room.width, room.height, tx, ty);
  for (const c of solid) if (inBounds(room, c.tx, c.ty)) grid[c.ty][c.tx] = true;
  const after = reachable(grid, room.width, room.height, tx, ty);
  for (let i = 0; i < before.length; i++) {
    if (!before[i] || after[i]) continue;
    const x = i % room.width;
    const y = (i - x) / room.width;
    if (!grid[y][x]) return true;
  }
  return false;
}

/** 방의 기본 충돌 맵 사본에 배치 가구의 통과 불가 셀을 더한 2D 배열 */
function buildCollision(room, entries, itemOf) {
  const grid = room.collision.map((row) => row.slice());
  for (const e of entries) {
    const it = itemOf(e.itemId);
    if (!it || !it.sprite) continue;
    for (const c of solidCells(it.sprite, e.x, e.y, e.rotation || 0)) if (inBounds(room, c.tx, c.ty)) grid[c.ty][c.tx] = true;
  }
  return grid;
}

/**
 * 좌석 앞 책상 슬롯 3개 (책상 소품 표시 위치). 좌석이 보는 방향 앞 두 칸의 좌우 → 그 가운데 → 바로 앞 칸의 좌우 → 가운데 순서로
 * 책상/테이블 셀만 골라 3개까지. 반환: [{ tx, ty }] (0~3개)
 */
const DESK_NAMES = new Set(['desk_wide', 'desk_return', 'big_table_v', 'round_table', 'side_table_round', 'nightstand']);
const DELTA = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
function deskSlots(room, seat) {
  if (!seat) return [];
  // 15단계: 방 데이터가 좌석에 슬롯을 명시하면 그대로 (2인 책상은 두 사람의 슬롯이 겹치지 않게 지정)
  if (Array.isArray(seat.slots) && seat.slots.length) return seat.slots.slice(0, 3).map((s) => ({ tx: s.tx, ty: s.ty }));
  const [fx, fy] = DELTA[seat.facing] || [0, 1];
  const px = fy !== 0 ? 1 : 0; // 수직 방향(perp)
  const py = fx !== 0 ? 1 : 0;
  const f = { tx: seat.x + fx, ty: seat.y + fy };
  const f2 = { tx: seat.x + fx * 2, ty: seat.y + fy * 2 };
  // 가운데 칸(기존 모니터 자리)은 마지막 — 소품이 1~2개면 모니터가 가려지지 않는다
  const cands = [{ tx: f2.tx - px, ty: f2.ty - py }, { tx: f2.tx + px, ty: f2.ty + py }, f2, { tx: f.tx - px, ty: f.ty - py }, { tx: f.tx + px, ty: f.ty + py }, f];
  const out = [];
  for (const c of cands) {
    const occ = occupantAt(room, c.tx, c.ty);
    if (occ && DESK_NAMES.has(occ.name) && !out.some((o) => o.tx === c.tx && o.ty === c.ty)) out.push(c);
    if (out.length === 3) break;
  }
  return out;
}

const api = { footprint, rotateCell, rotateFacing, cellsOf, seatOf, solidCells, validatePlacement, buildCollision, deskSlots, isFreeFloor, occupantAt, spawnTile, reachable, isolates, WALL_NAMES, ERRORS, DESK_NAMES };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else window.Layout = api;
