'use strict';
/**
 * 저장소 선택.
 *  - STORE=memory          → 메모리 (테스트는 항상 이 값이 강제됨)
 *  - STORE=supabase        → Supabase (키 없거나 연결 실패 시 경고 후 메모리 폴백)
 *  - STORE 비어 있음       → SUPABASE_URL + SUPABASE_SERVICE_KEY 가 있으면 supabase, 아니면 memory
 */
const { createMemoryStore } = require('./memory');

function resolveStoreKind(env = process.env) {
  const explicit = (env.STORE || '').trim().toLowerCase();
  const hasKeys = Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY);
  if (explicit === 'memory') return 'memory';
  if (explicit === 'supabase') return hasKeys ? 'supabase' : 'memory';
  return hasKeys ? 'supabase' : 'memory';
}

async function createStore(env = process.env, log = console) {
  const kind = resolveStoreKind(env);
  if (kind === 'supabase') {
    try {
      const { createSupabaseStore } = require('./supabase');
      const store = createSupabaseStore({ url: env.SUPABASE_URL, key: env.SUPABASE_SERVICE_KEY });
      await store.ping();
      return store;
    } catch (err) {
      log.warn(`[store] Supabase 연결 실패 → 메모리 저장소로 폴백: ${err.message}`);
    }
  }
  return createMemoryStore();
}

module.exports = { createStore, resolveStoreKind };
