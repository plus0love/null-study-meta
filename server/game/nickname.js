'use strict';
/**
 * 닉네임 규칙: 문자(한글·영문 등 유니코드 글자)·숫자·공백·_ - 만 허용, 1~12자.
 * 앞뒤 공백은 잘라내고, 연속 공백은 하나로 줄인다.
 * 중복이면 "이름2", "이름3" … 처럼 뒤에 숫자를 붙인다 (12자를 넘지 않도록 앞부분을 줄임).
 */
const MAX_LEN = 12;
const VALID = /^[\p{L}\p{N} _-]+$/u;

function normalizeNickname(raw) {
  if (typeof raw !== 'string') return { ok: false, error: '닉네임을 입력하세요.' };
  const name = raw.trim().replace(/\s+/g, ' ');
  if (!name) return { ok: false, error: '닉네임을 입력하세요.' };
  if ([...name].length > MAX_LEN) return { ok: false, error: `닉네임은 ${MAX_LEN}자 이하여야 합니다.` };
  if (!VALID.test(name)) return { ok: false, error: '닉네임은 문자·숫자·공백·_ - 만 쓸 수 있습니다.' };
  return { ok: true, name };
}

/** taken: 이미 쓰이는 닉네임 목록/집합 (대소문자 구분 없음) */
function uniqueNickname(name, taken) {
  const lower = new Set([...taken].map((n) => n.toLowerCase()));
  if (!lower.has(name.toLowerCase())) return name;
  for (let n = 2; n < 10000; n++) {
    const suffix = String(n);
    const base = [...name].slice(0, MAX_LEN - suffix.length).join('').trimEnd();
    const candidate = `${base}${suffix}`;
    if (!lower.has(candidate.toLowerCase())) return candidate;
  }
  throw new Error('닉네임을 만들 수 없습니다.');
}

module.exports = { normalizeNickname, uniqueNickname, MAX_LEN };
