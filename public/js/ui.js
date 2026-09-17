/* global Music */
/**
 * HUD + 사이드바 (DOM). 게임 씬/네트워크와는 콜백(this.on*)으로만 연결한다.
 *  - 좌상단: 방 이름 + 인원 + (뽀모도로 진행 중) 남은 시간 배지   우상단: 설정·멤버·알림·♪·나가기 (팝오버)
 *  - 사이드바: 미니맵 · 오늘의 목표 · 오늘의 할 일(서버 저장, 이월 배지) · 뽀모도로(개인 타이머, 원형 게이지) · 랭킹(오늘/이번 주) · 유튜브 · 채팅
 *    카드마다 접기/펼치기(제목 줄만 남음, localStorage nsm.card.<id>)
 *  - 토스트: 출석 스트릭 ("N일 연속 출석 🔥") 등 짧은 안내
 *  - 좌하단: 이모지 바(1~6) · 상태 토글 · E 힌트(앉기/쓰다듬기/커피 마시기/음악 듣기)
 *  - 입장 모달, 재접속 배너
 *  - 설정: 아바타(빌더 모달) · 닉네임 · 강아지 이름 · 화면 크기(줌 1.5/2/2.5) · 넓게 보기 · 항상 밤 · 알림 소리 · 브라우저 알림 허용 · 내 기록 초기화(닉네임 확인 모달)
 *  - 아바타 빌더(AvatarBuilder): 입장 모달과 설정 모달이 같은 DOM(#avatar-builder)을 옮겨 가며 쓴다.
 *    좌: 4배 미리보기(걷기 애니메이션, 클릭으로 방향 회전) · 우: 파츠 탭 → 썸네일 그리드 → 색상 원형 버튼 · 랜덤/초기화
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const STATUS_LABEL = { study: '공부 중', rest: '휴식 중', coffee: '☕ 휴식 중' };
  const STATUS_ICON = { study: 'i-book', rest: 'i-leaf', coffee: 'i-coffee' };
  const HINT_LABEL = { sit: '앉기', stand: '일어나기', pet: '쓰다듬기', coffee: '커피 마시기', music: '음악 듣기' };
  const TODO_KEY = 'nsm.todos'; // 3단계까지의 localStorage 할 일 — 첫 접속 때 서버로 옮기고 지운다
  const GOAL_MINUTES = Array.from({ length: 16 }, (_, i) => (i + 1) * 30); // 30분 ~ 8시간
  const LS_NIGHT = 'nsm.alwaysNight';
  const LS_ZOOM = 'nsm.zoom'; // 7단계: 화면 크기 (1.5 | 2 | 2.5)
  const LS_WIDE = 'nsm.wide'; // 7단계: 넓게 보기
  const LS_POMO = 'nsm.pomo'; // 7단계: 내 뽀모도로 시간 { focus, break } (분)
  const LS_CARD = 'nsm.card.'; // + 카드 id → '1' 이면 접힘
  const ZOOMS = [1.5, 2, 2.5];
  const POMO = { focus: { min: 20, max: 90, def: 25 }, break: { min: 5, max: 20, def: 5 } };
  const LS_RECENT = 'nsm.music.recent';
  const MINIMAP_SCALE = 7; // 타일당 px (46x34 → 322x238)
  const YT_API = 'https://www.youtube.com/iframe_api';

  function el(tag, attrs = {}, children = []) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    for (const c of [].concat(children)) if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    return n;
  }

  function svgIcon(id, cls = 'icon') {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('class', cls);
    const u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    u.setAttribute('href', `#${id}`);
    s.appendChild(u);
    return s;
  }

  /** 정수로 바꿔 [min,max] 로 누른다. 숫자가 아니면 def */
  function clampInt(v, { min, max, def }) {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return def;
    return Math.min(max, Math.max(min, n));
  }

  function hhmm(ts) {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  class UI {
    constructor({ room, serverNow, avatarKit }) {
      this.room = room;
      this.serverNow = serverNow || (() => Date.now());
      this.avatarKit = avatarKit;
      this.selfId = null;
      this.players = new Map(); // id → public player (멤버 목록/미니맵용)
      this.status = 'rest';
      this.pomodoro = null;
      this.unread = 0;
      this.avatar = avatarKit.defaults;
      this.emojis = ['👋', '😊', '👍', '❤️', '😂', '🔥'];

      // 콜백 (main.js 가 채움)
      this.onChat = () => {};
      this.onEmoji = () => {};
      this.onToggleStatus = () => {};
      this.onAvatar = () => {};
      this.onPomodoro = () => {};
      this.onLeave = () => {};
      this.onRename = () => {};
      this.onNpcName = () => {};
      this.onAlwaysNight = () => {};
      this.onSound = () => {};
      this.onNotifyPerm = () => {};
      this.onListening = () => {};
      this.onUse = () => {};
      this.onTodoAdd = () => {};
      this.onTodoToggle = () => {};
      this.onTodoDelete = () => {};
      this.onGoalSave = () => {};
      this.onZoom = () => {};
      this.onWide = () => {};
      this.onReset = async () => ({ ok: false });

      this.todos = [];
      this.goal = null; // { text, targetMinutes }
      this.todaySeconds = 0;
      this.rankTab = 'today';
      this.stats = null;
      this.toastTimer = null;

      // 유튜브 카드 상태
      this.yt = { player: null, ready: false, apiPromise: null, current: null, userPlayed: false, title: '', playing: false };

      this.bindHud();
      this.bindSidebar();
      this.bindMusic();
      this.bindGoalAndRank();
      this.buildMinimapBase();
      this.renderTodos();
      setInterval(() => this.tickPomodoro(), 250);
    }

    // ── 상단 HUD / 팝오버 ─────────────────────────────────────────────
    bindHud() {
      $('room-name').textContent = this.room.name;
      const pops = { settings: $('pop-settings'), members: $('pop-members'), notify: $('pop-notify') };
      const btns = { settings: $('btn-settings'), members: $('btn-members'), notify: $('btn-notify') };
      $('btn-music').addEventListener('click', () => this.toggleMusic());
      const toggle = (name) => {
        const open = pops[name].hidden;
        for (const k of Object.keys(pops)) {
          pops[k].hidden = true;
          btns[k].classList.remove('active');
        }
        if (open) {
          pops[name].hidden = false;
          btns[name].classList.add('active');
          if (name === 'notify') this.clearUnread();
        }
      };
      for (const k of Object.keys(btns)) btns[k].addEventListener('click', (e) => { e.stopPropagation(); toggle(k); });
      document.addEventListener('click', (e) => {
        if (e.target.closest('#hud-tr')) return;
        for (const k of Object.keys(pops)) { pops[k].hidden = true; btns[k].classList.remove('active'); }
      });
      $('btn-leave').addEventListener('click', () => {
        if (window.confirm('스터디룸에서 나갈까요?')) this.onLeave();
      });
      $('btn-rename').addEventListener('click', () => this.onRename());
      $('npc-name-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const name = $('npc-name').value.trim();
        if (name) this.onNpcName(name);
      });
      $('npc-name').addEventListener('keydown', (e) => e.stopPropagation());
      // 아바타 빌더 (입장 모달 · 설정 모달 공용). 방 안에서 바꾸면 즉시 서버로 (200ms 디바운스)
      this.builder = new AvatarBuilder(this.avatarKit, $('avatar-builder'));
      $('login-avatar-slot').appendChild(this.builder.root);
      this.inRoom = false;
      let avatarTimer = null;
      this.avatarTouched = false; // 입장 화면에서 손대지 않았으면 null 을 보내 서버가 users.avatar 를 복원하게 한다
      this.builder.onChange = (avatar) => {
        this.avatar = avatar;
        this.avatarTouched = true;
        this.drawAvatarThumb();
        if (!this.inRoom) return;
        clearTimeout(avatarTimer);
        avatarTimer = setTimeout(() => this.onAvatar(avatar), 200);
      };
      $('btn-avatar').addEventListener('click', () => this.openAvatarModal());
      $('avatar-modal-close').addEventListener('click', () => this.closeAvatarModal());
      $('avatar-modal').addEventListener('click', (e) => { if (e.target === $('avatar-modal')) this.closeAvatarModal(); });
      // 항상 밤 / 알림 소리 / 브라우저 알림
      const night = $('opt-night');
      night.checked = this.loadFlag(LS_NIGHT, false);
      night.addEventListener('change', () => { this.saveFlag(LS_NIGHT, night.checked); this.onAlwaysNight(night.checked); });
      const sound = $('opt-sound');
      sound.addEventListener('change', () => this.onSound(sound.checked));
      $('btn-notify-perm').addEventListener('click', () => this.onNotifyPerm());

      // 화면 크기(줌) · 넓게 보기 (7단계, localStorage)
      for (const b of document.querySelectorAll('#zoom-tabs button')) b.addEventListener('click', () => this.setZoom(Number(b.dataset.zoom)));
      this.setZoom(this.loadZoom(), { silent: true });
      const wide = $('opt-wide');
      wide.addEventListener('change', () => this.setWide(wide.checked));
      $('btn-wide').addEventListener('click', () => this.setWide(!this.wide));
      this.setWide(this.loadFlag(LS_WIDE, false), { silent: true });

      // 내 기록 초기화 (닉네임을 똑같이 입력해야 삭제 버튼이 살아난다)
      $('btn-reset').addEventListener('click', () => this.openResetModal());
      $('reset-cancel').addEventListener('click', () => this.closeResetModal());
      $('reset-modal').addEventListener('click', (e) => { if (e.target === $('reset-modal')) this.closeResetModal(); });
      $('reset-nick').addEventListener('input', () => { $('reset-submit').disabled = $('reset-nick').value.trim() !== this.selfNickname; });
      $('reset-nick').addEventListener('keydown', (e) => { if (e.key === 'Escape') this.closeResetModal(); e.stopPropagation(); });
      $('reset-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const nickname = $('reset-nick').value.trim();
        if (nickname !== this.selfNickname) return;
        const btn = $('reset-submit');
        const err = $('reset-error');
        btn.disabled = true;
        err.hidden = true;
        try {
          const r = await this.onReset(nickname);
          if (!r.ok) throw new Error(r.error === 'confirm_mismatch' ? '닉네임이 맞지 않아요.' : '초기화하지 못했어요. 잠시 후 다시 시도해 주세요.');
          this.closeResetModal();
        } catch (ex) {
          err.textContent = ex.message;
          err.hidden = false;
          btn.disabled = false;
        }
      });

      // 좌하단: 이모지 바 + 상태 토글
      const bar = $('emoji-bar');
      this.emojis.forEach((e, i) => {
        bar.appendChild(el('button', { class: 'emoji-btn', title: `이모지 ${i + 1}`, onclick: () => this.onEmoji(i) }, [e, el('kbd', { text: String(i + 1) })]));
      });
      $('btn-status').addEventListener('click', () => this.onToggleStatus());
      this.setStatus('rest');
    }

    /** 서버가 확정한 내 아바타 (입장 ack · avatar:update) */
    setAvatar(avatar) {
      this.avatar = this.avatarKit.normalize(avatar);
      this.builder.set(this.avatar, { silent: true });
      this.drawAvatarThumb();
    }

    drawAvatarThumb() {
      const c = $('settings-avatar-thumb');
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, c.width, c.height);
      this.avatarKit.drawFrame(ctx, this.avatar, 'down', 0, 0, 0, 1);
    }

    openAvatarModal() {
      $('avatar-modal-slot').appendChild(this.builder.root);
      $('avatar-modal').hidden = false;
      this.builder.setVisible(true);
      $('pop-settings').hidden = true;
      $('btn-settings').classList.remove('active');
    }

    closeAvatarModal() {
      $('avatar-modal').hidden = true;
      this.builder.setVisible(false);
    }

    setEmojis(list) {
      if (!Array.isArray(list) || list.length !== 6) return;
      this.emojis = list;
      $('emoji-bar').querySelectorAll('.emoji-btn').forEach((b, i) => { b.firstChild.textContent = list[i]; });
    }

    setRoomCount(n) {
      $('room-count').querySelector('span').textContent = String(n);
    }

    setStatus(status) {
      this.status = status;
      const b = $('btn-status');
      b.classList.remove('study', 'rest', 'coffee');
      b.classList.add(status);
      b.querySelector('span').textContent = STATUS_LABEL[status] || status;
      b.querySelector('use').setAttribute('href', `#${STATUS_ICON[status] || 'i-coffee'}`);
    }

    setSitHint(mode) {
      // mode: null | 'sit' | 'stand' | 'pet' | 'coffee' | 'music'
      const h = $('sit-hint');
      h.hidden = !mode;
      if (mode) h.querySelector('span').textContent = HINT_LABEL[mode] || mode;
    }

    get alwaysNight() {
      return $('opt-night').checked;
    }

    setSoundEnabled(on) {
      $('opt-sound').checked = Boolean(on);
    }

    /** 브라우저 알림 권한 상태를 설정 버튼에 표시 */
    setNotifyPermission(state) {
      const b = $('btn-notify-perm');
      const label = { granted: '허용됨', denied: '차단됨 (브라우저 설정)', unsupported: '지원 안 함' }[state];
      b.textContent = label || '브라우저 알림 허용';
      b.disabled = state !== 'default';
    }

    // ── 화면 크기 / 넓게 보기 / 기록 초기화 (7단계) ─────────────────────
    loadZoom() {
      try { const z = Number(localStorage.getItem(LS_ZOOM)); return ZOOMS.includes(z) ? z : 2; } catch (_) { return 2; }
    }

    /** 카메라 줌 1.5 / 2 / 2.5 → 설정 탭 표시 + onZoom. silent 면 localStorage 에 쓰지 않는다 (초기 로드) */
    setZoom(z, { silent = false } = {}) {
      if (!ZOOMS.includes(z)) z = 2;
      this.zoom = z;
      for (const b of document.querySelectorAll('#zoom-tabs button')) b.classList.toggle('active', Number(b.dataset.zoom) === z);
      if (!silent) { try { localStorage.setItem(LS_ZOOM, String(z)); } catch (_) { /* ignore */ } }
      this.onZoom(z);
    }

    /** 넓게 보기: body.wide (사이드바 숨김·캔버스 전체) + 우상단 버튼 아이콘 */
    setWide(on, { silent = false } = {}) {
      this.wide = Boolean(on);
      document.body.classList.toggle('wide', this.wide);
      $('opt-wide').checked = this.wide;
      const b = $('btn-wide');
      b.classList.toggle('active', this.wide);
      b.title = this.wide ? '사이드바 펼치기' : '넓게 보기 (사이드바 접기)';
      b.querySelector('use').setAttribute('href', this.wide ? '#i-shrink' : '#i-expand');
      if (!silent) this.saveFlag(LS_WIDE, this.wide);
      this.onWide(this.wide);
    }

    openResetModal() {
      $('pop-settings').hidden = true;
      $('btn-settings').classList.remove('active');
      $('reset-nick-label').textContent = this.selfNickname || '';
      $('reset-nick').value = '';
      $('reset-error').hidden = true;
      $('reset-submit').disabled = true;
      $('reset-modal').hidden = false;
      setTimeout(() => $('reset-nick').focus(), 50);
    }

    closeResetModal() {
      $('reset-modal').hidden = true;
    }

    loadFlag(key, def) {
      try { const v = localStorage.getItem(key); return v === null ? def : v === '1'; } catch (_) { return def; }
    }

    saveFlag(key, v) {
      try { localStorage.setItem(key, v ? '1' : '0'); } catch (_) { /* ignore */ }
    }

    /** 설정 팝오버의 강아지 이름 (입력 중이면 덮어쓰지 않는다) */
    setNpcs(list) {
      for (const n of list) this.setNpcName(n.id, n.name);
    }

    setNpcName(id, name) {
      if (id !== 'dog') return;
      const input = $('npc-name');
      if (document.activeElement !== input) input.value = name;
      input.placeholder = name;
    }

    setOffline(off) {
      $('banner-offline').hidden = !off;
    }

    // ── 멤버 / 알림 ──────────────────────────────────────────────────
    setSelf(id, nickname) {
      this.selfId = id;
      this.selfNickname = nickname;
      $('settings-nick').textContent = nickname;
    }

    setPlayers(list) {
      this.players = new Map(list.map((p) => [p.id, { ...p }]));
      this.renderMembers();
    }

    upsertPlayer(p) {
      this.players.set(p.id, { ...(this.players.get(p.id) || {}), ...p });
      this.renderMembers();
    }

    removePlayer(id) {
      this.players.delete(id);
      this.renderMembers();
    }

    renderMembers() {
      const list = $('members-list');
      list.innerHTML = '';
      const arr = [...this.players.values()].sort((a, b) => (a.id === this.selfId ? -1 : b.id === this.selfId ? 1 : a.nickname.localeCompare(b.nickname)));
      $('members-count').textContent = `${arr.length}명`;
      for (const p of arr) {
        const chip = el('span', { class: `status-chip ${p.status}`, text: STATUS_LABEL[p.status] || '' });
        const name = el('span', { class: 'name', text: p.nickname + (p.listening ? ' ♪' : '') + (p.id === this.selfId ? ' (나)' : '') + (p.connected === false ? ' · 연결 끊김' : '') });
        const body = el('div', { class: 'member-body' }, [name]);
        if (p.listening) body.appendChild(el('span', { class: 'listening', text: `듣는 중: ${p.listening}` }));
        const li = el('li', { class: `${p.id === this.selfId ? 'me' : ''} ${p.connected === false ? 'offline' : ''}` }, [
          svgIcon(STATUS_ICON[p.status] || 'i-coffee'),
          body,
          chip,
        ]);
        list.appendChild(li);
      }
    }

    notify(text) {
      const list = $('notify-list');
      if (list.firstChild && list.firstChild.classList.contains('muted')) list.innerHTML = '';
      list.prepend(el('li', {}, [svgIcon('i-bell'), el('span', { text }), el('span', { class: 'time', text: hhmm(Date.now()) })]));
      while (list.children.length > 30) list.lastChild.remove();
      if ($('pop-notify').hidden) {
        this.unread++;
        $('notify-dot').hidden = false;
      }
    }

    clearUnread() {
      this.unread = 0;
      $('notify-dot').hidden = true;
    }

    // ── 사이드바: 할 일 / 뽀모도로 / 채팅 ────────────────────────────
    bindSidebar() {
      $('todo-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const input = $('todo-input');
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        this.onTodoAdd(text);
      });

      // 뽀모도로: 내 시간(분) 입력은 localStorage 에 기억, 시작할 때 서버로 보낸다. 진행 중엔 잠김
      const cfg = this.loadPomoConfig();
      $('pomo-focus').value = String(cfg.focus);
      $('pomo-break').value = String(cfg.break);
      for (const id of ['pomo-focus', 'pomo-break']) {
        const input = $(id);
        input.addEventListener('keydown', (e) => { if (e.key === 'Escape' || e.key === 'Enter') e.target.blur(); e.stopPropagation(); });
        input.addEventListener('change', () => { this.savePomoConfig(this.readPomoConfig()); this.tickPomodoro(); });
      }
      $('btn-pomo').addEventListener('click', () => {
        if (this.pomodoro && this.pomodoro.running) return this.onPomodoro('stop');
        const c = this.readPomoConfig();
        this.savePomoConfig(c);
        return this.onPomodoro('start', { focusMinutes: c.focus, breakMinutes: c.break });
      });

      // 카드 접기/펼치기 (음악 카드 포함). 상태는 localStorage
      for (const card of document.querySelectorAll('#sidebar .card[id]')) {
        const header = card.querySelector('header');
        const btn = el('button', { class: 'icon-btn small ghost card-toggle', type: 'button', title: '접기' }, [svgIcon('i-chevron')]);
        btn.addEventListener('click', (e) => { e.stopPropagation(); this.setCardCollapsed(card.id, !card.classList.contains('collapsed')); });
        const close = header.querySelector('#music-close');
        if (close) header.insertBefore(btn, close);
        else header.appendChild(btn);
        this.setCardCollapsed(card.id, this.loadFlag(LS_CARD + card.id, false), { silent: true });
      }

      const chatForm = $('chat-form');
      const chatInput = $('chat-input');
      chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = chatInput.value.trim();
        if (!text) return;
        this.onChat(text);
        chatInput.value = '';
      });
      chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') chatInput.blur();
        e.stopPropagation();
      });
    }

    /** 카드 접기: 제목 줄만 남긴다. silent 면 저장하지 않음 */
    setCardCollapsed(id, on, { silent = false } = {}) {
      const card = $(id);
      if (!card) return;
      card.classList.toggle('collapsed', on);
      const btn = card.querySelector('.card-toggle');
      if (btn) btn.title = on ? '펼치기' : '접기';
      if (!silent) this.saveFlag(LS_CARD + id, on);
    }

    isCardCollapsed(id) {
      const card = $(id);
      return Boolean(card && card.classList.contains('collapsed'));
    }

    loadPomoConfig() {
      try {
        const v = JSON.parse(localStorage.getItem(LS_POMO) || 'null') || {};
        return { focus: clampInt(v.focus, POMO.focus), break: clampInt(v.break, POMO.break) };
      } catch (_) {
        return { focus: POMO.focus.def, break: POMO.break.def };
      }
    }

    /** 입력칸 값을 범위로 눌러 { focus, break } (분). 잘못된 값은 칸에도 바로 고쳐 넣는다 */
    readPomoConfig() {
      const c = { focus: clampInt($('pomo-focus').value, POMO.focus), break: clampInt($('pomo-break').value, POMO.break) };
      $('pomo-focus').value = String(c.focus);
      $('pomo-break').value = String(c.break);
      return c;
    }

    savePomoConfig(c) {
      try { localStorage.setItem(LS_POMO, JSON.stringify(c)); } catch (_) { /* ignore */ }
    }

    focusChat() {
      if (this.wide) this.setWide(false); // 넓게 보기 중 Enter → 사이드바를 펼치고 채팅으로
      if (this.isCardCollapsed('card-chat')) this.setCardCollapsed('card-chat', false);
      $('chat-input').focus();
      $('card-chat').scrollIntoView({ block: 'nearest' });
    }

    /** 입력창에 포커스가 있으면 게임 키 입력을 막아야 한다 */
    isTyping() {
      const a = document.activeElement;
      return Boolean(a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA'));
    }

    /** 예전 localStorage 할 일을 꺼내고 지운다 (서버로 이전용). 없으면 [] */
    takeLegacyTodos() {
      try {
        const list = JSON.parse(localStorage.getItem(TODO_KEY) || '[]');
        localStorage.removeItem(TODO_KEY);
        return Array.isArray(list) ? list.filter((t) => t && t.text) : [];
      } catch (_) {
        return [];
      }
    }

    /** 서버에서 받은 할 일 목록 (이월 carried 는 맨 위) */
    setTodos(list) {
      this.todos = Array.isArray(list) ? list : [];
      this.renderTodos();
    }

    renderTodos() {
      const todos = this.todos;
      const list = $('todo-list');
      list.innerHTML = '';
      const done = todos.filter((t) => t.done).length;
      $('todo-count').textContent = todos.length ? `${done}/${todos.length}` : '';
      if (!todos.length) {
        list.appendChild(el('li', { class: 'empty', text: '오늘 할 일을 적어 보세요.' }));
        return;
      }
      for (const t of todos) {
        const li = el('li', { class: `${t.done ? 'done' : ''} ${t.carried ? 'carried' : ''}` }, [
          el('button', { class: 'check', type: 'button', title: t.done ? '되돌리기' : '완료', onclick: () => this.onTodoToggle(t.id, !t.done) }, [svgIcon('i-check')]),
          t.carried ? el('span', { class: 'badge-carried', text: '이월', title: '어제 못 끝낸 할 일' }) : null,
          el('span', { class: 'text', text: t.text }),
          el('button', { class: 'del', type: 'button', title: '삭제', onclick: () => this.onTodoDelete(t.id) }, [svgIcon('i-x')]),
        ]);
        list.appendChild(li);
      }
    }

    // ── 오늘의 목표 / 랭킹 / 토스트 ─────────────────────────────────
    bindGoalAndRank() {
      const sel = $('goal-minutes');
      for (const m of GOAL_MINUTES) sel.appendChild(el('option', { value: String(m), text: fmtMinutes(m) }));
      sel.value = '60';
      $('goal-form').addEventListener('submit', (e) => {
        e.preventDefault();
        this.onGoalSave({ text: $('goal-text').value.trim(), targetMinutes: Number(sel.value) });
      });
      $('goal-text').addEventListener('keydown', (e) => { if (e.key === 'Escape') e.target.blur(); e.stopPropagation(); });
      for (const b of document.querySelectorAll('#rank-tabs button')) {
        b.addEventListener('click', () => {
          this.rankTab = b.dataset.tab;
          this.renderRank();
        });
      }
    }

    /** 오늘 목표 (입장 ack / 저장 응답). null 이면 없음 */
    setGoal(goal) {
      this.goal = goal && (goal.text || goal.targetMinutes) ? goal : null;
      const input = $('goal-text');
      if (document.activeElement !== input) input.value = this.goal ? this.goal.text || '' : '';
      if (this.goal && this.goal.targetMinutes) $('goal-minutes').value = String(this.goal.targetMinutes);
      this.renderGoal();
    }

    /** 오늘 누적 초 (랭킹 통계에서) → 목표 카드 진행 */
    setTodaySeconds(sec) {
      this.todaySeconds = Math.max(0, Number(sec) || 0);
      this.renderGoal();
    }

    renderGoal() {
      const bar = $('goal-bar');
      const txt = $('goal-progress');
      if (!this.goal || !this.goal.targetMinutes) {
        bar.style.width = '0%';
        bar.classList.remove('done');
        txt.textContent = this.todaySeconds ? `오늘 ${fmtDuration(this.todaySeconds)} 공부 · 목표를 정해 보세요` : '목표 시간을 정하면 팻말과 진행 바가 생겨요';
        return;
      }
      const ratio = Math.min(1, this.todaySeconds / (this.goal.targetMinutes * 60));
      bar.style.width = `${Math.round(ratio * 100)}%`;
      bar.classList.toggle('done', ratio >= 1);
      txt.textContent = `${fmtDuration(this.todaySeconds)} / ${fmtMinutes(this.goal.targetMinutes)}${ratio >= 1 ? ' · 달성 🎉' : ''}`;
    }

    /** 랭킹 통계 { store, rows: [{ nickname, todaySeconds, weekSeconds, streak, live, online }] } */
    setStats(res) {
      this.stats = res;
      const badge = $('rank-store');
      const sb = res.store === 'supabase';
      badge.textContent = sb ? '☁ Supabase' : '⚠ 메모리 (서버 재시작 시 사라짐)';
      badge.classList.toggle('warn', !sb);
      const me = this.selfNickname ? res.rows.find((r) => r.nickname === this.selfNickname) : null;
      this.setTodaySeconds(me ? me.todaySeconds : 0);
      this.renderRank();
    }

    renderRank() {
      const list = $('rank-list');
      list.innerHTML = '';
      for (const b of document.querySelectorAll('#rank-tabs button')) b.classList.toggle('active', b.dataset.tab === this.rankTab);
      if (!this.stats) return;
      const key = this.rankTab === 'week' ? 'weekSeconds' : 'todaySeconds';
      const rows = this.stats.rows.filter((r) => r[key] > 0 || r.live || r.online).sort((a, b) => b[key] - a[key] || a.nickname.localeCompare(b.nickname));
      if (!rows.length) {
        list.appendChild(el('li', { class: 'empty', text: this.rankTab === 'week' ? '이번 주 기록이 아직 없어요.' : '오늘 기록이 아직 없어요. 자리에 앉아 공부를 시작해 보세요.' }));
        return;
      }
      rows.slice(0, 20).forEach((r, i) => {
        list.appendChild(el('li', { class: `${r.nickname === this.selfNickname ? 'me' : ''} ${r.online ? '' : 'offline'}` }, [
          el('span', { class: 'rank-no', text: String(i + 1) }),
          el('span', { class: `dot-live ${r.live ? 'on' : ''}`, title: r.live ? '공부 중' : '' }),
          el('span', { class: 'name', text: r.nickname }),
          r.streak > 0 ? el('span', { class: 'streak', text: `🔥${r.streak}`, title: `${r.streak}일 연속 출석` }) : null,
          el('span', { class: 'time mono', text: fmtDuration(r[key]) }),
        ]));
      });
    }

    /** 짧은 안내 토스트 (3초). 연달아 오면 차례로 보여준다 */
    toast(text, ms = 3000) {
      this.toastQueue = this.toastQueue || [];
      this.toastQueue.push({ text, ms });
      if (!this.toastTimer) this.nextToast();
    }

    nextToast() {
      const t = $('toast');
      const item = this.toastQueue.shift();
      if (!item) {
        t.classList.remove('show');
        t.hidden = true;
        this.toastTimer = null;
        return;
      }
      t.textContent = item.text;
      t.hidden = false;
      t.classList.add('show');
      this.toastTimer = setTimeout(() => this.nextToast(), item.ms);
    }

    /** 내 타이머 상태 (입장 ack · pomodoro 이벤트). 진행 중이면 시간 입력이 잠기고 서버 값이 표시된다 */
    setPomodoro(snap) {
      this.pomodoro = snap;
      const btn = $('btn-pomo');
      btn.querySelector('span').textContent = snap.running ? '정지' : '시작';
      btn.querySelector('use').setAttribute('href', snap.running ? '#i-stop' : '#i-play');
      $('pomo-focus').disabled = Boolean(snap.running);
      $('pomo-break').disabled = Boolean(snap.running);
      if (snap.running) {
        $('pomo-focus').value = String(Math.round(snap.focusMs / 60000));
        $('pomo-break').value = String(Math.round(snap.breakMs / 60000));
      }
      $('pomo-hint').textContent = snap.running ? `집중 ${Math.round(snap.focusMs / 60000)}분 · 휴식 ${Math.round(snap.breakMs / 60000)}분 · 나에게만` : '나에게만 · 시작 전에 바꿀 수 있어요';
      this.tickPomodoro();
    }

    tickPomodoro() {
      const s = this.pomodoro;
      const ring = $('pomo-ring');
      const gauge = ring.closest('.gauge');
      const badge = $('pomo-badge');
      const CIRC = 2 * Math.PI * 52;
      if (!s || !s.running) {
        const total = clampInt($('pomo-focus').value, POMO.focus) * 60 * 1000; // 대기 중엔 내가 정한 집중 시간
        $('pomo-time').textContent = fmt(total);
        $('pomo-phase').textContent = '대기 중';
        ring.style.strokeDashoffset = String(CIRC);
        gauge.classList.remove('break');
        badge.hidden = true;
        return;
      }
      const total = s.phase === 'focus' ? s.focusMs : s.breakMs;
      const remain = Math.max(0, s.endsAt - this.serverNow());
      $('pomo-time').textContent = fmt(remain);
      $('pomo-phase').textContent = s.phase === 'focus' ? '집중' : '휴식';
      ring.style.strokeDashoffset = String(CIRC * (1 - Math.min(1, remain / total)) );
      gauge.classList.toggle('break', s.phase === 'break');
      // 좌상단 배지: 진행 중일 때만 남은 시간
      badge.hidden = false;
      badge.classList.toggle('break', s.phase === 'break');
      badge.querySelector('span').textContent = `${s.phase === 'focus' ? '📖' : '☕'} ${fmt(remain)}`;
    }

    /**
     * msg: { nickname, text(HTML 이스케이프됨), ts, self?: boolean, system?: boolean }
     * 시스템 메시지(입장·쓰다듬기 등)는 회색 작은 글씨. 직전 시스템 메시지와 같으면 새 줄 대신 "×N" 으로 합친다.
     */
    addChat(msg) {
      const log = $('chat-log');
      const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
      let node;
      if (msg.system) {
        const last = log.lastElementChild;
        if (last && last.classList.contains('system') && last.dataset.base === msg.text) {
          const n = Number(last.dataset.n || 1) + 1;
          last.dataset.n = String(n);
          last.textContent = '';
          last.appendChild(document.createTextNode(msg.text));
          last.appendChild(el('span', { class: 'count', text: `×${n}` }));
          if (atBottom) log.scrollTop = log.scrollHeight;
          return;
        }
        node = el('div', { class: 'chat-msg system', text: msg.text });
        node.dataset.base = msg.text;
        node.dataset.n = '1';
      } else {
        node = el('div', { class: `chat-msg ${msg.self ? 'me' : ''}` });
        node.appendChild(el('span', { class: 'when', text: hhmm(msg.ts) }));
        node.appendChild(el('span', { class: 'who', text: msg.nickname }));
        // 서버가 HTML 이스케이프한 문자열 → 엔티티만 풀어서 텍스트로 표시
        node.appendChild(document.createTextNode(UI.unescape(msg.text)));
      }
      log.appendChild(node);
      while (log.children.length > 200) log.firstChild.remove();
      if (atBottom || msg.self) log.scrollTop = log.scrollHeight;
    }

    static unescape(s) {
      return String(s).replace(/&(amp|lt|gt|quot|#39);/g, (m, k) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }[k]));
    }

    // ── 유튜브 카드 (IFrame API, 소리는 본인에게만) ──────────────────
    bindMusic() {
      $('music-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const input = $('music-url');
        const entry = Music.parseYoutube(input.value);
        if (!entry) {
          $('music-error').hidden = false;
          return;
        }
        $('music-error').hidden = true;
        input.value = '';
        this.loadMusic(entry, { autoplay: this.yt.userPlayed });
      });
      $('music-url').addEventListener('keydown', (e) => { if (e.key === 'Escape') e.target.blur(); e.stopPropagation(); });
      $('music-play').addEventListener('click', () => this.playMusic());
      $('music-pause').addEventListener('click', () => this.pauseMusic());
      $('music-close').addEventListener('click', () => this.toggleMusic(false));
      this.renderRecent();
    }

    get musicOpen() {
      return !$('card-music').hidden;
    }

    /** ♪ 버튼 / 패널 앞 E: 카드 열기·닫기 (닫아도 재생은 유지되지 않는다 — 플레이어를 정지한다) */
    toggleMusic(force) {
      const card = $('card-music');
      const open = force === undefined ? card.hidden : Boolean(force);
      card.hidden = !open;
      $('btn-music').classList.toggle('active', open);
      if (open) {
        if (this.wide) this.setWide(false);
        this.setCardCollapsed('card-music', false);
        if (!this.yt.current && this.loadRecent()[0]) this.loadMusic(this.loadRecent()[0], { autoplay: false });
        setTimeout(() => $('music-url').focus(), 50);
      } else this.pauseMusic();
    }

    openMusic() {
      this.toggleMusic(true);
    }

    loadRecent() {
      try { return JSON.parse(localStorage.getItem(LS_RECENT) || '[]'); } catch (_) { return []; }
    }

    saveRecent(list) {
      try { localStorage.setItem(LS_RECENT, JSON.stringify(list)); } catch (_) { /* ignore */ }
    }

    renderRecent() {
      const ul = $('music-recent');
      ul.innerHTML = '';
      const list = this.loadRecent();
      if (!list.length) {
        ul.appendChild(el('li', { class: 'empty', text: '최근 재생한 영상이 여기에 남아요 (5개).' }));
        return;
      }
      for (const e of list) {
        const label = e.title || (e.videoId ? `영상 ${e.videoId}` : `재생목록 ${e.listId}`);
        ul.appendChild(el('li', { class: this.yt.current && Music.keyOf(this.yt.current) === Music.keyOf(e) ? 'active' : '' }, [
          svgIcon('i-music'),
          el('button', { class: 'text', type: 'button', text: label, title: label, onclick: () => this.loadMusic(e, { autoplay: this.yt.userPlayed }) }),
        ]));
      }
    }

    /** IFrame API 스크립트는 카드를 처음 쓸 때만 불러온다 */
    loadYoutubeApi() {
      if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
      if (this.yt.apiPromise) return this.yt.apiPromise;
      this.yt.apiPromise = new Promise((resolve, reject) => {
        const prev = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = () => { if (prev) prev(); resolve(window.YT); };
        const sc = document.createElement('script');
        sc.src = YT_API;
        sc.async = true;
        sc.onerror = () => { this.yt.apiPromise = null; reject(new Error('유튜브 API 를 불러오지 못했어요.')); };
        document.head.appendChild(sc);
        setTimeout(() => { if (!(window.YT && window.YT.Player)) { this.yt.apiPromise = null; reject(new Error('유튜브 API 응답 없음')); } }, 12000);
      });
      return this.yt.apiPromise;
    }

    /** 영상/재생목록 로드. autoplay 는 사용자가 이 세션에서 재생 버튼을 누른 뒤에만 true */
    async loadMusic(entry, { autoplay = false } = {}) {
      const yt = this.yt;
      yt.current = { videoId: entry.videoId || null, listId: entry.listId || null, title: entry.title || '' };
      yt.title = entry.title || '';
      this.setMusicTitle(yt.title || '불러오는 중…');
      this.saveRecent(Music.pushRecent(this.loadRecent(), yt.current));
      this.renderRecent();
      this.fetchTitle(yt.current);
      try {
        await this.loadYoutubeApi();
      } catch (err) {
        $('music-error').textContent = err.message;
        $('music-error').hidden = false;
        return;
      }
      const cur = yt.current;
      if (!yt.player) {
        yt.ready = false;
        const playerVars = { rel: 0, modestbranding: 1, playsinline: 1, autoplay: 0 };
        if (cur.listId) { playerVars.listType = 'playlist'; playerVars.list = cur.listId; }
        yt.player = new window.YT.Player('yt-player', {
          width: '100%',
          height: '100%',
          videoId: cur.videoId || undefined,
          playerVars,
          events: {
            onReady: () => { yt.ready = true; if (autoplay) this.playMusic(); },
            onStateChange: (e) => this.onPlayerState(e.data),
            onError: () => { $('music-error').textContent = '이 영상은 재생할 수 없어요.'; $('music-error').hidden = false; },
          },
        });
        return;
      }
      if (!yt.ready) return;
      if (cur.listId) {
        if (autoplay) yt.player.loadPlaylist({ listType: 'playlist', list: cur.listId });
        else yt.player.cuePlaylist({ listType: 'playlist', list: cur.listId });
      } else if (autoplay) yt.player.loadVideoById(cur.videoId);
      else yt.player.cueVideoById(cur.videoId);
    }

    /** 제목은 서버 oEmbed 프록시로 (실패하면 플레이어의 getVideoData 로 대체) */
    async fetchTitle(entry) {
      if (!entry.videoId) return;
      try {
        const r = await fetch(`/api/oembed?url=${encodeURIComponent(Music.canonicalUrl({ videoId: entry.videoId }))}`);
        const j = await r.json();
        if (j.ok && j.title && this.yt.current && this.yt.current.videoId === entry.videoId) this.applyTitle(j.title);
      } catch (_) { /* 플레이어 제목으로 대체 */ }
    }

    applyTitle(title) {
      const yt = this.yt;
      yt.title = title;
      yt.current.title = title;
      this.setMusicTitle(title);
      this.saveRecent(Music.pushRecent(this.loadRecent(), yt.current));
      this.renderRecent();
      if (yt.playing) this.onListening(title);
    }

    setMusicTitle(t) {
      $('music-title').textContent = t;
    }

    playMusic() {
      const yt = this.yt;
      yt.userPlayed = true;
      if (yt.player && yt.ready) yt.player.playVideo();
    }

    pauseMusic() {
      const yt = this.yt;
      if (yt.player && yt.ready) { try { yt.player.pauseVideo(); } catch (_) { /* ignore */ } }
    }

    onPlayerState(state) {
      const YT = window.YT;
      const yt = this.yt;
      const playing = YT && state === YT.PlayerState.PLAYING;
      if (playing && !yt.title) {
        try { const d = yt.player.getVideoData(); if (d && d.title) this.applyTitle(d.title); } catch (_) { /* ignore */ }
      }
      if (playing === yt.playing) return;
      yt.playing = playing;
      $('card-music').classList.toggle('playing', playing);
      this.onListening(playing ? (yt.title || '유튜브') : null);
    }

    // ── 미니맵 ───────────────────────────────────────────────────────
    buildMinimapBase() {
      const room = this.room;
      const S = MINIMAP_SCALE;
      const base = document.createElement('canvas');
      base.width = room.width * S;
      base.height = room.height * S;
      const ctx = base.getContext('2d');
      for (let y = 0; y < room.height; y++) {
        for (let x = 0; x < room.width; x++) {
          const floor = room.layers.floor[y][x];
          const furn = room.layers.furniture[y][x];
          let c = '#0f0c14';
          if (floor !== -1) c = y >= 26 ? '#2a2630' : '#3a2c26';
          if (room.collision[y][x]) c = floor !== -1 && y >= 26 ? '#1e1b24' : '#241b1e';
          if (furn !== -1 && !room.collision[y][x]) c = '#4a3a30';
          if (furn !== -1 && room.collision[y][x]) c = '#5a4638';
          ctx.fillStyle = c;
          ctx.fillRect(x * S, y * S, S, S);
        }
      }
      ctx.fillStyle = 'rgba(255,184,92,0.55)';
      for (const s of room.seats) ctx.fillRect(s.x * S + 2, s.y * S + 2, S - 4, S - 4);
      this.minimapBase = base;
      const mm = $('minimap');
      mm.width = base.width;
      mm.height = base.height;
      this.drawMinimap({});
    }

    /** positions: id → { x, y } (월드 px). 10Hz 정도로 호출. */
    drawMinimap(positions) {
      const mm = $('minimap');
      const ctx = mm.getContext('2d');
      const S = MINIMAP_SCALE / this.room.tileSize;
      ctx.drawImage(this.minimapBase, 0, 0);
      for (const [id, p] of Object.entries(positions)) {
        const me = id === this.selfId;
        ctx.beginPath();
        ctx.arc(p.x * S, (p.y - 16) * S, me ? 4 : p.npc ? 2.5 : 3, 0, Math.PI * 2);
        ctx.fillStyle = me ? '#ffb85c' : p.npc ? '#c48c52' : '#f1e6d2';
        ctx.fill();
        if (me) {
          ctx.strokeStyle = 'rgba(255,184,92,0.5)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }
    }

    // ── 입장 모달 ────────────────────────────────────────────────────
    /**
     * 입장 정보를 받는다. submit 이 실패(reject)하면 에러를 보여주고 다시 기다린다.
     * passwordRequired 면 비밀번호 칸을 보여 준다(6단계). 거부 에러에 retryAfterMs 가 있으면 그동안 버튼을 잠그고 초를 센다.
     */
    showLogin({ nickname = '', avatar = null, error = '', passwordRequired = false, password = '' }, submit) {
      const modal = $('login');
      const form = $('login-form');
      const input = $('login-nick');
      const pass = $('login-pass');
      const err = $('login-error');
      const btn = $('login-submit');
      this.inRoom = false;
      this.closeAvatarModal();
      $('login-avatar-slot').appendChild(this.builder.root);
      this.avatarTouched = avatar !== null && avatar !== undefined;
      this.setAvatar(avatar);
      this.builder.setVisible(true);
      input.value = nickname;
      $('login-pass-field').hidden = !passwordRequired;
      pass.value = passwordRequired ? password : '';
      pass.required = passwordRequired;
      err.textContent = error;
      err.hidden = !error;
      modal.hidden = false;
      setTimeout(() => (passwordRequired && nickname ? pass : input).focus(), 50);
      clearInterval(this.loginLockTimer);
      const onSubmit = async (e) => {
        e.preventDefault();
        btn.disabled = true;
        err.hidden = true;
        try {
          await submit({ nickname: input.value.trim(), avatar: this.avatarTouched ? this.avatar : null, password: passwordRequired ? pass.value : '' });
          form.removeEventListener('submit', onSubmit);
          modal.hidden = true;
          this.builder.setVisible(false);
          this.inRoom = true;
        } catch (ex) {
          if (ex.retryAfterMs > 0) {
            this.lockLogin(ex.retryAfterMs);
            return; // 버튼은 카운트다운이 끝날 때 풀린다
          }
          err.textContent = ex.message || '입장에 실패했습니다.';
          err.hidden = false;
          if (ex.clearPassword) { pass.value = ''; pass.focus(); }
          btn.disabled = false;
        }
      };
      form.addEventListener('submit', onSubmit);
    }

    /** 비밀번호를 여러 번 틀려 잠긴 동안 입장 버튼을 막고 남은 초를 센다 */
    lockLogin(ms) {
      const err = $('login-error');
      const btn = $('login-submit');
      const until = Date.now() + ms;
      clearInterval(this.loginLockTimer);
      const tick = () => {
        const left = Math.ceil((until - Date.now()) / 1000);
        if (left <= 0) {
          clearInterval(this.loginLockTimer);
          this.loginLockTimer = null;
          btn.disabled = false;
          err.hidden = true;
          $('login-pass').focus();
          return;
        }
        err.textContent = `비밀번호를 여러 번 틀렸어요. ${left}초 뒤에 다시 시도해 주세요.`;
        err.hidden = false;
        btn.disabled = true;
      };
      tick();
      this.loginLockTimer = setInterval(tick, 250);
    }

    hideLoading() {
      $('loading').classList.add('hidden');
    }
  }

  // ── 아바타 빌더 ──────────────────────────────────────────────────
  const TAB_ORDER = ['hair', 'top', 'bottom', 'shoes', 'body', 'acc'];
  const DIR_CYCLE = ['down', 'right', 'up', 'left'];
  const PREVIEW_SCALE = 4; // 32x64 프레임 → 128x256 (방 안 2배 줌의 2배)
  const WALK_FPS = 8;

  class AvatarBuilder {
    constructor(kit, root) {
      this.kit = kit;
      this.root = root;
      this.avatar = kit.normalize(null);
      this.tab = 'hair';
      this.dirIndex = 0;
      this.frame = 0;
      this.onChange = () => {};
      this.visible = false;
      this.raf = null;
      this.lastTick = 0;
      this.preview = root.querySelector('#ab-preview');
      this.preview.addEventListener('click', () => { this.dirIndex = (this.dirIndex + 1) % DIR_CYCLE.length; this.drawPreview(); });
      root.querySelector('#ab-random').addEventListener('click', () => this.set(kit.random()));
      root.querySelector('#ab-reset').addEventListener('click', () => this.set(kit.defaults));
      this.renderTabs();
      this.renderGrid();
      this.drawPreview();
    }

    set(avatar, { silent = false } = {}) {
      this.avatar = this.kit.normalize(avatar);
      this.renderGrid();
      this.drawPreview();
      if (!silent) this.onChange(this.avatar);
    }

    patch(field, value) {
      this.set({ ...this.avatar, [field]: value });
    }

    /** 보일 때만 걷기 애니메이션 rAF 를 돌린다 */
    setVisible(on) {
      this.visible = on;
      if (on && !this.raf) {
        const tick = (t) => {
          if (!this.visible) { this.raf = null; return; }
          if (t - this.lastTick >= 1000 / WALK_FPS) {
            this.lastTick = t;
            this.frame = (this.frame + 1) % this.kit.frame.framesPerRow;
            this.drawPreview();
          }
          this.raf = requestAnimationFrame(tick);
        };
        this.raf = requestAnimationFrame(tick);
      }
    }

    drawPreview() {
      const ctx = this.preview.getContext('2d');
      ctx.clearRect(0, 0, this.preview.width, this.preview.height);
      this.kit.drawFrame(ctx, this.avatar, DIR_CYCLE[this.dirIndex], this.frame, 0, 0, PREVIEW_SCALE);
    }

    renderTabs() {
      const box = this.root.querySelector('#ab-tabs');
      box.innerHTML = '';
      for (const name of TAB_ORDER) {
        const layer = this.kit.catalog.layers[name];
        if (!layer) continue;
        box.appendChild(el('button', { type: 'button', role: 'tab', 'data-tab': name, text: layer.label, class: name === this.tab ? 'active' : '', onclick: () => { this.tab = name; this.renderTabs(); this.renderGrid(); } }));
      }
    }

    /** 현재 탭의 파츠 썸네일(그 파츠만 바꾼 아바타 정면) + 색상 원형 버튼 */
    renderGrid() {
      const layer = this.kit.catalog.layers[this.tab];
      const grid = this.root.querySelector('#ab-grid');
      const colors = this.root.querySelector('#ab-colors');
      grid.innerHTML = '';
      colors.innerHTML = '';
      if (!layer) return;
      const thumb = (avatar, label, selected, onclick) => {
        const c = document.createElement('canvas');
        c.width = this.kit.frame.width;
        c.height = this.kit.frame.height;
        this.kit.drawFrame(c.getContext('2d'), avatar, 'down', 0, 0, 0, 1);
        return el('button', { type: 'button', class: `ab-item${selected ? ' selected' : ''}`, title: label, onclick }, [c, el('span', { text: label })]);
      };
      if (layer.field) {
        for (const it of layer.items) {
          const av = { ...this.avatar, [layer.field]: it.id };
          grid.appendChild(thumb(av, it.label, this.avatar[layer.field] === it.id, () => this.patch(layer.field, it.id)));
        }
      } else if (layer.colorField) {
        // 피부: 색 자체가 선택지 → 썸네일로
        for (const c of this.kit.catalog.colors[layer.colorField]) {
          const av = { ...this.avatar, [layer.colorField]: c.id };
          grid.appendChild(thumb(av, c.label, this.avatar[layer.colorField] === c.id, () => this.patch(layer.colorField, c.id)));
        }
        return;
      }
      if (layer.colorField) {
        for (const c of this.kit.catalog.colors[layer.colorField]) {
          const selected = this.avatar[layer.colorField] === c.id;
          colors.appendChild(el('button', { type: 'button', class: `swatch${selected ? ' selected' : ''}`, title: c.label, 'aria-label': c.label, 'data-color': c.id, style: `background:${c.tones[0]}`, onclick: () => this.patch(layer.colorField, c.id) }));
        }
      }
    }
  }

  function fmt(ms) {
    const s = Math.ceil(ms / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  /** 30 → "30분", 90 → "1시간 30분", 120 → "2시간" */
  function fmtMinutes(m) {
    const h = Math.floor(m / 60);
    const r = m % 60;
    return h ? (r ? `${h}시간 ${r}분` : `${h}시간`) : `${r}분`;
  }

  /** 초 → "1시간 05분" / "23분" / "0분" */
  function fmtDuration(sec) {
    const m = Math.floor((Number(sec) || 0) / 60);
    const h = Math.floor(m / 60);
    return h ? `${h}시간 ${String(m % 60).padStart(2, '0')}분` : `${m}분`;
  }

  window.UI = UI;
  window.AvatarBuilder = AvatarBuilder;
})();
