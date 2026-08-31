# VIKO Localize — Subtitle QA

Foreign Video → Natural Korean Subtitle. 제품 기준은 [PRD v2.0](docs/VIKO_Localize_PRD_v2.0.md)이며 이번 구현은 로컬 SRT/VTT 결정적 규칙 QA에 한정됩니다.

## 실행

Node.js 22 이상과 npm이 필요합니다. 검증 환경: Node 24.12.0 / npm 11.6.2.

```sh
npm ci
npm run dev
```

터미널의 Local URL에서 파일 선택 → 프리셋 선택 → QA 검사 실행 → 오류 필터 → Cue 원문/시간/수정 안내를 확인합니다. `tests/fixtures/valid.srt`, `valid.vtt`, `broken.srt`, `broken.vtt`로 재현할 수 있습니다.

```sh
npm test
npm run test:corpus
npm run test:e2e
npm run lint
npm run typecheck
npm run build
npm start
```

개발 서버와 `npm start`를 동시에 사용할 때는 다른 포트를 지정하세요: `npm start -- --port 3001`.

## 범위와 보안

- Next.js App Router, React, TypeScript, Tailwind. 별도 Web Worker에서 UTF-8 파싱과 QA를 실행합니다.
- 환경변수나 API 키는 **필요하지 않습니다**. Supabase, Vercel, AI 서비스와 연결하지 않습니다.
- 파일은 브라우저 메모리에서만 읽습니다. 원본 File 바이트와 트랙의 원본 텍스트를 유지하고, 서버·분석 서비스로 전송하지 않습니다. 원문·파일명·프리셋은 탭 단위 sessionStorage에 임시 저장합니다.
- 새로고침 시 저장된 입력으로 QA 결과를 재계산해 복원합니다. 직렬화 500,000 UTF-16 단위(약 1 MB) 한도, 저장 후 24시간까지 유효합니다. 새 파일/프리셋 선택 시 이전 저장본을 지우며, 삭제 버튼은 저장본과 현재 결과를 지웁니다. 저장 차단/용량 초과 시 QA는 계속 동작합니다. 장기 보관은 원본 파일을 사용하세요.
- 5 MiB / 10,000 Cue는 이번 버전의 기술적 입력 제한이며 무료 플랜 정책이 아닙니다.
- QA Profile v1은 General/Education/Shorts와 기존 SDH를 제공합니다. 임계값별 근거·버전·변경일을 포함하며 많은 수치는 temporary hypothesis입니다. 납품 인증, 맞춤법·번역 품질, 영상과의 싱크 정확성을 보증하지 않습니다.
- 여러 Cue가 겹치면 시간순 최대 종료 구간을 기준으로 대표 중복을 보고합니다. 모든 중복 쌍의 목록은 만들지 않습니다. 관련된 두 Cue 모두 문제 목록에 포함됩니다.
- VTT NOTE/STYLE/REGION은 원본에 보존하지만 렌더링하지 않습니다. 레이아웃 설정/스타일/모든 태그의 명세 적합성 검증은 이번 범위 밖입니다. 표시 태그는 안전한 텍스트로 보여줍니다.
- 입력 언어를 추측하지 않습니다. 한국어 프리셋으로 검사하며 번역하지 않습니다.

## 구조

`src/domain/models.ts`는 Project/MediaAsset/SubtitleTrack/Cue/QAProfile/QAIssue/Suggestion/Glossary/Export를 분리합니다. 파서는 `src/lib/subtitles`, 규칙은 `src/lib/qa`, 처리 진입점은 `analyze.ts`입니다. UI는 QA 결과만 소비하며 규칙 로직을 포함하지 않습니다. Python 미디어 Worker와 Provider 구현은 해당 기능을 시작할 때 추가합니다.

설계·미결정 사항은 [구현 계획](docs/implementation-plan.md), 실행 검증 결과는 [검증 기록](docs/verification.md)을 참고하세요.

## v1 검증과 저장

글자 수 계약은 [계산 정책](docs/subtitle-counting-policy.md), 임계값과 Rule은 [Profile v1](docs/qa-profile-v1.md)을 참고하세요. 저장본에는 schema/profile/rule/counting 버전이 있으며 오래되거나 호환되지 않으면 복원 시 폐기합니다. 저장 데이터는 암호화된 금고가 아니며 같은 origin의 스크립트에서 접근할 수 있습니다. 공용 기기에서는 삭제 버튼을 사용하세요. 만료 검사는 복원 시 수행하며 백그라운드 물리 삭제 작업은 없습니다.

E2E는 `@playwright/test`와 Chromium 한 종류를 사용합니다. 기존 127.0.0.1:3000 서버가 있으면 재사용하고, 없으면 테스트 러너가 개발 서버를 시작합니다. 브라우저 실행 파일이 없는 새 환경에서는 `npx playwright install chromium`을 한 번 실행하세요. 테스트는 합성 자막만 사용하며 trace/video/screenshot을 저장하지 않습니다. OS 파일 선택창은 Enter로 연 뒤 fixture 경로만 러너가 공급합니다. 나머지 키보드 시나리오에서는 Tab/기본 select의 키보드 문자열 검색/Enter/Space를 사용합니다.
