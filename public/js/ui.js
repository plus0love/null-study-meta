/* global Music */
/**
 * HUD + 사이드바 (DOM). 게임 씬/네트워크와는 콜백(this.on*)으로만 연결한다.
 *  - 좌상단: 방 이름 + 인원 + (뽀모도로 진행 중) 남은 시간 배지 + 🪙 잔액   우상단: 설정·멤버·알림·♪·🪙 지갑·나가기 (팝오버)
 *  - 지갑 모달: 탭 가구/펫/펫 꾸미기/탈것 + 최근 거래 10건. 잔액은 서버 coins 이벤트로만 바뀐다.
 *    9단계 가구 탭: 카테고리(책상 소품/공용 가구) → 카드(아이콘·이름·가격·보유 수·색 선택·구매). 아이콘 클릭 → 미리보기(방 스프라이트 크게)
 *  - 가구 편집 바(9단계, 하단): 🛠 버튼으로 켠다. 팔레트(내 인벤토리의 공용 가구, 안 놓은 것) + 방에 놓인 가구 목록(회수). 씬의 편집 상태를 안내 줄에 보여준다
 *  - 설정 → 내 책상: 슬롯 3개(select) 에 책상 소품 장착 · "내가 놓은 가구는 나만 이동·회수" 설정
 *  - 10단계 펫: 지갑 펫 탭(개인 펫/공용 펫/행동 업그레이드 카드, 공용 펫은 "방에 풀기"·회수, 행동은 대상 펫 선택) · 펫 꾸미기 탭(색 선택) · 미리보기(걷기 애니메이션)
 *    설정 → 강아지 꾸미기 슬롯(누구나) · 내 펫(활성 펫·이름·꾸미기 슬롯) · 공용 펫 목록(내가 푼 것은 이름 변경·회수). 미니맵에 펫은 종별 색 점
 *  - 사이드바: 미니맵 · 오늘의 목표 · 오늘의 할 일(서버 저장, 이월 배지) · 뽀모도로(개인 타이머, 원형 게이지) · 랭킹(오늘/이번 주) · 유튜브 · 채팅
 *    카드마다 접기/펼치기(제목 줄만 남음, localStorage nsm.card.<id>)
 *  - 토스트: 출석 스트릭 ("N일 연속 출석 🔥") 등 짧은 안내
 *  - 좌하단: 이모지 바(1~6) · 상태 토글 · E 힌트(앉기/쓰다듬기/커피 마시기/음악 듣기)
 *  - 입장 모달, 재접속 배너
 *  - 설정: 아바타(빌더 모달) · 닉네임 · 강아지 이름 · 화면 크기(줌 1.5/2/2.5) · 넓게 보기 · 항상 밤 · 알림 소리 · 브라우저 알림 허용 · 내 기록 초기화(닉네임 확인 모달)
 *  - 아바타 빌더(AvatarBuilder): 입장 모달과 설정 모달이 같은 DOM(#avatar-builder)을 옮겨 가며 쓴다.
 *    좌: 4배 미리보기(걷기 애니메이션, 클릭으로 방향 회전) · 우: 파츠 탭 → 썸네일 그리드 → 색상 원형 버튼 · 랜덤/초기화
 *  - 11단계 스터디: 입장 모달(닉네임·아바타·사이트 비밀번호) → 로비 모달(내 스터디 카드: 접속/정원·🔒·이번 주 시간·그룹 스트릭·목표 진행 바,
 *    다른 스터디 목록, 만들기 모달, 코드로 참가) → 스터디. 잠긴 스터디는 비밀번호 모달(askStudyPassword).
 *    좌상단 배지 = 스터디 이름(+🔒) → 클릭하면 스터디 정보 팝오버(코드·링크 복사, 주간 목표 바, 그룹 스트릭, 멤버 목록, 방장 설정·내보내기·삭제).
 *    랭킹 카드 "이 스터디 / 전체" 토글. 알림 벨: 입장·목표·펫 풀림 (notify()).
 *  - 12단계 야외: setRoom(room) 으로 미니맵을 맵 크기에 맞춰 다시 그린다 (야외는 잔디·트랙·물 색). setOutdoor(on) → 🌳 배지 · 🛠 숨김.
 *    지갑 탈것 탭(탈것 4 · 데칼 3 · 경적 3, 색 선택) + 하단 내 최고 기록 · 설정 → 내 탈것(활성·데칼·경적 select) · 야외 프로필 공개 체크.
 *    랩 HUD(setLap: 진행 중 경과·체크포인트·개인 최고) · 전광판 모달(openBoard) · 프로필 모달(showProfile).
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const STATUS_LABEL = { study: '공부 중', rest: '휴식 중', coffee: '☕ 휴식 중' };
  const STATUS_ICON = { study: 'i-book', rest: 'i-leaf', coffee: 'i-coffee' };
  const HINT_LABEL = { sit: '앉기', stand: '일어나기', pet: '쓰다듬기', coffee: '커피 마시기', music: '음악 듣기', lie: '눕기', massage: '안마의자에 앉기', board: '기록 보기', shop: '탈것 상점' };
  const VEHICLE_LABEL = { rickshaw: '🛒 낡은 인력거', bicycle: '🚲 자전거', kickboard: '🛴 킥보드', kart: '🏎 기본 카트', sport: '🏎 스포츠 카트' };
  // 9단계: 편집 거부 사유 → 안내
  const EDIT_ERR = {
    blocked: '여기엔 놓을 수 없어요', overlap: '다른 가구와 겹쳐요', wall_only: '벽 타일에만 놓을 수 있어요', needs_base: '놓을 수 있는 자리가 아니에요 (소파·책장·커피머신 위 등)',
    out_of_bounds: '맵 밖이에요', invalid_rotation: '회전할 수 없어요', player_in_way: '누가 서 있어요', locked: '다른 사람이 잡고 있어요', forbidden: '놓은 사람만 옮길 수 있어요',
    occupied: '누가 앉아 있어요', already_placed: '이미 놓은 아이템이에요', no_item: '없는 아이템이에요', not_found: '이미 없어진 가구예요', not_placeable: '방에 놓는 가구가 아니에요',
  };
  const COIN_REASON = { study: '공부 10분마다', focus: '집중 완주 보너스', weekly_goal: '그룹 목표 보너스', lap: '트랙 첫 완주' }; // 원장 reason → 표시. purchase:<id> 는 "구매 · <id>"
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
  const MINIMAP_W = 322; // 미니맵 폭(px) — 타일당 px 는 맵 폭에 맞춰 정한다 (46타일 → 7, 80타일 → 4)
  const PET_COLORS = { dog: '#c48c52', hamster: '#d9a066', chick: '#f4d35e', turtle: '#6f8567', rabbit: '#efe6d6', cat: '#e0964f', maltese: '#ffffff', poodle_black: '#524b58', shiba: '#e0964f', parrot: '#5f9e5c', slime: '#7fd0b8', fish: '#f2a04a' };
  const PET_SLOT_LABEL = { head: '머리', neck: '목', back: '등' };
  const SKILL_ICON = { skill_come: '📣', skill_sleep: '💤', skill_high_five: '🖐' };
  const YT_API = 'https://www.youtube.com/iframe_api';
  const STUDY_ERR = { // 11단계: 스터디 만들기/설정 거부 사유
    invalid_name: '이름은 1~20자예요.', invalid_password: '비밀번호는 4~20자예요.', invalid_max_players: '정원은 2~12명이에요.', invalid_goal: '주간 목표는 5~100시간이에요.',
    invalid_policy: '편집 권한 값이 이상해요.', forbidden: '방장만 할 수 있어요.', no_study: '없는 스터디예요.', study_full: '정원이 다 찼어요.', not_empty: '다른 사람이 있으면 삭제할 수 없어요.',
    too_many_players: '지금 있는 사람보다 정원이 작아요.', store_error: '저장소 오류가 났어요.', not_member: '멤버가 아니에요.', self: '자기 자신은 내보낼 수 없어요.',
  };

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
    constructor({ room, serverNow, avatarKit, catalog = { tabs: [], categories: [], items: [] }, furn = { img: null, frames: {} }, pets = { meta: null, img: null }, petdeco = { img: null, frames: {}, slots: {} }, vehicles = { img: null, frames: {}, meta: {} }, tiles = null }) {
      this.room = room;
      this.tilesMeta = tiles; // tiles.json (미니맵 색 판정용)
      this.vehicles = vehicles; // 12단계: { img, frames, meta } (DOM 아이콘)
      this.lap = null; // 12단계: 내 랩 진행 { startedAt, next, total }
      this.lapBest = null; // ms
      this.outdoor = false;
      this.serverNow = serverNow || (() => Date.now());
      this.avatarKit = avatarKit;
      this.catalog = catalog; // 9단계: 상점 카탈로그
      this.furn = furn; // 9단계: 가구 아틀라스 { img, frames } (DOM 아이콘)
      this.walletCat = 'desk';
      this.pets = pets; // 10단계: { meta, img }
      this.petdeco = petdeco; // { img, frames, slots }
      this.npcs = new Map(); // id → 마지막 npc:update 스냅샷 (공용 펫 목록·이름)
      this.skillTarget = {}; // 스킬 카드에서 고른 대상
      this.previewTimer = null;
      this.variantPick = {}; // itemId → 고른 variant
      this.deskItems = [null, null, null];
      this.editMode = false;
      this.editState = { on: false, mode: 'off' };
      this.selfId = null;
      this.study = null; // 11단계: 지금 들어가 있는 스터디 (join ack 의 study)
      this.rankScope = 'study'; // 11단계: 랭킹 '이 스터디' | '전체'
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
      this.onWallet = async () => ({ ok: false }); // 8단계: 지갑 데이터 요청
      this.onBuy = async () => ({ ok: false });
      this.onCoinSound = () => {};
      // 9단계
      this.onEditToggle = () => {};
      this.onPlaceItem = () => {};
      this.onRemoveEntry = () => {};
      this.onDeskEquip = async () => ({ ok: false });
      this.onLayoutLock = () => {};
      this.getLayout = () => [];
      // 10단계
      this.onPetConfig = async () => ({ ok: false });
      this.onPetRelease = async () => ({ ok: false });
      this.onPetRecall = async () => ({ ok: false });
      this.onPetDeco = async () => ({ ok: false });
      // 12단계
      this.onVehicleConfig = async () => ({ ok: false });
      this.onStatsPublic = () => {};
      this.onBoard = async () => ({ ok: false });
      // 11단계
      this.onStudyInfo = async () => ({ ok: false });
      this.onStudyUpdate = async () => ({ ok: false });
      this.onStudyKick = async () => ({ ok: false });
      this.onStudyDelete = async () => ({ ok: false });
      this.onRankScope = () => {};
      this.lobbyHandlers = null; // showLobby 가 채움 { onEnter(code), onCreate(form), onRename() }

      this.todos = [];
      this.coins = 0;
      this.walletTab = 'furniture';
      this.wallet = null; // 마지막 wallet 응답
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
      this.bindWallet();
      this.bindEdit();
      this.bindStudy();
      this.bindLobby();
      this.bindOutdoor();
      this.buildMinimapBase();
      this.renderTodos();
      setInterval(() => { this.tickPomodoro(); this.tickLap(); this.tickCoinProgress(); }, 250);
    }

    // ── 야외 (12단계): 배지 · 탈것 설정 · 프로필 · 전광판 · 랩 HUD ─────────
    bindOutdoor() {
      for (const id of ['veh-active', 'veh-decal', 'veh-horn']) {
        $(id).addEventListener('keydown', (e) => e.stopPropagation());
        $(id).addEventListener('change', async () => {
          const key = { 'veh-active': 'active', 'veh-decal': 'decal', 'veh-horn': 'horn' }[id];
          const v = $(id).value;
          const r = await this.onVehicleConfig({ [key]: v ? Number(v) : null });
          if (r && r.ok) { this.toast(key === 'active' ? (v ? '탈것을 골랐어요 · 야외에서 V' : '탈것을 두고 다녀요') : '탈것 설정을 저장했어요'); await this.refreshWallet(); }
        });
      }
      $('opt-stats-public').addEventListener('change', () => this.onStatsPublic($('opt-stats-public').checked));
      $('board-close').addEventListener('click', () => { $('board-modal').hidden = true; });
      $('board-modal').addEventListener('click', (e) => { if (e.target === $('board-modal')) $('board-modal').hidden = true; });
      $('profile-close').addEventListener('click', () => { $('profile-modal').hidden = true; });
      $('profile-modal').addEventListener('click', (e) => { if (e.target === $('profile-modal')) $('profile-modal').hidden = true; });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('board-modal').hidden = true; $('profile-modal').hidden = true; } });
    }

    /** 맵이 바뀌면 미니맵을 다시 만든다 (studyroom ↔ outdoor) */
    setRoom(room) {
      this.room = room;
      this.buildMinimapBase();
      this.setOutdoor(Boolean(room && room.outdoor));
    }

    setOutdoor(on) {
      this.outdoor = Boolean(on);
      document.body.classList.toggle('outdoor', this.outdoor);
      $('place-badge').hidden = !this.outdoor;
      $('vehicle-hint').hidden = !this.outdoor;
      if (!this.outdoor) this.setLap(null);
    }

    /** 서버 lap:progress → HUD. null 이면 숨김 */
    setLap(p) {
      if (!p || p.event === 'reset') this.lap = null;
      else if (p.event === 'lap') { this.lap = { startedAt: p.startedAt, next: 0, total: p.total }; if (this.lapBest === null || p.ms < this.lapBest) this.lapBest = p.ms; }
      else this.lap = { startedAt: p.startedAt, next: p.next, total: p.total };
      this.tickLap();
    }

    setLapBest(ms) {
      this.lapBest = ms === null || ms === undefined ? null : Number(ms);
      this.tickLap();
    }

    tickLap() {
      const hud = $('lap-hud');
      if (!hud) return;
      if (!this.lap || !this.lap.startedAt) { hud.hidden = true; return; }
      hud.hidden = false;
      const elapsed = Math.max(0, this.serverNow() - this.lap.startedAt);
      $('lap-text').textContent = `랩 진행 중 ${(elapsed / 1000).toFixed(1)}s · 체크포인트 ${this.lap.next}/${this.lap.total}`;
      $('lap-best').textContent = this.lapBest !== null ? `개인 최고 ${(this.lapBest / 1000).toFixed(1)}s` : '첫 랩!';
    }

    /** 설정 → 내 탈것: 활성 탈것·데칼·경적 (지갑 인벤토리 기준) */
    renderVehicleSettings() {
      const inv = (this.wallet && this.wallet.inventory) || [];
      const items = new Map(this.catalogItems().map((i) => [i.id, i]));
      const cfg = (this.wallet && this.wallet.vehicleConfig) || { active: null, decal: null, horn: null };
      const fill = (sel, category, none, key) => {
        if (!sel) return 0;
        sel.innerHTML = '';
        sel.appendChild(el('option', { value: '', text: none }));
        let n = 0;
        for (const row of inv) {
          const it = items.get(row.itemId);
          if (!it || it.category !== category) continue;
          const v = it.variants && it.variants.find((x) => x.id === row.meta.variant);
          sel.appendChild(el('option', { value: String(row.id), text: `${it.name}${v ? ` (${v.label})` : ''}` }));
          n++;
        }
        sel.value = cfg[key] !== null && cfg[key] !== undefined ? String(cfg[key]) : '';
        if (sel.value !== String(cfg[key] ?? '')) sel.value = '';
        return n;
      };
      const n = fill($('veh-active'), 'vehicle', '탈것 없음', 'active');
      fill($('veh-decal'), 'vehicleDecal', '데칼 없음', 'decal');
      fill($('veh-horn'), 'vehicleHorn', '경적 없음', 'horn');
      const best = this.wallet && this.wallet.trackBest;
      if ($('veh-hint')) $('veh-hint').textContent = n ? `${best ? `내 최고 기록 ${(best.ms / 1000).toFixed(1)}s (${VEHICLE_LABEL[best.vehicle] || best.vehicle})` : '아직 트랙 기록이 없어요'} · 야외 트랙 출발선을 지나 한 바퀴!` : '지갑 → 탈것에서 사면 여기서 고를 수 있어요';
      if (this.wallet && this.wallet.statsPublic !== undefined) $('opt-stats-public').checked = Boolean(this.wallet.statsPublic);
    }

    setStatsPublic(on) {
      $('opt-stats-public').checked = Boolean(on);
    }

    /** 야외 프로필 모달 (profile ack) */
    showProfile(d) {
      if (!d || !d.ok) return;
      $('profile-nick').textContent = d.nickname;
      $('profile-study').textContent = d.studyName ? `📚 ${d.studyName}` : '스터디 없음';
      $('profile-week').textContent = d.weekSeconds === null || d.weekSeconds === undefined ? '이번 주 공부 시간: 비공개' : `이번 주 공부 ${fmtDuration(d.weekSeconds)}`;
      $('profile-vehicle').textContent = d.vehicle ? `${VEHICLE_LABEL[d.vehicle.type] || d.vehicle.type} 탑승 중` : '';
      $('profile-modal').hidden = false;
    }

    /** 전광판 모달 (track:board ack) */
    async openBoard() {
      $('board-modal').hidden = false;
      const r = await this.onBoard().catch(() => null);
      if (r && r.ok) this.renderBoard(r);
    }

    isBoardOpen() {
      return !$('board-modal').hidden;
    }

    renderBoard(r) {
      const fill = (ul, list) => {
        ul.innerHTML = '';
        if (!list.length) return ul.appendChild(el('li', { class: 'empty', text: '아직 기록이 없어요' }));
        list.forEach((row, i) => ul.appendChild(el('li', { class: row.nickname === this.selfNickname ? 'me' : '' }, [
          el('span', { class: 'rank-no', text: String(i + 1) }),
          el('span', { class: 'name', text: row.nickname }),
          el('span', { class: 'study', text: row.studyName || '' }),
          el('span', { class: 'time', text: `${VEHICLE_LABEL[row.vehicle] || row.vehicle} ${(row.ms / 1000).toFixed(1)}s` }),
        ])));
        return null;
      };
      fill($('board-today'), r.today || []);
      fill($('board-all'), r.all || []);
      $('board-track').textContent = r.track ? `한 바퀴 약 ${r.track.lengthTiles}타일 · 체크포인트 ${r.track.checkpoints}개` : '';
      $('board-mine').textContent = r.myBest ? `내 최고 기록 ${(r.myBest.ms / 1000).toFixed(1)}s (${VEHICLE_LABEL[r.myBest.vehicle] || r.myBest.vehicle}) · 하루 첫 완주 +1 🪙` : '탈것을 타고 출발선을 지나 한 바퀴 돌면 기록돼요 · 하루 첫 완주 +1 🪙';
      if (r.myBest) this.setLapBest(r.myBest.ms);
    }

    // ── 상단 HUD / 팝오버 ─────────────────────────────────────────────
    bindHud() {
      const pops = { settings: $('pop-settings'), members: $('pop-members'), notify: $('pop-notify'), study: $('pop-study') };
      const btns = { settings: $('btn-settings'), members: $('btn-members'), notify: $('btn-notify'), study: $('room-name') };
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
          if (name === 'settings') this.refreshWallet(); // 내 책상 슬롯 목록(인벤토리)
          if (name === 'study') this.refreshStudyInfo(); // 11단계: 멤버·주간 목표
        }
      };
      this.togglePopover = toggle;
      this.closePopovers = () => { for (const k of Object.keys(pops)) { pops[k].hidden = true; btns[k].classList.remove('active'); } };
      for (const k of Object.keys(btns)) btns[k].addEventListener('click', (e) => { e.stopPropagation(); toggle(k); });
      document.addEventListener('click', (e) => {
        if (e.target.closest('#hud-tr') || e.target.closest('#hud-tl')) return;
        this.closePopovers();
      });
      $('btn-leave').addEventListener('click', () => {
        if (window.confirm('스터디에서 나가 로비로 갈까요?')) this.onLeave();
      });
      $('btn-rename').addEventListener('click', () => this.onRename());
      $('npc-name-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const name = $('npc-name').value.trim();
        if (name) this.onNpcName(name);
      });
      $('npc-name').addEventListener('keydown', (e) => e.stopPropagation());
      // 10단계: 내 펫 — 활성 펫 · 이름
      $('mypet-active').addEventListener('change', async () => {
        const v = $('mypet-active').value;
        const r = await this.onPetConfig({ active: v ? Number(v) : null });
        if (r && r.ok) { this.toast(v ? '펫이 따라와요 🐾' : '펫을 집에 두고 왔어요'); await this.refreshWallet(); }
      });
      $('mypet-name-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = $('mypet-name').value.trim();
        const petId = Number($('mypet-active').value);
        if (!name || !petId) return;
        const r = await this.onPetConfig({ petId, name });
        if (r && r.ok) { this.toast('펫 이름을 바꿨어요'); await this.refreshWallet(); }
      });
      $('mypet-name').addEventListener('keydown', (e) => e.stopPropagation());
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
      const coinSound = $('opt-coin-sound');
      coinSound.addEventListener('change', () => this.onCoinSound(coinSound.checked));
      $('btn-notify-perm').addEventListener('click', () => this.onNotifyPerm());
      $('opt-layout-lock').addEventListener('change', () => this.onLayoutLock($('opt-layout-lock').checked));
      this.renderDeskSlots();

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

    setCoinSoundEnabled(on) {
      $('opt-coin-sound').checked = Boolean(on);
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
      // 11단계: 이 스터디 / 전체
      for (const b of document.querySelectorAll('#rank-scope button')) {
        b.addEventListener('click', () => {
          this.rankScope = b.dataset.scope === 'all' ? 'all' : 'study';
          for (const x of document.querySelectorAll('#rank-scope button')) x.classList.toggle('active', x.dataset.scope === this.rankScope);
          this.onRankScope(this.rankScope);
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
      const coins = this.rankTab === 'coins'; // 8단계: 이번 주 획득 코인 (구매로 쓴 건 빼지 않는다)
      const key = coins ? 'weekCoins' : this.rankTab === 'week' ? 'weekSeconds' : 'todaySeconds';
      const rows = this.stats.rows.filter((r) => (r[key] || 0) > 0 || r.live || r.online).sort((a, b) => (b[key] || 0) - (a[key] || 0) || a.nickname.localeCompare(b.nickname));
      if (!rows.length) {
        list.appendChild(el('li', { class: 'empty', text: coins ? '이번 주에 코인을 모은 사람이 아직 없어요.' : this.rankTab === 'week' ? '이번 주 기록이 아직 없어요.' : this.rankScope === 'study' ? '이 스터디에 오늘 기록이 아직 없어요. 자리에 앉아 공부를 시작해 보세요.' : '오늘 기록이 아직 없어요. 자리에 앉아 공부를 시작해 보세요.' }));
        return;
      }
      rows.slice(0, 20).forEach((r, i) => {
        list.appendChild(el('li', { class: `${r.nickname === this.selfNickname ? 'me' : ''} ${r.online ? '' : 'offline'}` }, [
          el('span', { class: 'rank-no', text: String(i + 1) }),
          el('span', { class: `dot-live ${r.live ? 'on' : ''}`, title: r.live ? '공부 중' : '' }),
          el('span', { class: 'name', text: r.nickname }),
          r.streak > 0 ? el('span', { class: 'streak', text: `🔥${r.streak}`, title: `${r.streak}일 연속 출석` }) : null,
          coins ? el('span', { class: 'coin mono', text: `🪙 ${r.weekCoins || 0}`, title: `보유 ${r.coins || 0}` }) : el('span', { class: 'time mono', text: fmtDuration(r[key]) }),
        ]));
      });
    }

    // ── 코인 / 지갑 (8단계) ──────────────────────────────────────────
    bindWallet() {
      const modal = $('wallet-modal');
      $('btn-wallet').addEventListener('click', () => this.openWallet());
      $('coin-badge').addEventListener('click', () => this.openWallet());
      $('wallet-close').addEventListener('click', () => this.closeWallet());
      modal.addEventListener('click', (e) => { if (e.target === modal) this.closeWallet(); });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) this.closeWallet(); });
      const pv = $('item-preview');
      const closePv = () => { pv.hidden = true; this.stopPreviewAnim(); };
      $('preview-close').addEventListener('click', closePv);
      pv.addEventListener('click', (e) => { if (e.target === pv) closePv(); });
    }

    // ── 펫 아이콘/미리보기 (10단계) ─────────────────────────────────
    /** 펫 시트의 프레임을 캔버스에 (row: down/left/…, f: 0|1). 캔버스 안에 정수 배율로 맞춘다 */
    drawPetFrame(canvas, species, row = 'down', f = 0) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const m = this.pets && this.pets.meta;
      if (!m || !this.pets.img) return false;
      const sp = m.species[species] || m.species.dog;
      const idx = m.rows[row] * m.framesPerRow + sp.index * m.framesPerSpecies + f;
      const sx = (idx % m.framesPerRow) * m.frameWidth;
      const sy = Math.floor(idx / m.framesPerRow) * m.frameHeight;
      const k = Math.max(1, Math.floor(Math.min(canvas.width / m.frameWidth, canvas.height / m.frameHeight)));
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.pets.img, sx, sy, m.frameWidth, m.frameHeight, Math.floor((canvas.width - m.frameWidth * k) / 2), Math.floor((canvas.height - m.frameHeight * k) / 2), m.frameWidth * k, m.frameHeight * k);
      return true;
    }

    petIconCanvas(species, size = 48) {
      const c = el('canvas', { width: String(size), height: String(size), class: 'furn-icon' });
      this.drawPetFrame(c, species);
      return c;
    }

    decoFrameOf(key) {
      const f = this.petdeco && this.petdeco.frames && this.petdeco.frames[key];
      return f ? f.frame : null;
    }

    /** 꾸미기 아이템 → 아틀라스 키의 앞부분 ('deco_ribbon' + 'red' → 'ribbon/red') */
    decoKey(item, variant) {
      const base = item.id.replace(/^deco_/, '');
      return variant ? `${base}/${variant}` : base;
    }

    drawDeco(canvas, key, view = 'front') {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const f = this.decoFrameOf(`deco/${key}/${view}/f0`);
      if (!f || !this.petdeco.img) return false;
      const k = Math.max(1, Math.floor(Math.min(canvas.width / f.w, canvas.height / f.h)));
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.petdeco.img, f.x, f.y, f.w, f.h, Math.floor((canvas.width - f.w * k) / 2), Math.floor((canvas.height - f.h * k) / 2), f.w * k, f.h * k);
      return true;
    }

    emojiCanvas(text, size = 48) {
      const c = el('canvas', { width: String(size), height: String(size), class: 'furn-icon' });
      const ctx = c.getContext('2d');
      ctx.font = `${Math.round(size * 0.55)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, size / 2, size / 2 + 2);
      return c;
    }

    /** 탈것 아틀라스 프레임을 캔버스에 (nearest, 정수 배율) */
    drawVehicle(canvas, key) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const f = this.vehicles && this.vehicles.frames && this.vehicles.frames[key];
      if (!f || !this.vehicles.img) return false;
      const fr = f.frame;
      const k = Math.max(1, Math.floor(Math.min(canvas.width / fr.w, canvas.height / fr.h)));
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.vehicles.img, fr.x, fr.y, fr.w, fr.h, Math.floor((canvas.width - fr.w * k) / 2), Math.floor((canvas.height - fr.h * k) / 2), fr.w * k, fr.h * k);
      return true;
    }

    vehicleKey(item, variant, dir = 'se') {
      if (item.category === 'vehicle') return `${item.vehicle}|${window.Vehicles.colorOf(item.vehicle, variant)}|${dir}`;
      if (item.category === 'vehicleDecal') return `decal/${item.decal}`;
      return null;
    }

    /** 카탈로그 아이템 → 카드 아이콘 (가구/펫/꾸미기/행동/탈것) */
    itemIcon(item, variant, size = 64) {
      if (item.category === 'vehicle' || item.category === 'vehicleDecal') { const c = el('canvas', { width: String(size), height: String(size), class: 'furn-icon' }); this.drawVehicle(c, this.vehicleKey(item, variant)); return c; }
      if (item.category === 'vehicleHorn') return this.emojiCanvas('📣', size);
      if (item.species) return this.petIconCanvas(item.species, size);
      if (item.category === 'petDeco') { const c = el('canvas', { width: String(size), height: String(size), class: 'furn-icon' }); this.drawDeco(c, this.decoKey(item, variant)); return c; }
      if (item.category === 'petSkill') return this.emojiCanvas(SKILL_ICON[item.id] || '🐾', size);
      return this.iconCanvas(item.id, variant, size);
    }

    stopPreviewAnim() {
      if (this.previewTimer) clearInterval(this.previewTimer);
      this.previewTimer = null;
    }

    /** 탈것 미리보기: 8방향을 돌아가며 */
    startVehiclePreview(canvas, item, variant) {
      this.stopPreviewAnim();
      const dirs = ['s', 'sw', 'w', 'nw', 'n', 'ne', 'e', 'se'];
      let i = 0;
      this.drawVehicle(canvas, this.vehicleKey(item, variant, dirs[0]));
      this.previewTimer = setInterval(() => { i++; this.drawVehicle(canvas, this.vehicleKey(item, variant, dirs[i % 8])); }, 350);
    }

    /** 펫 미리보기: 4방향 걷기 애니메이션 순환 */
    startPetPreview(canvas, species) {
      this.stopPreviewAnim();
      const dirs = ['down', 'left', 'up', 'right'];
      let i = 0;
      this.drawPetFrame(canvas, species, 'down', 0);
      this.previewTimer = setInterval(() => { i++; this.drawPetFrame(canvas, species, dirs[Math.floor(i / 6) % 4], i % 2); }, 220);
    }

    // ── 가구 아이콘/스프라이트 (DOM 캔버스) ──────────────────────────
    frameOf(key) {
      const f = this.furn && this.furn.frames && this.furn.frames[key];
      return f ? f.frame : null;
    }

    iconKey(itemId, variant) {
      if (variant && this.frameOf(`icon/${itemId}/${variant}`)) return `icon/${itemId}/${variant}`;
      return `icon/${itemId}`;
    }

    spriteKey(itemId, variant, rotation = 0) {
      const tries = [`${itemId}|${variant || '-'}|r${rotation}|f0`, `${itemId}|-|r0|f0`];
      return tries.find((k) => this.frameOf(k)) || null;
    }

    /** 아틀라스 프레임을 캔버스에 그린다 (nearest). fit 이면 캔버스 안에 정수 배율로 맞춘다 */
    drawFrame(canvas, key, { fit = true } = {}) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const f = this.frameOf(key);
      if (!f || !this.furn.img) return false;
      ctx.imageSmoothingEnabled = false;
      let k = 1;
      if (fit) k = Math.max(1, Math.floor(Math.min(canvas.width / f.w, canvas.height / f.h)));
      const w = f.w * k;
      const h = f.h * k;
      ctx.drawImage(this.furn.img, f.x, f.y, f.w, f.h, Math.floor((canvas.width - w) / 2), Math.floor((canvas.height - h) / 2), w, h);
      return true;
    }

    iconCanvas(itemId, variant, size = 32) {
      const c = el('canvas', { width: String(size), height: String(size), class: 'furn-icon' });
      this.drawFrame(c, this.iconKey(itemId, variant));
      return c;
    }

    /** 아이템 미리보기 모달: 방 스프라이트를 크게 */
    openPreview(item, variant) {
      $('preview-name').textContent = item.name;
      $('preview-desc').textContent = item.desc || '';
      const sp = item.sprite || { w: 1, h: 1 };
      const bits = [item.category === 'desk' ? '책상 소품 · 슬롯 장착' : `공용 가구 · ${sp.w}×${sp.h} 타일`];
      if (item.category === 'shared') {
        bits.push(sp.seat ? (sp.seat.kind === 'bed' ? '눕기 가능' : '앉기 가능') : sp.passable ? '통과 가능' : '통과 불가');
        if ((sp.rotations || []).length > 1) bits.push('회전 가능 (R)');
        if (sp.wallOnly) bits.push('벽 타일에만');
        if (sp.replace) bits.push('기존 커피머신 자리에');
        if (sp.layer === 'floor') bits.push('다른 가구 아래에 깔림');
      }
      bits.push(`🪙 ${item.price}`);
      if (item.species) bits.splice(0, bits.length, item.category === 'pet' ? '개인 펫 · 따라다님' : '공용 펫 · 방에 풀기', `🪙 ${item.price}`);
      if (item.category === 'petDeco') bits.splice(0, bits.length, `꾸미기 · ${PET_SLOT_LABEL[item.slot] || item.slot} 슬롯`, `🪙 ${item.price}`);
      if (item.category === 'petSkill') bits.splice(0, bits.length, '행동 업그레이드 · 펫별 1회', `🪙 ${item.price}`);
      if (item.category === 'vehicle') bits.splice(0, bits.length, `탈것 · 최고 속도 걷기의 ${(window.Vehicles.TYPES[item.vehicle].maxSpeed / window.Vehicles.WALK).toFixed(1)}배 · 8방향`, `🪙 ${item.price}`);
      if (item.category === 'vehicleDecal') bits.splice(0, bits.length, '데칼 · 탈것 몸체에', `🪙 ${item.price}`);
      if (item.category === 'vehicleHorn') bits.splice(0, bits.length, '경적 · 야외에서 H', `🪙 ${item.price}`);
      $('preview-meta').textContent = bits.join(' · ');
      const cv = $('preview-canvas');
      this.stopPreviewAnim();
      if (item.category === 'vehicle') this.startVehiclePreview(cv, item, variant);
      else if (item.category === 'vehicleDecal') this.drawVehicle(cv, this.vehicleKey(item, variant));
      else if (item.category === 'vehicleHorn') { const c = cv.getContext('2d'); c.clearRect(0, 0, cv.width, cv.height); c.font = '96px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('📣', cv.width / 2, cv.height / 2); }
      else if (item.species) this.startPetPreview(cv, item.species);
      else if (item.category === 'petDeco') this.drawDeco(cv, this.decoKey(item, variant));
      else if (item.category === 'petSkill') { const c = cv.getContext('2d'); c.clearRect(0, 0, cv.width, cv.height); c.font = '96px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(SKILL_ICON[item.id] || '🐾', cv.width / 2, cv.height / 2); }
      else this.drawFrame(cv, this.spriteKey(item.id, variant) || this.iconKey(item.id, variant));
      $('item-preview').hidden = false;
    }

    /** 잔액 (입장 ack · coins 이벤트). bump 면 배지가 살짝 튄다 */
    setCoins(n, { bump = false } = {}) {
      this.coins = Math.max(0, Number(n) || 0);
      const badge = $('coin-badge');
      badge.hidden = false;
      badge.querySelector('span').textContent = String(this.coins);
      $('wallet-balance').textContent = String(this.coins);
      if (bump) {
        badge.classList.remove('bump');
        void badge.offsetWidth; // 애니메이션 재시작
        badge.classList.add('bump');
      }
    }

    isWalletOpen() {
      return !$('wallet-modal').hidden;
    }

    async openWallet(tab) {
      if (tab) this.walletTab = tab;
      $('wallet-modal').hidden = false;
      this.renderWalletTabs();
      this.renderWalletItems();
      this.renderLedger();
      await this.refreshWallet();
    }

    /** 지갑 데이터가 없으면 한 번 받아 둔다 (책상 슬롯·편집 팔레트가 인벤토리를 쓴다) */
    async ensureWallet() {
      if (!this.wallet) await this.refreshWallet();
      return this.wallet;
    }

    closeWallet() {
      $('wallet-modal').hidden = true;
    }

    /** 서버에서 지갑 데이터를 다시 받는다 (열 때, 코인이 바뀔 때). walletBusy 는 진행 중 요청 수 (테스트가 재렌더를 기다리는 데 쓴다) */
    async refreshWallet() {
      this.walletBusy = (this.walletBusy || 0) + 1;
      try {
        const r = await this.onWallet();
        if (!r || !r.ok) return;
        this.wallet = r;
        this.setCoins(r.coins); // 잔액은 서버 값만 (스스로 더하지 않는다)
        this.setCoinProgress(r);
        this.renderWalletTabs();
        this.renderWalletItems();
        this.renderLedger();
        this.renderDeskSlots();
        this.renderPetSettings();
        this.renderVehicleSettings();
        $('opt-layout-lock').checked = Boolean(r.layoutLock);
        if (this.editMode) this.renderPalette();
      } catch (_) { /* 오프라인 */ } finally { this.walletBusy--; }
    }

    /**
     * "다음 코인까지" (wallet 응답 · coinProgress 이벤트 · 시간 코인 coins 이벤트). 서버가 준 값만 쓴다:
     * 공부 중이면 nextCoinAt(서버 시각 ms) 으로 실시간 카운트다운, 아니면 이월 초로 고정 표시.
     */
    setCoinProgress({ carrySeconds = 0, nextCoinAt = null, studying = false } = {}) {
      this.coinProgress = { carrySeconds: Number(carrySeconds) || 0, nextCoinAt: nextCoinAt === null || nextCoinAt === undefined ? null : Number(nextCoinAt), studying: Boolean(studying) };
      this.tickCoinProgress(true);
    }

    /** 250ms 마다 (지갑이 열려 있을 때만 DOM 갱신) */
    tickCoinProgress(force = false) {
      const p = this.coinProgress;
      if (!p) return;
      if (!force && !this.isWalletOpen()) return;
      const el2 = $('wallet-carry');
      let left;
      if (p.nextCoinAt !== null) left = Math.max(0, Math.ceil((p.nextCoinAt - this.serverNow()) / 1000));
      else left = Math.max(0, 600 - p.carrySeconds);
      const text = `${Math.floor(left / 60)}분 ${String(left % 60).padStart(2, '0')}초`;
      el2.textContent = p.nextCoinAt !== null ? ` · 다음 코인까지 ${text} ⏳` : ` · 다음 코인까지 ${text} (앉아서 공부 중일 때 줄어요)`;
    }

    renderWalletTabs() {
      const box = $('wallet-tabs');
      const tabs = (this.wallet && this.wallet.tabs) || [{ id: 'furniture', label: '가구' }, { id: 'pet', label: '펫' }, { id: 'petDeco', label: '펫 꾸미기' }, { id: 'mount', label: '탈것' }];
      if (!tabs.some((t) => t.id === this.walletTab)) this.walletTab = tabs[0].id;
      box.innerHTML = '';
      for (const t of tabs) {
        box.appendChild(el('button', { type: 'button', role: 'tab', 'data-tab': t.id, text: t.label, class: t.id === this.walletTab ? 'active' : '', onclick: () => { this.walletTab = t.id; this.renderWalletTabs(); this.renderWalletItems(); } }));
      }
    }

    catalogItems() {
      return (this.wallet && this.wallet.items) || this.catalog.items || [];
    }

    catalogCategories() {
      return (this.wallet && this.wallet.categories) || this.catalog.categories || [];
    }

    /** 탭의 아이템. 가구 탭은 카테고리(책상/공용) 서브탭 + 카드, 다른 탭은 "준비 중" */
    renderWalletItems() {
      const box = $('wallet-items');
      const cats = $('wallet-cats');
      const hint = $('wallet-cat-hint');
      box.innerHTML = '';
      cats.innerHTML = '';
      hint.textContent = '';
      const items = this.catalogItems().filter((it) => it.tab === this.walletTab);
      const bestEl = $('wallet-best');
      if (bestEl) {
        const best = this.wallet && this.wallet.trackBest;
        bestEl.hidden = this.walletTab !== 'mount';
        bestEl.textContent = best ? `🏁 내 최고 기록 ${(best.ms / 1000).toFixed(1)}s (${VEHICLE_LABEL[best.vehicle] || best.vehicle}) · 하루 첫 완주 +1 🪙` : '🏁 아직 트랙 기록이 없어요 · 야외 트랙을 탈것으로 한 바퀴 돌면 기록돼요 (하루 첫 완주 +1 🪙)';
      }
      if (!items.length) {
        cats.hidden = true;
        box.appendChild(el('span', { text: '준비 중이에요. 코인을 모아 두세요 🪙' }));
        return;
      }
      const categories = this.catalogCategories().filter((c) => (c.tab || 'furniture') === this.walletTab);
      cats.hidden = false;
      if (!categories.some((c) => c.id === this.walletCat)) this.walletCat = categories[0] ? categories[0].id : 'desk';
      for (const c of categories) {
        cats.appendChild(el('button', { type: 'button', 'data-cat': c.id, class: c.id === this.walletCat ? 'active' : '', text: c.label, onclick: () => { this.walletCat = c.id; this.renderWalletItems(); } }));
      }
      const cat = categories.find((c) => c.id === this.walletCat);
      hint.textContent = cat ? cat.hint : '';
      const inv = (this.wallet && this.wallet.inventory) || [];
      const grid = el('div', { class: 'grid' });
      for (const it of items.filter((i) => (i.category || 'shared') === this.walletCat)) {
        const mine = inv.filter((i) => i.itemId === it.id);
        const count = mine.length;
        const variant = this.variantPick[it.id] || (it.variants && it.variants[0] ? it.variants[0].id : null);
        const icon = this.itemIcon(it, variant, 64);
        icon.title = '미리보기';
        icon.addEventListener('click', () => this.openPreview(it, this.variantPick[it.id] || variant));
        const status = it.category === 'pet' ? (mine.some((i) => i.active) ? '따라다니는 중' : count ? `보유 ${count}` : '')
          : it.category === 'sharedPet' ? (mine.some((i) => i.released) ? '방에 있음' : count ? `보유 ${count}` : '')
          : it.category === 'petSkill' ? (count ? `${count}마리에게` : '')
          : it.category === 'vehicle' ? (mine.some((i) => i.vehicleActive) ? '활성 (V 소환)' : count ? `보유 ${count}` : '')
          : it.category === 'vehicleDecal' ? (mine.some((i) => i.decalActive) ? '장착 중' : count ? `보유 ${count}` : '')
          : it.category === 'vehicleHorn' ? (mine.some((i) => i.hornActive) ? '사용 중' : count ? `보유 ${count}` : '')
          : count ? `보유 ${count}` : '';
        const activeNow = /활성|장착 중|사용 중/.test(status);
        const card = el('div', { class: `wallet-item ${count ? 'owned' : ''}`, 'data-item': it.id }, [
          icon,
          el('span', { class: 'name', text: it.name }),
          el('span', { class: 'price', text: `🪙 ${it.price}` }),
          el('span', { class: `count muted ${activeNow ? 'active' : ''}`, text: status }),
        ]);
        // 12단계: 보유한 탈것/데칼/경적은 카드에서 바로 활성화
        if ((it.category === 'vehicle' || it.category === 'vehicleDecal' || it.category === 'vehicleHorn') && count && !activeNow) {
          const key = { vehicle: 'active', vehicleDecal: 'decal', vehicleHorn: 'horn' }[it.category];
          card.appendChild(el('button', { class: 'btn small ghost', type: 'button', text: it.category === 'vehicle' ? '활성으로' : '장착', onclick: async () => { const r = await this.onVehicleConfig({ [key]: mine[0].id }); if (r && r.ok) { this.toast(it.category === 'vehicle' ? '야외에서 V 로 소환해요' : '장착했어요'); await this.refreshWallet(); } } }));
        }
        if (it.category === 'petSkill') {
          // 대상 펫 선택: 강아지 · 공용 펫 · 내 개인 펫
          const sel = el('select', { class: 'skill-target', title: '어느 펫에게' });
          const pets = (this.wallet && this.wallet.pets) || { dog: null, shared: [], config: { pets: {} } };
          sel.appendChild(el('option', { value: 'dog', text: `강아지 (${pets.dog ? pets.dog.name : '사랑'})` }));
          for (const sp of pets.shared || []) sel.appendChild(el('option', { value: `s:${sp.roomPetId}`, text: `${sp.name} (공용)` }));
          for (const row of inv.filter((i) => (i.meta && i.meta.category) === 'pet')) {
            const pc = (pets.config && pets.config.pets && pets.config.pets[row.id]) || {};
            sel.appendChild(el('option', { value: String(row.id), text: `${pc.name || row.meta.name} (내 펫)` }));
          }
          sel.value = this.skillTarget[it.id] || 'dog';
          sel.addEventListener('change', () => { this.skillTarget[it.id] = sel.value; });
          sel.addEventListener('keydown', (e) => e.stopPropagation());
          card.appendChild(sel);
        }
        if (it.category === 'sharedPet' && count) {
          const free = mine.find((i) => !i.released);
          const rel = mine.find((i) => i.released);
          if (free) card.appendChild(el('button', { class: 'btn small', type: 'button', text: '방에 풀기', onclick: () => this.releasePet(it, free) }));
          if (rel) card.appendChild(el('button', { class: 'btn small ghost', type: 'button', text: '회수', onclick: async () => { const r = await this.onPetRecall(rel.released); if (r && r.ok) { this.toast('펫을 회수했어요'); await this.refreshWallet(); } } }));
        }
        if (it.variants && it.variants.length) {
          const sw = el('div', { class: 'swatches' });
          for (const v of it.variants) {
            const b = el('button', { type: 'button', class: `swatch ${v.id === variant ? 'active' : ''}`, title: v.label, 'data-variant': v.id, onclick: () => { this.variantPick[it.id] = v.id; this.renderWalletItems(); } });
            b.style.background = v.color || '#999';
            sw.appendChild(b);
          }
          card.appendChild(sw);
        }
        card.appendChild(el('button', { class: 'btn small', type: 'button', text: '구매', onclick: () => this.buy(it, variant, it.category === 'petSkill' ? (this.skillTarget[it.id] || 'dog') : undefined) }));
        grid.appendChild(card);
      }
      box.appendChild(grid);
    }

    /** 공용 펫 방에 풀기: 이름을 물어본다 */
    async releasePet(item, row) {
      const def = item.name.replace(/\s*\(.*\)$/, '');
      const name = window.prompt('펫 이름 (8자)', def);
      if (name === null) return;
      const r = await this.onPetRelease(row.id, name.trim() || def);
      if (r && r.ok) await this.refreshWallet();
    }

    async buy(item, variant, target) {
      const r = await this.onBuy(item.id, variant, target);
      if (!r || !r.ok) {
        const msg = { insufficient: `코인이 부족해요 (보유 ${r && r.balance !== undefined ? r.balance : this.coins})`, already_has: '그 펫은 이미 그 행동을 알아요', no_target: '어느 펫에게 줄지 골라 주세요' }[r && r.error];
        this.toast(msg || '구매하지 못했어요.');
        return;
      }
      const v = item.variants && item.variants.find((x) => x.id === variant);
      this.toast(`${item.name}${v ? ` (${v.label})` : ''} 을(를) 샀어요 🎁`);
      await this.refreshWallet();
    }

    // ── 내 책상 슬롯 (설정) ──────────────────────────────────────────
    /** 서버가 확정한 내 슬롯 [{ itemId, variant } | null] x3 */
    setDeskItems(items) {
      this.deskItems = Array.isArray(items) ? items : [null, null, null];
      this.renderDeskSlots();
    }

    renderDeskSlots() {
      const box = $('desk-slots');
      if (!box) return;
      box.innerHTML = '';
      const inv = ((this.wallet && this.wallet.inventory) || []).filter((i) => (i.meta && i.meta.category) === 'desk');
      const items = new Map(this.catalogItems().map((i) => [i.id, i]));
      const label = (row) => {
        const it = items.get(row.itemId);
        const v = it && it.variants && it.variants.find((x) => x.id === row.meta.variant);
        return `${it ? it.name : row.itemId}${v ? ` (${v.label})` : ''}`;
      };
      for (let i = 0; i < 3; i++) {
        const cur = this.deskItems[i];
        const icon = el('canvas', { width: '32', height: '32', class: 'furn-icon slot-icon' });
        if (cur) this.drawFrame(icon, this.iconKey(cur.itemId, cur.variant));
        const sel = el('select', { 'data-slot': String(i), title: `슬롯 ${i + 1}` });
        sel.appendChild(el('option', { value: '', text: '(비움)' }));
        // 지금 장착된 것은 inventoryId 를 몰라도 목록에서 같은 itemId·variant 인 첫 행을 고른다
        const used = new Set(this.deskItems.map((d, j) => (j !== i && d ? d.inventoryId : null)).filter(Boolean));
        let picked = '';
        for (const row of inv) {
          if (used.has(row.id)) continue;
          sel.appendChild(el('option', { value: String(row.id), text: label(row) }));
          if (!picked && cur && cur.itemId === row.itemId && (cur.variant || null) === (row.meta.variant || null)) picked = String(row.id);
        }
        if (cur && cur.inventoryId) picked = String(cur.inventoryId);
        sel.value = picked;
        if (picked) this.deskItems[i] = { ...cur, inventoryId: Number(picked) };
        sel.addEventListener('change', () => this.equipFromSelects());
        sel.addEventListener('keydown', (e) => e.stopPropagation());
        box.appendChild(el('div', { class: 'desk-slot' }, [icon, sel]));
      }
      if (!inv.length) box.appendChild(el('p', { class: 'hint', text: '지갑 → 가구 → 책상 소품에서 사면 여기서 장착해요.' }));
    }

    async equipFromSelects() {
      const slots = [...document.querySelectorAll('#desk-slots select')].map((sel) => (sel.value ? Number(sel.value) : null));
      const r = await this.onDeskEquip(slots);
      if (r && r.ok) {
        this.deskItems = r.deskItems.map((d, i) => (d ? { ...d, inventoryId: slots[i] } : null));
        this.toast('책상 소품을 장착했어요 🪴');
      }
      this.renderDeskSlots();
    }

    // ── 펫 설정 (10단계): 강아지 꾸미기 · 내 펫 · 공용 펫 목록 ─────────────
    onNpcUpdate(d) {
      const prev = this.npcs.get(d.id);
      this.npcs.set(d.id, d);
      if (!prev || prev.name !== d.name) this.renderSharedPets();
    }

    onNpcRemoved(id) {
      this.npcs.delete(id);
      this.renderSharedPets();
    }

    /** 꾸미기 슬롯 3개(select): 내 꾸미기 인벤토리 중 슬롯이 맞는 것. cosmetics 는 { head: { inventoryId } | null, ... } */
    renderDecoSlots(box, cosmetics, onChange, { disabled = false } = {}) {
      box.innerHTML = '';
      const inv = ((this.wallet && this.wallet.inventory) || []).filter((i) => (i.meta && i.meta.category) === 'petDeco');
      const items = new Map(this.catalogItems().map((i) => [i.id, i]));
      const label = (row) => {
        const it = items.get(row.itemId);
        const v = it && it.variants && it.variants.find((x) => x.id === row.meta.variant);
        return `${it ? it.name : row.itemId}${v ? ` (${v.label})` : ''}`;
      };
      for (const slot of ['head', 'neck', 'back']) {
        const cur = cosmetics && cosmetics[slot];
        const icon = el('canvas', { width: '24', height: '24', class: 'furn-icon slot-icon' });
        if (cur) { const it = items.get(cur.itemId); if (it) this.drawDeco(icon, this.decoKey(it, cur.variant)); }
        const sel = el('select', { 'data-slot': slot, title: PET_SLOT_LABEL[slot] });
        sel.appendChild(el('option', { value: '', text: `${PET_SLOT_LABEL[slot]}: 없음` }));
        for (const row of inv) {
          const it = items.get(row.itemId);
          if (!it || it.slot !== slot) continue;
          sel.appendChild(el('option', { value: String(row.id), text: label(row) }));
        }
        sel.value = cur && cur.inventoryId ? String(cur.inventoryId) : '';
        sel.disabled = disabled;
        sel.addEventListener('change', () => {
          const slots = {};
          for (const s2 of box.querySelectorAll('select')) slots[s2.dataset.slot] = s2.value ? Number(s2.value) : null;
          onChange(slots);
        });
        sel.addEventListener('keydown', (e) => e.stopPropagation());
        box.appendChild(el('div', { class: 'deco-slot' }, [icon, sel]));
      }
    }

    renderPetSettings() {
      const pets = (this.wallet && this.wallet.pets) || null;
      const inv = (this.wallet && this.wallet.inventory) || [];
      const items = new Map(this.catalogItems().map((i) => [i.id, i]));
      // 강아지 꾸미기 (누구나)
      if ($('dog-deco')) this.renderDecoSlots($('dog-deco'), pets && pets.dog ? pets.dog.cosmetics : {}, async (slots) => { const r = await this.onPetDeco('dog', slots); if (r && r.ok) { this.toast('강아지를 꾸몄어요 🎀'); await this.refreshWallet(); } });
      // 내 펫
      const sel = $('mypet-active');
      if (!sel) return;
      sel.innerHTML = '';
      sel.appendChild(el('option', { value: '', text: '활성 펫 없음' }));
      const cfg = (pets && pets.config) || { active: null, pets: {} };
      const myPets = inv.filter((i) => (i.meta && i.meta.category) === 'pet');
      for (const row of myPets) {
        const pc = cfg.pets[row.id] || {};
        sel.appendChild(el('option', { value: String(row.id), text: `${pc.name || row.meta.name} (${row.meta.name})` }));
      }
      sel.value = cfg.active ? String(cfg.active) : '';
      sel.addEventListener('keydown', (e) => e.stopPropagation());
      const active = cfg.active ? myPets.find((r) => r.id === cfg.active) : null;
      $('mypet-name-form').hidden = !active;
      if (active) {
        const pc = cfg.pets[active.id] || {};
        if (document.activeElement !== $('mypet-name')) $('mypet-name').value = pc.name || active.meta.name;
        this.renderDecoSlots($('mypet-deco'), pc.cosmetics || {}, async (slots) => { const r = await this.onPetConfig({ petId: active.id, cosmetics: slots }); if (r && r.ok) { this.toast('펫을 꾸몄어요 🎀'); await this.refreshWallet(); } });
        const skills = (pc.skills || []).map((k) => ({ come: '📣 이름 부르면 달려옴', sleep_beside: '💤 옆에서 같이 자기', high_five: '🖐 하이파이브' }[k] || k));
        $('mypet-hint').textContent = skills.length ? `배운 행동: ${skills.join(' · ')}` : '지갑 → 펫 → 행동 업그레이드에서 행동을 가르칠 수 있어요';
      } else {
        $('mypet-deco').innerHTML = '';
        $('mypet-hint').textContent = myPets.length ? '위에서 따라다닐 펫을 고르세요' : '지갑 → 펫 → 개인 펫에서 사면 여기서 고를 수 있어요';
      }
      this.renderSharedPets();
    }

    renderSharedPets() {
      const list = $('shared-pets');
      if (!list) return;
      list.innerHTML = '';
      const pets = (this.wallet && this.wallet.pets) || { shared: [] };
      const shared = [...this.npcs.values()].filter((n) => n.id.startsWith('s:'));
      $('shared-pets-count').textContent = `${shared.length}/${pets.maxShared || 3}`;
      if (!shared.length) list.appendChild(el('li', { class: 'empty', text: '방에 풀린 공용 펫이 없어요. 지갑 → 펫 → 공용 펫' }));
      for (const n of shared) {
        const info = (pets.shared || []).find((p) => p.id === n.id);
        const mine = Boolean(info && info.mine);
        const nameInput = el('input', { type: 'text', maxlength: '8', value: n.name, disabled: mine ? null : 'disabled' });
        nameInput.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); this.onNpcName(nameInput.value.trim(), n.id); } });
        const li = el('li', { 'data-id': n.id, class: mine ? 'me' : '' }, [
          this.petIconCanvas(n.species, 28),
          nameInput,
          el('span', { class: 'muted', text: info ? `${info.releasedBy || '?'}` : '' }),
          mine ? el('button', { class: 'btn small ghost', type: 'button', text: '회수', onclick: async () => { const r = await this.onPetRecall(info.roomPetId); if (r && r.ok) { this.toast('펫을 회수했어요'); await this.refreshWallet(); } } }) : null,
        ]);
        if (mine) {
          const deco = el('div', { class: 'pet-deco' });
          this.renderDecoSlots(deco, n.cosmeticsRaw || (info ? info.cosmetics : {}), async (slots) => { const r = await this.onPetDeco(n.id, slots); if (r && r.ok) { this.toast('펫을 꾸몄어요 🎀'); await this.refreshWallet(); } });
          li.appendChild(deco);
        }
        list.appendChild(li);
      }
    }

    // ── 가구 편집 모드 (9단계) ─────────────────────────────────────────
    bindEdit() {
      $('btn-edit').addEventListener('click', () => this.onEditToggle(!this.editMode));
      $('edit-close').addEventListener('click', () => this.onEditToggle(false));
    }

    /** 서버가 확정한 편집 모드 on/off */
    setEditMode(on) {
      this.editMode = Boolean(on);
      $('edit-bar').hidden = !this.editMode;
      $('btn-edit').classList.toggle('active', this.editMode);
      $('edit-status').textContent = '';
      if (this.editMode) this.refreshEdit();
    }

    /** 팔레트·놓인 가구 목록 다시 (인벤토리를 새로 받는다) */
    async refreshEdit() {
      if (!this.editMode) return;
      await this.refreshWallet(); // renderPalette 포함
      this.renderPlaced();
    }

    onLayoutChanged() {
      if (!this.editMode) return;
      this.renderPlaced();
    }

    editError(code) {
      const msg = EDIT_ERR[code] || (code ? `편집하지 못했어요 (${code})` : '편집하지 못했어요');
      $('edit-status').textContent = `⚠ ${msg}`;
      $('edit-status').classList.add('warn');
      this.notify(msg);
    }

    /** 씬의 편집 상태 → 안내 줄 */
    setEditState(st) {
      this.editState = st || { on: false, mode: 'off' };
      const box = $('edit-status');
      box.classList.remove('warn');
      if (!st || !st.on) { box.textContent = ''; return; }
      if (st.rejected) return this.editError(st.rejected);
      const rot = st.rotatable ? ' · R 회전' : '';
      if (st.mode === 'place') box.textContent = `${st.item.name}: 놓을 곳을 클릭${rot} · Esc 취소` + (st.error ? ` — ${EDIT_ERR[st.error] || st.error}` : st.ok ? ' — 여기 놓을 수 있어요' : '');
      else if (st.mode === 'drag') box.textContent = `${st.item.name}: 원하는 곳에서 놓기${rot}` + (st.error ? ` — ${EDIT_ERR[st.error] || st.error}` : '');
      else if (st.mode === 'selected') box.textContent = `${st.item.name} 선택됨${rot} · Del 회수 · Esc 선택 해제`;
      else box.textContent = '팔레트에서 고르거나 놓인 가구를 클릭하세요';
      for (const b of document.querySelectorAll('#edit-placed li')) b.classList.toggle('selected', st.mode === 'selected' && Number(b.dataset.id) === st.id);
    }

    /** 내 인벤토리의 공용 가구 중 아직 안 놓은 것 (itemId+variant 로 묶어 ×N) */
    renderPalette() {
      const box = $('edit-palette');
      box.innerHTML = '';
      const items = new Map(this.catalogItems().map((i) => [i.id, i]));
      const rows = ((this.wallet && this.wallet.inventory) || []).filter((i) => (i.meta && i.meta.category) === 'shared' && !i.placed);
      const groups = new Map();
      for (const r of rows) {
        const k = `${r.itemId}|${(r.meta && r.meta.variant) || '-'}`;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(r);
      }
      $('edit-palette-count').textContent = rows.length ? `${rows.length}개` : '';
      if (!groups.size) box.appendChild(el('span', { class: 'hint', text: '놓을 수 있는 가구가 없어요. 지갑 → 가구 → 공용 가구에서 사 오세요.' }));
      for (const [, list] of groups) {
        const first = list[0];
        const item = items.get(first.itemId);
        if (!item) continue;
        const variant = (first.meta && first.meta.variant) || null;
        const v = item.variants && item.variants.find((x) => x.id === variant);
        const tile = el('button', { type: 'button', class: 'palette-item', 'data-item': item.id, 'data-inventory': String(first.id), title: `${item.name}${v ? ` (${v.label})` : ''}`, onclick: () => this.onPlaceItem(item, variant, first.id) }, [
          this.iconCanvas(item.id, variant, 32),
          el('span', { class: 'name', text: item.name }),
          list.length > 1 ? el('span', { class: 'count', text: `×${list.length}` }) : null,
        ]);
        box.appendChild(tile);
      }
    }

    renderPlaced() {
      const list = $('edit-placed');
      list.innerHTML = '';
      const items = new Map(this.catalogItems().map((i) => [i.id, i]));
      const entries = this.getLayout().slice().sort((a, b) => (b.placedAt || 0) - (a.placedAt || 0));
      $('edit-placed-count').textContent = entries.length ? `${entries.length}개` : '';
      if (!entries.length) list.appendChild(el('li', { class: 'empty', text: '아직 놓인 가구가 없어요.' }));
      for (const e of entries) {
        const item = items.get(e.itemId);
        const mine = e.placedBy === this.selfNickname;
        list.appendChild(el('li', { 'data-id': String(e.id), class: mine ? 'me' : '' }, [
          this.iconCanvas(e.itemId, e.variant, 24),
          el('span', { class: 'name', text: item ? item.name : e.itemId }),
          el('span', { class: 'muted', text: `${e.placedBy || '?'} · (${e.x}, ${e.y})` }),
          el('button', { class: 'btn small ghost', type: 'button', text: '회수', title: '놓은 사람 인벤토리로', onclick: () => this.onRemoveEntry(e.id) }),
        ]));
      }
    }

    static coinReasonLabel(reason) {
      if (COIN_REASON[reason]) return COIN_REASON[reason];
      if (typeof reason === 'string' && reason.startsWith('purchase:')) return `구매 · ${reason.slice(9)}`;
      return reason || '';
    }

    renderLedger() {
      const list = $('wallet-ledger');
      list.innerHTML = '';
      const entries = (this.wallet && this.wallet.ledger) || [];
      if (!entries.length) {
        list.appendChild(el('li', { class: 'empty', text: '아직 거래가 없어요. 자리에 앉아 공부하면 코인이 쌓여요.' }));
        return;
      }
      for (const e of entries) {
        list.appendChild(el('li', {}, [
          el('span', { class: `delta ${e.delta > 0 ? 'plus' : 'minus'}`, text: `${e.delta > 0 ? '+' : ''}${e.delta}` }),
          el('span', { class: 'reason', text: UI.coinReasonLabel(e.reason) }),
          el('span', { class: 'time', text: fmtWhen(e.createdAt) }),
        ]));
      }
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
    get minimapScale() {
      return Math.max(3, Math.floor(MINIMAP_W / this.room.width));
    }

    buildMinimapBase() {
      const room = this.room;
      const S = this.minimapScale;
      const base = document.createElement('canvas');
      base.width = room.width * S;
      base.height = room.height * S;
      const ctx = base.getContext('2d');
      const objects = (this.tilesObjects ||= this.buildTileIndex());
      for (let y = 0; y < room.height; y++) {
        for (let x = 0; x < room.width; x++) {
          const floor = room.layers.floor[y][x];
          const furn = room.layers.furniture[y][x];
          let c = '#0f0c14';
          if (room.outdoor) {
            // 12단계 야외: 바닥 종류별 색 (잔디·언덕·흙길·돌길·광장·물·데크·하늘)
            const name = objects[floor] || '';
            c = /^grass/.test(name) ? '#4f6b45' : /^hill/.test(name) ? '#45603d' : /^(dirt|start)/.test(name) ? '#8c7458' : /^stone/.test(name) ? '#7d766c' : /^plaza/.test(name) ? '#8f8471' : /^(water|shore)/.test(name) ? '#4f7ea6' : /^deck/.test(name) ? '#7a5c44' : /^(paver|kerb)/.test(name) ? '#5a5560' : name === 'facade' ? '#3a3741' : name === 'sky' ? '#1b2442' : '#4f6b45';
            if (furn !== -1 && room.collision[y][x]) c = /^(tree|hedge|plant)/.test(objects[furn] || '') ? '#2f4a2d' : '#5a4638';
          } else {
            if (floor !== -1) c = y >= 26 ? '#2a2630' : '#3a2c26';
            if (room.collision[y][x]) c = floor !== -1 && y >= 26 ? '#1e1b24' : '#241b1e';
            if (furn !== -1 && !room.collision[y][x]) c = '#4a3a30';
            if (furn !== -1 && room.collision[y][x]) c = '#5a4638';
          }
          ctx.fillStyle = c;
          ctx.fillRect(x * S, y * S, S, S);
        }
      }
      ctx.fillStyle = 'rgba(255,184,92,0.55)';
      for (const s of room.seats) ctx.fillRect(s.x * S + 1, s.y * S + 1, Math.max(1, S - 2), Math.max(1, S - 2));
      this.minimapBase = base;
      const mm = $('minimap');
      mm.width = base.width;
      mm.height = base.height;
      this.drawMinimap({});
    }

    /** 타일 인덱스 → 오브젝트 이름 (미니맵 색용, tiles.json 은 씬이 받은 것을 window.NSM 없이도 쓰도록 fetch 결과를 room 에 기대지 않는다) */
    buildTileIndex() {
      const out = [];
      const meta = this.tilesMeta;
      if (!meta || !meta.objects) return out;
      for (const [name, o] of Object.entries(meta.objects)) for (const row of o.tiles) for (const idx of row) out[idx] = name;
      return out;
    }

    setTilesMeta(meta) {
      this.tilesMeta = meta;
      this.tilesObjects = null;
    }

    /** positions: id → { x, y } (월드 px). 10Hz 정도로 호출. */
    drawMinimap(positions) {
      const mm = $('minimap');
      const ctx = mm.getContext('2d');
      const S = this.minimapScale / this.room.tileSize;
      ctx.drawImage(this.minimapBase, 0, 0);
      for (const [id, p] of Object.entries(positions)) {
        const me = id === this.selfId;
        ctx.beginPath();
        ctx.arc(p.x * S, (p.y - 16) * S, me ? 4 : p.npc ? 2.5 : 3, 0, Math.PI * 2);
        ctx.fillStyle = me ? '#ffb85c' : p.npc ? (PET_COLORS[p.species] || '#c48c52') : '#f1e6d2';
        ctx.fill();
        if (me) {
          ctx.strokeStyle = 'rgba(255,184,92,0.5)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }
    }

    // ── 스터디 정보 팝오버 (11단계) ────────────────────────────────────
    bindStudy() {
      const sel = $('study-edit-max');
      for (let n = 2; n <= 12; n++) sel.appendChild(el('option', { value: String(n), text: `${n}명` }));
      $('study-copy-code').addEventListener('click', () => this.copyText(this.study ? this.study.code : '', '코드를 복사했어요'));
      $('study-copy-link').addEventListener('click', () => this.copyText(this.studyLink(), '링크를 복사했어요'));
      for (const id of ['study-edit-name', 'study-edit-pass', 'study-edit-goal']) $(id).addEventListener('keydown', (e) => e.stopPropagation());
      $('study-edit-unlock').addEventListener('change', () => { $('study-edit-pass').disabled = $('study-edit-unlock').checked; });
      $('study-edit-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const err = $('study-edit-error');
        err.hidden = true;
        const patch = { name: $('study-edit-name').value.trim(), maxPlayers: Number($('study-edit-max').value), weeklyGoalMinutes: Number($('study-edit-goal').value) * 60, editPolicy: $('study-edit-owner-only').checked ? 'owner' : 'anyone' };
        if ($('study-edit-unlock').checked) patch.password = '';
        else if ($('study-edit-pass').value) patch.password = $('study-edit-pass').value;
        const r = await this.onStudyUpdate(patch);
        if (!r || !r.ok) { err.textContent = STUDY_ERR[r && r.error] || '저장하지 못했어요.'; err.hidden = false; return; }
        $('study-edit-pass').value = '';
        $('study-edit-unlock').checked = false;
        $('study-edit-pass').disabled = false;
        this.toast('스터디 설정을 저장했어요');
        this.refreshStudyInfo();
      });
      $('study-delete').addEventListener('click', async () => {
        if (!this.study || !window.confirm(`"${this.study.name}" 스터디를 삭제할까요? 가구·펫 배치도 지워지고 되돌릴 수 없어요.`)) return;
        const r = await this.onStudyDelete();
        if (!r || !r.ok) this.notify(STUDY_ERR[r && r.error] || '삭제하지 못했어요.');
      });
    }

    studyLink() {
      if (!this.study) return '';
      return `${location.origin}${location.pathname}?study=${this.study.code}`;
    }

    async copyText(text, done) {
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        this.toast(done);
      } catch (_) {
        window.prompt('복사하세요', text);
      }
    }

    /** 입장 ack · study:update — 좌상단 배지와 팝오버 제목 */
    setStudy(study) {
      this.study = study || null;
      $('study-name').textContent = study ? study.name : '스터디';
      $('study-lock').hidden = !(study && study.locked);
      $('study-info-title').textContent = study ? `${study.locked ? '🔒 ' : ''}${study.name}` : '스터디';
      $('study-info-code').textContent = study ? study.code : '------';
      $('study-owner').hidden = !(study && study.isOwner);
      if (study && study.isOwner) this.fillStudyForm(study);
    }

    fillStudyForm(study) {
      if (document.activeElement && document.activeElement.closest('#study-edit-form')) return; // 입력 중이면 덮어쓰지 않는다
      $('study-edit-name').value = study.name;
      $('study-edit-max').value = String(study.maxPlayers);
      $('study-edit-goal').value = String(Math.round(study.weeklyGoalMinutes / 60));
      $('study-edit-owner-only').checked = study.editPolicy === 'owner';
    }

    async refreshStudyInfo() {
      try {
        const r = await this.onStudyInfo();
        if (r && r.ok) this.renderStudyInfo(r);
      } catch (_) { /* 오프라인 */ }
    }

    /** study:info 응답 → 팝오버 (멤버 접속 중/오프라인·이번 주 시간·방장 ★·내보내기, 주간 목표 바, 그룹 스트릭) */
    renderStudyInfo({ study, members, week, streak }) {
      this.setStudy({ ...(this.study || {}), ...study });
      const ratio = week.targetSeconds ? Math.min(1, week.totalSeconds / week.targetSeconds) : 0;
      $('study-week-bar').style.width = `${Math.round(ratio * 100)}%`;
      $('study-week-bar').classList.toggle('done', week.reached || ratio >= 1);
      $('study-week-text').textContent = `${fmtDuration(week.totalSeconds)} / ${Math.round(week.targetSeconds / 3600)}시간${week.reached ? ' · 달성 🎆' : ''}`;
      $('study-streak').textContent = streak > 0 ? `🔥 그룹 스트릭 ${streak}일 (멤버 중 한 명이라도 출석한 연속 일수)` : '아직 그룹 스트릭이 없어요. 오늘 60초만 앉아 있어도 시작!';
      const list = $('study-members');
      list.innerHTML = '';
      $('study-members-count').textContent = `${members.filter((m) => m.online).length}명 접속 · ${members.length}명`;
      for (const m of members) {
        const li = el('li', { class: `${m.online ? '' : 'offline'} ${m.nickname === this.selfNickname ? 'me' : ''}` }, [
          el('span', { class: `dot-live ${m.online ? 'on' : ''}`, title: m.online ? '접속 중' : '오프라인' }),
          el('span', { class: 'name', text: `${m.isOwner ? '★ ' : ''}${m.nickname}${m.nickname === this.selfNickname ? ' (나)' : ''}` }),
          el('span', { class: 'time mono', text: fmtDuration(m.weekSeconds) }),
          study.isOwner && !m.isOwner ? el('button', { class: 'btn small ghost danger', type: 'button', text: '내보내기', onclick: async () => {
            if (!window.confirm(`${m.nickname} 님을 내보낼까요?`)) return;
            const r = await this.onStudyKick(m.nickname);
            if (!r || !r.ok) this.notify(STUDY_ERR[r && r.error] || '내보내지 못했어요.');
            else this.refreshStudyInfo();
          } }) : null,
        ]);
        list.appendChild(li);
      }
    }

    /** 스터디 이름·잠금이 바뀌었을 때(study:update) 알림 벨에도 */
    onStudyUpdated(study) {
      const prev = this.study;
      this.setStudy({ ...(prev || {}), ...study });
      if (prev && prev.name !== study.name) this.notify(`스터디 이름이 "${study.name}" 으로 바뀌었어요.`);
    }

    // ── 로비 (11단계) ──────────────────────────────────────────────────
    bindLobby() {
      $('lobby-create').addEventListener('click', () => this.openCreateStudy());
      $('lobby-rename').addEventListener('click', () => { if (this.lobbyHandlers) this.lobbyHandlers.onRename(); });
      $('lobby-code').addEventListener('keydown', (e) => e.stopPropagation());
      $('lobby-code').addEventListener('input', () => { $('lobby-code').value = $('lobby-code').value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); });
      $('lobby-code-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const code = $('lobby-code').value.trim().toUpperCase();
        if (code.length !== 6) return this.lobbyError('초대 코드는 영숫자 6자예요.');
        if (this.lobbyHandlers) this.lobbyHandlers.onEnter(code);
      });
      // 만들기 모달
      const sel = $('sc-max');
      for (let n = 2; n <= 12; n++) sel.appendChild(el('option', { value: String(n), text: `${n}명`, ...(n === 8 ? { selected: 'selected' } : {}) }));
      for (const id of ['sc-name', 'sc-pass', 'sc-goal']) $(id).addEventListener('keydown', (e) => { if (e.key === 'Escape') this.closeCreateStudy(); e.stopPropagation(); });
      $('sc-cancel').addEventListener('click', () => this.closeCreateStudy());
      $('study-create').addEventListener('click', (e) => { if (e.target === $('study-create')) this.closeCreateStudy(); });
      $('study-create-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const err = $('sc-error');
        err.hidden = true;
        const form = { name: $('sc-name').value.trim(), password: $('sc-pass').value, maxPlayers: Number($('sc-max').value), weeklyGoalMinutes: Number($('sc-goal').value) * 60 };
        if (!form.name) { err.textContent = STUDY_ERR.invalid_name; err.hidden = false; return; }
        if (form.password && (form.password.length < 4 || form.password.length > 20)) { err.textContent = STUDY_ERR.invalid_password; err.hidden = false; return; }
        $('sc-submit').disabled = true;
        try {
          const r = this.lobbyHandlers ? await this.lobbyHandlers.onCreate(form) : { ok: false };
          if (!r || !r.ok) { err.textContent = STUDY_ERR[r && r.error] || '만들지 못했어요.'; err.hidden = false; return; }
          this.closeCreateStudy();
        } finally {
          $('sc-submit').disabled = false;
        }
      });
      // 비밀번호 모달
      $('sp-pass').addEventListener('keydown', (e) => { if (e.key === 'Escape') this.resolveStudyPass(null); e.stopPropagation(); });
      $('sp-cancel').addEventListener('click', () => this.resolveStudyPass(null));
      $('study-pass-form').addEventListener('submit', (e) => { e.preventDefault(); this.resolveStudyPass($('sp-pass').value); });
    }

    lobbyError(msg) {
      const e = $('lobby-error');
      e.textContent = msg || '';
      e.hidden = !msg;
    }

    /**
     * 로비: { nickname, mine, others } + handlers { onEnter(code), onCreate(form) → Promise<{ok}>, onRename() }
     * 카드: 이름 · 접속/정원 · 🔒 · 이번 주 시간 · 그룹 스트릭 · 주간 목표 바. 목록: 이름·🔒·이번 주 시간
     */
    showLobby({ nickname, mine = [], others = [], error = '' }, handlers) {
      this.inRoom = false;
      this.builder.setVisible(false);
      $('login').hidden = true;
      if (handlers) this.lobbyHandlers = handlers;
      $('lobby-nick').textContent = nickname ? `${nickname} 님` : '';
      this.lobbyError(error);
      const box = $('lobby-mine');
      box.innerHTML = '';
      $('lobby-mine-count').textContent = mine.length ? `${mine.length}개` : '';
      if (!mine.length) box.appendChild(el('p', { class: 'hint lobby-empty', text: '아직 소속된 스터디가 없어요. 새로 만들거나 아래에서 골라 보세요.' }));
      for (const s of mine) {
        const ratio = s.weeklyGoalMinutes ? Math.min(1, s.weekSeconds / (s.weeklyGoalMinutes * 60)) : 0;
        const bar = el('div', { class: `week-bar ${s.reached || ratio >= 1 ? 'done' : ''}` });
        bar.style.width = `${Math.round(ratio * 100)}%`;
        const card = el('button', { type: 'button', class: `study-card ${s.online ? 'live' : ''}`, 'data-code': s.code, onclick: () => this.lobbyHandlers && this.lobbyHandlers.onEnter(s.code) }, [
          el('div', { class: 'study-card-head' }, [
            el('span', { class: 'study-card-name', text: `${s.locked ? '🔒 ' : ''}${s.name}` }),
            el('span', { class: 'study-card-count', text: `${s.online}/${s.maxPlayers}` }),
          ]),
          el('div', { class: 'study-card-stats' }, [
            el('span', { text: `이번 주 ${fmtDuration(s.weekSeconds)}` }),
            el('span', { text: s.streak > 0 ? `🔥 ${s.streak}일` : '🔥 -' , title: '그룹 스트릭' }),
            s.isOwner ? el('span', { class: 'study-card-owner', text: '★ 방장' }) : null,
          ]),
          el('div', { class: 'goal-track' }, [bar]),
          el('span', { class: 'hint', text: `목표 ${Math.round(s.weeklyGoalMinutes / 60)}시간 · ${Math.round(ratio * 100)}%${s.reached ? ' · 달성 🎆' : ''}` }),
        ]);
        box.appendChild(card);
      }
      const list = $('lobby-others');
      list.innerHTML = '';
      if (!others.length) list.appendChild(el('li', { class: 'empty', text: '다른 스터디가 아직 없어요.' }));
      for (const s of others) {
        list.appendChild(el('li', { 'data-code': s.code }, [
          el('span', { class: 'name', text: `${s.locked ? '🔒 ' : ''}${s.name}` }),
          el('span', { class: 'muted', text: `${s.online}/${s.maxPlayers}` }),
          el('span', { class: 'time mono', text: `이번 주 ${fmtDuration(s.weekSeconds)}` }),
          el('button', { class: 'btn small', type: 'button', text: '참가', onclick: () => this.lobbyHandlers && this.lobbyHandlers.onEnter(s.code) }),
        ]));
      }
      $('lobby').hidden = false;
    }

    hideLobby() {
      $('lobby').hidden = true;
    }

    get lobbyOpen() {
      return !$('lobby').hidden;
    }

    openCreateStudy() {
      $('sc-name').value = '';
      $('sc-pass').value = '';
      $('sc-goal').value = '20';
      $('sc-error').hidden = true;
      $('study-create').hidden = false;
      setTimeout(() => $('sc-name').focus(), 50);
    }

    closeCreateStudy() {
      $('study-create').hidden = true;
    }

    /** 잠긴 스터디 비밀번호를 묻는다. 취소하면 null. retryAfterMs 가 있으면 그동안 버튼을 잠근다 */
    askStudyPassword({ name, error = '', retryAfterMs = 0 } = {}) {
      $('sp-name').textContent = name || '스터디';
      $('sp-pass').value = '';
      const err = $('sp-error');
      err.textContent = error;
      err.hidden = !error;
      $('study-pass').hidden = false;
      const btn = $('sp-submit');
      btn.disabled = false;
      clearInterval(this.spLockTimer);
      if (retryAfterMs > 0) {
        const until = Date.now() + retryAfterMs;
        const tick = () => {
          const left = Math.ceil((until - Date.now()) / 1000);
          if (left <= 0) { clearInterval(this.spLockTimer); btn.disabled = false; err.hidden = true; return; }
          err.textContent = `비밀번호를 여러 번 틀렸어요. ${left}초 뒤에 다시 시도해 주세요.`;
          err.hidden = false;
          btn.disabled = true;
        };
        tick();
        this.spLockTimer = setInterval(tick, 250);
      }
      setTimeout(() => $('sp-pass').focus(), 50);
      return new Promise((resolve) => { this.spResolve = resolve; });
    }

    resolveStudyPass(value) {
      clearInterval(this.spLockTimer);
      $('study-pass').hidden = true;
      const r = this.spResolve;
      this.spResolve = null;
      if (r) r(value);
    }

    // ── 입장 모달 ────────────────────────────────────────────────────
    /**
     * 입장 정보를 받는다. submit 이 실패(reject)하면 에러를 보여주고 다시 기다린다.
     * passwordRequired 면 비밀번호 칸을 보여 준다(6단계). 거부 에러에 retryAfterMs 가 있으면 그동안 버튼을 잠그고 초를 센다.
     */
    showLogin({ nickname = '', avatar = null, error = '', passwordRequired = false, password = '', target = null }, submit) {
      const modal = $('login');
      const form = $('login-form');
      const input = $('login-nick');
      const pass = $('login-pass');
      const err = $('login-error');
      const btn = $('login-submit');
      this.inRoom = false;
      this.hideLobby();
      this.closeAvatarModal();
      $('login-target').hidden = !target;
      if (target) $('login-target-name').textContent = `${target.locked ? '🔒 ' : ''}${target.name}`;
      btn.disabled = false;
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

  /** 거래 시각: 오늘이면 HH:MM, 아니면 M/D HH:MM */
  function fmtWhen(ts) {
    const d = new Date(ts);
    const now = new Date();
    const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    return sameDay ? hhmm(ts) : `${d.getMonth() + 1}/${d.getDate()} ${hhmm(ts)}`;
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
