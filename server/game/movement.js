'use strict';
/**
 * 이동 검증.
 *  - 발 박스(FEET_W x FEET_H, 발 중심 기준)의 네 모서리가 충돌 타일에 걸리지 않아야 한다 (클라이언트와 동일 판정).
 *  - 거리 예산: 마지막 이동 이후 "경과 시간 × 최대 속도 × 1.5" 만큼 예산이 쌓이고(상한 있음), 이동 거리만큼 소모한다.
 *    예산을 넘는 이동(순간이동·속도 해킹)은 거부한다.
 */
const { isBlocked } = require('../rooms/build');

const SPEED = 150; // px/s — 클라이언트와 공유 (join ack 의 config 로 내려간다)
const FEET_W = 18;
const FEET_H = 10;
const BUDGET_FACTOR = 1.5;
const BUDGET_CAP_MS = 500; // 예산 상한: 0.5초치 (지연 뒤 몰아서 오는 패킷은 허용, 순간이동은 차단)

function blockedAt(room, px, py) {
  return isBlocked(room, Math.floor(px / room.tileSize), Math.floor(py / room.tileSize));
}

function canStand(room, x, y) {
  const hw = FEET_W / 2;
  return (
    !blockedAt(room, x - hw, y - FEET_H) &&
    !blockedAt(room, x + hw - 1, y - FEET_H) &&
    !blockedAt(room, x - hw, y - 1) &&
    !blockedAt(room, x + hw - 1, y - 1)
  );
}

function maxBudget(speed = SPEED) {
  return (BUDGET_CAP_MS / 1000) * speed * BUDGET_FACTOR;
}

/**
 * mover: { x, y, budget, lastMoveAt } (플레이어 객체를 그대로 넘긴다)
 * 반환: { ok: true } 이면 mover 가 갱신됨, { ok: false, reason } 이면 그대로.
 */
function applyMove(room, mover, target, now, speed = SPEED) {
  const { x, y } = target;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, reason: 'invalid' };
  const elapsed = Math.max(0, now - (mover.lastMoveAt ?? now));
  const cap = maxBudget(speed);
  mover.budget = Math.min(cap, (mover.budget ?? cap) + (elapsed / 1000) * speed * BUDGET_FACTOR);
  mover.lastMoveAt = now;
  const dist = Math.hypot(x - mover.x, y - mover.y);
  if (dist > mover.budget + 1) return { ok: false, reason: 'too_fast' };
  if (!canStand(room, x, y)) return { ok: false, reason: 'blocked' };
  mover.budget -= dist;
  mover.x = x;
  mover.y = y;
  return { ok: true };
}

module.exports = { SPEED, FEET_W, FEET_H, BUDGET_FACTOR, BUDGET_CAP_MS, canStand, applyMove, maxBudget };
