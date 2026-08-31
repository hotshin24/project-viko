# Korean Subtitle Translator 처리 계층

실제 번역 기능이 아닌 요청·배치·결과 연결 계약이다. UI, API 호출, SDK, 환경변수, Registry 상태 변경, Glossary, 저장소, 다운로드는 추가하지 않는다. Fake Provider는 테스트 파일에만 있으며 한국어 품질을 평가하지 않는다.

## 처리 흐름

기존 `parseSubtitles`로 만든 Cue와 `SubtitleTrack` → `translateTrack`의 원본 스냅샷 → `createTranslationBatches`로 전체 사전 검증·배치 생성 → Provider 순차 호출 → 배치별 런타임 검증 → 모든 검증 성공 시 전체 `TranslationResult` 반환.

호출자는 파서 진단을 확인한 유효 Track을 제공해야 한다. 코어는 ID 중복·Track 연결 오류·잘못된 순서·null/역전/비정수 타임코드를 다시 차단한다. 기존 QA/Converter의 파서·Rule·임계값은 변경하지 않는다. 원문 언어는 호출자가 명시하며 추측하지 않는다. 한국어→외국어/한국어 재작성은 범위 밖이다. targetLanguage는 타입과 요청에서 `ko`로 고정한다.

## 요청과 배치 기준

각 요청 항목에는 Cue ID, 순서, 원문, 정수 ms 시작/종료 시간, 원본 배열의 바로 이전/다음 Cue 문맥, sourceLanguage, targetLanguage, style이 있다. 스타일 ID는 `faithful`(원문 충실), `natural`(자연스러운 한국어), `concise`(짧은 자막)다. 스타일 선택 자체가 품질이나 길이 보장을 뜻하지 않는다.

`DEFAULT_BATCH_LIMITS`는 내부 시작값으로 최대 32개 항목, **배치 전체 JSON UTF-8 32,768바이트**, 이웃 하나당 문맥 2,048바이트다. 설정 객체에서 조정하며 양의 안전한 정수만 허용한다. 개수 또는 바이트 한도를 먼저 넘으면 다음 배치로 이동한다. JSON의 필드명·ID·언어·스타일·문맥·escape·배치 ID까지 실제 직렬화하여 계산한다. Provider의 프롬프트와 출력 예산은 이 한도에 포함되지 않는다. 토큰 한도나 특정 모델 안전성을 보장하는 기준이 아니다.

Cue 원문은 자르거나 문장 단위로 쪼개지 않는다. 단일 요청이 한도를 넘으면 **어느 Provider도 호출하기 전** 실패한다. 문맥만 Unicode code point 경계에서 길이를 제한하고 `truncated`를 표시한다. 결합 문자/emoji grapheme의 시각적 단위까지 보장하지는 않는다. 배치 경계에서도 전체 원본 배열에서 이웃을 찾는다. 바로 이웃이 빈 Cue이면 그 빈 문맥을 유지하며 비어 있지 않은 먼 Cue로 대체하지 않는다.

기존 10,000 Cue 한도를 재사용한다. 빈 문자열/JS `trim()` 후 빈 본문은 번역 요청에서 제외한다. 원문이 모두 비었거나 Cue가 0개면 Provider를 호출하지 않고 해당 위치를 그대로 반환한다. 겹치거나 시간순이 아닌 Cue도 파일 순서가 유효하면 시간 변경 없이 유지한다.

## Cue 보존과 결과

원본 Track/Cue/원문·메타데이터를 수정하지 않는다. 첫 await 전에 스냅샷을 만들고 Provider에는 별도의 동결된 요청 객체만 전달한다. 번역문으로 기존 `SubtitleTrack.originalText`/`rawBlock`을 덮어쓰거나 번역된 것처럼 위장한 Track을 생성하지 않는다.

