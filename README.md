# 📚 Null Study Meta

2D 탑뷰 멀티플레이 **스터디 메타버스**. 밤의 아늑한 스터디 카페 "우리의 스터디룸"에서 같이 공부하는 공간을 만듭니다.

> **현재 단계: 2단계 — 멀티플레이 기본 기능.** 닉네임으로 입장해 다른 접속자와 같은 방을 걸어다니고(서버 이동 검증),
> 의자·푸프·소파에 앉고(E), 채팅·이모지·공부/휴식 상태·공용 뽀모도로를 공유합니다. 끊겨도 30초 안에 같은 세션으로 이어집니다.

![목업과 게임 비교](screenshots/compare.png)

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
│   ├── index.js              # Express 부트스트랩, /healthz, /api/rooms/studyroom, Socket.io 부착
│   ├── socket.js             # 소켓 프로토콜 배선 (join/move/sit/chat/emoji/pomodoro/time:ping/leave)
│   ├── game/
│   │   ├── world.js          # 방 실시간 상태: 플레이어·세션 토큰·좌석 점유·상태·유예 정리 (소켓과 무관한 순수 로직)
│   │   ├── movement.js       # 발 박스 충돌 + "경과 시간 × 최대 속도 × 1.5" 이동 예산 검증
│   │   ├── nickname.js       # 닉네임 규칙(문자·숫자·공백·_- 12자) + 중복 시 "이름2"
│   │   ├── chat.js           # 200자·HTML 이스케이프·300ms 도배 방지
│   │   └── pomodoro.js       # 공용 뽀모도로 25/5 자동 전환 (서버 시각 기준)
│   ├── rooms/
│   │   ├── build.js          # RoomBuilder: tiles.json 기준으로 레이어 배열 + 충돌/의자/문/조명 생성, 판정 함수
│   │   └── studyroom.js      # "우리의 스터디룸" 46x34 타일 정의
│   └── store/                # index.js(선택/폴백), memory.js, supabase.js
├── public/
│   ├── index.html, css/style.css
│   ├── js/main.js            # 부트스트랩: 방 데이터 fetch → Phaser 생성 → Net·UI·씬 연결, 입장/재입장 흐름
│   ├── js/net.js             # 소켓 래퍼: join/재접속(세션 토큰 localStorage), 서버 시각 동기화, 20Hz 이동 전송
│   ├── js/ui.js              # HUD(방 이름·인원·설정·멤버·알림·나가기) + 사이드바(미니맵·할 일·뽀모도로·채팅) + 이모지 바·입장 모달
│   ├── js/scenes/RoomScene.js# 타일맵 3레이어, 내 아바타(입력·충돌·서버 보정), 원격 아바타(선형 보간), 말풍선/이모지/상태 아이콘, 조명
│   └── assets/               # tiles.png / tiles.json (아틀라스), player.png / player.json, CREDITS.txt
├── tools/
│   ├── fetch_assets.py       # 외부 에셋 원본 다운로드 → tools/raw/ (git 제외)
│   ├── build_assets.py       # 아틀라스 + 캐릭터 시트 빌드 (16px 논리 → 32px, nearest)
│   ├── recolor.py            # 팔레트 리컬러 (Kenney 원색 → 목업의 따뜻한 파스텔/우드 톤)
│   ├── pixel.py              # 픽셀 드로잉 도우미 + 3x5 픽셀 폰트
│   ├── props.py, props_room.py, props_v2.py # 팩에 없는 소품을 코드로 그림 (창문, 보드, 소파, 유리벽, 커피머신, 벤치 …)
│   ├── render_map.py         # 서버 방 데이터를 PNG 로 합성 (배치/충돌 검수)
│   ├── screenshot.js         # puppeteer-core 로 게임 스크린샷 (2탭 접속 / 채팅 / 착석 / 전체 맵)
│   └── lib/walk.js           # 헤드리스 브라우저에서 키보드로 한 타일씩 걷기 (테스트·스크린샷 공용)
├── test/                     # node:test — setup.js 가 STORE=memory 강제 (단위 · 소켓 E2E · 지연 프록시 · 헤드리스 2탭)
└── screenshots/compare.png   # 목업 vs 게임 비교
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
| `socket.test.js` | 소켓 E2E: 입장/중복 닉네임, playerMoved 가 발신자에게 안 감, move:correct 는 본인에게만, 착석/상태/아바타, 채팅/이모지, 뽀모도로 동기화, 토큰 재접속·옛 소켓 정리·유예 만료 |
| `latency.test.js` | TCP 지연 프록시(편도 300ms)로 두 명이 20Hz 이동 → 거부 0건, 상대·서버·새 입장자 모두 같은 최종 위치 |
| `browser.test.js` | 헤드리스 Chrome 2탭(B 는 300ms 지연): 입장 → 키보드 이동이 상대 화면에 같은 위치 → 채팅(입력 중 이동 차단, HTML 미렌더) → 이모지 → 소파까지 걸어가 E 착석 → 소켓 강제 종료 후 이어받기 → 나가기. Chrome 이 없으면 건너뜀 (`CHROME_PATH`) |
| `room.test.js`, `server.test.js`, `store.test.js` | 방 데이터·충돌·도달성, HTTP 엔드포인트·socket.io 클라이언트 서빙, 저장소 폴백 |

