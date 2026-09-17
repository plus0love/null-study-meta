/**
 * 뽀모도로 전환 연출 도우미: Web Audio 합성 알림음(파일 없음) + 브라우저 알림.
 * AudioContext 는 사용자 제스처(클릭/키) 뒤에만 소리가 나므로 첫 제스처에서 미리 열어 둔다.
 * 8단계: 코인 획득음(coin) — 알림 소리와 따로 끌 수 있다 (nsm.sound.coin).
 */
(function () {
  'use strict';

  const LS_SOUND = 'nsm.sound';
  const LS_COIN = 'nsm.sound.coin';

  class Sound {
    constructor() {
      this.ctx = null;
      try { this.enabled = localStorage.getItem(LS_SOUND) !== '0'; } catch (_) { this.enabled = true; }
      try { this.coinEnabled = localStorage.getItem(LS_COIN) !== '0'; } catch (_) { this.coinEnabled = true; }
      const unlock = () => this.unlock();
      document.addEventListener('pointerdown', unlock, { capture: true });
      document.addEventListener('keydown', unlock, { capture: true });
    }

    setEnabled(on) {
      this.enabled = Boolean(on);
      try { localStorage.setItem(LS_SOUND, on ? '1' : '0'); } catch (_) { /* ignore */ }
    }

    setCoinEnabled(on) {
      this.coinEnabled = Boolean(on);
      try { localStorage.setItem(LS_COIN, on ? '1' : '0'); } catch (_) { /* ignore */ }
    }

    /** 코인 획득음: 짧은 두 음(E6 → A6, 0.2초). 구매(delta < 0)는 낮은 한 음 */
    coin(delta = 1) {
      if (!this.coinEnabled || !this.ctx || this.ctx.state !== 'running') return false;
      const ctx = this.ctx;
      const notes = delta > 0 ? [1318.5, 1760] : [659.25];
      const t0 = ctx.currentTime + 0.01;
      const master = ctx.createGain();
      master.gain.value = 0.12;
      master.connect(ctx.destination);
      notes.forEach((f, i) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = f;
        const t = t0 + i * 0.08;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(1, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
        osc.connect(g);
        g.connect(master);
        osc.start(t);
        osc.stop(t + 0.25);
      });
      return true;
    }

    unlock() {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        if (!this.ctx) this.ctx = new AC();
        if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      } catch (_) { /* 오디오 없음 */ }
    }

    /** 12단계 경적: beep(빵빵, 사각파 2번) · bell(따르릉, 높은 사인 2번) · melody(4음). 항상 켜져 있다 (남의 경적도 들린다) */
    horn(kind = 'beep') {
      if (!this.ctx || this.ctx.state !== 'running') return false;
      const ctx = this.ctx;
      const t0 = ctx.currentTime + 0.01;
      const master = ctx.createGain();
      master.gain.value = 0.1;
      master.connect(ctx.destination);
      const play = (f, at, dur, type = 'square') => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = type;
        osc.frequency.value = f;
        g.gain.setValueAtTime(0, at);
        g.gain.linearRampToValueAtTime(1, at + 0.01);
        g.gain.setValueAtTime(1, at + dur - 0.03);
        g.gain.exponentialRampToValueAtTime(0.001, at + dur);
        osc.connect(g);
        g.connect(master);
        osc.start(at);
        osc.stop(at + dur + 0.02);
      };
      if (kind === 'bell') { play(2093, t0, 0.09, 'sine'); play(2637, t0 + 0.11, 0.09, 'sine'); play(2093, t0 + 0.22, 0.09, 'sine'); play(2637, t0 + 0.33, 0.12, 'sine'); }
      else if (kind === 'melody') { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => play(f, t0 + i * 0.12, 0.14, 'triangle')); }
      else { play(392, t0, 0.14); play(392, t0 + 0.2, 0.22); }
      return true;
    }

    /** 12단계 인력거 삐걱: 낮은 톱니파가 살짝 내려가는 짧은 소리 (달릴 때 0.65초마다) */
    creak() {
      if (!this.ctx || this.ctx.state !== 'running') return false;
      const ctx = this.ctx;
      const t0 = ctx.currentTime + 0.01;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(180 + Math.random() * 40, t0);
      osc.frequency.exponentialRampToValueAtTime(110, t0 + 0.14);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.05, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.16);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.18);
      return true;
    }

    /** 짧은 차임. kind 'break' 는 올라가는 3음, 'focus' 는 내려가는 3음, 'goal' 은 밝은 4음 아르페지오(목표 달성), 'lap' 은 완주 팡파르. */
    chime(kind = 'break') {
      if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return false;
      const ctx = this.ctx;
      const notes = { break: [523.25, 659.25, 783.99], focus: [783.99, 659.25, 523.25], goal: [523.25, 659.25, 783.99, 1046.5], lap: [783.99, 783.99, 1046.5, 1318.5] }[kind] || [659.25];
      const t0 = ctx.currentTime + 0.02;
      const master = ctx.createGain();
      master.gain.value = 0.18;
      master.connect(ctx.destination);
      notes.forEach((f, i) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = f;
        const t = t0 + i * 0.16;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(1, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
        osc.connect(g);
        g.connect(master);
        osc.start(t);
        osc.stop(t + 0.5);
      });
      return true;
    }
  }

  const Notify = {
    supported() {
      return typeof Notification !== 'undefined';
    },
    permission() {
      return this.supported() ? Notification.permission : 'unsupported';
    },
    /** 사용자 제스처 안에서 호출해야 한다 */
    async request() {
      if (!this.supported() || Notification.permission !== 'default') return this.permission();
      try { return await Notification.requestPermission(); } catch (_) { return Notification.permission; }
    },
    show(title, body) {
      if (!this.supported() || Notification.permission !== 'granted') return false;
      try {
        const n = new Notification(title, { body, silent: true, tag: 'nsm-pomodoro' });
        setTimeout(() => n.close(), 6000);
        return true;
      } catch (_) {
        return false;
      }
    },
  };

  window.FX = { Sound, Notify };
})();
