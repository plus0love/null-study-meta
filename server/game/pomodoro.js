'use strict';
/**
 * 공용 뽀모도로. 25분 집중 / 5분 휴식, 자동 전환. 누구나 시작/정지.
 * 상태는 서버 시각(ms) 기준이고, 클라이언트는 serverTime 과 자기 시계의 차이로 남은 시간을 계산한다.
 */
const EventEmitter = require('node:events');

const FOCUS_MS = 25 * 60 * 1000;
const BREAK_MS = 5 * 60 * 1000;

class Pomodoro extends EventEmitter {
  constructor({ focusMs = FOCUS_MS, breakMs = BREAK_MS, now = () => Date.now() } = {}) {
    super();
    this.focusMs = focusMs;
    this.breakMs = breakMs;
    this.now = now;
    this.running = false;
    this.phase = 'focus';
    this.startedAt = null;
    this.endsAt = null;
    this.startedBy = null;
    this.timer = null;
  }

  snapshot() {
    return {
      running: this.running,
      phase: this.phase,
      startedAt: this.startedAt,
      endsAt: this.endsAt,
      startedBy: this.startedBy,
      focusMs: this.focusMs,
      breakMs: this.breakMs,
      serverTime: this.now(),
    };
  }

  durationOf(phase) {
    return phase === 'focus' ? this.focusMs : this.breakMs;
  }

  start(by = null) {
    if (this.running) return false;
    this.running = true;
    this.startedBy = by;
    this.beginPhase('focus');
    this.emit('change', this.snapshot(), 'start');
    return true;
  }

  stop(by = null) {
    if (!this.running) return false;
    clearTimeout(this.timer);
    this.timer = null;
    this.running = false;
    this.phase = 'focus';
    this.startedAt = null;
    this.endsAt = null;
    this.startedBy = by;
    this.emit('change', this.snapshot(), 'stop');
    return true;
  }

  beginPhase(phase) {
    const now = this.now();
    this.phase = phase;
    this.startedAt = now;
    this.endsAt = now + this.durationOf(phase);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.advance(), this.durationOf(phase));
    this.timer.unref?.();
  }

  /** 단계 종료 → 반대 단계로 자동 전환 */
  advance() {
    if (!this.running) return;
    this.beginPhase(this.phase === 'focus' ? 'break' : 'focus');
    this.emit('change', this.snapshot(), 'switch');
  }

  dispose() {
    clearTimeout(this.timer);
    this.timer = null;
  }
}

module.exports = { Pomodoro, FOCUS_MS, BREAK_MS };
