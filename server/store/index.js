'use strict';
/**
 * 저장소 선택.
 *  - STORE=memory          → 메모리 (테스트는 항상 이 값이 강제됨)
 *  - STORE=supabase        → Supabase (키 없거나 연결 실패 시 경고 후 메모리 폴백)
 *  - STORE 비어 있음       → SUPABASE_URL + SUPABASE_SERVICE_KEY 가 있으면 supabase, 아니면 memory
 */
const { createMemoryStore } = require('./memory');

/** 어떤 저장소를 쓸지 + 메모리가 된 이유(값은 절대 찍지 않는다) */
function resolveStore(env = process.env) {
  const explicit = (env.STORE || '').trim().toLowerCase();
  const url = (env.SUPABASE_URL || '').trim();
  const key = (env.SUPABASE_SERVICE_KEY || '').trim();
  const missing = [!url && 'SUPABASE_URL', !key && 'SUPABASE_SERVICE_KEY'].filter(Boolean);
  if (explicit === 'memory') return { kind: 'memory', reason: 'STORE=memory' };
  if (missing.length) return { kind: 'memory', reason: `${missing.join(', ')} 없음${explicit === 'supabase' ? ' (STORE=supabase 인데 키가 비어 있음)' : ''}` };
  if (explicit && explicit !== 'supabase') return { kind: 'memory', reason: `STORE=${explicit} 는 알 수 없는 값` };
  return { kind: 'supabase', reason: null };
}

function resolveStoreKind(env = process.env) {
  return resolveStore(env).kind;
}

async function createStore(env = process.env, log = console) {
  const { kind, reason } = resolveStore(env);
  if (kind === 'supabase') {
    try {
      const { createSupabaseStore } = require('./supabase');
      const store = createSupabaseStore({ url: env.SUPABASE_URL.trim(), key: env.SUPABASE_SERVICE_KEY.trim() });
      await store.ping();
      return store;
    } catch (err) {
      log.warn(`[store] Supabase 연결 실패 → 메모리 저장소로 폴백: ${err.message}`);
      return createMemoryStore();
    }
  }
  log.log(`[store] 메모리 저장소 사용 (${reason}) — 영구 저장 없음`);
  return createMemoryStore();
}

module.exports = { createStore, resolveStoreKind, resolveStore };
