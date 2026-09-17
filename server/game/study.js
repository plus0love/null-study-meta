'use strict';
/**
 * 공부 기록: 세션 · 출석 · 오늘 목표 달성 (순수 로직, 저장소 인터페이스만 사용).
 *
 *  - 세션 = "앉아 있고 상태가 공부 중"인 구간. sync(player) 가 시작/종료를 판단한다.
 *    종료 사유: 일어나기, 휴식·커피 전환, 퇴장(유예 만료 포함), 서버 종료(flushAll). 60초 미만은 폐기.
 *    연결이 끊겨도 유예 동안은 자리에 앉아 있으므로 세션이 이어진다 (재접속 이어받기).
 *  - 출석: 하루 첫 세션이 저장되는 순간 또는 진행 중인 세션이 60초를 넘는 순간(tick) 기록.
 *  - 목표: 공부하는 동안 오늘 누적(저장 + 진행 중)이 목표 시간에 닿는 순간 'goalReached' (같은 목표는 하루 한 번).
 *    세션 시작·목표 설정 시점에 이미 넘어 있으면(서버 재시작, 목표를 낮춘 경우) 조용히 달성 처리해 울리지 않는다.
 *    목표를 더 높게 바꾸면 그 목표에 닿을 때 다시 울린다.
 *
 * 이벤트: 'saved' { nickname, playerId, studyId, seconds, session }, 'discarded' { nickname, seconds },
 *         'attendance' { nickname, playerId, studyId, streak, weekDays, attendedToday, inserted },
 *         'goalReached' { nickname, playerId, studyId, todaySeconds, targetMinutes }
 * 11단계: 하나의 트래커를 모든 스터디(World)가 공유한다 — 공부 기록은 사람에게 붙는 전역 데이터.
 *         세션에 player.studyId 를 실어 두고 이벤트에 함께 내보내므로 각 World 는 자기 스터디의 이벤트만 골라 쓴다.
 */
const EventEmitter = require('node:events');
const { DEFAULT_TZ, dateKey } = require('../store/stats');

const MIN_SESSION_SECONDS = 60;
const TICK_MS = 15 * 1000;
const STATS_CACHE_MS = 3000;

class StudyTracker extends EventEmitter {
  constructor({ store, tz = DEFAULT_TZ, now = () => Date.now(), log = console, goalOf = () => null, minSeconds = MIN_SESSION_SECONDS, tickMs = TICK_MS, autoTick = true } = {}) {
    super();
    this.store = store;
    this.tz = tz;
    this.now = now;
    this.log = log;
    this.goalOf = goalOf; // nickname → { targetMinutes, goalText } | null
    this.minSeconds = minSeconds;
    this.live = new Map(); // nickname → { nickname, playerId, studyId, startedAt, attended }
    this.saved = new Map(); // nickname → { todaySeconds, weekSeconds } (저장된 것만)
    this.savedDate = null;
    this.goalReached = new Set(); // `${nickname}|${date}|${targetMinutes}`
    this.pending = new Set(); // 진행 중인 저장 Promise (flushAll 이 기다림)
    this.statsCache = null;
    this.timer = autoTick ? setInterval(() => this.tick().catch((e) => this.log.warn(`[study] tick 실패: ${e.message}`)), tickMs) : null;
    if (this.timer && this.timer.unref) this.timer.unref();
  }

  today() {
    return dateKey(this.now(), this.tz);
  }

  static isStudying(player) {
    return Boolean(player && player.seatId && player.status === 'study' && !player.removed);
  }

  /** 저장된 합계를 저장소에서 다시 읽는다 (시작 시, 날짜가 바뀔 때) */
  async refreshTotals() {
    const rows = await this.store.studyTotals({ tz: this.tz, now: this.now() });
    this.saved = new Map(rows.map((r) => [r.nickname, { todaySeconds: r.todaySeconds, weekSeconds: r.weekSeconds }]));
    this.savedDate = this.today();
    this.statsCache = null;
  }

