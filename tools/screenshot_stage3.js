'use strict';
/**
 * 3단계 검수 스크린샷 (puppeteer-core + 로컬 Chrome). 서버를 먼저 띄운 뒤 실행한다.
 *   node tools/screenshot_stage3.js [baseUrl] [outDir]
 * 출력:
 *   s3_full_night.png    — 맵 전체 (밤, 조명 포함) → compare_mockup.png 의 오른쪽
 *   s3_day.png / s3_sunset.png / s3_night.png — 창가(라운지) 확대, 시각 12시 / 18시 / 22시 고정
 *   s3_study_zoom.png    — 스터디룸 1 확대 (책상에 앉아 모니터 켜짐)
 *   s3_coffee.png        — 커피머신 앞 E (☕ 휴식 상태·힌트)
 *   compare_mockup.png   — design/studyroom.png | s3_full_night.png 나란히 (python tools/compare_mockup.py)
 */
const path = require('node:path');
const fs = require('node:fs');
const puppeteer = require('puppeteer-core');
const { pathTo, feetTile, walk } = require('./lib/walk');

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const base = process.argv[2] || 'http://localhost:3000';
const out = process.argv[3] || path.join(__dirname, '..', 'screenshots');
fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T = 32;

async function shot(page, name, clip) {
  const file = path.join(out, name);
  await page.screenshot({ path: file, clip });
  console.log('saved', file);
}

/** 카메라를 (x, y) 월드 좌표 중심으로 고정 (줌 z) */
const lookAt = (page, x, y, z) => page.evaluate((x, y, z) => {
  const cam = window.NSM.scene.cameras.main;
  cam.stopFollow();
  cam.setZoom(z);
  cam.centerOn(x, y);
}, x, y, z);

const hideHud = (page, on) => page.evaluate((on) => {
  for (const id of ['hud-tl', 'hud-tr', 'hud-bl', 'vignette']) document.getElementById(id).style.display = on ? 'none' : '';
}, on);

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const open = async (nickname, avatar) => {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) console.log(`[${nickname} console.${m.type()}]`, m.text()); });
    page.on('pageerror', (e) => console.log(`[${nickname} pageerror]`, e.message));
    await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
    await page.goto(base, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#login:not([hidden])', { timeout: 20000 });
    await page.type('#login-nick', nickname);
    await page.click(`#login-avatars .swatch[data-i="${avatar}"]`);
    await page.click('#login-submit');
    await page.waitForFunction(() => window.NSM && window.NSM.scene.me, { timeout: 20000 });
    await sleep(600);
    return page;
  };

  const a = await open('민수', 0);
  const room = await a.evaluate(() => window.NSM.room);

  // 1) 낮 / 노을 / 밤 — 창가 확대 (라운지 중심), 시각 고정
  await hideHud(a, true);
  const winCx = room.windows[0].x + room.windows[0].w / 2;
  for (const [name, hour] of [['s3_day.png', 12], ['s3_sunset.png', 18], ['s3_night.png', 22]]) {
    await a.evaluate((h) => window.NSM.scene.setClockOverride(h), hour);
    await lookAt(a, winCx, 7 * T, 2);
    await sleep(700);
    console.log(name, 'phase', await a.evaluate(() => window.NSM.scene.phase));
    await shot(a, name, { x: 0, y: 0, width: 1240, height: 900 });
  }

  // 2) 스터디룸 확대: 스터디룸 1 책상 의자까지 걸어가 E → 모니터 켜짐. 밤으로 고정.
  await a.evaluate(() => window.NSM.scene.setClockOverride(22));
  const desk = room.screens.find((s) => s.kind === 'monitor');
  const seat = room.seats.find((s) => s.id === desk.seatId);
  const cur = await a.evaluate(feetTile);
  const dirs = pathTo(room, cur.tx, cur.ty, (x, y) => Math.hypot((seat.x + 0.5) * T - (x + 0.5) * T, (seat.y + 1) * T - (y + 1) * T) <= 46);
  if (!dirs) throw new Error('스터디룸 책상까지 경로 없음');
  await a.evaluate(() => { const cam = window.NSM.scene.cameras.main; cam.setZoom(2); cam.startFollow(window.NSM.scene.me.sprite, true, 0.15, 0.15); });
  await walk(a, dirs);
  await a.waitForFunction(() => document.getElementById('sit-hint').textContent.includes('앉기') && !window.NSM.scene.me.walking, { timeout: 5000 });
  await a.keyboard.press('KeyE');
  await a.waitForFunction(() => window.NSM.scene.me.seated, { timeout: 5000 });
  await sleep(700);
  console.log('screens', JSON.stringify(await a.evaluate(() => window.NSM.scene.screenStates())));
  const z = room.zones[0];
  await lookAt(a, z.x + z.w / 2, z.y + z.h / 2 - 8, 3);
  await hideHud(a, true);
  await sleep(500);
  await shot(a, 's3_study_zoom.png', { x: 0, y: 0, width: 1240, height: 900 });
  await hideHud(a, false);
  await a.evaluate(() => { const cam = window.NSM.scene.cameras.main; cam.setZoom(2); cam.startFollow(window.NSM.scene.me.sprite, true, 0.15, 0.15); });
  await a.keyboard.press('KeyE'); // 일어나기
  await a.waitForFunction(() => !window.NSM.scene.me.seated, { timeout: 5000 });

  // 3) 커피머신 앞 E → ☕ 휴식 (HUD 포함)
  const coffee = room.interactables.find((i) => i.id === 'coffee');
  const cur2 = await a.evaluate(feetTile);
  const toCoffee = pathTo(room, cur2.tx, cur2.ty, (x, y) => Math.hypot((x + 0.5) * T - coffee.x, (y + 1) * T - coffee.y) <= 20);
  if (!toCoffee) throw new Error('커피머신까지 경로 없음');
  await walk(a, toCoffee);
  await a.waitForFunction(() => document.getElementById('sit-hint').textContent.includes('커피') && !window.NSM.scene.me.walking, { timeout: 5000 });
  await a.keyboard.press('KeyE');
  await a.waitForFunction(() => window.NSM.ui.status === 'coffee', { timeout: 5000 });
  await sleep(600);
  await shot(a, 's3_coffee.png');

  // 4) 전체 맵 (밤) — 목업 비교용. 스테이지를 맵 크기로.
  await a.setViewport({ width: 1472 + 360, height: 1088, deviceScaleFactor: 1 });
  await a.evaluate(() => {
    const s = window.NSM.scene;
    s.cameras.main.stopFollow();
    s.cameras.main.setZoom(1);
    s.cameras.main.setScroll(0, 0);
  });
  await hideHud(a, true);
  await sleep(800);
  const canvas = await a.$('canvas');
  await canvas.screenshot({ path: path.join(out, 's3_full_night.png') });
  console.log('saved', path.join(out, 's3_full_night.png'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
