'use strict';
/**
 * 상점 카탈로그 (9단계: 가구 23종 · 10단계: 펫 13 · 펫 꾸미기 8 · 펫 행동 3 · 12단계: 탈것 4 · 데칼 3 · 경적 3).
 *  - category 'vehicle'     : 탈것 — 야외에서 V 로 소환/해제. vehicle = 종류(vehicles.js TYPES), variants 는 색 6종 (구매 때 선택).
 *  - category 'vehicleDecal': 데칼 — 탑승 중인 탈것 몸체에 겹쳐 그린다 (설정 → 내 탈것). decal = 'flame' | 'star' | 'stripe'
 *  - category 'vehicleHorn' : 경적 — H 키 소리 (fx.js 합성). horn = 'beep' | 'bell' | 'melody'
 *  - category 'pet'      : 개인 펫 — 주인을 따라다닌다 (한 번에 1마리 활성, users.pet_config). species = 스프라이트 종.
 *  - category 'sharedPet': 공용 펫 — 지갑에서 "방에 풀기" → 방에 살며 자율 행동 (room_pets, 최대 3마리).
 *  - category 'petSkill' : 펫 행동 업그레이드 — 구매 때 target(펫)을 고르고 펫별 1회. skill = 'come' | 'sleep_beside' | 'high_five'
 *  - category 'petDeco'  : 꾸미기 — 모든 펫의 슬롯(head/neck/back, 안경은 face 위치의 head 슬롯)에 장착. variants 는 색.
 *
 * 아이템 형식: { id, tab, category, name, price, variants?, sprite, anim?, fx?, desc? }
 *  - category 'desk'  : 개인 책상 소품 — 내가 앉은 자리 앞 책상 위에 표시 (슬롯 3개, users.desk_items). 스프라이트 1x1.
 *  - category 'shared': 공용 가구 — 편집 모드로 방 안에 배치, 모두가 본다 (room_layout).
 *  - variants: [{ id, label, color? }] — 구매 때 하나를 고른다 (inventory.meta.variant). 없으면 단일.
 *  - sprite: { w, h(타일), passable, seat?, rotations?, wallOnly?, on?, replace?, layer?, top? }
 *      passable  통과 가능 여부 (false 면 충돌 맵에 반영). seat 가 있으면 그 셀만 통과 가능.
 *      seat      { dx, dy, facing, kind } — 앉기/눕기 가능. kind 'bed' 는 눕기(자동 휴식, 세션 안 쌓임), 'massage' 는 앉으면 자동 휴식+흔들림.
 *      rotations [0, 1] — 회전 가능(R). 1 은 시계 방향 90° (w/h 가 바뀐다). 없으면 회전 불가.
 *      wallOnly  벽 타일(wall_face)에만.  on: [name | { name, dyMin }] — 그 오브젝트 위에만 (또는 null = 빈 바닥).
 *      replace   기존 오브젝트 자리에 정확히 겹쳐 놓는다 (커피머신 업그레이드).
 *      layer 'floor' 는 러그: 다른 가구 아래에 깔리고 겹침을 허용한다.
 *  - anim: { frames, fps } — 방 스프라이트 프레임 순환(불꽃·RGB·물고기·김). whenSeated 면 앉은 사람이 있을 때만.
 * 그림은 tools/furniture.py 가 그린다 (public/assets/furniture.png/json). 프레임 키 규칙은 frameKey() 참고.
 */
