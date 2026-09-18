'use strict';
/**
 * 15단계 스크린샷 (puppeteer-core + 로컬 Chrome). 서버를 스스로 띄운다 (STORE=memory).
 *   node tools/screenshot_stage15.js [outDir] [--only=map,study,lounge,note,coffee,dday]
 * 출력:
 *   s15_map.png        — 실내 전체 맵 (밤, 비 켬)
 *   s15_study.png      — 2인 스터디룸 확대 (두 사람 착석 · 모니터 켜짐 · 코르크보드 팻말 · 명패 · 책상 위 쪽지/머그)
 *   s15_lounge.png     — 라운지 확대 (담요·잡지·램프·강아지 밥그릇 · 펜던트 빛 웅덩이)
 *   s15_note.png       — 쪽지 남기기 모달 · s15_note_read.png — 앉은 채 쪽지 읽기
 *   s15_coffee.png     — 커피 코너 모달
 *   s15_dday.png       — 설정의 D-day + 칠판 카운트다운 + 당일 하트 폭죽
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

async function shot(page, name, clip) {
  const file = path.join(out, name);
  await page.screenshot({ path: file, clip, captureBeyondViewport: false });
  console.log('saved', file);
}

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
  const store = hub.store;
  const study = (await hub.createStudy({ name: '새벽 코딩방', ownerNickname: '민수' })).study;
  await hub.updateStudy(study.code, '민수', { roomLabel: '새벽팀 ROOM' });
  for (const n of ['민수', '영희', '철수']) await store.adjustCoins(n, 30, 'test');
  const world = await hub.ensureWorld(study.id);
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const plus = (d) => new Date(Date.now() + 9 * 3600 * 1000 + d * 86400000).toISOString().slice(0, 10);

  const bots = [];
  const mk = async (n, tx, ty, f) => { const b = await bot(base, world, n, study.code, tx, ty, f); bots.push(b); return b; };
  const yh = await mk('영희', 23, 15, 'up');
  const cs = await mk('철수', 20, 6, 'down');
  await yh.ask('goal:set', { text: '알고리즘 3문제', targetMinutes: 120 });
  await cs.ask('goal:set', { text: '영어 단어 50개', targetMinutes: 60 });
  await yh.ask('sit', { seatId: 'study-b' });
  await cs.ask('sit', { seatId: 'seat-2' });
  await cs.ask('dday:add', { title: '스터디 100일', date: today, kind: 'anniversary', shared: true });
  await cs.ask('dday:add', { title: '정보처리기사', date: plus(5), kind: 'exam', shared: true });
  await yh.ask('dday:add', { title: '알고리즘 대회', date: plus(23), kind: 'other', shared: true });

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
  const myId = await page.evaluate(() => window.NSM.scene.me.id);
  const me = world.players.get(myId);
  const teleport = async (tx, ty, facing = 'down') => {
    me.x = (tx + 0.5) * T; me.y = (ty + 1) * T; me.facing = facing; me.budget = 10000;
    await page.evaluate((x, y, f) => { const s = window.NSM.scene; s.me.setPosition(x, y); s.me.setFacing(f); s.lastSent = null; s.correction = null; }, me.x, me.y, facing);
    await sleep(200);
  };
  const view = async (hour, zoom, cx, cy) => {
    await page.evaluate((h, z, x, y) => { const s = window.NSM.scene; s.setClockOverride(h); s.cameras.main.stopFollow(); s.cameras.main.setZoom(z); s.cameras.main.centerOn(x, y); }, hour, zoom, cx, cy);
    await sleep(700);
  };
  const follow = async (hour) => {
    await page.evaluate((h) => { const s = window.NSM.scene; s.setClockOverride(h); s.setZoom(2); s.cameras.main.centerOn(s.me.x, s.me.y); s.cameras.main.startFollow(s.me.sprite, true, 0.15, 0.15); }, hour);
    await sleep(500);
  };
  await page.evaluate(() => { const s = window.NSM.scene; s.setRain(true); });

  // 책상 위 소품: 영희 자리에 쪽지(안 읽음) + 철수 자리에 머그 (자리 비어 있을 때 놓은 것처럼)
  await teleport(23, 15, 'up'); // 발 위치가 의자 바로 아래 칸 (좌석 중심까지 32px)
  await page.evaluate(() => window.NSM.net.noteLeave('영희', '오늘도 파이팅! 끝나고 커피 한잔 어때요'));
  await teleport(6, 15, 'up');
  await page.evaluate(() => window.NSM.net.coffeeGift('latte', '영희'));
  await sleep(400);

  if (want('map')) {
    await page.evaluate(() => window.NSM.ui.setWide(true));
    await sleep(300);
    await view(21, 0.62, 23 * T, 15 * T);
    await shot(page, 's15_map.png', { x: 20, y: 0, width: 1460, height: 900 });
  }
  if (want('study')) {
    await teleport(21, 15, 'up');
    await page.evaluate(() => window.NSM.net.sit('study-a'));
    await sleep(500);
    await view(21, 2.2, 22.5 * T, 15.5 * T);
    await shot(page, 's15_study.png', { x: 150, y: 60, width: 1200, height: 780 });
    await page.evaluate(() => window.NSM.net.stand());
    await sleep(300);
  }
  if (want('lounge')) {
    await view(20, 2.2, 21 * T, 6.5 * T);
    await shot(page, 's15_lounge.png', { x: 150, y: 60, width: 1200, height: 780 });
  }
  if (want('note')) {
    await teleport(23, 15, 'up'); // 발 위치가 의자 바로 아래 칸 (좌석 중심까지 32px)
    await follow(20);
    await page.evaluate(() => window.NSM.ui.setWide(false));
    await sleep(300);
    // 영희 자리 앞 E → 자리 선택 → 쪽지 모달
    const yhSocket = yh;
    await yhSocket.ask('stand', {});
    await sleep(300);
    await page.waitForFunction(() => /쪽지/.test(document.getElementById('sit-hint').textContent), { timeout: 5000 }).catch(async () => console.log('쪽지 힌트가 뜨지 않음', JSON.stringify(await page.evaluate(() => { const s = window.NSM.scene; return { hint: document.getElementById('sit-hint').textContent, seated: s.me.seated, near: s.nearSeat && s.nearSeat.id, seatLast: s.seatLast, owners: s.seatOwners, me: [s.me.x, s.me.y], fps: s.game.loop.actualFps }; }))));
    await page.evaluate(() => { window.NSM.scene.toggleSeat(); }); // 반환 Promise(모달 대기)를 기다리지 않게 블록으로
    await page.waitForSelector('#seat-choice-modal:not([hidden])', { timeout: 5000 }).catch(() => console.log('자리 선택 모달이 열리지 않음'));
    await page.click('#seat-choice-note').catch(() => {});
    await page.waitForSelector('#note-modal:not([hidden])', { timeout: 5000 }).catch(() => console.log('쪽지 모달이 열리지 않음'));
    await page.type('#note-text', '오늘도 파이팅! 끝나고 커피 한잔 어때요 ☕').catch(() => {});
    await sleep(300);
    await shot(page, 's15_note.png', { x: 0, y: 0, width: 1500, height: 900 });
    await page.click('#note-cancel').catch(() => {});
    // 영희가 앉으면 책상 위 쪽지 → 영희 시점은 아니지만, 내가 내 자리에서 읽는 장면: 영희가 나에게 쪽지 → 나는 study-a 에 앉아 E
    await teleport(21, 15, 'up');
    await page.evaluate(() => window.NSM.net.sit('study-a'));
    await sleep(300);
    yh.player.x = 21.5 * T; yh.player.y = 16 * T;
    await yh.ask('note:leave', { to: '민수', text: '민수님 오늘도 고마워요. 내일 8시에 봐요!' });
    await page.waitForFunction(() => window.NSM.scene.myNotes > 0, { timeout: 5000 }).catch(() => console.log('쪽지 대기 표시가 없음'));
    await sleep(400);
    await page.evaluate(() => { window.NSM.scene.toggleSeat(); }); // 반환 Promise(모달 대기)를 기다리지 않게 블록으로
    await page.waitForSelector('#note-read-modal:not([hidden])', { timeout: 5000 }).catch(() => console.log('쪽지 읽기 모달이 열리지 않음'));
    await sleep(300);
    await shot(page, 's15_note_read.png', { x: 0, y: 0, width: 1500, height: 900 });
    await page.click('#note-read-close').catch(() => {});
    await page.evaluate(() => window.NSM.net.stand());
    await sleep(200);
  }
  if (want('coffee')) {
    await teleport(6, 15, 'up');
    await follow(20);
    await page.evaluate(() => { window.NSM.scene.toggleSeat(); }); // 반환 Promise(모달 대기)를 기다리지 않게 블록으로
    await page.waitForFunction(() => !document.getElementById('coffee-modal').hidden && document.querySelectorAll('#coffee-menu button').length === 3, { timeout: 5000 }).catch(() => console.log('커피 모달이 열리지 않음'));
    await page.click('#coffee-menu button[data-menu="latte"]').catch(() => {});
    await sleep(300);
    await shot(page, 's15_coffee.png', { x: 0, y: 0, width: 1500, height: 900 });
    await page.click('#coffee-close').catch(() => {});
  }
  if (want('dday')) {
    await teleport(8, 8, 'up');
    await follow(20);
    await page.evaluate(() => { const s = window.NSM.scene; s.celebrate(12000, 'hearts'); s.flashLights(); });
    await page.click('#btn-settings');
    await page.waitForFunction(() => !document.getElementById('pop-settings').hidden && !window.NSM.ui.walletBusy, { timeout: 10000 }).catch(() => {});
    await page.evaluate(() => { const pop = document.getElementById('pop-settings'); const f = document.getElementById('dday-field'); if (pop && f) pop.scrollTop = f.offsetTop - 20; });
    await sleep(900);
    await shot(page, 's15_dday.png', { x: 0, y: 0, width: 1500, height: 900 });
  }

  for (const b of bots) b.s.close();
  await browser.close();
  await srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
