'use strict';
/**
 * 탈것 (12단계, 순수 함수). 서버가 이 파일을 /js/vehicles.js 로 그대로 내려보내 브라우저에서는 window.Vehicles 가 된다 (사본 없음).
 *
 *  - 종류: bicycle(자전거) · kickboard(킥보드) · kart(기본 카트) · sport(스포츠 카트). 최고 속도는 걷기(150px/s)의 2 / 2.2 / 3 / 3.5배.
 *    accel(가속, px/s²) · brake(반대 방향을 눌렀을 때 감속) · turn(진행 방향이 목표 방향으로 돌아가는 속도, rad/s — 스포츠 카트가 가장 빠르다) · friction(관성 마찰).
 *  - 클라이언트 물리(step): 걷기와 같은 방향키 방식. 방향키/WASD(대각선 포함 8방향)를 누르면 그쪽으로 가속하되, 진행 방향(angle)은 즉시 꺾이지 않고
 *    차종별 turn 속도로 부드럽게 돌아간다 (느릴수록 빨리 돈다). 키를 떼면 관성으로 미끄러지다 마찰로 멈춘다. 진행 중 반대쪽(100° 이상)을 누르면
 *    먼저 브레이크로 멈춘 뒤 그 방향으로 출발한다. 속도는 항상 0 이상(후진 없음). 벽에 부딪히면 튕기며(속도 -35%) 감속한다.
 *  - 서버 검증: move 의 vehicle { type, angle, speed } 형태·범위(0 ≤ speed ≤ 최고 속도, angle 유한). 이동 예산은 movement.js 가 종류별 최고 속도로 센다.
 *  - 8방향 프레임: 각도 → 's'|'sw'|'w'|'nw'|'n'|'ne'|'e'|'se' (화면 좌표: 0 = 오른쪽, 아래로 갈수록 +).
 * 브라우저에서 layout.js 와 전역 이름이 겹치지 않도록 IIFE 로 감싼다.
 */
