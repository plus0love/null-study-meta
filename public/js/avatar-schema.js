/**
 * 아바타 값 검증 (서버·클라이언트 공용, catalog.json 기준).
 *  - 서버: require('../../public/js/avatar-schema') → createAvatarSchema(catalog)
 *  - 브라우저: window.AvatarSchema.createAvatarSchema(catalog)
 *
 * 아바타 객체: { skin, hair, hairColor, top, topColor, bottom, bottomColor, shoes, shoesColor, acc } (전부 catalog 의 id 문자열)
 * 4단계까지의 값(정수 0..3 = 셔츠 색, 또는 { shirt: n })도 받아서 상의 색으로 옮긴다. 없는 id·잘못된 값은 기본값.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AvatarSchema = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function createAvatarSchema(catalog) {
    const layers = catalog.layers;
    const colors = catalog.colors;
    const defaults = Object.freeze({ ...catalog.defaults });
    const legacyShirt = catalog.legacyShirt || [];

    // 필드 → 허용 id 목록 (파츠 필드는 레이어 items, 색 필드는 colors)
    const options = {};
    for (const layer of Object.values(layers)) {
      if (layer.field) options[layer.field] = layer.items.map((it) => it.id);
      if (layer.colorField) options[layer.colorField] = colors[layer.colorField].map((c) => c.id);
    }
    const fields = Object.keys(defaults);

    const pick = (field, value) => (typeof value === 'string' && options[field] && options[field].includes(value) ? value : defaults[field]);

    /** 무엇이 들어와도 유효한 아바타 객체를 돌려준다 (키 순서 고정 → key() 가 안정적) */
    function normalize(input) {
      let src = input;
      if (Number.isInteger(input)) src = { topColor: legacyShirt[input] };
      else if (input && typeof input === 'object' && Number.isInteger(input.shirt) && !('top' in input)) src = { ...input, topColor: legacyShirt[input.shirt] };
      if (!src || typeof src !== 'object') src = {};
      const out = {};
      for (const f of fields) out[f] = pick(f, src[f]);
      return out;
    }

    function isDefault(avatar) {
      const a = normalize(avatar);
      return fields.every((f) => a[f] === defaults[f]);
    }

    /** 텍스처 캐시 키 */
    function key(avatar) {
      const a = normalize(avatar);
      return fields.map((f) => a[f]).join('|');
    }

    function random(rng = Math.random) {
      const one = (list) => list[Math.floor(rng() * list.length)];
      const out = {};
      for (const f of fields) out[f] = options[f] ? one(options[f]) : defaults[f];
      // 액세서리는 절반 확률로 없음
      if (options.acc && rng() < 0.5) out.acc = defaults.acc;
      return normalize(out);
    }

    return { normalize, isDefault, key, random, defaults, fields, options, catalog };
  }

  return { createAvatarSchema };
});
