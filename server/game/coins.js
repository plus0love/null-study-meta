'use strict';
/**
 * 코인 적립 규칙 (8단계, 순수 함수). 판정은 전부 서버가 하고 클라이언트는 결과만 받는다.
 *  - 공부 시간: 앉아서 공부 중인 동안 **10분이 찰 때마다 즉시 1코인** (StudyTracker 가 tick 마다 판정, 지난 세션에서 이월된 초 포함).
 *    세션이 끝나면 남은 초만 users.coin_carry_seconds 에 이월한다 (9분 + 9분 → 두 번째 세션 1분 시점에 1코인, 종료 시 480초 이월).
 *    60초 미만 세션은 폐기 규칙 그대로 — 코인도 이월도 없다. 기록 초기화 시 이월도 0.
 *  - 집중 완주 보너스: 개인 뽀모도로 집중 사이클이 끝날 때, 그 사이클 시작부터 끝까지 앉아서 공부 중이었으면 5코인.
 *    집중 시간이 20분 미만인 사이클은 보너스 없음. 사이클마다 한 번만 (World 가 사이클 시작 시각으로 이중 지급을 막는다).
 *    상태가 타이머를 따라 자동 전환될 때(휴식 → 집중) 세션이 사이클 시작 직후에 열리므로 FOCUS_START_SLACK_MS 안에 시작한 세션도 인정한다.
 * 원장(coin_ledger) reason: 'study' | 'focus' | 'purchase:<itemId>'
 */
const COIN_PER_SECONDS = 10 * 60; // 10분당 1코인
const FOCUS_BONUS = 5;
const FOCUS_BONUS_MIN_MS = 20 * 60 * 1000;
const FOCUS_START_SLACK_MS = 2000; // 사이클 시작 뒤 이 안에 열린 세션은 "시작 전부터" 로 본다 (자동 전환 시 시계 차이)

/** 저장된 세션 초 → 코인 (10분 단위 내림, 이월 없이) */
function coinsForSession(seconds) {
  const s = Math.floor(Number(seconds) || 0);
  return s > 0 ? Math.floor(s / COIN_PER_SECONDS) : 0;
}

/**
 * 이월 정산: 지난 세션들의 남은 초(carrySeconds) + 이번 세션 초 → 지금까지 받아야 할 코인 수와 남은 초.
 * 진행 중 세션에도 그대로 쓴다 (seconds = 지금까지 경과 초 → coins - 이미 준 수 = 지금 줄 코인).
 * @returns {{ coins: number, carry: number }}  carry 는 항상 0 ≤ carry < COIN_PER_SECONDS
 */
function settleStudy(carrySeconds, seconds) {
  const total = Math.max(0, Math.floor(Number(carrySeconds) || 0)) + Math.max(0, Math.floor(Number(seconds) || 0));
  return { coins: Math.floor(total / COIN_PER_SECONDS), carry: total % COIN_PER_SECONDS };
}

/** 남은 초(carry) → 다음 코인까지 초 (1 ≤ n ≤ COIN_PER_SECONDS) */
function secondsToNextCoin(carrySeconds) {
  const c = Math.max(0, Math.floor(Number(carrySeconds) || 0)) % COIN_PER_SECONDS;
  return COIN_PER_SECONDS - c;
}

/**
 * 집중 사이클 완주 보너스 판정.
 * cycle: { phase, startedAt, durationMs } (Pomodoro 'phaseEnd'), live: 진행 중 공부 세션 { startedAt } | null
 * @returns {number} 0 또는 FOCUS_BONUS
 */
function focusBonusFor(cycle, live) {
  if (!cycle || cycle.phase !== 'focus') return 0;
  if (!(cycle.durationMs >= FOCUS_BONUS_MIN_MS)) return 0;
  if (!live || !(live.startedAt <= cycle.startedAt + FOCUS_START_SLACK_MS)) return 0; // 사이클 도중에 앉았거나(다시 앉았거나) 지금 공부 중이 아님
  return FOCUS_BONUS;
}

module.exports = { coinsForSession, settleStudy, secondsToNextCoin, focusBonusFor, COIN_PER_SECONDS, FOCUS_BONUS, FOCUS_BONUS_MIN_MS, FOCUS_START_SLACK_MS };
