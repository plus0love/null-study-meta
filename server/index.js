'use strict';
/**
 * Express 서버: 정적 파일(public/) + /healthz + 방 데이터(JSON) + 유튜브 oEmbed 프록시 + Socket.io (server/socket.js).
 * 11단계: 스터디(방 인스턴스)는 Hub(server/game/hub.js) 가 관리한다. startServer 는 { hub } 를 돌려준다.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

// 프로젝트 루트 .env 를 Node 내장 파서로 읽는다 (dotenv 불필요). 이미 있는 환경변수는 덮어쓰지 않는다.
// 테스트(test/setup.js 가 STORE=memory 강제)에서는 실제 키가 프로세스에 들어오지 않도록 읽지 않는다.
const ENV_FILE = path.join(__dirname, '..', '.env');
if (process.env.STORE !== 'memory' && fs.existsSync(ENV_FILE)) {
  try {
    process.loadEnvFile(ENV_FILE);
  } catch (err) {
    console.warn(`[env] .env 를 읽지 못했습니다: ${err.message}`);
  }
}

const express = require('express');

const { createStore } = require('./store');
const { getStudyRoom } = require('./rooms/studyroom');
const { getOutdoor } = require('./rooms/outdoor');
const { attachSocket } = require('./socket');
const { createGate } = require('./gate');
const { CATALOG_PATH, assetFiles: avatarAssetFiles } = require('./game/avatar');
const { createShop } = require('./game/shop');

// 아틀라스/캐릭터/아바타 파츠 파일 해시 → 클라이언트가 ?v= 로 붙여 요청하므로 에셋을 다시 빌드하면 캐시가 자동 무효화된다
function assetVersion() {
  const dir = path.join(__dirname, '..', 'public', 'assets');
  const h = crypto.createHash('sha1');
  for (const f of ['tiles.json', 'tiles.png', 'dog.json', 'dog.png', 'furniture.json', 'furniture.png', 'pets.json', 'pets.png', 'petdeco.json', 'petdeco.png', 'vehicles.json', 'vehicles.png']) h.update(fs.readFileSync(path.join(dir, f)));
  for (const f of [CATALOG_PATH, ...avatarAssetFiles()]) h.update(fs.readFileSync(f));
  return h.digest('hex').slice(0, 10);
}
const ASSET_VERSION = assetVersion();

const OEMBED_TTL_MS = 10 * 60 * 1000;
const YT_HOSTS = new Set(['www.youtube.com', 'youtube.com', 'm.youtube.com', 'youtu.be', 'music.youtube.com']);

/**
 * 유튜브 oEmbed 프록시: 브라우저에서 직접 부르면 CORS 에 막히므로 서버가 대신 제목만 가져온다.
 * fetcher 를 바꿔치기할 수 있어 테스트는 실제 네트워크를 쓰지 않는다. 10분 캐시.
 */
