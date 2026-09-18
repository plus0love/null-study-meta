'use strict';
/**
 * 14단계 스크린샷 (puppeteer-core + 로컬 Chrome). 서버를 스스로 띄운다 (STORE=memory).
 *   node tools/screenshot_stage14.js [outDir] [--only=map,track,zoo,...]
 * 출력:
 *   s14_map_day.png / s14_map_night.png — 야외 전체 맵 (낮: 구름 그림자 · 밤: 창문 불빛·가로등·별)
 *   s14_track.png       — 트랙 확대 (연석·아치·관중석·피트·꽃밭, 노을)
 *   s14_zoo.png         — 동물원 확대 (B)
 *   s14_animals_row.png — 동물 스프라이트 한 줄 (B, 파이썬 미리보기 복사)
 *   s14_fishing.png     — 낚시 장면 (C)
 *   s14_constellation.png — 별자리 오버레이 (C)
 */
const path = require('node:path');
const fs = require('node:fs');
const puppeteer = require('puppeteer-core');
const { io } = require('socket.io-client');
const { startServer } = require('../server/index');
const { walk, pathTo } = require('./lib/walk');

process.env.STORE = 'memory';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ARGS = ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'];
const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith('--')) || path.join(__dirname, '..', 'screenshots');
const only = (args.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const want = (k) => !only.length || only.includes(k);
fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const quiet = { log() {}, warn() {}, error() {} };
const T = 32;

async function shot(page, name, clip) {
  const file = path.join(out, name);
  await page.screenshot({ path: file, clip, captureBeyondViewport: false });
  console.log('saved', file);
}

/** 소켓 봇: 스터디에 들어가 이중문을 밟고 야외로 나간 뒤 (tx, ty) 타일에 선다 */
async function outdoorBot(base, hub, nickname, code, tx, ty, facing = 'down') {
  const s = io(base, { transports: ['websocket'], forceNew: true });
  const ask = (ev, p) => new Promise((r) => s.emit(ev, p, r));
  const j = await ask('join', { nickname, study: code });
  if (!j.ok) throw new Error(`bot join ${nickname}: ${j.error}`);
  s.emit('move', { x: 22.5 * T, y: 25 * T, facing: 'down', moving: false });
  await sleep(50);
  const d = await ask('door', {});
  if (!d.ok) throw new Error(`bot door ${nickname}: ${d.error}`);
  const p = hub.outdoor.players.get(j.self.id);
  p.x = (tx + 0.5) * T; p.y = (ty + 1) * T; p.facing = facing;
  s.emit('move', { x: p.x, y: p.y, facing, moving: false });
  return { s, ask, id: j.self.id, player: p };
}

(async () => {
  // 서버 시계: 밤(22시)으로 옮겨 별자리·반딧불이 확인 가능 (실제 시각 + 오프셋)
  const target = new Date(); target.setHours(22, 0, 0, 0);
  const offset = target.getTime() - Date.now();
  const srv = await startServer({ port: 0, log: quiet, world: { study: { autoTick: false }, now: () => Date.now() + offset } });
  const base = `http://127.0.0.1:${srv.port}`;
  const hub = srv.hub;
  const store = hub.store;
  const mine = (await hub.createStudy({ name: '새벽 코딩방', ownerNickname: '민수' })).study;
  const algo = (await hub.createStudy({ name: '알고리즘 스터디', ownerNickname: '영희' })).study;
  for (const n of ['민수', '영희', '철수', '지우']) await store.adjustCoins(n, 200, 'test');

  const bots = [];
  const mk = async (n, code, tx, ty, f) => { const b = await outdoorBot(base, hub, n, code, tx, ty, f); bots.push(b); return b; };
  await mk('영희', algo.code, 34, 27);
  await mk('철수', algo.code, 29, 27);

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ARGS });
  const page = await (await browser.createBrowserContext()).newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.stack || e.message));
  await page.setViewport({ width: 1500, height: 900, deviceScaleFactor: 1 });
  await page.goto(`${base}/?study=${mine.code}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#login:not([hidden])', { timeout: 60000 });
  await page.type('#login-nick', '민수');
  await page.click('#login-submit');
  await page.waitForFunction(() => window.NSM && window.NSM.scene.me && document.getElementById('lobby').hidden, { timeout: 30000 });
  await page.evaluate(() => window.NSM.ui.setWide(true));
  await sleep(300);
  const room = hub.room;
  const me = await page.evaluate(() => ({ x: window.NSM.scene.me.x, y: window.NSM.scene.me.y }));
  await walk(page, pathTo(room, Math.floor(me.x / T), Math.floor((me.y - 1) / T), (x, y) => x === 22 && y === 24));
  await page.keyboard.down('ArrowDown');
  await page.waitForFunction(() => window.NSM.scene.transferring || window.NSM.net.room === 'outdoor', { timeout: 20000, polling: 100 });
  await page.keyboard.up('ArrowDown');
  await page.waitForFunction(() => window.NSM.net.room === 'outdoor' && window.NSM.scene.room.id === 'outdoor' && window.NSM.scene.me && window.NSM.scene.ready, { timeout: 30000 });
  await sleep(600);
  const myId = await page.evaluate(() => window.NSM.scene.me.id);
  // 검수용 동물·물고기 한 줄 미리보기를 스크린샷 폴더로 복사
  for (const f of ['s14_animals_row.png', 'tools/out/s14_fish_row.png']) { const src = path.join(__dirname, 'out', path.basename(f)); if (fs.existsSync(src)) fs.copyFileSync(src, path.join(out, path.basename(f))); }
  const meP = () => hub.outdoor.players.get(myId);
  /** 서버·클라이언트 위치를 같이 옮긴다 */
  const teleport = async (tx, ty, facing = 'down') => {
    const p = meP(); p.x = (tx + 0.5) * T; p.y = (ty + 1) * T; p.facing = facing; p.budget = 10000;
    await page.evaluate((x, y, f) => { const s = window.NSM.scene; s.me.setPosition(x, y); s.me.setFacing(f); s.lastSent = null; s.correction = null; }, p.x, p.y, facing);
    await sleep(150);
  };
  const view = async (hour, zoom, cx, cy) => {
    await page.evaluate((h, z, x, y) => { const s = window.NSM.scene; s.setClockOverride(h); s.cameras.main.stopFollow(); s.cameras.main.setZoom(z); s.cameras.main.centerOn(x, y); }, hour, zoom, cx, cy);
    await sleep(700);
  };
  const follow = async (hour) => {
    await page.evaluate((h) => { const s = window.NSM.scene; s.setClockOverride(h); s.setZoom(2); s.cameras.main.centerOn(s.me.x, s.me.y); s.cameras.main.startFollow(s.me.sprite, true, 0.15, 0.15); }, hour);
    await sleep(500);
  };
  const W = hub.outdoor.room.width * T;
  const H = hub.outdoor.room.height * T;

  if (want('map')) {
    await view(13, 0.44, W / 2, H / 2);
    await shot(page, 's14_map_day.png', { x: 40, y: 0, width: 1420, height: 900 });
    await view(22, 0.44, W / 2, H / 2);
    await page.evaluate(() => { for (let i = 0; i < 2; i++) window.NSM.scene.spawnShootingStar(); });
    await sleep(200);
    await shot(page, 's14_map_night.png', { x: 40, y: 0, width: 1420, height: 900 });
  }
  if (want('track')) {
    await view(18, 1.4, 60 * T, 26 * T);
    await shot(page, 's14_track.png', { x: 0, y: 0, width: 1500, height: 900 });
  }
  if (want('zoo')) {
    await view(14, 1.25, 55 * T, 60 * T);
    await shot(page, 's14_zoo.png', { x: 0, y: 0, width: 1500, height: 900 });
  }
  if (want('fishing')) {
    await teleport(5, 37, 'down');
    await follow(16);
    await page.waitForFunction(() => /낚시하기/.test(document.getElementById('sit-hint').textContent), { timeout: 5000 }).catch(() => console.log('낚시 힌트가 뜨지 않음'));
    await page.evaluate(() => window.NSM.scene.toggleSeat());
    await page.waitForFunction(() => window.NSM.scene.me && window.NSM.scene.me.fishing, { timeout: 5000 }).catch(() => console.log('낚시 자세가 뜨지 않음'));
    // 입질 순간("!")까지 서버 세션을 당긴다
    const sess = hub.outdoor.fishing.get(myId);
    if (sess) { const bite = sess.biteAt - (Date.now() + offset); await sleep(Math.max(0, Math.min(bite + 80, 11000))); }
    await page.waitForFunction(() => window.NSM.scene.me.fishing && window.NSM.scene.me.fishing.state === 'bite', { timeout: 12000 }).catch(() => console.log('입질이 뜨지 않음'));
    await sleep(150);
    await shot(page, 's14_fishing.png', { x: 0, y: 120, width: 800, height: 600 });
  }
  if (want('constellation')) {
    await teleport(37, 6, 'up');
    await follow(22);
    await page.evaluate(() => window.NSM.scene.toggleSeat());
    await page.waitForFunction(() => !document.getElementById('sky-modal').hidden && document.querySelectorAll('#sky-canvas').length, { timeout: 8000 }).catch(() => console.log('별자리 오버레이가 열리지 않음'));
    await sleep(2600);
    await shot(page, 's14_constellation.png', { x: 0, y: 0, width: 1500, height: 900 });
  }

  for (const b of bots) b.s.close();
  await browser.close();
  await srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
