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
 */
const { World } = require('./world');
const { typeOf, colorOf } = require('./vehicles');
const { newLapState, advance } = require('./track');

const LAP_REWARD = 1; // 하루 첫 완주 코인
const LAP_MIN_MS = 3000; // 이보다 빠른 랩은 이상(순간이동 등)으로 보고 기록하지 않는다

class OutdoorWorld extends World {
  /** opts.studyNameOf(studyId) → 이름 | null (전광판·프로필) */
  constructor(room, { studyNameOf = () => null, ...opts } = {}) {
    super(room, { ...opts, outdoor: true, studyId: null });
    this.studyNameOf = studyNameOf;
    this.laps = new Map(); // playerId → LapState
    this.track = room.track || null;
  }

  lapOf(player) {
    let s = this.laps.get(player.id);
    if (!s) { s = newLapState(); this.laps.set(player.id, s); }
    return s;
  }

  detach(player, reason) {
    this.laps.delete(player.id);
    return super.detach(player, reason);
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

module.exports = { OutdoorWorld, LAP_REWARD, LAP_MIN_MS };
