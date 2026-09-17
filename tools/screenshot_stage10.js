'use strict';
/**
 * 10단계 스크린샷 (puppeteer-core + 로컬 Chrome). 서버를 스스로 띄운다 (STORE=memory).
 *   node tools/screenshot_stage10.js [outDir]
 * 출력:
 *   s10_pets_row.png  — 펫 12종 한 줄 (tools/out/pets_row.png 복사)
 *   s10_deco.png      — 꾸미기 장착 예시: 방 안에서 리본·안경·스카프·왕관·날개·밀짚모자를 단 펫들 확대
 *   s10_room.png      — 방 안에 펫들 (강아지 + 공용 고양이·거북이·물고기 + 개인 펫 여러 마리 + 어깨 위 앵무새)
 */
const path = require('node:path');
const fs = require('node:fs');
const puppeteer = require('puppeteer-core');
const { startServer } = require('../server/index');

process.env.STORE = 'memory';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
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

(async () => {
  const srv = await startServer({ port: 0, log: quiet, world: { study: { autoTick: false } } });
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
    await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('#login:not([hidden])', { timeout: 60000 });
    await page.type('#login-nick', nickname);
    await page.click('#login-submit');
    await page.waitForFunction(() => window.NSM && window.NSM.scene.me, { timeout: 20000 });
    return page;
  };
  const store = srv.world.store;
  const world = srv.world;
  fs.copyFileSync(path.join(__dirname, 'out', 'pets_row.png'), path.join(out, 's10_pets_row.png'));
  console.log('saved', path.join(out, 's10_pets_row.png'));

  // 플레이어 4명: 각자 개인 펫 (꾸미기 포함), 공용 펫 3마리, 강아지 꾸미기
  const pages = [];
  const names = ['민수', '영희', '철수', '지우'];
  for (const n of names) pages.push(await open(n));
  const players = names.map((n) => [...world.players.values()].find((p) => p.nickname === n));
  const give = (nick, itemId, variant = null) => { const it = world.shop.get(itemId); return store.addInventory(nick, itemId, { name: it.name, price: it.price, tab: it.tab, category: it.category, variant }); };
  const setup = [
    ['민수', 'pet_shiba', '콩이', { head: ['deco_crown', null], neck: ['deco_scarf', 'red'] }],
    ['영희', 'pet_rabbit', '토토', { head: ['deco_ribbon', 'pink'], back: ['deco_wings', null] }],
    ['철수', 'pet_parrot', '앵두', { head: ['deco_straw_hat', null] }],
    ['지우', 'pet_slime', '푸딩', { head: ['deco_glasses', null], neck: ['deco_collar', 'blue'] }],
  ];
  for (const [nick, petItem, name, deco] of setup) {
    const p = players.find((x) => x.nickname === nick);
    const pet = await give(nick, petItem);
    const cosmetics = {};
    for (const [slot, [item, variant]] of Object.entries(deco)) cosmetics[slot] = (await give(nick, item, variant)).id;
    await world.setPetConfig(p, { active: pet.id, name, cosmetics });
  }
  const beanie = await give('민수', 'deco_beanie');
  await world.setPetDeco(players[0], 'dog', { head: beanie.id });
  for (const [nick, item, name] of [['민수', 'shared_cat', '치즈'], ['영희', 'shared_turtle', '느림보'], ['철수', 'shared_fish', '금붕']]) {
    const inv = await give(nick, item);
    const r = await world.releasePet(players.find((x) => x.nickname === nick), { inventoryId: inv.id, name });
    if (!r.ok) console.log('release fail', item, r);
  }
  // 위치: 라운지 러그 주변에 모이게 (서버 위치를 직접 옮기고 클라이언트에 보정)
  const spots = [[17, 9], [23, 10], [24, 12], [21, 11]];
  players.forEach((p, i) => { p.x = (spots[i][0] + 0.5) * T; p.y = (spots[i][1] + 1) * T; p.facing = i % 2 ? 'left' : 'right'; });
  for (const [i, pg] of pages.entries()) {
    await pg.evaluate((x, y) => { const s = window.NSM.scene; s.me.setPosition(x, y); s.lastSent = null; s.flushMove(false); }, players[i].x, players[i].y);
  }
  // 강아지·고양이를 러그 근처로 (자연스러운 배치)
  const dog = world.dog; dog.x = 25.5 * T; dog.y = 10 * T; dog.path = []; dog.setState('sit', 60000); dog.dirty = true;
  const cat = [...world.roomPets.values()].find((p) => p.npc.species === 'cat').npc; cat.x = 19.5 * T; cat.y = 7 * T; cat.path = []; cat.setState('sleep', 60000); cat.dirty = true;
  const turtle = [...world.roomPets.values()].find((p) => p.npc.species === 'turtle').npc; turtle.x = 16.5 * T; turtle.y = 10 * T; turtle.path = []; turtle.setState('idle', 60000); turtle.dirty = true;
  await sleep(2500); // 펫들이 주인 옆에 자리 잡는다
  const a = pages[0];
  await a.evaluate(() => { window.NSM.scene.setClockOverride(14); window.NSM.scene.cameras.main.centerOn(21 * 32, 10 * 32); });
  await sleep(600);
  console.log('npcs', await a.evaluate(() => [...window.NSM.scene.npcs.values()].map((n) => [n.id, n.species, n.state, Object.entries(n.deco).filter(([, v]) => v).map(([k, v]) => `${k}:${v.key}`).join(',')])));
  const game = await a.$eval('#game', (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
  await shot(a, 's10_room.png', { x: game.x + game.width / 2 - 420, y: game.y + game.height / 2 - 260, width: 840, height: 520 });
  // 꾸미기 확대: 줌 2.5 로 러그 왼쪽 위(토끼·시바) 근처
  await a.evaluate(() => { window.NSM.scene.setZoom(2.5); window.NSM.scene.cameras.main.centerOn(21.5 * 32, 10.5 * 32); });
  await sleep(500);
  await shot(a, 's10_deco.png', { x: game.x + game.width / 2 - 330, y: game.y + game.height / 2 - 200, width: 660, height: 400 });
  await browser.close();
  await srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
