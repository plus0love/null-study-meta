'use strict';
/**
 * 개발용 스크린샷 도구 (puppeteer-core + 로컬 Chrome).
 *   node tools/screenshot.js [baseUrl] [outDir]
 * 출력:
 *   game_spawn.png  — 스폰 위치 1920x1080 게임 화면
 *   game_walk.png   — 방향키로 걸어간 뒤의 화면
 *   game_full.png   — 맵 전체(1472x1088)를 한 장에 (목업 비교용)
 */
const path = require('node:path');
const fs = require('node:fs');
const puppeteer = require('puppeteer-core');

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const base = process.argv[2] || 'http://localhost:3210';
const out = process.argv[3] || path.join(__dirname, '..', 'screenshots');
fs.mkdirSync(out, { recursive: true });

async function waitReady(page) {
  await page.waitForFunction(() => window.NSM && window.NSM.game && window.NSM.game.scene.isActive('room'), { timeout: 20000 });
  await page.waitForFunction(() => document.getElementById('loading').classList.contains('hidden'), { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 800));
}

async function shot(page, name) {
  const file = path.join(out, name);
  await page.screenshot({ path: file });
  console.log('saved', file);
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) console.log(`[console.${m.type()}]`, m.text()); });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  await page.goto(base, { waitUntil: 'networkidle0' });
  await waitReady(page);
  await shot(page, 'game_spawn.png');

  // 걷기: 위로 2.2초, 왼쪽으로 1.5초 → 위치가 바뀌었는지 확인
  const before = await page.evaluate(() => { const s = window.NSM.game.scene.getScene('room'); return { x: s.player.x, y: s.player.y }; });
  await page.keyboard.down('ArrowUp'); await new Promise((r) => setTimeout(r, 2200)); await page.keyboard.up('ArrowUp');
  await page.keyboard.down('ArrowLeft'); await new Promise((r) => setTimeout(r, 1500)); await page.keyboard.up('ArrowLeft');
  await new Promise((r) => setTimeout(r, 300));
  const after = await page.evaluate(() => { const s = window.NSM.game.scene.getScene('room'); return { x: s.player.x, y: s.player.y }; });
  console.log('player moved', before, '->', after);
  await shot(page, 'game_walk.png');

  // 전체 맵: 캔버스를 맵 크기로 바꾸고 카메라를 가운데로
  await page.setViewport({ width: 1472, height: 1088, deviceScaleFactor: 1 });
  await page.evaluate(() => {
    const s = window.NSM.game.scene.getScene('room');
    window.NSM.game.scale.resize(1472, 1088);
    s.cameras.main.stopFollow();
    s.cameras.main.setScroll(0, 0);
  });
  await new Promise((r) => setTimeout(r, 800));
  const canvas = await page.$('canvas');
  await canvas.screenshot({ path: path.join(out, 'game_full.png') });
  console.log('saved', path.join(out, 'game_full.png'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