const TABS = [
  { id: 'furniture', label: '가구' },
  { id: 'pet', label: '펫' },
  { id: 'petDeco', label: '펫 꾸미기' },
  { id: 'mount', label: '탈것' },
];
const TAB_IDS = new Set(TABS.map((t) => t.id));
const CATEGORIES = [
  { id: 'desk', tab: 'furniture', label: '책상 소품', hint: '내가 앉은 자리 책상 위에 보여요 · 설정 → 내 책상에서 슬롯 3개 장착' },
  { id: 'shared', tab: 'furniture', label: '공용 가구', hint: '🛠 편집 모드로 방 안 원하는 곳에 놓아요 · 모두에게 보여요' },
  { id: 'pet', tab: 'pet', label: '개인 펫', hint: '주인을 따라다녀요 · 설정 → 내 펫에서 활성 펫·이름·꾸미기 선택 (한 번에 1마리)' },
  { id: 'sharedPet', tab: 'pet', label: '공용 펫', hint: '방에 풀면 강아지처럼 자율로 살아요 (최대 3마리) · 푼 사람이 이름 짓고 회수할 수 있어요' },
  { id: 'petSkill', tab: 'pet', label: '행동 업그레이드', hint: '펫별 1회 · 구매할 때 어느 펫에 줄지 골라요' },
  { id: 'petDeco', tab: 'petDeco', label: '꾸미기', hint: '강아지·공용 펫·내 펫 슬롯 3개(머리/목/등)에 장착 · 설정에서 골라요' },
  { id: 'vehicle', tab: 'mount', label: '탈것', hint: '야외에서 V 로 소환/해제 · 설정 → 내 탈것에서 활성 선택 · 색은 구매할 때 골라요' },
  { id: 'vehicleDecal', tab: 'mount', label: '데칼', hint: '탈것 몸체에 붙는 무늬 (자전거는 몸체가 얇아 안 보여요) · 설정 → 내 탈것' },
  { id: 'vehicleHorn', tab: 'mount', label: '경적', hint: '야외에서 탑승 중 H 키 · 설정 → 내 탈것에서 골라요' },
];
const PET_SLOTS = ['head', 'neck', 'back'];

const RIBBON_COLORS = [
  { id: 'red', label: '빨강', color: '#d9655f' }, { id: 'pink', label: '분홍', color: '#e59ab2' }, { id: 'blue', label: '파랑', color: '#6d8fc4' }, { id: 'yellow', label: '노랑', color: '#e5c56a' },
];
const COLLAR_COLORS = [
  { id: 'red', label: '빨강', color: '#c94f4f' }, { id: 'blue', label: '파랑', color: '#4f6f9f' }, { id: 'green', label: '초록', color: '#5f8565' }, { id: 'purple', label: '보라', color: '#8d6a9c' },
];
const SCARF_COLORS = [
  { id: 'red', label: '빨강', color: '#d9655f' }, { id: 'navy', label: '네이비', color: '#4f5f88' }, { id: 'mustard', label: '머스터드', color: '#d8b04f' }, { id: 'sage', label: '세이지', color: '#8fa585' },
];

const MUG_COLORS = [
  { id: 'red', label: '빨강', color: '#d9655f' },
  { id: 'blue', label: '파랑', color: '#6d8fc4' },
  { id: 'green', label: '초록', color: '#7fa585' },
  { id: 'yellow', label: '노랑', color: '#e5c56a' },
  { id: 'pink', label: '분홍', color: '#e59ab2' },
];
const CUSHION_COLORS = [
  { id: 'cream', label: '크림', color: '#eedcbd' },
  { id: 'sage', label: '세이지', color: '#8fa585' },
  { id: 'terra', label: '테라코타', color: '#d9977a' },
  { id: 'navy', label: '네이비', color: '#4f5f88' },
  { id: 'mustard', label: '머스터드', color: '#d8b04f' },
  { id: 'plum', label: '자두', color: '#8d6a9c' },
];
const BED_COLORS = [
  { id: 'sage', label: '세이지', color: '#8fa585' },
  { id: 'blue', label: '하늘', color: '#8fb3d4' },
  { id: 'rose', label: '로즈', color: '#d99aa8' },
];
const LAMP_STYLES = [
  { id: 'brass', label: '황동', color: '#c9a35a' },
  { id: 'black', label: '블랙', color: '#2e2b33' },
  { id: 'white', label: '화이트', color: '#efe6d6' },
];
const POSTER_STYLES = [
  { id: 'mountain', label: '산', color: '#8fb3d4' },
  { id: 'plant', label: '식물', color: '#7fa585' },
  { id: 'coffee', label: '커피', color: '#b57a5f' },
  { id: 'moon', label: '달', color: '#4f5f88' },
  { id: 'quote', label: '문구', color: '#eedcbd' },
];
const CLOCK_STYLES = [
  { id: 'round', label: '원형', color: '#efe6d6' },
  { id: 'square', label: '사각', color: '#7c5a44' },
  { id: 'cat', label: '고양이', color: '#2e2b33' },
];

// 12단계: 상점 전체 가격 30% 인하 — 아래 헬퍼의 price 는 정가(list price), 실제 가격은 sale(): 반올림 · 최소 2코인 (1코인 아이템은 그대로). 상대 순서 유지. 환불 없음.
const SALE_RATE = 0.7;
const SALE_MIN = 2;
const sale = (list) => (list <= 1 ? list : Math.max(SALE_MIN, Math.round(list * SALE_RATE)));

