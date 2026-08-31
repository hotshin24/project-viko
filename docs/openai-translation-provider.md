# OpenAI Translation Provider

기존 `TranslationProvider` 계약을 구현하는 서버 전용 어댑터다. UI, API Route, Registry 활성화는 없으며 실제 API 호출 검증도 수행하지 않는다. QA·Converter·Core의 배치 및 검증 규칙은 변경하지 않는다.

## 구조와 사용 경계

`src/lib/translation/providers/openai.ts`의 `createOpenAITranslationProvider()`를 서버에서 생성해 기존 `translateTrack(track, provider, options)`에 전달한다. 생성만으로는 네트워크 요청이 발생하지 않는다. 호출자가 유효 Track과 원문 언어·스타일을 제공한다. 현재 앱에는 호출 경로가 없다.

공식 `openai@7.8.0` SDK의 `responses.create`와 `text.format: { type: "json_schema", strict: true }`를 사용한다. 루트 `translations` 배열과 항목의 `cueId`, `text`만 허용하고 모든 필드를 required로 지정한다. JSON 런타임 검사 후 원본 ID로 순서·시각을 연결하고 기존 `validateTranslationResult`를 반드시 실행한다. 모델 배열을 정렬하거나 누락을 보완하지 않는다. 누락·중복·미등록·순서 변경·빈 번역·추가 타임코드 필드를 거부한다. `translateTrack`도 재검증하며, 후속 배치 실패 시 전체 결과가 reject된다.

원문과 문맥은 user 메시지의 JSON 데이터이며, 상위 instructions는 데이터 안의 지시를 따르지 않도록 명시한다. 이는 번역 정확도나 prompt injection 방어의 완전한 보장은 아니다. 스타일은 기존 faithful/natural/concise를 사용한다.

## 환경변수와 정보 보호

| 변수                       | 용도                                                                |
| -------------------------- | ------------------------------------------------------------------- |
| `OPENAI_API_KEY`           | 서버 API 키. 누락/공백이면 생성 실패                                |
| `OPENAI_TRANSLATION_MODEL` | Responses 및 Strict Structured Outputs를 지원하는 모델. 기본값 없음 |

`.env.example`에는 빈 값과 설명만 둔다. `NEXT_PUBLIC_` 대체 키를 사용하지 않는다. `server-only` import가 Client Component의 간접 import도 빌드에서 차단한다. SDK와 키를 공통 타입 모듈이나 클라이언트 Registry에서 export하지 않는다. endpoint는 공식 API로 고정하고 SDK의 다른 인증/조직 환경변수는 사용하지 않는다.

SDK `logLevel: "off"`를 명시하므로 `OPENAI_LOG=debug`라도 요청·응답을 로그에 남기지 않는다. 공개 오류는 고정 메시지와 코드만 제공하고 SDK error/cause/headers/본문을 보관하지 않는다. `store: false`, `stream: false`, `truncation: "disabled"`를 사용한다. `store: false`는 모든 서버 보관 정책을 제거한다는 의미가 아니다. 실제 연결 전 권리·개인정보·제공업체 데이터 정책을 확인해야 한다.

## 오류 및 재시도

기존 Provider의 Promise reject 계약을 유지하며 `TranslationProviderError.code`로 분류한다.

| 코드                | 조건                                          |
| ------------------- | --------------------------------------------- |
| CONFIGURATION       | API 키 또는 모델 누락                         |
| AUTHENTICATION      | HTTP 401·403                                  |
| RATE_LIMIT          | HTTP 429, 재시도 소진                         |
| TIMEOUT             | SDK 타임아웃 또는 HTTP 408                    |
| SERVER              | HTTP 5xx 또는 failed 응답                     |
| REFUSAL             | output message의 refusal 항목                 |
| EMPTY_RESPONSE      | 완료 응답에 출력 텍스트 없음/공백             |
| SCHEMA_MISMATCH     | JSON 파싱·형태·Core Cue 검증 실패             |
| INCOMPLETE_RESPONSE | completed/failed 이외 상태: 부분 결과 거부    |
| CONNECTION          | HTTP 연결 실패                                |
| REQUEST             | 그 밖의 요청 오류, 지원하지 않는 모델/형식 등 |

SDK 자동 재시도는 `maxRetries: 0`으로 끈다. HTTP 429·500·502·503·504만 최초 시도 이후 최대 2회, 500ms·1,000ms 간격으로 재시도한다. 매 요청 제한 시간은 30초다. HTTP 501, 인증, 연결, 타임아웃, 거부, 구조 검증 오류와 HTTP 200의 failed/incomplete 응답은 재시도하지 않는다. 서버 Retry-After에 따른 스케줄링은 아직 지원하지 않는다. 자동 재시도는 추가 과금을 유발할 수 있으며 전체 Track 작업 취소·비용 한도는 이번 범위 밖이다.

## 검증과 다음 단계

`tests/openai-provider.test.ts`는 실제 SDK를 사용하되 fetch 전체를 모킹한다. 합성 Cue와 더미 인증 문자열만 사용하고 외부 API에 연결하지 않는다. 정상 Structured Output, 요청 형식, 환경변수, 오류 분류, 재시도 상한, 타임아웃 abort, 모든 Cue 연결 실패, 후속 배치의 원자적 실패, 로그 비노출을 검사한다.

`tests/translation-server-boundary.test.ts`는 임시 Next.js 앱에 Client Component의 어댑터 import를 만들고 실제 프로덕션 컴파일 실패를 확인한 뒤 임시 폴더를 제거한다. 저장소의 앱과 설정은 변경하지 않는다. 이 실패는 기대한 보안 테스트 결과이며 실제 제품 빌드는 별도로 성공해야 한다.

다음 단계에서 명시적으로 승인된 모델·키로 제한된 서버 통합 검증을 설계해야 한다. 모델 지원 여부·토큰/출력 예산·비용·번역 품질은 현재 검증하지 않았다. Core의 바이트 한도는 모델 토큰 한도를 보장하지 않는다. 불완전 응답을 조용히 잘라 성공 처리하지 않는다. 인증된 호출 경로·사용량 제한·UI는 별도 작업이다.

2026-08-31 검증: 기존 159개와 신규 38개를 합친 12 suite / 197개 테스트, 린트·타입·포맷·프로덕션 빌드 통과. 생성 클라이언트 JS 44개에서 API 환경변수·Provider 스키마·SDK 관련 표식이 발견되지 않았다. 실제 키나 자막을 사용하지 않았으며 라이브 API 및 E2E 검증은 실행하지 않았다. 화면·경로·Registry는 기존 상태를 유지한다.

참고: [OpenAI Structured Outputs 공식 문서](https://developers.openai.com/api/docs/guides/structured-outputs), 설치 SDK의 README(오류·재시도·타임아웃·로그), 설치 Next.js 16.3.3의 Server and Client Components 가이드(server-only).
