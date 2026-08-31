# Translation API

`POST /api/translation`은 Node.js Route Handler다. `TRANSLATION_API_ENABLED`가 정확히 `true`일 때만 요청을 처리한다. 누락·빈 값·다른 값이면 본문을 읽거나 Provider를 생성하기 전에 404를 반환한다. 실제 배포 환경변수는 이번 작업에서 설정하지 않는다.

## 구조

- `src/app/api/translation/route.ts`: 플래그·출처 검사, Core/Provider 연결, 응답 필드 선택, 안전한 오류 매핑.
- `src/lib/translation/api-request.ts`: 스트림 크기 제한, UTF-8/JSON 및 엄격한 런타임 스키마 검증, 기존 Track으로 메모리 내 연결.
- 기존 `createTranslationBatches`로 사전 검증 → `createOpenAITranslationProvider` → `translateTrack`의 배치·결과 검증. 전체 완료 후에만 JSON 응답. Core·Provider는 변경하지 않는다.

Track은 요청 중에만 존재한다. 내부 ID와 format=srt는 기존 타입에 연결하기 위한 값이며, 원본 파일을 생성·저장했다는 의미가 아니다. 원본 파일 필드는 빈 값으로 둔다. 클라이언트가 보낸 순서·시각·본문을 수정하지 않는다. 빈 Cue는 유지하지만 모든 Cue가 비어 있으면 유효 번역 요청으로 보지 않는다.

## 요청 계약

Content-Type은 `application/json`, 본문은 UTF-8이다. 아래처럼 모든 필드를 포함하며 추가 필드는 거부한다. API 키·모델·배치 설정을 요청으로 전달할 수 없다.

```json
{
  "sourceLanguage": "en",
  "targetLanguage": "ko",
  "style": "natural",
  "cues": [
    {
      "cueId": "cue-1",
      "order": 1,
      "text": "Synthetic example.",
      "startMs": 1000,
      "endMs": 2500
    }
  ]
}
```

| 항목      | 제한                                                                       |
| --------- | -------------------------------------------------------------------------- |
| 전체 요청 | 실제 스트림 바이트 기준 최대 256KiB, 헤더만 신뢰하지 않음                  |
| Cue       | 1~128개, 최소 하나는 공백이 아닌 본문                                      |
| 본문      | Cue당 UTF-8 8KiB, 잘못된 Unicode surrogate 거부                            |
| Cue ID    | 최대 128 ASCII 문자, 첫 문자는 영숫자, 이후 영숫자·`_ . : -`, 중복 금지    |
| 순서      | 양의 안전한 정수, 배열에서 엄격히 증가. 연속 번호일 필요는 없음            |
| 시간      | 정수 ms, 안전한 정수, 0 ≤ startMs < endMs. Cue 간 겹침은 수정하지 않음     |
| 원문 언어 | 최대 64문자, Intl.Locale로 검증 가능한 언어 태그, 한국어 및 주변 공백 거부 |
| 대상 언어 | `ko`만 허용                                                                |
| 스타일    | `faithful`, `natural`, `concise`                                           |

요청 제한은 `TRANSLATION_REQUEST_LIMITS`에서 관리한다. 모델 토큰 예산이나 비용 한도를 보장하는 값이 아니다. 기존 Core의 배치 최대 32개/JSON 32,768바이트·이웃 문맥 2,048바이트 제한도 그대로 적용한다. JSON escape 등으로 Core 사전 검증을 통과하지 못하는 요청도 Provider 생성 전에 거부한다.

## 응답

성공 HTTP 200은 `cues`와 `metadata`만 반환한다. 각 Cue는 `cueId`, `order`, `startMs`, `endMs`, `text`(번역문), `status`(`translated` 또는 `skipped-empty`)를 갖는다. metadata는 sourceLanguage, targetLanguage, style, totalCues, translatedCues, batchCount다. 원문 sourceText·원본 Track·모델명·키·SDK 응답·사용량은 반환하지 않는다. 번역문 자체의 품질이나 원문을 그대로 번역하는 현상은 이 구조 검증의 대상이 아니다.

실패는 `{ "error": { "code": "...", "message": "고정된 사용자용 설명" } }` 형태다. 모든 응답에 `Cache-Control: no-store`를 설정한다.

