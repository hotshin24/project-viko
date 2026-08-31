# VIKO Localize 구현 계획

> 아래 1–8절은 최초 프로토타입 작업 당시의 계획 기록이다. QA MVP v1에서는 `docs/subtitle-counting-policy.md`, `docs/qa-profile-v1.md`, `docs/verification.md`의 현재 구현 내용이 이를 갱신한다. 기존 계획의 ‘저장 없음’과 임시 수치는 v0 기록이며 현재 기능 설명이 아니다.

작성: 2026-08-31. 유일한 제품 기준: `docs/VIKO_Localize_PRD_v2.0.md`. 이번 요청은 전체 PRD의 첫 수직 기능만 구현한다. 방향은 **Foreign Video → Natural Korean Subtitle**이며 Outbound는 제외한다.

## 1. 저장소 조사

- 초기 폴더는 PRD 및 macOS `._` 메타데이터뿐이다. 기존 앱, AGENTS.md, Git 초기화, 미완성 코드, 사용자 코드 변경사항은 없다. PRD와 메타데이터는 수정하지 않는다.
- Streamlit/Python 소스, requirements, pyproject, package.json, lockfile, 실행/린트/테스트/빌드 명령은 없다. 재사용 가능한 코드는 없다.
- Node 24.12.0, npm 11.6.2, Python 3.9.6 확인. 프로젝트 설치 패키지는 없다.
- `.env*`, `.gitignore`, `.vercel`, Supabase 설정은 없다. 이 폴더와 연결된 원격 프로젝트를 확인할 근거가 없다. 계정 전체의 연결 여부를 추정하지 않는다.
- 사용자 비밀정보 파일은 발견되지 않았다. 새 `.gitignore`에 환경변수, 개인 업로드, 빌드 산출물, macOS 메타데이터를 제외한다. 환경 전체나 자막 본문을 로그로 출력하지 않는다.

## 2. PRD와 현재 구현의 차이

모든 제품 기능이 미구현 상태다. 이번에는 QA-01, QA-02, QA-06의 심각도/개수, QA-07의 필터만 구현한다. 점수 산식은 PRD §16에서 미결정이므로 임의의 점수를 만들지 않는다. 언어 QA, 저장, 편집, 번역, 결제, 영상 입력 등은 후속 범위다.

## 3. 기술 구조

- Next.js App Router + React + strict TypeScript + Tailwind. 단일 QA 작업 화면과 공유 도메인 모듈을 만든다. 별도 모노레포 생성은 불필요하다.
- UTF-8 파일을 브라우저에서 읽고 Web Worker에서 파싱/QA한다. 업로드는 로컬 파일 선택을 의미하며 서버 전송은 없다. 원본 File(바이트)과 원문 문자열을 보존하고 파생 Cue만 정규화한다. 새로고침하면 세션은 사라진다.
- 파서 → 공통 Cue → 독립 Rule Engine → QAReport 흐름. 파서 진단도 동일한 QAIssue 스키마를 사용한다. 서버/React/DOM 의존성 없는 순수 모듈로 테스트한다.
- Python Worker는 영상·음성·FFmpeg 같은 무거운 작업이 생길 때 Queue 뒤에 추가한다. 지금은 실행할 작업이 없으므로 빈 서비스나 중복 파서를 만들지 않는다.
- Supabase Auth/DB/Storage는 저장이 필요한 다음 단계에 연결한다. RLS/소유권/보존·삭제 정책부터 설계해야 한다. 이번에는 DB나 가짜 로그인, 키를 만들지 않는다.
- Vercel에 배포 가능한 표준 Next.js 빌드를 제공하되 이번 작업은 로컬 개발/검증이다. 원격 리소스 생성/배포는 하지 않는다.
- OpenAI 우선 Provider 인터페이스는 실제 AI 기능의 입출력이 정해질 때 추가한다. 이번에 API 호출이나 SDK, 키는 필요하지 않다.

## 4. 디렉터리

```text
src/app/                  # layout, QA route, design tokens
src/components/           # upload, preset, report UI
src/domain/models.ts      # 공유 엔터티 타입
src/lib/subtitles/        # UTF-8, SRT/VTT, text metrics
src/lib/qa/               # profiles, rules, report pipeline
src/workers/              # 브라우저 QA worker
tests/fixtures/           # 정상/오류 자막
tests/                    # parser/rules/pipeline 단위 테스트
docs/                     # PRD, 계획, 검증 기록
```

## 5. 데이터 모델 초안

| 개념          | 역할                                                                               |
| ------------- | ---------------------------------------------------------------------------------- |
| Project       | 입력 언어(미상 허용), 한국어 대상, 상태, QA profile 참조                           |
| MediaAsset    | Project 소속 영상/오디오의 저장 위치와 메타데이터; 이번엔 타입만                   |
| SubtitleTrack | Project 소속 언어/형식/버전/원본 텍스트와 Cue; 실제 메모리 사용                    |
| Cue           | 고유 내부 ID, 원본 index, 순서, 원본 시간 문자열/본문, nullable 밀리초             |
| QAProfile     | 규칙 임계값, 출처, 버전, 적용일, 임시 여부                                         |
| QAIssue       | rule ID/이름/설명/severity/Cue ID/현재값/기준값/수정 안내; 파일 오류는 Cue ID=null |
| Suggestion    | issue 참조, 전후 텍스트, 이유, 승인 상태; AI 구현은 없음                           |
| Glossary      | Project 범위 용어집과 용어 매핑; 타입만                                            |
| Export        | 트랙·형식·상태·위치; 타입만                                                        |

