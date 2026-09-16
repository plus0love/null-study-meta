/**
 * HUD + 사이드바 (DOM). 게임 씬/네트워크와는 콜백(this.on*)으로만 연결한다.
 *  - 좌상단: 방 이름 + 인원   우상단: 설정·멤버·알림·나가기 (팝오버)
 *  - 사이드바: 미니맵 · 오늘의 할 일(localStorage) · 뽀모도로(원형 게이지) · 채팅
 *  - 좌하단: 이모지 바(1~6) · 상태 토글 · 앉기 힌트
 *  - 입장 모달, 재접속 배너
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const AVATAR_COLORS = ['#f1eee8', '#ffc46e', '#a8c496', '#96b4dc'];
  const STATUS_LABEL = { study: '공부 중', rest: '휴식 중' };
  const STATUS_ICON = { study: 'i-book', rest: 'i-coffee' };
  const TODO_KEY = 'nsm.todos';
  const MINIMAP_SCALE = 7; // 타일당 px (46x34 → 322x238)

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

  function hhmm(ts) {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  class UI {
    constructor({ room, serverNow }) {
      this.room = room;
      this.serverNow = serverNow || (() => Date.now());
      this.selfId = null;
      this.players = new Map(); // id → public player (멤버 목록/미니맵용)
      this.status = 'rest';
      this.pomodoro = null;
      this.unread = 0;
      this.avatar = 0;
      this.emojis = ['👋', '😊', '👍', '❤️', '😂', '🔥'];

      // 콜백 (main.js 가 채움)
      this.onChat = () => {};
      this.onEmoji = () => {};
      this.onToggleStatus = () => {};
      this.onAvatar = () => {};
      this.onPomodoro = () => {};
      this.onLeave = () => {};
      this.onRename = () => {};

      this.bindHud();
      this.bindSidebar();
      this.buildMinimapBase();
      this.renderTodos();
      setInterval(() => this.tickPomodoro(), 250);
    }

    // ── 상단 HUD / 팝오버 ─────────────────────────────────────────────
    bindHud() {
      $('room-name').textContent = this.room.name;
      const pops = { settings: $('pop-settings'), members: $('pop-members'), notify: $('pop-notify') };
      const btns = { settings: $('btn-settings'), members: $('btn-members'), notify: $('btn-notify') };
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
      this.buildSwatches($('settings-avatars'), (i) => { this.setAvatar(i); this.onAvatar(i); });

      // 좌하단: 이모지 바 + 상태 토글
      const bar = $('emoji-bar');
      this.emojis.forEach((e, i) => {
        bar.appendChild(el('button', { class: 'emoji-btn', title: `이모지 ${i + 1}`, onclick: () => this.onEmoji(i) }, [e, el('kbd', { text: String(i + 1) })]));
      });
      $('btn-status').addEventListener('click', () => this.onToggleStatus());
      this.setStatus('rest');
    }

    buildSwatches(container, onPick) {
      container.innerHTML = '';
      AVATAR_COLORS.forEach((c, i) => {
        container.appendChild(el('button', { class: 'swatch', type: 'button', style: `background:${c}`, title: `셔츠 ${i + 1}`, 'data-i': String(i), onclick: () => onPick(i) }));
      });
    }

    setAvatar(i) {
      this.avatar = i;
      for (const box of [$('settings-avatars'), $('login-avatars')]) {
        for (const b of box.querySelectorAll('.swatch')) b.classList.toggle('selected', Number(b.dataset.i) === i);
      }
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
      b.classList.remove('study', 'rest');
      b.classList.add(status);
      b.querySelector('span').textContent = STATUS_LABEL[status] || status;
      b.querySelector('use').setAttribute('href', `#${STATUS_ICON[status] || 'i-coffee'}`);
    }

    setSitHint(mode) {
      // mode: null | 'sit' | 'stand'
      const h = $('sit-hint');
      h.hidden = !mode;
      if (mode) h.querySelector('span').textContent = mode === 'sit' ? '앉기' : '일어나기';
    }

    setOffline(off) {
      $('banner-offline').hidden = !off;
    }

    // ── 멤버 / 알림 ──────────────────────────────────────────────────
    setSelf(id, nickname) {
      this.selfId = id;
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
        const li = el('li', { class: `${p.id === this.selfId ? 'me' : ''} ${p.connected === false ? 'offline' : ''}` }, [
          svgIcon(STATUS_ICON[p.status] || 'i-coffee'),
          el('span', { text: p.nickname + (p.id === this.selfId ? ' (나)' : '') + (p.connected === false ? ' · 연결 끊김' : '') }),
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
        const todos = this.loadTodos();
        todos.push({ id: Date.now().toString(36), text, done: false });
        this.saveTodos(todos);
        input.value = '';
        this.renderTodos();
      });

      $('btn-pomo').addEventListener('click', () => this.onPomodoro(this.pomodoro && this.pomodoro.running ? 'stop' : 'start'));

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

    focusChat() {
      $('chat-input').focus();
    }

    /** 입력창에 포커스가 있으면 게임 키 입력을 막아야 한다 */
    isTyping() {
      const a = document.activeElement;
      return Boolean(a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA'));
    }

    loadTodos() {
      try { return JSON.parse(localStorage.getItem(TODO_KEY) || '[]'); } catch (_) { return []; }
    }

    saveTodos(todos) {
      try { localStorage.setItem(TODO_KEY, JSON.stringify(todos)); } catch (_) { /* ignore */ }
    }

    renderTodos() {
      const todos = this.loadTodos();
      const list = $('todo-list');
      list.innerHTML = '';
      const done = todos.filter((t) => t.done).length;
      $('todo-count').textContent = todos.length ? `${done}/${todos.length}` : '';
      if (!todos.length) {
        list.appendChild(el('li', { class: 'empty', text: '오늘 할 일을 적어 보세요.' }));
        return;
      }
      for (const t of todos) {
        const li = el('li', { class: t.done ? 'done' : '' }, [
          el('button', { class: 'check', type: 'button', title: '완료', onclick: () => { t.done = !t.done; this.saveTodos(todos); this.renderTodos(); } }, [svgIcon('i-check')]),
          el('span', { class: 'text', text: t.text }),
          el('button', { class: 'del', type: 'button', title: '삭제', onclick: () => { this.saveTodos(todos.filter((x) => x.id !== t.id)); this.renderTodos(); } }, [svgIcon('i-x')]),
        ]);
        list.appendChild(li);
      }
    }

    setPomodoro(snap) {
      this.pomodoro = snap;
      const btn = $('btn-pomo');
      btn.querySelector('span').textContent = snap.running ? '정지' : '시작';
      btn.querySelector('use').setAttribute('href', snap.running ? '#i-stop' : '#i-play');
      $('pomo-by').textContent = snap.running && snap.startedBy ? `${snap.startedBy} 시작` : '';
      this.tickPomodoro();
    }

    tickPomodoro() {
      const s = this.pomodoro;
      const ring = $('pomo-ring');
      const gauge = ring.closest('.gauge');
      const CIRC = 2 * Math.PI * 52;
      if (!s || !s.running) {
        const total = s ? s.focusMs : 25 * 60 * 1000;
        $('pomo-time').textContent = fmt(total);
        $('pomo-phase').textContent = '대기 중';
        ring.style.strokeDashoffset = String(CIRC);
        gauge.classList.remove('break');
        return;
      }
      const total = s.phase === 'focus' ? s.focusMs : s.breakMs;
      const remain = Math.max(0, s.endsAt - this.serverNow());
      $('pomo-time').textContent = fmt(remain);
      $('pomo-phase').textContent = s.phase === 'focus' ? '집중' : '휴식';
      ring.style.strokeDashoffset = String(CIRC * (1 - Math.min(1, remain / total)) );
      gauge.classList.toggle('break', s.phase === 'break');
    }

    /** msg: { nickname, text(HTML 이스케이프됨), ts, self?: boolean, system?: boolean } */
    addChat(msg) {
      const log = $('chat-log');
      const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
      let node;
      if (msg.system) node = el('div', { class: 'chat-msg system', text: msg.text });
      else {
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
        ctx.arc(p.x * S, (p.y - 16) * S, me ? 4 : 3, 0, Math.PI * 2);
        ctx.fillStyle = me ? '#ffb85c' : '#f1e6d2';
        ctx.fill();
        if (me) {
          ctx.strokeStyle = 'rgba(255,184,92,0.5)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }
    }

    // ── 입장 모달 ────────────────────────────────────────────────────
    /** 입장 정보를 받는다. submit 이 실패(reject)하면 에러를 보여주고 다시 기다린다. */
    showLogin({ nickname = '', avatar = 0, error = '' }, submit) {
      const modal = $('login');
      const form = $('login-form');
      const input = $('login-nick');
      const err = $('login-error');
      const btn = $('login-submit');
      this.buildSwatches($('login-avatars'), (i) => this.setAvatar(i));
      this.setAvatar(avatar);
      input.value = nickname;
      err.textContent = error;
      err.hidden = !error;
      modal.hidden = false;
      setTimeout(() => input.focus(), 50);
      const onSubmit = async (e) => {
        e.preventDefault();
        btn.disabled = true;
        err.hidden = true;
        try {
          await submit({ nickname: input.value.trim(), avatar: this.avatar });
          form.removeEventListener('submit', onSubmit);
          modal.hidden = true;
        } catch (ex) {
          err.textContent = ex.message || '입장에 실패했습니다.';
          err.hidden = false;
        } finally {
          btn.disabled = false;
        }
      };
      form.addEventListener('submit', onSubmit);
    }

    hideLoading() {
      $('loading').classList.add('hidden');
    }
  }

  function fmt(ms) {
    const s = Math.ceil(ms / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  window.UI = UI;
})();
