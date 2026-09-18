'use strict';
/**
 * 11단계: 스터디(방 인스턴스) 여러 개 — 만들기 · 목록 · 코드 참가 · 비밀번호 · 그룹 목표.
 *  - 게이트 단위: hashPassword/verifyPassword, createStudyGate(실패 5회 → 잠금, 스터디별 키), createAttempts, 기기 토큰(newAccessToken/hashToken).
 *  - 허브 단위: 생성 검증(이름·비밀번호·정원·목표) · 코드 6자 · 로비 목록(내 스터디/다른 스터디) · 마이그레이션(study_id 없는 가구·펫 → 첫 스터디,
 *    옛 강아지 이름) · 60일 비활성 삭제 · 월드 지연 생성/비면 해제 · 방장 권한(설정·내보내기·삭제, 사람 있으면 불가) · 편집 권한.
 *  - 소켓 E2E: 코드 참가 · 없는 코드 · 정원 초과 · 비밀번호(필수/틀림/잠금/성공 → 받은 기기 토큰으로 생략 · 같은 닉네임이라도 토큰 없는 기기는 입력 ·
 *    방장이 바꾸면 토큰 전부 무효 → 재입력, 방장 기기만 새 토큰) · 격리(사람·채팅·가구·펫·강아지 이름) ·
 *    재접속 복귀(토큰) · 랭킹 scope · 그룹 목표 달성(연출 이벤트·접속 중 보너스·주 1회·오프라인 멤버 다음 접속 때 지급) · 내보내기/삭제 알림.
 *  - 브라우저: 로비 → 만들기(🔒, 만든 기기에 토큰) → 다른 탭 링크(?study=) → 비밀번호 모달(틀림/맞음 → localStorage 에 기기 토큰) → 스터디 배지·팝오버 →
 *    목표 달성 연출(불꽃놀이) → 나가기 → 로비 → 같은 닉네임·새 기기(새 컨텍스트)는 다시 비밀번호 → 방장이 바꾸면 다른 기기 토큰 삭제·재입력.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { hashPassword, verifyPassword, createStudyGate, createAttempts, newAccessToken, hashToken } = require('../server/gate');
const { Hub, randomCode, normalizeCode, normalizeName, CODE_CHARS } = require('../server/game/hub');
const { WEEKLY_BONUS } = require('../server/game/world');
const { createMemoryStore } = require('../server/store/memory');
const { getStudyRoom } = require('../server/rooms/studyroom');
const { createShop } = require('../server/game/shop');
const { boot, connect, joinAs, ask, once, sleep, collect, pageUrl, CHROME, CHROME_ARGS } = require('./helpers');

const room = getStudyRoom();
const shop = createShop();
const KST = (iso) => new Date(`${iso}+09:00`).getTime();
const quiet = { log() {}, warn() {}, error() {} };
const T = 32;
const DAY = 24 * 60 * 60 * 1000;

function makeHub(opts = {}) {
  let t = KST('2026-09-17T10:00:00'); // 목요일
  const store = opts.store || createMemoryStore();
  const hub = new Hub({ room, store, tz: 'Asia/Seoul', now: () => t, log: quiet, world: { npc: { autoStart: false }, study: { autoTick: false } }, goalCheckMs: 0, releaseMs: 1000, ...opts });
  return { hub, store, now: () => t, advance: (ms) => { t += ms; } };
}

/** 저장소에 공부 세션을 직접 넣는다 (이번 주) */
async function studied(store, nickname, seconds, startedAt) {
  await store.saveSession({ nickname, startedAt, endedAt: startedAt + seconds * 1000, seconds });
}

