'use strict';
/**
 * 공용 야외 월드 (12단계). World 를 outdoor 모드로 만들고 탈것·트랙·프로필을 얹는다.
 *  - 소환/해제: mount() — 설정(users.vehicle_config.active)의 활성 탈것(내 인벤토리)을 확인하고 player.vehicle 을 만든다. 앉아 있으면 불가.
 *    어디서든 가능 (정류장 필요 없음). 데칼·경적도 설정에서 읽는다. 'vehicle' 이벤트 → 소켓이 playerVehicle 로 방송.
 *  - 이동: World.move 가 vehicles.js 로 { type, angle, speed } 를 검증하고 종류별 최고 속도로 예산을 센다. 그 뒤 afterMove 가 랩을 판정한다.
 *  - 랩: track.js — 출발선 정방향 통과 → 체크포인트 순서대로 → 다시 출발선. 'lap' 이벤트 { player, event, ms?, next, total } (본인 HUD 용).
 *    완주하면 completeLap(): track_records 저장 · 개인 최고 갱신 · 하루 첫 완주 +1 코인('lap') · 'lapDone' { player, ms, best, isBest, reward } +
 *    'board' (전광판 갱신 신호).
 *  - 전광판: board() — 오늘 상위 5 · 역대 상위 5 (닉네임·스터디 이름·차종). 스터디 이름은 studyNameOf(id) (Hub 가 준다).
 *  - 프로필: profile(viewer, targetId) — 닉네임·스터디 이름·이번 주 공부 시간(대상이 공개했을 때만).
 *  - 경적: horn(player) → 'horn' { player, horn } (탑승 중 + 경적 설정이 있을 때만).
 *  - 18단계: 매점 점원 NPC(HumanNpc 'clerk', room.zoo.clerk 자리) — 창구 앞에 서면 "어서 오세요!", 구매하면 "맛있게 드세요 🍦". 이름은 서버 전역 설정 settings.clerk_name
 *    (방장이 바꾼다, Hub.setClerkName). 매점은 상호작용 지점 하나('snack')에서 메뉴 4종(zoo.snacks) 중 고른다. 산책 강아지는 World.spawnWalkDog 가 이 월드에 만든다.
 */
const { World } = require('./world');
const { typeOf, colorOf } = require('./vehicles');
const { newLapState, advance } = require('./track');
const { createOutdoorAnimals } = require('./animals');
const { HumanNpc } = require('./npc');
const { interactableById } = require('../rooms/build');
const { dateKey } = require('../store/stats');
const Fishing = require('./fishing');
const Sky = require('./constellations');

const LAP_REWARD = 1; // 하루 첫 완주 코인
const LAP_MIN_MS = 3000; // 이보다 빠른 랩은 이상(순간이동 등)으로 보고 기록하지 않는다
const FEED_PER_DAY = 3; // 14단계: 먹이 주기 하루 횟수 (사람마다, STATS_TZ 기준)
const SNACK_MS = 5 * 60 * 1000; // 매점 간식을 손에 들고 있는 시간
const PHOTO_COOLDOWN_MS = 20 * 1000; // 같은 두 사람의 포토존 플래시 간격
const FISHING_TICK_MS = 100; // 낚시 세션 진행 주기
const CLERK_DEFAULT = '사장님'; // 18단계

