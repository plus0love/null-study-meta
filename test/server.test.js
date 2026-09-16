'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../server/index');

test('서버: /healthz, 정적 파일, 방 데이터', async (t) => {
  const srv = await startServer({ port: 0, log: { log() {}, warn() {} } });
  t.after(() => srv.close());
  const base = `http://127.0.0.1:${srv.port}`;

  const h = await fetch(`${base}/healthz`).then((r) => r.json());
  assert.equal(h.ok, true);
  assert.equal(h.store, 'memory');
  assert.equal(h.players, 0);

  const html = await fetch(`${base}/`).then((r) => r.text());
  assert.match(html, /우리의 스터디룸/);
  assert.match(html, /phaser/);
  assert.match(html, /Gaegu/);
  assert.match(html, /pretendard/i);
  assert.match(html, /socket\.io\/socket\.io\.js/);
  assert.match(html, /id="sidebar"/);

  // Socket.io 가 클라이언트 스크립트를 같은 서버에서 서빙
  const sio = await fetch(`${base}/socket.io/socket.io.js`);
  assert.equal(sio.status, 200);
  assert.match(sio.headers.get('content-type'), /javascript/);

  const room = await fetch(`${base}/api/rooms/studyroom`).then((r) => r.json());
  assert.equal(room.width, 46);
  assert.equal(room.height, 34);
  assert.match(room.assetVersion, /^[0-9a-f]{10}$/);

  const tiles = await fetch(`${base}/assets/tiles.json`).then((r) => r.json());
  assert.equal(tiles.tileSize, 32);
  const png = await fetch(`${base}/assets/tiles.png`);
  assert.equal(png.status, 200);
  assert.equal(png.headers.get('content-type'), 'image/png');
});
