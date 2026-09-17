'use strict';
/**
 * 아바타 카탈로그(public/assets/avatar/catalog.json) 로드 + 검증.
 * 검증 규칙은 클라이언트와 같은 파일(public/js/avatar-schema.js)을 쓴다: 없는 id·잘못된 값 → 기본값, 옛 정수 아바타 → 상의 색.
 */
const fs = require('node:fs');
const path = require('node:path');
const { createAvatarSchema } = require('../../public/js/avatar-schema');

const AVATAR_DIR = path.join(__dirname, '..', '..', 'public', 'assets', 'avatar');
const CATALOG_PATH = path.join(AVATAR_DIR, 'catalog.json');

const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
const schema = createAvatarSchema(catalog);

/** 레이어별 아이템 PNG 경로 목록 (테스트 · 에셋 버전 해시용) */
function assetFiles() {
  const out = [];
  for (const [name, layer] of Object.entries(catalog.layers)) {
    for (const it of layer.items) {
      if (it.file === null) continue;
      out.push(path.join(AVATAR_DIR, name, `${it.id}.png`));
    }
  }
  return out;
}

module.exports = {
  catalog,
  schema,
  normalizeAvatar: schema.normalize,
  avatarKey: schema.key,
  DEFAULT_AVATAR: schema.defaults,
  AVATAR_DIR,
  CATALOG_PATH,
  assetFiles,
};
