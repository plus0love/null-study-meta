'use strict';
/**
 * 12단계 스크린샷 (puppeteer-core + 로컬 Chrome). 서버를 스스로 띄운다 (STORE=memory).
 *   node tools/screenshot_stage12.js [outDir]
 * 출력:
 *   s12_outdoor_map.png — 야외 전체 맵 (카메라 축소, 낮): 언덕·건물·광장·공원·연못·트랙
 *   s12_track.png       — 트랙 확대 (출발선·관중 벤치·전광판·카트 정류장, 노을)
 *   s12_riding.png      — 카트 탑승 화면 (아바타 머리 위 스터디 이름 · 랩 HUD · 다른 스터디 사람들 · 밤 가로등)
 *   s12_board.png       — 전광판 모달 (오늘/역대 상위 5)
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
const out = process.argv[2] || path.join(__dirname, '..', 'screenshots');
fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const quiet = { log() {}, warn() {}, error() {} };
const T = 32;

async function shot(page, name, clip) {
  const file = path.join(out, name);
  await page.screenshot({ path: file, clip, captureBeyondViewport: false });
  console.log('saved', file);
}

/** 소켓 봇: 스터디에 들어가 이중문을 밟고 야외로 나간 뒤 (x, y) 타일에 선다 */
async function outdoorBot(base, nickname, code, tx, ty, opts = {}) {
  const s = io(base, { transports: ['websocket'], forceNew: true });
  const ask = (ev, p) => new Promise((r) => s.emit(ev, p, r));
  const j = await ask('join', { nickname, study: code });
  if (!j.ok) throw new Error(`bot join ${nickname}: ${j.error}`);
  s.emit('move', { x: 22.5 * T, y: 25 * T, facing: 'down', moving: false });
  await sleep(50);
  const d = await ask('door', {});
  if (!d.ok) throw new Error(`bot door ${nickname}: ${d.error}`);
  return { s, ask, id: j.self.id, tx, ty, facing: opts.facing || 'down' };
}

