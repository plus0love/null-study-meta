'use strict';
/**
 * 9단계 스크린샷 (puppeteer-core + 로컬 Chrome). 서버를 먼저 띄운 뒤 실행한다 (STORE=memory 권장 — 코인·가구를 저장소에 직접 넣는다).
 *   node tools/screenshot_stage9.js [baseUrl] [outDir]
 * 출력:
 *   s9_icons.png   — 지갑 가구 탭(책상 소품 12) + 공용 가구 11 카드 (아이콘 23개) — tools/out/furniture_icons.png 도 같이 복사
 *   s9_desk.png    — 설정 → 내 책상 슬롯 3개 장착 + 자리에 앉아 책상 위에 소품이 보이는 컷
 *   s9_edit.png    — 편집 모드: 하단 팔레트 + 미리보기(초록) + 놓인 가구 + 머리 위 🛠
 *   s9_bed.png     — 침대에 누운 컷 (이불 오버레이 + 💤)
 * 서버가 같은 프로세스가 아니므로 코인·인벤토리는 /api 가 아닌 소켓(지갑 구매)으로 만든다: 코인은 서버 쪽 STORE 가 메모리일 때
 * 환경변수 SEED_COINS 로 넣을 수 없으니, 이 스크립트는 상점 구매 대신 서버를 직접 띄운다 (startServer, port 0).
 */
const path = require('node:path');
const fs = require('node:fs');
const puppeteer = require('puppeteer-core');
const { startServer } = require('../server/index');

process.env.STORE = 'memory';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const out = process.argv[3] || path.join(__dirname, '..', 'screenshots');
fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const quiet = { log() {}, warn() {}, error() {} };

async function shot(page, name, clip) {
  const file = path.join(out, name);
  await page.screenshot({ path: file, clip, captureBeyondViewport: false });
  console.log('saved', file);
}