class OutdoorWorld extends World {
  /** opts.studyNameOf(studyId) → 이름 | null (전광판·프로필) */
  constructor(room, { studyNameOf = () => null, ...opts } = {}) {
    super(room, { ...opts, outdoor: true, studyId: null });
    this.studyNameOf = studyNameOf;
    this.laps = new Map(); // playerId → LapState
    this.track = room.track || null;
    // 14단계 B: 동물원 우리 동물 + 자유 동물 (room.zoo / room.animals). 먹이 횟수는 메모리(서버 재시작 시 초기화)
    this.zoo = room.zoo || null;
    this.feeds = new Map(); // `${nickname}|${date}` → 오늘 준 횟수
    this.photoAt = new Map(); // 두 사람 id 쌍 → 마지막 플래시 시각
    for (const n of createOutdoorAnimals(this.room, { now: this.now, random: this.npcOpts.random, tickMs: this.npcOpts.tickMs })) this.addAnimal(n);
    // 18단계: 매점 점원 (창구 뒤). 이름은 저장소 설정에서 (비동기 — 로드 전엔 기본 이름)
    this.clerk = null;
    if (this.zoo && this.zoo.clerk) {
      const c = this.zoo.clerk;
      this.clerk = new HumanNpc(this.room, { ...this.npcOpts, id: 'clerk', char: 'clerk', name: CLERK_DEFAULT, x: c.x, y: c.y, facing: 'down', greet: c.greet, greeting: '어서 오세요!' });
      this.addNpc(this.clerk);
      this.clerkLoaded = this.store.getSetting('clerk_name').then((v) => { if (v && typeof v === 'string' && this.clerk) this.clerk.setName(v); }).catch((err) => this.log.warn(`[outdoor] 점원 이름 로드 실패: ${err.message}`));
    }
    // 14단계 C: 낚시 세션 (playerId → session). npc.autoStart === false 면 테스트가 tickFishing(now) 를 직접 부른다
    this.fishing = new Map();
    this.random = this.npcOpts.random || Math.random;
    this.fishingTimer = null;
    if (this.npcOpts.autoStart !== false) {
      this.fishingTimer = setInterval(() => this.tickFishing(this.now()), FISHING_TICK_MS);
      this.fishingTimer.unref?.();
    }
  }

  // ── 낚시 (14단계 C) ──────────────────────────────────────────────────
  /** 공개용 낚시 상태 { state: 'wait'|'bite', spot } | null */
  publicFishing(p) {
    const s = this.fishing.get(p.id);
    return s && s.state !== 'done' ? { state: s.state, spot: s.spot } : null;
  }

  /**
   * 낚싯대 던지기 (자리 앞에서 E). 하루 CATCH_PER_DAY 마리까지.
   * @returns {{ ok: true, state: 'wait', spot, left } | { ok: false, error: 'no_spot' | 'too_far' | 'seated' | 'riding' | 'already' | 'limit' }}
   */
  async cast(player, spotId) {
    const it = interactableById(this.room, `fish:${String(spotId ?? '')}`);
    if (!it || it.kind !== 'fish') return { ok: false, error: 'no_spot' };
    if (Math.hypot(it.x - player.x, it.y - player.y) > it.range) return { ok: false, error: 'too_far' };
    if (player.seatId) return { ok: false, error: 'seated' };
    if (player.vehicle) return { ok: false, error: 'riding' };
    if (this.fishing.has(player.id)) return { ok: false, error: 'already' };
    const today = await this.store.fishCatchesToday(player.nickname, { tz: this.tz, now: this.now() });
    if (today >= Fishing.CATCH_PER_DAY) return { ok: false, error: 'limit', left: 0 };
    if (this.fishing.has(player.id) || player.removed) return { ok: false, error: 'already' };
    const s = Fishing.newSession(String(spotId), this.now(), this.random);
    this.fishing.set(player.id, s);
    player.fishing = this.publicFishing(player);
    this.emit('fishing', { player, state: 'wait' });
    return { ok: true, state: 'wait', spot: s.spot, left: Fishing.CATCH_PER_DAY - today, biteIn: s.biteAt - this.now() };
  }

  /** 세션 진행: 입질 시작 → 'fishing' { state: 'bite' } · 창이 지나면 실패 */
  tickFishing(now = this.now()) {
    for (const [id, s] of this.fishing) {
      const player = this.players.get(id);
      if (!player) { this.fishing.delete(id); continue; }
      const r = Fishing.tickSession(s, now);
      if (r === 'bite') { player.fishing = this.publicFishing(player); this.emit('fishing', { player, state: 'bite' }); }
      else if (r === 'miss') this.endFishing(player, { ok: false, reason: 'miss' });
    }
  }