결과는 `TranslationResult`로 sourceTrackId/version, 원문 언어·스타일, 한국어 대상, 원본과 같은 수의 정렬된 결과 항목을 제공한다. 항목은 cueId/order/startMs/endMs/sourceText/translatedText/status를 가지며 원본과 ID로 연결한다. 빈 Cue는 `skipped-empty`, translatedText는 원본 공백 문자열 그대로다. 나머지는 `translated`다. 결과 시간·순서는 Provider 값이 아니라 원본 스냅샷에서 구성한다. 메타데이터와 파일 직렬화는 이후 명시적 Track 생성 계층의 책임이다.

## Provider 계약과 검증

`TranslationProvider.translateBatch(batch: TranslationBatch): Promise<unknown>`를 구현한다. 정상 반환값은 `TranslationResponseItem[]`: 각 항목에 **cueId, order, text, startMs, endMs만** 포함한다. 시간은 요청값 그대로 반향해야 하며, 수정 권한을 부여하는 의미가 아니다. 정적 타입만 신뢰하지 않고 unknown 값을 런타임에서 검사한다.

`TranslationValidationError.issues`의 코드는 다음과 같다. 진단에는 원문·번역문·Provider의 미등록 ID를 넣지 않고 결과 인덱스만 포함할 수 있다.

| 코드              | 검사                                               |
| ----------------- | -------------------------------------------------- |
| INVALID_SCHEMA    | 배열/필수 필드 타입 오류, 추가 필드                |
| COUNT_MISMATCH    | 요청한 비어 있지 않은 Cue 수와 배치 결과 수 불일치 |
| MISSING_CUE       | 요청한 ID 누락                                     |
| UNKNOWN_CUE       | 해당 배치에 없는 ID (다른 배치 ID도 포함)          |
| DUPLICATE_CUE     | 같은 ID 중복                                       |
| ORDER_CHANGED     | 배열 순서 또는 order 필드 변경                     |
| EMPTY_TRANSLATION | 빈 문자열/공백 번역문                              |
| TIMECODE_CHANGED  | 시작/종료 시각 변경                                |

결과를 정렬·보완·자동 수정하여 통과시키지 않는다. 각 배치의 정확한 ID/개수 대응을 검증한 후 빈 Cue를 원래 위치에 합치므로 최종 개수는 원본과 같다. 배치 하나라도 실패하면 전체 Promise를 reject하고 부분 정상 결과를 반환하지 않는다. Provider 예외도 원래 오류를 그대로 전파하고 이후 배치를 호출하지 않는다. 자동 재시도·동시 실행·부분 저장·진행 콜백은 없다. 이미 실행한 Provider 호출 자체를 취소하거나 과금까지 롤백한다는 뜻은 아니다. 코어는 로그를 남기지 않으며, 향후 호출 계층은 Provider 오류에 민감 정보가 포함될 수 있어 사용자에게 그대로 노출하거나 기록하지 않아야 한다.

## 다음 실제 API 연결 범위

승인된 Provider 어댑터 하나에서 요청 스키마·응답 파싱, 원문/문맥을 지시가 아닌 데이터로 취급하는 프롬프트, 실제 토큰/출력 예산, 타임아웃·취소·재시도·비용 한도, 키의 서버 보관과 로그 비식별화를 설계한다. 본 코어 검증을 통과한 전체 결과만 후속 Track에 연결한다. UI/Track 저장·다운로드·번역 품질 평가·Glossary는 별도 범위이며 이번 구현에는 없다.

## 검증 기록

2026-08-31. 작업 시작 시 깨끗한 main과 로컬·원격 HEAD의 일치를 확인했다. `tests/translation.test.ts`의 신규 26개 테스트와 기존 테스트를 합쳐 10 suite / 159개가 통과했다. 정상 결과·다중 배치·경계 문맥·빈 Cue·UTF-8 크기·스타일·모든 결과 검증 코드·후속 배치 실패·Provider 예외 전파·원본 불변성과 호출 중 스냅샷 보존을 확인한다. 실제 API와 네트워크 호출은 테스트하지 않는다. 린트·타입·포맷·프로덕션 빌드도 실행한다. 제품 화면을 변경하지 않아 E2E는 이번 범위에서 다시 실행하지 않는다.