(async () => {
  const srv = await startServer({ port: 0, log: quiet, world: { npc: { autoStart: false }, study: { autoTick: false } } });
  // 11단계: 스터디 하나를 만들고 ?study=CODE 로 로비를 건너뛴다. srv.world = 그 스터디의 월드
  const study = (await srv.hub.createStudy({ name: '검수용 스터디', ownerNickname: '민수' })).study;
  srv.world = await srv.hub.ensureWorld(study.id);
  const base = `http://127.0.0.1:${srv.port}/?study=${study.code}`;
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const open = async (nickname) => {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log(`[${nickname} pageerror]`, e.stack || e.message));
    await page.setViewport({ width: 1500, height: 900, deviceScaleFactor: 1 });
    await page.goto(base, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#login:not([hidden])', { timeout: 20000 });
    await page.type('#login-nick', nickname);
    await page.click('#login-submit');
    await page.waitForFunction(() => window.NSM && window.NSM.scene.me, { timeout: 20000 });
    return page;
  };
  const store = srv.world.store;
  await store.adjustCoins('민수', 500, 'study', Date.now());
  const a = await open('민수');
  const me = [...srv.world.players.values()][0];
  await a.evaluate(() => window.NSM.scene.setClockOverride(20)); // 저녁 조명

  // 1) 지갑 가구 탭 — 책상 소품 12 카드, 공용 가구 11 카드
  await a.click('#btn-wallet');
  await a.waitForFunction(() => window.NSM.ui.wallet && document.querySelectorAll('#wallet-items .wallet-item').length === 12, { timeout: 5000 });
  await sleep(300);
  const box = await a.$eval('#wallet-modal .modal-box', (el) => { const r = el.getBoundingClientRect(); return { x: r.x - 8, y: r.y - 8, width: r.width + 16, height: r.height + 16 }; });
  await shot(a, 's9_icons_desk.png', box);
  await a.click('#wallet-cats button[data-cat="shared"]');
  await a.waitForFunction(() => document.querySelectorAll('#wallet-items .wallet-item').length === 11, { timeout: 5000 });
  await sleep(200);
  await shot(a, 's9_icons_shared.png', box);
  fs.copyFileSync(path.join(__dirname, 'out', 'furniture_icons.png'), path.join(out, 's9_icons.png'));
  console.log('saved', path.join(out, 's9_icons.png'));
  await a.click('#wallet-close');

  // 2) 책상 소품: 서버에서 인벤토리·슬롯을 만들고 설정 팝오버 + 자리에 앉은 컷
  const mug = await store.addInventory('민수', 'mug', { category: 'desk', variant: 'pink' });
  const fish = await store.addInventory('민수', 'fishbowl', { category: 'desk', variant: null });
  const lamp = await store.addInventory('민수', 'desk_lamp', { category: 'desk', variant: 'brass' });
  await srv.world.equipDesk(me, [mug.id, fish.id, lamp.id]);
  await a.waitForFunction(() => window.NSM.scene.me.deskItems[2] && window.NSM.scene.me.deskItems[2].itemId === 'desk_lamp', { timeout: 5000 });
  const seat = srv.world.room.seats.find((s) => s.x === 15 && s.y === 14);
  me.x = 15.5 * 32; me.y = 15 * 32;
  srv.world.sit(me, seat.id);
  srv.io.emit('playerSat', { id: me.id, seatId: me.seatId, x: me.x, y: me.y, facing: me.facing, status: me.status });
  await a.waitForFunction(() => window.NSM.scene.me.deskSprites.length === 3, { timeout: 5000 });
  await a.click('#btn-settings');
  await a.waitForFunction(() => document.querySelectorAll('#desk-slots select').length === 3 && document.querySelectorAll('#desk-slots select')[2].value !== '', { timeout: 5000 });
  await sleep(600);
  await shot(a, 's9_desk.png');
  await a.click('#btn-settings');
  srv.world.stand(me);
  srv.io.emit('playerStood', { id: me.id, status: me.status, x: me.x, y: me.y });
  await sleep(200);

  // 3) 편집 모드: 가구 몇 개 놓고, 침대 미리보기(초록)를 띄운 채로
  const inv = {};
  for (const [id, variant] of [['rug_small', null], ['floor_lamp', null], ['beanbag', null], ['massage_chair', null], ['cushion', 'terra'], ['poster', 'plant'], ['wall_clock', 'cat'], ['blanket', null], ['coffee_upgrade', null], ['bookshelf_fill', null], ['bed', 'blue']]) {
    inv[id] = await store.addInventory('민수', id, { category: 'shared', variant });
  }
  const place = (id, x, y, rotation = 0) => srv.world.placeFurniture(me, { inventoryId: inv[id].id, x, y, rotation });
  console.log('rug', (await place('rug_small', 21, 15)).ok, 'lamp', (await place('floor_lamp', 24, 14)).ok, 'bag', (await place('beanbag', 21, 18)).ok, 'massage', (await place('massage_chair', 23, 18)).ok,
    'cushion', (await place('cushion', 19, 6)).ok, 'poster', (await place('poster', 13, 10)).ok, 'clock', (await place('wall_clock', 18, 10)).ok, 'blanket', (await place('blanket', 20, 6)).ok,
    'coffee', (await place('coffee_upgrade', 6, 13)).ok, 'books', (await place('bookshelf_fill', 35, 3)).ok);
  await a.waitForFunction(() => window.NSM.scene.furniture.entries.size === 10, { timeout: 5000 });
  await a.click('#btn-edit');
  await a.waitForFunction(() => document.querySelectorAll('#edit-palette .palette-item').length === 1, { timeout: 5000 });
  await a.click('#edit-palette .palette-item[data-item="bed"]');
  await a.evaluate(() => window.NSM.scene.furniture.moveTo(22, 12));
  // 카메라를 복도 쪽으로: 내 아바타를 복도로 옮긴다
  me.x = 22.5 * 32; me.y = 21 * 32;
  srv.io.emit('move:correct', { x: me.x, y: me.y, reason: 'shot' });
  await a.evaluate(() => { const s = window.NSM.scene; s.me.setPosition(22.5 * 32, 21 * 32); s.cameras.main.centerOn(22.5 * 32, 15 * 32); });
  await sleep(600);
  await shot(a, 's9_edit.png');
  await a.evaluate(() => window.NSM.scene.confirmPlace());
  await a.waitForFunction(() => window.NSM.scene.furniture.entries.size === 11, { timeout: 5000 });
  await a.click('#edit-close');
  await sleep(200);

  // 4) 침대에 눕기: 두 번째 사람도 들어와 안마의자에 앉는다
  const b = await open('영희');
  const pb = [...srv.world.players.values()].find((p) => p.nickname === '영희');
  const bedEntry = srv.world.listLayout().find((e) => e.itemId === 'bed');
  const massage = srv.world.listLayout().find((e) => e.itemId === 'massage_chair');
  me.x = 22.5 * 32; me.y = 15 * 32;
  srv.world.sit(me, `f:${bedEntry.id}`);
  srv.io.emit('playerSat', { id: me.id, seatId: me.seatId, x: me.x, y: me.y, facing: me.facing, status: me.status });
  pb.x = 23.5 * 32; pb.y = 20 * 32;
  srv.world.sit(pb, `f:${massage.id}`);
  srv.io.emit('playerSat', { id: pb.id, seatId: pb.seatId, x: pb.x, y: pb.y, facing: pb.facing, status: pb.status });
  await a.waitForFunction(() => window.NSM.scene.me.lying && window.NSM.scene.me.zzz, { timeout: 5000 });
  await a.evaluate(() => window.NSM.scene.cameras.main.centerOn(22.5 * 32, 16 * 32));
  await sleep(700);
  const game = await a.$eval('#game', (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
  await shot(a, 's9_bed.png', { x: game.x + game.width / 2 - 320, y: game.y + game.height / 2 - 220, width: 640, height: 440 });
  await b.close();
  await browser.close();
  await srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
