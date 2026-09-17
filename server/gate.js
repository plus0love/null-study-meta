'use strict';
/**
 * 비밀번호 게이트 (6단계 사이트 비밀번호 + 11단계 스터디 비밀번호).
 *  - createGate: ROOM_PASSWORD(사이트 전체 입장 비밀번호). 비어 있으면 비활성(누구나 입장).
 *    있으면 시작 시 scrypt(무작위 솔트)로 해시만 들고 있고, 입장 때 받은 값을 같은 방식으로 해시해 timingSafeEqual 로 비교한다.
 *  - createAttempts: 클라이언트(IP 등 키)별로 maxFailures 회 연속 실패하면 lockMs 동안 잠근다. 성공하면 카운터를 지운다.
 *    사이트 게이트와 스터디 게이트가 같은 규칙(5회 실패 → 30초 잠금)을 공유한다.
 *  - hashPassword / verifyPassword: 스터디 비밀번호는 저장소에 `scrypt$<salt>$<hash>` 문자열로 둔다 (평문 저장 안 함).
 *  - createStudyGate: 스터디별 저장된 해시와 후보를 비교 + 잠금 카운터 (키 = `${ip}|${studyId}`).
 *  - newAccessToken / hashToken: 비밀번호를 맞춘 "기기"에 주는 study_access 토큰(무작위 32바이트, base64url).
 *    서버는 sha256 해시만 저장하고(study_access.token_hash) 클라이언트가 localStorage 에 원문을 둔다.
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

/** 저장용 해시 문자열 `scrypt$<saltHex>$<hashHex>` */
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(password).slice(0, PASSWORD_MAX), salt);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

