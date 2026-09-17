'use strict';
/**
 * 11단계 스크린샷 (puppeteer-core + 로컬 Chrome). 서버를 스스로 띄운다 (STORE=memory).
 *   node tools/screenshot_stage11.js [outDir]
 * 출력:
 *   s11_lobby.png    — 로비: 내 스터디 카드(접속/정원·🔒·이번 주·스트릭·목표 바) + 다른 스터디 목록
 *   s11_create.png   — 스터디 만들기 모달
 *   s11_locked.png   — 링크로 들어온 잠긴 스터디의 비밀번호 모달 (틀린 뒤 남은 횟수)
 *   s11_goal.png     — 그룹 목표 달성 연출: 창밖 불꽃놀이 + 토스트 + 시스템 채팅 + 스터디 정보 팝오버(달성 🎆)
 */
const path = require('node:path');
const fs = require('node:fs');
const puppeteer = require('puppeteer-core');
const { startServer } = require('../server/index');

process.env.STORE = 'memory';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ARGS = ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'];
const out = process.argv[2] || path.join(__dirname, '..', 'screenshots');
fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const quiet = { log() {}, warn() {}, error() {} };
const DAY = 24 * 3600 * 1000;

async function shot(page, name, clip) {
  const file = path.join(out, name);
  await page.screenshot({ path: file, clip, captureBeyondViewport: false });
  console.log('saved', file);
}

