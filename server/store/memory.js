'use strict';
/**
 * 메모리 저장소. Supabase 키가 없거나 STORE=memory 일 때 사용.
 * 이번 단계에서는 인터페이스만 두고, 영구 데이터 메서드는 다음 단계에서 채운다.
 */
function createMemoryStore() {
  const users = new Map();
  return {
    kind: 'memory',
    async ping() {
      return true;
    },
    async upsertUser(nickname, data = {}) {
      const prev = users.get(nickname) || {};
      const next = { ...prev, ...data, nickname, updatedAt: Date.now() };
      users.set(nickname, next);
      return next;
    },
    async getUser(nickname) {
      return users.get(nickname) || null;
    },
    async close() {},
  };
}

module.exports = { createMemoryStore };
