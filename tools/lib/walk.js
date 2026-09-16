'use strict';
/**
 * puppeteer 페이지에서 내 아바타를 키보드로 한 타일씩 걷게 하는 도우미 (테스트·스크린샷 도구 공용).
 * 프레임이 낮아도 다음 타일 중심 근처(±6px)에 멈추도록 되돌림 보정한다.
 */
const DIR = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const KEY = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };

/** BFS 로 타일 경로 (방향 목록). room 은 서버 방 데이터. */
function pathTo(room, sx, sy, goal) {
  const prev = new Map([[`${sx},${sy}`, null]]);
  const q = [[sx, sy]];
  while (q.length) {
    const [x, y] = q.shift();
    if (goal(x, y)) {
      const dirs = [];
      let cur = `${x},${y}`;
      while (prev.get(cur)) {
        const [d, from] = prev.get(cur);
        dirs.unshift(d);
        cur = from;
      }
      return dirs;
    }
    for (const [d, [dx, dy]] of Object.entries(DIR)) {
      const nx = x + dx;
      const ny = y + dy;
      const k = `${nx},${ny}`;
      if (nx < 0 || ny < 0 || nx >= room.width || ny >= room.height || room.collision[ny][nx] || prev.has(k)) continue;
      prev.set(k, [d, `${x},${y}`]);
      q.push([nx, ny]);
    }
  }
  return null;
}

const feetTile = () => ({ tx: Math.floor(window.NSM.scene.me.x / 32), ty: Math.floor((window.NSM.scene.me.y - 1) / 32) });

const feetDelta = (t) => {
  const s = window.NSM.scene.me;
  return { dx: s.x - (t.tx * 32 + 16), dy: s.y - 1 - (t.ty * 32 + 16) };
};

/** 한 축을 타일 중심 쪽으로 이동시킨다: 중심을 지나거나 6px 안에 들어올 때까지 키를 누른다 */
async function nudge(page, target, axis) {
  const d0 = await page.evaluate(feetDelta, target);
  const v = d0[axis];
  if (Math.abs(v) <= 6) return;
  const key = axis === 'dx' ? (v > 0 ? 'left' : 'right') : v > 0 ? 'up' : 'down';
  await page.keyboard.down(KEY[key]);
  try {
    await page.waitForFunction((t, ax, sign) => {
      const s = window.NSM.scene.me;
      const d = ax === 'dx' ? s.x - (t.tx * 32 + 16) : s.y - 1 - (t.ty * 32 + 16);
      return Math.abs(d) <= 6 || Math.sign(d) !== sign;
    }, { timeout: 3000, polling: 'raf' }, target, axis, Math.sign(v));
  } finally {
    await page.keyboard.up(KEY[key]);
  }
}

/** 키를 눌러 한 타일씩 걷는다. 프레임이 낮아도 다음 타일 중심 근처(±6px)에 멈추도록 되돌림 보정한다. */
async function walk(page, dirs) {
  for (const d of dirs) {
    const start = await page.evaluate(feetTile);
    const target = { tx: start.tx + DIR[d][0], ty: start.ty + DIR[d][1] };
    const axis = DIR[d][0] ? 'dx' : 'dy';
    for (let i = 0; i < 4; i++) {
      await nudge(page, target, axis);
      const dd = await page.evaluate(feetDelta, target);
      if (Math.abs(dd[axis]) <= 6) break;
    }
  }
}

module.exports = { DIR, KEY, pathTo, feetTile, feetDelta, walk };
