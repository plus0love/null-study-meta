'use strict';
/**
 * Express 서버: 정적 파일(public/) + /healthz + 방 데이터(JSON).
 * Socket.io 는 다음 단계에서 붙인다.
 */
const http = require('node:http');
const path = require('node:path');
const express = require('express');

const { createStore } = require('./store');
const { getStudyRoom } = require('./rooms/studyroom');

function createApp({ store }) {
  const app = express();
  app.disable('x-powered-by');

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, store: store.kind, uptime: Math.round(process.uptime()), node: process.version });
  });

  // 방 데이터 (레이어별 타일 배열 + 충돌/의자/문/조명). 다음 단계에서는 소켓 init 으로도 전달.
  app.get('/api/rooms/studyroom', (_req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.json(getStudyRoom());
  });

  app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h', etag: true }));
  return app;
}

async function startServer({ port = Number(process.env.PORT) || 3000, env = process.env, log = console } = {}) {
  const store = await createStore(env, log);
  const app = createApp({ store });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(port, resolve));
  const actualPort = server.address().port;
  log.log(`[server] http://localhost:${actualPort}  store=${store.kind}  node=${process.version}`);

  const close = () =>
    new Promise((resolve) => {
      server.close(() => store.close().then(resolve, resolve));
    });
  return { app, server, store, port: actualPort, close };
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
