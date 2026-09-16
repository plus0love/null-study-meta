# 📚 Null Study Meta

2D 탑뷰 멀티플레이 **스터디 메타버스**. 밤의 아늑한 스터디 카페 "우리의 스터디룸"에서 같이 공부하는 공간을 만듭니다.

> **현재 단계: 3단계 — 맵 정리 + 공간 연출.** 닉네임으로 입장해 다른 접속자와 같은 방을 걸어다니고(서버 이동 검증),
> 의자·푸프·소파에 앉고(E), 채팅·이모지·공부/휴식 상태·공용 뽀모도로를 공유합니다. 끊겨도 30초 안에 같은 세션으로 이어집니다.
> 라운지의 갈색 푸들 "사랑" 은 서버가 움직이는 NPC 로, 가까이 가면 쳐다보고 E 로 쓰다듬을 수 있습니다.
> 3단계에서는 목업처럼 두께감 있는 유리 스터디룸·슬라이딩 문으로 맵을 정리하고, 책상에 앉으면 모니터가 켜지고,
> 커피머신 앞에서 E 로 ☕ 휴식, 창밖은 실제 시각에 따라 낮/노을/밤으로 바뀌며, 뽀모도로 전환 연출과 유튜브 카드가 붙었습니다.

![목업과 게임 비교](screenshots/compare_mockup.png)

| 낮 (06~17시) | 노을 (17~19시) | 밤 (19~06시) |
|---|---|---|
| ![낮](screenshots/s3_day.png) | ![노을](screenshots/s3_sunset.png) | ![밤](screenshots/s3_night.png) |

![스터디룸 확대 — 책상에 앉으면 모니터가 켜진다](screenshots/s3_study_zoom.png)

## 기술 스택

| 영역 | 사용 기술 |
|---|---|
| 런타임 | Node.js 24 (`.node-version`), 최소 22 (`engines`) |
| 서버 | Express (정적 파일 + `/healthz` + `/api/rooms/studyroom`) + Socket.io (`server/socket.js`) |
| 클라이언트 | Phaser 3.87 (CDN), 순수 HTML/CSS/JS — **빌드 도구 없음** |
| 저장소 | Supabase (`SUPABASE_URL` + `SUPABASE_SERVICE_KEY`), 키가 없으면 **메모리 저장소로 자동 폴백** |
| 에셋 도구 | Python 3 + Pillow (아틀라스/캐릭터 빌드, 리컬러). 빌드 결과물은 커밋되므로 실행 시에는 필요 없음 |

## 폴더 구조

