'use strict';
/**
 * 헤드리스 브라우저 2탭 E2E (puppeteer-core + 로컬 Chrome).
 *  - 탭 A 는 서버에 직접, 탭 B 는 300ms 지연 프록시를 거쳐 접속한다.
 *  - 입장 → 서로의 아바타 표시 → 키보드 이동(서버 거부 없음, 상대 화면에 같은 위치) → 채팅 → E키 착석 → 재접속.
 * Chrome 이 없으면 건너뛴다 (CHROME_PATH 로 지정 가능).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { boot, sleep, startDelayProxy } = require('./helpers');
const { getStudyRoom } = require('../server/rooms/studyroom');
const { pathTo, feetTile, walk } = require('../tools/lib/walk');

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const hasChrome = fs.existsSync(CHROME);
let puppeteer = null;
try { puppeteer = require('puppeteer-core'); } catch (_) { /* devDependency 없음 */ }

const room = getStudyRoom();
const T = room.tileSize;
const selfPos = () => ({ x: window.NSM.scene.me.x, y: window.NSM.scene.me.y, corrections: window.NSM.net.corrections });
const remotePos = (id) => {
  const r = window.NSM.scene.remotes.get(id);
  return r ? { x: r.avatar.x, y: r.avatar.y, seated: r.avatar.seated, walking: r.avatar.walking } : null;
};

