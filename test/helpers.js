'use strict';
/**
 * 소켓/브라우저 테스트 공용 도우미: 서버 띄우기, 클라이언트 접속, 지연 프록시, 이벤트 대기.
 * 11단계: boot() 는 기본 스터디('테스트 스터디') 를 하나 만들고 그 월드를 미리 띄워 srv.study / srv.world / srv.code (잠겼으면 srv.access = 방장 기기 토큰) 로 돌려준다.
 *   joinAs() 는 payload.study 가 없으면 그 서버(포트)의 기본 스터디 코드를 채운다 → 예전 테스트는 그대로 동작한다.
 *   pageUrl(srv) 는 브라우저가 로비를 거치지 않고 기본 스터디로 바로 들어가는 주소 (?study=CODE).
 */
const fs = require('node:fs');
const net = require('node:net');
const { io } = require('socket.io-client');
const { startServer } = require('../server/index');

const quiet = { log() {}, warn() {}, error() {} };
const defaultCodeByPort = new Map(); // 서버 포트 → 기본 스터디 코드

/** 로컬 Chrome 경로 (CHROME_PATH 우선). 없으면 null → 브라우저 테스트는 건너뛴다 */
function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) || null;
}
const CHROME = findChrome();
// 뒤의 세 옵션: 탭이 여러 개일 때 뒤로 간 탭의 rAF·타이머를 늦추지 않는다 (Phaser 씬 시계가 멈춰 이동 전송·지연 호출이 밀리던 원인)
const CHROME_ARGS = ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'];

/**
 * 서버 + 기본 스터디. opts.study 로 스터디 설정을 바꿀 수 있다 ({ name, password, maxPlayers, weeklyGoalMinutes, editPolicy, ownerNickname }).
 * opts.study === false 면 스터디를 만들지 않는다 (로비 테스트).
 */
async function boot({ study: studyOpts = {}, ...opts } = {}) {
  const srv = await startServer({ port: 0, log: quiet, ...opts });
  if (studyOpts !== false) {
    const r = await srv.hub.createStudy({ name: '테스트 스터디', ownerNickname: '방장', ...studyOpts });
    if (!r.ok) throw new Error(`기본 스터디 생성 실패: ${r.error}`);
    srv.study = r.study;
    srv.code = r.study.code;
    srv.access = r.access || null; // 잠긴 스터디면 만든 기기(방장)의 접근 토큰
    srv.world = await srv.hub.ensureWorld(r.study.id);
    defaultCodeByPort.set(String(srv.port), r.study.code);
  }
  return srv;
}

function connect(port, extra = {}) {
  return io(`http://127.0.0.1:${port}`, { transports: ['websocket'], reconnection: false, forceNew: true, ...extra });
}

/** 소켓이 붙은 서버 포트의 기본 스터디 코드 (지연 프록시를 거치면 프록시가 알려 준 원 포트) */
function defaultCodeOf(socket) {
  let port = '';
  try { port = new URL(socket.io.uri).port; } catch (_) { /* uri 없음 */ }
  return defaultCodeByPort.get(String(port)) || null;
}

function joinAs(socket, payload = {}) {
  const p = { ...payload };
  if (p.study === undefined) {
    const code = defaultCodeOf(socket);
    if (code) p.study = code;
  }
  return new Promise((resolve) => socket.emit('join', p, resolve));
}

function ask(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

/**
 * 설정 팝오버 열기: 열리면서 지갑을 다시 받아 슬롯·펫 목록을 다시 그리므로(레이아웃이 움직인다) 그게 끝날 때까지 기다린다.
 * (여기서 바로 클릭하면 요소가 밀려 캔버스를 누르는 일이 가끔 있었다)
 */
async function openSettings(page) {
  await page.click('#btn-settings');
  await page.waitForFunction(() => !document.getElementById('pop-settings').hidden && !window.NSM.ui.walletBusy, { timeout: 10000 });
}

/** 브라우저가 로비 없이 바로 기본 스터디로 들어가는 주소 */
function pageUrl(srv, port = srv.port) {
  return `http://127.0.0.1:${port}/?study=${srv.code}`;
}

/** 이벤트를 한 번 기다린다 (타임아웃 시 reject) */
function once(socket, event, { timeout = 3000, filter = () => true } = {}) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      socket.off(event, h);
      reject(new Error(`'${event}' 이벤트를 ${timeout}ms 안에 받지 못함`));
    }, timeout);
    const h = (data) => {
      if (!filter(data)) return;
      clearTimeout(t);
      socket.off(event, h);
      resolve(data);
    };
    socket.on(event, h);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 특정 이벤트를 모아 두는 수집기 */
function collect(socket, event) {
  const items = [];
  socket.on(event, (d) => items.push(d));
  return items;
}

/**
 * TCP 지연 프록시: 양방향 모두 delayMs 만큼 늦게 전달한다 (인위적 네트워크 지연).
 * 반환: { port, close }. 프록시 포트로 붙은 소켓도 joinAs 가 기본 스터디를 찾도록 원 포트의 코드를 같이 등록한다.
 */
async function startDelayProxy(targetPort, delayMs) {
  const sockets = new Set();
  const server = net.createServer((client) => {
    const upstream = net.connect(targetPort, '127.0.0.1');
    sockets.add(client);
    sockets.add(upstream);
    const pipeDelayed = (from, to) => {
      from.on('data', (chunk) => {
        setTimeout(() => {
          if (!to.destroyed) to.write(chunk);
        }, delayMs);
      });
      from.on('end', () => setTimeout(() => !to.destroyed && to.end(), delayMs));
      from.on('error', () => to.destroy());
      from.on('close', () => sockets.delete(from));
    };
    pipeDelayed(client, upstream);
    pipeDelayed(upstream, client);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  if (defaultCodeByPort.has(String(targetPort))) defaultCodeByPort.set(String(port), defaultCodeByPort.get(String(targetPort)));
  return {
    port,
    close: () =>
      new Promise((r) => {
        for (const s of sockets) s.destroy();
        server.close(() => r());
      }),
  };
}

module.exports = { boot, connect, joinAs, ask, once, sleep, collect, startDelayProxy, quiet, pageUrl, openSettings, findChrome, CHROME, CHROME_ARGS };
