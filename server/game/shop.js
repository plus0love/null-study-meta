'use strict';
/**
 * 상점 카탈로그 (9단계: 가구 23종). 탭 4개 중 '가구' 만 아이템이 있고 나머지는 "준비 중".
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
  { id: 'desk', label: '책상 소품', hint: '내가 앉은 자리 책상 위에 보여요 · 설정 → 내 책상에서 슬롯 3개 장착' },
  { id: 'shared', label: '공용 가구', hint: '🛠 편집 모드로 방 안 원하는 곳에 놓아요 · 모두에게 보여요' },
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

const desk = (id, name, price, extra = {}) => ({ id, tab: 'furniture', category: 'desk', name, price, sprite: { w: 1, h: 1, passable: true }, ...extra });
const shared = (id, name, price, sprite, extra = {}) => ({ id, tab: 'furniture', category: 'shared', name, price, sprite: { passable: false, ...sprite }, ...extra });

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

module.exports = { createShop, TABS, CATEGORIES, ITEMS, pickVariant, frameKey, iconKey };
