/* global io */
/**
 * 소켓 래퍼: 입장/재접속(세션 토큰), 서버 시각 동기화, 이벤트 중계.
 * 서버 → 클라이언트 이벤트는 그대로 이름을 유지해 on() 으로 구독한다.
 * 추가 이벤트: 'offline'(끊김), 'online'(재연결 직후), 'session'(입장/재입장 ack 적용), 'sessionLost'(토큰 만료로 새 입장 필요)
 * 11단계: 로비(siteAuth · lobbyList · studyCreate · studyLookup) · join 에 study(코드)·studyPassword·studyAccess
 *   · 잠긴 스터디는 비밀번호 대신 서버가 준 기기 접근 토큰(studyAccess)을 스터디별로 localStorage 에 두고 다음 입장 때 낸다 · 마지막 스터디 기억
 * 12단계: door(스터디 ↔ 야외, ack 는 입장 ack 와 같은 세션 형태 → 'session' 으로 흘린다) · 탈것(mount/dismount/vehicleConfig/horn) · 전광판 · 프로필.
 *   this.room = 지금 있는 맵 id ('studyroom' | 'outdoor').
 */
(function () {
  'use strict';

  const LS = { token: 'nsm.token', nickname: 'nsm.nickname', avatar: 'nsm.avatar', password: 'nsm.password', lastStudy: 'nsm.lastStudy' };
  const LS_STUDY_ACCESS = 'nsm.study.access.'; // + CODE → 그 스터디의 기기 접근 토큰 (비밀번호를 맞춘 기기에 서버가 발급)
  const FORWARD = [
    'playerJoined', 'playerLeft', 'playerMoved', 'move:correct', 'playerSat', 'playerStood', 'playerStatus',
    'avatar:update', 'playerEmoji', 'chat', 'pomodoro', 'roomCount', 'playerDisconnected', 'playerReconnected',
    'npc:update', 'npc:pet', 'npc:name', 'playerListening',
    'playerGoal', 'leaderboard:refresh', 'attendance', 'goalReached',
    'coins', 'coinProgress', 'playerPomodoro',
    'layout:update', 'playerDesk', 'playerEdit',
    'npc:remove',
    'studyGoal', 'study:update', 'kicked', 'study:deleted',
    'playerVehicle', 'playerHorn', 'lap:progress', 'lap', 'track:board',
  ];

  class Net {
    constructor() {
      this.socket = null;
      this.listeners = new Map();
      this.session = null; // 마지막 join ack
      this.credentials = null; // { nickname, avatar(파츠 객체), password?(사이트), study(코드), studyAccess? }
      this.study = null; // 지금 들어가 있는 스터디 (join ack 의 study)
      this.room = null; // 12단계: 지금 있는 맵 id
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

    /** 저장된 아바타: 5단계 파츠 객체(JSON) 또는 4단계까지의 정수(셔츠 색). 없으면 null → 서버가 users.avatar 에서 복원 */
    static savedAvatar() {
      const raw = localStorage.getItem(LS.avatar);
      if (raw === null || raw === '') return null;
      try {
        const v = JSON.parse(raw);
        return v && (typeof v === 'object' || Number.isInteger(v)) ? v : null;
      } catch (_) {
        const n = Number(raw);
        return Number.isInteger(n) ? n : null;
      }
    }

    static saved() {
      try {
        return {
          token: localStorage.getItem(LS.token) || null,
          nickname: localStorage.getItem(LS.nickname) || '',
          avatar: Net.savedAvatar(),
          password: localStorage.getItem(LS.password) || '', // 6단계: 맞춘 사이트 비밀번호 (틀리면 지운다)
          lastStudy: localStorage.getItem(LS.lastStudy) || '', // 11단계: 마지막으로 들어간 스터디 코드
        };
      } catch (_) {
        return { token: null, nickname: '', avatar: null, password: '', lastStudy: '' };
      }
    }

    /** 스터디별 기기 접근 토큰 (비밀번호를 맞추면 서버가 발급. 서버가 무효라 하면 지운다 — 비밀번호 변경·내보내기) */
    static studyAccess(code) {
      try { return localStorage.getItem(LS_STUDY_ACCESS + String(code || '').toUpperCase()) || ''; } catch (_) { return ''; }
    }

    static saveStudyAccess(code, token) {
      try {
        const k = LS_STUDY_ACCESS + String(code || '').toUpperCase();
        if (token) localStorage.setItem(k, token);
        else localStorage.removeItem(k);
      } catch (_) { /* 시크릿 모드 등 */ }
    }

    static save(patch) {
      try {
        for (const [k, v] of Object.entries(patch)) {
          if (v === null || v === undefined) localStorage.removeItem(LS[k]);
          else localStorage.setItem(LS[k], typeof v === 'object' ? JSON.stringify(v) : String(v));
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

    /**
     * 입장 (또는 재입장). 실패하면 reject(Error(error)) — err.ack 에 서버 ack 전체(remaining, retryAfterMs, scope: 'site'|'study').
     * password 는 사이트 비밀번호(ROOM_PASSWORD, 맞추면 기억·틀리면 지움), studyPassword 는 잠긴 스터디 비밀번호(기억하지 않는다).
     * 잠긴 스터디는 이 기기가 가진 접근 토큰(studyAccess, 기본은 localStorage 의 것)을 함께 내고, 비밀번호를 맞춰 새 토큰을 받으면 저장한다.
     * 서버가 비밀번호를 요구하면(토큰이 없거나 무효) 저장해 둔 토큰은 지운다. study 는 스터디 코드 (재접속 이어받기는 세션 토큰만으로도 된다).
     */
    async join({ nickname, avatar, password = '', study = '', studyPassword = '', studyAccess }) {
      const saved = Net.saved();
      const access = studyAccess || Net.studyAccess(study);
      const payload = { nickname, avatar, token: saved.token };
      if (password) payload.password = password;
      if (study) payload.study = study;
      if (studyPassword) payload.studyPassword = studyPassword;
      if (access) payload.studyAccess = access;
      const ack = await this.ask('join', payload);
      if (!ack.ok) {
        if (ack.error === 'already_joined') return this.session;
        if (ack.error === 'wrong_password' || ack.error === 'password_required') {
          if (ack.scope === 'study') Net.saveStudyAccess(study, null);
          else Net.save({ password: null });
        }
        const err = new Error(ack.error);
        err.ack = ack;
        throw err;
      }
      const code = ack.study ? ack.study.code : study;
      if (ack.studyAccess && code) Net.saveStudyAccess(code, ack.studyAccess);
      this.credentials = { nickname: ack.self.nickname, avatar: ack.self.avatar, password, study: code, studyAccess: ack.studyAccess || access || '' };
      this.session = ack;
      this.study = ack.study || null;
      this.room = ack.room || 'studyroom';
      this.offset = ack.serverTime - Date.now();
      Net.save({ token: ack.token, nickname: ack.self.nickname, avatar: ack.self.avatar, password: password || null, lastStudy: code || null });
      if (saved.token && !ack.resumed) this.emitLocal('sessionLost', ack);
      this.emitLocal('session', ack);
      return ack;
    }

    // ── 로비 (11단계) ──
    /** 사이트 비밀번호 (ROOM_PASSWORD). 성공하면 기억, 틀리면 지운다. 실패는 reject(Error(error)) + err.ack */
    async siteAuth(password) {
      const ack = await this.ask('site:auth', { password: password || '' });
      if (!ack.ok) {
        Net.save({ password: null });
        const err = new Error(ack.error);
        err.ack = { ...ack, scope: 'site' };
        throw err;
      }
      Net.save({ password: password || null });
      return ack;
    }
    lobbyList(nickname) { return this.ask('lobby:list', { nickname }); }
    /** 스터디 만들기. 잠긴 스터디면 ack.studyAccess(만든 기기의 접근 토큰)를 저장한다 */
    async studyCreate(form) {
      const ack = await this.ask('study:create', form);
      if (ack && ack.ok && ack.studyAccess) Net.saveStudyAccess(ack.study.code, ack.studyAccess);
      return ack;
    }
    studyLookup(code) { return this.ask('study:lookup', { code }); }
    studyInfo() { return this.ask('study:info', {}); }
    /** 방장 설정 변경. 비밀번호를 바꾸면 이 기기의 새 접근 토큰(ack.studyAccess)을 저장하고, 풀면 지운다 */
    async studyUpdate(patch) {
      const ack = await this.ask('study:update', patch);
      if (ack && ack.ok && patch && patch.password !== undefined) {
        Net.saveStudyAccess(ack.study.code, ack.studyAccess || null);
        if (this.credentials) this.credentials.studyAccess = ack.studyAccess || '';
      }
      return ack;
    }
    studyKick(nickname) { return this.ask('study:kick', { nickname }); }
    studyDelete() { return this.ask('study:delete', {}); }

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
    /** 아바타 변경 → 서버가 정규화한 값을 ack 로 돌려주고 모두에게 avatar:update 를 보낸다 */
    async setAvatar(avatar) {
      const res = await this.ask('avatar:update', { avatar });
      if (res && res.ok) {
        Net.save({ avatar: res.avatar });
        if (this.credentials) this.credentials.avatar = res.avatar;
      }
      return res;
    }
    chat(text) { return this.ask('chat', { text }); }
    emoji(index) { return this.ask('emoji', { index }); }
    petNpc(id) { return this.ask('npc:pet', { id }); }
    interact(id) { return this.ask('interact', { id }); }
    setListening(title) { return this.ask('listening', { title: title || null }); }
    stats(scope = 'study') { return this.ask('stats', { scope }); }
    setGoal(goal) { return this.ask('goal:set', goal); }
    todoList() { return this.ask('todo:list', {}); }
    todoAdd(text) { return this.ask('todo:add', { text }); }
    todoToggle(id, done) { return this.ask('todo:toggle', { id, done }); }
    todoDelete(id) { return this.ask('todo:delete', { id }); }
    setNpcName(id, name) { return this.ask('npc:name', { id, name }); }
    /** 내 뽀모도로 시작 (7단계: 개인 타이머, 집중/휴식 분을 함께 보낸다) */
    pomodoroStart(cfg = {}) { return this.ask('pomodoro:start', cfg); }
    pomodoroStop() { return this.ask('pomodoro:stop', {}); }
    /** 지갑 (8단계): 잔액 · 최근 거래 · 인벤토리 · 카탈로그 */
    wallet() { return this.ask('wallet', {}); }
    /** 구매: 서버가 잔액 확인·차감·원장·인벤토리까지 처리한다 (variant: 색/종류) */
    buy(itemId, variant, target) { return this.ask('shop:buy', { itemId, ...(variant ? { variant } : {}), ...(target !== undefined && target !== null ? { target } : {}) }); }
    // ── 펫 (10단계) ──
    petConfig(cfg) { return this.ask('pet:config', cfg || {}); }
    petRelease(inventoryId, name) { return this.ask('pet:release', { inventoryId, name }); }
    petRecall(id) { return this.ask('pet:recall', { id }); }
    petDeco(id, slots) { return this.ask('pet:deco', { id, slots }); }
    // ── 가구 (9단계) ──
    /** 책상 슬롯 3개 장착: [inventoryId | null] */
    equipDesk(slots) { return this.ask('desk:equip', { slots }); }
    setEditing(on) { return this.ask('edit:mode', { on: Boolean(on) }); }
    layoutPlace(inventoryId, x, y, rotation = 0) { return this.ask('layout:place', { inventoryId, x, y, rotation }); }
    layoutGrab(id) { return this.ask('layout:grab', { id }); }
    layoutRelease(id) { return this.ask('layout:release', { id }); }
    layoutMove(id, x, y, rotation) { return this.ask('layout:move', { id, x, y, rotation }); }
    layoutRemove(id) { return this.ask('layout:remove', { id }); }
    /** "내가 놓은 것만 이동·회수" 설정 */
    layoutLock(on) { return this.ask('layout:lock', { on: Boolean(on) }); }
    // ── 야외 (12단계) ──
    /** 문 통과: 성공하면 새 맵의 세션 ack 를 'session' 으로 흘린다 (main.js 가 씬을 바꾼다) */
    async door() {
      const ack = await this.ask('door', {});
      if (ack && ack.ok) {
        this.session = ack;
        this.study = ack.study || null;
        this.room = ack.room || 'studyroom';
        this.offset = ack.serverTime - Date.now();
        this.emitLocal('session', ack);
      }
      return ack;
    }
    mount() { return this.ask('vehicle:mount', {}); }
    dismount() { return this.ask('vehicle:dismount', {}); }
    vehicleConfig(cfg) { return this.ask('vehicle:config', cfg || {}); }
    horn() { return this.ask('horn', {}); }
    trackBoard() { return this.ask('track:board', {}); }
    profile(id) { return this.ask('profile', { id }); }
    setStatsPublic(on) { return this.ask('profile:visibility', { public: Boolean(on) }); }
    /** 내 기록 초기화: 서버가 세션 토큰 + 닉네임을 확인한다 */
    resetProfile(nickname) { return this.ask('profile:reset', { nickname, token: Net.saved().token }); }

    /**
     * 나가기: 서버에서 즉시 정리하고 토큰을 버린다. keepSocket 이면 소켓은 유지(로비로 돌아갈 때 — 사이트 인증도 유지된다).
     * forgetStudy 면 마지막 스터디 기억도 지운다 (다음 접속 때 로비부터).
     */
    async leave({ keepSocket = false, forgetStudy = true } = {}) {
      try { if (this.session) await this.ask('leave', {}); } catch (_) { /* 이미 끊김 */ }
      Net.save({ token: null, ...(forgetStudy ? { lastStudy: null } : {}) });
      this.credentials = null;
      this.session = null;
      this.study = null;
      this.room = null;
      if (this.socket && !keepSocket) {
        this.socket.disconnect();
        this.socket = null;
        this.wasConnected = false;
      }
    }

    /** 세션만 잊는다 (서버가 이미 내보낸 뒤: kicked · 스터디 삭제) */
    dropSession({ forgetStudy = true } = {}) {
      Net.save({ token: null, ...(forgetStudy ? { lastStudy: null } : {}) });
      this.credentials = null;
      this.session = null;
      this.study = null;
    }
  }

  window.Net = Net;
})();
