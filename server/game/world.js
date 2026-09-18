'use strict';
/**
 * 방 하나의 실시간 상태 (소켓과 무관한 순수 로직).
 *  - 플레이어 입장/퇴장, 닉네임 중복 처리, 세션 토큰으로 재접속
 *  - 이동 검증(예산 방식), 좌석 점유, 상태(공부/휴식/☕휴식), 채팅 검증, 뽀모도로
 *  - 상호작용 지점(커피머신 앞 E → 'coffee' 상태), 듣는 중(유튜브 제목) 표시
 *  - 4단계: 영구 데이터는 store(메모리/Supabase) — 공부 세션·출석·오늘 목표·할 일·강아지 이름. 실시간 상태는 계속 메모리.
 *  - 5단계: 아바타는 파츠 객체(avatar.js 카탈로그 검증) — users.avatar 에 저장하고 재입장 시 복원.
 *  - 8단계: 코인 — 앉아서 공부 중 10분이 찰 때마다 **즉시** 1코인 (StudyTracker 가 tick 으로 판정해 'coinDue' → award. 남은 초는 users.coin_carry_seconds 로 이월),
 *    집중 사이클 완주(앉아서 공부 중 유지) 시 5코인 (coins.js). 잔액·원장·이월 초·인벤토리는 store.
 *    같은 사람의 코인 증감은 순서대로(coinQueue) 처리해 'coins' 이벤트의 balance 가 항상 커지는 순서로 나간다 (보너스와 시간 코인이 동시에 와도 꼬이지 않는다).
 *    상태는 개인 뽀모도로를 따라간다 (followPomodoro): 시작·집중 → 공부 중, 휴식 → 휴식 중(세션 일시 정지), 정지 → 마지막 상태 유지. 야외·침대/안마의자는 예외.
 *    상점(shop.js) — purchase 는 잔액 확인·차감·원장·인벤토리까지 한다 (색/종류 variant 선택).
 *  - 9단계: 가구. 공용 가구 배치(layout: room_layout, 규칙은 layout.js)·편집 모드·가구 잠금(먼저 잡은 사람 우선)·
 *    권한(놓은 사람의 "내가 놓은 것만" 설정)·충돌 맵 반영(this.room.collision 을 다시 만든다)·동적 좌석(빈백/안마의자/침대 = f:<id>).
 *    침대·안마의자에 앉으면 자동 휴식(공부로 못 바꿈, 세션 안 쌓임). 책상 소품은 users.desk_items 슬롯 3개 → player.deskItems.
 *  - 10단계: 펫. 개인 펫(FollowerNpc 'p:<playerId>', users.pet_config: 활성 펫·이름·꾸미기·스킬) · 공용 펫(SharedPetNpc/FishNpc 's:<roomPetId>',
 *    room_pets, 최대 3마리, 푼 사람만 이름/회수) · 기존 강아지의 꾸미기/스킬은 room_pets 의 item_id 'dog' 행. 쓰다듬기는 종별 반응 이모지.
 *    스킬은 펫별 1회 구매(shop:buy target): 'come'(채팅에 이름 → comeTo) · 'sleep_beside' · 'high_five'.
 *  - 12단계: 야외. OutdoorWorld(outdoor.js) 가 outdoor: true 로 만든다 — 강아지 없음(dog = null), 좌석은 휴식만, 가구 편집 불가,
 *    move 에 탈것 { type, angle, speed } (검증은 vehicles.js, 예산은 종류별 최고 속도) + 랩 판정. 플레이어 객체는 스터디 ↔ 야외를 오갈 때
 *    detach()/adopt() 로 그대로 옮긴다 (id·토큰·아바타·펫 설정 유지, 개인 뽀모도로도 같이).
 *  - 11단계: 스터디. World 하나 = 스터디 하나 (Hub 가 지연 생성·비면 해제). 플레이어·채팅·좌석·가구·공용 펫·강아지는 스터디마다 따로,
 *    사람에게 붙은 것(코인·인벤토리·개인 펫·아바타·공부 기록·출석·목표·할 일)은 전역 — StudyTracker 와 goals 맵은 Hub 것을 공유한다
 *    (studyId 로 자기 스터디의 이벤트만 골라 쓴다). 저장소의 가구·펫 키는 studyId (독립 실행이면 room.id).
 *    편집 권한(editPolicy 'owner' 면 방장만) · 그룹 주간 목표(멤버 전원의 이번 주 합이 목표에 닿으면 주 1회 'weeklyGoal' + 접속 중 멤버 10코인,
 *    오프라인 멤버는 다음 입장 때 loadProfile 이 지급) · 랭킹 scope('study' = 멤버만 / 'all').
 * 이벤트: 'playerLeft' (유예 시간이 지나 정리될 때), 'pomodoro' (snap, reason, player — 개인 타이머 상태 변화),
 *         'npcUpdate' (NPC 스냅샷, 10Hz), 'npcPet' ({ npc, by, playerId, name, reaction, highFive }), 'npcName' ({ npc, name }), 'npcRemoved' ({ id }),
 *         'sessionSaved' { nickname, playerId, seconds }, 'attendance' { nickname, playerId, streak, weekDays, inserted },
 *         'goalReached' { nickname, playerId, todaySeconds, targetMinutes },
 *         'coins' { nickname, playerId, delta, reason, balance, carrySeconds?, nextCoinAt? } (코인 증감이 저장된 뒤. 시간 코인이면 다음 코인까지 정보 포함)
 *         'coinProgress' { nickname, playerId, studying, carrySeconds, nextCoinAt|null } (세션 시작·종료 — 지갑 "다음 코인까지" 카운트다운용)
 *         'status' { player, reason } (뽀모도로를 따라 상태가 자동으로 바뀜 — 소켓이 playerStatus 로 방송)
 *         'layout' { op: 'add'|'move'|'remove'|'grab'|'release', entry?, id?, by } (배치 변경 — 소켓이 layout:update 로 방송)
 *         'desk' { player } (책상 소품 변경), 'editing' { player } (편집 모드 on/off)
 *         'vehicle' { player } (12단계: 탑승·해제·데칼 변경 — 소켓이 playerVehicle 로 방송)
 *         'weeklyGoal' { weekStart, totalSeconds, targetSeconds, bonus, awarded: [playerId] } (11단계 그룹 목표 달성)
 */
const EventEmitter = require('node:events');
const crypto = require('node:crypto');

const { normalizeNickname, uniqueNickname } = require('./nickname');
const { SPEED, FEET_W, FEET_H, applyMove, maxBudget, canStand } = require('./movement');
const { sanitizeChat, createRateLimiter, MAX_LEN: CHAT_MAX } = require('./chat');
const { Pomodoro } = require('./pomodoro');
const { DogNpc, SharedPetNpc, FishNpc, FollowerNpc, SPECIES: PET_SPECIES } = require('./npc');
const { StudyTracker } = require('./study');
const { createMemoryStore } = require('../store/memory');
const { DEFAULT_TZ, dateKey, weekStart, isValidTz } = require('../store/stats');
const { FACING_DELTA, interactableById } = require('../rooms/build');
const { normalizeAvatar } = require('./avatar');
const { focusBonusFor } = require('./coins');
const { createShop, pickVariant, PET_SLOTS } = require('./shop');
const { validatePlacement, buildCollision, seatOf, cellsOf } = require('./layout');
const { validateVehiclePayload, typeOf: vehicleType } = require('./vehicles');
const { FISH, fishById, CATCH_PER_DAY } = require('./fishing');
const { LIST: CONSTELLATIONS, byId: constellationById } = require('./constellations');

const GRACE_MS = 30 * 1000; // 연결 끊김 후 플레이어를 유지하는 시간
const SIT_RANGE_PX = 56; // 좌석 중심까지 이 거리 안이어야 앉을 수 있다 (대각선 인접 포함)
const STATUSES = ['study', 'rest', 'coffee']; // coffee = 커피머신 앞에서 E ("☕ 휴식"). 수동 토글은 study/rest 만
const MANUAL_STATUSES = ['study', 'rest'];
const LISTENING_MAX = 80;
const EMOJIS = ['👋', '😊', '👍', '❤️', '😂', '🔥'];
const FACINGS = Object.keys(FACING_DELTA);
const GOAL_TEXT_MAX = 20;
const GOAL_MIN = 30; // 분
const GOAL_MAX = 8 * 60;
const GOAL_STEP = 30;
const TODO_MAX = 60;
const LOCK_MS = 30 * 1000; // 편집 잠금: 잡은 뒤 이만큼 손대지 않으면 풀린다
const DESK_SLOTS = 3;
const RESTING_SEATS = new Set(['bed', 'massage']); // 앉으면 자동 휴식 (공부로 못 바꿈)
const MAX_SHARED_PETS = 3;
const PET_NAME_MAX = 8;
const WEEKLY_BONUS = 10; // 11단계: 그룹 주간 목표 달성 보너스 (멤버마다)
const TANK_MAX = 3; // 14단계: 공용 펫 어항에 넣을 수 있는 물고기 수

function seatCenter(room, seat) {
  return { x: (seat.x + 0.5) * room.tileSize, y: (seat.y + 1) * room.tileSize };
}

