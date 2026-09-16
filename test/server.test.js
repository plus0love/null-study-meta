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

  const html = await fetch(`${base}/`).then((r) => r.text());
  assert.match(html, /우리의 스터디룸/);
  assert.match(html, /phaser/);

  const room = await fetch(`${base}/api/rooms/studyroom`).then((r) => r.json());
  assert.equal(room.width, 46);
  assert.equal(room.height, 34);

  const tiles = await fetch(`${base}/assets/tiles.json`).then((r) => r.json());
  assert.equal(tiles.tileSize, 32);
  const png = await fetch(`${base}/assets/tiles.png`);
  assert.equal(png.status, 200);
  assert.equal(png.headers.get('content-type'), 'image/png');
});
