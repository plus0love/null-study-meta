'use strict';
/**
 * 개발용 스크린샷 도구 (puppeteer-core + 로컬 Chrome). 서버를 먼저 띄운 뒤 실행한다.
 *   node tools/screenshot.js [baseUrl] [outDir]
 * 출력:
 *   game_spawn.png  — 입장 직후 화면 (HUD + 사이드바)
 *   game_multi.png  — 두 명 접속: 이동·채팅 말풍선·이모지
 *   game_seat.png   — 푸프에 앉은 컷
 *   game_full.png   — 맵 전체(1472x1088)를 한 장에 (목업 비교용)
 */
const path = require('node:path');
const fs = require('node:fs');
const puppeteer = require('puppeteer-core');
const { enterRoom } = require('./lib/enter');
const { pathTo, feetTile, walk } = require('./lib/walk');

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const base = process.argv[2] || 'http://localhost:3000';
const out = process.argv[3] || path.join(__dirname, '..', 'screenshots');
fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(page, name) {
  const file = path.join(out, name);
  await page.screenshot({ path: file });
  console.log('saved', file);
}

async function hold(page, key, ms) {
  await page.keyboard.down(key);
  await sleep(ms);
  await page.keyboard.up(key);
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const open = async (nickname, avatar) => {
    const ctx = await browser.createBrowserContext(); // 탭마다 별도 localStorage (세션 토큰)
    const page = await ctx.newPage();
    page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) console.log(`[${nickname} console.${m.type()}]`, m.text()); });
    page.on('pageerror', (e) => console.log(`[${nickname} pageerror]`, e.message));
    await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
    await page.goto(base, { waitUntil: 'networkidle0' });
    await enterRoom(page, { nickname }); // 11단계: 로비가 뜨면 첫 스터디로 (없으면 만든다). avatar 인자는 5단계 빌더 이후 쓰지 않는다
    void avatar;
    await sleep(600);
    return page;
  };

  const a = await open('민수', 0);
  await shot(a, 'game_spawn.png');

  const b = await open('영희', 1);
  // A: 위로 걷고, B: 왼쪽으로 조금 이동 → 채팅/이모지
  await hold(a, 'ArrowUp', 1600);
  await hold(b, 'ArrowLeft', 500);
  await a.keyboard.press('Enter');
  await a.keyboard.type('오늘도 화이팅!');
  await a.keyboard.press('Enter');
  await a.keyboard.press('Escape');
  await b.keyboard.press('Digit4');
  await sleep(500);
  const fps = await a.evaluate(() => Math.round(window.NSM.game.loop.actualFps));
  console.log('players', await a.evaluate(() => 1 + window.NSM.scene.remotes.size), `(headless fps ${fps})`);
  await shot(a, 'game_multi.png');

  // 푸프에 앉기: 스폰에서 푸프 옆까지 한 타일씩 걸어간 뒤 E (소파는 강아지가 옆에 있으면 E 가 쓰다듬기가 되므로 피한다)
  const room = await a.evaluate(() => window.NSM.room);
  const seat = room.seats.find((s) => s.kind === 'pouf_cream');
  const cur = await a.evaluate(feetTile);
  const dirs = pathTo(room, cur.tx, cur.ty, (x, y) => Math.hypot((seat.x + 0.5) * 32 - (x + 0.5) * 32, (seat.y + 1) * 32 - (y + 1) * 32) <= 46);
  await walk(a, dirs);
  await a.waitForFunction(() => document.getElementById('sit-hint').textContent.includes('앉기') && !window.NSM.scene.me.walking, { timeout: 5000 });
  await a.keyboard.press('KeyE');
  try {
    await a.waitForFunction(() => window.NSM.scene.me.seated, { timeout: 5000 });
  } catch (e) {
    console.log('앉기 실패', await a.evaluate(() => ({ x: window.NSM.scene.me.x, y: window.NSM.scene.me.y, near: window.NSM.scene.nearSeat && window.NSM.scene.nearSeat.id, npc: window.NSM.scene.nearNpc && window.NSM.scene.nearNpc.id, hint: document.getElementById('sit-hint').textContent, corr: window.NSM.net.corrections, active: document.activeElement.tagName, kb: window.NSM.scene.input.keyboard.enabled, pending: window.NSM.scene.sitPending })));
    throw e;
  }
  await sleep(500);
  console.log('seated', await a.evaluate(() => window.NSM.scene.me.seated));
  await shot(a, 'game_seat.png');

  // 전체 맵: 스테이지를 맵 크기로 바꾸고 카메라를 가운데로
  await a.setViewport({ width: 1472 + 360, height: 1088, deviceScaleFactor: 1 });
  await a.evaluate(() => {
    const s = window.NSM.scene;
    s.cameras.main.setZoom(1);
    s.cameras.main.stopFollow();
    s.cameras.main.setScroll(0, 0);
    for (const id of ['hud-tl', 'hud-tr', 'hud-bl', 'vignette']) document.getElementById(id).style.display = 'none';
  });
  await sleep(800);
  const canvas = await a.$('canvas');
  await canvas.screenshot({ path: path.join(out, 'game_full.png') });
  console.log('saved', path.join(out, 'game_full.png'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