class World extends EventEmitter {
  /**
   * 11단계 옵션: studyId(스터디 번호, Hub 가 준다) · study(공유 StudyTracker 인스턴스 또는 트래커 옵션) · goals(공유 Map) ·
   *   studyInfo(() => 스터디 행: ownerNickname·editPolicy·weeklyGoalMinutes·name) · members(async () => 멤버 닉네임[]) ·
   *   takenNicknames(() => 다른 스터디까지 포함해 쓰고 있는 닉네임[])
   */
  constructor(room, { graceMs = GRACE_MS, pomodoro = {}, npc = {}, now = () => Date.now(), store = null, tz = DEFAULT_TZ, study = {}, shop = undefined, log = console, studyId = null, goals = null, studyInfo = () => null, members = null, takenNicknames = null, allPlayers = null, outdoor = false } = {}) {
    super();
    this.outdoor = Boolean(outdoor); // 12단계: 공용 야외 (강아지 없음 · 좌석은 휴식만 · 편집 불가 · 탈것)
    // 충돌 맵은 배치 가구에 따라 바뀌므로 방 데이터를 얕게 복사하고 collision 만 새로 만든다 (NPC 도 같은 객체를 본다)
    this.baseRoom = room;
    this.room = { ...room, collision: room.collision.map((r) => r.slice()) };
    this.roomId = room.id;
    this.studyId = studyId;
    this.scopeId = studyId ?? room.id; // 저장소의 가구·펫 키 (스터디 번호, 독립 실행이면 방 템플릿 id)
    this.studyInfo = studyInfo;
    this.membersOf = members;
    this.takenNicknames = takenNicknames;
    this.allPlayers = allPlayers; // 모든 스터디의 접속자 (랭킹 '전체' online 표시)
    this.now = now;
    this.log = log;
    this.graceMs = graceMs;
    this.store = store || createMemoryStore();
    this.tz = isValidTz(tz) ? tz : DEFAULT_TZ;
    this.goals = goals || new Map(); // nickname → { date, goalText, targetMinutes } (오늘 것만 캐시). 11단계: Hub 와 공유
    if (study instanceof StudyTracker) {
      this.study = study; // 11단계: 모든 스터디가 공유 (전역 공부 기록)
      this.ownsStudy = false;
    } else {
      this.study = new StudyTracker({ store: this.store, tz: this.tz, now, log, goalOf: (n) => this.goalOf(n), ...study });
      this.ownsStudy = true;
    }
    // 공유 트래커면 내 스터디의 이벤트만 (세션에 실린 studyId 로 구분)
    const mine = (fn) => (e) => { if (e.studyId === this.studyId) fn(e); };
    this.studyListeners = {
      saved: mine((e) => { this.emit('sessionSaved', e); this.checkWeeklyGoal().catch(() => {}); }),
      attendance: mine((e) => this.emit('attendance', e)),
      goalReached: mine((e) => this.emit('goalReached', e)),
      // 실시간 시간 코인: 트래커가 10분이 찼다고 알리면 바로 지급 (다음 코인까지 정보를 coins 이벤트에 실어 보낸다)
      coinDue: mine((e) => this.award(e.nickname, e.playerId, e.coins, 'study', { carrySeconds: e.carrySeconds, nextCoinAt: e.nextCoinAt })),
      coinProgress: mine((e) => this.emit('coinProgress', e)),
    };
    for (const [ev, fn] of Object.entries(this.studyListeners)) this.study.on(ev, fn);
    this.weeklyReached = null; // 이번 주 그룹 목표를 이미 달성했으면 그 주의 월요일 키
    this.weeklyChecking = null;
    this.players = new Map(); // id → player
    this.sessions = new Map(); // token → player
    this.seatOwners = new Map(); // seatId → playerId
    this.graceTimers = new Map(); // playerId → timeout
    this.chatLimiter = createRateLimiter();
    this.pomodoroOpts = { ...pomodoro, now }; // 개인 타이머 기본값 (테스트: focusMs/breakMs)
    this.pomodoros = new Map(); // playerId → Pomodoro (7단계: 개인별, 퇴장하면 정리)
    this.shop = createShop(shop); // 8단계: 카탈로그 (테스트는 임시 아이템을 넣는다)
    this.pendingAwards = new Set(); // 진행 중인 코인 저장 Promise (dispose 가 기다림)
    this.coinQueue = new Map(); // nickname → 마지막 코인 증감 Promise (같은 사람은 순서대로 → balance 순서 보장)
    this.layout = new Map(); // 9단계: layoutId → 배치 항목 { id, itemId, inventoryId, x, y, rotation, meta, placedBy, placedAt }
    this.locks = new Map(); // layoutId → { by: playerId, at } (편집 잠금)

    // 강아지 NPC: 접속 중인 플레이어 위치를 보고 행동한다. npc.autoStart === false 면 테스트가 직접 tick() 한다.
    this.npcOpts = { ...npc, now };
    this.npcs = [];
    this.roomPets = new Map(); // roomPetId → { row, npc } (10단계 공용 펫)
    this.dogRow = null; // 강아지 꾸미기/스킬 설정 행 (room_pets item_id 'dog')
    this.dog = null;
    if (!this.outdoor) {
      this.dog = new DogNpc(this.room, this.npcOpts);
      this.addNpc(this.dog);
    }
  }

  // ── NPC 공통 배선 (10단계) ──────────────────────────────────────────
  addNpc(n) {
    n.players = () => [...this.players.values()].filter((p) => p.connected);
    n.on('update', (snap) => this.emit('npcUpdate', snap));
    n.on('pet', ({ by, id, reaction, highFive }) => this.emit('npcPet', { npc: n.id, by, playerId: id, name: n.name, reaction, highFive }));
    n.on('name', (name) => this.emit('npcName', { npc: n.id, name }));
    this.npcs.push(n);
    if (this.npcOpts.autoStart !== false) n.start();
    this.emit('npcUpdate', n.snapshot());
    return n;
  }

  removeNpc(id) {
    const i = this.npcs.findIndex((n) => n.id === id);
    if (i < 0) return null;
    const [n] = this.npcs.splice(i, 1);
    n.dispose();
    this.emit('npcRemoved', { id });
    return n;
  }

  /** 저장소에서 초기 상태 로드 (강아지 이름·꾸미기, 가구, 공용 펫, 저장된 합계). 스터디 월드가 만들어질 때 한 번 */
  async init() {
    try {
      if (this.ownsStudy) await this.study.refreshTotals();
      await this.loadLayout();
      await this.loadPets();
      // 강아지 이름: 스터디의 'dog' 행. 독립 실행(스터디 없음)이면 옛 users.dog_name 의 마지막 값
      if (this.dog && this.dogRow && this.dogRow.name) this.dog.setName(this.dogRow.name);
      else if (this.dog && this.studyId === null) {
        const name = await this.store.getLatestDogName();
        if (name) this.dog.setName(name);
      }
    } catch (err) {
      this.log.warn(`[world] 저장소 초기 로드 실패: ${err.message}`);
    }
    return this;
  }

  today() {
    return dateKey(this.now(), this.tz);
  }

  npcSnapshots() {
    return this.npcs.map((n) => n.snapshot());
  }

  npcById(id) {
    return this.npcs.find((n) => n.id === id) || null;
  }

  get config() {
    return { speed: SPEED, feetW: FEET_W, feetH: FEET_H, sendHz: 20, chatMax: CHAT_MAX, emojis: EMOJIS, graceMs: this.graceMs, outdoor: this.outdoor };
  }

  /** 다른 클라이언트에 보내는 공개 정보 */
  publicPlayer(p) {
    return { id: p.id, nickname: p.nickname, avatar: p.avatar, x: p.x, y: p.y, facing: p.facing, moving: p.moving, status: p.status, seatId: p.seatId, connected: p.connected, listening: p.listening || null, goal: this.publicGoal(p.nickname), pomodoro: this.publicPomodoro(p), editing: Boolean(p.editing), deskItems: this.publicDeskItems(p), vehicle: this.publicVehicle(p), studyName: p.homeStudy ? p.homeStudy.name : null };
  }

  /** 탑승 중인 탈것 (12단계): { type, color, decal, angle, speed } | null */
  publicVehicle(p) {
    const v = p.vehicle;
    return v ? { type: v.type, color: v.color || null, decal: v.decal || null, angle: v.angle || 0, speed: v.speed || 0 } : null;
  }

  /** 책상 소품 슬롯 (9단계): [{ itemId, variant } | null] x3 */
  publicDeskItems(p) {
    const arr = Array.isArray(p.deskItems) ? p.deskItems : [];
    return Array.from({ length: DESK_SLOTS }, (_, i) => (arr[i] ? { itemId: arr[i].itemId, variant: arr[i].variant || null } : null));
  }

  /** 머리 위 타이머 표시용 (8단계): 진행 중이면 { phase, endsAt }, 아니면 null. 남은 시간은 각자 서버 시각으로 계산한다 */
  publicPomodoro(p) {
    const pomo = this.pomodoros.get(p.id);
    return pomo && pomo.running ? { phase: pomo.phase, endsAt: pomo.endsAt } : null;
  }

  listPlayers() {
    return [...this.players.values()].map((p) => this.publicPlayer(p));
  }

  /** 접속 중인 인원 (유예 중인 플레이어 제외) */
  get connectedCount() {
    let n = 0;
    for (const p of this.players.values()) if (p.connected) n++;
    return n;
  }

  // ── 입장 / 재접속 / 퇴장 ──────────────────────────────────────────
  /**
   * @returns {{ ok: true, player, resumed: boolean } | { ok: false, error }}
   */
  /** 살아 있는 세션 토큰인지 (유예 중 포함) — 게이트가 재접속을 비밀번호 없이 통과시킬 때 사용 */
  hasSession(token) {
    return typeof token === 'string' && this.sessions.has(token);
  }

  join({ nickname, token, avatar, socketId }) {
    if (token && this.sessions.has(token)) {
      const player = this.sessions.get(token);
      const oldSocketId = player.socketId;
      player.socketId = socketId;
      player.connected = true;
      player.disconnectedAt = null;
      clearTimeout(this.graceTimers.get(player.id));
      this.graceTimers.delete(player.id);
      return { ok: true, player, resumed: true, oldSocketId: oldSocketId !== socketId ? oldSocketId : null };
    }
    const norm = normalizeNickname(nickname);
    if (!norm.ok) return { ok: false, error: norm.error };
    const name = uniqueNickname(norm.name, this.takenNicknames ? this.takenNicknames() : [...this.players.values()].map((p) => p.nickname));
    const id = crypto.randomBytes(6).toString('hex');
    const newToken = crypto.randomBytes(24).toString('base64url');
    const player = {
      id,
      token: newToken,
      socketId,
      studyId: this.studyId, // 11단계: 공유 트래커의 세션·이벤트를 스터디별로 구분
      nickname: name,
      avatar: normalizeAvatar(avatar), // 5단계: 파츠 객체 (옛 정수 값도 상의 색으로 변환)
      avatarProvided: avatar !== undefined && avatar !== null, // 안 보냈으면 loadProfile 에서 users.avatar 복원
      x: this.room.spawn.x,
      y: this.room.spawn.y,
      facing: 'down',
      moving: false,
      status: 'rest',
      prevStatus: 'rest',
      seatId: null,
      listening: null, // 유튜브 카드에서 재생 중인 영상 제목 (본인만 소리, 남들에겐 ♪ 표시)
      editing: false, // 9단계: 편집 모드 (머리 위 🛠)
      deskItems: [null, null, null], // 9단계: 책상 소품 { inventoryId, itemId, variant } | null
      layoutLock: false, // 9단계: 내가 놓은 가구는 나만 이동·회수
      vehicle: null, // 12단계: 탑승 중인 탈것 { type, color, decal, horn, inventoryId, angle, speed } (야외에서만)
      vehicleConfig: null, // 12단계: users.vehicle_config { active, decal, horn } (inventory id)
      statsPublic: false, // 12단계: 야외 프로필에 이번 주 공부 시간 공개
      homeStudy: null, // 12단계: 야외에 있는 동안 소속 스터디 { id, name } (Hub 가 채운다)
      connected: true,
      disconnectedAt: null,
      budget: maxBudget(),
      lastMoveAt: this.now(),
      joinedAt: this.now(),
    };
    this.players.set(id, player);
    this.sessions.set(newToken, player);
    this.store.upsertUser(name, player.avatarProvided ? { avatar: player.avatar } : {}).catch((err) => this.log.warn(`[world] 사용자 저장 실패: ${err.message}`));
    return { ok: true, player, resumed: false, oldSocketId: null };
  }