const desk = (id, name, price, extra = {}) => ({ id, tab: 'furniture', category: 'desk', name, price: sale(price), listPrice: price, sprite: { w: 1, h: 1, passable: true }, ...extra });
const shared = (id, name, price, sprite, extra = {}) => ({ id, tab: 'furniture', category: 'shared', name, price: sale(price), listPrice: price, sprite: { passable: false, ...sprite }, ...extra });

const ITEMS = [
  // ── 개인 책상 소품 ──────────────────────────────────────────────────
  desk('mug', '머그컵', 3, { variants: MUG_COLORS, desc: '따뜻한 한 잔. 색 5종' }),
  desk('plant_mini', '작은 화분', 4, { desc: '책상 위 초록 한 점' }),
  desk('pencil_cup', '연필꽂이', 4, { desc: '연필·펜·자' }),
  desk('sticky_notes', '포스트잇 뭉치', 5, { desc: '노랑·분홍·민트' }),
  desk('desk_lamp', '탁상 램프', 8, { variants: LAMP_STYLES, desc: '은은한 불빛. 3종' }),
  desk('figure', '미니 피규어', 10, { desc: '작은 응원단' }),
  desk('desk_frame', '탁상 액자', 8, { desc: '소중한 사진 한 장' }),
  desk('candle', '향초', 10, { anim: { frames: 2, fps: 4 }, desc: '불꽃이 흔들려요' }),
  desk('dual_monitor', '듀얼 모니터', 18, { desc: '화면이 두 배' }),
  desk('keyboard', '기계식 키보드', 15, { anim: { frames: 4, fps: 3 }, desc: 'RGB 가 순환해요' }),
  desk('speaker', '미니 스피커', 18, { fx: 'notes', desc: '♪ 가 떠올라요' }),
  desk('fishbowl', '어항', 22, { anim: { frames: 3, fps: 2 }, desc: '물고기가 헤엄쳐요' }),
  // ── 공용 가구 ──────────────────────────────────────────────────────
  shared('poster', '벽 포스터', 10, { w: 1, h: 1, passable: true, wallOnly: true }, { variants: POSTER_STYLES, desc: '벽 타일에만. 5종' }),
  shared('cushion', '쿠션', 10, { w: 1, h: 1, passable: true, on: ['sofa_wide', 'pouf_cream', 'pouf_green', null] }, { variants: CUSHION_COLORS, desc: '소파·푸프·바닥. 색 6종' }),
  shared('rug_small', '작은 러그', 14, { w: 3, h: 2, passable: true, layer: 'floor', rotations: [0, 1] }, { desc: '바닥에 깔려요. 다른 가구 아래에도' }),
  shared('floor_lamp', '스탠드 조명', 18, { w: 1, h: 2, glow: { r: 2.6, intensity: 0.5 } }, { desc: '주변이 밝아져요' }),
  shared('wall_clock', '벽시계', 20, { w: 1, h: 1, passable: true, wallOnly: true }, { variants: CLOCK_STYLES, desc: '벽에만. 3종' }),
  shared('bookshelf_fill', '책장 채우기', 20, { w: 1, h: 1, passable: true, on: [{ name: 'bookshelf_big', dyMin: 2 }] }, { desc: '큰 책장의 빈 칸에' }),
  shared('blanket', '라운지 담요', 20, { w: 2, h: 1, passable: true, on: ['sofa_wide'] }, { desc: '소파 위에' }),
  shared('coffee_upgrade', '커피머신 업그레이드', 35, { w: 1, h: 2, replace: 'coffee_machine' }, { anim: { frames: 3, fps: 3 }, desc: '기존 커피머신 교체 · 김이 나요' }),
  shared('beanbag', '빈백 소파', 25, { w: 1, h: 2, seat: { dx: 0, dy: 1, facing: 'down', kind: 'beanbag' } }, { desc: '앉을 수 있어요' }),
  shared('massage_chair', '안마의자', 45, { w: 1, h: 2, seat: { dx: 0, dy: 1, facing: 'down', kind: 'massage' } }, { anim: { frames: 2, fps: 8, whenSeated: true }, desc: '앉으면 흔들리며 자동 휴식' }),
  shared('bed', '1인용 침대', 40, { w: 1, h: 2, seat: { dx: 0, dy: 1, facing: 'down', kind: 'bed' }, rotations: [0, 1], top: true }, { variants: BED_COLORS, desc: '앞에서 E → 눕기 (자동 휴식). 이불 3색' }),
];