test('브라우저 2탭 (B 는 300ms 지연): 입장·이동 유지·채팅·착석·재접속', { skip: !hasChrome || !puppeteer ? 'Chrome/puppeteer-core 없음' : false, timeout: 120000 }, async (t) => {
  const srv = await boot({ world: { graceMs: 5000 } });
  t.after(() => srv.close());
  const proxy = await startDelayProxy(srv.port, 300);
  t.after(() => proxy.close());

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  t.after(() => browser.close());

  const errors = [];
  const open = async (port, nickname) => {
    const ctx = await browser.createBrowserContext(); // 탭마다 별도 localStorage
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${nickname}: ${e.message}`));
    await page.setViewport({ width: 1100, height: 700 });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle0', timeout: 60000 });
    await page.waitForSelector('#login:not([hidden])', { timeout: 30000 });
    await page.type('#login-nick', nickname);
    await page.click('#login-submit');
    await page.waitForFunction(() => window.NSM && window.NSM.scene.me, { timeout: 30000 });
    await page.evaluate(() => { window.__corrections = []; window.NSM.net.on('move:correct', (d) => window.__corrections.push({ ...d, t: Date.now() % 100000 })); });
    return page;
  };

  const a = await open(srv.port, '브라우저A');
  const b = await open(proxy.port, '브라우저B');
  const idA = await a.evaluate(() => window.NSM.scene.me.id);
  const idB = await b.evaluate(() => window.NSM.scene.me.id);
  assert.notEqual(idA, idB);

  // 서로 보인다 (B 는 지연이 있으므로 잠시 대기)
  await a.waitForFunction((id) => window.NSM.scene.remotes.has(id), { timeout: 5000 }, idB);
  await b.waitForFunction((id) => window.NSM.scene.remotes.has(id), { timeout: 5000 }, idA);
  assert.equal(await a.$eval('#room-count span', (el) => el.textContent), '2');
  assert.match(await a.$eval('#members-list', (el) => el.textContent), /브라우저B/);
  assert.match(await b.$eval('#members-list', (el) => el.textContent), /브라우저A/);
  assert.match(await a.$eval('#chat-log', (el) => el.textContent), /브라우저B 님이 입장했어요/);

  // A: 위로 4칸, 오른쪽 1칸 (키 입력). 서버 거부 없이 B 화면에 같은 위치
  const before = await a.evaluate(selfPos);
  await walk(a, ['up', 'up', 'up', 'up', 'right']);
  await sleep(900); // 20Hz 전송 + 300ms 지연 + 100ms 보간 지연이 가라앉을 때까지
  const afterA = await a.evaluate(selfPos);
  assert.ok(before.y - afterA.y > 100, `A 가 위로 이동했어야 함 (${before.y} → ${afterA.y})`);
  assert.ok(afterA.x - before.x > 20, `A 가 오른쪽으로 이동했어야 함 (${before.x} → ${afterA.x})`);
  assert.equal(afterA.corrections, 0, 'A 의 이동이 서버에서 거부되지 않아야 함');
  const seenA = await b.evaluate(remotePos, idA);
  assert.ok(Math.abs(seenA.x - afterA.x) < 2 && Math.abs(seenA.y - afterA.y) < 2, `B 가 보는 A 위치 ${JSON.stringify(seenA)} vs 실제 ${JSON.stringify(afterA)}`);
  assert.equal(seenA.walking, false);

  // B(지연 300ms): 위로 2칸. 거부 없이 A 화면에 같은 위치
  const beforeB = await b.evaluate(selfPos);
  await walk(b, ['up', 'up']);
  await sleep(900);
  const afterB = await b.evaluate(selfPos);
  assert.ok(beforeB.y - afterB.y > 40);
  assert.equal(afterB.corrections, 0, 'B 의 이동이 서버에서 거부되지 않아야 함');
  const seenB = await a.evaluate(remotePos, idB);
  assert.ok(Math.abs(seenB.x - afterB.x) < 2 && Math.abs(seenB.y - afterB.y) < 2, `A 가 보는 B 위치 ${JSON.stringify(seenB)} vs 실제 ${JSON.stringify(afterB)}`);

  // 순간이동은 거부되고 부드럽게 되돌아온다
  await a.evaluate(() => { const s = window.NSM.scene; s.me.setPosition(s.me.x + 300, s.me.y); });
  await a.waitForFunction(() => window.NSM.net.corrections > 0, { timeout: 3000 });
  await a.waitForFunction((x) => Math.abs(window.NSM.scene.me.x - x) < 1, { timeout: 3000 }, afterA.x);
  await sleep(200);
  const corrAfterTeleport = await a.evaluate(() => window.NSM.net.corrections); // 수렴 중 몇 번 더 거부될 수 있다

  // 채팅: Enter → 입력 → Enter. 입력 중엔 방향키가 이동시키지 않는다
  await a.keyboard.press('Enter');
  assert.equal(await a.evaluate(() => document.activeElement.id), 'chat-input');
  await a.keyboard.type('안녕 <b>B</b>!');
  await a.keyboard.down('ArrowDown');
  await sleep(250);
  await a.keyboard.up('ArrowDown');
  assert.ok(Math.abs((await a.evaluate(selfPos)).y - afterA.y) < 1, '채팅 입력 중엔 이동하지 않아야 함');
  await a.keyboard.press('Enter');
  await b.waitForFunction(() => /안녕 <b>B<\/b>!/.test(document.getElementById('chat-log').textContent), { timeout: 5000 });
  assert.equal(await b.$eval('#chat-log', (el) => el.querySelector('b')), null, 'HTML 이 태그로 렌더되면 안 됨');
  assert.ok(await b.evaluate((id) => Boolean(window.NSM.scene.remotes.get(id).avatar.chatBubble), idA), 'B 화면에 A 의 말풍선');
  await a.keyboard.press('Escape');
  assert.notEqual(await a.evaluate(() => document.activeElement.id), 'chat-input');

  // 이모지 (숫자키 2)
  await a.keyboard.press('Digit2');
  await b.waitForFunction((id) => Boolean(window.NSM.scene.remotes.get(id).avatar.emojiText), { timeout: 5000 }, idA);

  // 착석: A 가 소파 옆까지 걸어가서 E
  const seat = room.seats.find((s) => s.kind === 'sofa_wide');
  const cur = await a.evaluate(feetTile);
  const dirs = pathTo(room, cur.tx, cur.ty, (x, y) => Math.hypot((seat.x + 0.5) * T - (x + 0.5) * T, (seat.y + 1) * T - (y + 1) * T) <= 46);
  assert.ok(dirs && dirs.length, '소파까지 경로가 있어야 함');
  await walk(a, dirs);
  await a.waitForFunction(() => !document.getElementById('sit-hint').hidden && !window.NSM.scene.me.walking, { timeout: 3000 });
  await a.keyboard.press('KeyE');
  await a.waitForFunction(() => window.NSM.scene.me.seated, { timeout: 5000 });
  assert.equal(await a.evaluate(() => window.NSM.ui.status), 'study');
  assert.equal(await a.evaluate(() => window.NSM.net.corrections), corrAfterTeleport, `걷기·착석 중에는 추가 거부가 없어야 함: ${JSON.stringify(await a.evaluate(() => window.__corrections))}`);
  await b.waitForFunction((id) => window.NSM.scene.remotes.get(id).avatar.seated, { timeout: 5000 }, idA);
  const seatedPos = await a.evaluate(selfPos);
  const seatedSeen = await b.evaluate(remotePos, idA);
  assert.deepEqual({ x: seatedSeen.x, y: seatedSeen.y }, { x: seatedPos.x, y: seatedPos.y });
  assert.match(await b.$eval('#members-list', (el) => el.textContent), /브라우저A.*공부 중/s);
  // 일어나기 → 이전 상태(휴식) 복귀
  await a.keyboard.press('KeyE');
  await a.waitForFunction(() => !window.NSM.scene.me.seated, { timeout: 5000 });
  assert.equal(await a.evaluate(() => window.NSM.ui.status), 'rest');

  // 강아지 NPC: 두 탭에 같은 이름·상태로 보인다. 쿠션에서 자게 고정한 뒤 옆까지 걸어가 E → ❤️ + 시스템 채팅
  const dog = srv.world.dog;
  dog.path = [];
  dog.x = (24 + 0.5) * T;
  dog.y = (9 + 1) * T;
  dog.setState('sleep', 60000);
  await b.waitForFunction(() => { const n = window.NSM.scene.npcs.get('dog'); return n && n.state === 'sleep'; }, { timeout: 5000 });
  assert.equal(await a.evaluate(() => window.NSM.scene.npcs.get('dog').name), '사랑');
  assert.equal(await b.evaluate(() => window.NSM.scene.npcs.get('dog').name), '사랑');
  const cur2 = await a.evaluate(feetTile);
  const toDog = pathTo(room, cur2.tx, cur2.ty, (x, y) => Math.hypot((x + 0.5) * T - dog.x, (y + 1) * T - dog.y) <= 40);
  assert.ok(toDog && toDog.length, '강아지까지 경로가 있어야 함');
  await walk(a, toDog);
  await a.waitForFunction(() => document.getElementById('sit-hint').textContent.includes('쓰다듬기'), { timeout: 3000 });
  assert.equal(dog.state, 'look', '가까이 가면 쳐다본다');
  await a.keyboard.press('KeyE');
  await b.waitForFunction(() => Boolean(window.NSM.scene.npcs.get('dog').heart), { timeout: 5000 });
  await b.waitForFunction(() => /브라우저A님이 강아지를 쓰다듬었어요/.test(document.getElementById('chat-log').textContent), { timeout: 5000 });
  const dogA = await a.evaluate(() => { const n = window.NSM.scene.npcs.get('dog'); return { x: n.x, y: n.y, state: n.state }; });
  const dogB = await b.evaluate(() => { const n = window.NSM.scene.npcs.get('dog'); return { x: n.x, y: n.y, state: n.state }; });
  assert.deepEqual(dogA, dogB, '두 탭이 같은 강아지 위치/상태');

  // 재접속: B 의 소켓을 강제로 끊으면 배너가 뜨고, 같은 토큰으로 이어받아 A 화면에서 사라지지 않는다
  const tokenB = await b.evaluate(() => localStorage.getItem('nsm.token'));
  assert.ok(tokenB);
  await b.evaluate(() => window.NSM.net.socket.io.engine.close());
  await b.waitForFunction(() => !document.getElementById('banner-offline').hidden, { timeout: 5000 });
  await b.waitForFunction(() => document.getElementById('banner-offline').hidden && window.NSM.net.connected, { timeout: 15000 });
  assert.equal(await b.evaluate(() => window.NSM.scene.me.id), idB, '같은 플레이어를 이어받아야 함');
  assert.equal(await b.evaluate(() => localStorage.getItem('nsm.token')), tokenB);
  assert.ok(await a.evaluate((id) => window.NSM.scene.remotes.has(id), idB), 'A 화면에 B 가 남아 있어야 함');
  assert.doesNotMatch(await a.$eval('#chat-log', (el) => el.textContent), /브라우저B 님이 나갔어요/);

  // 나가기 → A 화면에서 사라지고 인원 1
  a.once('dialog', (d) => d.accept());
  await a.click('#btn-leave');
  await b.waitForFunction((id) => !window.NSM.scene.remotes.has(id), { timeout: 5000 }, idA);
  assert.equal(await b.$eval('#room-count span', (el) => el.textContent), '1');
  await a.waitForSelector('#login:not([hidden])', { timeout: 5000 });

  assert.deepEqual(errors, []);
});
