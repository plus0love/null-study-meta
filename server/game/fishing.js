'use strict';
/**
 * 14단계 C: 낚시 규칙 (순수 로직 — 저장소·소켓과 무관).
 *
 *  물고기 10종: 흔함 6 · 보통 3 · 희귀 1. 확률은 서버 판정(roll): 흔함 66% (각 11%) · 보통 30% (각 10%) · 희귀 4%.
 *  낚시 자리(연못 둘레 4곳)에서 E → cast: 낚싯대 든 자세(state 'wait'), BITE_MIN~BITE_MAX 뒤 입질(state 'bite', "!" 표시) →
 *  REEL_WINDOW_MS 안에 E(reel) → 성공(잡음) / 늦거나 빠르면 실패. 하루 CATCH_PER_DAY 마리까지 (STATS_TZ 기준, 저장소가 센다).
 *  낚싯대는 기본 제공 (아이템 없음).
 *
 *  FishingSession: { spot, state: 'wait'|'bite', castAt, biteAt, windowUntil } — OutdoorWorld 가 플레이어마다 하나 들고 tick(now) 으로 진행시킨다.
 */
const FISH = [
  { id: 'crucian', name: '붕어', rarity: 'common', emoji: '🐟', desc: '연못의 터줏대감. 느긋하게 헤엄쳐요.' },
  { id: 'minnow', name: '피라미', rarity: 'common', emoji: '🐟', desc: '작고 재빨라요. 은빛으로 반짝여요.' },
  { id: 'bluegill', name: '블루길', rarity: 'common', emoji: '🐟', desc: '파란 볼이 매력. 아무거나 잘 물어요.' },
  { id: 'carp', name: '잉어', rarity: 'common', emoji: '🐟', desc: '묵직한 손맛. 오래 사는 물고기예요.' },
  { id: 'catfish', name: '메기', rarity: 'common', emoji: '🐟', desc: '긴 수염으로 바닥을 더듬어요.' },
  { id: 'loach', name: '미꾸라지', rarity: 'common', emoji: '🐟', desc: '미끌미끌, 손에서 자꾸 빠져나가요.' },
  { id: 'koi', name: '비단잉어', rarity: 'uncommon', emoji: '🐠', desc: '주황·흰 무늬가 비단 같아요.' },
  { id: 'trout', name: '송어', rarity: 'uncommon', emoji: '🐠', desc: '맑은 물을 좋아하는 점박이.' },
  { id: 'bass', name: '배스', rarity: 'uncommon', emoji: '🐠', desc: '입이 크고 힘이 세요. 낚싯줄을 당겨요!' },
  { id: 'golden_carp', name: '황금 잉어', rarity: 'rare', emoji: '✨🐡', desc: '전설의 황금빛. 보면 행운이 온대요.' },
];
const FISH_BY_ID = new Map(FISH.map((f) => [f.id, f]));
const RARITY_LABEL = { common: '흔함', uncommon: '보통', rare: '희귀' };
const RARITY_P = { common: 0.66, uncommon: 0.30, rare: 0.04 }; // 등급 합, 등급 안에서는 균등

const BITE_MIN_MS = 5000;
const BITE_MAX_MS = 10000;
const REEL_WINDOW_MS = 1200; // "!" 뒤 이 안에 E
const CATCH_PER_DAY = 5;
const SPOT_RANGE_PX = 48;

/** 무작위 물고기 (random: 0..1) */
function roll(random = Math.random) {
  let r = random();
  for (const rarity of ['common', 'uncommon', 'rare']) {
    const list = FISH.filter((f) => f.rarity === rarity);
    const p = RARITY_P[rarity];
    if (r < p) return list[Math.min(list.length - 1, Math.floor((r / p) * list.length))];
    r -= p;
  }
  return FISH[0];
}

function fishById(id) {
  return FISH_BY_ID.get(id) || null;
}

/** 새 세션: 입질 시각은 [BITE_MIN, BITE_MAX] 균등 */
function newSession(spot, now, random = Math.random) {
  const biteAt = now + BITE_MIN_MS + Math.floor(random() * (BITE_MAX_MS - BITE_MIN_MS));
  return { spot, state: 'wait', castAt: now, biteAt, windowUntil: biteAt + REEL_WINDOW_MS };
}

/**
 * 세션 진행. 반환: 'bite'(방금 입질 시작) | 'miss'(창이 지나 실패) | null
 */
function tickSession(s, now) {
  if (s.state === 'wait' && now >= s.biteAt) {
    s.state = 'bite';
    if (now > s.windowUntil) { s.state = 'done'; return 'miss'; } // 한 번에 창까지 지났으면 바로 실패
    return 'bite';
  }
  if (s.state === 'bite' && now > s.windowUntil) { s.state = 'done'; return 'miss'; }
  return null;
}

/** E(낚아채기) 판정: 입질 창 안이면 true */
function reelOk(s, now) {
  return s.state === 'bite' && now >= s.biteAt && now <= s.windowUntil;
}

module.exports = { FISH, FISH_BY_ID, RARITY_LABEL, RARITY_P, BITE_MIN_MS, BITE_MAX_MS, REEL_WINDOW_MS, CATCH_PER_DAY, SPOT_RANGE_PX, roll, fishById, newSession, tickSession, reelOk };
