/**
 * 유튜브 카드 도우미 (순수 함수, UMD — node 테스트에서도 사용).
 *   parseYoutube(str)   영상/재생목록 URL 또는 11자 ID → { videoId, listId } | null
 *   canonicalUrl(entry) oEmbed 조회용 표준 URL
 *   pushRecent(list, entry, max) 최근 목록 (중복 제거, 앞에 추가, 최대 5개)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Music = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);
  const VIDEO_ID = /^[\w-]{11}$/;
  const LIST_ID = /^[\w-]{10,}$/;
  const RECENT_MAX = 5;

  function parseYoutube(raw) {
    const s = String(raw || '').trim();
    if (!s) return null;
    if (VIDEO_ID.test(s)) return { videoId: s, listId: null };
    let u;
    try {
      u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    } catch (_) {
      return null;
    }
    if (!HOSTS.has(u.hostname.toLowerCase())) return null;
    const list = u.searchParams.get('list');
    const listId = list && LIST_ID.test(list) ? list : null;
    let videoId = null;
    const v = u.searchParams.get('v');
    if (v && VIDEO_ID.test(v)) videoId = v;
    if (!videoId) {
      const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{11})(?:[/?]|$)/);
      if (m) videoId = m[1];
    }
    if (!videoId && u.hostname.endsWith('youtu.be')) {
      const m = u.pathname.match(/^\/([\w-]{11})(?:[/?]|$)/);
      if (m) videoId = m[1];
    }
    if (!videoId && !listId) return null;
    return { videoId, listId };
  }

  function canonicalUrl(entry) {
    if (entry.videoId) return `https://www.youtube.com/watch?v=${entry.videoId}${entry.listId ? `&list=${entry.listId}` : ''}`;
    return `https://www.youtube.com/playlist?list=${entry.listId}`;
  }

  function keyOf(entry) {
    return `${entry.videoId || ''}|${entry.listId || ''}`;
  }

  /** 최근 목록: 같은 항목은 앞으로 올리고, 최대 max 개 */
  function pushRecent(list, entry, max = RECENT_MAX) {
    const k = keyOf(entry);
    const rest = (Array.isArray(list) ? list : []).filter((e) => e && keyOf(e) !== k);
    return [{ videoId: entry.videoId || null, listId: entry.listId || null, title: entry.title || '' }, ...rest].slice(0, max);
  }

  return { parseYoutube, canonicalUrl, keyOf, pushRecent, RECENT_MAX };
});