  endFishing(player, result = null) {
    if (!this.fishing.has(player.id)) return;
    this.fishing.delete(player.id);
    player.fishing = null;
    this.emit('fishing', { player, state: null, result });
  }

  /**
   * 낚아채기 (입질 순간 E). 창 안이면 종을 뽑아 저장.
   * @returns {{ ok: true, fish, rare, left } | { ok: false, error: 'not_fishing' | 'early' | 'late' }}
   */
  async reel(player) {
    const s = this.fishing.get(player.id);
    if (!s) return { ok: false, error: 'not_fishing' };
    const now = this.now();
    if (!Fishing.reelOk(s, now)) {
      const error = s.state === 'wait' ? 'early' : 'late';
      this.endFishing(player, { ok: false, reason: error });
      return { ok: false, error };
    }
    const fish = Fishing.roll(this.random);
    this.endFishing(player, { ok: true, fish: fish.id });
    let rec = null;
    try { rec = await this.store.addFishCatch({ nickname: player.nickname, fishId: fish.id }, now); } catch (err) { this.log.warn(`[outdoor] 낚시 저장 실패 (${player.nickname}): ${err.message}`); }
    const today = await this.store.fishCatchesToday(player.nickname, { tz: this.tz, now }).catch(() => 0);
    const pub = { id: fish.id, name: fish.name, rarity: fish.rarity, emoji: fish.emoji };
    this.emit('fishCaught', { player, fish: pub, rare: fish.rarity === 'rare', record: rec });
    return { ok: true, fish: pub, rare: fish.rarity === 'rare', left: Math.max(0, Fishing.CATCH_PER_DAY - today) };
  }

  // ── 별자리 (14단계 C) ───────────────────────────────────────────────
  /**
   * 전망대 망원경 앞 E: 밤(19~06시, tz)이면 오늘의 별자리를 돌려주고 관측 기록.
   * @returns {{ ok: true, constellation, index, first } | { ok: false, error: 'too_far' | 'daytime', hour }}
   */
  async viewSky(player) {
    const it = interactableById(this.room, 'telescope');
    if (!it || Math.hypot(it.x - player.x, it.y - player.y) > it.range) return { ok: false, error: 'too_far' };
    const now = this.now();
    if (!Sky.isNight(now, this.tz)) return { ok: false, error: 'daytime', hour: Math.round(Sky.hourOf(now, this.tz) * 10) / 10 };
    const c = Sky.todays(now, this.tz);
    let first = false;
    try { first = (await this.store.addConstellationView(player.nickname, c.id, now)).inserted; } catch (err) { this.log.warn(`[outdoor] 별자리 저장 실패 (${player.nickname}): ${err.message}`); }
    return { ok: true, constellation: Sky.publicOf(c), index: Sky.indexFor(now, this.tz), first };
  }

  publicPlayer(p) {
    return { ...super.publicPlayer(p), snack: this.publicSnack(p), fishing: this.publicFishing(p) };
  }

  detach(player, reason) {
    this.endFishing(player);
    this.laps.delete(player.id);
    return super.detach(player, reason);
  }

  async dispose() {
    clearInterval(this.fishingTimer);
    this.fishingTimer = null;
    return super.dispose();
  }

  // ── 동물원 (14단계 B) ────────────────────────────────────────────────
  addAnimal(n) {
    this.addNpc(n);
    n.on('react', ({ reaction }) => this.emit('npcReact', { npc: n.id, reaction }));
    return n;
  }

  animalsOf(enclosureId) {
    return this.npcs.filter((n) => n.enclosure === enclosureId);
  }

  enclosureOf(id) {
    return this.zoo ? this.zoo.enclosures.find((e) => e.id === id) || null : null;
  }

  feedsLeft(player) {
    return Math.max(0, FEED_PER_DAY - (this.feeds.get(`${player.nickname}|${this.today()}`) || 0));
  }

