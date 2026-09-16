'use strict';
/**
 * Express 서버: 정적 파일(public/) + /healthz + 방 데이터(JSON) + Socket.io (server/socket.js).
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const express = require('express');

const { createStore } = require('./store');
const { getStudyRoom } = require('./rooms/studyroom');
const { attachSocket } = require('./socket');

// 아틀라스/캐릭터 파일 해시 → 클라이언트가 ?v= 로 붙여 요청하므로 에셋을 다시 빌드하면 캐시가 자동 무효화된다
function assetVersion() {
  const dir = path.join(__dirname, '..', 'public', 'assets');
  const h = crypto.createHash('sha1');
  for (const f of ['tiles.json', 'tiles.png', 'player.json', 'player.png']) h.update(fs.readFileSync(path.join(dir, f)));
  return h.digest('hex').slice(0, 10);
}
const ASSET_VERSION = assetVersion();

/** ctx: { store, world } — world 는 소켓을 붙인 뒤 채워진다 */
function createApp(ctx) {
  const app = express();
  app.disable('x-powered-by');

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, store: ctx.store.kind, uptime: Math.round(process.uptime()), node: process.version, players: ctx.world ? ctx.world.connectedCount : 0 });
  });

  // 방 데이터 (레이어별 타일 배열 + 충돌/의자/문/조명)
  app.get('/api/rooms/studyroom', (_req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.json({ ...getStudyRoom(), assetVersion: ASSET_VERSION });
  });

  // 에셋을 다시 빌드해도 옛 아틀라스가 캐시에 남지 않도록 (1단계: 캐시 없이 ETag 로만 검증)
  app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: 0, etag: true, cacheControl: true }));
  return app;
}

/**
 * opts.world: World 옵션 (테스트용 — graceMs, pomodoro: { focusMs, breakMs })
 */
async function startServer({ port = Number(process.env.PORT) || 3000, env = process.env, log = console, world: worldOpts = {} } = {}) {
  const store = await createStore(env, log);
  // Socket.io 는 기존 request 리스너를 감싸므로 Express 를 먼저 붙이고 나서 attach 한다
  const ctx = { store, world: null };
  const app = createApp(ctx);
  const server = http.createServer(app);
  const { io, world } = attachSocket(server, { room: getStudyRoom(), world: worldOpts, log });
  ctx.world = world;
  await new Promise((resolve) => server.listen(port, resolve));
  const actualPort = server.address().port;
  log.log(`[server] http://localhost:${actualPort}  store=${store.kind}  node=${process.version}`);

  const close = () =>
    new Promise((resolve) => {
      world.dispose();
      io.close(() => store.close().then(resolve, resolve));
    });
  return { app, server, io, world, store, port: actualPort, close };
}

if (require.main === module) {
  startServer().then(({ close }) => {
    const shutdown = (sig) => {
      console.log(`[server] ${sig} → 종료`);
      close().then(() => process.exit(0));
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  });
}

module.exports = { createApp, startServer };
