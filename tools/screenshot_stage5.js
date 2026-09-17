'use strict';
/**
 * 5단계 스크린샷 (puppeteer-core + 로컬 Chrome). 서버를 먼저 띄운 뒤 실행한다.
 *   node tools/screenshot_stage5.js [baseUrl] [outDir]
 * 출력:
 *   s5_builder.png       — 입장 화면의 아바타 빌더 (머리 탭)
 *   s5_builder_top.png   — 상의 탭 + 색상 팔레트
 *   s5_settings.png      — 방 안에서 설정 → 아바타 꾸미기 모달
 *   s5_room.png          — 서로 다른 아바타 두 명이 방에 있는 컷
 */
const path = require('node:path');
const fs = require('node:fs');
const puppeteer = require('puppeteer-core');

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const base = process.argv[2] || 'http://localhost:3000';
const out = process.argv[3] || path.join(__dirname, '..', 'screenshots');
fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(page, name, clip) {
  const file = path.join(out, name);
  await page.screenshot({ path: file, clip, captureBeyondViewport: false }); // 뷰포트 밖까지 잡으면 페이지가 리사이즈돼 WebGL 프레임버퍼가 깨질 수 있다
  console.log('saved', file);
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const open = async (nickname) => {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) console.log(`[${nickname} console.${m.type()}]`, m.text()); });
    page.on('pageerror', (e) => console.log(`[${nickname} pageerror]`, e.stack || e.message));
    await page.setViewport({ width: 1500, height: 900, deviceScaleFactor: 1 });
    await page.goto(base, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#login:not([hidden])', { timeout: 20000 });
    await page.type('#login-nick', nickname);
    return page;
  };

  // A: 빌더에서 파츠를 고른 뒤 스크린샷
  const a = await open('민수');
  await a.click('#ab-grid .ab-item:nth-child(6)'); // 단발
  await a.click('#ab-colors .swatch[data-color="pink"]');
  await sleep(300);
  const box = await a.$eval('#login-form', (el) => { const r = el.getBoundingClientRect(); return { x: r.x - 10, y: r.y - 10, width: r.width + 20, height: r.height + 20 }; });
  await shot(a, 's5_builder.png', box);
  await a.click('#ab-tabs button[data-tab="top"]');
  await a.click('#ab-grid .ab-item:nth-child(4)'); // 후드
  await a.click('#ab-colors .swatch[data-color="mint"]');
  await sleep(200);
  await shot(a, 's5_builder_top.png', box);
  await a.click('#ab-tabs button[data-tab="acc"]');
  await a.click('#ab-grid .ab-item:nth-child(2)');
  await a.click('#login-submit');
  await a.waitForFunction(() => window.NSM && window.NSM.scene.me, { timeout: 20000 });

  // B: 랜덤 아바타로 입장
  const b = await open('영희');
  await b.click('#ab-random');
  await sleep(100);
  await b.click('#login-submit');
  await b.waitForFunction(() => window.NSM && window.NSM.scene.me, { timeout: 20000 });
  await a.waitForFunction(() => window.NSM.scene.remotes.size === 1, { timeout: 10000 });
  // B 는 왼쪽으로, A 는 위로 조금 걸어서 둘 다 보이게 (캔버스를 클릭해 포커스를 준다)
  await b.click('#game');
  await b.keyboard.down('ArrowLeft'); await sleep(900); await b.keyboard.up('ArrowLeft');
  await a.click('#game');
  await a.keyboard.down('ArrowUp'); await sleep(700); await a.keyboard.up('ArrowUp');
  await sleep(800);
  console.log('A sees', await a.evaluate(() => [...window.NSM.scene.remotes.values()].map((r) => r.avatar.avatar)));

  // 방 안 설정 → 아바타 꾸미기 모달 (변경이 B 화면에 반영되는지도 확인)
  await a.click('#btn-settings');
  await a.click('#btn-avatar');
  await a.waitForSelector('#avatar-modal:not([hidden])');
  await a.click('#ab-tabs button[data-tab="hair"]');
  await a.click('#ab-grid .ab-item:nth-child(9)'); // 트윈테일
  await sleep(600);
  const idA = await a.evaluate(() => window.NSM.scene.me.id);
  const seenByB = await b.evaluate((id) => window.NSM.scene.remotes.get(id).avatar.avatar.hair, idA);
  console.log('B sees A hair =', seenByB);
  await shot(a, 's5_settings.png');
  await a.click('#avatar-modal-close');
  await sleep(300);
  // 방 컷: 게임 캔버스만 (아바타 주변 확대)
  const game = await a.$eval('#game', (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
  await shot(a, 's5_room.png', { x: game.x + game.width / 2 - 300, y: game.y + game.height / 2 - 200, width: 600, height: 400 });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