## 소켓 프로토콜

클라이언트 → 서버는 ack 콜백으로 결과를 받습니다. 서버 → 클라이언트 알림은 이름 그대로 브로드캐스트됩니다.

| 클라이언트 → 서버 | ack / 결과 |
|---|---|
| `join { nickname, token?, avatar? }` | `{ ok, resumed, token, self, players, seats, pomodoro, config, serverTime }` — `token` 이 살아 있으면 기존 플레이어를 이어받고 옛 소켓은 즉시 끊음 |
| `move { x, y, facing, moving }` (20Hz, volatile) | 통과 시 다른 사람에게만 `playerMoved`. 거부(예산 초과·벽·착석 중) 시 **본인에게만** `move:correct { x, y, reason }` |
| `sit { seatId }` / `stand` | 점유·거리(56px) 검사 → 모두에게 `playerSat` / `playerStood` |
| `status { study \| rest }`, `avatar { 0..3 }` | `playerStatus`, `playerAvatar` |
| `chat { text }` | 200자·이스케이프·300ms 검사 → 모두에게 `chat { id, nickname, text, ts }` |
| `emoji { index 0..5 }` | `playerEmoji { id, emoji }` |
| `pomodoro:start` / `pomodoro:stop` | `pomodoro { running, phase, startedAt, endsAt, startedBy, serverTime }` (자동 전환 때도) |
| `time:ping { t0 }` | `{ t0, serverTime }` — 클라이언트가 왕복/2 를 빼서 시계 차이를 맞춤 |
| `leave` | 즉시 정리 → `playerLeft` |

그 밖에 `playerJoined`, `playerLeft { id, nickname, reason }`, `playerDisconnected`, `playerReconnected`, `roomCount { count }`.

이동 검증은 **예산 방식**입니다: 마지막 이동 이후 경과 시간 × 최대 속도(150px/s) × 1.5 만큼 예산이 쌓이고(상한 0.5초치),
이동 거리만큼 소모합니다. 지연으로 패킷이 몰려 와도 통과하고, 순간이동은 거부됩니다. 거부되면 클라이언트는 순간이동 없이 서버 위치로 부드럽게 수렴합니다.
원격 아바타는 받은 스냅샷을 100ms 늦게 두 점 사이 **선형 보간**으로 그립니다.

## 방 데이터 형식 (`GET /api/rooms/studyroom`)

