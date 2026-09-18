'use strict';
/**
 * 17단계(2인 스터디룸 안쪽 정리) 스크린샷 (puppeteer-core + 로컬 Chrome). 서버를 스스로 띄운다 (STORE=memory).
 *   node tools/screenshot_stage17.js [outDir] [--only=study,coffee]
 * 출력:
 *   s17_study.png — 2인 스터디룸 확대 (격자 러그 · 아래 벽 소파 코너 · 왼쪽 화이트보드/2단 책장 · 오른쪽 옷걸이/수납장/미니 냉장고 · 슬리퍼/쿠션)
 *                   영희는 책상 의자, 철수는 소파, 나는 문 앞 통로에 서 있다.
 *   s17_coffee.png — 커피 코너 확대 (카운터 오른쪽 x 9..11 통로가 위·아래로 트임 · 원두 선반은 스터디룸 벽에 · 우유 상자·쓰레기통은 구석)
 */
const path = require('node:path');
const fs = require('node:fs');
const puppeteer = require('puppeteer-core');
const { io } = require('socket.io-client');
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

/** 소켓 봇: 스터디에 들어가 (tx, ty) 에 선다 */
async function bot(base, world, nickname, code, tx, ty, facing = 'down') {
  const s = io(base, { transports: ['websocket'], forceNew: true });
  const ask = (ev, p) => new Promise((r) => s.emit(ev, p, r));
  const j = await ask('join', { nickname, study: code });
  if (!j.ok) throw new Error(`bot join ${nickname}: ${j.error}`);
  const p = world.players.get(j.self.id);
  p.x = (tx + 0.5) * T; p.y = (ty + 1) * T; p.facing = facing;
  s.emit('move', { x: p.x, y: p.y, facing, moving: false });
  return { s, ask, id: j.self.id, player: p };
}

(async () => {
  const srv = await startServer({ port: 0, log: quiet, world: { study: { autoTick: false } } });
  const base = `http://127.0.0.1:${srv.port}`;
  const hub = srv.hub;
  const study = (await hub.createStudy({ name: '새벽 코딩방', ownerNickname: '민수' })).study;
  await hub.updateStudy(study.code, '민수', { roomLabel: '새벽팀 ROOM' });
  const world = await hub.ensureWorld(study.id);

  const bots = [];
  const yh = await bot(base, world, '영희', study.code, 23, 15, 'up');
  const cs = await bot(base, world, '철수', study.code, 26, 18, 'down');
  bots.push(yh, cs);
  await yh.ask('goal:set', { text: '알고리즘 3문제', targetMinutes: 120 });
  await yh.ask('sit', { seatId: 'study-b' });
  await cs.ask('sit', { seatId: 'study-sofa-a' });

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ARGS });
  const page = await (await browser.createBrowserContext()).newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.stack || e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text().slice(0, 300)); });
  await page.setViewport({ width: 1500, height: 900, deviceScaleFactor: 1 });
  await page.goto(`${base}/?study=${study.code}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#login:not([hidden])', { timeout: 60000 });
  await page.type('#login-nick', '민수');
  await page.click('#login-submit');
  await page.waitForFunction(() => window.NSM && window.NSM.scene.me && document.getElementById('lobby').hidden, { timeout: 30000 });
  await sleep(600);
  const myId = await page.evaluate(() => window.NSM.scene.me.id);
  const me = world.players.get(myId);
  // 나는 문 앞 통로(문 패널과 왼쪽 램프 사이)에 서서 위를 본다
  me.x = 22.5 * T; me.y = 19 * T; me.facing = 'up'; me.budget = 10000;
  await page.evaluate((x, y) => { const s = window.NSM.scene; s.me.setPosition(x, y); s.me.setFacing('up'); s.lastSent = null; s.correction = null; }, me.x, me.y);
  await page.evaluate(() => window.NSM.ui.setWide(true));
  await sleep(400);
  const view = async (hour, zoom, cx, cy) => {
    await page.evaluate((h, z, x, y) => { const s = window.NSM.scene; s.setClockOverride(h); s.cameras.main.stopFollow(); s.cameras.main.setZoom(z); s.cameras.main.centerOn(x, y); }, hour, zoom, cx, cy);
    await sleep(1000);
  };
  const shot = async (name) => {
    const file = path.join(out, name);
    await page.screenshot({ path: file, clip: { x: 0, y: 0, width: 1500, height: 900 }, captureBeyondViewport: false });
    console.log('saved', file);
  };
  if (want('study')) {
    await view(20, 2, 23 * T, 16 * T);
    await shot('s17_study.png');
  }
  if (want('coffee')) {
    // 커피 코너: 메뉴 보드·카운터·진열장 + 오른쪽 통로(x 9..11)와 스터디룸 벽의 원두 선반까지
    await view(15, 2.2, 8.5 * T, 14 * T);
    await shot('s17_coffee.png');
  }

  await browser.close();
  for (const b of bots) b.s.close();
  await srv.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