  liveSeconds(nickname) {
    const s = this.live.get(nickname);
    return s ? Math.floor((this.now() - s.startedAt) / 1000) : 0;
  }

  todaySeconds(nickname) {
    const s = this.saved.get(nickname);
    return (s ? s.todaySeconds : 0) + this.liveSeconds(nickname);
  }

  /** 플레이어 상태가 바뀔 때마다 호출: 공부 중이면 세션 시작, 아니면 종료 */
  sync(player) {
    const studying = StudyTracker.isStudying(player);
    const cur = this.live.get(player.nickname);
    if (studying && !cur) return this.start(player);
    if (!studying && cur) return this.end(player.nickname, 'sync');
    return null;
  }

  start(player) {
    const s = { nickname: player.nickname, playerId: player.id, studyId: player.studyId, startedAt: this.now(), attended: false };
    this.live.set(player.nickname, s);
    this.markGoal(player.nickname, true); // 이미 넘긴 채 시작하면(서버 재시작 등) 조용히 달성 처리
    this.statsCache = null;
    return s;
  }

  goalKey(nickname, goal) {
    return `${nickname}|${this.today()}|${goal.targetMinutes}`;
  }

  /** 목표를 (다시) 설정했을 때: 이미 넘어 있으면 조용히 달성 처리 → 나중에 울리지 않는다 */
  markGoal(nickname, silent = true) {
    const goal = this.goalOf(nickname);
    if (!goal || !goal.targetMinutes) return false;
    if (this.todaySeconds(nickname) < goal.targetMinutes * 60) return false;
    const key = this.goalKey(nickname, goal);
    if (this.goalReached.has(key)) return false;
    this.goalReached.add(key);
    return !silent;
  }

  /** 기록 초기화(7단계): 진행 중 세션은 저장하지 않고 버리고, 저장된 합계·목표 달성 기억을 지운다. 반환: 버린 세션 또는 null */
  reset(nickname) {
    const s = this.live.get(nickname) || null;
    this.live.delete(nickname);
    this.saved.delete(nickname);
    for (const k of [...this.goalReached]) if (k.startsWith(`${nickname}|`)) this.goalReached.delete(k);
    this.statsCache = null;
    if (s) this.emit('discarded', { nickname, seconds: this.liveSeconds(nickname), reason: 'reset' });
    return s;
  }

  /** 세션 종료 → 60초 이상이면 저장. 반환: 저장된 세션 또는 null */
  end(nickname, reason = 'end') {
    const s = this.live.get(nickname);
    if (!s) return Promise.resolve(null);
    this.live.delete(nickname);
    this.statsCache = null;
    const endedAt = this.now();
    const seconds = Math.floor((endedAt - s.startedAt) / 1000);
    if (seconds < this.minSeconds) {
      this.emit('discarded', { nickname, seconds, reason });
      return Promise.resolve(null);
    }
    const p = (async () => {
      const session = await this.store.saveSession({ nickname, startedAt: s.startedAt, endedAt, seconds });
      const day = dateKey(s.startedAt, this.tz);
      if (day === this.today()) {
        const t = this.saved.get(nickname) || { todaySeconds: 0, weekSeconds: 0 };
        t.todaySeconds += seconds;
        t.weekSeconds += seconds;
        this.saved.set(nickname, t);
      }
      this.statsCache = null;
      this.emit('saved', { nickname, playerId: s.playerId, studyId: s.studyId, seconds, session, reason });
      if (!s.attended) await this.attend(nickname, s.playerId, s.studyId);
      this.checkGoal(nickname, s.playerId, s.studyId);
      return session;
    })().catch((err) => {
      this.log.warn(`[study] 세션 저장 실패 (${nickname}, ${seconds}s): ${err.message}`);
      return null;
    });
    this.pending.add(p);
    p.finally(() => this.pending.delete(p));
    return p;
  }

