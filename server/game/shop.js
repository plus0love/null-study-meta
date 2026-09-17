'use strict';
/**
 * 상점 카탈로그 (8단계 뼈대). 탭은 정해져 있고 아이템 목록은 아직 비어 있다 — 클라이언트는 "준비 중" 을 보여준다.
 * 아이템 형식: { id, tab, name, price(정수 코인), meta? }. 구매(World.purchase)는 여기서 찾은 가격으로 잔액을 차감한다.
 * 테스트는 createShop([...]) 으로 임시 아이템을 넣는다.
 */
const TABS = [
  { id: 'furniture', label: '가구' },
  { id: 'pet', label: '펫' },
  { id: 'petDeco', label: '펫 꾸미기' },
  { id: 'mount', label: '탈것' },
];
const TAB_IDS = new Set(TABS.map((t) => t.id));

const ITEMS = []; // 아직 판매 아이템 없음

function validItem(it) {
  return Boolean(it && typeof it.id === 'string' && it.id && TAB_IDS.has(it.tab) && typeof it.name === 'string' && Number.isInteger(it.price) && it.price >= 0);
}

function createShop(items = ITEMS) {
  const map = new Map();
  for (const it of items) if (validItem(it)) map.set(it.id, { meta: {}, ...it });
  return {
    tabs: TABS,
    get items() {
      return [...map.values()];
    },
    get(id) {
      return (typeof id === 'string' && map.get(id)) || null;
    },
  };
}

module.exports = { createShop, TABS, ITEMS };
