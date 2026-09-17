'use strict';
/**
 * 6단계: 방 비밀번호 게이트.
 *  - 단위: 비활성 통과, 빈 값, 틀림/맞음, 5회 → 잠금, 시간 경과 후 해제, 성공 시 카운터 초기화, IP 분리, 로그에 평문 없음.
 *  - 서버 E2E: /api/config, join 거부 코드, 정상 입장, 살아 있는 토큰 재접속은 비밀번호 없이, 로그에 평문 없음.
 *  - 브라우저: 비밀번호 칸 표시 → 틀림 에러 → 맞음 입장 → localStorage 기억 → 새 탭 자동 입장. Chrome 없으면 건너뜀.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createGate, clientKey, PASSWORD_MAX } = require('../server/gate');
const { boot, connect, joinAs, ask, sleep } = require('./helpers');

const SECRET = 'study-room-2026!';

/** 로그를 모아 두는 로거 (평문이 찍히지 않는지 검사용) */
function memLog() {
  const lines = [];
  const push = (...a) => lines.push(a.map(String).join(' '));
  return { lines, log: push, warn: push, error: push };
}

test('게이트 단위: 비활성이면 무엇이든 통과', async () => {
  const gate = createGate({ password: '', log: memLog() });
  assert.equal(gate.enabled, false);
  assert.deepEqual(await gate.check('1.1.1.1', undefined), { ok: true });
  assert.deepEqual(await gate.check('1.1.1.1', 'anything'), { ok: true });
  assert.equal(createGate({ password: undefined }).enabled, false);
  assert.equal(createGate({ password: null }).enabled, false);
});

test('게이트 단위: 빈 값·틀림·맞음, 5회 실패 → 30초 잠금 → 해제, 성공 시 초기화', async () => {
  let t = 1_000_000;
  const log = memLog();
  const gate = createGate({ password: SECRET, now: () => t, log });
  assert.equal(gate.enabled, true);

  assert.deepEqual(await gate.check('ip', undefined), { ok: false, error: 'password_required' });
  assert.deepEqual(await gate.check('ip', ''), { ok: false, error: 'password_required' });
  assert.deepEqual(await gate.check('ip', 123), { ok: false, error: 'password_required' });
  assert.equal(gate.size, 0, '빈 값은 실패 횟수에 세지 않음');

  for (let i = 1; i <= 4; i++) {
    const r = await gate.check('ip', `wrong${i}`);
    assert.deepEqual(r, { ok: false, error: 'wrong_password', remaining: 5 - i });
  }
  const locked = await gate.check('ip', 'wrong5');
  assert.deepEqual(locked, { ok: false, error: 'locked', retryAfterMs: 30000 });

  // 잠긴 동안은 맞는 비밀번호도 거부 (해시 계산 없이 즉시)
  t += 10_000;
  const still = await gate.check('ip', SECRET);
  assert.equal(still.error, 'locked');
  assert.equal(still.retryAfterMs, 20000);
  assert.equal(gate.lockedFor('ip'), 20000);

  // 30초가 지나면 풀리고, 맞추면 카운터가 사라진다
  t += 20_000;
  assert.equal(gate.lockedFor('ip'), 0);
  assert.deepEqual(await gate.check('ip', SECRET), { ok: true });
  assert.equal(gate.size, 0);

  // 실패 3번 후 성공 → 다시 5번의 기회
  for (let i = 0; i < 3; i++) await gate.check('ip', 'nope');
  assert.deepEqual(await gate.check('ip', SECRET), { ok: true });
  assert.equal((await gate.check('ip', 'nope')).remaining, 4);

  // 로그 어디에도 비밀번호 평문·후보가 없다
  const joined = log.lines.join('\n');
  assert.ok(joined.length > 0);
  assert.doesNotMatch(joined, /study-room-2026|wrong\d|nope/);
  assert.match(joined, /5회 실패 → 30초 잠금/);
});