  async attend(nickname, playerId, studyId) {
    const date = this.today();
    const r = await this.store.recordAttendance(nickname, date);
    const s = this.live.get(nickname);
    if (s) s.attended = true;
    const stats = await this.store.attendanceOf(nickname, { tz: this.tz, now: this.now() });
    this.statsCache = null;
    this.emit('attendance', { nickname, playerId, studyId, inserted: r.inserted, ...stats });
    return { inserted: r.inserted, ...stats };
  }

  /** 오늘 목표 달성 검사 (공부 중 누적이 목표에 닿는 순간, 같은 목표는 하루 한 번). 반환: 이번 호출로 달성했는지 */
  checkGoal(nickname, playerId, studyId) {
    const goal = this.goalOf(nickname);
    if (!goal || !goal.targetMinutes) return false;
    const key = this.goalKey(nickname, goal);
    if (this.goalReached.has(key)) return false;
    const todaySeconds = this.todaySeconds(nickname);
    if (todaySeconds < goal.targetMinutes * 60) return false;
    this.goalReached.add(key);
    this.emit('goalReached', { nickname, playerId, studyId, todaySeconds, targetMinutes: goal.targetMinutes });
    return true;
  }

  /** 15초마다: 날짜 바뀜 처리, 진행 중 세션의 출석(60초)·목표 검사 */
  async tick() {
    if (this.savedDate !== this.today()) {
      await this.refreshTotals();
      this.goalReached.clear();
    }
    for (const s of [...this.live.values()]) {
      if (!s.attended && this.liveSeconds(s.nickname) >= this.minSeconds) await this.attend(s.nickname, s.playerId, s.studyId);
      this.checkGoal(s.nickname, s.playerId, s.studyId);
    }
  }

  /**
   * 랭킹용 통계. players: 접속 중 플레이어 목록(nickname, connected) — online 표시는 호출자(스터디)마다 다르므로 캐시 밖에서 붙인다.
   * 반환: [{ nickname, todaySeconds, weekSeconds, streak, weekDays, live, online }] (진행 중 세션 포함, 3초 캐시)
   */
  async stats(players = []) {
    const now = this.now();
    let list;
    if (this.statsCache && now - this.statsCache.at < STATS_CACHE_MS) list = this.statsCache.rows;
    else {
      const [totals, att] = await Promise.all([this.store.studyTotals({ tz: this.tz, now }), this.store.attendanceStats({ tz: this.tz, now })]);
      const rows = new Map();
      const row = (n) => {
        if (!rows.has(n)) rows.set(n, { nickname: n, todaySeconds: 0, weekSeconds: 0, streak: 0, weekDays: 0, live: false });
        return rows.get(n);
      };
      for (const t of totals) Object.assign(row(t.nickname), { todaySeconds: t.todaySeconds, weekSeconds: t.weekSeconds });
      for (const a of att) Object.assign(row(a.nickname), { streak: a.streak, weekDays: a.weekDays });
      for (const s of this.live.values()) {
        const r = row(s.nickname);
        const secs = this.liveSeconds(s.nickname);
        r.todaySeconds += secs;
        r.weekSeconds += secs;
        r.live = true;
      }
      list = [...rows.values()];
      this.statsCache = { at: now, rows: list };
    }
    const online = new Set(players.filter((p) => p.connected).map((p) => p.nickname));
    const out = list.map((r) => ({ ...r, online: online.has(r.nickname) }));
    for (const n of online) if (!list.some((r) => r.nickname === n)) out.push({ nickname: n, todaySeconds: 0, weekSeconds: 0, streak: 0, weekDays: 0, live: false, online: true });
    return out;
  }

  /** 서버 종료: 진행 중인 세션을 전부 저장하고 저장이 끝날 때까지 기다린다 */
  async flushAll(reason = 'shutdown') {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const ends = [...this.live.keys()].map((n) => this.end(n, reason));
    await Promise.all([...ends, ...this.pending]);
  }
}

module.exports = { StudyTracker, MIN_SESSION_SECONDS, TICK_MS };