  /**
   * 먹이 주기: 우리 앞 지점에서, 하루 FEED_PER_DAY 번. 먹고 있지 않은 동물 하나가 다가와 먹는다.
   * @returns {{ ok: true, left, animal, enclosure } | { ok: false, error: 'no_enclosure' | 'too_far' | 'riding' | 'seated' | 'limit' | 'busy', left? }}
   */
  feed(player, id) {
    const enclosure = this.enclosureOf(String(id || ''));
    const it = enclosure && interactableById(this.room, `feed:${enclosure.id}`);
    if (!enclosure || !it) return { ok: false, error: 'no_enclosure' };
    if (Math.hypot(it.x - player.x, it.y - player.y) > it.range) return { ok: false, error: 'too_far' };
    if (player.vehicle) return { ok: false, error: 'riding' };
    if (player.seatId) return { ok: false, error: 'seated' };
    const key = `${player.nickname}|${this.today()}`;
    const used = this.feeds.get(key) || 0;
    if (used >= FEED_PER_DAY) return { ok: false, error: 'limit', left: 0 };
    const free = this.animalsOf(enclosure.id).filter((n) => !n.feeding);
    if (!free.length) return { ok: false, error: 'busy', left: FEED_PER_DAY - used };
    const fx = (enclosure.feedTile.x + 0.5) * this.room.tileSize;
    const fy = (enclosure.feedTile.y + 1) * this.room.tileSize;
    free.sort((a, b) => Math.hypot(a.x - fx, a.y - fy) - Math.hypot(b.x - fx, b.y - fy));
    const animal = free[0];
    animal.feed();
    this.feeds.set(key, used + 1);
    this.emit('zooFeed', { player, enclosure, animal });
    return { ok: true, left: FEED_PER_DAY - used - 1, animal: animal.id, enclosure: { id: enclosure.id, name: enclosure.name } };
  }

  /** 손에 든 간식 (만료되면 null) */
  publicSnack(p) {
    if (!p.snack || p.snack.until <= this.now()) return null;
    return { item: p.snack.item, emoji: p.snack.emoji, until: p.snack.until };
  }

  /**
   * 매점 (18단계: 창구 하나에서 메뉴 4종): 1코인에 아이스크림·츄러스·핫도그·레모네이드 → 5분 동안 손에 든 아이콘. 점원이 "맛있게 드세요".
   * @returns {{ ok: true, snack, balance, menu } | { ok: false, error: 'no_item' | 'too_far' | 'insufficient' }}
   */
  async snack(player, item) {
    const def = this.zoo && this.zoo.snacks.find((s) => s.id === item);
    const it = interactableById(this.room, 'snack');
    if (!def || !it) return { ok: false, error: 'no_item' };
    if (Math.hypot(it.x - player.x, it.y - player.y) > it.range) return { ok: false, error: 'too_far' };
    const r = await this.award(player.nickname, player.id, -def.price, `purchase:snack_${def.id}`);
    if (!r) return { ok: false, error: 'insufficient' };
    player.snack = { item: def.id, emoji: def.emoji, until: this.now() + SNACK_MS };
    this.emit('snack', { player });
    if (this.clerk) this.clerk.thank(`맛있게 드세요 ${def.emoji}`);
    return { ok: true, snack: this.publicSnack(player), balance: r.balance, menu: this.zoo.snacks };
  }

  /** 매점 메뉴 (모달용) */
  snackMenu() {
    return { ok: true, menu: this.zoo ? this.zoo.snacks : [], clerk: this.clerk ? this.clerk.name : null };
  }

  /** 18단계: 점원 이름 (권한은 Hub 가 확인한다). settings.clerk_name */
  async setClerkName(raw) {
    if (!this.clerk) return { ok: false, error: 'no_npc' };
    const res = this.clerk.setName(raw);
    if (!res.ok) return res;
    try { await this.store.setSetting('clerk_name', res.name); } catch (err) { this.log.warn(`[outdoor] 점원 이름 저장 실패: ${err.message}`); }
    return res;
  }