```
null-study-meta/
├── CLAUDE.md                 # 작업 규칙 (스택 고정, 테스트는 STORE=memory 강제, 에셋 라이선스 등)
├── package.json              # start / dev / test / build:assets
├── .node-version             # 24
├── .env.example              # 환경변수 템플릿 (.env 로 복사)
├── render.yaml               # Render free 플랜 Blueprint (NODE_VERSION=24, healthCheck /healthz)
├── design/studyroom.png      # 목업 (방 배치·색감 기준)
├── server/
│   ├── index.js              # Express 부트스트랩, /healthz, /api/rooms/studyroom, /api/oembed(유튜브 제목 프록시), Socket.io 부착
│   ├── socket.js             # 소켓 프로토콜 배선 (join/move/sit/status/interact/listening/chat/emoji/pomodoro/time:ping/leave/npc:*)
│   ├── game/
│   │   ├── world.js          # 방 실시간 상태: 플레이어·세션 토큰·좌석 점유·상태(공부/휴식/☕)·상호작용·듣는 중·유예 정리 (순수 로직)
│   │   ├── movement.js       # 발 박스 충돌 + "경과 시간 × 최대 속도 × 1.5" 이동 예산 검증
│   │   ├── nickname.js       # 닉네임 규칙(문자·숫자·공백·_- 12자) + 중복 시 "이름2"
│   │   ├── chat.js           # 200자·HTML 이스케이프·300ms 도배 방지
│   │   ├── pomodoro.js       # 공용 뽀모도로 25/5 자동 전환 (서버 시각 기준)
│   │   └── npc.js            # 강아지 NPC: 어슬렁/앉기/자기/산책 상태기계, BFS 경로(충돌 준수), 쳐다보기, 쓰다듬기 쿨다운, 이름
│   ├── rooms/
│   │   ├── build.js          # RoomBuilder: tiles.json 기준으로 레이어 배열 + 충돌/의자/문/조명/창문/구역/화면/상호작용 지점 생성
│   │   └── studyroom.js      # "우리의 스터디룸" 46x34 타일 정의 (3단계: 유리 스터디룸·식물 정리·수납장/선반 채우기)
│   └── store/                # index.js(선택/폴백), memory.js, supabase.js
├── public/
│   ├── index.html, css/style.css
│   ├── js/main.js            # 부트스트랩: 방 데이터 fetch → Phaser 생성 → Net·UI·씬·FX 연결, 입장/재입장 흐름
│   ├── js/net.js             # 소켓 래퍼: join/재접속(세션 토큰 localStorage), 서버 시각 동기화, 20Hz 이동 전송
│   ├── js/ui.js              # HUD(방 이름·인원·뽀모도로 배지·설정·멤버·알림·♪·나가기) + 사이드바(미니맵·할 일·뽀모도로·유튜브·채팅) + 이모지 바·입장 모달
│   ├── js/daylight.js        # 시간대 가중치(낮/노을/밤, 경계 30분) + 하늘 팔레트 + 실내 연출 강도 (순수 함수, 테스트 공용)
│   ├── js/music.js           # 유튜브 URL 파싱 · 최근 5개 (순수 함수, 테스트 공용)
│   ├── js/fx.js              # Web Audio 합성 알림음 + 브라우저 알림 도우미
│   ├── js/scenes/RoomScene.js# 타일맵(floor/furniture/windowDay/top), 아바타, 하늘 그라데이션·별, 유리 구역 틴트·밝기, 화면 on/off, 상호작용 지점, 조명·플래시
│   └── assets/               # tiles.png / tiles.json (아틀라스), player.png / player.json, dog.png / dog.json, CREDITS.txt
├── tools/
│   ├── fetch_assets.py       # 외부 에셋 원본 다운로드 → tools/raw/ (git 제외)
│   ├── build_assets.py       # 아틀라스 + 캐릭터 시트 빌드 (16px 논리 → 32px, nearest)
│   ├── recolor.py            # 팔레트 리컬러 (Kenney 원색 → 목업의 따뜻한 파스텔/우드 톤)
│   ├── pixel.py              # 픽셀 드로잉 도우미 + 3x5 픽셀 폰트
│   ├── props.py, props_room.py, props_v2.py, props_v3.py # 팩에 없는 소품을 코드로 그림 (창문 밤/낮, 보드, 소파, 유리 파티션·슬라이딩 문, 수납장 …)
│   ├── dog_sprite.py         # 강아지 NPC 시트 (푸들 머리 + 직접 그린 4방향 걷기 2프레임·앉기(꼬리 2종)·자기 2프레임)
│   ├── render_map.py         # 서버 방 데이터를 PNG 로 합성 (배치/충돌 검수)
│   ├── screenshot.js         # puppeteer-core 로 게임 스크린샷 (2탭 접속 / 채팅 / 착석 / 전체 맵)
│   ├── screenshot_stage3.js  # 3단계 검수 컷: 낮/노을/밤, 스터디룸 확대(모니터 켜짐), 커피, 전체 맵
│   ├── compare_mockup.py     # 목업 | 게임 나란히 (screenshots/compare_mockup.png)
│   └── lib/walk.js           # 헤드리스 브라우저에서 키보드로 한 타일씩 걷기 (테스트·스크린샷 공용)
├── test/                     # node:test — setup.js 가 STORE=memory 강제 (단위 · 소켓 E2E · 지연 프록시 · 헤드리스 2탭)
└── screenshots/              # compare_mockup.png (목업 vs 게임), s3_day/sunset/night.png, s3_study_zoom.png, s3_coffee.png
```

