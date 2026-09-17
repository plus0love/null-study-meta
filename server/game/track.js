'use strict';
/**
 * 트랙 랩 판정 (12단계, 순수 로직).
 *  트랙 정의 (방 데이터 room.track): { start: { x1, y1, x2, y2 } (출발선 px 선분), dir: { x, y } (출발선을 지나는 정방향 단위 벡터),
 *    checkpoints: [{ x, y, r }] (px, 순서대로 지나야 하는 체크포인트), lengthTiles }
 *  플레이어마다 LapState { startedAt, next } 를 두고 이동(p0 → p1)마다 advance():
 *   - 출발선을 정방향으로 지나면: 체크포인트를 전부 순서대로 지났으면 랩 완주('lap', ms) 후 바로 다음 랩 시작, 아니면 새 랩 시작('start').
 *   - 역방향으로 지나면 진행 취소('reset') — 역주행은 인정하지 않는다.
 *   - 다음 체크포인트 반경 안에 들어오면 next++ ('checkpoint'). 순서를 건너뛴 체크포인트는 세지 않으므로 쇼트컷은 완주가 안 된다.
 */

/** 선분 p0→p1 이 선분 a→b 를 가로지르는지 (끝점 접촉 포함) */
function crosses(p0, p1, a, b) {
  const o = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = o(a, b, p0);
  const d2 = o(a, b, p1);
  const d3 = o(p0, p1, a);
  const d4 = o(p0, p1, b);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  // 정확히 선 위에 멈춘 경우 (d2 === 0): 지나가는 중으로 보지 않고 다음 이동에서 판정한다
  return false;
}

function newLapState() {
  return { startedAt: null, next: 0, laps: 0 };
}

/**
 * @param {object} track room.track
 * @param {object} state LapState (제자리에서 갱신)
 * @param {{x,y}} p0 이전 위치, @param {{x,y}} p1 새 위치, @param {number} now ms
 * @returns {null | { event: 'start' | 'checkpoint' | 'reset' | 'lap', ms?, next, total }}
 */
function advance(track, state, p0, p1, now) {
  if (!track || !track.start) return null;
  const total = track.checkpoints.length;
  const a = { x: track.start.x1, y: track.start.y1 };
  const b = { x: track.start.x2, y: track.start.y2 };
  if (crosses(p0, p1, a, b)) {
    const forward = (p1.x - p0.x) * track.dir.x + (p1.y - p0.y) * track.dir.y > 0;
    if (!forward) {
      const had = state.startedAt !== null;
      state.startedAt = null;
      state.next = 0;
      return had ? { event: 'reset', next: 0, total } : null;
    }
    if (state.startedAt !== null && state.next >= total) {
      const ms = now - state.startedAt;
      state.startedAt = now;
      state.next = 0;
      state.laps++;
      return { event: 'lap', ms, next: 0, total };
    }
    state.startedAt = now;
    state.next = 0;
    return { event: 'start', next: 0, total };
  }
  if (state.startedAt === null || state.next >= total) return null;
  const cp = track.checkpoints[state.next];
  if (Math.hypot(p1.x - cp.x, p1.y - cp.y) <= cp.r) {
    state.next++;
    return { event: 'checkpoint', next: state.next, total };
  }
  return null;
}

/** 트랙 정의 검증 (방 빌드 테스트용) */
function validateTrack(track) {
  if (!track || !track.start || !track.dir || !Array.isArray(track.checkpoints)) return false;
  const len = Math.hypot(track.dir.x, track.dir.y);
  return Math.abs(len - 1) < 1e-6 && track.checkpoints.length >= 2 && track.checkpoints.every((c) => Number.isFinite(c.x) && Number.isFinite(c.y) && c.r > 0);
}

module.exports = { crosses, newLapState, advance, validateTrack };
