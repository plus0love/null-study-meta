'use strict';
/**
 * Supabase 영구 저장소 (service_role 키, 서버 전용).
 * 스키마는 다음 단계에서 supabase/schema.sql 로 추가한다.
 */
function createSupabaseStore({ url, key }) {
  const { createClient } = require('@supabase/supabase-js');
  const client = createClient(url, key, { auth: { persistSession: false } });
  return {
    kind: 'supabase',
    async ping() {
      const { error } = await client.from('users').select('nickname', { head: true, count: 'exact' }).limit(1);
      if (error) throw new Error(error.message);
      return true;
    },
    async upsertUser(nickname, data = {}) {
      const { data: row, error } = await client
        .from('users')
        .upsert({ nickname, ...data, updated_at: new Date().toISOString() }, { onConflict: 'nickname' })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return row;
    },
    async getUser(nickname) {
      const { data: row, error } = await client.from('users').select('*').eq('nickname', nickname).maybeSingle();
      if (error) throw new Error(error.message);
      return row;
    },
    async close() {},
  };
}

module.exports = { createSupabaseStore };