## 로컬 실행

```bash
npm install          # Node 22+ (권장 24)
npm start            # http://localhost:3000  (개발 중 자동 재시작: npm run dev)
```

브라우저 탭을 두 개 열어 서로 다른 닉네임으로 입장하면 같은 방에서 만납니다.

| 조작 | 키 |
|---|---|
| 이동 | 방향키 / WASD (벽·가구·유리벽·화분 통과 불가, 유리 스터디룸은 미닫이문으로만) |
| 앉기 / 일어나기 | 의자·푸프·소파 옆에서 **E** (좌하단에 힌트가 뜸). 앉으면 자동으로 "공부 중" |
| 강아지 쓰다듬기 | 강아지 옆에서 **E** (더 가까운 쪽이 우선). 머리 위 ❤️ 1초 + 채팅 알림, 3초 쿨다운. 이름은 설정에서 변경(기본 "사랑", 모두에게 적용) |
| 채팅 | **Enter** 로 입력창 포커스 → Enter 전송, **Esc** 로 나가기. 입력 중엔 게임 키가 막힘 |
| 이모지 | **1 ~ 6** (좌하단 바 클릭도 가능). 머리 위 2초 |
| 상태 전환 | 좌하단 "공부 중 / 휴식 중" 버튼. 아바타 머리 위 📖 / ☕ |

- 화면: 좌상단 방 이름·인원, 우상단 설정(셔츠 색·닉네임 변경)·멤버·알림·나가기, 오른쪽 360px 사이드바에
  미니맵 · 오늘의 할 일(localStorage) · 공용 뽀모도로(25/5 자동 전환, 누구나 시작/정지, 서버 시각 기준) · 채팅.
- 캔버스는 사이드바를 뺀 영역에 꽉 차고(`Scale.RESIZE`) 카메라 줌 2배로 내 아바타를 따라갑니다. `pixelArt: true`.
- 재접속: 입장 시 받은 세션 토큰을 localStorage 에 두고, 끊기면 "재접속 중" 배너 → 같은 토큰으로 기존 플레이어를 이어받습니다
  (30초 유예). 서버가 재시작됐으면 저장된 닉네임·셔츠 색으로 새로 입장합니다.
- 다른 포트: `PORT=8080 npm start` (PowerShell: `$env:PORT=8080; npm start`).

### 테스트

```bash
npm test
```

`test/setup.js` 가 테스트 프로세스에 `STORE=memory` 를 강제하고 `SUPABASE_*` 를 제거하므로 **실제 Supabase 로 절대 나가지 않습니다.**