(async () => {
  const srv = await startServer({ port: 0, log: quiet, world: { study: { autoTick: false } } });
  const base = `http://127.0.0.1:${srv.port}`;
  const hub = srv.hub;
  const store = hub.store;
  const mine = (await hub.createStudy({ name: '새벽 코딩방', ownerNickname: '민수' })).study;
  const algo = (await hub.createStudy({ name: '알고리즘 스터디', ownerNickname: '영희' })).study;
  const toeic = (await hub.createStudy({ name: '토익 900 도전', ownerNickname: '철수' })).study;
  // 전광판 기록
  const now = Date.now();
  const rec = (n, sid, v, sec, ago) => store.addTrackRecord({ nickname: n, studyId: sid, vehicle: v, ms: Math.round(sec * 1000) }, now - ago);
  await rec('영희', algo.id, 'sport', 9.4, 3600e3); await rec('철수', toeic.id, 'kart', 11.2, 7200e3); await rec('지우', algo.id, 'bicycle', 16.8, 600e3);
  await rec('하늘', toeic.id, 'kickboard', 15.1, 86400e3 * 2); await rec('보라', algo.id, 'kart', 10.9, 86400e3 * 3); await rec('민수', mine.id, 'kart', 12.7, 86400e3 * 5);
  for (const n of ['영희', '철수', '지우', '하늘', '보라']) await store.adjustCoins(n, 200, 'test');

  // 다른 스터디 사람들을 야외에 세운다 (탑승한 사람도 하나)
  const bots = [];
  const mk = async (n, code, tx, ty, opts) => { const b = await outdoorBot(base, n, code, tx, ty, opts); bots.push(b); return b; };
  const b1 = await mk('영희', algo.code, 34, 27);
  const b2 = await mk('철수', toeic.code, 29, 27);
  const b3 = await mk('지우', algo.code, 49, 34);
  // 서버 위치를 직접 옮긴다 (순간이동은 move 로는 거부되므로) → 다음 move 부터 그 자리
  for (const b of bots) { const p = hub.outdoor.players.get(b.id); p.x = (b.tx + 0.5) * T; p.y = (b.ty + 1) * T; p.facing = b.facing; b.s.emit('move', { x: p.x, y: p.y, facing: b.facing, moving: false }); }
  // 지우: 스포츠 카트 탑승
  const bought = await b3.ask('shop:buy', { itemId: 'vehicle_sport', variant: 'yellow' });
  await b3.ask('vehicle:config', { active: bought.inventory.id });
  await b3.ask('vehicle:mount', {});
  { const p = hub.outdoor.players.get(b3.id); p.x = 49.5 * T; p.y = 35 * T; b3.s.emit('move', { x: p.x, y: p.y, facing: 'up', moving: false, vehicle: { type: 'sport', angle: -Math.PI / 2, speed: 0 } }); }

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
  // 이중문까지 걸어서 → 야외
  const room = hub.room;
  const me = await page.evaluate(() => ({ x: window.NSM.scene.me.x, y: window.NSM.scene.me.y }));
  const dirs = pathTo(room, Math.floor(me.x / T), Math.floor((me.y - 1) / T), (x, y) => x === 22 && y === 24);
  await walk(page, dirs);
  await page.keyboard.down('ArrowDown'); // 문 타일(22,25)을 밟으면 서버가 야외로 옮기고 씬이 바뀐다 (헤드리스는 프레임이 낮아 될 때까지 누른다)
  await page.waitForFunction(() => window.NSM.scene.transferring || window.NSM.net.room === 'outdoor', { timeout: 20000, polling: 100 });
  await page.keyboard.up('ArrowDown');
  await page.waitForFunction(() => window.NSM.net.room === 'outdoor' && window.NSM.scene.room.id === 'outdoor' && window.NSM.scene.me, { timeout: 30000 });
  await sleep(600);

  // 1) 전체 맵 (낮, 카메라 축소)
  await page.evaluate(() => { const s = window.NSM.scene; s.setClockOverride(13); s.cameras.main.stopFollow(); s.cameras.main.setZoom(0.55); s.cameras.main.centerOn(s.mapW / 2, s.mapH / 2); });
  await sleep(700);
  await shot(page, 's12_outdoor_map.png', { x: 40, y: 0, width: 1420, height: 900 });

  // 2) 트랙 확대 (노을): 출발선 · 관중 벤치 · 전광판 · 정류장 · 탑승한 지우
  await page.evaluate(() => { const s = window.NSM.scene; s.setClockOverride(18); s.cameras.main.setZoom(2); s.cameras.main.centerOn(50 * 32, 31 * 32); });
  await sleep(700);
  await shot(page, 's12_track.png', { x: 0, y: 0, width: 1500, height: 900 });

  // 3) 탑승 화면 (밤): 카트 사서 활성 → V → 조금 달린다 → 랩 HUD
  await page.evaluate(() => { const s = window.NSM.scene; s.setClockOverride(21); s.setZoom(2); s.cameras.main.startFollow(s.me.sprite, true, 0.15, 0.15); });
  await store.adjustCoins('민수', 200, 'test');
  const buy = await page.evaluate(() => window.NSM.net.buy('vehicle_kart', 'red'));
  await page.evaluate((id) => window.NSM.net.vehicleConfig({ active: id, decal: null }), buy.inventory.id);
  const decal = await page.evaluate(() => window.NSM.net.buy('decal_flame'));
  await page.evaluate((id) => window.NSM.net.vehicleConfig({ decal: id }), decal.inventory.id);
  // 출발선 근처로 이동해서 탑승 (서버 위치를 직접 옮기고 클라이언트도 맞춘다)
  const p = hub.outdoor.players.get(await page.evaluate(() => window.NSM.scene.me.id));
  p.x = 49.5 * T; p.y = 36 * T;
  await page.evaluate((x, y) => { window.NSM.scene.me.setPosition(x, y); window.NSM.scene.lastSent = null; }, p.x, p.y);
  await sleep(200);
  await page.keyboard.press('KeyV');
  await page.waitForFunction(() => window.NSM.scene.me.riding, { timeout: 5000 });
  await page.keyboard.down('ArrowUp'); // 방향키 방식: 위로 가속 (출발선을 지나 랩 시작)
  await page.waitForFunction(() => window.NSM.scene.me.y < 30 * 32, { timeout: 15000, polling: 100 }).catch(() => console.log('가속이 느림'));
  await page.keyboard.up('ArrowUp');
  await page.waitForFunction(() => !document.getElementById('lap-hud').hidden, { timeout: 5000 }).catch(() => console.log('랩 HUD 가 뜨지 않음'));
  await sleep(300);
  await shot(page, 's12_riding.png', { x: 0, y: 0, width: 1500, height: 900 });

  // 4) 전광판 모달
  await page.evaluate(() => window.NSM.ui.openBoard());
  await page.waitForFunction(() => document.querySelectorAll('#board-all li').length >= 5, { timeout: 5000 });
  await sleep(300);
  const bbox = await page.$eval('#board-modal .modal-box', (el) => { const r = el.getBoundingClientRect(); return { x: r.x - 12, y: r.y - 12, width: r.width + 24, height: r.height + 24 }; });
  await shot(page, 's12_board.png', bbox);

  for (const b of bots) b.s.close();
  await browser.close();
  await srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
