'use strict';
/** 채팅: 200자 제한, HTML 이스케이프, 도배 방지(300ms). */
const MAX_LEN = 200;
const MIN_INTERVAL_MS = 300;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** 반환: { ok: true, text } | { ok: false, error } — text 는 이미 HTML 이스케이프된 문자열 */
function sanitizeChat(raw) {
  if (typeof raw !== 'string') return { ok: false, error: 'empty' };
  const text = raw.replace(CONTROL_CHARS, '').trim();
  if (!text) return { ok: false, error: 'empty' };
  if ([...text].length > MAX_LEN) return { ok: false, error: 'too_long' };
  return { ok: true, text: escapeHtml(text) };
}

/** 키(플레이어 id)별 마지막 전송 시각으로 도배를 막는다. */
function createRateLimiter(intervalMs = MIN_INTERVAL_MS) {
  const last = new Map();
  return {
    allow(key, now = Date.now()) {
      const prev = last.get(key) || 0;
      if (now - prev < intervalMs) return false;
      last.set(key, now);
      return true;
    },
    forget(key) {
      last.delete(key);
    },
  };
}

module.exports = { MAX_LEN, MIN_INTERVAL_MS, escapeHtml, sanitizeChat, createRateLimiter };