| 파일 | 내용 |
|---|---|
| `game.test.js` | 단위: 닉네임 규칙/중복, 이동 예산(정상 속도 허용·순간이동 거부·벽), 채팅 이스케이프/도배, 뽀모도로 자동 전환, 월드(좌석 점유·상태 복귀·유예 재접속) |
| `stage3.test.js` | 3단계: 커피머신 상호작용(거리·토글·앉으면 공부→일어나면 휴식), 듣는 중 제목, 소켓 `interact`/`listening` 브로드캐스트, oEmbed 프록시(가짜 fetch·캐시, 네트워크 없음), 시간대 가중치(경계 30분·합 1·팔레트), 유튜브 URL 파싱·최근 5개 |
| `npc.test.js` | 강아지: 결정적 난수로 20분 돌려도 막힌 칸에 안 들어감·모든 상태 순환·산책, 틱당 이동량, 쳐다보기, 쓰다듬기 쿨다운, 이름 규칙 + 소켓: 두 클라이언트가 같은 `npc:update` 를 받음, 쓰다듬기/이름 브로드캐스트 |
| `socket.test.js` | 소켓 E2E: 입장/중복 닉네임, playerMoved 가 발신자에게 안 감, move:correct 는 본인에게만, 착석/상태/아바타, 채팅/이모지, 뽀모도로 동기화, 토큰 재접속·옛 소켓 정리·유예 만료 |
| `latency.test.js` | TCP 지연 프록시(편도 300ms)로 두 명이 20Hz 이동 → 거부 0건, 상대·서버·새 입장자 모두 같은 최종 위치 |
| `browser.test.js` | 헤드리스 Chrome 2탭(B 는 300ms 지연): 입장 → 키보드 이동이 상대 화면에 같은 위치 → 채팅(입력 중 이동 차단, HTML 미렌더) → 이모지 → 소파까지 걸어가 E 착석 → 강아지 옆까지 걸어가 E 쓰다듬기(두 탭 ❤️·채팅·같은 위치) → 책상 착석 시 두 탭 모두 모니터 켜짐/일어나면 꺼짐 → 커피머신까지 걸어가 E ☕ 휴식(상대 멤버 목록 반영) → 시각 고정으로 낮/노을/밤 전환·항상 밤 → 시스템 메시지 ×N → 소켓 강제 종료 후 이어받기 → 나가기. Chrome 이 없으면 건너뜀 (`CHROME_PATH`) |
| `room.test.js`, `server.test.js`, `store.test.js` | 방 데이터·충돌·도달성, 유리 스터디룸 타일 구성·문·구역·화면·상호작용 지점·식물 수·낮 창문 레이어, HTTP 엔드포인트·socket.io 클라이언트 서빙, 저장소 폴백 |

## 소켓 프로토콜

클라이언트 → 서버는 ack 콜백으로 결과를 받습니다. 서버 → 클라이언트 알림은 이름 그대로 브로드캐스트됩니다.

| 클라이언트 → 서버 | ack / 결과 |
|---|---|
| `join { nickname, token?, avatar? }` | `{ ok, resumed, token, self, players, seats, pomodoro, config, serverTime }` — `token` 이 살아 있으면 기존 플레이어를 이어받고 옛 소켓은 즉시 끊음 |
| `move { x, y, facing, moving }` (20Hz, volatile) | 통과 시 다른 사람에게만 `playerMoved`. 거부(예산 초과·벽·착석 중) 시 **본인에게만** `move:correct { x, y, reason }` |
| `sit { seatId }` / `stand` | 점유·거리(56px) 검사 → 모두에게 `playerSat` / `playerStood` |
| `status { study \| rest }`, `avatar { 0..3 }` | `playerStatus`, `playerAvatar` |
| `interact { id }` | 상호작용 지점(`room.interactables`) 거리 검사. `coffee` 면 상태 `coffee`(☕ 휴식) ↔ `rest` 토글 → 모두에게 `playerStatus`. 앉으면 공부 중, 일어나면 휴식(커피 아님) |
| `listening { title \| null }` | 유튜브 재생 중 제목(≤80자) → 모두에게 `playerListening { id, listening }` (닉네임 옆 ♪, 멤버 목록 "듣는 중") |
| `chat { text }` | 200자·이스케이프·300ms 검사 → 모두에게 `chat { id, nickname, text, ts }` |
| `emoji { index 0..5 }` | `playerEmoji { id, emoji }` |
| `pomodoro:start` / `pomodoro:stop` | `pomodoro { running, phase, startedAt, endsAt, startedBy, serverTime }` (자동 전환 때도) |
| `time:ping { t0 }` | `{ t0, serverTime }` — 클라이언트가 왕복/2 를 빼서 시계 차이를 맞춤 |
| `leave` | 즉시 정리 → `playerLeft` |
| `npc:pet { id }` | 거리(56px)·3초 쿨다운 검사 → `npc:pet { id, by, playerId }` + 시스템 `chat { system: true, text }` |
| `npc:name { id, name }` | 문자·숫자·공백·_- 8자 → `npc:name { id, name }` |

