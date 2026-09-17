'use strict';
/**
 * 테스트 러너 (11단계): 두 그룹으로 나눠 돌린다.
 *  - unit: 순수 로직 테스트 → node --test 기본(병렬).
 *  - e2e:  서버를 띄우는 소켓·브라우저(puppeteer)·지연 프록시 테스트 → --test-concurrency=1 로 직렬.
 *          (병렬로 돌리면 Chrome 여러 개 + 타이머 부하로 이동 전송·지연 호출이 밀려 가끔 실패했다)
 * 분류는 파일 내용으로 자동: boot( · startServer( · puppeteer · startDelayProxy 중 하나라도 있으면 e2e.
 *   node test/run.js          → unit 그룹 후 e2e 그룹 (하나라도 실패하면 종료 코드 1)
 *   node test/run.js --unit   → unit 만
 *   node test/run.js --e2e    → e2e 만
 *   node test/run.js --list   → 분류만 출력
 * 항상 test/setup.js 를 먼저 주입해 STORE=memory 를 강제한다 (실제 Supabase 로 나가지 않는다).
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const TEST_DIR = __dirname;
const E2E_MARKERS = [/\bboot\(/, /\bstartServer\(/, /puppeteer/, /startDelayProxy/];

function classify() {
  const files = fs.readdirSync(TEST_DIR).filter((f) => f.endsWith('.test.js')).sort();
  const unit = [];
  const e2e = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(TEST_DIR, f), 'utf8');
    (E2E_MARKERS.some((re) => re.test(src)) ? e2e : unit).push(path.join('test', f));
  }
  return { unit, e2e };
}

function run(label, files, extraArgs = []) {
  if (!files.length) return 0;
  console.log(`\n── ${label} (${files.length} files${extraArgs.includes('--test-concurrency=1') ? ', 직렬' : ', 병렬'}) ──`);
  const r = spawnSync(process.execPath, ['--test', ...extraArgs, '--import', './test/setup.js', ...files], { stdio: 'inherit', cwd: path.join(TEST_DIR, '..'), env: { ...process.env, STORE: 'memory' } });
  return r.status === null ? 1 : r.status;
}

function main(argv) {
  const { unit, e2e } = classify();
  if (argv.includes('--list')) {
    console.log('unit (병렬):\n  ' + unit.join('\n  '));
    console.log('e2e (직렬):\n  ' + e2e.join('\n  '));
    return 0;
  }
  const onlyUnit = argv.includes('--unit');
  const onlyE2e = argv.includes('--e2e');
  let code = 0;
  if (!onlyE2e) code = Math.max(code, run('unit', unit));
  if (!onlyUnit) code = Math.max(code, run('e2e', e2e, ['--test-concurrency=1']));
  return code;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { classify, E2E_MARKERS };
