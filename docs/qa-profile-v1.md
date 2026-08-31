# QA Profile v1

적용일/최종 변경일: 2026-08-31. 모든 profile 버전 **1.0.0**, Rule 버전 **1.0.0**, counting policy **1.0.0**. 구현은 `src/lib/qa/profiles.ts`, `src/lib/qa/versions.ts`에 있다.

v1은 설정·계산·회귀 기대값을 고정한 버전이다. 현장 검증이 끝났다는 의미가 아니다. 자체 프로필의 수치 대부분은 **temporary hypothesis**이며, Netflix 등 브랜드 프리셋이나 공식 납품 기준으로 표시하지 않는다. 기존 `ko-general`, `ko-sdh` ID는 유지했다.

## 프리셋

| ID / 표시 이름                          | 대상 / 설명                                                                         | 최대 줄 | 권장 CPL | 최대 CPL | 최대 CPS | 표시 시간 ms (최소–최대) | 최소 간격 ms | 시간 중복 |
| --------------------------------------- | ----------------------------------------------------------------------------------- | ------- | -------- | -------- | -------- | ------------------------ | ------------ | --------- |
| ko-general / Korean General · 일반 영상 | YouTube, 인터뷰, 정보·크리에이터 영상. 읽기 편의성 우선                             | 2       | 16       | 20       | 12       | 833–7000                 | 80           | 검토      |
| ko-education / Korean Education · 교육  | 해외 강의, 웨비나, 튜토리얼, 전문 지식. 정보 보존을 위해 길이·속도·표시 구간을 완화 | 2       | 18       | 22       | 15       | 1000–10000               | 80           | 검토      |
| ko-shorts / Korean Shorts · 세로 영상   | 큰 화면 자막, 빠른 대사. 짧은 줄과 Cue를 우선                                       | 2       | 10       | 12       | 14       | 500–4000                 | 40           | 검토      |
| ko-sdh / Korean SDH · 참고              | 기존 접근성 참고 프로필 유지. 효과음·화자 표기도 계산                               | 2       | 14       | 16       | 14       | 833–7000                 | 80           | 검토      |

각 객체는 id/name/description/version/targetContents/thresholds/thresholdBasis/source/effectiveDate/updatedAt/provisional을 포함한다. 각 임계값의 근거는 thresholdBasis에서 찾을 수 있다. 2줄과 SDH의 16 CPL/14 CPS는 PRD §7.2에 명시돼 있다. 일반·교육·Shorts의 CPL/CPS, 모든 표시 시간·간격·권장 CPL은 자체 가설이다. 833ms를 프레임 기반 공식 기준으로 주장하지 않는다. `allowOverlap: false`는 검토 경고를 뜻하며 자막을 차단하거나 수정하지 않는다.

## Rule 계약

출력 QAIssue는 ID/이름/설명/severity/대상 Cue/현재값/기준값/수정 안내/profileId/profileVersion/ruleVersion을 포함한다. 파일 전체 진단의 cueId는 null. 파서는 profile에 의존하지 않는 QADiagnostic을 만들고, Rule Engine이 메타데이터를 부여한다.

| Rule ID          | Severity | 조건 / 값                                                            |
| ---------------- | -------- | -------------------------------------------------------------------- |
| FILE_STRUCTURE   | Critical | 빈 파일/잘못된 헤더/손상 블록/누락 구분선                            |
| INVALID_INDEX    | Warning  | SRT 원본 index가 1부터의 파일 순서와 다름                            |
| INVALID_TIMECODE | Critical | 시간 형식 또는 범위 오류                                             |
| INVALID_DURATION | Critical | 종료 ≤ 시작, 현재값은 duration ms                                    |
| EMPTY_CUE        | Critical | 계산용 본문이 빈 문자열 또는 공백만 존재                             |
| OVERLAP          | Warning  | allowOverlap=false이고 유효 Cue 구간이 중복, 현재값은 대표 교집합 ms |
| OUT_OF_ORDER     | Warning  | 앞의 파싱 가능한 시작 시간보다 빠름                                  |
| SHORT_DURATION   | Warning  | duration < minDurationMs                                             |
| LONG_DURATION    | Warning  | duration > maxDurationMs; v1 추가                                    |
| SHORT_GAP        | Info     | 0 ≤ gap < minGapMs; 긴 침묵과 음수 간격은 제외                       |
| MAX_LINES        | Warning  | 줄 수 > maxLines                                                     |
| RECOMMENDED_CPL  | Info     | recommendedCpl < 가장 긴 줄 ≤ maxCpl; v1 추가                        |
| CPL              | Warning  | 가장 긴 줄 > maxCpl; 기존 ID 유지, 권장 경고와 중복하지 않음         |
| CPS              | Warning  | 반올림 전 CPS > maxCps                                               |
| DUPLICATE_TIMING | Warning  | 유효 Cue의 시작·종료 ms 모두 일치; 본문이 달라도 확인; v1 추가       |

한계값과 같으면 초과 Rule은 발생하지 않는다. 0 길이는 INVALID_DURATION이며 SHORT_DURATION/CPS를 추가하지 않는다. 겹침은 시간순 정렬 + 최대 종료 시각 sweep으로 O(n log n)에 처리한다. 모든 중복 쌍 대신 Cue당 대표 참조를 제공한다. 동일 타임코드에는 OVERLAP과 DUPLICATE_TIMING이 함께 나올 수 있으며 서로 다른 확인 목적이다. allowOverlap=true여도 동일 타임코드 확인은 유지한다. Rule은 원문을 수정하지 않는다.

## 오탐·미탐 검토 기반

`tests/fixtures/v1`에 직접 작성한 합성 파일 23개가 있다. `expectations.json`은 각 fixture의 Rule ID/Cue 번호/severity/현재값/기준값을 명시한 검토 계약이다. `npm run test:corpus`는 기대와 실제 전체 목록을 비교해 미탐뿐 아니라 예상하지 않은 오탐도 실패로 만든다. 정상 일반·교육·혼합 문자·이모지·태그·SDH·CRLF·BOM·마지막 개행 없음은 오류 없음이 기대값이다.

기대값 변경은 엔진 출력 복사가 아니라 다음 절차를 따른다: 사용자 의도와 재현 파일 확보 → 오탐/미탐 판정 근거 기록 → 승인된 수치/정책 변경 → 관련 버전 증가 → 기대값 검토 → 전체 테스트. 실저작권 자막은 포함하지 않았으며 실제 corpus 정확도나 오탐률을 측정했다고 주장하지 않는다.