const pet = (id, name, price, species, desc, extra = {}) => ({ id, tab: 'pet', category: 'pet', name, price: sale(price), listPrice: price, species, desc, ...extra });
const sharedPet = (id, name, price, species, desc) => ({ id, tab: 'pet', category: 'sharedPet', name, price: sale(price), listPrice: price, species, desc });
const skill = (id, name, price, skillId, desc) => ({ id, tab: 'pet', category: 'petSkill', name, price: sale(price), listPrice: price, skill: skillId, desc });
const deco = (id, name, price, slot, extra = {}) => ({ id, tab: 'petDeco', category: 'petDeco', name, price: sale(price), listPrice: price, slot, ...extra });

const PET_ITEMS = [
  // ── 개인 펫 ──
  pet('pet_hamster', '햄스터', 25, 'hamster', '볼주머니 가득. 종종종 따라와요'),
  pet('pet_chick', '병아리', 25, 'chick', '삐약삐약 뒤를 쫓아요'),
  pet('pet_turtle', '거북이', 28, 'turtle', '느리게 따라와요 (못 따라오면 순간이동)'),
  pet('pet_rabbit', '토끼', 35, 'rabbit', '귀가 길고 재빨라요'),
  pet('pet_cat', '고양이', 40, 'cat', '도도하게 따라와요'),
  pet('pet_maltese', '흰 말티즈', 40, 'maltese', '뽀얀 강아지'),
  pet('pet_poodle_black', '검정 푸들', 40, 'poodle_black', '까만 곱슬 강아지'),
  pet('pet_shiba', '시바', 40, 'shiba', '동글동글 말린 꼬리'),
  pet('pet_parrot', '앵무새', 45, 'parrot', '어깨 위에 앉아 다녀요'),
  pet('pet_slime', '슬라임', 50, 'slime', '통통 튀며 따라와요'),
  // ── 공용 펫 ──
  sharedPet('shared_cat', '고양이 (공용)', 50, 'cat', '방에 살아요. 책장 선반·소파 위에서 자기 좋아함'),
  sharedPet('shared_turtle', '거북이 (공용)', 35, 'turtle', '라운지 러그를 아주 느리게 돌아다녀요'),
  sharedPet('shared_fish', '어항 물고기', 40, 'fish', '라운지 테이블 위 어항에서 헤엄쳐요'),
  // ── 행동 업그레이드 (펫별 1회) ──
  skill('skill_come', '이름 부르면 달려옴', 10, 'come', '채팅에 펫 이름을 치면 달려와요'),
  skill('skill_sleep', '옆에서 같이 자기', 10, 'sleep_beside', '주인이 앉아 공부 중이면 발밑에서 자요 (개인 펫)'),
  skill('skill_high_five', '하이파이브', 8, 'high_five', 'E 로 쓰다듬으면 🖐 반응이 추가돼요'),
  // ── 꾸미기 ──
  deco('deco_ribbon', '리본', 5, 'head', { variants: RIBBON_COLORS, desc: '머리에 리본. 색 4종' }),
  deco('deco_collar', '목걸이', 6, 'neck', { variants: COLLAR_COLORS, desc: '목에 반짝 목걸이. 색 4종' }),
  deco('deco_scarf', '스카프', 8, 'neck', { variants: SCARF_COLORS, desc: '포근한 스카프. 색 4종' }),
  deco('deco_straw_hat', '밀짚모자', 10, 'head', { desc: '여름 느낌' }),
  deco('deco_beanie', '비니', 10, 'head', { desc: '머스터드 비니' }),
  deco('deco_glasses', '안경', 10, 'head', { desc: '똑똑해 보여요' }),
  deco('deco_crown', '왕관', 15, 'head', { desc: '오늘의 왕' }),
  deco('deco_wings', '날개', 15, 'back', { anim: { frames: 2, fps: 4 }, desc: '작은 흰 날개가 펄럭여요' }),
];
ITEMS.push(...PET_ITEMS);