(function () {
const WALK = 150; // movement.SPEED 와 같다 (서버 파일을 브라우저에 내려보내므로 require 하지 않는다)

const TYPES = {
  // 낡은 인력거: 1코인. 걷기보다 느리고(0.9배) 가속이 굼뜨며 달릴 때 좌우로 덜컹거리고 삐걱 소리 (wobble). 색 선택 없음(color 고정), 전광판엔 🛒
  rickshaw: { name: '낡은 인력거', maxSpeed: WALK * 0.9, accel: 70, brake: 220, turn: 2.2, friction: 60, price: 1, color: 'wood', wobble: true, icon: '🛒' },
  bicycle: { name: '자전거', maxSpeed: WALK * 2, accel: 240, brake: 360, turn: 3.2, friction: 110, price: 60 },
  kickboard: { name: '킥보드', maxSpeed: WALK * 2.2, accel: 300, brake: 400, turn: 3.6, friction: 140, price: 70 },
  kart: { name: '기본 카트', maxSpeed: WALK * 3, accel: 330, brake: 420, turn: 2.8, friction: 90, price: 80 },
  sport: { name: '스포츠 카트', maxSpeed: WALK * 3.5, accel: 440, brake: 480, turn: 4.2, friction: 80, price: 120 },
};
const TYPE_IDS = Object.keys(TYPES);
const COLORS = [
  { id: 'red', label: '빨강', color: '#d9655f' }, { id: 'blue', label: '파랑', color: '#6d8fc4' }, { id: 'green', label: '초록', color: '#7fa585' },
  { id: 'yellow', label: '노랑', color: '#e5c56a' }, { id: 'white', label: '화이트', color: '#efe6d6' }, { id: 'black', label: '블랙', color: '#3d3944' },
];
const DECALS = ['flame', 'star', 'stripe'];
const HORNS = ['beep', 'bell', 'melody'];
const DIRS8 = ['e', 'se', 's', 'sw', 'w', 'nw', 'n', 'ne']; // 각도 0 부터 45° 씩 (y 아래 양수)
const BOUNCE = 0.35; // 충돌 시 남는 속도 비율 (반대로 튕긴다)
const REVERSE_DEG = 100; // 목표 방향이 진행 방향과 이 각도(°) 이상 다르면 "반대 방향" — 브레이크 후 출발
const SLOW_TURN_BOOST = 2.5; // 거의 멈췄을 때(30px/s 미만)는 이만큼 빨리 돌아 답답하지 않게

function typeOf(id) {
  return (typeof id === 'string' && TYPES[id]) || null;
}

/** 각도(rad) → 8방향 이름 */
function dir8(angle) {
  const a = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return DIRS8[Math.round(a / (Math.PI / 4)) % 8];
}

/** 8방향 → 아바타 4방향 (탑승 중 정지 프레임) */
function facing4(d8) {
  return { e: 'right', se: 'down', s: 'down', sw: 'down', w: 'left', nw: 'up', n: 'up', ne: 'up' }[d8] || 'down';
}

/**
 * move 페이로드의 vehicle 검증. mounted(플레이어의 탈것 { type }) 가 없으면 vehicle 이 있어도 무시(null).
 * @returns {{ ok: true, vehicle: { type, angle, speed } | null } | { ok: false, reason }}
 */
function validateVehiclePayload(mounted, v) {
  if (!mounted) return { ok: true, vehicle: null };
  const t = typeOf(mounted.type);
  if (!t) return { ok: false, reason: 'no_vehicle' };
  if (!v || typeof v !== 'object') return { ok: true, vehicle: { type: mounted.type, angle: mounted.angle || 0, speed: 0 } };
  const angle = Number(v.angle);
  const speed = Number(v.speed);
  if (!Number.isFinite(angle) || !Number.isFinite(speed)) return { ok: false, reason: 'invalid' };
  if (speed < 0 || speed > t.maxSpeed + 1) return { ok: false, reason: 'too_fast' };
  return { ok: true, vehicle: { type: mounted.type, angle, speed } };
}

/** 각도 차이를 (-π, π] 로 */
function wrapAngle(a) {
  let r = a % (Math.PI * 2);
  if (r > Math.PI) r -= Math.PI * 2;
  if (r <= -Math.PI) r += Math.PI * 2;
  return r;
}

/** 방향키 입력 → 목표 각도 (rad) 또는 null (아무 키도 아님). 대각선 포함 8방향 */
function inputAngle(input) {
  const dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
  if (!dx && !dy) return null;
  return Math.atan2(dy, dx);
}

/**
 * 한 프레임 물리 (클라이언트). state: { x, y, angle, speed } (px, rad, px/s ≥ 0), input: { up, down, left, right }, dt(s),
 * canStand(x, y) → boolean (발 박스 충돌). 반환: 새 state + hit(충돌했는지) + braking(반대 방향 브레이크 중).
 */
function step(type, state, input, dt, canStand) {
  const t = typeOf(type);
  if (!t) return { ...state, hit: false, braking: false };
  let { x, y, angle, speed } = state;
  const target = inputAngle(input);
  let braking = false;
  if (target === null) {
    speed = Math.max(0, speed - t.friction * dt); // 관성 → 마찰로 멈춤
  } else {
    const diff = wrapAngle(target - angle);
    if (speed > 1 && Math.abs(diff) > (REVERSE_DEG * Math.PI) / 180) {
      // 반대 방향: 브레이크로 먼저 멈춘다 (멈추면 다음 프레임에 그 방향으로 출발)
      braking = true;
      speed = Math.max(0, speed - t.brake * dt);
    } else {
      // 진행 방향을 목표 쪽으로 부드럽게 (느릴수록 빨리 돌아 제자리에서 답답하지 않게)
      const rate = t.turn * (speed < 30 ? SLOW_TURN_BOOST : 1) * dt;
      angle = speed <= 1 && Math.abs(diff) > Math.PI / 2 ? target : angle + Math.max(-rate, Math.min(rate, diff));
      speed = Math.min(t.maxSpeed, speed + t.accel * dt);
    }
  }
  let hit = false;
  const vx = Math.cos(angle) * speed * dt;
  const vy = Math.sin(angle) * speed * dt;
  if (canStand(x + vx, y)) x += vx;
  else hit = true;
  if (canStand(x, y + vy)) y += vy;
  else hit = true;
  if (hit) { angle = wrapAngle(angle + Math.PI); speed *= BOUNCE; } // 튕김: 반대로 튕겨 나가며 감속
  return { x, y, angle, speed, hit, braking };
}

/** 탈것의 기본 색 (색 변형이 없는 종류는 고정 색 키) */
function colorOf(type, variant) {
  const t = typeOf(type);
  return variant || (t && t.color) || 'red';
}

const api = { WALK, TYPES, TYPE_IDS, COLORS, DECALS, HORNS, DIRS8, BOUNCE, REVERSE_DEG, SLOW_TURN_BOOST, typeOf, colorOf, dir8, facing4, wrapAngle, inputAngle, validateVehiclePayload, step };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else window.Vehicles = api;
})();