  /**
   * 입장 ack 에 실을 영구 데이터: 오늘 목표 · 출석 스트릭 · 코인 잔액 · (클라이언트가 아바타를 안 보냈으면) 저장된 아바타 복원 ·
   * 11단계: 오프라인 사이 달성된 그룹 목표 보너스(rewards) 지급. 실패해도 입장은 된다
   */
  async loadProfile(player) {
    const out = { goal: null, streak: { streak: 0, weekDays: 0, attendedToday: false }, coins: 0, rewards: [] };
    try {
      if (!player.avatarProvided) {
        const u = await this.store.getUser(player.nickname);
        if (u && u.avatar !== null && u.avatar !== undefined) player.avatar = normalizeAvatar(u.avatar);
        player.avatarProvided = true;
      }
      const date = this.today();
      const g = await this.store.getGoal(player.nickname, date);
      if (g) this.goals.set(player.nickname, g);
      else this.goals.delete(player.nickname);
      out.goal = this.publicGoal(player.nickname);
      out.streak = await this.store.attendanceOf(player.nickname, { tz: this.tz, now: this.now() });
      out.rewards = await this.claimRewards(player);
      out.coins = await this.store.getCoins(player.nickname);
      out.coinProgress = await this.coinProgressOf(player); // 재접속 이어받기면 진행 중 세션의 다음 코인 시각
      await this.loadDesk(player);
      out.vehicleConfig = this.vehicleConfigOf(player);
      out.statsPublic = Boolean(player.statsPublic);
    } catch (err) {
      this.log.warn(`[world] 프로필 로드 실패 (${player.nickname}): ${err.message}`);
    }
    return out;
  }

  /** 아직 못 받은 그룹 목표 보너스를 지급하고 [{ studyId, studyName, weekStart, coins }] 를 돌려준다 */
  async claimRewards(player) {
    const rows = await this.store.claimRewards(player.nickname, this.now());
    const out = [];
    for (const r of rows) {
      await this.award(player.nickname, player.id, WEEKLY_BONUS, 'weekly_goal');
      const info = r.studyId === this.scopeId ? this.studyInfo() : await this.store.getStudy(r.studyId).catch(() => null);
      out.push({ studyId: r.studyId, studyName: info ? info.name : null, weekStart: r.weekStart, coins: WEEKLY_BONUS });
    }
    return out;
  }

  bySocket(socketId) {
    for (const p of this.players.values()) if (p.socketId === socketId && p.connected) return p;
    return null;
  }

  /** 소켓이 끊겼다: 유예 시간 동안 플레이어를 유지하고, 지나면 정리한다. */
  disconnect(player) {
    if (!player.connected) return;
    player.connected = false;
    player.moving = false;
    player.disconnectedAt = this.now();
    const t = setTimeout(() => this.remove(player.id, 'timeout'), this.graceMs);
    t.unref?.();
    this.graceTimers.set(player.id, t);
  }

  /** 즉시 퇴장 (나가기 버튼) 또는 유예 만료 */
  remove(id, reason = 'leave') {
    const player = this.players.get(id);
    if (!player) return null;
    const { pomodoro } = this.detach(player, reason);
    if (pomodoro) pomodoro.dispose();
    return player;
  }

  /**
   * 12단계: 플레이어를 이 월드에서 떼어 낸다 (다른 월드로 옮기거나 퇴장). 좌석·세션·잠금·개인 펫을 정리하고 'playerLeft' 를 낸다.
   * 개인 뽀모도로는 버리지 않고 돌려준다 (옮겨 갈 월드가 adopt 로 이어받는다 — 퇴장이면 remove 가 dispose).
   * @returns {{ pomodoro: Pomodoro | null }}
   */
  detach(player, reason = 'leave') {
    const id = player.id;
    clearTimeout(this.graceTimers.get(id));
    this.graceTimers.delete(id);
    if (player.seatId) this.seatOwners.delete(player.seatId);
    this.players.delete(id);
    this.sessions.delete(player.token);
    this.chatLimiter.forget(id);
    const pomodoro = this.pomodoros.get(id) || null;
    if (pomodoro) { pomodoro.removeAllListeners(); this.pomodoros.delete(id); }
    this.releaseLocks(player);
    player.editing = false;
    this.removeNpc(`p:${player.id}`); // 개인 펫은 주인과 함께 사라진다
    player.removed = true;
    this.study.sync(player); // 앉은 채 나가면 세션 저장
    if (player.seatId) { player.seatId = null; player.status = player.prevStatus === 'coffee' ? 'rest' : player.prevStatus || 'rest'; }
    this.emit('playerLeft', player, reason);
    return { pomodoro };
  }

  /**
   * 12단계: 다른 월드에서 온 플레이어를 이어받는다 (같은 객체 — id·토큰·아바타·펫 설정 그대로). 스폰 위치에 세우고 개인 펫을 다시 만든다.
   * pomodoro 를 주면 그 타이머를 계속 쓴다 (change 이벤트만 이 월드로 다시 묶는다).
   */
  async adopt(player, { pomodoro = null, x, y } = {}) {
    player.removed = false;
    player.studyId = this.studyId;
    player.x = x ?? this.room.spawn.x;
    player.y = y ?? this.room.spawn.y;
    player.facing = 'down';
    player.moving = false;
    player.seatId = null;
    player.editing = false;
    player.vehicle = null;
    player.budget = maxBudget();
    player.lastMoveAt = this.now();
    if (player.status === 'coffee') player.status = 'rest';
    if (this.outdoor && player.status === 'study') player.status = 'rest'; // 야외에서는 공부 상태가 없다
    player.prevStatus = player.status;
    player.connected = true;
    player.disconnectedAt = null;
    this.players.set(player.id, player);
    this.sessions.set(player.token, player);
    if (pomodoro) this.bindPomodoro(player, pomodoro);
    await this.syncFollower(player);
    return player;
  }

  // ── 이동 ────────────────────────────────────────────────────────────
  /** @returns {{ ok: true } | { ok: false, reason, x, y }} */
  move(player, payload) {
    if (!payload || typeof payload !== 'object') return { ok: false, reason: 'invalid', x: player.x, y: player.y };
    if (player.seatId) return { ok: false, reason: 'seated', x: player.x, y: player.y };
    // 12단계: 탑승 중이면 종류별 최고 속도로 예산을 세고 각도·속도를 받아 둔다 (남에게 그대로 중계)
    const v = validateVehiclePayload(player.vehicle, payload.vehicle);
    if (!v.ok) return { ok: false, reason: v.reason, x: player.x, y: player.y };
    const speed = v.vehicle ? vehicleType(v.vehicle.type).maxSpeed : undefined;
    const from = { x: player.x, y: player.y };
    const res = applyMove(this.room, player, { x: Number(payload.x), y: Number(payload.y) }, this.now(), speed);
    if (FACINGS.includes(payload.facing)) player.facing = payload.facing;
    player.moving = Boolean(payload.moving);
    if (v.vehicle) { player.vehicle.angle = v.vehicle.angle; player.vehicle.speed = v.vehicle.speed; }
    if (!res.ok) return { ok: false, reason: res.reason, x: player.x, y: player.y };
    this.afterMove(player, from);
    return { ok: true };
  }

  /** 이동이 받아들여진 뒤 (12단계: OutdoorWorld 가 랩 판정에 쓴다) */
  afterMove() {}

  // ── 좌석 ────────────────────────────────────────────────────────────
  /** 방 좌석 또는 배치 가구 좌석(f:<layoutId> — 빈백/안마의자/침대) */
  seat(seatId) {
    if (typeof seatId !== 'string') return null;
    if (seatId.startsWith('f:')) return this.layoutSeat(this.layout.get(Number(seatId.slice(2))));
    return this.room.seats.find((s) => s.id === seatId) || null;
  }

  /** 배치 항목의 좌석 { id: 'f:<id>', x, y, facing, kind, layoutId } | null */
  layoutSeat(entry) {
    if (!entry) return null;
    const item = this.shop.get(entry.itemId);
    const s = item && seatOf(item.sprite, entry.x, entry.y, entry.rotation || 0);
    return s ? { id: `f:${entry.id}`, x: s.tx, y: s.ty, facing: s.facing, kind: s.kind, layoutId: entry.id } : null;
  }

  /** 방 좌석 + 배치 가구 좌석 전부 */
  allSeats() {
    const out = [...this.room.seats];
    for (const e of this.layout.values()) {
      const s = this.layoutSeat(e);
      if (s) out.push(s);
    }
    return out;
  }

  /** @returns {{ ok: true, seat } | { ok: false, error }} */
  sit(player, seatId) {
    if (player.seatId) return { ok: false, error: 'already_seated' };
    const seat = this.seat(seatId);
    if (!seat) return { ok: false, error: 'no_seat' };
    const owner = this.seatOwners.get(seatId);
    if (owner && owner !== player.id) return { ok: false, error: 'occupied' };
    if (player.vehicle) return { ok: false, error: 'riding' }; // 12단계: 탑승 중엔 앉을 수 없다
    const c = seatCenter(this.room, seat);
    if (Math.hypot(c.x - player.x, c.y - player.y) > SIT_RANGE_PX) return { ok: false, error: 'too_far' };
    this.seatOwners.set(seatId, player.id);
    player.seatId = seatId;
    player.x = c.x;
    player.y = c.y;
    player.facing = seat.facing;
    player.moving = false;
    // 커피(☕ 휴식) 중에 앉으면 공부 중 → 일어날 때는 커피가 아니라 휴식으로
    player.prevStatus = player.status === 'coffee' ? 'rest' : player.status;
    // 침대·안마의자는 자동 휴식 (세션이 쌓이지 않는다). 일어나면 앉기 전 상태로. 뽀모도로 휴식 구간에 앉으면 타이머를 따라 휴식 중
    player.status = this.outdoor || RESTING_SEATS.has(seat.kind) || this.inPomodoroBreak(player) ? 'rest' : 'study'; // 야외 벤치는 휴식만
    this.study.sync(player);
    return { ok: true, seat };
  }

  /** 앉아 있는 좌석의 종류 ('bed' | 'massage' | 'beanbag' | 의자 이름) 또는 null */
  seatKindOf(player) {
    const s = player.seatId ? this.seat(player.seatId) : null;
    return s ? s.kind : null;
  }

  /** @returns {{ ok: true } | { ok: false, error }} */
  stand(player) {
    if (!player.seatId) return { ok: false, error: 'not_seated' };
    this.seatOwners.delete(player.seatId);
    player.seatId = null;
    player.status = player.prevStatus || 'rest';
    player.budget = maxBudget();
    player.lastMoveAt = this.now();
    this.study.sync(player);
    return { ok: true };
  }

  seatSnapshot() {
    return Object.fromEntries(this.seatOwners);
  }

  // ── 상태 / 채팅 / 이모지 ────────────────────────────────────────────
  setStatus(player, status) {
    if (!MANUAL_STATUSES.includes(status)) return { ok: false, error: 'invalid' };
    if (status === 'study' && this.outdoor) return { ok: false, error: 'outdoor' }; // 12단계: 야외에서는 공부 상태가 없다
    if (status === 'study' && RESTING_SEATS.has(this.seatKindOf(player))) return { ok: false, error: 'resting' }; // 침대/안마의자에서는 휴식만
    player.status = status;
    player.prevStatus = status;
    this.study.sync(player); // 앉은 채 휴식으로 바꾸면 세션 종료, 다시 공부면 새 세션
    return { ok: true };
  }