async function fetchOembedTitle(url, fetcher, cache) {
  let u;
  try { u = new URL(url); } catch (_) { return { ok: false, error: 'invalid_url' }; }
  if (!YT_HOSTS.has(u.hostname)) return { ok: false, error: 'not_youtube' };
  const key = u.href;
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  const target = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(u.href)}`;
  let value;
  try {
    const res = await fetcher(target, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) value = { ok: false, error: `upstream_${res.status}` };
    else {
      const j = await res.json();
      value = { ok: true, title: String(j.title || '').slice(0, 120), author: String(j.author_name || '').slice(0, 80) };
    }
  } catch (err) {
    value = { ok: false, error: 'upstream_failed' };
  }
  cache.set(key, { value, until: Date.now() + OEMBED_TTL_MS });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return value;
}

/** ctx: { store, hub, shop, gate, fetch? } — hub 는 소켓을 붙인 뒤 채워진다 */
function createApp(ctx) {
  const app = express();
  app.disable('x-powered-by');
  const oembedCache = new Map();

  app.get('/api/oembed', async (req, res) => {
    const url = typeof req.query.url === 'string' ? req.query.url : '';
    const out = await fetchOembedTitle(url, ctx.fetch || globalThis.fetch, oembedCache);
    res.set('Cache-Control', 'no-cache');
    res.status(out.ok ? 200 : 400).json(out);
  });

  // 클라이언트가 입장 화면을 그리기 전에 알아야 하는 것 (비밀번호 칸 표시 여부). 값은 절대 내려가지 않는다.
  app.get('/api/config', (_req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.json({ passwordRequired: !!(ctx.gate && ctx.gate.enabled) });
  });

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, store: ctx.store.kind, uptime: Math.round(process.uptime()), node: process.version, players: ctx.hub ? ctx.hub.connectedCount : 0, studies: ctx.hub ? ctx.hub.studies.size : 0, worlds: ctx.hub ? ctx.hub.worlds.size : 0 });
  });

  // 9단계: 배치 규칙은 서버 모듈을 그대로 브라우저에도 내려보낸다 (window.Layout) — 미리보기 초록/빨강 판정이 서버와 같다
  app.get('/js/layout.js', (_req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.type('application/javascript').sendFile(path.join(__dirname, 'game', 'layout.js'));
  });

  // 9단계: 상점 카탈로그 (탭·카테고리·아이템 + 스프라이트 메타) — 씬이 가구를 그리고 배치 규칙을 미리 판정하는 데 쓴다
  app.get('/api/shop', (_req, res) => {
    res.set('Cache-Control', 'no-cache');
    const shop = ctx.shop || createShop();
    res.json({ tabs: shop.tabs, categories: shop.categories, items: shop.items });
  });

  // 12단계: 탈것 물리·검증도 서버 모듈을 그대로 브라우저에 (window.Vehicles) — 클라이언트 물리와 서버 검증이 같은 상수를 쓴다
  app.get('/js/vehicles.js', (_req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.type('application/javascript').sendFile(path.join(__dirname, 'game', 'vehicles.js'));
  });

  // 방 데이터 (레이어별 타일 배열 + 충돌/의자/문/조명). 12단계: /api/rooms/outdoor 는 공용 야외 (track 포함)
  app.get('/api/rooms/studyroom', (_req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.json({ ...getStudyRoom(), assetVersion: ASSET_VERSION });
  });
  app.get('/api/rooms/outdoor', (_req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.json({ ...getOutdoor(), assetVersion: ASSET_VERSION });
  });

  // 에셋을 다시 빌드해도 옛 아틀라스가 캐시에 남지 않도록 (1단계: 캐시 없이 ETag 로만 검증)
  app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: 0, etag: true, cacheControl: true }));
  return app;
}

/**
 * opts.world: World 옵션 (테스트용 — graceMs, pomodoro: { focusMs, breakMs }, study: { autoTick }, npc, shop)
 * opts.hub:   허브 옵션 (테스트용 — releaseMs, inactiveMs, goalCheckMs, gate: { maxFailures, lockMs }, now)
 * opts.gate:  사이트 게이트 옵션 (테스트용 — maxFailures, lockMs, now). 비밀번호 자체는 env.ROOM_PASSWORD 에서만 읽는다.
 */
async function startServer({ port = Number(process.env.PORT) || 3000, env = process.env, log = console, world: worldOpts = {}, hub: hubOpts = {}, gate: gateOpts = {}, fetch: fetcher = null } = {}) {
  const store = await createStore(env, log);
  const gate = createGate({ password: env.ROOM_PASSWORD || '', log, ...gateOpts });
  // Socket.io 는 기존 request 리스너를 감싸므로 Express 를 먼저 붙이고 나서 attach 한다
  const ctx = { store, hub: null, shop: createShop(worldOpts.shop), gate, fetch: fetcher };
  const app = createApp(ctx);
  const server = http.createServer(app);
  const { io, hub } = attachSocket(server, { room: getStudyRoom(), gate, world: { store, tz: env.STATS_TZ || undefined, log, ...worldOpts }, hub: hubOpts, log });
  ctx.hub = hub;
  await hub.init(); // 스터디 목록 · 저장된 공부 합계 · 옛 데이터 마이그레이션
  await new Promise((resolve) => server.listen(port, resolve));
  const actualPort = server.address().port;
  log.log(`[server] http://localhost:${actualPort}  store=${store.kind}${store.kind === 'memory' ? ' (영구 저장 없음)' : ''}  tz=${hub.tz}  password=${gate.enabled ? 'on' : 'off'}  studies=${hub.studies.size}  node=${process.version}`);

  // 종료: 진행 중인 공부 세션을 먼저 저장(SIGTERM 포함)하고 소켓·저장소를 닫는다
  let closing = null;
  const close = () => {
    if (!closing) {
      closing = (async () => {
        await hub.dispose();
        await new Promise((resolve) => io.close(() => resolve()));
        await store.close().catch(() => {});
      })();
    }
    return closing;
  };
  return { app, server, io, hub, store, gate, port: actualPort, close };
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

module.exports = { createApp, startServer, fetchOembedTitle };