// ── 게이트 단위 ──────────────────────────────────────────────────────
test('스터디 비밀번호: scrypt 해시 저장 형식 · 검증 · 게이트 5회 실패 → 잠금, 스터디별로 따로 센다', async () => {
  const h = await hashPassword('abcd');
  assert.match(h, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  assert.notEqual(h, await hashPassword('abcd'), '솔트가 다르다');
  assert.equal(await verifyPassword('abcd', h), true);
  assert.equal(await verifyPassword('abce', h), false);
  assert.equal(await verifyPassword('abcd', 'garbage'), false);
  assert.equal(await verifyPassword(123, h), false);

  let t = 0;
  const gate = createStudyGate({ now: () => t, log: quiet, lockMs: 1000 });
  assert.deepEqual(await gate.check('ip|1', undefined, null), { ok: true }, '공개 스터디는 통과');
  assert.deepEqual(await gate.check('ip|1', '', h), { ok: false, error: 'password_required' });
  for (let i = 1; i <= 4; i++) assert.deepEqual(await gate.check('ip|1', 'no', h), { ok: false, error: 'wrong_password', remaining: 5 - i });
  assert.deepEqual(await gate.check('ip|1', 'no', h), { ok: false, error: 'locked', retryAfterMs: 1000 });
  assert.equal((await gate.check('ip|1', 'abcd', h)).error, 'locked', '잠긴 동안은 맞아도 거부');
  assert.deepEqual(await gate.check('ip|2', 'abcd', h), { ok: true }, '다른 스터디 키는 영향 없음');
  t = 1500;
  assert.deepEqual(await gate.check('ip|1', 'abcd', h), { ok: true });
  assert.equal(gate.size, 0);

  // 기기 접근 토큰: 32바이트 무작위(base64url 43자), 저장은 sha256 해시만
  const tok = newAccessToken();
  assert.match(tok, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(tok, newAccessToken());
  assert.match(hashToken(tok), /^[0-9a-f]{64}$/);
  assert.equal(hashToken(tok), hashToken(tok));
  assert.equal(hashToken('short'), null);
  assert.equal(hashToken(null), null);

  const at = createAttempts({ maxFailures: 2, lockMs: 100, now: () => t, log: quiet });
  assert.equal(at.fail('k').error, 'wrong_password');
  assert.equal(at.fail('k').error, 'locked');
  assert.equal(at.lockedFor('k'), 100);
});

// ── 허브 단위 ────────────────────────────────────────────────────────
test('허브: 코드 6자(헷갈리는 글자 제외) · 이름 정규화 · 생성 검증 · 만든 사람이 방장+멤버 · 잠긴 스터디는 만든 기기에 접근 토큰', async () => {
  for (let i = 0; i < 20; i++) {
    const c = randomCode();
    assert.equal(c.length, 6);
    assert.ok([...c].every((ch) => CODE_CHARS.includes(ch)), c);
  }
  assert.doesNotMatch(CODE_CHARS, /[01IO]/);
  assert.equal(normalizeCode(' ab-cd1 2 '), 'ABCD12');
  assert.equal(normalizeCode('ABC'), null);
  assert.equal(normalizeName('  새벽   코딩방 '), '새벽 코딩방');
  assert.equal(normalizeName(''), null);
  assert.equal(normalizeName('가'.repeat(21)), null);

  const { hub, store } = makeHub();
  await hub.init();
  assert.equal((await hub.createStudy({ name: '', ownerNickname: '민수' })).error, 'invalid_name');
  assert.equal((await hub.createStudy({ name: 'x', password: 'abc', ownerNickname: '민수' })).error, 'invalid_password');
  assert.equal((await hub.createStudy({ name: 'x', password: 'a'.repeat(21), ownerNickname: '민수' })).error, 'invalid_password');
  assert.equal((await hub.createStudy({ name: 'x', maxPlayers: 1, ownerNickname: '민수' })).error, 'invalid_max_players');
  assert.equal((await hub.createStudy({ name: 'x', maxPlayers: 13, ownerNickname: '민수' })).error, 'invalid_max_players');
  assert.equal((await hub.createStudy({ name: 'x', weeklyGoalMinutes: 4 * 60, ownerNickname: '민수' })).error, 'invalid_goal');
  assert.equal((await hub.createStudy({ name: 'x', weeklyGoalMinutes: 101 * 60, ownerNickname: '민수' })).error, 'invalid_goal');
  assert.equal((await hub.createStudy({ name: 'x', editPolicy: 'nobody', ownerNickname: '민수' })).error, 'invalid_policy');
  assert.equal((await hub.createStudy({ name: 'x', ownerNickname: '' })).ok, false, '닉네임 없이 못 만든다');

  const r = await hub.createStudy({ name: '새벽 코딩방', password: 'abcd', ownerNickname: '민수' });
  assert.equal(r.ok, true);
  assert.match(r.access, /^[A-Za-z0-9_-]{43}$/, '잠긴 스터디를 만든 기기는 접근 토큰을 받는다');
  assert.equal((await hub.createStudy({ name: '공개방', ownerNickname: '민수' })).access, null, '공개 스터디는 토큰이 없다');
  assert.ok(await store.findAccess(r.study.id, hashToken(r.access)), '저장소엔 해시만');
  assert.equal((await store.findAccess(r.study.id, r.access)), null, '원문으로는 못 찾는다');
  assert.deepEqual({ ...r.study, id: 0, code: '', createdAt: 0 }, { id: 0, code: '', name: '새벽 코딩방', locked: true, ownerNickname: '민수', maxPlayers: 8, weeklyGoalMinutes: 1200, editPolicy: 'anyone', roomLabel: null, online: 0, createdAt: 0 });
  assert.equal('passwordHash' in r.study, false, '해시는 밖으로 안 나간다');
  const row = await store.getStudy(r.study.id);
  assert.match(row.passwordHash, /^scrypt\$/);
  assert.deepEqual((await store.studyMembers(r.study.id)).map((m) => m.nickname), ['민수']);
  assert.equal(hub.resolve(r.study.code.toLowerCase()).id, r.study.id, '코드는 대소문자 무시');
  assert.equal(hub.resolve(r.study.id).code, r.study.code);
  assert.equal(hub.resolve('ZZZZZZ'), null);
  assert.equal(hub.lookup(r.study.code).study.locked, true);
  assert.equal(hub.lookup('nope').error, 'no_study');
  await hub.dispose();
});

test('허브: 로비 목록 — 내 스터디(이번 주 시간·그룹 스트릭·목표 진행) / 다른 스터디(이름·🔒·시간만), 최근 활동순', async () => {
  const { hub, store, now } = makeHub();
  await hub.init();
  const a = (await hub.createStudy({ name: 'A방', ownerNickname: '민수' })).study;
  const b = (await hub.createStudy({ name: 'B방', password: 'pass1', ownerNickname: '영희' })).study;
  const c = (await hub.createStudy({ name: 'C방', ownerNickname: '철수', weeklyGoalMinutes: 5 * 60 })).study;
  await store.upsertMember(c.id, '민수');
  await hub.touch(c.id, now() + 1000);
  await studied(store, '민수', 3600, now() - 3600 * 1000); // 이번 주 1시간
  await studied(store, '철수', 1800, now() - 7200 * 1000);
  await studied(store, '영희', 600, now() - 3 * DAY); // 월요일 → 이번 주
  await store.recordAttendance('철수', '2026-09-15');
  await store.recordAttendance('민수', '2026-09-16');
  await store.recordAttendance('민수', '2026-09-17');

  const lobby = await hub.lobby('민수');
  assert.deepEqual(lobby.mine.map((s) => s.name), ['C방', 'A방'], '최근 활동순');
  const cCard = lobby.mine.find((s) => s.name === 'C방');
  assert.equal(cCard.weekSeconds, 3600 + 1800, '멤버 전원 합');
  assert.equal(cCard.streak, 3, '철수 15일 + 민수 16·17일 → 3일 연속');
  assert.equal(cCard.memberCount, 2);
  assert.equal(cCard.isOwner, false);
  assert.equal(cCard.reached, false);
  const aCard = lobby.mine.find((s) => s.name === 'A방');
  assert.equal(aCard.isOwner, true);
  assert.equal(aCard.weekSeconds, 3600);
  assert.equal(aCard.streak, 2);
  assert.deepEqual(lobby.others, [{ code: b.code, name: 'B방', locked: true, weekSeconds: 600, online: 0, maxPlayers: 8 }]);
  assert.equal('ownerNickname' in lobby.others[0], false, '남의 스터디는 이름·잠금·시간만');
  await hub.dispose();
});

test('허브: 마이그레이션 — 스터디가 없고 study_id 없는 가구·펫이 있으면 기본 스터디를 만들어 옮기고 옛 강아지 이름을 잇는다 · 60일 비활성 삭제', async () => {
  const store = createMemoryStore();
  // 11단계 전: room_id 만 있고 study_id 는 없다 (memory 저장소에 직접 옛 형태로 넣는다)
  const lamp = await store.addLayout(undefined, { itemId: 'floor_lamp', inventoryId: null, x: 22, y: 15, rotation: 0, meta: {}, placedBy: '민수' });
  const dogRow = await store.addRoomPet(undefined, { itemId: 'dog', name: '사랑', releasedBy: null, cosmetics: { head: null }, skills: ['come'] });
  await store.upsertUser('민수', { dogName: '초코' });
  const { hub } = makeHub({ store });
  await hub.init();
  assert.equal(hub.studies.size, 1);
  const first = [...hub.studies.values()][0];
  assert.equal(first.name, '우리의 스터디룸');
  assert.equal(first.ownerNickname, null, '방장 없음 → 첫 입장자가 방장');
  assert.deepEqual((await store.roomLayout(first.id)).map((e) => e.id), [lamp.id]);
  const pets = await store.roomPets(first.id);
  assert.equal(pets.length, 1);
  assert.equal(pets[0].id, dogRow.id);
  assert.equal(pets[0].name, '초코', 'users.dog_name 의 마지막 값');
  assert.deepEqual(pets[0].skills, ['come']);
  // 월드를 띄우면 강아지 이름·스킬·가구가 복원된다
  const w = await hub.ensureWorld(first.id);
  assert.equal(w.dog.name, '초코');
  assert.equal(w.dog.skills.has('come'), true);
  assert.equal(w.listLayout().length, 1);
  // 두 번째 시작: 다시 옮길 게 없다
  const again = makeHub({ store });
  await again.hub.init();
  assert.equal(again.hub.studies.size, 1);
  await hub.dispose();
  await again.hub.dispose();

  // 아무것도 없으면 기본 스터디도 안 만든다
  const empty = makeHub();
  await empty.hub.init();
  assert.equal(empty.hub.studies.size, 0);
  await empty.hub.dispose();

  // 60일 비활성 삭제 (가구·소속까지)
  const s2 = createMemoryStore();
  const h2 = makeHub({ store: s2 });
  const old = await s2.createStudy({ code: 'OLDOLD', name: '옛날방', ownerNickname: '민수' }, h2.now() - 61 * DAY);
  const fresh = await s2.createStudy({ code: 'FRESHY', name: '새방', ownerNickname: '민수' }, h2.now() - 59 * DAY);
  await s2.addLayout(old.id, { itemId: 'floor_lamp', inventoryId: null, x: 1, y: 1, rotation: 0, meta: {}, placedBy: '민수' });
  await s2.upsertMember(old.id, '민수');
  await h2.hub.init();
  assert.deepEqual([...h2.hub.studies.keys()], [fresh.id]);
  assert.equal(await s2.getStudy(old.id), null);
  assert.deepEqual(await s2.roomLayout(old.id), []);
  assert.deepEqual(await s2.membershipsOf('민수'), []);
  await h2.hub.dispose();
});

test('허브: 월드 지연 생성 · 비면 releaseMs 뒤 해제(가구는 저장소에 남음) · 닉네임은 모든 스터디 통틀어 하나 · 방장 없는 스터디는 첫 입장자가 방장', async () => {
  const { hub, store, now } = makeHub({ releaseMs: 50 });
  await hub.init();
  const a = (await hub.createStudy({ name: 'A', ownerNickname: '방장' })).study;
  const b = await store.createStudy({ code: 'NOOWNR', name: '주인 없음', ownerNickname: null }, now());
  hub.studies.set(b.id, b);
  assert.equal(hub.worlds.size, 0, '만들기만 해서는 월드가 없다');
  const events = [];
  hub.on('worldCreated', (w) => events.push(['created', w.studyId]));
  hub.on('worldReleased', (w) => events.push(['released', w.studyId]));

  const j1 = await hub.join({ study: a.code, nickname: '민수', socketId: 's1' });
  assert.equal(j1.ok, true);
  assert.equal(hub.worlds.size, 1);
  assert.deepEqual(events, [['created', a.id]]);
  const j2 = await hub.join({ study: b.id, nickname: '민수', socketId: 's2' });
  assert.equal(j2.player.nickname, '민수2', '다른 스터디에 있는 닉네임과도 겹치지 않는다');
  assert.equal(hub.studies.get(b.id).ownerNickname, '민수2', '방장 없는 스터디는 첫 입장자가 방장');
  assert.equal(hub.takenNicknames().length, 2);
  assert.deepEqual(hub.findSession(j1.player.token).player, j1.player);
  assert.equal(hub.findSession('nope'), null);

  // 가구를 놓고 모두 나가면 → 해제 → 다시 들어오면 로드
  const inv = await store.addInventory('민수', 'floor_lamp', { name: '스탠드', category: 'shared' });
  assert.equal((await j1.world.placeFurniture(j1.player, { inventoryId: inv.id, x: 22, y: 15 })).ok, true);
  j1.world.remove(j1.player.id, 'leave');
  assert.equal(hub.worlds.has(a.id), true, '바로는 안 내린다');
  await sleep(120);
  assert.equal(hub.worlds.has(a.id), false);
  assert.deepEqual(events.at(-1), ['released', a.id]);
  const j3 = await hub.join({ study: a.code, nickname: '민수', socketId: 's3' });
  assert.equal(j3.world.listLayout().length, 1, '가구는 저장소에 남아 있다');
  assert.equal(j3.player.nickname, '민수', '나간 닉네임은 다시 쓸 수 있다');
  await hub.dispose();
});

test('허브: 방장 권한 — 설정 변경(비밀번호 변경 시 기기 토큰 전부 무효) · 정원 축소 제한 · 내보내기(토큰 무효) · 삭제(사람 있으면 불가) · 편집 권한', async () => {
  const { hub, store } = makeHub();
  await hub.init();
  const created = await hub.createStudy({ name: '방', ownerNickname: '방장', password: 'abcd' });
  const s = created.study;
  let ownerAccess = created.access;
  const updated = [];
  hub.on('studyUpdated', (e) => updated.push(e));
  assert.equal((await hub.join({ study: s.code, nickname: '방장', socketId: 'o' })).error, 'password_required', '방장이라도 토큰 없는 기기면 비밀번호');
  const jo = await hub.join({ study: s.code, nickname: '방장', socketId: 'o', studyAccess: ownerAccess });
  assert.equal(jo.ok, true, '만든 기기의 토큰으로 생략');
  assert.equal(jo.access, null, '토큰이 유효하면 새로 주지 않는다');
  assert.equal((await hub.join({ study: s.code, nickname: '민수', socketId: 'm' })).error, 'password_required');
  assert.equal((await hub.join({ study: s.code, nickname: '민수', socketId: 'm', studyAccess: 'bogus-token-that-is-long-enough' })).error, 'password_required', '무효 토큰은 없는 것과 같다');
  const jm = await hub.join({ study: s.code, nickname: '민수', socketId: 'm', studyPassword: 'abcd', key: 'ip' });
  assert.equal(jm.ok, true);
  const minsuAccess = jm.access;
  assert.match(minsuAccess, /^[A-Za-z0-9_-]{43}$/, '맞추면 기기 토큰 발급');
  assert.equal((await store.findAccess(s.id, hashToken(minsuAccess))).nickname, '민수');

  assert.equal((await hub.updateStudy(s.code, '민수', { name: '내 맘대로' })).error, 'forbidden');
  assert.equal((await hub.updateStudy(s.code, '방장', { name: '' })).error, 'invalid_name');
  assert.equal((await hub.updateStudy(s.code, '방장', { maxPlayers: 1 })).error, 'invalid_max_players');
  assert.equal((await hub.updateStudy(s.code, '방장', { maxPlayers: 2 })).ok, true);
  jm.world.join({ nickname: '영희', socketId: 'y' });
  assert.equal((await hub.updateStudy(s.code, '방장', { maxPlayers: 2 })).error, 'too_many_players', '지금 사람보다 작게는 못 줄인다');
  assert.equal((await hub.updateStudy(s.code, '방장', { maxPlayers: 8 })).ok, true);
  const u = await hub.updateStudy(s.code, '방장', { name: '새 이름', weeklyGoalMinutes: 600, editPolicy: 'owner' });
  assert.deepEqual({ name: u.study.name, weeklyGoalMinutes: u.study.weeklyGoalMinutes, editPolicy: u.study.editPolicy, locked: u.study.locked }, { name: '새 이름', weeklyGoalMinutes: 600, editPolicy: 'owner', locked: true });
  assert.equal(updated.at(-1).passwordChanged, false);

  // 편집 권한: 방장만
  const w = jm.world;
  assert.equal(w.canEditLayout(jm.player), false);
  assert.equal(w.canEditLayout(jo.player), true);
  assert.deepEqual(w.setEditing(jm.player, true), { ok: false, error: 'forbidden' });
  assert.equal(w.setEditing(jo.player, true).ok, true);
  const inv = await store.addInventory('민수', 'floor_lamp', { name: '스탠드', category: 'shared' });
  assert.deepEqual(await w.placeFurniture(jm.player, { inventoryId: inv.id, x: 22, y: 15 }), { ok: false, error: 'forbidden' });
  assert.equal((await hub.updateStudy(s.code, '방장', { editPolicy: 'anyone' })).ok, true);
  assert.equal((await w.placeFurniture(jm.player, { inventoryId: inv.id, x: 22, y: 15 })).ok, true);

  // 기기 기준: 같은 닉네임이라도 토큰 없는 다른 기기는 비밀번호, 토큰 있는 기기는 생략 (소속 여부와 무관)
  jm.world.remove(jm.player.id, 'leave');
  assert.equal((await store.studyMembers(s.id)).some((m) => m.nickname === '민수'), true, '소속은 남아 있지만');
  assert.equal((await hub.join({ study: s.code, nickname: '민수', socketId: 'm2' })).error, 'password_required', '토큰 없는 기기(같은 닉네임)는 다시 입력');
  assert.equal((await hub.join({ study: s.code, nickname: '민수', socketId: 'm2', studyAccess: minsuAccess })).ok, true, '토큰 있는 기기는 생략');
  hub.worlds.get(s.id).remove(hub.playerByNickname('민수').player.id, 'leave');
  assert.equal((await hub.join({ study: s.code, nickname: '영희', socketId: 'y2', studyAccess: minsuAccess })).ok, true, '토큰은 기기에 붙는다 — 닉네임이 달라도 통과');
  hub.worlds.get(s.id).remove(hub.playerByNickname('영희').player.id, 'leave');

  // 비밀번호 변경 → 토큰 전부 무효(방장 기기만 새 토큰) → 재입력, 잠금 해제 → 아무나
  const chg = await hub.updateStudy(s.code, '방장', { password: 'efgh' });
  assert.equal(chg.ok, true);
  assert.equal(updated.at(-1).passwordChanged, true);
  assert.match(chg.access, /^[A-Za-z0-9_-]{43}$/, '바꾼 방장 기기는 새 토큰');
  assert.notEqual(chg.access, ownerAccess);
  assert.equal((await hub.join({ study: s.code, nickname: '민수', socketId: 'm3', studyAccess: minsuAccess })).error, 'password_required', '옛 토큰은 무효');
  assert.equal((await hub.join({ study: s.code, nickname: '방장', socketId: 'o2', studyAccess: ownerAccess })).error, 'password_required', '방장의 옛 토큰도 무효');
  ownerAccess = chg.access;
  assert.equal((await hub.join({ study: s.code, nickname: '민수', socketId: 'm3', studyPassword: 'abcd', key: 'ip' })).error, 'wrong_password');
  const j3 = await hub.join({ study: s.code, nickname: '민수', socketId: 'm3', studyPassword: 'efgh', key: 'ip' });
  assert.equal(j3.ok, true);
  assert.notEqual(j3.access, minsuAccess, '새 토큰');
  assert.equal((await hub.updateStudy(s.code, '방장', { name: '이름만' })).access, null, '비밀번호를 안 건드리면 토큰 그대로');
  assert.ok(await store.findAccess(s.id, hashToken(j3.access)));
  // 내보내기 → 그 닉네임으로 발급된 기기 토큰도 무효 (다시 들어오려면 비밀번호)
  assert.equal((await hub.kickMember(s.code, '방장', '민수')).ok, true);
  assert.equal(await store.findAccess(s.id, hashToken(j3.access)), null, '내보내면 토큰도 지운다');
  assert.equal((await hub.join({ study: s.code, nickname: '민수', socketId: 'm4', studyAccess: j3.access })).error, 'password_required');
  assert.ok(await store.findAccess(s.id, hashToken(ownerAccess)), '다른 사람 토큰은 그대로');
  const unlock = await hub.updateStudy(s.code, '방장', { password: '' });
  assert.equal(unlock.ok, true);
  assert.equal(unlock.access, null);
  assert.equal(hub.studies.get(s.id).passwordHash, null);
  assert.equal(await store.findAccess(s.id, hashToken(ownerAccess)), null, '풀면 토큰도 지운다');
  assert.equal((await hub.join({ study: s.code, nickname: '철수', socketId: 'c' })).ok, true, '공개로 바뀌면 아무나');

  // 내보내기: 방장만, 자기 자신 불가, 소속 삭제 + 접속 중이면 방에서 제거
  assert.equal((await hub.kickMember(s.code, '민수', '철수')).error, 'forbidden');
  assert.equal((await hub.kickMember(s.code, '방장', '방장')).error, 'self');
  assert.equal((await hub.kickMember(s.code, '방장', '없는사람')).error, 'not_member');
  const left = [];
  hub.worlds.get(s.id).on('playerLeft', (p, reason) => left.push([p.nickname, reason]));
  const k = await hub.kickMember(s.code, '방장', '철수');
  assert.equal(k.ok, true);
  assert.equal(k.player.socketId, 'c');
  assert.deepEqual(left, [['철수', 'kicked']]);
  assert.equal((await store.studyMembers(s.id)).some((m) => m.nickname === '철수'), false);

  // 삭제: 방장만, 다른 사람이 있으면 불가, 혼자면 가능 → 저장소·월드 정리
  assert.equal((await hub.deleteStudy(s.code, '민수')).error, 'forbidden');
  assert.equal((await hub.deleteStudy(s.code, '방장')).error, 'not_empty');
  for (const p of [...hub.worlds.get(s.id).players.values()]) if (p.nickname !== '방장') hub.worlds.get(s.id).remove(p.id, 'leave');
  const deleted = [];
  hub.on('studyDeleted', (e) => deleted.push(e.study.id));
  assert.deepEqual(await hub.deleteStudy(s.code, '방장'), { ok: true });
  assert.deepEqual(deleted, [s.id]);
  assert.equal(hub.worlds.has(s.id), false);
  assert.equal(await store.getStudy(s.id), null);
  assert.deepEqual(await store.roomLayout(s.id), []);
  assert.equal(hub.resolve(s.code), null);
  await hub.dispose();
});

test('허브: 그룹 주간 목표 — 멤버 합(진행 중 포함)이 목표에 닿으면 주 1회, 접속 중 멤버 즉시 +10, 오프라인 멤버는 다음 입장 때', async () => {
  const { hub, store, now, advance } = makeHub();
  await hub.init();
  const s = (await hub.createStudy({ name: '목표방', ownerNickname: '방장', weeklyGoalMinutes: 5 * 60 })).study; // 5시간
  const other = (await hub.createStudy({ name: '딴방', ownerNickname: '남' })).study;
  await store.upsertMember(s.id, '오프라인');
  const jo = await hub.join({ study: s.code, nickname: '방장', socketId: 'o' });
  const jm = await hub.join({ study: s.code, nickname: '민수', socketId: 'm' });
  const jn = await hub.join({ study: other.code, nickname: '남', socketId: 'n' });
  const w = jo.world;
  const goals = [];
  w.on('weeklyGoal', (e) => goals.push(e));
  const coins = [];
  w.on('coins', (e) => coins.push(e));

  await studied(store, '오프라인', 2 * 3600, now() - DAY); // 화요일 2시간
  await studied(store, '남', 10 * 3600, now() - DAY); // 다른 스터디 사람은 안 센다
  await studied(store, '방장', 1 * 3600, now() - 2 * 3600 * 1000);
  hub.study.statsCache = null;
  assert.equal(await w.checkWeeklyGoal(), null, '3시간 < 5시간');
  let p = await w.weeklyProgress();
  assert.deepEqual({ total: p.totalSeconds, target: p.targetSeconds, reached: p.reached }, { total: 3 * 3600, target: 5 * 3600, reached: false });

  // 민수가 앉아서 공부 중(진행 중 세션) 2시간 → 합 5시간 → 달성
  const seat = room.seats[0];
  jm.player.x = (seat.x + 0.5) * T; jm.player.y = (seat.y + 1) * T;
  assert.equal(w.sit(jm.player, seat.id).ok, true);
  advance(2 * 3600 * 1000);
  hub.study.statsCache = null;
  const e = await w.checkWeeklyGoal();
  assert.ok(e, '달성');
  assert.equal(e.totalSeconds, 5 * 3600);
  assert.equal(e.bonus, WEEKLY_BONUS);
  assert.deepEqual(e.awarded.sort(), [jo.player.id, jm.player.id].sort(), '접속 중인 멤버에게 바로');
  assert.equal(goals.length, 1);
  await Promise.all([...w.pendingAwards]);
  await Promise.all([...hub.study.pending, ...w.pendingAwards]);
  assert.equal(await store.getCoins('방장'), 10);
  assert.equal(await store.getCoins('민수'), 10 + 12, '그룹 보너스 10 + 앉아서 공부 중 2시간의 시간 코인 12 (13단계 실시간 지급)');
  assert.equal(await store.getCoins('오프라인'), 0, '오프라인 멤버는 아직');
  assert.equal(await store.getCoins('남'), 0);
  const weekly = coins.filter((c) => c.reason === 'weekly_goal');
  assert.equal(weekly.length, 2);
  assert.ok(weekly.every((c) => c.delta === 10));
  assert.ok(coins.filter((c) => c.reason === 'study').every((c) => c.nickname === '민수'), '시간 코인은 앉아 있는 민수에게만');
  // 주 1회
  advance(3600 * 1000);
  hub.study.statsCache = null;
  assert.equal(await w.checkWeeklyGoal(), null);
  assert.equal(goals.length, 1);
  p = await w.weeklyProgress();
  assert.equal(p.reached, true);
  assert.equal((await hub.lobby('방장')).mine[0].reached, true);
  // 오프라인 멤버가 들어오면 프로필에 보너스 + 코인
  const jf = await hub.join({ study: s.code, nickname: '오프라인', socketId: 'f' });
  const prof = await w.loadProfile(jf.player);
  assert.deepEqual(prof.rewards.map((r) => [r.studyName, r.coins]), [['목표방', 10]]);
  assert.equal(prof.coins, 10);
  const prof2 = await w.loadProfile(jf.player);
  assert.deepEqual(prof2.rewards, [], '두 번 안 준다');
  // 다음 주에는 다시 가능 (달성 기록이 주 단위)
  assert.equal(await store.weeklyGoalReached(s.id, '2026-09-14'), true);
  assert.equal(await store.weeklyGoalReached(s.id, '2026-09-21'), false);
  await hub.dispose();
  void jn;
});

// ── 소켓 E2E ─────────────────────────────────────────────────────────
test('소켓 E2E: 로비 목록·만들기·코드 참가·없는 코드·정원 초과·격리(사람·채팅·가구·펫·강아지 이름)·랭킹 scope', async (t) => {
  const srv = await boot({ study: { maxPlayers: 2 }, world: { npc: { autoStart: false }, study: { autoTick: false } } });
  t.after(() => srv.close());
  const a = connect(srv.port);
  const b = connect(srv.port);
  const c = connect(srv.port);
  t.after(() => { a.close(); b.close(); c.close(); });

  // 로비: 아무것도 소속 안 된 사람 → others 에 기본 스터디, 만들면 mine
  let lobby = await ask(a, 'lobby:list', { nickname: '민수' });
  assert.equal(lobby.ok, true);
  assert.deepEqual(lobby.mine, []);
  assert.deepEqual(lobby.others.map((s) => s.name), ['테스트 스터디']);
  assert.equal((await ask(a, 'study:create', { nickname: '민수', name: '' })).error, 'invalid_name');
  const created = await ask(a, 'study:create', { nickname: '민수', name: '민수방', maxPlayers: 3, weeklyGoalMinutes: 600 });
  assert.equal(created.ok, true);
  assert.equal(created.study.ownerNickname, '민수');
  lobby = await ask(a, 'lobby:list', { nickname: '민수' });
  assert.deepEqual(lobby.mine.map((s) => [s.name, s.isOwner, s.online]), [['민수방', true, 0]]);
  assert.deepEqual((await ask(b, 'study:lookup', { code: created.study.code })).study.name, '민수방');
  assert.equal((await ask(b, 'study:lookup', { code: 'ABCDEF' })).error, 'no_study');

  // 참가: 코드로 · 없는 코드 · 정원(2) 초과
  const ja = await joinAs(a, { nickname: '민수', study: created.study.code });
  assert.equal(ja.ok, true);
  assert.equal(ja.study.name, '민수방');
  assert.equal(ja.study.isOwner, true);
  assert.deepEqual((await joinAs(b, { nickname: '영희', study: 'NOPE00' })), { ok: false, error: 'no_study' });
  const jb = await joinAs(b, { nickname: '영희' }); // 기본 스터디 (정원 2)
  assert.equal(jb.ok, true);
  assert.equal(jb.study.isOwner, false);
  const jc = await joinAs(c, { nickname: '철수' });
  assert.equal(jc.ok, true);
  const d = connect(srv.port);
  t.after(() => d.close());
  assert.deepEqual(await joinAs(d, { nickname: '지우' }), { ok: false, error: 'study_full' });
  assert.equal(srv.hub.worlds.size, 2);
  assert.equal((await fetch(`http://127.0.0.1:${srv.port}/healthz`).then((r) => r.json())).studies, 2);

  // 격리: 다른 스터디 사람은 목록에도, 이벤트에도 없다
  assert.deepEqual(ja.players, []);
  assert.deepEqual(jb.players.map((p) => p.nickname), []);
  assert.deepEqual(jc.players.map((p) => p.nickname), ['영희']);
  const aChats = collect(a, 'chat');
  const aMoves = collect(a, 'playerMoved');
  const aJoined = collect(a, 'playerJoined');
  const bChat = once(b, 'chat');
  await ask(c, 'chat', { text: '옆방에는 안 들리죠' });
  assert.equal((await bChat).text, '옆방에는 안 들리죠');
  c.emit('move', { x: jc.self.x + 5, y: jc.self.y, facing: 'right', moving: true });
  await sleep(150);
  assert.deepEqual(aChats, []);
  assert.deepEqual(aMoves, []);
  assert.deepEqual(aJoined, []);

  // 격리: 가구·공용 펫·강아지 이름은 스터디마다
  await srv.hub.store.adjustCoins('영희', 500, 'study', Date.now());
  const lamp = await ask(b, 'shop:buy', { itemId: 'floor_lamp' });
  const bWorld = srv.world;
  const pb = bWorld.players.get(jb.self.id);
  const placed = await bWorld.placeFurniture(pb, { inventoryId: lamp.inventory.id, x: 22, y: 15 });
  assert.equal(placed.ok, true);
  const aWorld = srv.hub.worlds.get(created.study.id);
  assert.equal(aWorld.listLayout().length, 0);
  assert.equal(bWorld.listLayout().length, 1);
  assert.equal(aWorld.canStand(22.5 * T, 15 * T), true, '옆방 가구는 충돌에도 없다');
  const cat = await ask(b, 'shop:buy', { itemId: 'shared_cat' });
  const rel = await ask(b, 'pet:release', { inventoryId: cat.inventory.id, name: '치즈' });
  assert.equal(rel.ok, true);
  assert.equal(aWorld.sharedPetCount(), 0);
  assert.equal(bWorld.sharedPetCount(), 1);
  const nameSeen = once(c, 'npc:name');
  await ask(b, 'npc:name', { id: 'dog', name: '초코' });
  assert.equal((await nameSeen).name, '초코');
  await sleep(20);
  assert.equal(aWorld.dog.name, '사랑', '옆방 강아지는 그대로');
  assert.equal(bWorld.dog.name, '초코');
  assert.equal((await srv.hub.store.roomPets(srv.study.id)).find((p) => p.itemId === 'dog').name, '초코', '스터디별 dog 행에 저장');
  const petSeen = collect(a, 'npc:update');
  await sleep(50);
  assert.ok(petSeen.every((n) => !n.id.startsWith('s:')), '옆방 펫 스냅샷이 오지 않는다');

  // 랭킹 scope: 기본 스터디 멤버(영희·철수·방장)만 / 전체
  const st = await ask(b, 'stats', { scope: 'study' });
  assert.equal(st.scope, 'study');
  assert.deepEqual(st.rows.map((r) => r.nickname).sort(), ['영희', '철수'], '접속 중인 멤버 (기록 없는 오프라인 멤버는 행이 없다)');
  const all = await ask(b, 'stats', { scope: 'all' });
  assert.equal(all.scope, 'all');
  assert.ok(all.rows.some((r) => r.nickname === '민수'), '전체에는 옆방 사람도');
  assert.equal((await ask(b, 'stats', {})).scope, 'all');

  // 스터디 정보
  const info = await ask(b, 'study:info', {});
  assert.equal(info.ok, true);
  assert.equal(info.study.name, '테스트 스터디');
  assert.equal(info.study.isOwner, false);
  assert.deepEqual(info.members.map((m) => [m.nickname, m.online]).sort(), [['방장', false], ['영희', true], ['철수', true]]);
  assert.deepEqual(info.week, { weekStart: info.week.weekStart, totalSeconds: 0, targetSeconds: 1200 * 60, reached: false });
  assert.equal((await ask(b, 'study:update', { name: 'x' })).error, 'forbidden');
  assert.equal((await ask(b, 'study:delete', {})).error, 'forbidden');
});

test('소켓 E2E: 잠긴 스터디 — 필수/틀림/잠금/성공(기기 토큰 발급) → 토큰으로 생략 · 같은 닉네임 다른 기기는 입력 → 비밀번호 변경(토큰 무효)·재입력 → 잠금 해제 · 재접속 복귀 · 내보내기/삭제 알림', async (t) => {
  const srv = await boot({ study: { password: 'abcd' }, world: { graceMs: 500, npc: { autoStart: false }, study: { autoTick: false } }, hub: { gate: { lockMs: 500 } } });
  t.after(() => srv.close());
  const owner = connect(srv.port);
  const a = connect(srv.port);
  t.after(() => { owner.close(); a.close(); });
  assert.equal((await joinAs(owner, { nickname: '방장' })).error, 'password_required', '방장이라도 토큰 없는 기기면');
  const jo = await joinAs(owner, { nickname: '방장', studyAccess: srv.access });
  assert.equal(jo.ok, true, '만든 기기의 토큰으로');
  assert.equal('studyAccess' in jo, false, '토큰이 유효하면 새로 주지 않는다');
  assert.equal(jo.study.locked, true);

  assert.deepEqual(await joinAs(a, { nickname: '민수' }), { ok: false, error: 'password_required', scope: 'study' });
  assert.deepEqual(await joinAs(a, { nickname: '민수', studyPassword: 'nope' }), { ok: false, error: 'wrong_password', remaining: 4, scope: 'study' });
  for (let i = 0; i < 3; i++) await joinAs(a, { nickname: '민수', studyPassword: 'nope' });
  let r = await joinAs(a, { nickname: '민수', studyPassword: 'nope' });
  assert.equal(r.error, 'locked');
  assert.equal(r.scope, 'study');
  assert.ok(r.retryAfterMs > 0 && r.retryAfterMs <= 500);
  assert.equal((await joinAs(a, { nickname: '민수', studyPassword: 'abcd' })).error, 'locked', '잠긴 동안은 맞아도');
  await sleep(r.retryAfterMs + 30);
  const ja = await joinAs(a, { nickname: '민수', studyPassword: 'abcd' });
  assert.equal(ja.ok, true);
  assert.match(ja.studyAccess, /^[A-Za-z0-9_-]{43}$/, '맞추면 기기 토큰');
  assert.equal(srv.world.connectedCount, 2);

  // 재접속: 같은 토큰이면 스터디·비밀번호 없이 이어받는다
  a.close();
  await sleep(50);
  const a2 = connect(srv.port);
  t.after(() => a2.close());
  const j2 = await joinAs(a2, { nickname: '민수', token: ja.token, study: undefined });
  assert.equal(j2.ok, true);
  assert.equal(j2.resumed, true);
  assert.equal(j2.self.id, ja.self.id);
  assert.equal(j2.study.code, srv.code);

  // 나갔다 다시: 같은 닉네임이라도 토큰 없는 기기는 비밀번호, 토큰 있는 기기는 생략 (소속과 무관)
  assert.equal((await ask(a2, 'leave', {})).ok, true);
  assert.equal((await srv.hub.store.studyMembers(srv.study.id)).some((m) => m.nickname === '민수'), true, '소속은 남아 있다');
  const a3 = connect(srv.port);
  t.after(() => a3.close());
  assert.deepEqual(await joinAs(a3, { nickname: '민수' }), { ok: false, error: 'password_required', scope: 'study' }, '토큰 없는 다른 기기');
  assert.deepEqual(await joinAs(a3, { nickname: '민수', studyAccess: 'x'.repeat(43) }), { ok: false, error: 'password_required', scope: 'study' }, '무효 토큰');
  const j3 = await joinAs(a3, { nickname: '민수', studyAccess: ja.studyAccess });
  assert.equal(j3.ok, true, '토큰 있는 기기는 비밀번호 없이');
  assert.equal(j3.resumed, false);
  assert.equal('studyAccess' in j3, false);

  // 방장이 비밀번호를 바꾸면 방 안 모두에게 study:update(passwordChanged), 토큰 전부 무효 → 다음 입장 때 다시 입력. 방장 기기만 ack 로 새 토큰
  const upd = once(a3, 'study:update');
  const u = await ask(owner, 'study:update', { password: 'efgh', name: '비밀방' });
  assert.equal(u.ok, true);
  assert.equal(u.study.name, '비밀방');
  assert.match(u.studyAccess, /^[A-Za-z0-9_-]{43}$/, '방장 기기의 새 토큰');
  assert.notEqual(u.studyAccess, srv.access);
  const ue = await upd;
  assert.equal(ue.passwordChanged, true);
  assert.equal(ue.study.name, '비밀방');
  assert.equal('passwordHash' in ue.study, false);
  assert.equal('studyAccess' in ue, false, '브로드캐스트엔 토큰이 없다');
  await ask(a3, 'leave', {});
  const a4 = connect(srv.port);
  t.after(() => a4.close());
  assert.equal((await joinAs(a4, { nickname: '민수', studyAccess: ja.studyAccess })).error, 'password_required', '옛 토큰은 무효');
  assert.equal((await joinAs(a4, { nickname: '민수', studyPassword: 'abcd' })).error, 'wrong_password');
  const j4 = await joinAs(a4, { nickname: '민수', studyPassword: 'efgh' });
  assert.equal(j4.ok, true);
  assert.ok(j4.studyAccess && j4.studyAccess !== ja.studyAccess, '새 토큰');
  assert.equal((await ask(a4, 'study:update', { name: 'x' })).error, 'forbidden');
  // 방장도 옛 토큰으론 못 들어온다 — 새 토큰으로만
  await ask(owner, 'leave', {});
  assert.equal((await joinAs(owner, { nickname: '방장', studyAccess: srv.access })).error, 'password_required');
  assert.equal((await joinAs(owner, { nickname: '방장', studyAccess: u.studyAccess })).ok, true);
  // 잠금 해제 → 아무나 (토큰은 지워진다)
  const unlock = await ask(owner, 'study:update', { password: '' });
  assert.equal(unlock.study.locked, false);
  assert.equal('studyAccess' in unlock, false);
  assert.equal(await srv.hub.store.findAccess(srv.study.id, hashToken(j4.studyAccess)), null);
  const e = connect(srv.port);
  t.after(() => e.close());
  assert.equal((await joinAs(e, { nickname: '영희' })).ok, true);

  // 내보내기: 당한 사람에게 kicked, 다른 사람에게 playerLeft(kicked) + 시스템 채팅, 이후 요청은 not_joined
  const kicked = once(a4, 'kicked');
  const leftSeen = once(e, 'playerLeft');
  const k = await ask(owner, 'study:kick', { nickname: '민수' });
  assert.equal(k.ok, true);
  assert.equal(k.player.id, j4.self.id);
  await kicked;
  assert.equal((await leftSeen).reason, 'kicked');
  assert.equal((await ask(a4, 'chat', { text: 'x' })).error, 'not_joined');
  assert.equal((await srv.hub.store.studyMembers(srv.study.id)).some((m) => m.nickname === '민수'), false);

  // 삭제: 사람 있으면 불가 → 비면 가능 → 남은(방장) 소켓은 not_joined
  assert.equal((await ask(owner, 'study:delete', {})).error, 'not_empty');
  await ask(e, 'leave', {});
  assert.deepEqual(await ask(owner, 'study:delete', {}), { ok: true });
  assert.equal((await ask(owner, 'chat', { text: 'x' })).error, 'not_joined');
  assert.equal(srv.hub.studies.size, 0);
  assert.equal((await ask(owner, 'study:lookup', { code: srv.code })).error, 'no_study');
});

test('소켓 E2E: 그룹 목표 달성 → studyGoal 연출 이벤트 + 시스템 채팅(notify) + 접속 중 멤버 코인, 오프라인 멤버는 입장 ack profile.rewards', async (t) => {
  let now = KST('2026-09-17T10:00:00');
  const srv = await boot({ study: { weeklyGoalMinutes: 5 * 60 }, world: { now: () => now, npc: { autoStart: false }, study: { autoTick: false } } });
  t.after(() => srv.close());
  const a = connect(srv.port);
  const b = connect(srv.port);
  t.after(() => { a.close(); b.close(); });
  const ja = await joinAs(a, { nickname: '민수' });
  const jb = await joinAs(b, { nickname: '영희' });
  await srv.hub.store.upsertMember(srv.study.id, '오프라인');
  await studied(srv.hub.store, '오프라인', 4 * 3600, now - DAY);
  srv.hub.study.statsCache = null;

  const goalA = once(a, 'studyGoal', { timeout: 5000 });
  const goalB = once(b, 'studyGoal', { timeout: 5000 });
  const chatA = once(a, 'chat', { filter: (c) => c.system && /그룹 목표/.test(c.text), timeout: 5000 });
  const coinA = once(a, 'coins', { filter: (c) => c.reason === 'weekly_goal' && c.balance !== undefined, timeout: 5000 }); // balance 는 본인에게만
  const coinB = once(b, 'coins', { filter: (c) => c.reason === 'weekly_goal' && c.balance !== undefined, timeout: 5000 });
  // 민수가 앉아서 61분 → 세션 저장 → 합 5시간 1분 → 달성
  const seat = room.seats[0];
  const pa = srv.world.players.get(ja.self.id);
  pa.x = (seat.x + 0.5) * T; pa.y = (seat.y + 1) * T;
  assert.equal((await ask(a, 'sit', { seatId: seat.id })).ok, true);
  now += 61 * 60 * 1000;
  await ask(a, 'stand', {});
  const g = await goalA;
  assert.equal(g.targetSeconds, 5 * 3600);
  assert.ok(g.totalSeconds >= 5 * 3600);
  assert.equal(g.bonus, 10);
  assert.equal(g.name, '테스트 스터디');
  assert.equal((await goalB).bonus, 10);
  const c = await chatA;
  assert.equal(c.notify, true);
  assert.match(c.text, /5시간을 달성했어요/);
  assert.equal((await coinA).id, ja.self.id);
  assert.equal((await coinB).id, jb.self.id);
  await sleep(30);
  assert.equal(await srv.hub.store.getCoins('민수'), 10 + 6, '공부 60분 6코인 + 보너스 10');
  assert.equal(await srv.hub.store.getCoins('영희'), 10);
  // 오프라인 멤버 입장 → profile.rewards + coins
  const f = connect(srv.port);
  t.after(() => f.close());
  const jf = await joinAs(f, { nickname: '오프라인' });
  assert.deepEqual(jf.profile.rewards.map((r) => [r.studyName, r.coins]), [['테스트 스터디', 10]]);
  assert.equal(jf.profile.coins, 10);
  const info = await ask(f, 'study:info', {});
  assert.equal(info.week.reached, true);
});

// ── 브라우저 ────────────────────────────────────────────────────────
let puppeteer = null;
try { puppeteer = require('puppeteer-core'); } catch (_) { /* devDependency 없음 */ }

test('브라우저: 로비 → 만들기(🔒) → 링크 탭 비밀번호 모달(틀림/맞음 → 기기 토큰) → 배지·팝오버·랭킹 scope → 목표 달성 연출 → 나가기 → 로비 → 새 기기 재입력 · 비밀번호 변경', { skip: !CHROME || !puppeteer ? 'Chrome/puppeteer-core 없음' : false, timeout: 180000 }, async (t) => {
  const srv = await boot({ study: false, world: { npc: { autoStart: false }, study: { autoTick: false } } });
  t.after(() => srv.close());
  const base = `http://127.0.0.1:${srv.port}`;
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: CHROME_ARGS });
  t.after(() => browser.close());
  const errors = [];
  const newPage = async (url) => {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.stack || e.message));
    await page.setViewport({ width: 1200, height: 800 });
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
    await page.waitForSelector('#login:not([hidden])', { timeout: 30000 });
    return page;
  };

  // A: 닉네임 → 로비(빈 목록) → 만들기 🔒 → 스터디 안
  const a = await newPage(`${base}/`);
  await a.type('#login-nick', '방장A');
  await a.click('#login-submit');
  await a.waitForSelector('#lobby:not([hidden])', { timeout: 15000 });
  assert.equal(await a.$eval('#login', (el) => el.hidden), true);
  assert.match(await a.$eval('#lobby-mine', (el) => el.textContent), /아직 소속된 스터디가 없어요/);
  await a.click('#lobby-create');
  await a.waitForSelector('#study-create:not([hidden])');
  await a.type('#sc-name', '새벽 코딩방');
  await a.type('#sc-pass', 'abcd');
  await a.select('#sc-max', '3');
  await a.$eval('#sc-goal', (el) => { el.value = '5'; });
  await a.click('#sc-submit');
  await a.waitForFunction(() => window.NSM && window.NSM.scene.me, { timeout: 30000 });
  assert.equal(await a.$eval('#lobby', (el) => el.hidden), true);
  assert.equal(await a.$eval('#study-name', (el) => el.textContent), '새벽 코딩방');
  assert.equal(await a.$eval('#study-lock', (el) => el.hidden), false, '🔒 배지');
  const study = [...srv.hub.studies.values()][0];
  assert.equal(study.maxPlayers, 3);
  assert.equal(study.weeklyGoalMinutes, 300);
  assert.equal(await a.evaluate(() => localStorage.getItem('nsm.lastStudy')), study.code);
  const accessOf = (page) => page.evaluate((c) => localStorage.getItem(`nsm.study.access.${c}`), study.code);
  assert.match(await accessOf(a), /^[A-Za-z0-9_-]{43}$/, '만든 기기는 접근 토큰을 받는다');
  // 팝오버: 코드 · 방장 설정 보임
  await a.click('#room-name');
  await a.waitForFunction(() => !document.getElementById('pop-study').hidden && document.getElementById('study-members').children.length > 0, { timeout: 5000 });
  assert.equal(await a.$eval('#study-info-code', (el) => el.textContent), study.code);
  assert.equal(await a.$eval('#study-owner', (el) => el.hidden), false);
  assert.match(await a.$eval('#study-members', (el) => el.textContent), /★ 방장A \(나\)/);
  assert.match(await a.$eval('#study-week-text', (el) => el.textContent), /0분 \/ 5시간/);
  await a.click('#room-name');

  // B: 링크로 → 입장 화면에 스터디 이름 → 비밀번호 모달 (틀림 → 남은 횟수, 맞음 → 입장, localStorage 기억)
  const b = await newPage(`${base}/?study=${study.code.toLowerCase()}`);
  await b.waitForFunction(() => !document.getElementById('login-target').hidden, { timeout: 5000 });
  assert.match(await b.$eval('#login-target', (el) => el.textContent), /🔒 새벽 코딩방/);
  await b.type('#login-nick', '멤버B');
  await b.click('#login-submit');
  await b.waitForSelector('#study-pass:not([hidden])', { timeout: 15000 });
  assert.equal(await b.$eval('#sp-name', (el) => el.textContent), '새벽 코딩방');
  await b.type('#sp-pass', 'wrong');
  await b.click('#sp-submit');
  await b.waitForFunction(() => { const e = document.getElementById('sp-error'); return !e.hidden && /남은 횟수 4회/.test(e.textContent); }, { timeout: 10000 });
  assert.equal(await accessOf(b), null);
  await b.type('#sp-pass', 'abcd');
  await b.click('#sp-submit');
  await b.waitForFunction(() => window.NSM && window.NSM.scene.me, { timeout: 30000 });
  const accessB = await accessOf(b);
  assert.match(accessB, /^[A-Za-z0-9_-]{43}$/, '맞추면 기기 토큰을 저장 (비밀번호는 저장하지 않는다)');
  assert.equal(await b.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('nsm.study.pass.'))), false);
  await a.waitForFunction(() => window.NSM.scene.remotes.size === 1, { timeout: 5000 });
  assert.match(await a.$eval('#notify-list', (el) => el.textContent), /멤버B 님이 입장했어요/, '알림 벨');
  assert.equal(await b.$eval('#room-count span', (el) => el.textContent), '2');
  // B 팝오버: 방장 설정 없음, 멤버 2명
  await b.click('#room-name');
  await b.waitForFunction(() => document.getElementById('study-members').children.length === 2, { timeout: 5000 });
  assert.equal(await b.$eval('#study-owner', (el) => el.hidden), true);
  await b.click('#room-name');
  // 랭킹 scope 토글
  assert.equal(await b.evaluate(() => window.NSM.ui.rankScope), 'study');
  await b.click('#rank-scope button[data-scope="all"]');
  await b.waitForFunction(() => window.NSM.ui.stats && window.NSM.ui.stats.scope === 'all', { timeout: 5000 });

  // 그룹 목표 달성: 서버가 세션을 넣고 검사 → 두 탭 모두 불꽃놀이 + 토스트 + 시스템 채팅, 코인 배지 +10
  const world = srv.hub.worlds.get(study.id);
  await srv.hub.store.saveSession({ nickname: '방장A', startedAt: Date.now() - 6 * 3600 * 1000, endedAt: Date.now() - 3600 * 1000, seconds: 5 * 3600 });
  srv.hub.study.statsCache = null;
  const e = await world.checkWeeklyGoal();
  assert.ok(e, '달성');
  await a.waitForFunction(() => window.NSM.scene.celebrating, { timeout: 5000 });
  await b.waitForFunction(() => window.NSM.scene.celebrating, { timeout: 5000 });
  await a.waitForFunction(() => /그룹 목표 5시간을 달성했어요/.test(document.getElementById('chat-log').textContent), { timeout: 5000 });
  await b.waitForFunction(() => document.getElementById('coin-badge').querySelector('span').textContent === '10', { timeout: 5000 });
  assert.match(await a.$eval('#notify-list', (el) => el.textContent), /그룹 목표 5시간을 달성했어요/, '알림 벨');
  await a.click('#room-name');
  await a.waitForFunction(() => /달성 🎆/.test(document.getElementById('study-week-text').textContent), { timeout: 5000 });
  await a.click('#room-name');

  // A 나가기 → 로비 (내 스터디 카드에 달성 표시·접속 1명), 다시 카드 클릭 → 비밀번호 없이(방장) 입장
  a.once('dialog', (d) => d.accept());
  await a.click('#btn-leave');
  await a.waitForSelector('#lobby:not([hidden])', { timeout: 10000 });
  await a.waitForFunction(() => document.querySelector('#lobby-mine .study-card'), { timeout: 5000 });
  const card = await a.$eval('#lobby-mine .study-card', (el) => el.textContent);
  assert.match(card, /🔒 새벽 코딩방/);
  assert.match(card, /1\/3/);
  assert.match(card, /★ 방장/);
  assert.match(card, /달성 🎆/);
  assert.equal(await a.evaluate(() => localStorage.getItem('nsm.lastStudy')), null, '나가면 마지막 스터디를 잊는다');
  await a.click('#lobby-mine .study-card');
  await a.waitForFunction(() => window.NSM.scene.me && document.getElementById('lobby').hidden, { timeout: 15000 });
  assert.equal(await a.$eval('#room-count span', (el) => el.textContent), '2');
  // B: 새 탭(같은 컨텍스트)은 마지막 스터디로 자동 입장 (토큰 이어받기, 비밀번호 안 물음)
  const ctxB = b.browserContext();
  await b.close();
  const b2 = await ctxB.newPage();
  b2.on('pageerror', (er) => errors.push(er.message));
  await b2.setViewport({ width: 1200, height: 800 });
  await b2.goto(`${base}/`, { waitUntil: 'networkidle0', timeout: 60000 });
  await b2.waitForFunction(() => window.NSM && window.NSM.scene.me, { timeout: 30000 });
  assert.equal(await b2.$eval('#login', (el) => el.hidden), true);
  assert.equal(await b2.$eval('#study-pass', (el) => el.hidden), true);
  assert.equal(await b2.evaluate(() => window.NSM.net.session.resumed), true);

  // C: 같은 닉네임(멤버B)이라도 새 기기(새 컨텍스트, 토큰 없음)면 비밀번호 모달. B2 는 나가 있다
  b2.once('dialog', (d) => d.accept());
  await b2.click('#btn-leave');
  await b2.waitForSelector('#lobby:not([hidden])', { timeout: 10000 });
  const c = await newPage(`${base}/?study=${study.code}`);
  await c.type('#login-nick', '멤버B');
  await c.click('#login-submit');
  await c.waitForSelector('#study-pass:not([hidden])', { timeout: 15000 });
  await c.type('#sp-pass', 'abcd');
  await c.click('#sp-submit');
  await c.waitForFunction(() => window.NSM && window.NSM.scene.me, { timeout: 30000 });
  assert.equal(await c.evaluate(() => window.NSM.net.session.self.nickname), '멤버B');
  const accessC = await accessOf(c);
  assert.ok(accessC && accessC !== accessB, '기기마다 다른 토큰');
  // B2 는 토큰이 있으니 카드 클릭으로 바로 (같은 닉네임이 접속 중이라 이름엔 번호가 붙는다)
  await b2.click('#lobby-mine .study-card');
  await b2.waitForFunction(() => window.NSM.scene.me && document.getElementById('lobby').hidden, { timeout: 15000 });
  assert.equal(await b2.$eval('#study-pass', (el) => el.hidden), true);
  assert.equal(await accessOf(b2), accessB);

  // 방장이 비밀번호를 바꾸면: 방 안 다른 기기는 알림 + 저장한 토큰 삭제, 방장 기기는 새 토큰. 다음 입장 때 다시 입력
  await a.click('#room-name');
  await a.waitForFunction(() => !document.getElementById('pop-study').hidden && document.getElementById('study-members').children.length > 0, { timeout: 5000 });
  await a.$eval('#study-owner', (el) => { el.open = true; });
  const accessA = await accessOf(a);
  await a.type('#study-edit-pass', 'efgh');
  await a.click('#study-edit-form button[type="submit"]');
  // (뒤로 간 탭은 rAF 가 멈출 수 있어 폴링을 시간 기준으로)
  await b2.waitForFunction(() => /비밀번호를 바꿨어요/.test(document.getElementById('notify-list').textContent), { timeout: 5000, polling: 100 });
  assert.equal(await accessOf(b2), null, '다른 기기의 토큰은 지운다');
  await a.waitForFunction((c2, old) => localStorage.getItem(`nsm.study.access.${c2}`) && localStorage.getItem(`nsm.study.access.${c2}`) !== old, { timeout: 5000, polling: 100 }, study.code, accessA);
  assert.match(await accessOf(a), /^[A-Za-z0-9_-]{43}$/, '방장 기기는 새 토큰');
  await a.click('#room-name');
  b2.once('dialog', (d) => d.accept());
  await b2.click('#btn-leave');
  await b2.waitForSelector('#lobby:not([hidden])', { timeout: 10000 });
  await b2.click('#lobby-mine .study-card');
  await b2.waitForSelector('#study-pass:not([hidden])', { timeout: 15000 });
  await b2.type('#sp-pass', 'abcd');
  await b2.click('#sp-submit');
  await b2.waitForFunction(() => { const e = document.getElementById('sp-error'); return !e.hidden && /남은 횟수/.test(e.textContent); }, { timeout: 10000, polling: 100 });
  await b2.$eval('#sp-pass', (el) => { el.value = ''; });
  await b2.type('#sp-pass', 'efgh');
  await b2.click('#sp-submit');
  await b2.waitForFunction(() => window.NSM.scene.me && document.getElementById('lobby').hidden, { timeout: 30000, polling: 100 });
  assert.ok((await accessOf(b2)) && (await accessOf(b2)) !== accessB, '새 토큰');
  assert.deepEqual(errors, []);
});