  /**
   * 상호작용 지점 (room.interactables) 에서 E: 거리 검사 후 종류별 효과.
   *  - coffee: 앉아 있지 않으면 'coffee' 상태 (☕ 휴식). 이미 커피 중이면 휴식으로 되돌린다.
   *  - music: 클라이언트 전용(유튜브 카드) — 서버는 거리만 확인한다.
   * @returns {{ ok: true, kind, status? } | { ok: false, error }}
   */
  interact(player, id) {
    const it = interactableById(this.room, id);
    if (!it) return { ok: false, error: 'no_interactable' };
    if (Math.hypot(it.x - player.x, it.y - player.y) > it.range) return { ok: false, error: 'too_far' };
    if (player.vehicle) return { ok: false, error: 'riding' };
    if (it.kind === 'coffee') {
      if (player.seatId) return { ok: false, error: 'seated' };
      player.status = player.status === 'coffee' ? 'rest' : 'coffee';
      player.prevStatus = player.status;
      return { ok: true, kind: it.kind, status: player.status };
    }
    return { ok: true, kind: it.kind };
  }

  /** 듣는 중 표시: 제목(≤80자, 제어문자 제거) 또는 null */
  setListening(player, title) {
    if (title === null || title === undefined || title === '') {
      player.listening = null;
      return { ok: true, listening: null };
    }
    if (typeof title !== 'string') return { ok: false, error: 'invalid' };
    // eslint-disable-next-line no-control-regex
    const clean = title.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, LISTENING_MAX);
    player.listening = clean || null;
    return { ok: true, listening: player.listening };
  }

  /** 아바타 변경: catalog 기준으로 정규화(없는 id → 기본값)하고 users.avatar 에 저장 */
  setAvatar(player, avatar) {
    player.avatar = normalizeAvatar(avatar);
    player.avatarProvided = true;
    this.store.upsertUser(player.nickname, { avatar: player.avatar }).catch((err) => this.log.warn(`[world] 아바타 저장 실패: ${err.message}`));
    return { ok: true, avatar: player.avatar };
  }

  chat(player, raw) {
    const s = sanitizeChat(raw);
    if (!s.ok) return s;
    if (!this.chatLimiter.allow(player.id, this.now())) return { ok: false, error: 'too_fast' };
    return { ok: true, text: s.text, ts: this.now() };
  }

  emoji(index) {
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0 || i >= EMOJIS.length) return null;
    return EMOJIS[i];
  }

  // ── 개인 뽀모도로 ──────────────────────────────────────────────────
  /** 플레이어의 타이머 (없으면 기본값으로 생성). 재접속으로 이어받으면 그대로 유지된다 */
  pomodoroOf(player) {
    let p = this.pomodoros.get(player.id);
    if (!p) {
      p = new Pomodoro(this.pomodoroOpts);
      this.bindPomodoro(player, p);
    }
    return p;
  }

  /** 타이머 이벤트를 이 월드의 플레이어에 묶는다: phaseEnd(보너스 판정) → 상태 자동 전환 → 'pomodoro' 스냅샷 방송 */
  bindPomodoro(player, pomo) {
    pomo.on('phaseEnd', (cycle) => this.settleFocusCycle(player, cycle));
    pomo.on('change', (snap, reason) => {
      this.followPomodoro(player, snap, reason);
      this.emit('pomodoro', snap, reason, player);
    });
    this.pomodoros.set(player.id, pomo);
  }

  /** 내 타이머가 돌고 있고 지금 휴식 구간인가 (앉을 때 자동 휴식) */
  inPomodoroBreak(player) {
    const pomo = this.pomodoros.get(player.id);
    return Boolean(pomo && pomo.running && pomo.phase === 'break');
  }

  /**
   * 상태가 타이머를 따라간다: 시작·집중 전환 → 공부 중, 휴식 전환 → 휴식 중(세션 일시 정지). 정지(stop)·설정(config)은 건드리지 않는다(마지막 상태 유지).
   * 야외에서는 공부 상태가 없고, 침대/안마의자는 휴식만이므로 예외. 서 있는 채 '공부 중' 이 돼도 세션은 앉아야 쌓인다 (isStudying).
   * 반환: 상태가 바뀌었는지 (바뀌면 'status' 이벤트 → 소켓이 playerStatus 방송)
   */
  followPomodoro(player, snap, reason) {
    if (reason !== 'start' && reason !== 'switch') return false;
    if (player.removed || this.outdoor) return false;
    const target = snap.phase === 'focus' ? 'study' : 'rest';
    if (target === 'study' && RESTING_SEATS.has(this.seatKindOf(player))) return false;
    if (player.status === target) return false;
    player.status = target;
    player.prevStatus = target;
    this.study.sync(player);
    this.emit('status', { player, reason: 'pomodoro' });
    return true;
  }

  /**
   * 내 타이머 시작. focusMinutes/breakMinutes 를 주면 먼저 설정(20~90 / 5~20분)하고 시작한다.
   * @returns {{ ok: true, ...snapshot } | { ok: false, error: 'running' | 'invalid_focus' | 'invalid_break' }}
   */
  startPomodoro(player, { focusMinutes, breakMinutes } = {}) {
    const pomo = this.pomodoroOf(player);
    if (pomo.running) return { ok: false, error: 'running' };
    if (focusMinutes !== undefined || breakMinutes !== undefined) {
      const c = pomo.configure({ focusMinutes: focusMinutes ?? pomo.focusMs / 60000, breakMinutes: breakMinutes ?? pomo.breakMs / 60000 });
      if (!c.ok) return c;
    }
    pomo.start(player.nickname);
    return { ok: true, ...pomo.snapshot() };
  }

  stopPomodoro(player) {
    const pomo = this.pomodoros.get(player.id);
    if (!pomo || !pomo.stop(player.nickname)) return { ok: false, error: 'not_running' };
    return { ok: true, ...pomo.snapshot() };
  }

  // ── 코인 / 상점 (8단계) ────────────────────────────────────────────
  /**
   * 같은 사람의 코인 증감(지급·구매)을 순서대로 실행한다. 저장소가 느려 응답 순서가 뒤바뀌어도 'coins' 이벤트의 balance 는 실제 순서대로 나간다.
   * 실패(저장소 오류)는 경고 후 null. 저장이 끝날 때까지 dispose 가 기다린다
   */
  coinTask(nickname, task, label = '') {
    const prev = this.coinQueue.get(nickname) || Promise.resolve();
    const p = prev.then(task).catch((err) => {
      this.log.warn(`[world] 코인 저장 실패 (${nickname}${label ? `, ${label}` : ''}): ${err.message}`);
      return null;
    });
    this.coinQueue.set(nickname, p);
    this.pendingAwards.add(p);
    p.finally(() => { this.pendingAwards.delete(p); if (this.coinQueue.get(nickname) === p) this.coinQueue.delete(nickname); });
    return p;
  }

  /** 코인 증감을 저장소에 기록하고 'coins' 이벤트 (extra: 시간 코인의 carrySeconds·nextCoinAt). 실패(잔액 부족·저장소 오류)는 null */
  award(nickname, playerId, delta, reason, extra = {}) {
    return this.coinTask(nickname, async () => {
      const r = await this.store.adjustCoins(nickname, delta, reason, this.now());
      if (!r.ok) return null;
      const e = { nickname, playerId, delta, reason, balance: r.balance, ...extra };
      this.emit('coins', e);
      return e;
    }, `${delta}, ${reason}`);
  }

  /**
   * 지갑·입장 ack 용 "다음 코인까지": 공부 중이면 트래커의 실시간 값(nextCoinAt 은 서버 시각 ms), 아니면 저장된 이월 초.
   * @returns {Promise<{ carrySeconds, nextCoinAt: number|null, studying: boolean }>}
   */
  async coinProgressOf(player) {
    const live = this.study.coinProgress(player.nickname);
    if (live) return live;
    return { carrySeconds: await this.store.getCoinCarry(player.nickname), nextCoinAt: null, studying: false };
  }

  /**
   * 집중 사이클이 끝까지 진행됐다 (Pomodoro 'phaseEnd') → 시작부터 지금까지 앉아서 공부 중이었으면 5코인.
   * 같은 사이클(startedAt)은 한 번만 지급한다. 반환: 지급 Promise 또는 null(조건 미달·이미 지급)
   */
  settleFocusCycle(player, cycle) {
    if (!cycle || cycle.phase !== 'focus' || player.removed) return null;
    if (player.focusBonusAt === cycle.startedAt) return null; // 이중 지급 방지
    const bonus = focusBonusFor(cycle, this.study.live.get(player.nickname) || null);
    if (!bonus) return null;
    player.focusBonusAt = cycle.startedAt;
    return this.award(player.nickname, player.id, bonus, 'focus');
  }

  /** 지갑: 잔액 · 다음 코인까지(carrySeconds + 공부 중이면 nextCoinAt) · 최근 거래 10건 · 인벤토리(placed/slot 표시) · 카탈로그(탭 + 카테고리 + 아이템) */
  async wallet(player) {
    const [coins, progress, ledger, inventory] = await Promise.all([
      this.store.getCoins(player.nickname),
      this.coinProgressOf(player),
      this.store.coinLedger(player.nickname, 10),
      this.store.listInventory(player.nickname),
    ]);
    const { carrySeconds, nextCoinAt, studying } = progress;
    const placed = new Set([...this.layout.values()].map((e) => e.inventoryId));
    const equipped = new Map((player.deskItems || []).map((d, i) => [d && d.inventoryId, i]).filter(([k]) => k !== null && k !== undefined));
    const released = new Map([...this.roomPets.values()].map(({ row }) => [row.inventoryId, row.id]));
    const cfg = this.petConfigOf(player);
    const decoUsed = new Map(); // 꾸미기 inventoryId → 어디에 달렸는지
    const mark = (cos, where) => { for (const slot of PET_SLOTS) if (cos && cos[slot] && cos[slot].inventoryId) decoUsed.set(cos[slot].inventoryId, where); };
    if (this.dog) mark(this.dog.cosmetics, 'dog');
    for (const { row, npc } of this.roomPets.values()) mark(npc.cosmetics, `s:${row.id}`);
    for (const [pid, pc] of Object.entries(cfg.pets)) mark(pc.cosmetics, `pet:${pid}`);
    const vc = this.vehicleConfigOf(player);
    const inv = inventory.map((i) => ({ ...i, placed: placed.has(i.id), slot: equipped.has(i.id) ? equipped.get(i.id) : null, active: cfg.active === i.id, released: released.get(i.id) ?? null, equippedOn: decoUsed.get(i.id) || null, vehicleActive: vc.active === i.id, decalActive: vc.decal === i.id, hornActive: vc.horn === i.id }));
    let trackBest = null;
    try { trackBest = await this.store.trackBest(player.nickname); } catch (err) { this.log.warn(`[world] 기록 조회 실패: ${err.message}`); }
    return { ok: true, coins, carrySeconds, nextCoinAt, studying, ledger, inventory: inv, tabs: this.shop.tabs, categories: this.shop.categories, items: this.shop.items, layoutLock: Boolean(player.layoutLock), pets: this.petSummary(player), vehicleConfig: vc, trackBest, outdoor: this.outdoor };
  }

  // ── 탈것 설정 (12단계) — 탑승·랩은 OutdoorWorld ────────────────────────
  /** users.vehicle_config 형태 보정: { active, decal, horn } (내 인벤토리 id | null) */
  vehicleConfigOf(player) {
    const c = player.vehicleConfig && typeof player.vehicleConfig === 'object' ? player.vehicleConfig : {};
    return { active: c.active ?? null, decal: c.decal ?? null, horn: c.horn ?? null };
  }

  /**
   * 설정 → 내 탈것: 활성 탈것·데칼·경적 (각각 내 인벤토리의 해당 카테고리 아이템 id 또는 null).
   * 야외에서 탑승 중이면 바뀐 설정을 바로 반영한다 (활성 탈것을 바꾸면 내린다).
   * @returns {{ ok: true, vehicleConfig } | { ok: false, error: 'no_item' | 'not_vehicle' | 'not_decal' | 'not_horn' }}
   */
  async setVehicleConfig(player, { active, decal, horn } = {}) {
    const cfg = this.vehicleConfigOf(player);
    const check = async (id, category, err) => {
      if (id === null) return { ok: true, id: null };
      const row = await this.store.getInventoryItem(player.nickname, id);
      const item = row && this.shop.get(row.itemId);
      if (!row || !item) return { ok: false, error: 'no_item' };
      if (item.category !== category) return { ok: false, error: err };
      return { ok: true, id: row.id };
    };
    for (const [key, category, err] of [['active', 'vehicle', 'not_vehicle'], ['decal', 'vehicleDecal', 'not_decal'], ['horn', 'vehicleHorn', 'not_horn']]) {
      const v = { active, decal, horn }[key];
      if (v === undefined) continue;
      const r = await check(v === '' ? null : v, category, err);
      if (!r.ok) return r;
      cfg[key] = r.id;
    }
    player.vehicleConfig = cfg;
    await this.store.upsertUser(player.nickname, { vehicleConfig: cfg });
    if (player.vehicle && active !== undefined && cfg.active !== player.vehicle.inventoryId) this.dismount(player);
    else if (player.vehicle) await this.refreshVehicle(player);
    return { ok: true, vehicleConfig: cfg };
  }

  /** 탑승 중인 탈것의 데칼·경적을 설정에 맞춰 갱신 ('vehicle' 이벤트 → 소켓이 방송) */
  async refreshVehicle(player) {
    const v = player.vehicle;
    if (!v) return null;
    const cfg = this.vehicleConfigOf(player);
    const inv = await this.store.listInventory(player.nickname);
    const decalRow = cfg.decal !== null ? inv.find((r) => r.id === cfg.decal) : null;
    const hornRow = cfg.horn !== null ? inv.find((r) => r.id === cfg.horn) : null;
    v.decal = decalRow ? this.shop.get(decalRow.itemId).decal : null;
    v.horn = hornRow ? this.shop.get(hornRow.itemId).horn : null;
    this.emit('vehicle', { player });
    return v;
  }

  dismount(player) {
    if (!player.vehicle) return { ok: false, error: 'not_riding' };
    player.vehicle = null;
    this.emit('vehicle', { player });
    return { ok: true, vehicle: null };
  }

  /** 야외 프로필 공개 설정 (users.stats_public) */
  async setStatsPublic(player, on) {
    player.statsPublic = Boolean(on);
    await this.store.upsertUser(player.nickname, { statsPublic: player.statsPublic });
    return { ok: true, statsPublic: player.statsPublic };
  }

  // ── 가구: 책상 소품 · 공용 가구 배치 · 편집 잠금 (9단계) ────────────────
  /** 저장된 책상 슬롯·잠금 설정을 플레이어에 싣는다 (입장 때) */
  async loadDesk(player) {
    const u = await this.store.getUser(player.nickname);
    player.layoutLock = Boolean(u && u.layoutLock);
    const ids = (u && Array.isArray(u.deskItems) ? u.deskItems : []).slice(0, DESK_SLOTS);
    player.deskItems = await this.resolveDesk(player.nickname, ids);
    player.petConfig = (u && u.petConfig) || null; // 10단계
    player.vehicleConfig = (u && u.vehicleConfig) || null; // 12단계
    player.statsPublic = Boolean(u && u.statsPublic);
    await this.syncFollower(player);
  }

  /** inventory id 배열 → [{ inventoryId, itemId, variant } | null] (없어졌거나 책상 소품이 아니면 null) */
  async resolveDesk(nickname, ids) {
    const inv = ids.some((id) => id !== null && id !== undefined) ? await this.store.listInventory(nickname) : [];
    return Array.from({ length: DESK_SLOTS }, (_, i) => {
      const id = ids[i];
      const row = id === null || id === undefined ? null : inv.find((r) => r.id === Number(id));
      const item = row && this.shop.get(row.itemId);
      return item && item.category === 'desk' ? { inventoryId: row.id, itemId: row.itemId, variant: row.meta.variant || null } : null;
    });
  }

  /**
   * 책상 슬롯 장착: slots = [inventoryId | null] x3. 내 인벤토리의 책상 소품만, 같은 것을 두 슬롯에 못 넣는다.
   * @returns {{ ok: true, deskItems } | { ok: false, error: 'invalid' | 'no_item' | 'not_desk' | 'duplicate' }}
   */
  async equipDesk(player, slots) {
    if (!Array.isArray(slots) || slots.length > DESK_SLOTS) return { ok: false, error: 'invalid' };
    const ids = Array.from({ length: DESK_SLOTS }, (_, i) => (slots[i] === null || slots[i] === undefined ? null : Number(slots[i])));
    if (ids.some((id) => id !== null && !Number.isInteger(id))) return { ok: false, error: 'invalid' };
    const used = ids.filter((id) => id !== null);
    if (new Set(used).size !== used.length) return { ok: false, error: 'duplicate' };
    const inv = used.length ? await this.store.listInventory(player.nickname) : [];
    for (const id of used) {
      const row = inv.find((r) => r.id === id);
      if (!row) return { ok: false, error: 'no_item' };
      const item = this.shop.get(row.itemId);
      if (!item || item.category !== 'desk') return { ok: false, error: 'not_desk' };
    }
    await this.store.upsertUser(player.nickname, { deskItems: ids });
    player.deskItems = await this.resolveDesk(player.nickname, ids);
    this.emit('desk', { player });
    return { ok: true, deskItems: this.publicDeskItems(player) };
  }

  /** "내가 놓은 것만" 설정 (users.layout_lock) */
  async setLayoutLock(player, on) {
    player.layoutLock = Boolean(on);
    await this.store.upsertUser(player.nickname, { layoutLock: player.layoutLock });
    return { ok: true, layoutLock: player.layoutLock };
  }

  /** 가구 편집 권한 (11단계): editPolicy 'owner' 면 방장만. 스터디 없이 돌면 누구나 */
  canEditLayout(player) {
    if (this.outdoor) return false; // 12단계: 야외엔 가구를 놓지 않는다
    const info = this.studyInfo();
    if (!info || info.editPolicy !== 'owner') return true;
    return Boolean(info.ownerNickname) && info.ownerNickname === player.nickname;
  }

  /** 편집 모드 on/off — 끄면 잡고 있던 가구를 모두 놓는다. 권한이 없으면 forbidden */
  setEditing(player, on) {
    if (on && !this.canEditLayout(player)) return { ok: false, error: 'forbidden' };
    player.editing = Boolean(on);
    if (!player.editing) this.releaseLocks(player);
    this.emit('editing', { player });
    return { ok: true, editing: player.editing };
  }

  async loadLayout() {
    const rows = await this.store.roomLayout(this.scopeId);
    this.layout.clear();
    for (const e of rows) if (this.shop.get(e.itemId)) this.layout.set(e.id, e);
    this.rebuildCollision();
  }

  listLayout() {
    return [...this.layout.values()].map((e) => this.publicLayout(e));
  }

  publicLayout(e) {
    return { id: e.id, itemId: e.itemId, x: e.x, y: e.y, rotation: e.rotation || 0, variant: (e.meta && e.meta.variant) || null, placedBy: e.placedBy, placedAt: e.placedAt, lockedBy: this.lockOwner(e.id) };
  }

  /** 배치 가구의 통과 불가 셀을 방 충돌 맵에 반영 (이동 검증·NPC 길찾기가 즉시 본다) */
  rebuildCollision() {
    this.room.collision = buildCollision(this.baseRoom, [...this.layout.values()], (id) => this.shop.get(id));
  }

  /** 사람(발 박스)·강아지가 서 있는 셀 — 그 위엔 통과 불가 가구를 못 놓는다 */
  occupiedTiles() {
    const T = this.room.tileSize;
    const set = new Set();
    const add = (px, py) => set.add(`${Math.floor(px / T)},${Math.floor(py / T)}`);
    for (const p of this.players.values()) {
      if (p.seatId) continue;
      const hw = FEET_W / 2;
      add(p.x - hw, p.y - FEET_H); add(p.x + hw - 1, p.y - FEET_H); add(p.x - hw, p.y - 1); add(p.x + hw - 1, p.y - 1);
    }
    for (const n of this.npcs) add(n.x, n.y - 1);
    return set;
  }

  validateLayout(item, placement) {
    // 기본 충돌 맵(baseRoom)으로 검사한다 — 배치 가구끼리의 관계는 규칙(겹침/러그)이 따로 본다
    return validatePlacement(this.baseRoom, item, placement, [...this.layout.values()], (id) => this.shop.get(id), { occupied: this.occupiedTiles() });
  }

  lockOwner(id) {
    const l = this.locks.get(id);
    if (!l) return null;
    if (this.now() - l.at > LOCK_MS || !this.players.has(l.by)) { this.locks.delete(id); return null; }
    return l.by;
  }

  releaseLocks(player) {
    for (const [id, l] of [...this.locks]) {
      if (l.by !== player.id) continue;
      this.locks.delete(id);
      if (this.layout.has(id)) this.emit('layout', { op: 'release', id, by: player.id });
    }
  }

  /** 이동·회수 권한: 놓은 사람이거나, 놓은 사람이 "내가 놓은 것만" 을 켜지 않았으면 누구나 */
  async canEditEntry(player, entry) {
    if (!entry.placedBy || entry.placedBy === player.nickname) return true;
    const owner = [...this.players.values()].find((p) => p.nickname === entry.placedBy);
    if (owner) return !owner.layoutLock;
    const u = await this.store.getUser(entry.placedBy);
    return !(u && u.layoutLock);
  }

  seatOccupied(entry) {
    const s = this.layoutSeat(entry);
    return Boolean(s && this.seatOwners.get(s.id));
  }

  /**
   * 배치: 내 인벤토리의 공용 가구(inventoryId)를 (x, y, rotation) 에 놓는다.
   * @returns {{ ok: true, entry } | { ok: false, error: 'no_item' | 'not_placeable' | 'already_placed' | 배치 규칙 오류 }}
   */
  async placeFurniture(player, { inventoryId, x, y, rotation = 0 } = {}) {
    if (!this.canEditLayout(player)) return { ok: false, error: 'forbidden' };
    const inv = await this.store.getInventoryItem(player.nickname, inventoryId);
    if (!inv) return { ok: false, error: 'no_item' };
    const item = this.shop.get(inv.itemId);
    if (!item || item.category !== 'shared') return { ok: false, error: 'not_placeable' };
    if ([...this.layout.values()].some((e) => e.inventoryId === inv.id)) return { ok: false, error: 'already_placed' };
    const v = this.validateLayout(item, { x, y, rotation });
    if (!v.ok) return v;
    const entry = await this.store.addLayout(this.scopeId, { itemId: item.id, inventoryId: inv.id, x: Number(x), y: Number(y), rotation: Number(rotation) || 0, meta: { variant: inv.meta.variant || null }, placedBy: player.nickname, roomId: this.roomId }, this.now());
    this.layout.set(entry.id, entry);
    this.rebuildCollision();
    this.emit('layout', { op: 'add', entry: this.publicLayout(entry), by: player.id });
    return { ok: true, entry: this.publicLayout(entry) };
  }

  /** 잡기(드래그 시작): 먼저 잡은 사람 우선. @returns {{ ok } | { ok: false, error: 'not_found' | 'forbidden' | 'locked' | 'occupied' }} */
  async grabFurniture(player, id) {
    const entry = this.layout.get(Number(id));
    if (!entry) return { ok: false, error: 'not_found' };
    if (!this.canEditLayout(player) || !(await this.canEditEntry(player, entry))) return { ok: false, error: 'forbidden' };
    if (this.seatOccupied(entry)) return { ok: false, error: 'occupied' };
    const owner = this.lockOwner(entry.id);
    if (owner && owner !== player.id) return { ok: false, error: 'locked', by: owner };
    this.locks.set(entry.id, { by: player.id, at: this.now() });
    if (!owner) this.emit('layout', { op: 'grab', id: entry.id, by: player.id });
    return { ok: true, id: entry.id };
  }

  releaseFurniture(player, id) {
    const entry = this.layout.get(Number(id));
    if (!entry) return { ok: false, error: 'not_found' };
    if (this.lockOwner(entry.id) !== player.id) return { ok: false, error: 'not_holder' };
    this.locks.delete(entry.id);
    this.emit('layout', { op: 'release', id: entry.id, by: player.id });
    return { ok: true };
  }

  /** 이동/회전: 잠금이 없으면 잡으면서 옮긴다. 다른 사람이 잡고 있으면 'locked' */
  async moveFurniture(player, { id, x, y, rotation } = {}) {
    const entry = this.layout.get(Number(id));
    if (!entry) return { ok: false, error: 'not_found' };
    const g = await this.grabFurniture(player, entry.id);
    if (!g.ok) return g;
    const item = this.shop.get(entry.itemId);
    const next = { id: entry.id, x: x ?? entry.x, y: y ?? entry.y, rotation: rotation ?? entry.rotation ?? 0 };
    const v = this.validateLayout(item, next);
    if (!v.ok) return v;
    const saved = await this.store.updateLayout(this.scopeId, entry.id, { x: Number(next.x), y: Number(next.y), rotation: Number(next.rotation) || 0 });
    if (!saved) return { ok: false, error: 'not_found' };
    Object.assign(entry, { x: saved.x, y: saved.y, rotation: saved.rotation });
    this.locks.set(entry.id, { by: player.id, at: this.now() });
    this.rebuildCollision();
    this.emit('layout', { op: 'move', entry: this.publicLayout(entry), by: player.id });
    return { ok: true, entry: this.publicLayout(entry) };
  }

  /** 회수: 항목을 지운다 → 놓은 사람 인벤토리에서 다시 팔레트에 보인다 */
  async removeFurniture(player, id) {
    const entry = this.layout.get(Number(id));
    if (!entry) return { ok: false, error: 'not_found' };
    const g = await this.grabFurniture(player, entry.id);
    if (!g.ok) return g;
    await this.store.removeLayout(this.scopeId, entry.id);
    this.layout.delete(entry.id);
    this.locks.delete(entry.id);
    this.rebuildCollision();
    this.emit('layout', { op: 'remove', id: entry.id, by: player.id, entry: this.publicLayout(entry) });
    return { ok: true, id: entry.id };
  }

  /** 배치 가구가 차지한 셀 (테스트/디버그) */
  layoutCells(id) {
    const e = this.layout.get(Number(id));
    const item = e && this.shop.get(e.itemId);
    return item ? cellsOf(item.sprite, e.x, e.y, e.rotation || 0) : [];
  }

  /**
   * 구매: 카탈로그 확인 → 잔액 확인·차감(저장소가 원자적으로) → 원장 기록 → 인벤토리 저장.
   * @returns {{ ok: true, balance, item, inventory } | { ok: false, error: 'no_item' | 'insufficient', balance? }}
   */
  async purchase(player, itemId, variant, target) {
    const item = this.shop.get(itemId);
    if (!item) return { ok: false, error: 'no_item' };
    const v = pickVariant(item, variant);
    if (!v.ok) return { ok: false, error: v.error };
    let skill = null;
    if (item.category === 'petSkill') {
      if (target === undefined || target === null || target === '') return { ok: false, error: 'no_target' };
      skill = await this.skillTarget(player, item, target);
      if (!skill.ok) return skill;
    }
    // 차감도 같은 사람의 코인 큐에서 (동시에 들어오는 시간 코인과 balance 순서가 어긋나지 않게). 'coins' 는 차감 직후에 낸다
    const r = await this.coinTask(player.nickname, async () => {
      const res = await this.store.adjustCoins(player.nickname, -item.price, `purchase:${item.id}`, this.now());
      if (res.ok) this.emit('coins', { nickname: player.nickname, playerId: player.id, delta: -item.price, reason: `purchase:${item.id}`, balance: res.balance });
      return res;
    }, `-${item.price}, purchase:${item.id}`);
    if (!r) return { ok: false, error: 'store_error' };
    if (!r.ok) return { ok: false, error: r.error, balance: r.balance };
    const inv = await this.store.addInventory(player.nickname, item.id, { name: item.name, price: item.price, tab: item.tab, category: item.category, variant: v.variant, ...(skill ? { target: String(target) } : {}), ...item.meta }, this.now());
    if (skill) await skill.apply();
    return { ok: true, balance: r.balance, item, inventory: inv };
  }

  // ── 오늘 목표 / 랭킹 / 할 일 (영구 데이터) ──────────────────────────
  goalOf(nickname) {
    const g = this.goals.get(nickname);
    return g && g.date === this.today() ? g : null;
  }

  publicGoal(nickname) {
    const g = this.goalOf(nickname);
    return g ? { text: g.goalText || '', targetMinutes: g.targetMinutes || 0 } : null;
  }

  /** 목표 한 줄(≤20자) + 목표 시간(30분~8시간, 30분 단위). @returns {{ ok, goal, reached(이미 달성 상태인지) } | { ok: false, error }} */
  async setGoal(player, { text, targetMinutes } = {}) {
    const goalText = String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
    const mins = Number(targetMinutes);
    if (goalText.length > GOAL_TEXT_MAX) return { ok: false, error: 'text_too_long' };
    if (!Number.isInteger(mins) || mins < GOAL_MIN || mins > GOAL_MAX || mins % GOAL_STEP !== 0) return { ok: false, error: 'invalid_minutes' };
    const date = this.today();
    const g = await this.store.setGoal(player.nickname, date, { goalText, targetMinutes: mins });
    this.goals.set(player.nickname, { ...g, date });
    // 이미 넘어 있는 목표는 조용히 달성 처리(🎉 없음). reached 는 그 사실만 알려준다
    const reached = this.study.markGoal(player.nickname, true) || this.study.todaySeconds(player.nickname) >= mins * 60;
    return { ok: true, goal: this.publicGoal(player.nickname), reached };
  }

  /**
   * 내 기록 초기화(7단계): 공부 세션·출석·오늘 목표·할 일을 지우고 코인 이월 초를 0으로 (아바타·강아지 이름·코인 잔액·인벤토리는 유지).
   * 본인 확인: 세션 토큰 + 닉네임이 모두 일치해야 한다. 앉아서 공부 중이면 지금부터 새 세션을 센다.
   * @returns {{ ok: true, counts } | { ok: false, error: 'confirm_mismatch' }}
   */
  async resetProfile(player, { nickname, token } = {}) {
    if (typeof token !== 'string' || token !== player.token || nickname !== player.nickname) return { ok: false, error: 'confirm_mismatch' };
    this.study.reset(player.nickname);
    const counts = await this.store.resetUser(player.nickname);
    this.goals.delete(player.nickname);
    this.study.sync(player);
    this.log.log(`[world] 기록 초기화 ${player.nickname}: ${JSON.stringify(counts)}`);
    return { ok: true, counts };
  }

  /** 스터디 멤버 닉네임 (소속 기록 + 지금 접속 중). 스터디 없이 돌면 접속 중인 사람 */
  async memberNicknames() {
    const set = new Set(this.membersOf ? await this.membersOf() : []);
    for (const p of this.players.values()) set.add(p.nickname);
    return [...set];
  }

  /**
   * 랭킹: 공부 통계 + 코인(잔액 · 이번 주 획득). 코인 조회가 실패해도 공부 통계는 돌려준다.
   * 11단계: scope 'study' 면 이 스터디 멤버만, 'all'(기본) 이면 전체
   */
  async stats({ scope = 'all' } = {}) {
    const rows = await this.study.stats(scope === 'all' && this.allPlayers ? this.allPlayers() : [...this.players.values()]);
    let coinRows = [];
    try {
      coinRows = await this.store.coinStats({ tz: this.tz, now: this.now() });
    } catch (err) {
      this.log.warn(`[world] 코인 통계 실패: ${err.message}`);
    }
    const coins = new Map(coinRows.map((c) => [c.nickname, c]));
    const out = rows.map((r) => {
      const c = coins.get(r.nickname);
      return { ...r, coins: c ? c.coins : 0, weekCoins: c ? c.weekCoins : 0 };
    });
    for (const c of coinRows) if (!rows.some((r) => r.nickname === c.nickname) && c.weekCoins > 0) out.push({ nickname: c.nickname, todaySeconds: 0, weekSeconds: 0, streak: 0, weekDays: 0, live: false, online: false, coins: c.coins, weekCoins: c.weekCoins });
    if (scope === 'study') {
      const names = new Set(await this.memberNicknames());
      return { ok: true, store: this.store.kind, tz: this.tz, date: this.today(), scope, rows: out.filter((r) => names.has(r.nickname)) };
    }
    return { ok: true, store: this.store.kind, tz: this.tz, date: this.today(), scope: 'all', rows: out };
  }

  // ── 그룹 주간 목표 (11단계) ─────────────────────────────────────────
  /** 이번 주(월요일 기준) 멤버 전원 공부 합 { weekStart, totalSeconds, targetSeconds, reached, members } */
  async weeklyProgress() {
    const info = this.studyInfo();
    const week = weekStart(this.today());
    const members = await this.memberNicknames();
    const names = new Set(members);
    const rows = await this.study.stats([...this.players.values()]);
    let total = 0;
    for (const r of rows) if (names.has(r.nickname)) total += r.weekSeconds;
    const reached = this.weeklyReached === week || (info ? await this.store.weeklyGoalReached(this.scopeId, week) : false);
    if (reached) this.weeklyReached = week;
    return { weekStart: week, totalSeconds: total, targetSeconds: info ? info.weeklyGoalMinutes * 60 : 0, reached, members };
  }

  /**
   * 목표에 닿았는지 검사 (세션 저장 · 주기적 · 목표 변경 때). 주 1회: 달성 기록 + 멤버 전원 보너스 행을 남기고
   * 접속 중인 멤버에게 바로 10코인, 나머지는 다음 입장 때 (claimRewards). 달성했으면 'weeklyGoal' 이벤트
   */
  checkWeeklyGoal() {
    if (!this.studyInfo()) return Promise.resolve(null);
    if (this.weeklyChecking) return this.weeklyChecking;
    this.weeklyChecking = (async () => {
      const p = await this.weeklyProgress();
      if (p.reached || !p.targetSeconds || p.totalSeconds < p.targetSeconds) return null;
      const recorded = await this.store.recordWeeklyGoal(this.scopeId, p.weekStart, p.members, this.now());
      this.weeklyReached = p.weekStart;
      if (!recorded) return null;
      // 연출 이벤트를 먼저 (클라이언트 토스트 순서: 달성 → 코인), 그 다음 접속 중인 멤버에게 지급
      const members = new Set(p.members);
      const online = [...this.players.values()].filter((pl) => members.has(pl.nickname));
      const e = { weekStart: p.weekStart, totalSeconds: p.totalSeconds, targetSeconds: p.targetSeconds, bonus: WEEKLY_BONUS, awarded: online.map((pl) => pl.id) };
      this.emit('weeklyGoal', e);
      for (const pl of online) {
        const rows = await this.store.claimRewards(pl.nickname, this.now());
        for (let i = 0; i < rows.length; i++) await this.award(pl.nickname, pl.id, WEEKLY_BONUS, 'weekly_goal'); // 다른 스터디 몫이 남아 있었으면 같이
      }
      return e;
    })().catch((err) => { this.log.warn(`[world] 그룹 목표 검사 실패: ${err.message}`); return null; }).finally(() => { this.weeklyChecking = null; });
    return this.weeklyChecking;
  }

  todoOpts() {
    return { tz: this.tz, now: this.now() };
  }

  async listTodos(player) {
    return this.store.listTodos(player.nickname, this.todoOpts());
  }

  async addTodo(player, text) {
    const t = String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, TODO_MAX);
    if (!t) return { ok: false, error: 'empty' };
    return { ok: true, todo: await this.store.addTodo(player.nickname, t, this.now()) };
  }

  async setTodoDone(player, id, done) {
    const todo = await this.store.setTodoDone(player.nickname, id, Boolean(done), this.now());
    return todo ? { ok: true, todo } : { ok: false, error: 'not_found' };
  }

  async deleteTodo(player, id) {
    return { ok: await this.store.deleteTodo(player.nickname, id) };
  }

  /** 강아지 이름 변경 → 스터디의 'dog' 행 (+ 옛 users.dog_name 도 남긴다: 스터디 없이 돌 때의 복원용) */
  async setDogName(player, raw) {
    if (!this.dog) return { ok: false, error: 'no_npc' };
    const res = this.dog.setName(raw);
    if (!res.ok) return res;
    this.store.upsertUser(player.nickname, { dogName: res.name }).catch((err) => this.log.warn(`[world] 강아지 이름 저장 실패: ${err.message}`));
    try {
      await this.ensureDogRow();
      this.dogRow = (await this.store.updateRoomPet(this.scopeId, this.dogRow.id, { name: res.name })) || this.dogRow;
    } catch (err) {
      this.log.warn(`[world] 강아지 이름 저장 실패: ${err.message}`);
    }
    return res;
  }

  // ── 펫 (10단계) ──────────────────────────────────────────────────
  /** 서버 시작: 공용 펫과 강아지 설정 행 로드 */
  async loadPets() {
    const rows = await this.store.roomPets(this.scopeId);
    for (const row of rows) {
      if (row.itemId === 'dog') {
        this.dogRow = row;
        if (!this.dog) continue;
        this.dog.setCosmetics(row.cosmetics);
        for (const sk of row.skills || []) this.dog.addSkill(sk);
      } else if (this.shop.get(row.itemId)) this.spawnSharedPet(row);
    }
  }

  spawnSharedPet(row) {
    const item = this.shop.get(row.itemId);
    const species = item.species;
    const info = PET_SPECIES[species] || {};
    const id = `s:${row.id}`;
    const base = { id, species, name: row.name, cosmetics: row.cosmetics, skills: row.skills || [], now: this.now, random: this.npcOpts.random, tickMs: this.npcOpts.tickMs };
    const npc = species === 'fish' ? new FishNpc(this.room, base) : new SharedPetNpc(this.room, { ...base, home: info.home, spots: info.spots || [], speeds: info.sharedSpeed });
    if (species === 'fish') npc.setTank(row.tank || []); // 14단계: 낚시로 잡아 넣은 물고기
    npc.roomPetId = row.id;
    npc.releasedBy = row.releasedBy;
    this.roomPets.set(row.id, { row, npc });
    this.addNpc(npc);
    return npc;
  }

  sharedPetCount() {
    return this.roomPets.size;
  }

  // ── 14단계 C: 공용 펫 어항 · 도감 ────────────────────────────────────
  /** 이 방의 어항(공용 펫 물고기) */
  tankPet() {
    for (const e of this.roomPets.values()) if (e.npc.species === 'fish') return e;
    return null;
  }

  tankInfo() {
    const t = this.tankPet();
    return t ? { available: true, petId: t.row.id, fish: t.npc.tank.map((f) => ({ ...f })), max: TANK_MAX } : { available: false, fish: [], max: TANK_MAX };
  }

  /**
   * 잡은 물고기를 어항에 넣기/빼기 (같은 종은 하나만, 최대 TANK_MAX). 빼기는 넣은 사람만.
   * @returns {{ ok: true, tank } | { ok: false, error: 'no_tank' | 'no_fish' | 'not_caught' | 'tank_full' | 'already' | 'not_in_tank' | 'forbidden' }}
   */
  async setTank(player, fishId, on = true) {
    const t = this.tankPet();
    if (!t) return { ok: false, error: 'no_tank' };
    const fish = fishById(String(fishId || ''));
    if (!fish) return { ok: false, error: 'no_fish' };
    let tank = t.npc.tank.map((f) => ({ ...f }));
    if (on) {
      const caught = (await this.store.fishCodex(player.nickname)).some((r) => r.fishId === fish.id);
      if (!caught) return { ok: false, error: 'not_caught' };
      if (tank.some((f) => f.fishId === fish.id)) return { ok: false, error: 'already' };
      if (tank.length >= TANK_MAX) return { ok: false, error: 'tank_full' };
      tank.push({ fishId: fish.id, by: player.nickname, at: this.now() });
    } else {
      const cur = tank.find((f) => f.fishId === fish.id);
      if (!cur) return { ok: false, error: 'not_in_tank' };
      if (cur.by !== player.nickname) return { ok: false, error: 'forbidden' };
      tank = tank.filter((f) => f.fishId !== fish.id);
    }
    await this.store.setPetTank(t.row.id, tank);
    t.row.tank = tank;
    t.npc.setTank(tank);
    return { ok: true, tank: tank.map((f) => ({ ...f })) };
  }

  /** 도감: 물고기 10종(잡은 횟수·첫 포획, 못 잡은 종은 count 0) + 오늘 잡은 수 · 별자리 관측 기록. 어항 정보는 소켓이 붙인다 */
  async codex(player) {
    const [rows, views, today] = await Promise.all([this.store.fishCodex(player.nickname), this.store.constellationViews(player.nickname), this.store.fishCatchesToday(player.nickname, { tz: this.tz, now: this.now() })]);
    const by = new Map(rows.map((r) => [r.fishId, r]));
    const fish = FISH.map((f) => { const r = by.get(f.id); return { id: f.id, name: f.name, rarity: f.rarity, emoji: f.emoji, desc: f.desc, count: r ? r.count : 0, firstAt: r ? r.firstAt : null }; });
    const constellations = views.map((v) => { const c = constellationById(v.constId); return c ? { id: c.id, name: c.name, desc: c.desc, real: c.real, seenAt: v.seenAt } : null; }).filter(Boolean).sort((a, b) => b.seenAt - a.seenAt);
    return { ok: true, fish, caughtSpecies: rows.length, catchesToday: today, catchLimit: CATCH_PER_DAY, constellations, constellationsTotal: CONSTELLATIONS.length };
  }

  /** 개인 펫 설정 형태 보정 */
  petConfigOf(player) {
    const c = player.petConfig && typeof player.petConfig === 'object' ? player.petConfig : {};
    return { active: c.active ?? null, pets: c.pets && typeof c.pets === 'object' ? c.pets : {} };
  }

  /** 꾸미기 슬롯 { head, neck, back }: 값은 내 인벤토리의 petDeco inventoryId | null → { inventoryId, itemId, variant } | null */
  async resolveCosmetics(nickname, slots) {
    const out = { head: null, neck: null, back: null };
    if (!slots || typeof slots !== 'object') return { ok: true, cosmetics: out };
    const ids = PET_SLOTS.map((k) => slots[k]).filter((v) => v !== null && v !== undefined);
    const inv = ids.length ? await this.store.listInventory(nickname) : [];
    for (const slot of PET_SLOTS) {
      const id = slots[slot];
      if (id === null || id === undefined) continue;
      const row = inv.find((r) => r.id === Number(id));
      const item = row && this.shop.get(row.itemId);
      if (!item || item.category !== 'petDeco') return { ok: false, error: 'no_item' };
      if (item.slot !== slot) return { ok: false, error: 'wrong_slot' };
      out[slot] = { inventoryId: row.id, itemId: item.id, variant: row.meta.variant || null };
    }
    return { ok: true, cosmetics: out };
  }

  followerOf(player) {
    return this.npcs.find((n) => n.id === `p:${player.id}`) || null;
  }

  /** 활성 개인 펫에 맞춰 FollowerNpc 를 만들거나 지운다 (입장·설정 변경 때) */
  async syncFollower(player) {
    const cfg = this.petConfigOf(player);
    const cur = this.followerOf(player);
    let row = null;
    if (cfg.active !== null) {
      row = await this.store.getInventoryItem(player.nickname, cfg.active);
      const item = row && this.shop.get(row.itemId);
      if (!item || item.category !== 'pet') row = null;
    }
    if (!row) {
      if (cur) this.removeNpc(cur.id);
      return null;
    }
    const item = this.shop.get(row.itemId);
    const pc = cfg.pets[row.id] || {};
    if (cur && cur.inventoryId === row.id) {
      // 같은 펫: 이름·꾸미기·스킬만 갱신
      if (pc.name && pc.name !== cur.name) { cur.name = pc.name; cur.dirty = true; }
      cur.setCosmetics(pc.cosmetics || {});
      for (const sk of pc.skills || []) cur.addSkill(sk);
      return cur;
    }
    if (cur) this.removeNpc(cur.id);
    const npc = new FollowerNpc(this.room, player, { id: `p:${player.id}`, species: item.species, name: pc.name || item.name, cosmetics: pc.cosmetics || {}, skills: pc.skills || [], now: this.now, random: this.npcOpts.random, tickMs: this.npcOpts.tickMs });
    npc.inventoryId = row.id;
    this.addNpc(npc);
    return npc;
  }

  /**
   * 내 펫 설정: { active?: inventoryId|null, petId?: inventoryId, name?, cosmetics?: { head, neck, back } }
   * petId(기본: active) 의 이름·꾸미기를 바꾼다. active 를 바꾸면 따라다니는 펫이 바뀐다.
   * @returns {{ ok: true, petConfig, pet } | { ok: false, error: 'no_item' | 'not_pet' | 'invalid_name' | 'wrong_slot' }}
   */
  async setPetConfig(player, { active, petId, name, cosmetics } = {}) {
    const cfg = this.petConfigOf(player);
    if (active !== undefined) {
      if (active === null) cfg.active = null;
      else {
        const row = await this.store.getInventoryItem(player.nickname, active);
        const item = row && this.shop.get(row.itemId);
        if (!row) return { ok: false, error: 'no_item' };
        if (item.category !== 'pet') return { ok: false, error: 'not_pet' };
        cfg.active = row.id;
      }
    }
    const target = petId !== undefined && petId !== null ? Number(petId) : cfg.active;
    if (target !== null && (name !== undefined || cosmetics !== undefined)) {
      const row = await this.store.getInventoryItem(player.nickname, target);
      const item = row && this.shop.get(row.itemId);
      if (!item || item.category !== 'pet') return { ok: false, error: 'no_item' };
      const pc = cfg.pets[row.id] || { name: item.name, cosmetics: {}, skills: [] };
      if (name !== undefined) {
        const n = normalizeNickname(name);
        if (!n.ok || [...n.name].length > PET_NAME_MAX) return { ok: false, error: 'invalid_name' };
        pc.name = n.name;
      }
      if (cosmetics !== undefined) {
        const r = await this.resolveCosmetics(player.nickname, cosmetics);
        if (!r.ok) return r;
        pc.cosmetics = r.cosmetics;
      }
      cfg.pets[row.id] = pc;
    }
    player.petConfig = cfg;
    await this.store.upsertUser(player.nickname, { petConfig: cfg });
    const npc = await this.syncFollower(player);
    return { ok: true, petConfig: cfg, pet: npc ? npc.snapshot() : null };
  }

  npcOwnerCheck(player, npc) {
    if (npc.id === 'dog') return true; // 강아지는 누구나
    if (npc.roomPetId !== undefined) return npc.releasedBy === player.nickname;
    if (npc.ownerId !== undefined && npc.ownerId !== null) return npc.ownerId === player.id;
    return false;
  }

  /** NPC 이름 변경: 강아지(누구나, users.dog_name) · 공용 펫(푼 사람) · 개인 펫(주인) */
  async setNpcName(player, npcId, raw) {
    const npc = this.npcById(npcId);
    if (!npc) return { ok: false, error: 'no_npc' };
    if (npc.id === 'dog') return this.setDogName(player, raw);
    if (!this.npcOwnerCheck(player, npc)) return { ok: false, error: 'forbidden' };
    const res = npc.setName(raw);
    if (!res.ok) return res;
    if (npc.roomPetId !== undefined) await this.store.updateRoomPet(this.scopeId, npc.roomPetId, { name: res.name });
    else {
      const cfg = this.petConfigOf(player);
      cfg.pets[npc.inventoryId] = { ...(cfg.pets[npc.inventoryId] || { cosmetics: {}, skills: [] }), name: res.name };
      player.petConfig = cfg;
      await this.store.upsertUser(player.nickname, { petConfig: cfg });
    }
    return res;
  }

  /** 강아지 설정 행 (없으면 만든다) */
  async ensureDogRow() {
    if (!this.dogRow) this.dogRow = await this.store.addRoomPet(this.scopeId, { itemId: 'dog', name: this.dog ? this.dog.name : '', releasedBy: null, roomId: this.roomId }, this.now());
    return this.dogRow;
  }

  /** 꾸미기 장착: 강아지(누구나) · 공용 펫(푼 사람) · 개인 펫(주인). slots 값은 내 인벤토리 inventoryId */
  async setPetDeco(player, npcId, slots) {
    const npc = this.npcById(npcId);
    if (!npc) return { ok: false, error: 'no_npc' };
    if (!this.npcOwnerCheck(player, npc)) return { ok: false, error: 'forbidden' };
    if (npc.ownerId) return this.setPetConfig(player, { petId: npc.inventoryId, cosmetics: slots });
    const r = await this.resolveCosmetics(player.nickname, slots);
    if (!r.ok) return r;
    npc.setCosmetics(r.cosmetics);
    if (npc.id === 'dog') {
      await this.ensureDogRow();
      this.dogRow = (await this.store.updateRoomPet(this.scopeId, this.dogRow.id, { cosmetics: r.cosmetics })) || this.dogRow;
    } else {
      const rp = this.roomPets.get(npc.roomPetId);
      if (rp) rp.row = (await this.store.updateRoomPet(this.scopeId, npc.roomPetId, { cosmetics: r.cosmetics })) || rp.row;
    }
    return { ok: true, cosmetics: npc.publicCosmetics() };
  }

  /** 공용 펫 방에 풀기 (지갑에서). @returns {{ ok, pet } | { ok:false, error: no_item | not_shared_pet | already_released | room_full | invalid_name }} */
  async releasePet(player, { inventoryId, name } = {}) {
    const row = await this.store.getInventoryItem(player.nickname, inventoryId);
    const item = row && this.shop.get(row.itemId);
    if (!row) return { ok: false, error: 'no_item' };
    if (item.category !== 'sharedPet') return { ok: false, error: 'not_shared_pet' };
    if ([...this.roomPets.values()].some((p) => p.row.inventoryId === row.id)) return { ok: false, error: 'already_released' };
    if (this.sharedPetCount() >= MAX_SHARED_PETS) return { ok: false, error: 'room_full' };
    let petName = item.name.replace(/\s*\(.*\)$/, '');
    if (name !== undefined && name !== null && name !== '') {
      const n = normalizeNickname(name);
      if (!n.ok || [...n.name].length > PET_NAME_MAX) return { ok: false, error: 'invalid_name' };
      petName = n.name;
    }
    const saved = await this.store.addRoomPet(this.scopeId, { itemId: item.id, inventoryId: row.id, name: petName, releasedBy: player.nickname, roomId: this.roomId }, this.now());
    const npc = this.spawnSharedPet(saved);
    return { ok: true, pet: npc.snapshot(), roomPetId: saved.id };
  }

  /** 공용 펫 회수 (푼 사람만) */
  async recallPet(player, id) {
    const rp = this.roomPets.get(Number(id));
    if (!rp) return { ok: false, error: 'not_found' };
    if (rp.row.releasedBy !== player.nickname) return { ok: false, error: 'forbidden' };
    await this.store.removeRoomPet(this.scopeId, rp.row.id);
    this.roomPets.delete(rp.row.id);
    this.removeNpc(rp.npc.id);
    return { ok: true, id: rp.row.id };
  }

  /** 스킬 구매 대상 검증: 'dog' | 's:<roomPetId>' | inventoryId(내 개인 펫). @returns {{ ok, apply(): Promise }} */
  async skillTarget(player, item, target) {
    if (target === 'dog') {
      if (!this.dog) return { ok: false, error: 'no_target' };
      if (this.dog.skills.has(item.skill)) return { ok: false, error: 'already_has' };
      return { ok: true, apply: async () => { await this.ensureDogRow(); const skills = [...new Set([...(this.dogRow.skills || []), item.skill])]; this.dogRow = (await this.store.updateRoomPet(this.scopeId, this.dogRow.id, { skills })) || this.dogRow; this.dog.addSkill(item.skill); } };
    }
    if (typeof target === 'string' && target.startsWith('s:')) {
      const rp = this.roomPets.get(Number(target.slice(2)));
      if (!rp) return { ok: false, error: 'no_target' };
      if (rp.npc.skills.has(item.skill)) return { ok: false, error: 'already_has' };
      return { ok: true, apply: async () => { const skills = [...new Set([...(rp.row.skills || []), item.skill])]; rp.row = (await this.store.updateRoomPet(this.scopeId, rp.row.id, { skills })) || rp.row; rp.npc.addSkill(item.skill); } };
    }
    const row = await this.store.getInventoryItem(player.nickname, target);
    const pi = row && this.shop.get(row.itemId);
    if (!pi || pi.category !== 'pet') return { ok: false, error: 'no_target' };
    const cfg = this.petConfigOf(player);
    const pc = cfg.pets[row.id] || { name: pi.name, cosmetics: {}, skills: [] };
    if ((pc.skills || []).includes(item.skill)) return { ok: false, error: 'already_has' };
    return { ok: true, apply: async () => { pc.skills = [...new Set([...(pc.skills || []), item.skill])]; cfg.pets[row.id] = pc; player.petConfig = cfg; await this.store.upsertUser(player.nickname, { petConfig: cfg }); await this.syncFollower(player); } };
  }

  /** 채팅에 펫 이름이 들어 있으면 'come' 스킬이 있는 펫이 달려온다 (개인 펫은 주인이 부를 때만) */
  onChat(player, text) {
    const called = [];
    for (const n of this.npcs) {
      if (!n.skills.has('come') || !n.name || !text.includes(n.name)) continue;
      if (n.ownerId && n.ownerId !== player.id) continue;
      if (n.comeTo(player)) called.push(n.id);
    }
    return called;
  }

  /** 지갑용 펫 정보: 강아지 · 공용 펫 목록 · 내 설정 */
  petSummary(player) {
    const npcInfo = (n, extra = {}) => ({ id: n.id, species: n.species, name: n.name, cosmetics: n.cosmetics, skills: [...n.skills], ...extra });
    return {
      dog: this.dog ? npcInfo(this.dog) : null,
      shared: [...this.roomPets.values()].map(({ row, npc }) => npcInfo(npc, { roomPetId: row.id, itemId: row.itemId, releasedBy: row.releasedBy, mine: row.releasedBy === player.nickname })),
      config: this.petConfigOf(player),
      maxShared: MAX_SHARED_PETS,
    };
  }

  /** 플레이어 위치가 유효한지 (테스트/디버그용) */
  canStand(x, y) {
    return canStand(this.room, x, y);
  }

  /** 종료: 진행 중인 공부 세션을 모두 저장한 뒤 정리 (SIGTERM 에서 await). 공유 트래커면 내 스터디 사람들의 세션만 끝낸다 */
  async dispose() {
    for (const t of this.graceTimers.values()) clearTimeout(t);
    this.graceTimers.clear();
    for (const p of this.pomodoros.values()) p.dispose();
    this.pomodoros.clear();
    for (const n of this.npcs) n.dispose();
    if (this.ownsStudy) await this.study.flushAll('shutdown');
    else {
      await Promise.all([...this.players.values()].map((p) => this.study.end(p.nickname, 'shutdown')));
      for (const [ev, fn] of Object.entries(this.studyListeners)) this.study.off(ev, fn);
    }
    await Promise.all([...this.pendingAwards]); // flushAll 이 저장한 세션의 코인까지
  }
}

module.exports = { World, GRACE_MS, SIT_RANGE_PX, EMOJIS, STATUSES, MANUAL_STATUSES, LISTENING_MAX, GOAL_TEXT_MAX, GOAL_MIN, GOAL_MAX, GOAL_STEP, TODO_MAX, LOCK_MS, DESK_SLOTS, RESTING_SEATS, MAX_SHARED_PETS, PET_NAME_MAX, WEEKLY_BONUS, TANK_MAX, seatCenter };
