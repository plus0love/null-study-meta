'use strict';
/**
 * 뽀모도로 타이머 (7단계부터 **개인별** — World 가 플레이어마다 하나씩 든다). 기본 25분 집중 / 5분 휴식, 자동 전환.
 * 시작 전에는 집중(20~90분)/휴식(5~20분) 시간을 바꿀 수 있고(configure), 진행 중에는 바꿀 수 없다.
 * 상태는 서버 시각(ms) 기준이고, 클라이언트는 serverTime 과 자기 시계의 차이로 남은 시간을 계산한다.
 */
const EventEmitter = require('node:events');

const FOCUS_MS = 25 * 60 * 1000;
const BREAK_MS = 5 * 60 * 1000;
const FOCUS_RANGE = { min: 20, max: 90 }; // 분
const BREAK_RANGE = { min: 5, max: 20 };

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

  /**
   * 집중/휴식 시간(분) 변경. 진행 중이면 거부.
   * @returns {{ ok: true, changed: boolean, focusMinutes, breakMinutes } | { ok: false, error: 'running' | 'invalid_focus' | 'invalid_break' }}
   */
  configure({ focusMinutes, breakMinutes } = {}) {
    if (this.running) return { ok: false, error: 'running' };
    const f = Number(focusMinutes);
    const b = Number(breakMinutes);
    if (!Number.isInteger(f) || f < FOCUS_RANGE.min || f > FOCUS_RANGE.max) return { ok: false, error: 'invalid_focus' };
    if (!Number.isInteger(b) || b < BREAK_RANGE.min || b > BREAK_RANGE.max) return { ok: false, error: 'invalid_break' };
    const focusMs = f * 60 * 1000;
    const breakMs = b * 60 * 1000;
    const changed = focusMs !== this.focusMs || breakMs !== this.breakMs;
    this.focusMs = focusMs;
    this.breakMs = breakMs;
    if (changed) this.emit('change', this.snapshot(), 'config');
    return { ok: true, changed, focusMinutes: f, breakMinutes: b };
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

module.exports = { Pomodoro, FOCUS_MS, BREAK_MS, FOCUS_RANGE, BREAK_RANGE };
