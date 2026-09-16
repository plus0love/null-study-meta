/* global io */
/**
 * 소켓 래퍼: 입장/재접속(세션 토큰), 서버 시각 동기화, 이벤트 중계.
 * 서버 → 클라이언트 이벤트는 그대로 이름을 유지해 on() 으로 구독한다.
 * 추가 이벤트: 'offline'(끊김), 'online'(재연결 직후), 'session'(입장/재입장 ack 적용), 'sessionLost'(토큰 만료로 새 입장 필요)
 */
(function () {
  'use strict';

  const LS = { token: 'nsm.token', nickname: 'nsm.nickname', avatar: 'nsm.avatar' };
  const FORWARD = [
    'playerJoined', 'playerLeft', 'playerMoved', 'move:correct', 'playerSat', 'playerStood', 'playerStatus',
    'playerAvatar', 'playerEmoji', 'chat', 'pomodoro', 'roomCount', 'playerDisconnected', 'playerReconnected',
    'npc:update', 'npc:pet', 'npc:name', 'playerListening',
    'playerGoal', 'leaderboard:refresh', 'attendance', 'goalReached',
  ];

  class Net {
    constructor() {
      this.socket = null;
      this.listeners = new Map();
      this.session = null; // 마지막 join ack
      this.credentials = null; // { nickname, avatar }
      this.offset = 0; // serverTime - Date.now()
      this.corrections = 0; // 디버그/테스트용 카운터
      this.wasConnected = false;
    }

    on(event, fn) {
      if (!this.listeners.has(event)) this.listeners.set(event, new Set());
      this.listeners.get(event).add(fn);
      return () => this.listeners.get(event).delete(fn);
    }

    emitLocal(event, data) {
      const set = this.listeners.get(event);
      if (set) for (const fn of set) fn(data);
    }

    static saved() {
      try {
        const avatar = Number(localStorage.getItem(LS.avatar));
        return {
          token: localStorage.getItem(LS.token) || null,
          nickname: localStorage.getItem(LS.nickname) || '',
          avatar: Number.isInteger(avatar) ? avatar : 0,
        };
      } catch (_) {
        return { token: null, nickname: '', avatar: 0 };
      }
    }

    static save(patch) {
      try {
        for (const [k, v] of Object.entries(patch)) {
          if (v === null || v === undefined) localStorage.removeItem(LS[k]);
          else localStorage.setItem(LS[k], String(v));
        }
      } catch (_) { /* 시크릿 모드 등 */ }
    }

    connect() {
      if (this.socket) return;
      this.socket = io({ transports: ['websocket', 'polling'], reconnection: true, reconnectionDelay: 500, reconnectionDelayMax: 3000, timeout: 8000 });
      for (const ev of FORWARD) this.socket.on(ev, (d) => this.emitLocal(ev, d));
      this.socket.on('move:correct', () => { this.corrections++; });
      this.socket.on('connect', () => {
        const reconnecting = this.wasConnected;
        this.wasConnected = true;
        this.syncTime();
        if (reconnecting) this.emitLocal('online');
        // 재연결이면 같은 토큰으로 다시 입장 (서버가 세션을 기억하면 이어받고, 아니면 새 입장)
        if (reconnecting && this.credentials) this.join(this.credentials).catch(() => {});
      });
      this.socket.on('disconnect', (reason) => {
        if (reason === 'io client disconnect') return;
        this.emitLocal('offline', reason);
      });
    }

    /** 입장 (또는 재입장). 실패하면 reject(Error(message)). */
    async join({ nickname, avatar }) {
      const saved = Net.saved();
      const payload = { nickname, avatar, token: saved.token };
      const ack = await this.ask('join', payload);
      if (!ack.ok) {
        if (ack.error === 'already_joined') return this.session;
        throw new Error(ack.error);
      }
      this.credentials = { nickname: ack.self.nickname, avatar: ack.self.avatar };
      this.session = ack;
      this.offset = ack.serverTime - Date.now();
      Net.save({ token: ack.token, nickname: ack.self.nickname, avatar: ack.self.avatar });
      if (saved.token && !ack.resumed) this.emitLocal('sessionLost', ack);
      this.emitLocal('session', ack);
      return ack;
    }

    ask(event, payload) {
      return new Promise((resolve, reject) => {
        if (!this.socket) return reject(new Error('not_connected'));
        this.socket.timeout(8000).emit(event, payload, (err, res) => (err ? reject(err) : resolve(res)));
      });
    }

    /** 서버 시각과 내 시계의 차이를 (왕복 시간의 절반을 빼서) 맞춘다 */
    async syncTime() {
      try {
        const t0 = Date.now();
        const res = await this.ask('time:ping', { t0 });
        const rtt = Date.now() - t0;
        this.offset = res.serverTime + rtt / 2 - Date.now();
      } catch (_) { /* 다음 동기화에서 */ }
    }

    serverNow() {
      return Date.now() + this.offset;
    }

    get connected() {
      return Boolean(this.socket && this.socket.connected);
    }

    /** 20Hz 위치 전송 — 끊긴 동안은 보내지 않는다 (쌓였다가 몰려가는 것 방지). volatile 은 마지막 '정지' 패킷까지 버릴 수 있어 쓰지 않는다. */
    move(payload) {
      if (this.socket && this.socket.connected) this.socket.emit('move', payload);
    }

    sit(seatId) { return this.ask('sit', { seatId }); }
    stand() { return this.ask('stand', {}); }
    setStatus(status) { return this.ask('status', { status }); }
    setAvatar(avatar) {
      Net.save({ avatar });
      if (this.credentials) this.credentials.avatar = avatar;
      return this.ask('avatar', { avatar });
    }
    chat(text) { return this.ask('chat', { text }); }
    emoji(index) { return this.ask('emoji', { index }); }
    petNpc(id) { return this.ask('npc:pet', { id }); }
    interact(id) { return this.ask('interact', { id }); }
    setListening(title) { return this.ask('listening', { title: title || null }); }
    stats() { return this.ask('stats', {}); }
    setGoal(goal) { return this.ask('goal:set', goal); }
    todoList() { return this.ask('todo:list', {}); }
    todoAdd(text) { return this.ask('todo:add', { text }); }
    todoToggle(id, done) { return this.ask('todo:toggle', { id, done }); }
    todoDelete(id) { return this.ask('todo:delete', { id }); }
    setNpcName(id, name) { return this.ask('npc:name', { id, name }); }
    pomodoroStart() { return this.ask('pomodoro:start', {}); }
    pomodoroStop() { return this.ask('pomodoro:stop', {}); }

    /** 나가기: 서버에서 즉시 정리하고 토큰을 버린다 */
    async leave() {
      try { await this.ask('leave', {}); } catch (_) { /* 이미 끊김 */ }
      Net.save({ token: null });
      this.credentials = null;
      this.session = null;
      if (this.socket) {
        this.socket.disconnect();
        this.socket = null;
        this.wasConnected = false;
      }
    }
  }

  window.Net = Net;
})();
