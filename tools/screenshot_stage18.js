'use strict';
/**
 * 18단계 스크린샷 (puppeteer-core + 로컬 Chrome). 서버를 스스로 띄운다 (STORE=memory).
 *   node tools/screenshot_stage18.js [outDir] [--only=gate,shop,barista,study,walk]
 * 출력:
 *   s18_gate.png    — 고친 통로: 동물원 위쪽 울타리(y 50)를 지나는 동쪽 세로 산책로(x 88..89)의 2칸 문 + 기둥
 *   s18_shop.png    — 매점 건물 확대 (어닝·창구 점원·메뉴판·파라솔 테이블·의자·쓰레기통·간판 조명)
 *   s18_barista.png — 커피 코너 바리스타 (카운터 뒤, 손님이 앞에 서면 말풍선)
 *   s18_study.png   — 축소된 2인 스터디룸 (문 3개)
 *   s18_walk.png    — 야외 산책 중인 강아지 (나를 따라옴, 이름 옆 ❤️Lv)
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

(async () => {
  const srv = await startServer({ port: 0, log: quiet, world: { study: { autoTick: false } } });
  const base = `http://127.0.0.1:${srv.port}`;
  const hub = srv.hub;
  const study = (await hub.createStudy({ name: '새벽 코딩방', ownerNickname: '민수' })).study;
  const world = await hub.ensureWorld(study.id);

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ARGS });
  const page = await (await browser.createBrowserContext()).newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.stack || e.message));
  await page.setViewport({ width: 1500, height: 900, deviceScaleFactor: 1 });
  await page.goto(`${base}/?study=${study.code}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#login:not([hidden])', { timeout: 60000 });
  await page.type('#login-nick', '민수');
  await page.click('#login-submit');
  await page.waitForFunction(() => window.NSM && window.NSM.scene.me && document.getElementById('lobby').hidden, { timeout: 30000 });
  await sleep(600);
  await page.evaluate(() => window.NSM.ui.setWide(true));
  const myId = await page.evaluate(() => window.NSM.scene.me.id);
  const place = async (w, x, y, facing = 'down') => {
    const me = w.players.get(myId);
    me.x = x; me.y = y; me.facing = facing; me.budget = 10000;
    await page.evaluate((px, py, f) => { const s = window.NSM.scene; s.me.setPosition(px, py); s.me.setFacing(f); s.lastSent = null; s.correction = null; }, x, y, facing);
  };
  const view = async (hour, zoom, cx, cy) => {
    await page.evaluate((h, z, x, y) => { const s = window.NSM.scene; s.setClockOverride(h); s.cameras.main.stopFollow(); s.cameras.main.setZoom(z); s.cameras.main.centerOn(x, y); }, hour, zoom, cx, cy);
    await sleep(900);
  };
  const shot = async (name) => {
    const file = path.join(out, name);
    await page.screenshot({ path: file, clip: { x: 0, y: 0, width: 1500, height: 900 }, captureBeyondViewport: false });
    console.log('saved', file);
  };

  if (want('study')) {
    await place(world, 22.5 * T, 19 * T, 'up');
    await view(20, 2, 22 * T, 16 * T);
    await shot('s18_study.png');
  }
  if (want('barista')) {
    await place(world, 6.5 * T, 16 * T, 'up');
    await sleep(1500); // 바리스타 "뭐 드릴까요?"
    await view(15, 2.4, 7 * T, 13.5 * T);
    await shot('s18_barista.png');
  }
  // 산책 시작 (라운지 강아지 옆)
  const me = world.players.get(myId);
  me.x = world.dog.x + 20; me.y = world.dog.y;
  const started = world.startWalk(me);
  console.log('walk', started.ok);
  // 야외로: 이중문
  await place(world, 22.5 * T, 25 * T + 16);
  await page.evaluate(() => window.NSM.net.door());
  await page.waitForFunction(() => window.NSM.scene.room && window.NSM.scene.room.outdoor && window.NSM.scene.me, { timeout: 20000 });
  await sleep(800);
  const outdoor = hub.outdoor;
  if (want('walk')) {
    await place(outdoor, 30.5 * T, 27 * T, 'down');
    const walker = outdoor.npcById(`dogwalk:${study.id}`);
    if (walker) { walker.x = 29.5 * T; walker.y = 27.5 * T; walker.setState('sit'); walker.dirty = true; }
    await sleep(700);
    await view(11, 2.2, 31 * T, 26 * T);
    await shot('s18_walk.png');
  }
  if (want('gate')) {
    await place(outdoor, 88.5 * T, 49 * T, 'down');
    await view(11, 2.4, 88.5 * T, 50 * T);
    await shot('s18_gate.png');
  }
  if (want('shop')) {
    await place(outdoor, 84 * T, 65 * T, 'up');
    await sleep(1500); // 점원 "어서 오세요!"
    await view(16, 2.4, 86 * T, 63.5 * T);
    await shot('s18_shop.png');
  }

  await browser.close();
  await srv.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