강아지 NPC 는 서버가 행동을 정합니다 (`server/game/npc.js`): 라운지 러그 주변 어슬렁(40px/s) → 앉기 → 쿠션(24,9)에서 자기 → 가끔 방 안 산책(60px/s) 후 복귀.
이동은 타일 중심을 잇는 BFS 경로라 벽·가구를 지키고(쿠션 타일만 예외), 플레이어와는 겹칩니다. 플레이어가 48px 안에 오면 멈춰서 그쪽을 보고 꼬리를 흔듭니다(`look`).
`npc:update { id, kind, name, x, y, facing, state }` 를 걷는 동안 10Hz, 그 외엔 바뀔 때 + 1초 키프레임으로 보내고, 클라이언트는 100ms 늦게 선형 보간합니다. 입장 ack 의 `npcs` 에 현재 스냅샷이 들어 있습니다.

그 밖에 `playerJoined`, `playerLeft { id, nickname, reason }`, `playerDisconnected`, `playerReconnected`, `roomCount { count }`.
HTTP: `GET /api/oembed?url=…` 은 유튜브 주소만 받아 서버가 oEmbed 제목을 대신 가져옵니다(10분 캐시, 브라우저 CORS 우회). 테스트는 fetch 를 주입해 네트워크를 쓰지 않습니다.

이동 검증은 **예산 방식**입니다: 마지막 이동 이후 경과 시간 × 최대 속도(150px/s) × 1.5 만큼 예산이 쌓이고(상한 0.5초치),
이동 거리만큼 소모합니다. 지연으로 패킷이 몰려 와도 통과하고, 순간이동은 거부됩니다. 거부되면 클라이언트는 순간이동 없이 서버 위치로 부드럽게 수렴합니다.
원격 아바타는 받은 스냅샷을 100ms 늦게 두 점 사이 **선형 보간**으로 그립니다.

## 방 데이터 형식 (`GET /api/rooms/studyroom`)

```jsonc
{
  "id": "studyroom", "name": "우리의 스터디룸", "width": 46, "height": 34, "tileSize": 32,
  "layers": { "floor": [[...]], "furniture": [[...]], "windowDay": [[...]], "top": [[...]] },  // 아틀라스 타일 인덱스, 빈 칸 -1
  "collision": [[true, false, ...]],
  "seats": [{ "id": "seat-0", "x": 19, "y": 6, "facing": "down", "kind": "sofa_wide" }],
  "doors": [{ "id": "study1-l", "x": 14, "y": 21, "to": null }],
  "lights": [{ "x": 560, "y": 77, "r": 83, "color": 16758876, "intensity": 0.55 }],  // 픽셀 좌표
  "labels": [{ "x": 240, "y": 128, "text": "Good ... Tomorrow", "font": "hand", "size": 24, "color": "#e8dcc4", ... }],
  "windows": [{ "x": 448, "y": 0, "w": 448, "h": 144 }],                  // 창밖 하늘 사각형 (클라이언트가 시간대 그라데이션)
  "zones": [{ "id": "study1", "kind": "glass", "x": 384, "y": 384, "w": 256, "h": 288, "bright": 0.6 }],  // 유리 스터디룸: 밝게 + 틴트
  "screens": [{ "seatId": "seat-8", "kind": "monitor", "x": 480, "y": 388, "w": 32, "h": 14 }],           // 좌석 점유 시 켜지는 화면
  "interactables": [{ "id": "coffee", "kind": "coffee", "x": 208, "y": 512, "hint": "커피 마시기", "range": 56 }],
  "spawn": { "x": 720, "y": 768 }
}
```

- `server/rooms/studyroom.js` 는 `RoomBuilder` 로 오브젝트를 타일 좌표에 놓기만 하고, 레이어 배열·충돌·좌석·문은
  `public/assets/tiles.json` 의 오브젝트 정의(크기, `layer`, `solid`, `top` 행 수, `seats`, `door`)에서 자동으로 만들어집니다.