/** 후보가 저장된 해시와 맞는지 (형식이 이상하면 false) */
async function verifyPassword(candidate, stored) {
  if (typeof candidate !== 'string' || typeof stored !== 'string') return false;
  const [algo, saltHex, hashHex] = stored.split('$');
  if (algo !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const got = await scrypt(candidate.slice(0, PASSWORD_MAX), Buffer.from(saltHex, 'hex'));
  return expected.length === got.length && crypto.timingSafeEqual(expected, got);
}

/**
 * 실패 카운터 + 잠금. key(IP 등) → { failures, lockedUntil }
 * @param {object} opts
 * @param {number} [opts.maxFailures=5] 연속 실패 허용 횟수
 * @param {number} [opts.lockMs=30000]  잠금 시간
 * @param {() => number} [opts.now]
 * @param {object} [opts.log]
 * @param {string} [opts.label]         로그 접두어
 */
function createAttempts({ maxFailures = 5, lockMs = 30000, now = Date.now, log = console, label = 'gate' } = {}) {
  const attempts = new Map();

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

  /** 실패 기록 → 거부 응답 (잠금이면 locked, 아니면 wrong_password + 남은 횟수) */
  function fail(key) {
    if (attempts.size > 1000) prune();
    const e = entry(key);
    if (e.lockedUntil > now()) return { ok: false, error: 'locked', retryAfterMs: e.lockedUntil - now() };
    e.failures += 1;
    if (e.failures >= maxFailures) {
      e.failures = 0;
      e.lockedUntil = now() + lockMs;
      log.warn(`[${label}] 비밀번호 ${maxFailures}회 실패 → ${Math.round(lockMs / 1000)}초 잠금 (${key})`);
      return { ok: false, error: 'locked', retryAfterMs: lockMs };
    }
    log.warn(`[${label}] 비밀번호 실패 ${e.failures}/${maxFailures} (${key})`);
    return { ok: false, error: 'wrong_password', remaining: maxFailures - e.failures };
  }

  function succeed(key) {
    attempts.delete(key);
  }

  /** 오래된 항목 정리 (잠금이 끝났고 실패도 없는 것) */
  function prune() {
    const t = now();
    for (const [k, e] of attempts) if (e.failures === 0 && e.lockedUntil <= t) attempts.delete(k);
  }

  return { maxFailures, lockMs, lockedFor, fail, succeed, prune, get size() { return attempts.size; } };
}

/**
 * 사이트 게이트 (ROOM_PASSWORD).
 * @param {object} opts
 * @param {string} [opts.password]      ROOM_PASSWORD (비어 있으면 비활성)
 * @param {number} [opts.maxFailures=5]
 * @param {number} [opts.lockMs=30000]
 * @param {() => number} [opts.now]
 * @param {object} [opts.log]
 */
function createGate({ password = '', maxFailures = 5, lockMs = 30000, now = Date.now, log = console } = {}) {
  const secret = String(password ?? '');
  const enabled = secret.length > 0;
  const salt = crypto.randomBytes(16);
  const hashPromise = enabled ? scrypt(secret.slice(0, PASSWORD_MAX), salt) : null; // 후보도 같은 길이로 잘라 비교
  const attempts = createAttempts({ maxFailures, lockMs, now, log, label: 'gate' });

  if (enabled) {
    if (secret.length > PASSWORD_MAX) log.warn(`[gate] ROOM_PASSWORD 가 ${PASSWORD_MAX}자를 넘습니다 — 앞 ${PASSWORD_MAX}자만 비교합니다`);
    log.log(`[gate] 사이트 비밀번호 사용 (${maxFailures}회 실패 시 ${Math.round(lockMs / 1000)}초 잠금)`);
  }

  /**
   * @returns {Promise<{ ok: true } | { ok: false, error: 'password_required' | 'wrong_password' | 'locked', remaining?: number, retryAfterMs?: number }>}
   */
  async function check(key, candidate) {
    if (!enabled) return { ok: true };
    const left = attempts.lockedFor(key);
    if (left > 0) return { ok: false, error: 'locked', retryAfterMs: left };
    if (typeof candidate !== 'string' || candidate.length === 0) return { ok: false, error: 'password_required' };

    const expected = await hashPromise;
    const got = await scrypt(candidate.slice(0, PASSWORD_MAX), salt);
    if (crypto.timingSafeEqual(expected, got)) {
      attempts.succeed(key);
      return { ok: true };
    }
    return attempts.fail(key);
  }

  return { enabled, maxFailures, lockMs, check, lockedFor: attempts.lockedFor, prune: attempts.prune, get size() { return attempts.size; } };
}

/**
 * 스터디 게이트 (11단계): 스터디마다 다른 저장 해시. 키는 `${ip}|${studyId}` 로 스터디별 따로 센다.
 * check(key, candidate, storedHash) → { ok } | { ok:false, error: password_required | wrong_password | locked }
 */
function createStudyGate({ maxFailures = 5, lockMs = 30000, now = Date.now, log = console } = {}) {
  const attempts = createAttempts({ maxFailures, lockMs, now, log, label: 'study-gate' });
  async function check(key, candidate, storedHash) {
    if (!storedHash) return { ok: true };
    const left = attempts.lockedFor(key);
    if (left > 0) return { ok: false, error: 'locked', retryAfterMs: left };
    if (typeof candidate !== 'string' || candidate.length === 0) return { ok: false, error: 'password_required' };
    if (await verifyPassword(candidate, storedHash)) {
      attempts.succeed(key);
      return { ok: true };
    }
    return attempts.fail(key);
  }
  return { maxFailures, lockMs, check, lockedFor: attempts.lockedFor, prune: attempts.prune, get size() { return attempts.size; } };
}

/** 소켓 → 잠금 카운터 키. 프록시(Render) 뒤에서는 X-Forwarded-For 의 첫 IP, 아니면 연결 주소 */
/** 기기용 접근 토큰: 무작위 32바이트 → base64url (43자) */
function newAccessToken() {
  return crypto.randomBytes(32).toString('base64url');
}

/** 접근 토큰의 저장용 해시 (토큰 자체가 고엔트로피라 sha256 이면 충분). 형식이 아니면 null */
function hashToken(token) {
  if (typeof token !== 'string' || token.length < 16 || token.length > 128) return null;
  return crypto.createHash('sha256').update(token).digest('hex');
}

function clientKey(socket) {
  const xff = socket.handshake && socket.handshake.headers && socket.handshake.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) return xff.split(',')[0].trim();
  return (socket.handshake && socket.handshake.address) || 'unknown';
}

module.exports = { createGate, createStudyGate, createAttempts, hashPassword, verifyPassword, newAccessToken, hashToken, clientKey, PASSWORD_MAX };
