'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveStoreKind, createStore } = require('../server/store');

test('테스트 환경은 STORE=memory 가 강제된다', () => {
  assert.equal(process.env.STORE, 'memory');
  assert.equal(process.env.SUPABASE_URL, undefined);
  assert.equal(process.env.SUPABASE_SERVICE_KEY, undefined);
});

test('STORE=memory 면 키가 있어도 memory', () => {
  assert.equal(resolveStoreKind({ STORE: 'memory', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_KEY: 'k' }), 'memory');
});

test('STORE 비어 있으면 키 유무로 결정', () => {
  assert.equal(resolveStoreKind({}), 'memory');
  assert.equal(resolveStoreKind({ SUPABASE_URL: 'https://x.supabase.co' }), 'memory');
  assert.equal(resolveStoreKind({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_KEY: 'k' }), 'supabase');
});

test('STORE=supabase 여도 키가 없으면 memory 폴백', () => {
  assert.equal(resolveStoreKind({ STORE: 'supabase' }), 'memory');
});

test('createStore 는 현재(테스트) 환경에서 메모리 저장소를 만든다', async () => {
  const store = await createStore(process.env, { warn() {}, log() {} });
  assert.equal(store.kind, 'memory');
  await store.upsertUser('철수', { avatar: 'a' });
  const u = await store.getUser('철수');
  assert.equal(u.avatar, 'a');
  await store.close();
});