파싱 불가능한 Cue도 원문과 위치를 유지한다. 내부 Cue ID는 트랙 ID+파일 내 순서로 결정하고 원본 index와 구분한다. 같은 입력·profile·track ID에는 같은 결과를 반환하며 시각·난수를 규칙 계산에 넣지 않는다.

## 6. QA 규칙

| ID               | 심각도   | 검사                                                             |
| ---------------- | -------- | ---------------------------------------------------------------- |
| FILE_STRUCTURE   | Critical | 빈 파일, VTT 헤더, 손상된 블록, 누락된 구분선                    |
| INVALID_INDEX    | Warning  | SRT index 누락/잘못된 값/중복/비연속                             |
| INVALID_TIMECODE | Critical | 형식, 분/초 범위, 파싱 불가                                      |
| EMPTY_CUE        | Critical | 표시할 본문 없음                                                 |
| INVALID_DURATION | Critical | 종료 ≤ 시작                                                      |
| OVERLAP          | Warning  | 시간순 정렬 후 이전 시간 점유 구간과 중복; 의도적 동시 화자 가능 |
| OUT_OF_ORDER     | Warning  | 파일 순서와 시작 시간 순서 불일치                                |
| SHORT_DURATION   | Warning  | 최소 표시 시간 미만                                              |
| SHORT_GAP        | Info     | 중복이 아닌 Cue 간 여백이 최소 간격 미만                         |
| MAX_LINES        | Warning  | 최대 줄 수 초과                                                  |
| CPL              | Warning  | 한 줄 글자 수 초과                                               |
| CPS              | Warning  | 표시 초당 글자 수 초과                                           |

일반 영상 임시 기준: 2줄, CPL 20, CPS 12, 최소 표시 833ms, 최소 간격 80ms. SDH 참고 기준: PRD §7.2의 2줄/CPL16/CPS14; 시간 기준은 동일한 임시값. 공인 납품/언어 품질 보증이 아니다. 숫자가 명시되지 않은 일반 영상 기준과 시간 기준은 제품 확정이 아닌 실험용 설정이다. Netflix 명칭 프리셋은 법무/브랜드 미결정으로 만들지 않는다.

글자 수는 NFC 정규화한 Unicode grapheme 단위, 공백·문장부호 포함, 줄바꿈 제외. 알려진 자막 서식 태그/타임스탬프를 제외하고 엔터티를 표시 문자로 변환한다. 원문은 보존한다. 글자 수 정책은 현장 샘플로 후속 검증한다. 시간 중복은 모든 쌍을 생성하지 않고 최대 종료 시각을 유지하는 sweep으로 Cue당 대표 중복 하나와 참조 Cue를 제공한다. 긴 무음 구간은 문제로 단정하지 않는다.

## 7. 구현 순서와 실제 범위

1. 이 계획을 먼저 작성한다.
2. 최소 Next.js 프로젝트, scripts, ignore, 공통 타입을 추가한다.
3. 인코딩/파서, presets/Rule Engine, 정상·오류 fixture와 단위 테스트를 구현한다.
4. 로컬 업로드, preset, Worker 처리 상태, 요약, 유형 통계, 복합 필터, 원본 Cue/시간/지표/수정 안내를 구현한다. 결과 목록은 페이지로 나누어 10,000 Cue에서도 DOM 증가를 제한한다.
5. 테스트·린트·타입·프로덕션 빌드 및 개발 서버를 검증한다. 가능한 환경에서 실제 업로드 UI도 검증한다.
6. 결과와 후속 위험을 문서화한다.

## 8. 위험과 미결정

- SRT의 비표준 관행과 복잡한 VTT STYLE/REGION/설정/태그는 완전한 렌더러와 다르다. 메타 블록은 보존하되 QA 본문에서 제외한다. 타이밍 및 본문 중심 최소 파서의 한계를 명시한다.
- 입력은 우선 5 MiB/10,000 Cue로 제한하여 메모리·처리 위험을 줄인다. 사업상 무료 한도 확정이 아니다.
- 한글 글자 수·표시 시간·간격 규칙과 severity는 실제 corpus/사용자 검증 전이다.
- 파일은 메모리만 보존하며 영구 저장/복구는 없다. QA 결과는 번역·맞춤법·영상 싱크 정확성을 보증하지 않는다.
- 처음부터 Git 저장소가 아니어서 기존 변경 diff/commit을 제공할 수 없다. Git 초기화는 이번 범위에 포함하지 않는다.
- 참고 기술 문서: [Next.js 설치](https://nextjs.org/docs/app/getting-started/installation), [WebVTT 명세](https://www.w3.org/TR/webvtt1/). 제품 방향의 근거는 PRD만 사용한다.

## 9. QA MVP v1 안정화 범위 (2026-08-31)

기존 모듈과 디자인을 유지하며 계산 정책 v1, 네 가지 자체 프로필, 안정된 기존 Rule ID 및 세 개 추가 Rule, 합성 corpus 기대값, sessionStorage 기반 복원/삭제, 재실행 가능한 Chromium 키보드 E2E를 추가한다. AI/DB/결제/배포로 확장하지 않는다. 기존 서버의 cwd를 확인하고 재사용한다. Git 저장소가 아니므로 Git diff 대신 수정한 관련 파일과 검증 결과를 기록한다.
