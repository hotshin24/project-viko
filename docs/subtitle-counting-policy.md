# 한국어 자막 글자 수 정책 v1

정책 버전: **1.0.0**. 구현: `src/lib/subtitles/metrics.ts`. 적용일: 2026-08-31. 이 문서는 VIKO의 계산 계약이며 특정 플랫폼 납품 인증이나 보편적인 한국어 읽기 속도 표준이 아니다.

## 조사와 선택

[Unicode UAX #29](https://www.unicode.org/reports/tr29/)는 사용자 인지 문자에 가까운 단위로 extended grapheme cluster를 설명한다. [ECMA-402 Segmenter](https://tc39.es/ecma402/#segmenter-objects)의 `Intl.Segmenter("ko", { granularity: "grapheme" })`를 사용한다. [MDN의 지원 정보](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Segmenter)에 따르면 Baseline 2024 기능이다. Node 24와 Playwright의 고정 Chromium에서 테스트한다. 구형 브라우저에서는 명확한 오류를 반환하며 `string.length`나 code point 세기로 대체하지 않는다.

CPL은 화면 픽셀 너비가 아니다. 영문과 전각 문자는 너비가 달라도 한 grapheme씩 센다. Unicode/ICU가 다른 런타임의 새 이모지 처리는 달라질 수 있어, 동일 입력·프로필·Rule 버전의 재현성 테스트는 고정 런타임에서 실행한다. 실제 플랫폼/폰트의 줄바꿈 측정은 범위 밖이다.

## 계산 순서

원본 `Cue.text`와 `SubtitleTrack.originalText`는 변경하지 않고 `displayText()`로 계산용 복사본을 만든다.

1. CRLF/CR을 LF로 정규화한다.
2. 단순 `<rt>주석</rt>` 루비 주석을 제외하고 기반 문자만 센다.
3. `<br>`, `<br/>`를 줄바꿈으로 바꾼다.
4. 지원 서식 태그와 VTT 인라인 타임스탬프를 제외한다.
5. 지원 엔터티를 **한 번만** 디코딩한다. `&lt;b&gt;`는 서식으로 다시 해석하지 않고 보이는 `<b>` 3자로 센다.
6. 아래에 명시한 비표시 제어 문자를 제외하고 탭은 공백 한 개로 바꾼다. NFC 정규화를 적용한다.
7. 각 줄의 양끝 공백을 trim하고 바깥쪽 빈 줄을 제거한다. 내부 공백은 합치지 않는다. 내부 빈 줄이 있다면 줄 수에 포함한다.
8. 줄마다 grapheme 수를 센다. CPL 배열의 합계가 CPS 분자이며 줄바꿈은 합산하지 않는다.

## 문자별 계약

| 항목          | 정책 / 예                                                                                    |
| ------------- | -------------------------------------------------------------------------------------------- |
| 한글 음절     | `한글` = 2; 결합 자모 `가`는 NFC 후 `가` = 1                                                |
| 영문자        | `ABC` = 3                                                                                    |
| 숫자          | `2026` = 4; 소수점/단위도 별도 문자로 센다                                                   |
| 공백          | 줄 양끝은 제외, 내부 일반 공백·NBSP는 각각 1; 반복 공백 유지                                 |
| 줄바꿈        | CPL 줄 구분에만 사용, CPS 분자에는 0                                                         |
| 문장부호      | 쉼표·마침표·콜론·괄호·하이픈 등 보이는 기호를 포함                                           |
| 이모지        | `👍🏽`, `👨‍👩‍👧‍👦`, `🇰🇷` 각각 1 grapheme                                                             |
| 결합 문자     | `e` + combining acute = `é` = 1                                                              |
| 전각 문자     | `Ａ１` = 2, NFKC로 폭을 변환하거나 2배 가중하지 않음                                         |
| HTML/VTT 태그 | 아래 지원 집합은 0; 태그 속성도 제외, 실제 본문은 포함                                       |
| SDH           | `[웃음]` = 4; 효과음 설명과 괄호를 모두 포함                                                 |
| 화자 표시     | 보이는 `민수: 네` = 5; `<v Mina>`의 숨겨진 화자 속성은 제외                                  |
| 음악 기호     | `♪ 노래 ♪` = 6; 기호·공백·가사를 포함                                                        |
| 비표시 제어   | U+200B, U+200E/F, U+202A–202E, U+2060–2069, U+FEFF 제외; emoji ZWJ/variation selector는 보존 |

지원 태그: b/i/u/s/em/strong/span/font/ruby/rt, VTT c 및 class, v, lang. 엔터티: amp/lt/gt/nbsp/lrm/rlm/quot/apos 및 유효한 10진/16진 Unicode 숫자 참조. 미지원·손상 태그/엔터티는 조용히 지우지 않고 문자로 남긴다. 복잡한 중첩 루비/스타일 해석은 완전한 HTML/VTT 렌더러의 대체물이 아니다. [WebVTT 명세](https://www.w3.org/TR/webvtt1/)의 태그·본문 구분을 참고하되 여기의 가독성 계산은 VIKO 정책이다.

## 수식과 판정

- CPL: 각 줄의 grapheme 개수. 줄 길이 Rule은 가장 긴 줄의 값을 사용한다.
- CPS: 모든 줄의 문자 수 합 / `(endMs - startMs) / 1000`.
- 시간을 파싱할 수 없거나 표시 시간이 0 이하이면 CPS=null, CPS 초과를 중복 보고하지 않는다.
- 비교에는 반올림 전 실수를 사용한다. 화면만 소수점 둘째 자리까지 표시한다.
- 비어 있거나 공백/지원 태그/비표시 제어만 있는 Cue는 `EMPTY_CUE`다.

회귀 검증: `tests/counting.test.ts`, `tests/engine.test.ts`, `tests/corpus.test.ts`. 합성 fixture 기대값은 엔진 실행 결과에서 자동 갱신하지 않는다. 실제 시청자 읽기 속도 적합성과 SDH의 정보 밀도는 별도 사용자 검증이 필요하다.
