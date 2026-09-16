/* global Phaser, RoomScene */
/**
 * 부트스트랩: 방 데이터 / 아틀라스 메타 / 아바타 메타를 받아 Phaser 게임을 만든다.
 * 소켓 연결은 다음 단계에서 이 파일에 붙는다.
 */
(async function main() {
  'use strict';

  const loading = document.getElementById('loading');
  const fail = (msg) => {
    if (loading) loading.textContent = msg;
    console.error(msg);
  };

  let room;
  let tiles;
  let player;
  try {
    [room, tiles, player] = await Promise.all([
      fetch('/api/rooms/studyroom').then((r) => r.json()),
      fetch('/assets/tiles.json').then((r) => r.json()),
      fetch('/assets/player.json').then((r) => r.json()),
    ]);
  } catch (err) {
    fail(`방 데이터를 불러오지 못했습니다: ${err.message}`);
    return;
  }

  const roomName = document.getElementById('room-name');
  if (roomName) roomName.textContent = room.name;

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    pixelArt: true,
    roundPixels: true,
    backgroundColor: '#14111a',
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: 960,
      height: 540,
    },
    scene: [],
  });
  game.scene.add('room', RoomScene, true, { room, tiles, player });

  // 디버그/테스트용 전역 핸들
  window.NSM = { game, room };
})();
