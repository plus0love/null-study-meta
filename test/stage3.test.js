'use strict';
/**
 * 3단계: 커피 상호작용 · 듣는 중 · oEmbed 프록시(네트워크 없이 가짜 fetch) · 시간대 가중치 · 유튜브 URL 파싱.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { World } = require('../server/game/world');
const { fetchOembedTitle } = require('../server/index');
const { getStudyRoom } = require('../server/rooms/studyroom');
const Daylight = require('../public/js/daylight');
const Music = require('../public/js/music');
const { boot, connect, joinAs, ask, once } = require('./helpers');

const room = getStudyRoom();

function makeWorld() {
  let t = 1000;
  const world = new World(room, { now: () => t, npc: { autoStart: false } });
  world.tick = (ms) => { t += ms; };
  return world;
}

test('월드: 커피머신 앞에서 E → coffee(☕ 휴식), 다시 E → 휴식, 앉으면 공부 → 일어나면 휴식(커피 아님), 거리 검사', () => {
  const w = makeWorld();
  const p = w.join({ nickname: '민수', socketId: 's1' }).player;
  const coffee = room.interactables.find((i) => i.id === 'coffee');
  assert.equal(w.interact(p, 'coffee').error, 'too_far');
  assert.equal(w.interact(p, 'nope').error, 'no_interactable');
  p.x = coffee.x + 20;
  p.y = coffee.y;
  assert.deepEqual(w.interact(p, 'coffee'), { ok: true, kind: 'coffee', status: 'coffee' });
  assert.equal(p.status, 'coffee');
  assert.equal(w.interact(p, 'coffee').status, 'rest', '다시 누르면 휴식');
  assert.equal(w.interact(p, 'coffee').status, 'coffee');
  // 커피 중에 앉으면 공부 중, 일어나면 커피가 아니라 휴식
  const seat = room.seats[0];
  p.x = (seat.x + 0.5) * 32;
  p.y = (seat.y + 1) * 32;
  assert.equal(w.sit(p, seat.id).ok, true);
  assert.equal(p.status, 'study');
  assert.equal(w.interact(p, 'coffee').error, 'too_far');
  p.x = coffee.x; // 앉은 채로 좌표만 커피머신 앞이라면 (테스트용) → seated
  p.y = coffee.y;
  assert.equal(w.interact(p, 'coffee').error, 'seated');
  w.stand(p);
  assert.equal(p.status, 'rest');
  // 수동 토글로는 coffee 를 고를 수 없다
  assert.equal(w.setStatus(p, 'coffee').ok, false);
  assert.equal(w.setStatus(p, 'study').ok, true);
  // 음악 패널은 거리만 확인
  const music = room.interactables.find((i) => i.id === 'music');
  p.x = music.x;
  p.y = music.y + 10;
  assert.deepEqual(w.interact(p, 'music'), { ok: true, kind: 'music' });
  w.dispose();
});

test('월드: 듣는 중 제목 — 80자 자르기, 제어 문자 제거, null 로 해제, 공개 정보에 포함', () => {
  const w = makeWorld();
  const p = w.join({ nickname: '민수', socketId: 's1' }).player;
  assert.deepEqual(w.setListening(p, 'lofi hip hop radio'), { ok: true, listening: 'lofi hip hop radio' });
  assert.equal(w.publicPlayer(p).listening, 'lofi hip hop radio');
  assert.equal(w.setListening(p, `\x07${'a'.repeat(100)}`).listening.length, 80);
  assert.equal(w.setListening(p, 12).ok, false);
  assert.deepEqual(w.setListening(p, null), { ok: true, listening: null });
  assert.equal(w.setListening(p, '   ').listening, null);
  assert.equal(w.publicPlayer(p).listening, null);
  w.dispose();
});

test('소켓 E2E: interact(커피) → 모두에게 playerStatus coffee, listening → playerListening, 입장 목록에도 포함', async (t) => {
  const srv = await boot({ world: { npc: { autoStart: false } } });
  t.after(() => srv.close());
  const a = connect(srv.port);
  const b = connect(srv.port);
  t.after(() => { a.close(); b.close(); });
  const ja = await joinAs(a, { nickname: 'A' });
  await joinAs(b, { nickname: 'B' });
  const coffee = room.interactables.find((i) => i.id === 'coffee');
  assert.equal((await ask(a, 'interact', { id: 'coffee' })).error, 'too_far');
  const pa = srv.world.players.get(ja.self.id);
  pa.x = coffee.x;
  pa.y = coffee.y;
  const st = once(b, 'playerStatus');
  assert.deepEqual(await ask(a, 'interact', { id: 'coffee' }), { ok: true, kind: 'coffee', status: 'coffee' });
  assert.deepEqual(await st, { id: ja.self.id, status: 'coffee' });

  const ls = once(b, 'playerListening');
  assert.deepEqual(await ask(a, 'listening', { title: 'Study With Me' }), { ok: true, listening: 'Study With Me' });
  assert.deepEqual(await ls, { id: ja.self.id, listening: 'Study With Me' });
  const c = connect(srv.port);
  t.after(() => c.close());
  const jc = await joinAs(c, { nickname: 'C' });
  const seenA = jc.players.find((p) => p.id === ja.self.id);
  assert.equal(seenA.listening, 'Study With Me');
  assert.equal(seenA.status, 'coffee');
  const off = once(b, 'playerListening');
  await ask(a, 'listening', { title: null });
  assert.equal((await off).listening, null);
});

test('oEmbed 프록시: 유튜브 주소만, 가짜 fetch 로 제목을 받아 캐시한다 (실제 네트워크 없음)', async () => {
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(url);
    return { ok: true, json: async () => ({ title: 'lofi hip hop radio 📚', author_name: 'Lofi Girl' }) };
  };
  const cache = new Map();
  assert.deepEqual(await fetchOembedTitle('not a url', fakeFetch, cache), { ok: false, error: 'invalid_url' });
  assert.deepEqual(await fetchOembedTitle('https://example.com/watch?v=jfKfPfyJRdk', fakeFetch, cache), { ok: false, error: 'not_youtube' });
  assert.equal(calls.length, 0);
  const r = await fetchOembedTitle('https://www.youtube.com/watch?v=jfKfPfyJRdk', fakeFetch, cache);
  assert.deepEqual(r, { ok: true, title: 'lofi hip hop radio 📚', author: 'Lofi Girl' });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^https:\/\/www\.youtube\.com\/oembed\?format=json&url=https%3A%2F%2Fwww\.youtube\.com%2Fwatch%3Fv%3DjfKfPfyJRdk$/);
  await fetchOembedTitle('https://www.youtube.com/watch?v=jfKfPfyJRdk', fakeFetch, cache);
  assert.equal(calls.length, 1, '캐시');
  const failing = async () => { throw new Error('offline'); };
  assert.deepEqual(await fetchOembedTitle('https://youtu.be/abcdefghijk', failing, new Map()), { ok: false, error: 'upstream_failed' });
  const notFound = async () => ({ ok: false, status: 404 });
  assert.deepEqual(await fetchOembedTitle('https://youtu.be/abcdefghijk', notFound, new Map()), { ok: false, error: 'upstream_404' });
});

test('서버: /api/oembed 는 주입한 fetch 를 쓴다', async (t) => {
  const srv = await boot({ fetch: async () => ({ ok: true, json: async () => ({ title: 'T', author_name: 'A' }) }) });
  t.after(() => srv.close());
  const base = `http://127.0.0.1:${srv.port}`;
  const ok = await fetch(`${base}/api/oembed?url=${encodeURIComponent('https://youtu.be/abcdefghijk')}`);
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { ok: true, title: 'T', author: 'A' });
  const bad = await fetch(`${base}/api/oembed?url=https://example.com/x`);
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error, 'not_youtube');
});

test('시간대: 06~17 낮, 17~19 노을, 19~06 밤, 경계 ±15분 부드럽게, 가중치 합 1', () => {
  const W = Daylight.weightsAt;
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  assert.deepEqual(W(12), { day: 1, sunset: 0, night: 0 });
  assert.deepEqual(W(3), { day: 0, sunset: 0, night: 1 });
  assert.deepEqual(W(18), { day: 0, sunset: 1, night: 0 });
  assert.deepEqual(W(22.5), { day: 0, sunset: 0, night: 1 });
  assert.deepEqual(W(5.75), { day: 0, sunset: 0, night: 1 });
  assert.deepEqual(W(6.25), { day: 1, sunset: 0, night: 0 });
  const d6 = W(6);
  assert.ok(near(d6.day, 0.5) && near(d6.night, 0.5), JSON.stringify(d6));
  const d17 = W(17);
  assert.ok(near(d17.day, 0.5) && near(d17.sunset, 0.5));
  const d19 = W(19);
  assert.ok(near(d19.sunset, 0.5) && near(d19.night, 0.5));
  // 단조: 16:45 → 17:15 낮이 줄고 노을이 는다
  let prev = W(16.75);
  for (let h = 16.76; h <= 17.25; h += 0.01) {
    const w = W(h);
    assert.ok(w.day <= prev.day + 1e-9 && w.sunset >= prev.sunset - 1e-9, `단조 ${h}`);
    assert.ok(near(w.day + w.sunset + w.night, 1));
    prev = w;
  }
  assert.equal(Daylight.phaseOf(W(12)), 'day');
  assert.equal(Daylight.phaseOf(W(18)), 'sunset');
  assert.equal(Daylight.phaseOf(W(1)), 'night');
  assert.equal(W(25).day, W(1).day, '24시간 감싸기');
  // 하늘 색: 낮은 밝고 밤은 어둡다, 노을 아래쪽은 주황
  const day = Daylight.skyStops(W(12));
  const night = Daylight.skyStops(W(0));
  const sunset = Daylight.skyStops(W(18));
  assert.equal(day.length, 10);
  assert.ok(parseInt(day[0].slice(1, 3), 16) > parseInt(night[0].slice(1, 3), 16));
  assert.ok(parseInt(sunset[9].slice(1, 3), 16) > 0xe0 && parseInt(sunset[9].slice(5, 7), 16) < 0x90, `노을 아래 ${sunset[9]}`);
  assert.ok(parseInt(sunset[0].slice(5, 7), 16) > parseInt(sunset[0].slice(1, 3), 16), `노을 위는 보라 ${sunset[0]}`);
  const amb = Daylight.ambient(W(12));
  assert.ok(amb.darkness < Daylight.ambient(W(0)).darkness && amb.glow < 1 && amb.dayLayer === 1);
});

test('유튜브 URL 파싱: watch/youtu.be/shorts/embed/live/재생목록/ID, 아닌 것은 null, 최근 5개 중복 제거', () => {
  const P = Music.parseYoutube;
  assert.deepEqual(P('https://www.youtube.com/watch?v=jfKfPfyJRdk'), { videoId: 'jfKfPfyJRdk', listId: null });
  assert.deepEqual(P('youtu.be/jfKfPfyJRdk?t=30'), { videoId: 'jfKfPfyJRdk', listId: null });
  assert.deepEqual(P('https://www.youtube.com/shorts/abcdefghijk'), { videoId: 'abcdefghijk', listId: null });
  assert.deepEqual(P('https://www.youtube.com/embed/abcdefghijk?rel=0'), { videoId: 'abcdefghijk', listId: null });
  assert.deepEqual(P('https://youtube.com/live/abcdefghijk'), { videoId: 'abcdefghijk', listId: null });
  assert.deepEqual(P('https://music.youtube.com/watch?v=abcdefghijk&list=RDAMVMabcdefghijk'), { videoId: 'abcdefghijk', listId: 'RDAMVMabcdefghijk' });
  assert.deepEqual(P('https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf'), { videoId: null, listId: 'PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf' });
  assert.deepEqual(P('jfKfPfyJRdk'), { videoId: 'jfKfPfyJRdk', listId: null });
  assert.equal(P('https://vimeo.com/12345'), null);
  assert.equal(P('https://www.youtube.com/'), null);
  assert.equal(P('javascript:alert(1)'), null);
  assert.equal(P(''), null);
  assert.equal(Music.canonicalUrl({ videoId: 'abcdefghijk' }), 'https://www.youtube.com/watch?v=abcdefghijk');
  let recent = [];
  for (let i = 0; i < 7; i++) recent = Music.pushRecent(recent, { videoId: `video000000${i}`.slice(-11), title: `t${i}` });
  assert.equal(recent.length, 5);
  assert.equal(recent[0].title, 't6');
  recent = Music.pushRecent(recent, { videoId: recent[3].videoId, title: 'again' });
  assert.equal(recent.length, 5);
  assert.equal(recent[0].title, 'again');
  assert.equal(new Set(recent.map(Music.keyOf)).size, 5);
});
