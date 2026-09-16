'use strict';
/** 소켓/브라우저 테스트 공용 도우미: 서버 띄우기, 클라이언트 접속, 지연 프록시, 이벤트 대기 */
const net = require('node:net');
const { io } = require('socket.io-client');
const { startServer } = require('../server/index');

const quiet = { log() {}, warn() {}, error() {} };

async function boot(opts = {}) {
  return startServer({ port: 0, log: quiet, ...opts });
}

function connect(port, extra = {}) {
  return io(`http://127.0.0.1:${port}`, { transports: ['websocket'], reconnection: false, forceNew: true, ...extra });
}

function joinAs(socket, payload) {
  return new Promise((resolve) => socket.emit('join', payload, resolve));
}

function ask(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
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
 * 반환: { port, close }
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
  return {
    port: server.address().port,
    close: () =>
      new Promise((r) => {
        for (const s of sockets) s.destroy();
        server.close(() => r());
      }),
  };
}

module.exports = { boot, connect, joinAs, ask, once, sleep, collect, startDelayProxy, quiet };
