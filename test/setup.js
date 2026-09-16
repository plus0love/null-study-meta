// 모든 테스트 프로세스에 선주입: 실제 Supabase 로 절대 나가지 않도록 강제한다.
process.env.STORE = 'memory';
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_KEY;