  /** 포토존: 두 사람이 발자국 두 칸에 같이 서면 플래시 (같은 쌍은 PHOTO_COOLDOWN_MS 에 한 번) */
  checkPhoto(player) {
    const z = this.zoo && this.zoo.photo;
    if (!z) return;
    const T = this.room.tileSize;
    const inZone = (p) => { const tx = Math.floor(p.x / T); const ty = Math.floor((p.y - 1) / T); return tx >= z.x0 && tx <= z.x1 && ty >= z.y0 && ty <= z.y1; };
    if (!inZone(player)) return;
    const now = this.now();
    for (const other of this.players.values()) {
      if (other === player || !other.connected || !inZone(other)) continue;
      const key = [player.id, other.id].sort().join('|');
      if (now - (this.photoAt.get(key) || -Infinity) < PHOTO_COOLDOWN_MS) continue;
      this.photoAt.set(key, now);
      this.emit('photo', { players: [player, other] });
    }
  }

  lapOf(player) {
    let s = this.laps.get(player.id);
    if (!s) { s = newLapState(); this.laps.set(player.id, s); }
    return s;
  }

  // ── 탈것 ──────────────────────────────────────────────────────────
  /**
   * 소환 (활성 탈것). @returns {{ ok: true, vehicle } | { ok: false, error: 'seated' | 'already_riding' | 'no_vehicle' | 'no_item' }}
   */
  async mount(player) {
    if (player.seatId) return { ok: false, error: 'seated' };
    if (player.vehicle) return { ok: false, error: 'already_riding' };
    const cfg = this.vehicleConfigOf(player);
    if (cfg.active === null) return { ok: false, error: 'no_vehicle' };
    const inv = await this.store.listInventory(player.nickname);
    const row = inv.find((r) => r.id === cfg.active);
    const item = row && this.shop.get(row.itemId);
    if (!item || item.category !== 'vehicle' || !typeOf(item.vehicle)) return { ok: false, error: 'no_item' };
    const decalRow = cfg.decal !== null ? inv.find((r) => r.id === cfg.decal) : null;
    const hornRow = cfg.horn !== null ? inv.find((r) => r.id === cfg.horn) : null;
    const decalItem = decalRow && this.shop.get(decalRow.itemId);
    const hornItem = hornRow && this.shop.get(hornRow.itemId);
    player.vehicle = {
      type: item.vehicle,
      color: colorOf(item.vehicle, row.meta && row.meta.variant),
      decal: decalItem && decalItem.category === 'vehicleDecal' ? decalItem.decal : null,
      horn: hornItem && hornItem.category === 'vehicleHorn' ? hornItem.horn : null,
      inventoryId: row.id,
      angle: player.facing === 'left' ? Math.PI : player.facing === 'up' ? -Math.PI / 2 : player.facing === 'right' ? 0 : Math.PI / 2,
      speed: 0,
    };
    player.budget = 0; // 탑승 순간부터 새 예산
    player.lastMoveAt = this.now();
    this.lapOf(player).startedAt = null;
    this.emit('vehicle', { player });
    return { ok: true, vehicle: this.publicVehicle(player) };
  }

  dismount(player) {
    const r = super.dismount(player);
    if (r.ok) {
      const s = this.lapOf(player);
      s.startedAt = null;
      s.next = 0;
      player.budget = 0;
      player.lastMoveAt = this.now();
      this.emit('lap', { player, event: 'reset', next: 0, total: this.track ? this.track.checkpoints.length : 0 });
    }
    return r;
  }

  /** 경적: 탑승 중 + 설정된 경적이 있을 때만 */
  horn(player) {
    if (!player.vehicle) return { ok: false, error: 'not_riding' };
    if (!player.vehicle.horn) return { ok: false, error: 'no_horn' };
    this.emit('horn', { player, horn: player.vehicle.horn });
    return { ok: true, horn: player.vehicle.horn };
  }

