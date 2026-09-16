/**
 * 뽀모도로 전환 연출 도우미: Web Audio 합성 알림음(파일 없음) + 브라우저 알림.
 * AudioContext 는 사용자 제스처(클릭/키) 뒤에만 소리가 나므로 첫 제스처에서 미리 열어 둔다.
 */
(function () {
  'use strict';

  const LS_SOUND = 'nsm.sound';

  class Sound {
    constructor() {
      this.ctx = null;
      try { this.enabled = localStorage.getItem(LS_SOUND) !== '0'; } catch (_) { this.enabled = true; }
      const unlock = () => this.unlock();
      document.addEventListener('pointerdown', unlock, { capture: true });
      document.addEventListener('keydown', unlock, { capture: true });
    }

    setEnabled(on) {
      this.enabled = Boolean(on);
      try { localStorage.setItem(LS_SOUND, on ? '1' : '0'); } catch (_) { /* ignore */ }
    }

    unlock() {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        if (!this.ctx) this.ctx = new AC();
        if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      } catch (_) { /* 오디오 없음 */ }
    }

    /** 짧은 차임. kind 'break' 는 올라가는 3음, 'focus' 는 내려가는 3음, 'goal' 은 밝은 4음 아르페지오(목표 달성). */
    chime(kind = 'break') {
      if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return false;
      const ctx = this.ctx;
      const notes = { break: [523.25, 659.25, 783.99], focus: [783.99, 659.25, 523.25], goal: [523.25, 659.25, 783.99, 1046.5] }[kind] || [659.25];
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