| HTTP | 코드                                                                              |
| ---- | --------------------------------------------------------------------------------- |
| 404  | NOT_FOUND: 기능 플래그 비활성화                                                   |
| 403  | FORBIDDEN: cross-origin/cross-site 요청                                           |
| 400  | INVALID_REQUEST: JSON·스키마·Core 사전 검증 실패                                  |
| 413  | REQUEST_TOO_LARGE: 요청·Cue 수·본문 크기 초과                                     |
| 415  | UNSUPPORTED_MEDIA_TYPE                                                            |
| 503  | CONFIGURATION: 서버 키/모델 설정 누락                                             |
| 502  | AUTHENTICATION: 상위 서비스 인증 실패. 클라이언트 로그인 오류가 아님              |
| 429  | RATE_LIMIT                                                                        |
| 504  | TIMEOUT                                                                           |
| 422  | REFUSAL                                                                           |
| 502  | SERVER, EMPTY_RESPONSE, SCHEMA_MISMATCH, INCOMPLETE_RESPONSE, REQUEST, CONNECTION |
| 500  | INTERNAL_ERROR: 분류되지 않은 내부 오류                                           |

Provider 오류의 message/cause/SDK 본문은 사용하지 않고 Route의 고정 매핑만 사용한다. Route 자체의 재시도는 없다. Provider의 제한된 재시도 정책은 그대로 유지한다. 처리 도중 실패하면 오류만 반환하며 이미 실행한 유료 호출을 취소·환불한다는 의미는 아니다.

## 보안과 운영 제한

- `OPENAI_API_KEY`, `OPENAI_TRANSLATION_MODEL`은 기존 서버 전용 Provider만 읽는다. 예시 파일에는 빈 값만 둔다.
- 로그·영구 저장·응답 본문 기록을 추가하지 않는다. 외부 프록시/APM의 본문 캡처 여부는 배포 시 별도로 확인해야 한다.
- CORS 허용 헤더를 추가하지 않는다. Origin이 있으면 요청 URL의 origin과 정확히 같아야 하며 `Sec-Fetch-Site: cross-site`도 차단한다. Origin 없는 서버 요청은 허용한다. 프록시의 origin 구성은 배포 환경에서 확인해야 한다.
- **플래그와 출처 검사는 인증이 아니다.** 로그인·사용량 제한·동시 작업 제한이 없으므로, 접근 통제가 없는 공개 배포에서는 플래그를 켜지 않는다. 서버 간 호출자는 Origin을 생략하거나 위조할 수 있다.
- 전체 작업의 실행 시간·요청 본문 수신 시간·클라이언트 연결 종료에 따른 취소 정책은 아직 없다. 호스팅의 시간 제한과 장시간 다중 배치 처리 정책을 실제 활성화 전에 정해야 한다.
- POST 이외 메서드는 Next.js 기본 처리를 따른다. UI·Registry는 여전히 비활성 상태이며 QA·Converter를 수정하지 않는다.

## 검증

`tests/translation-api.test.ts`는 Route를 직접 실행하고 기존 Core는 실제로 사용하며 Provider 경계만 모킹한다. fetch도 차단해 실수로 라이브 API를 호출할 수 없게 한다. 플래그·설정 누락, 정상 다중 배치, 빈 Cue 보존, 잘못된 입력, 바이트 경계·스트림 취소, Provider별 안전한 오류, 비노출과 부분 결과 차단을 검증한다. 기존 서버 전용 컴파일 차단 테스트도 유지한다.

실행: `npm run lint`, `npm run typecheck`, `npm run test`, `npm run format:check`, `npm run build`. 전체 테스트는 다른 무거운 명령과 겹치지 않게 실행한다. 실제 API·키·사용자 자막은 사용하지 않는다.

검증 결과: Route 테스트 56개를 포함한 13 suite / 253개 테스트, 린트·타입·포맷·프로덕션 빌드 통과. 빌드에서 `/api/translation`이 동적 서버 경로로 생성되며, 클라이언트 JS 46개에서 Provider·API 키·모델 환경변수·SDK 관련 표식은 발견되지 않았다. HTTP 경계를 넘는 라이브 API 검증은 수행하지 않았다.