  // ── 랩 ────────────────────────────────────────────────────────────
  afterMove(player, from) {
    if (this.fishing.has(player.id) && Math.hypot(player.x - from.x, player.y - from.y) > 2) this.endFishing(player, { ok: false, reason: 'moved' });
    this.checkPhoto(player);
    if (!this.track || !player.vehicle) return;
    const state = this.lapOf(player);
    const r = advance(this.track, state, from, { x: player.x, y: player.y }, this.now());
    if (!r) return;
    this.emit('lap', { player, ...r });
    if (r.event === 'lap') this.completeLap(player, r.ms);
  }

  /** 완주 저장 (순서: 기록 → 최고 갱신 여부 → 하루 첫 완주 보상). 저장소 오류는 로그만 */
  completeLap(player, ms) {
    if (!(ms >= LAP_MIN_MS)) return null;
    const p = (async () => {
      const prev = await this.store.trackBest(player.nickname);
      const first = !(await this.store.hasLapToday(player.nickname, { tz: this.tz, now: this.now() }));
      const rec = await this.store.addTrackRecord({ nickname: player.nickname, studyId: player.homeStudy ? player.homeStudy.id : null, vehicle: player.vehicle ? player.vehicle.type : 'unknown', ms }, this.now());
      const isBest = !prev || ms < prev.ms;
      const best = isBest ? ms : prev.ms;
      const e = { player, ms, best, isBest, reward: first ? LAP_REWARD : 0, record: rec };
      this.emit('lapDone', e);
      if (first) await this.award(player.nickname, player.id, LAP_REWARD, 'lap');
      this.emit('board');
      return e;
    })().catch((err) => { this.log.warn(`[outdoor] 랩 저장 실패 (${player.nickname}): ${err.message}`); return null; });
    this.pendingAwards.add(p);
    p.finally(() => this.pendingAwards.delete(p));
    return p;
  }

  /** 전광판: 오늘 상위 5 · 역대 상위 5 + (viewer 가 있으면) 내 최고 */
  async board(viewer = null) {
    const opts = { tz: this.tz, now: this.now(), limit: 5 };
    const [today, all, myBest] = await Promise.all([
      this.store.trackTop({ ...opts, scope: 'today' }),
      this.store.trackTop({ ...opts, scope: 'all' }),
      viewer ? this.store.trackBest(viewer.nickname) : Promise.resolve(null),
    ]);
    const pub = (r) => ({ nickname: r.nickname, studyName: r.studyId !== null && r.studyId !== undefined ? this.studyNameOf(r.studyId) : null, vehicle: r.vehicle, ms: r.ms, createdAt: r.createdAt });
    return { ok: true, today: today.map(pub), all: all.map(pub), myBest, track: this.track ? { lengthTiles: this.track.lengthTiles, checkpoints: this.track.checkpoints.length } : null };
  }

  // ── 프로필 ─────────────────────────────────────────────────────────
  /** 다른 사람 프로필: 닉네임 · 스터디 이름 · 이번 주 공부 시간(대상이 공개했을 때만, 본인은 항상) */
  async profile(viewer, targetId) {
    const target = this.players.get(targetId);
    if (!target) return { ok: false, error: 'no_player' };
    const out = { ok: true, id: target.id, nickname: target.nickname, studyName: target.homeStudy ? target.homeStudy.name : null, statsPublic: Boolean(target.statsPublic), weekSeconds: null, vehicle: this.publicVehicle(target) };
    if (target.statsPublic || target === viewer) {
      const rows = await this.study.stats(this.allPlayers ? this.allPlayers() : [...this.players.values()]);
      const r = rows.find((x) => x.nickname === target.nickname);
      out.weekSeconds = r ? r.weekSeconds : 0;
    }
    return out;
  }
}

module.exports = { OutdoorWorld, LAP_REWARD, LAP_MIN_MS, FEED_PER_DAY, SNACK_MS, PHOTO_COOLDOWN_MS, FISHING_TICK_MS, CLERK_DEFAULT };
