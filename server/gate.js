'use strict';
/**
 * 방 비밀번호 게이트 (6단계).
 *  - ROOM_PASSWORD 가 비어 있으면 비활성(누구나 입장).
 *  - 있으면 시작 시 scrypt(무작위 솔트)로 해시만 들고 있고, 입장 때 받은 값을 같은 방식으로 해시해 timingSafeEqual 로 비교한다.
 *  - 클라이언트(IP)별로 maxFailures 회 연속 실패하면 lockMs 동안 잠근다. 성공하면 카운터를 지운다.
 *  - 비밀번호 평문은 어디에도 남기지 않는다 (로그·에러·ack 모두).
 */
const crypto = require('node:crypto');

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 }; // 로그인 1회당 수십 ms — 무차별 대입을 늦추면서 입장은 체감 없음
const PASSWORD_MAX = 128;

function scrypt(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/**
 * @param {object} opts
 * @param {string} [opts.password]      ROOM_PASSWORD (비어 있으면 비활성)
 * @param {number} [opts.maxFailures=5] 연속 실패 허용 횟수
 * @param {number} [opts.lockMs=30000]  잠금 시간
 * @param {() => number} [opts.now]
 * @param {object} [opts.log]
 */
function createGate({ password = '', maxFailures = 5, lockMs = 30000, now = Date.now, log = console } = {}) {
  const secret = String(password ?? '');
  const enabled = secret.length > 0;
  const salt = crypto.randomBytes(16);
  const hashPromise = enabled ? scrypt(secret.slice(0, PASSWORD_MAX), salt) : null; // 후보도 같은 길이로 잘라 비교
  /** key(IP) → { failures, lockedUntil } */
  const attempts = new Map();

  if (enabled) {
    if (secret.length > PASSWORD_MAX) log.warn(`[gate] ROOM_PASSWORD 가 ${PASSWORD_MAX}자를 넘습니다 — 앞 ${PASSWORD_MAX}자만 비교합니다`);
    log.log(`[gate] 방 비밀번호 사용 (${maxFailures}회 실패 시 ${Math.round(lockMs / 1000)}초 잠금)`);
  }

  function entry(key) {
    let e = attempts.get(key);
    if (!e) {
      e = { failures: 0, lockedUntil: 0 };
      attempts.set(key, e);
    }
    return e;
  }

  /** 잠겨 있으면 남은 ms, 아니면 0 */
  function lockedFor(key) {
    const e = attempts.get(key);
    if (!e) return 0;
    const left = e.lockedUntil - now();
    return left > 0 ? left : 0;
  }

  /**
   * @returns {Promise<{ ok: true } | { ok: false, error: 'password_required' | 'wrong_password' | 'locked', remaining?: number, retryAfterMs?: number }>}
   */
  async function check(key, candidate) {
    if (!enabled) return { ok: true };
    if (attempts.size > 1000) prune();
    const left = lockedFor(key);
    if (left > 0) return { ok: false, error: 'locked', retryAfterMs: left };
    if (typeof candidate !== 'string' || candidate.length === 0) return { ok: false, error: 'password_required' };

    const expected = await hashPromise;
    const got = await scrypt(candidate.slice(0, PASSWORD_MAX), salt);
    if (crypto.timingSafeEqual(expected, got)) {
      attempts.delete(key);
      return { ok: true };
    }
    // 실패 카운트 (해시 계산 중 잠긴 경우도 있으므로 다시 확인)
    const e = entry(key);
    if (e.lockedUntil > now()) return { ok: false, error: 'locked', retryAfterMs: e.lockedUntil - now() };
    e.failures += 1;
    if (e.failures >= maxFailures) {
      e.failures = 0;
      e.lockedUntil = now() + lockMs;
      log.warn(`[gate] 비밀번호 ${maxFailures}회 실패 → ${Math.round(lockMs / 1000)}초 잠금 (${key})`);
      return { ok: false, error: 'locked', retryAfterMs: lockMs };
    }
    log.warn(`[gate] 비밀번호 실패 ${e.failures}/${maxFailures} (${key})`);
    return { ok: false, error: 'wrong_password', remaining: maxFailures - e.failures };
  }

  /** 오래된 항목 정리 (잠금이 끝났고 실패도 없는 것) */
  function prune() {
    const t = now();
    for (const [k, e] of attempts) if (e.failures === 0 && e.lockedUntil <= t) attempts.delete(k);
  }

  return { enabled, maxFailures, lockMs, check, lockedFor, prune, get size() { return attempts.size; } };
}

/** 소켓 → 잠금 카운터 키. 프록시(Render) 뒤에서는 X-Forwarded-For 의 첫 IP, 아니면 연결 주소 */
function clientKey(socket) {
  const xff = socket.handshake && socket.handshake.headers && socket.handshake.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) return xff.split(',')[0].trim();
  return (socket.handshake && socket.handshake.address) || 'unknown';
}

module.exports = { createGate, clientKey, PASSWORD_MAX };
