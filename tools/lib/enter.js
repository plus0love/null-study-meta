'use strict';
/**
 * 헤드리스 브라우저 입장 도우미 (11단계): 입장 화면에서 닉네임을 넣고 → 로비가 뜨면 스터디를 골라(첫 카드/첫 목록) 없으면 만들어서 → 씬이 준비될 때까지.
 * 스크린샷 스크립트들이 서버 상태와 무관하게 방 안까지 들어가도록 한다. 주소에 ?study=CODE 를 붙였으면 로비를 건너뛴다.
 *   await enterRoom(page, { nickname: '민수', study: '검수용 스터디' })
 */
async function enterRoom(page, { nickname, study = '스크린샷 스터디', password = '' } = {}) {
  await page.waitForSelector('#login:not([hidden])', { timeout: 60000 });
  await page.$eval('#login-nick', (el) => { el.value = ''; });
  await page.type('#login-nick', nickname);
  if (password && !(await page.$eval('#login-pass-field', (el) => el.hidden))) await page.type('#login-pass', password);
  await page.click('#login-submit');
  await enterFromLobby(page, { study });
}

/** 입장 버튼을 이미 눌렀을 때: 로비가 뜨면 스터디를 골라(없으면 만들어) 방 안까지 */
async function enterFromLobby(page, { study = '스크린샷 스터디' } = {}) {
  await page.waitForFunction(() => (window.NSM && window.NSM.scene.me) || !document.getElementById('lobby').hidden, { timeout: 30000 });
  if (await page.evaluate(() => Boolean(window.NSM && window.NSM.scene.me))) return;
  // 로비: 내 스터디 카드 → 다른 스터디 → 없으면 만들기
  const card = await page.$('#lobby-mine .study-card');
  const other = card ? null : await page.$('#lobby-others li[data-code] button');
  if (card) await card.click();
  else if (other) await other.click();
  else {
    await page.click('#lobby-create');
    await page.waitForSelector('#study-create:not([hidden])');
    await page.type('#sc-name', study);
    await page.click('#sc-submit');
  }
  await page.waitForFunction(() => window.NSM && window.NSM.scene.me && document.getElementById('lobby').hidden, { timeout: 30000 });
}

module.exports = { enterRoom, enterFromLobby };