- 화분 윗부분, 스탠드 램프 갓, 가로등 머리, 창가 덩굴처럼 **아바타 앞에 와야 하는 것은 `top` 레이어**(통과 가능)로 갑니다.
- 클라이언트는 이 배열을 그대로 Phaser 타일맵 레이어로 그립니다 (클라이언트에 맵 하드코딩 없음). `windowDay` 는 낮 창문 타일로, 시간대 가중치만큼 알파를 올려 밤 창문 위에 겹칩니다.

## 비주얼

- **색감**: 따뜻한 원목 바닥, 어두운 차콜 벽, 앰버 조명, 짙은 초록 식물. Kenney 팩의 채도 높은 주황/초록은 `tools/recolor.py` 로 변환.
- **조명**: 실내는 밝게 두고(어둠 오버레이 20%), 램프·펜던트 주변을 라이트 마스크로 지우고 앰버 글로우(가산 합성, 천천히 흔들림)를 올려
  "밝은 데 더 따뜻한 조명" 느낌. 밤 분위기는 CSS 비네팅과 창밖으로만 냅니다. 조명 위치는 방 데이터의 `lights`.
- **창문 / 시간대**: 창문 타일의 하늘은 투명이고, 클라이언트가 `windows` 사각형에 **실제 시각 기준** 그라데이션을 그립니다
  (`public/js/daylight.js`: 06~17시 낮 하늘색·건물 밝음·불빛 적음, 17~19시 노을 주황→보라, 19~06시 밤. 경계마다 30분에 걸쳐 섞음).
  밤 건물(3프레임 깜빡임)은 `furniture` 레이어, 낮 건물은 `windowDay` 레이어에서 알파로 교차하고, 별은 밤 가중치만큼만 보입니다.
  실내 어둠 오버레이(20% → 낮 6%)와 앰버 글로우도 낮엔 약해집니다. 설정의 "창밖 항상 밤으로 고정" 으로 끌 수 있습니다.
- **유리 스터디룸**: 벽은 8px 차콜 프레임 띠 — 3타일마다·모서리·문 옆은 통짜 기둥(위·왼쪽 하이라이트, 오른쪽·아래 그림자)이고
  그 사이는 반투명 하늘빛 유리 판이라 바닥이 비칩니다. 안쪽(`zones`)은 어둠 레이어를 더 지워 다른 구역보다 밝고, 옅은 하늘빛 틴트와
  창가 쪽 사선 반사 한 줄을 올립니다. 슬라이딩 문은 프레임과 같은 톤의 2×4 패널(세로 손잡이·앰버 라인·이름 플라크), 열린 자리 2타일은 바닥 레일 + 앰버 조명.
- **화면 켜짐**: `screens` 의 좌석이 점유되면(서버 `playerSat`/`playerStood`/입장 ack `seats` 기준) 모니터·노트북 화면이 밝아지고 푸른 글로우가 켜집니다.
- **뽀모도로 전환**: 집중↔휴식 때 Web Audio 로 합성한 3음 차임(파일 없음, 설정에서 끔) + 창문·펜던트 글로우가 1초 밝아졌다 돌아오고,
  권한이 있으면 브라우저 알림. 좌상단 배지에 남은 시간이 뜹니다.
- **유튜브 카드**: "Music Always Helps" 패널 앞 E 또는 우상단 ♪ → 사이드바에 IFrame API 플레이어. 영상/재생목록 URL, 최근 5개(localStorage),
  재생/일시정지, 접기. 소리는 본인에게만 나고, 재생 중이면 닉네임 옆 ♪ + 멤버 목록에 "듣는 중: 제목"(oEmbed). 자동재생은 재생 버튼을 누른 뒤에만.