// ── 12단계 탈것 (오리지널 디자인, tools/vehicles.py) ──
const { TYPES: VEHICLE_TYPES, COLORS: VEHICLE_COLORS } = require('./vehicles');
const vehicle = (id, type, desc, extra = {}) => ({ id, tab: 'mount', category: 'vehicle', name: VEHICLE_TYPES[type].name, price: sale(VEHICLE_TYPES[type].price), listPrice: VEHICLE_TYPES[type].price, vehicle: type, variants: VEHICLE_COLORS, desc, ...extra });
const vdecal = (id, name, decal, desc) => ({ id, tab: 'mount', category: 'vehicleDecal', name, price: sale(10), listPrice: 10, decal, desc });
const vhorn = (id, name, horn, desc) => ({ id, tab: 'mount', category: 'vehicleHorn', name, price: sale(5), listPrice: 5, horn, desc });
const VEHICLE_ITEMS = [
  vehicle('vehicle_rickshaw', 'rickshaw', '그래도 내 거야.', { variants: undefined }), // 1코인 · 색 없음 · 걷기보다 느림
  vehicle('vehicle_bicycle', 'bicycle', '걷기의 2배. 가볍게 한 바퀴'),
  vehicle('vehicle_kickboard', 'kickboard', '걷기의 2.2배. 회전이 빨라요'),
  vehicle('vehicle_kart', 'kart', '걷기의 3배. 트랙의 기본'),
  vehicle('vehicle_sport', 'sport', '걷기의 3.5배. 가속이 가장 빨라요'),
  vdecal('decal_flame', '불꽃 데칼', 'flame', '몸체에 불꽃'),
  vdecal('decal_star', '별 데칼', 'star', '몸체에 별'),
  vdecal('decal_stripe', '줄무늬 데칼', 'stripe', '레이싱 스트라이프'),
  vhorn('horn_beep', '경적 · 빵빵', 'beep', '클래식한 두 번'),
  vhorn('horn_bell', '경적 · 따르릉', 'bell', '자전거 벨'),
  vhorn('horn_melody', '경적 · 멜로디', 'melody', '짧은 멜로디'),
];
ITEMS.push(...VEHICLE_ITEMS);

/** 꾸미기 아틀라스 키의 아이템 부분 ('deco/<id>' 에서 deco_ 접두사를 뗀다) */
function decoKey(item, variant) {
  const base = item.id.replace(/^deco_/, '');
  return variant ? `${base}/${variant}` : base;
}

function validItem(it) {
  return Boolean(it && typeof it.id === 'string' && it.id && TAB_IDS.has(it.tab) && typeof it.name === 'string' && Number.isInteger(it.price) && it.price >= 0);
}

/** 아이템의 변형 id 검증: 변형이 없는 아이템은 null, 있으면 목록에 있어야 한다 (안 주면 첫 번째) */
function pickVariant(item, variant) {
  if (!item.variants || !item.variants.length) return { ok: true, variant: null };
  if (variant === undefined || variant === null || variant === '') return { ok: true, variant: item.variants[0].id };
  return item.variants.some((v) => v.id === variant) ? { ok: true, variant } : { ok: false, error: 'no_variant' };
}

/** 방 스프라이트 프레임 키 (tools/furniture.py 와 같은 규칙): "<id>|<variant|->|r<rot>|f<frame>[|top]" */
function frameKey(itemId, variant, rotation = 0, frame = 0, suffix = '') {
  return `${itemId}|${variant || '-'}|r${rotation}|f${frame}${suffix ? `|${suffix}` : ''}`;
}

function iconKey(itemId, variant) {
  return variant ? `icon/${itemId}/${variant}` : `icon/${itemId}`;
}

function createShop(items = ITEMS) {
  const map = new Map();
  for (const it of items) if (validItem(it)) map.set(it.id, { meta: {}, category: it.category || 'shared', sprite: { w: 1, h: 1, passable: true }, ...it });
  return {
    tabs: TABS,
    categories: CATEGORIES,
    get items() {
      return [...map.values()];
    },
    get(id) {
      return (typeof id === 'string' && map.get(id)) || null;
    },
  };
}

module.exports = { createShop, TABS, CATEGORIES, ITEMS, PET_ITEMS, VEHICLE_ITEMS, PET_SLOTS, SALE_RATE, SALE_MIN, sale, pickVariant, frameKey, iconKey, decoKey };
