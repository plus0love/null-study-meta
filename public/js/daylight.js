/**
 * 창밖 시간대 (클라이언트 실제 시각 기준).
 *   06~17시 낮 · 17~19시 노을 · 19~06시 밤. 경계마다 30분(±15분)에 걸쳐 부드럽게 섞는다.
 * 순수 함수만 있어 node 테스트에서도 그대로 쓴다 (UMD).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Daylight = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DAY_START = 6;
  const SUNSET_START = 17;
  const NIGHT_START = 19;
  const BLEND_HOURS = 0.5; // 경계 전후 합쳐 30분

  // 하늘 그라데이션 (위 → 아래, 10단계). 밤은 1단계 창문 타일에 굽던 색 그대로.
  const SKY = {
    night: ['#141a30', '#171e38', '#1b2442', '#202b4d', '#263457', '#2d3e63', '#35496f', '#3f557c', '#4a6189', '#566d94'],
    day: ['#5f9fdc', '#6aa8e0', '#78b2e4', '#88bce8', '#98c6ec', '#a8cfef', '#b8d8f2', '#c8e1f4', '#d6e9f6', '#e3f0f8'],
    sunset: ['#3b2b5e', '#4d3268', '#63396f', '#7d4470', '#9a506d', '#b85f66', '#d3735d', '#e68b58', '#f0a45c', '#f5bd6e'],
  };

  function smooth(t) {
    const x = Math.min(1, Math.max(0, t));
    return x * x * (3 - 2 * x);
  }

  /** 경계 h 를 중심으로 BLEND_HOURS 동안 0 → 1 */
  function step(hour, h) {
    return smooth((hour - (h - BLEND_HOURS / 2)) / BLEND_HOURS);
  }

  /** @param {number} hour 0 ≤ hour < 24 (소수) → { day, sunset, night } 합은 1 */
  function weightsAt(hour) {
    const h = ((hour % 24) + 24) % 24;
    const toDay = step(h, DAY_START);
    const toSunset = step(h, SUNSET_START);
    const toNight = step(h, NIGHT_START);
    const day = toDay * (1 - toSunset);
    const sunset = toSunset * (1 - toNight);
    const night = Math.max(0, 1 - day - sunset);
    return { day, sunset, night };
  }

  function hex(c) {
    return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  }

  function toHex(r, g, b) {
    return `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
  }

  /** 세 팔레트를 가중 평균한 하늘 색 목록 (위 → 아래) */
  function skyStops(w) {
    const out = [];
    for (let i = 0; i < SKY.night.length; i++) {
      const n = hex(SKY.night[i]);
      const d = hex(SKY.day[i]);
      const s = hex(SKY.sunset[i]);
      out.push(toHex(
        n[0] * w.night + d[0] * w.day + s[0] * w.sunset,
        n[1] * w.night + d[1] * w.day + s[1] * w.sunset,
        n[2] * w.night + d[2] * w.day + s[2] * w.sunset,
      ));
    }
    return out;
  }

  /** 실내 연출 강도: darkness = 어둠 레이어 알파, glow = 앰버 글로우 배율, dayLayer = 낮 창문 레이어 알파 */
  function ambient(w) {
    return {
      darkness: 0.2 * w.night + 0.13 * w.sunset + 0.06 * w.day,
      glow: 1 * w.night + 0.7 * w.sunset + 0.35 * w.day,
      dayLayer: w.day + 0.55 * w.sunset,
      stars: w.night,
    };
  }

  function hourOf(date) {
    const d = date || new Date();
    return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
  }

  /** 이름표 (테스트/디버그용): 가장 큰 가중치 */
  function phaseOf(w) {
    if (w.day >= w.sunset && w.day >= w.night) return 'day';
    if (w.sunset >= w.night) return 'sunset';
    return 'night';
  }

  return { DAY_START, SUNSET_START, NIGHT_START, BLEND_HOURS, SKY, weightsAt, skyStops, ambient, hourOf, phaseOf };
});