- **글자**: 칠판·보드·표지판 글자는 타일에 굽지 않고 `labels` 로 내려 Phaser 텍스트로 그립니다.
  손글씨는 [Gaegu](https://fonts.google.com/specimen/Gaegu), 산세리프는 [Pretendard](https://github.com/orioncactus/pretendard) (둘 다 OFL, CDN 로드).
- **바닥/벽**: 널빤지 3톤 + 이음새 바닥(3단계에서 채도를 낮추고 한 톤 깊은 갈색으로), 벽 상단 몰딩 띠 + 벽 아래 그림자 한 줄, 테두리·패턴(격자/도트/다이아) 러그.
- **식물**: 창가 양끝·스터디룸 각 1·커피 코너 1·입구 양옆·회의 구역 모서리만 남기고(10개), 빈 자리는 액자·벽 선반·수납장·코트 걸이·러그 확장으로 채웠습니다. 벽 덩굴은 창문 좌우에만.

## 에셋

원본은 `tools/raw/` (git 제외)에 두고, 가공본만 `public/assets/` 에 둡니다. 출처·제작자·라이선스는
[`public/assets/CREDITS.txt`](public/assets/CREDITS.txt).

| 용도 | 에셋 | 라이선스 |
|---|---|---|
| 의자·카운터·액자·작은 화분 | Kenney *Roguelike Indoors* | CC0 |
| 캐릭터(치비 16×32, 4방향 4프레임 걷기) | ArMM1998 *Zelda-like tilesets and sprites* (OpenGameArt) | CC0 |
| 강아지 NPC (16×24, 걷기 4방향×2·앉기·자기) | 이 저장소 오리지널 (`tools/dog_sprite.py`, 쿠션 위 푸들 그림 기준) | 프로젝트 라이선스 |
| 나머지 대부분 (바닥·벽·창문 밤/낮·보드·소파·유리 파티션·슬라이딩 문·수납장·커피머신·벤치 …) | 이 저장소에서 코드로 그린 오리지널 | 프로젝트 라이선스 |

다시 빌드하려면 (Python 3.9+, Pillow):

```bash
python tools/fetch_assets.py     # 원본 다운로드
python tools/build_assets.py     # public/assets/tiles.png, tiles.json, player.png, player.json
python tools/dog_sprite.py       # public/assets/dog.png, dog.json (원본 다운로드 불필요)
```

## 환경변수

| 이름 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `3000` | HTTP 포트 (Render 가 자동 주입) |
| `STORE` | (자동) | `memory` 또는 `supabase`. 비워두면 Supabase 키가 있을 때 `supabase`, 없으면 `memory` |
| `SUPABASE_URL` | – | Supabase 프로젝트 URL |
| `SUPABASE_SERVICE_KEY` | – | Supabase **service_role** 키 (서버 전용, 클라이언트 노출 금지) |

## Render 배포 (Free)

`render.yaml` 이 있어 **New + → Blueprint** 로 배포합니다. `NODE_VERSION=24`, `healthCheckPath: /healthz`,
`SUPABASE_URL` / `SUPABASE_SERVICE_KEY` 는 `sync: false` 라 대시보드에서 입력합니다 (지금 안 넣으면 메모리 저장소로 동작).
Free 플랜은 15분 무요청 시 잠들고, 재시작 시 메모리 상태가 초기화됩니다.

검수 스크린샷을 다시 찍으려면 서버를 띄운 뒤:

```bash
node tools/screenshot_stage3.js http://localhost:3000 screenshots   # 낮/노을/밤, 스터디룸 확대, 커피, 전체 맵
python tools/compare_mockup.py                                        # screenshots/compare_mockup.png
```

## 다음 단계

- Supabase 스키마와 공부 시간 기록 (앉아 있는 시간·뽀모도로 회차)
- 유리문/입구 `doors` 로 방 이동, 실외 연결
- 앉은 자세 프레임, 아바타 커스터마이즈 확장
- 강아지 상호작용 확장 (간식 주기, 따라오기)
