'use strict';
/**
 * 헤드리스 브라우저 2탭 E2E (puppeteer-core + 로컬 Chrome).
 *  - 탭 A 는 서버에 직접, 탭 B 는 300ms 지연 프록시를 거쳐 접속한다.
 *  - 입장 → 서로의 아바타 표시 → 키보드 이동(서버 거부 없음, 상대 화면에 같은 위치) → 채팅 → E키 착석 → 강아지 → 재접속.
 *  - 3단계: 책상 착석 시 모니터 켜짐(두 탭 동기화), 커피머신 앞 E → ☕ 휴식, 시간대 고정(낮/노을/밤), 시스템 메시지 ×N 합치기.
 *  - 4단계: localStorage 할 일 → 서버 이전, 오늘 목표 저장 → 상대 화면 팻말, 출석 토스트, 목표 달성 🎉·시스템 채팅, 랭킹 카드(진행 중 점·저장소 배지).
 *  - 5단계: 아바타 꾸미기 모달에서 머리·색 변경 → 상대 화면 즉시 반영, localStorage 저장, 캔버스 텍스처 존재.
 * Chrome 이 없으면 건너뛴다 (CHROME_PATH 로 지정 가능).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { boot, sleep, startDelayProxy, pageUrl, openSettings, CHROME, CHROME_ARGS } = require('./helpers');
const { getStudyRoom } = require('../server/rooms/studyroom');
const { pathTo, feetTile, walk } = require('../tools/lib/walk');

const hasChrome = Boolean(CHROME);
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
  const srv = await boot({ world: { graceMs: 5000, study: { autoTick: false } } });
  t.after(() => srv.close());
  const proxy = await startDelayProxy(srv.port, 300);
  t.after(() => proxy.close());

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: CHROME_ARGS,
  });
  t.after(() => browser.close());

  const errors = [];
  const open = async (port, nickname) => {
    const ctx = await browser.createBrowserContext(); // 탭마다 별도 localStorage
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${nickname}: ${e.message}`));
    await page.setViewport({ width: 1100, height: 700 });
    await page.goto(pageUrl(srv, port), { waitUntil: 'networkidle0', timeout: 60000 }); // 11단계: ?study=CODE 로 로비 없이 기본 스터디로
    // 3단계까지의 localStorage 할 일 → 첫 접속 때 서버로 옮겨지는지 (A 만)
    if (nickname === '브라우저A') await page.evaluate(() => localStorage.setItem('nsm.todos', JSON.stringify([{ id: 'x', text: '옛 할 일', done: false }])));
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
  await a.waitForFunction(() => window.NSM.net.corrections > 0, { timeout: 8000 });
  await a.waitForFunction((x) => Math.abs(window.NSM.scene.me.x - x) < 1, { timeout: 8000 }, afterA.x);
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

  // 5단계 아바타: 설정 → 아바타 꾸미기 모달에서 머리(단발)·색(핑크) 선택 → B 화면의 A 아바타에 즉시 반영 + localStorage 저장
  await openSettings(a);
  await a.click('#btn-avatar');
  await a.waitForSelector('#avatar-modal:not([hidden])');
  await a.click('#ab-tabs button[data-tab="hair"]');
  await a.click('#ab-grid .ab-item[title="단발"]');
  await a.click('#ab-colors .swatch[data-color="pink"]');
  await b.waitForFunction((id) => { const av = window.NSM.scene.remotes.get(id).avatar.avatar; return av.hair === 'bob' && av.hairColor === 'pink'; }, { timeout: 5000 }, idA);
  assert.equal(await a.evaluate(() => JSON.parse(localStorage.getItem('nsm.avatar')).hair), 'bob');
  assert.equal(await a.evaluate(() => window.NSM.scene.me.avatar.hairColor), 'pink');
  assert.ok(await a.evaluate(() => window.NSM.scene.textures.exists(`av:${window.NSM.scene.me.id}`)), '내 아바타 캔버스 텍스처');
  await a.click('#avatar-modal-close');
  await a.waitForSelector('#avatar-modal[hidden]');

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
  await b.waitForFunction(() => /브라우저A님이 사랑을\(를\) 쓰다듬었어요/.test(document.getElementById('chat-log').textContent), { timeout: 5000 });
  const dogA = await a.evaluate(() => { const n = window.NSM.scene.npcs.get('dog'); return { x: n.x, y: n.y, state: n.state }; });
  const dogB = await b.evaluate(() => { const n = window.NSM.scene.npcs.get('dog'); return { x: n.x, y: n.y, state: n.state }; });
  assert.deepEqual(dogA, dogB, '두 탭이 같은 강아지 위치/상태');

  // 3단계 ① 모니터: B 를 서버에서 스터디룸 책상 의자 옆으로 옮겨 앉히면(소켓 sit) 두 탭 모두 그 모니터가 켜지고, 일어나면 꺼진다
  const monitor = room.screens.find((s) => s.kind === 'monitor');
  const deskSeat = room.seats.find((s) => s.id === monitor.seatId);
  const pb = srv.world.players.get(idB);
  pb.x = (deskSeat.x + 0.5) * T;
  pb.y = (deskSeat.y + 1) * T;
  await b.evaluate((x, y) => window.NSM.scene.me.setPosition(x, y), pb.x, pb.y);
  assert.equal((await b.evaluate((id) => window.NSM.net.sit(id), deskSeat.id)).ok, true);
  const screenOn = (seatId) => (page) => page.waitForFunction((id) => { const s = window.NSM.scene.screenStates().find((q) => q.seatId === id); return s && s.on && s.alpha > 0.9; }, { timeout: 5000 }, seatId);
  await screenOn(deskSeat.id)(a);
  await screenOn(deskSeat.id)(b);
  const others = await a.evaluate(() => window.NSM.scene.screenStates().filter((s) => s.on).length);
  assert.equal(others, 1, '앉은 자리의 화면만 켜진다');
  await b.evaluate(() => window.NSM.net.stand());
  await a.waitForFunction((id) => { const s = window.NSM.scene.screenStates().find((q) => q.seatId === id); return s && !s.on && s.alpha < 0.05; }, { timeout: 5000 }, deskSeat.id);

  // 4단계 ① 할 일 이전 + 오늘 목표: A 가 목표를 저장하면 B 화면의 A 팻말에 텍스트가 보이고, B 가 앉은 책상엔 B 의 팻말이 없다(목표 없음)
  await a.waitForFunction(() => /옛 할 일/.test(document.getElementById('todo-list').textContent), { timeout: 5000 });
  assert.equal(await a.evaluate(() => localStorage.getItem('nsm.todos')), null, '이전 뒤 localStorage 는 비운다');
  await a.type('#goal-text', '알고리즘 3문제');
  await a.select('#goal-minutes', '30');
  await a.click('#goal-form button[type=submit]');
  await a.waitForFunction(() => /30분/.test(document.getElementById('goal-progress').textContent), { timeout: 5000 });
  await b.waitForFunction((id) => { const av = window.NSM.scene.remotes.get(id).avatar; return av.goal && av.goal.text === '알고리즘 3문제'; }, { timeout: 5000 }, idA);
  // A 를 서버에서 책상 의자에 앉힌다 (걷기 대신) → 팻말이 두 탭에 보인다
  const deskSeat2 = room.seats.find((q) => q.kind === 'chair_n' && q.id !== deskSeat.id);
  const pa = srv.world.players.get(idA);
  pa.x = (deskSeat2.x + 0.5) * T;
  pa.y = (deskSeat2.y + 1) * T;
  await a.evaluate((x, y) => window.NSM.scene.me.setPosition(x, y), pa.x, pa.y);
  assert.equal((await a.evaluate((id) => window.NSM.net.sit(id), deskSeat2.id)).ok, true);
  await a.waitForFunction(() => window.NSM.scene.me.seated && window.NSM.scene.me.sign, { timeout: 5000 });
  await b.waitForFunction((id) => { const av = window.NSM.scene.remotes.get(id).avatar; return av.seated && av.sign && av.sign.list[1].text === '알고리즘 3문제'; }, { timeout: 5000 }, idA);
  // 세션을 31분 전에 시작한 것으로 돌려 tick → 출석 토스트(A) + 목표 달성 🎉(B 화면의 A) + 시스템 채팅
  srv.world.study.live.get('브라우저A').startedAt -= 31 * 60 * 1000;
  await srv.world.study.tick();
  await a.waitForFunction(() => /1일 연속 출석/.test(document.getElementById('toast').textContent) && !document.getElementById('toast').hidden, { timeout: 5000 });
  await b.waitForFunction((id) => { const av = window.NSM.scene.remotes.get(id).avatar; return av.emojiText && av.emojiText.text === '🎉'; }, { timeout: 5000 }, idA);
  await b.waitForFunction(() => /브라우저A님이 오늘 목표를 달성했어요/.test(document.getElementById('chat-log').textContent), { timeout: 5000 });
  // 일어나면 세션 저장 → leaderboard:refresh → 랭킹 카드에 시간·스트릭, 저장소 배지는 메모리
  await a.evaluate(() => window.NSM.net.stand());
  await a.waitForFunction(() => !window.NSM.scene.me.seated && !window.NSM.scene.me.sign, { timeout: 5000 });
  await b.waitForFunction(() => /브라우저A.*31분/.test(document.getElementById('rank-list').textContent), { timeout: 8000 });
  assert.match(await b.$eval('#rank-list', (el) => el.textContent), /🔥1/);
  assert.match(await b.$eval('#rank-store', (el) => el.textContent), /메모리/);
  assert.match(await a.$eval('#rank-list li.me', (el) => el.textContent), /브라우저A/);
  await a.waitForFunction(() => /31분 \/ 30분 · 달성/.test(document.getElementById('goal-progress').textContent), { timeout: 8000 });

  // 3단계 ② 커피: A 가 커피머신 앞까지 걸어가 E → "☕ 휴식", B 멤버 목록에도 반영. 다시 E → 휴식
  const coffee = room.interactables.find((i) => i.id === 'coffee');
  const cur3 = await a.evaluate(feetTile);
  const toCoffee = pathTo(room, cur3.tx, cur3.ty, (x, y) => Math.hypot((x + 0.5) * T - coffee.x, (y + 1) * T - coffee.y) <= 20);
  assert.ok(toCoffee && toCoffee.length, '커피머신까지 경로가 있어야 함');
  await walk(a, toCoffee);
  await a.waitForFunction(() => document.getElementById('sit-hint').textContent.includes('커피 마시기') && !window.NSM.scene.me.walking, { timeout: 5000 });
  await a.keyboard.press('KeyE');
  await a.waitForFunction(() => window.NSM.ui.status === 'coffee', { timeout: 5000 });
  assert.match(await a.$eval('#btn-status', (el) => el.textContent), /☕ 휴식 중/);
  await b.waitForFunction((id) => window.NSM.scene.remotes.get(id).avatar.status === 'coffee', { timeout: 5000 }, idA);
  assert.match(await b.$eval('#members-list', (el) => el.textContent), /브라우저A.*☕ 휴식 중/s);
  await a.keyboard.press('KeyE');
  await a.waitForFunction(() => window.NSM.ui.status === 'rest', { timeout: 5000 });

  // 3단계 ③ 시간대: 시각을 고정하면 낮/노을/밤 단계와 낮 창문 레이어 알파·어둠 강도가 바뀐다. '항상 밤' 이면 낮에도 밤
  const daylight = async (h) => a.evaluate((h) => {
    const s = window.NSM.scene;
    s.setClockOverride(h);
    return { phase: s.phase, dayAlpha: s.layers.windowDay.alpha, darkness: s.ambient.darkness, stars: s.skies[0].stars.alpha };
  }, h);
  const noon = await daylight(12);
  const dusk = await daylight(18);
  const night = await daylight(23);
  assert.equal(noon.phase, 'day');
  assert.equal(dusk.phase, 'sunset');
  assert.equal(night.phase, 'night');
  assert.ok(noon.dayAlpha === 1 && night.dayAlpha === 0 && dusk.dayAlpha > 0 && dusk.dayAlpha < 1, JSON.stringify({ noon, dusk, night }));
  assert.ok(noon.darkness < dusk.darkness && dusk.darkness < night.darkness);
  assert.ok(noon.stars === 0 && night.stars === 1);
  await a.evaluate(() => { window.NSM.scene.setClockOverride(12); window.NSM.scene.setAlwaysNight(true); });
  assert.equal(await a.evaluate(() => window.NSM.scene.phase), 'night');
  await a.evaluate(() => { window.NSM.scene.setAlwaysNight(false); window.NSM.scene.setClockOverride(null); });

  // 3단계 ④ 시스템 메시지 합치기: 같은 메시지가 연속이면 ×N
  await a.evaluate(() => { window.NSM.ui.addChat({ system: true, text: '테스트 알림' }); window.NSM.ui.addChat({ system: true, text: '테스트 알림' }); window.NSM.ui.addChat({ system: true, text: '테스트 알림' }); });
  const sys = await a.$$eval('#chat-log .chat-msg.system', (els) => els.filter((e) => e.dataset.base === '테스트 알림').map((e) => e.textContent));
  assert.deepEqual(sys, ['테스트 알림×3']);

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
  await a.waitForSelector('#lobby:not([hidden])', { timeout: 5000 }); // 11단계: 나가면 로비

  assert.deepEqual(errors, []);
});