test('게이트 단위: IP 마다 따로 세고, 프록시 헤더가 있으면 첫 IP 를 키로 쓴다', async () => {
  const gate = createGate({ password: SECRET, maxFailures: 2, lockMs: 1000, log: memLog() });
  assert.equal((await gate.check('a', 'x')).error, 'wrong_password');
  assert.equal((await gate.check('a', 'x')).error, 'locked');
  assert.deepEqual(await gate.check('b', SECRET), { ok: true }, '다른 IP 는 영향 없음');
  assert.equal((await gate.check('b', 'x')).remaining, 1);

  assert.equal(clientKey({ handshake: { address: '::ffff:10.0.0.1', headers: {} } }), '::ffff:10.0.0.1');
  assert.equal(clientKey({ handshake: { address: '10.0.0.1', headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' } } }), '203.0.113.9');
  assert.equal(clientKey({ handshake: { address: '10.0.0.1', headers: { 'x-forwarded-for': '   ' } } }), '10.0.0.1');
  assert.equal(clientKey({}), 'unknown');
});

test('게이트 단위: 긴 값은 앞 128자만 비교, 유니코드·공백 그대로 비교', async () => {
  const long = 'p'.repeat(PASSWORD_MAX + 50);
  const gate = createGate({ password: long, log: memLog() });
  assert.deepEqual(await gate.check('ip', long), { ok: true });
  assert.deepEqual(await gate.check('ip', 'p'.repeat(PASSWORD_MAX)), { ok: true }, '128자를 넘는 부분은 무시');
  assert.equal((await gate.check('ip', 'p'.repeat(PASSWORD_MAX - 1))).error, 'wrong_password');

  const uni = createGate({ password: '비밀 번호 🔒', log: memLog() });
  assert.deepEqual(await uni.check('ip', '비밀 번호 🔒'), { ok: true });
  assert.equal((await uni.check('ip', '비밀번호 🔒')).error, 'wrong_password');
  assert.equal((await uni.check('ip', '비밀 번호 🔒 ')).error, 'wrong_password');
});

test('게이트 단위: prune 은 잠금이 끝나고 실패도 없는 항목만 지운다', async () => {
  let t = 0;
  const gate = createGate({ password: SECRET, maxFailures: 1, lockMs: 100, now: () => t, log: memLog() });
  await gate.check('a', 'x'); // 잠김
  await gate.check('b', 'x'); // 잠김
  const g2 = createGate({ password: SECRET, maxFailures: 3, lockMs: 100, now: () => t, log: memLog() });
  await g2.check('c', 'x'); // 실패 1
  gate.prune();
  assert.equal(gate.size, 2, '잠금 중이면 남는다');
  t = 200;
  gate.prune();
  assert.equal(gate.size, 0);
  g2.prune();
  assert.equal(g2.size, 1, '실패 횟수가 남아 있으면 유지');
});

test('서버 E2E: ROOM_PASSWORD 없으면 /api/config passwordRequired=false, password 를 보내도 무시', async (t) => {
  const srv = await boot();
  t.after(() => srv.close());
  const cfg = await fetch(`http://127.0.0.1:${srv.port}/api/config`).then((r) => r.json());
  assert.deepEqual(cfg, { passwordRequired: false });
  const s = connect(srv.port);
  t.after(() => s.close());
  const j = await joinAs(s, { nickname: '열린방', password: 'whatever' });
  assert.equal(j.ok, true);
});

test('서버 E2E: 비밀번호 방 — 거부 코드·정상 입장·토큰 재접속·로그에 평문 없음', async (t) => {
  const log = memLog();
  const srv = await boot({ env: { ...process.env, ROOM_PASSWORD: SECRET }, log, gate: { lockMs: 600 }, world: { graceMs: 2000 } });
  t.after(() => srv.close());
  const base = `http://127.0.0.1:${srv.port}`;
  assert.equal(srv.gate.enabled, true);

  const cfg = await fetch(`${base}/api/config`).then((r) => r.json());
  assert.deepEqual(cfg, { passwordRequired: true });
  const cfgText = await fetch(`${base}/api/config`).then((r) => r.text());
  assert.doesNotMatch(cfgText, /study-room/);
  const health = await fetch(`${base}/healthz`).then((r) => r.text());
  assert.doesNotMatch(health, /study-room/);

  const a = connect(srv.port);
  t.after(() => a.close());
  assert.deepEqual(await joinAs(a, { nickname: '민수' }), { ok: false, error: 'password_required' });
  assert.deepEqual(await joinAs(a, { nickname: '민수', password: '' }), { ok: false, error: 'password_required' });
  assert.deepEqual(await joinAs(a, { nickname: '민수', password: 'wrong' }), { ok: false, error: 'wrong_password', remaining: 4 });
  assert.equal(srv.world.connectedCount, 0, '거부된 접속은 월드에 들어가지 않음');

  // 닉네임이 잘못돼도 비밀번호 검사가 먼저 (닉네임 오류로 비밀번호를 시험할 수 없다)
  assert.equal((await joinAs(a, { nickname: '', password: 'wrong' })).error, 'wrong_password');
  // 맞으면 입장 + password 가 플레이어에 남지 않음
  const ja = await joinAs(a, { nickname: '민수', password: SECRET });
  assert.equal(ja.ok, true);
  assert.equal(ja.self.nickname, '민수');
  assert.equal('password' in ja.self, false);
  assert.equal('password' in srv.world.players.get(ja.self.id), false);

  // 다른 접속: 5회 실패 → locked (같은 IP 라 앞선 2회 + 3회)
  const b = connect(srv.port);
  t.after(() => b.close());
  let r;
  for (let i = 0; i < 3; i++) r = await joinAs(b, { nickname: '영희', password: `bad${i}` });
  // a 가 성공했으므로 카운터가 초기화됐고, b 는 3회 실패 상태
  assert.deepEqual(r, { ok: false, error: 'wrong_password', remaining: 2 });
  await joinAs(b, { nickname: '영희', password: 'bad3' });
  r = await joinAs(b, { nickname: '영희', password: 'bad4' });
  assert.equal(r.error, 'locked');
  assert.ok(r.retryAfterMs > 0 && r.retryAfterMs <= 600, `retryAfterMs=${r.retryAfterMs}`);
  // 잠긴 동안은 맞아도 거부
  r = await joinAs(b, { nickname: '영희', password: SECRET });
  assert.equal(r.error, 'locked');
  await sleep(r.retryAfterMs + 50);
  const jb = await joinAs(b, { nickname: '영희', password: SECRET });
  assert.equal(jb.ok, true, '잠금이 풀리면 입장');
  assert.equal(srv.world.connectedCount, 2);

  // 살아 있는 토큰으로 이어받는 재접속은 비밀번호 없이 통과 (유예 중에도)
  a.close();
  await sleep(100);
  const a2 = connect(srv.port);
  t.after(() => a2.close());
  const j2 = await joinAs(a2, { nickname: '민수', token: ja.token });
  assert.equal(j2.ok, true);
  assert.equal(j2.resumed, true);
  assert.equal(j2.self.id, ja.self.id);

  // 죽은 토큰(=서버 재시작 상황)은 다시 비밀번호가 필요
  assert.equal((await ask(a2, 'leave', {})).ok, true);
  const a3 = connect(srv.port);
  t.after(() => a3.close());
  assert.equal((await joinAs(a3, { nickname: '민수', token: ja.token })).error, 'password_required');
  const j3 = await joinAs(a3, { nickname: '민수', token: ja.token, password: SECRET });
  assert.equal(j3.ok, true);
  assert.equal(j3.resumed, false);

  // 서버 로그 어디에도 비밀번호(맞는 것·틀린 것)가 없다
  const joined = log.lines.join('\n');
  assert.match(joined, /password=on/);
  assert.match(joined, /\[gate\] 비밀번호 실패 1\/5/);
  assert.match(joined, /5회 실패 → 1초 잠금/);
  assert.doesNotMatch(joined, /study-room|wrong|bad\d/);
});

// ── 브라우저 ────────────────────────────────────────────────────────
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const hasChrome = fs.existsSync(CHROME);
let puppeteer = null;
try { puppeteer = require('puppeteer-core'); } catch (_) { /* devDependency 없음 */ }

test('브라우저: 비밀번호 칸 → 틀림 에러 → 맞음 입장 → localStorage 기억 → 새 탭 자동 입장', { skip: !hasChrome || !puppeteer ? 'Chrome/puppeteer-core 없음' : false, timeout: 90000 }, async (t) => {
  const srv = await boot({ env: { ...process.env, ROOM_PASSWORD: SECRET }, world: { study: { autoTick: false } } });
  t.after(() => srv.close());
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  t.after(() => browser.close());
  const errors = [];
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewport({ width: 1100, height: 700 });
  await page.goto(`http://127.0.0.1:${srv.port}/`, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForSelector('#login:not([hidden])', { timeout: 30000 });
  assert.equal(await page.$eval('#login-pass-field', (el) => el.hidden), false, '비밀번호 칸이 보인다');
  assert.equal(await page.$eval('#login-pass', (el) => el.type), 'password');

  await page.type('#login-nick', '비번테스트');
  await page.type('#login-pass', 'oops');
  await page.click('#login-submit');
  await page.waitForFunction(() => { const e = document.getElementById('login-error'); return !e.hidden && /틀렸어요/.test(e.textContent); }, { timeout: 10000 });
  assert.match(await page.$eval('#login-error', (el) => el.textContent), /남은 횟수 4회/);
  assert.equal(await page.$eval('#login-pass', (el) => el.value), '', '틀리면 비밀번호 칸을 비운다');
  assert.equal(await page.evaluate(() => localStorage.getItem('nsm.password')), null);

  await page.type('#login-pass', SECRET);
  await page.click('#login-submit');
  await page.waitForFunction(() => window.NSM && window.NSM.scene.me, { timeout: 30000 });
  assert.equal(await page.$eval('#login', (el) => el.hidden), true);
  assert.equal(await page.evaluate(() => localStorage.getItem('nsm.password')), SECRET, '맞춘 값은 기억');
  assert.equal(srv.world.connectedCount, 1);

  // 같은 브라우저 컨텍스트의 새 탭(첫 탭은 닫음): 저장된 토큰+비밀번호로 모달 없이 자동 입장(이어받기)
  await page.close();
  const page2 = await ctx.newPage();
  page2.on('pageerror', (e) => errors.push(e.message));
  await page2.setViewport({ width: 1100, height: 700 });
  await page2.goto(`http://127.0.0.1:${srv.port}/`, { waitUntil: 'networkidle0', timeout: 60000 });
  await page2.waitForFunction(() => window.NSM && window.NSM.scene.me, { timeout: 30000 });
  assert.equal(await page2.$eval('#login', (el) => el.hidden), true, '모달 없이 자동 입장');
  assert.equal(await page2.evaluate(() => window.NSM.net.session.resumed), true);
  assert.deepEqual(errors, []);
});
