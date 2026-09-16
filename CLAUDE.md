# CLAUDE.md — null-study-meta 작업 규칙

2D 탑뷰 멀티플레이 **스터디 메타버스**. 아래 규칙은 이 저장소에서 작업하는 동안 항상 지킨다.

## 스택 (고정)
- **Node 24** (`.node-version` = 24, `package.json` engines `node>=22`).
- 서버: **Node + Express + Socket.io**. 정적 파일(`public/`)도 같은 서버가 서빙.
- 클라이언트: **Phaser 3 (CDN)**, 순수 HTML/CSS/JS. **빌드 도구 없음** (번들러·트랜스파일러 금지).
- 저장소: **Supabase**. `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` 가 없으면 **메모리 저장소로 자동 폴백**.

## 테스트
- 테스트는 **절대 실제 Supabase 로 나가지 않는다.** 테스트 프로세스와 테스트가 띄우는 서버는 `STORE=memory` 를 **강제**하고 `SUPABASE_*` 를 제거한다 (`test/setup.js`).
- `npm test` 는 Node 내장 `node:test` 러너 사용. 외부 네트워크 의존 금지.

## 작업 습관
- 확인용으로 띄운 **서버 프로세스는 작업이 끝나면 반드시 종료**한다 (백그라운드로 남기지 않는다).
- **커밋은 사용자가 직접 한다.** `git commit` / `git push` 를 임의로 실행하지 않는다.
- `.env` 는 절대 읽어서 값을 출력하거나 커밋하지 않는다.

## 외부 에셋
- 라이선스가 **CC0 / CC-BY / "무료 상업 이용 가능" 이 명시**된 것만 사용한다. 확인 불가·모호한 에셋은 쓰지 않는다 (CC-BY-SA·GPL·itch "free but no commercial" 은 피한다).
- 사용한 모든 외부 에셋은 `public/assets/CREDITS.txt` 에 **출처 URL · 제작자 · 라이선스 · 수정 여부** 를 기록한다. 직접 그린 소품도 "오리지널" 로 표기한다.
- 팩 색감이 목업(`design/studyroom.png`)과 다르면 `tools/` 의 리컬러 스크립트로 톤을 맞춘다. 원본은 `tools/raw/` 아래에 두고 `public/assets/` 에는 가공본만 둔다.

## 맵/렌더 규약
- 타일 32px. 방 데이터는 `server/rooms/*.js` 에 레이어별 2D 배열(`floor` / `furniture` / `top`) + `collision` · `seats` · `doors` 정의. 클라이언트는 이 데이터를 받아 렌더한다 (클라이언트에 맵을 하드코딩하지 않는다).
- 아바타 앞에 와야 하는 것(화분 윗부분, 램프 갓, 창문 위 장식 등)은 `top` 레이어.
- Phaser `pixelArt: true`, 카메라는 내 아바타 추적, 캔버스는 비율 유지하며 화면을 채운다.

## 언어
- **답변, 커밋 메시지 제안, 문서(README·주석)는 모두 한국어.** 코드 식별자는 영어.