```jsonc
{
  "id": "studyroom", "name": "우리의 스터디룸", "width": 46, "height": 34, "tileSize": 32,
  "layers": { "floor": [[...]], "furniture": [[...]], "top": [[...]] },  // 아틀라스 타일 인덱스, 빈 칸 -1
  "collision": [[true, false, ...]],
  "seats": [{ "id": "seat-0", "x": 19, "y": 6, "facing": "down", "kind": "sofa_wide" }],
  "doors": [{ "id": "study1-l", "x": 16, "y": 21, "to": null }],
  "lights": [{ "x": 560, "y": 77, "r": 83, "color": 16758876, "intensity": 0.55 }],  // 픽셀 좌표
  "labels": [{ "x": 240, "y": 128, "text": "Good ... Tomorrow", "font": "hand", "size": 24, "color": "#e8dcc4", ... }],
  "spawn": { "x": 720, "y": 768 }
}
```

- `server/rooms/studyroom.js` 는 `RoomBuilder` 로 오브젝트를 타일 좌표에 놓기만 하고, 레이어 배열·충돌·좌석·문은
  `public/assets/tiles.json` 의 오브젝트 정의(크기, `layer`, `solid`, `top` 행 수, `seats`, `door`)에서 자동으로 만들어집니다.
- 화분 윗부분, 스탠드 램프 갓, 가로등 머리, 창가 덩굴처럼 **아바타 앞에 와야 하는 것은 `top` 레이어**(통과 가능)로 갑니다.
- 클라이언트는 이 배열을 그대로 Phaser 타일맵 3개 레이어로 그립니다 (클라이언트에 맵 하드코딩 없음).

## 비주얼

- **색감**: 따뜻한 원목 바닥, 어두운 차콜 벽, 앰버 조명, 짙은 초록 식물. Kenney 팩의 채도 높은 주황/초록은 `tools/recolor.py` 로 변환.
- **조명**: 실내는 밝게 두고(어둠 오버레이 20%), 램프·펜던트 주변을 라이트 마스크로 지우고 앰버 글로우(가산 합성, 천천히 흔들림)를 올려
  "밝은 데 더 따뜻한 조명" 느낌. 밤 분위기는 CSS 비네팅과 창밖으로만 냅니다. 조명 위치는 방 데이터의 `lights`.
- **창문**: 14×5 타일, 건물 실루엣 3겹 + 창 불빛 3프레임을 타일 인덱스 교체로 제각각 깜빡임. 줄 달린 펜던트 5개는 창문 타일에 포함.
- **글자**: 칠판·보드·표지판 글자는 타일에 굽지 않고 `labels` 로 내려 Phaser 텍스트로 그립니다.
  손글씨는 [Gaegu](https://fonts.google.com/specimen/Gaegu), 산세리프는 [Pretendard](https://github.com/orioncactus/pretendard) (둘 다 OFL, CDN 로드).
- **바닥/벽**: 널빤지 3톤 + 이음새 바닥, 벽 상단 몰딩 띠 + 벽 아래 그림자 한 줄, 테두리·패턴(격자/도트/다이아) 러그.

## 에셋

원본은 `tools/raw/` (git 제외)에 두고, 가공본만 `public/assets/` 에 둡니다. 출처·제작자·라이선스는
[`public/assets/CREDITS.txt`](public/assets/CREDITS.txt).

| 용도 | 에셋 | 라이선스 |
|---|---|---|
| 의자·카운터·액자·작은 화분 | Kenney *Roguelike Indoors* | CC0 |
| 캐릭터(치비 16×32, 4방향 4프레임 걷기) | ArMM1998 *Zelda-like tilesets and sprites* (OpenGameArt) | CC0 |
| 나머지 대부분 (바닥·벽·창문·보드·소파·유리벽·커피머신·벤치 …) | 이 저장소에서 코드로 그린 오리지널 | 프로젝트 라이선스 |

다시 빌드하려면 (Python 3.9+, Pillow):

```bash
python tools/fetch_assets.py     # 원본 다운로드
python tools/build_assets.py     # public/assets/tiles.png, tiles.json, player.png, player.json
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

## 다음 단계

- Supabase 스키마와 공부 시간 기록 (앉아 있는 시간·뽀모도로 회차)
- 유리문/입구 `doors` 로 방 이동, 실외 연결
- 앉은 자세 프레임, 아바타 커스터마이즈 확장
