'use strict';
/**
 * 강아지 애정도 (18단계, 순수 함수). 스터디마다 { level, xp } 하나 (dog_affection).
 *  - xp: 산책 5분마다 +1 (WALK_XP_MS), 쓰다듬기 하루 첫 PET_XP_PER_DAY 번 각 +1 (사람마다, STATS_TZ 날짜).
 *  - 레벨 L → L+1 에 필요한 xp = needFor(L) (3 + L). Lv1 4 · Lv2 5 · … 최대 MAX_LEVEL.
 *  - 해금(UNLOCKS): Lv2 앉아 · Lv3 손(하이파이브) · Lv5 빙글 · Lv8 같이 자기 · Lv10 리본 기본 장착.
 */
const MAX_LEVEL = 10;
const WALK_XP_MS = 5 * 60 * 1000;
const PET_XP_PER_DAY = 3;
const UNLOCKS = [
  { level: 2, id: 'sit', name: '앉아', desc: 'E 메뉴 → 앉아 (앉기 애니메이션)', emoji: '🐕' },
  { level: 3, id: 'paw', name: '손', desc: 'E 메뉴 → 손 (하이파이브 이모션)', emoji: '🖐' },
  { level: 5, id: 'spin', name: '빙글', desc: 'E 메뉴 → 빙글 (제자리 회전)', emoji: '🌀' },
  { level: 8, id: 'sleep_beside', name: '같이 자기', desc: '산책 중 주인이 앉아 공부하면 발밑에서 잠들어요', emoji: '💤' },
  { level: 10, id: 'ribbon', name: '리본', desc: '리본을 기본 장착해요 (꾸미기 아이템 무료 지급)', emoji: '🎀' },
];
const TRICKS = { sit: 'sit', paw: 'paw', spin: 'spin' };

function needFor(level) {
  return 3 + Math.max(1, Math.min(MAX_LEVEL, level));
}

/** 애정도 상태 정규화 */
function normalize(a) {
  const level = Math.max(1, Math.min(MAX_LEVEL, Math.floor(Number(a && a.level) || 1)));
  const xp = Math.max(0, Math.floor(Number(a && a.xp) || 0));
  return { level, xp: level >= MAX_LEVEL ? 0 : Math.min(xp, needFor(level) - 1) };
}

/**
 * xp 를 더하고 레벨업을 계산한다. 반환 { level, xp, gained: 올린 레벨 수, unlocked: [해금 항목] }
 */
function gain(a, amount) {
  let { level, xp } = normalize(a);
  const from = level;
  if (level >= MAX_LEVEL) return { level, xp: 0, gained: 0, unlocked: [] };
  xp += Math.max(0, Math.floor(amount));
  while (level < MAX_LEVEL && xp >= needFor(level)) {
    xp -= needFor(level);
    level++;
  }
  if (level >= MAX_LEVEL) xp = 0;
  return { level, xp, gained: level - from, unlocked: UNLOCKS.filter((u) => u.level > from && u.level <= level) };
}

function unlockedAt(level) {
  return UNLOCKS.filter((u) => u.level <= level);
}

function has(level, id) {
  return UNLOCKS.some((u) => u.id === id && u.level <= level);
}

/** 설정 화면용 요약 */
function summary(a) {
  const n = normalize(a);
  return { level: n.level, xp: n.xp, need: n.level >= MAX_LEVEL ? null : needFor(n.level), max: MAX_LEVEL, unlocked: unlockedAt(n.level).map((u) => u.id), unlocks: UNLOCKS };
}

module.exports = { MAX_LEVEL, WALK_XP_MS, PET_XP_PER_DAY, UNLOCKS, TRICKS, needFor, normalize, gain, unlockedAt, has, summary };