(async () => {
  const srv = await startServer({ port: 0, log: quiet, world: { study: { autoTick: false } } });
  const base = `http://127.0.0.1:${srv.port}`;
  const hub = srv.hub;
  const store = hub.store;
  // 스터디 몇 개 + 기록 (로비 카드가 그럴듯하게)
  const created = await hub.createStudy({ name: '새벽 코딩방', password: 'abcd', ownerNickname: '민수', weeklyGoalMinutes: 20 * 60 });
  const mine = created.study;
  const algo = (await hub.createStudy({ name: '알고리즘 스터디', ownerNickname: '영희', maxPlayers: 6, weeklyGoalMinutes: 10 * 60 })).study;
  await store.upsertMember(algo.id, '민수');
  await hub.createStudy({ name: '토익 900 도전', password: 'toeic', ownerNickname: '철수' });
  await hub.createStudy({ name: '공무원 시험 준비', ownerNickname: '지우', weeklyGoalMinutes: 40 * 60 });
  await hub.createStudy({ name: '디자인 포트폴리오', ownerNickname: '하늘' });
  const now = Date.now();
  const add = (n, h, daysAgo) => store.saveSession({ nickname: n, startedAt: now - daysAgo * DAY - h * 3600 * 1000, endedAt: now - daysAgo * DAY, seconds: h * 3600 });
  await add('민수', 3, 0); await add('영희', 4, 1); await add('철수', 2, 0); await add('지우', 6, 1); await add('하늘', 1, 0);
  for (const [n, d] of [['민수', 0], ['민수', 1], ['영희', 2], ['영희', 3], ['영희', 4]]) await store.recordAttendance(n, new Date(now - d * DAY).toISOString().slice(0, 10));
  // 알고리즘 스터디에 접속자 2명 (카드에 2/6)
  const { io } = require('socket.io-client');
  const bots = [];
  for (const n of ['영희', '보라']) {
    const s = io(base, { transports: ['websocket'], forceNew: true });
    await new Promise((r) => s.emit('join', { nickname: n, study: algo.code }, r));
    bots.push(s);
  }

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ARGS });
  const open = async () => {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('[pageerror]', e.stack || e.message));
    await page.setViewport({ width: 1500, height: 900, deviceScaleFactor: 1 });
    return page;
  };

  // 1) 로비
  const a = await open();
  await a.goto(base, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await a.waitForSelector('#login:not([hidden])', { timeout: 60000 });
  await a.evaluate((code, tok) => localStorage.setItem(`nsm.study.access.${code}`, tok), mine.code, created.access); // 민수의 기기 = 스터디를 만든 기기 (접근 토큰 보유)
  await a.type('#login-nick', '민수');
  await a.click('#login-submit');
  await a.waitForSelector('#lobby:not([hidden])', { timeout: 20000 });
  await a.waitForFunction(() => document.querySelectorAll('#lobby-mine .study-card').length === 2, { timeout: 10000 });
  await sleep(400);
  const box = await a.$eval('#lobby .modal-box', (el) => { const r = el.getBoundingClientRect(); return { x: r.x - 12, y: r.y - 12, width: r.width + 24, height: r.height + 24 }; });
  await shot(a, 's11_lobby.png', box);

  // 2) 만들기 모달
  await a.click('#lobby-create');
  await a.waitForSelector('#study-create:not([hidden])');
  await a.type('#sc-name', '밤샘 논문 읽기');
  await a.type('#sc-pass', 'paper1');
  await a.$eval('#sc-goal', (el) => { el.value = '15'; });
  await sleep(300);
  const cbox = await a.$eval('#study-create .modal-box', (el) => { const r = el.getBoundingClientRect(); return { x: r.x - 12, y: r.y - 12, width: r.width + 24, height: r.height + 24 }; });
  await shot(a, 's11_create.png', cbox);
  await a.click('#sc-cancel');

  // 3) 잠긴 스터디: 다른 탭이 링크로 → 비밀번호 틀림 → 모달
  const b = await open();
  await b.goto(`${base}/?study=${mine.code}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await b.waitForSelector('#login:not([hidden])', { timeout: 60000 });
  await b.type('#login-nick', '영수');
  await b.click('#login-submit');
  await b.waitForSelector('#study-pass:not([hidden])', { timeout: 20000 });
  await b.type('#sp-pass', 'nope');
  await b.click('#sp-submit');
  await b.waitForFunction(() => !document.getElementById('sp-error').hidden, { timeout: 10000 });
  await b.type('#sp-pass', 'abc');
  await sleep(300);
  const pbox = await b.$eval('#study-pass .modal-box', (el) => { const r = el.getBoundingClientRect(); return { x: r.x - 12, y: r.y - 12, width: r.width + 24, height: r.height + 24 }; });
  await shot(b, 's11_locked.png', pbox);
  await b.$eval('#sp-pass', (el) => { el.value = ''; });
  await b.type('#sp-pass', 'abcd');
  await b.click('#sp-submit');
  await b.waitForFunction(() => window.NSM && window.NSM.scene.me, { timeout: 30000 });

  // 4) 목표 달성 연출: 민수도 카드로 입장 → 서버가 세션을 넣고 검사 → 불꽃놀이 + 토스트 + 팝오버
  await a.click(`#lobby-mine .study-card[data-code="${mine.code}"]`);
  await a.waitForFunction(() => window.NSM && window.NSM.scene.me && document.getElementById('lobby').hidden, { timeout: 30000 });
  await a.evaluate(() => { window.NSM.scene.setClockOverride(21); window.NSM.scene.setZoom(2); });
  await sleep(800);
  // 카메라를 창문 쪽(라운지 위)으로, 팝오버를 먼저 열어 두고(달성 때 자동 갱신) 목표를 채운다
  const win = (srv.hub.room.windows || [])[0];
  if (win) await a.evaluate((w) => { window.NSM.scene.cameras.main.stopFollow(); window.NSM.scene.cameras.main.centerOn(w.x + w.w / 2, w.y + w.h / 2 + 120); }, win);
  await a.click('#room-name');
  await a.waitForFunction(() => document.getElementById('study-members').children.length > 0, { timeout: 5000 });
  await store.saveSession({ nickname: '영수', startedAt: now - 18 * 3600 * 1000, endedAt: now - 1000, seconds: 17 * 3600 });
  hub.study.statsCache = null;
  const e = await hub.worlds.get(mine.id).checkWeeklyGoal();
  if (!e) console.log('목표 달성이 안 됐습니다', await hub.worlds.get(mine.id).weeklyProgress());
  await a.waitForFunction(() => window.NSM.scene.celebrating, { timeout: 5000 });
  await a.waitForFunction(() => /달성/.test(document.getElementById('study-week-text').textContent), { timeout: 5000 });
  await sleep(1300); // 불꽃이 몇 개 터지고 토스트가 떠 있을 때
  await shot(a, 's11_goal.png', { x: 0, y: 0, width: 1140, height: 640 });

  for (const s of bots) s.close();
  await browser.close();
  await srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
