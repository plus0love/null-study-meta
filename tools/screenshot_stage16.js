'use strict';
/**
 * 야외 후속 수정 스크린샷 (puppeteer-core + 로컬 Chrome). 서버를 스스로 띄운다 (STORE=memory).
 *   node tools/screenshot_stage16.js [outDir] [--only=map,south,east,track]
 * 출력:
 *   s16_map_day.png    — 야외 전체 (낮 · 옅은 큰 구름 그림자 · 소품 밀도)
 *   s16_zoo_south.png  — 동물원 아래 띠 확대 (판다·펭귄·플라밍고·만지기 코너 · 두꺼운 울타리 · 큰 안내판 · 1.4배 동물)
 *   s16_zoo_east.png   — 동물원 우측 띠 확대 (기린·코끼리·사자·원숭이)
 *   s16_track.png      — 트랙 안쪽 (연못·오리 · 꽃 군락 · 담요 · 응원 깃발)
 */
const path = require('node:path');
const fs = require('node:fs');
const puppeteer = require('puppeteer-core');
const { startServer } = require('../server/index');

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

(async () => {
  const srv = await startServer({ port: 0, log: quiet, world: { study: { autoTick: false } } });
  const base = `http://127.0.0.1:${srv.port}`;
  const hub = srv.hub;
  const mine = (await hub.createStudy({ name: '새벽 코딩방', ownerNickname: '민수' })).study;

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ARGS });
  const page = await (await browser.createBrowserContext()).newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.stack || e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text().slice(0, 300)); });
  await page.setViewport({ width: 1500, height: 900, deviceScaleFactor: 1 });
  await page.goto(`${base}/?study=${mine.code}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#login:not([hidden])', { timeout: 60000 });
  await page.type('#login-nick', '민수');
  await page.click('#login-submit');
  await page.waitForFunction(() => window.NSM && window.NSM.scene.me && document.getElementById('lobby').hidden, { timeout: 30000 });
  await page.evaluate(() => window.NSM.ui.setWide(true));
  await sleep(300);
  // 소켓으로 문을 지나 야외로 (씬은 세션 ack 로 전환)
  await page.evaluate(() => { window.NSM.net.move({ x: 22.5 * 32, y: 25 * 32, facing: 'down', moving: false }); });
  await sleep(80);
  const ack = await page.evaluate(() => new Promise((res) => { const p = window.NSM.net.door(); if (p && p.then) p.then(res); else res(p); setTimeout(() => res('no-ack'), 5000); }));
  if (!ack || !ack.ok) console.log('door ack', JSON.stringify(ack).slice(0, 200));
  await page.waitForFunction(() => window.NSM.net.room === 'outdoor' && window.NSM.scene.room.id === 'outdoor' && window.NSM.scene.me && window.NSM.scene.ready, { timeout: 60000 })
    .catch(async (e) => { console.log('야외 전환 대기 실패', JSON.stringify(await page.evaluate(() => ({ room: window.NSM.net.room, scene: window.NSM.scene.room && window.NSM.scene.room.id, ready: window.NSM.scene.ready })))); throw e; });
  await sleep(800);
  const view = async (hour, zoom, cx, cy) => {
    await page.evaluate((h, z, x, y) => { const s = window.NSM.scene; s.setClockOverride(h); s.cameras.main.stopFollow(); s.cameras.main.setZoom(z); s.cameras.main.centerOn(x, y); }, hour, zoom, cx, cy);
    await sleep(900);
  };
  const W = hub.outdoor.room.width * T;
  const H = hub.outdoor.room.height * T;

  if (want('map')) {
    await view(13, 0.44, W / 2, H / 2);
    await shot(page, 's16_map_day.png', { x: 40, y: 0, width: 1420, height: 900 });
  }
  if (want('south')) {
    await view(14, 1.5, 33 * T, 57 * T);
    await shot(page, 's16_zoo_south.png', { x: 0, y: 0, width: 1500, height: 900 });
  }
  if (want('east')) {
    await view(14, 1.4, 90 * T, 33 * T);
    await shot(page, 's16_zoo_east.png', { x: 0, y: 0, width: 1500, height: 900 });
  }
  if (want('track')) {
    await view(15, 1.4, 63.5 * T, 30.5 * T);
    await shot(page, 's16_track.png', { x: 0, y: 0, width: 1500, height: 900 });
  }

  await browser.close();
  await srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
