# 로컬 Corpus 검증 도구

이 도구는 QA MVP v1의 기존 파서·Rule Engine·QA Profile을 그대로 호출하는 개발용 CLI다. UI, AI, 서버 전송, 프리셋/Rule 변경은 없다. 합성 fixture 통과는 실제 한국어 자막 정확도를 뜻하지 않는다.

## 샘플 준비와 보호

- 권리자가 허용한 UTF-8 SRT/VTT만 `corpus/private/`에 준비한다. 실제 샘플을 인터넷에서 자동 수집하지 않는다.
- 자막의 소유·이용 허락 범위, 내부 검토 허용, 보관 기한, 삭제 책임자를 확인한다. 인명·연락처·비공개 발화가 있으면 검토 권한과 비식별화 필요성을 확인한다.
- 파일명도 보고서에 남으므로 `interview-001.srt` 같은 비식별 ID를 쓴다. 원본과 ID 대응표·검토 기록도 비공개 디렉터리에 보관한다.
- `corpus/private/`, `corpus/reports/`, 생성 파일 이름 `report.json`/`report.md`는 Git 제외 규칙에 들어 있다. 원문은 수정하거나 복사하지 않는다. 기존 `tests/fixtures/` 합성 샘플은 제외하지 않는다.
- 현재 프로젝트에는 `.git`이 없다. Git을 연결한 뒤 반드시 `git check-ignore corpus/private/example.srt corpus/reports/run-example/report.json`과 `git status --short`를 확인한다. `.gitignore`는 이미 추적 중인 파일이나 강제 추가, 클라우드 동기화, 백업을 차단하지 않는다.
- 보고서는 원문·원본 Cue index·원본 타임코드 문자열·진단 자유 텍스트를 제외한다. 상대 파일명, 파일 SHA-256, 생성된 Cue ID, 순서, 원본 줄 번호, 수치 타임코드, Rule ID/severity/참조 Cue만 기록한다. 해시와 위치도 민감할 수 있으므로 보고서 자체를 공개하지 않는다. POSIX 권한을 요청하지만 외장 디스크의 파일시스템에서는 보장되지 않을 수 있다.

## 실행

저장소 루트에서 기존 의존성 설치 방법(`npm ci`)을 사용한다. CLI 실행을 위한 개발 의존성 `tsx`가 필요하다.

```sh
npm run qa:corpus -- ./corpus/private
npm run qa:corpus -- ./corpus/private --profile ko-education
npm run qa:corpus -- ./corpus/private --profile ko-shorts --output ./corpus/reports/shorts
# 실제 샘플 없이 합성 fixture로만 검증
npm run qa:corpus -- ./tests/fixtures/v1
```

기본값은 `ko-general`, 출력은 `corpus/reports/`다. `ko-general`, `ko-education`, `ko-shorts`, `ko-sdh` 중 한 프리셋이 실행 전체에 적용된다. 종류가 다르면 하위 디렉터리를 나누어 실행한다. 하위 폴더를 재귀 검사하고 대소문자 구분 없이 SRT/VTT만 선택한다. 숨김 파일/폴더와 심볼릭 링크는 제외한다. 디렉터리 탐색 권한 오류는 전체 실행 실패로 처리하며 조용히 누락하지 않는다.

매번 새 `run-*` 디렉터리에 `report.md`와 `report.json`을 생성하므로 이전 결과를 덮어쓰지 않는다. 사용자 지정 출력도 두 파일 이름으로 Git 제외되지만 비공개 경로를 권장한다. 입력은 파일당 5 MiB / 10,000 Cue의 기존 한도를 유지하고 순차 처리한다. 보고서에는 실행 시각 대신 프리셋 전체 설정·버전, Rule/계산 버전, Node/ICU 버전과 파일 해시를 담는다. 같은 입력·런타임·프리셋의 내용은 재현 가능하다.

종료 코드: `0` = 모든 파일 파싱 완료(QA 경고는 허용), `2` = 빈 Corpus 또는 부분 파싱/실패 파일 존재(보고서는 생성), `1` = 인자·탐색·실행·출력 실패. 출력 실패 시 불완전한 run 디렉터리가 남을 수 있다. 단말에는 본문이나 예외 원문을 출력하지 않는다.

## 결과 해석과 비교

- 검사 파일 수는 발견해 시도한 SRT/VTT 수다. `totalCues`는 복구된 Cue 합계이며 파싱 실패로 잃은 Cue는 포함하지 않는다.
- `ok`는 파싱을 완료했다는 의미다. QA Critical이 없다는 뜻이 아니다. `partial`은 구조/타임코드 오류가 있으나 Cue를 복구한 파일, `failed`는 읽기·인코딩·한도 실패 또는 복구 Cue가 없는 손상 파일이다.
- 실패 이유는 안전한 고정 코드/메시지다. FILE_STRUCTURE와 INVALID_TIMECODE를 별도 표시하고 원본 파일에서 확인한다. INVALID_INDEX는 기존 Warning 발생으로 기록한다. EMPTY_CUE/INVALID_DURATION는 파싱 실패로 분류하지 않는다.
- Rule별 수치는 발생 건수이지 잘못된 Cue 개수나 오탐률이 아니다. 한 Cue에 여러 Rule이 생길 수 있다. 최다 Rule은 동률을 모두 기록하며 모두 0이면 빈 목록이다. 파일 수준 진단은 Cue 위치가 null이다. 파싱 불가 시간은 null/`?`로 표시한다.
- Markdown은 파일별 심각도·Rule 빈도·문제 위치·참조 Cue·실패 목록을 제공한다. JSON `files[].issues`는 동일한 위치 정보를 수치 ms로 제공한다.
- 같은 샘플의 다른 프리셋 결과는 `file` + `sha256`으로 입력 동일성을 확인하고 Rule별 건수 및 `(file, cueId, ruleId)` 집합을 비교한다. 파일을 편집하면 해시와 Cue ID 대응이 달라질 수 있다. 파일 실패율이 다른 실행의 총건수를 바로 비교하지 않는다.

## 오탐·미탐 기록

`corpus/private/review.csv` 등 비공개 기록에 sample ID, SHA-256, profile ID/version, Rule/계산 version, Cue ID/순서/타임코드, Rule ID, TP/FP/FN/보류, 짧은 비식별 판정 근거, 검토자, 검토일을 기록한다. 원문은 복제하지 말고 로컬 위치로 찾아본다.

1. 오류 목록의 모든 발생을 영상 맥락과 함께 확인해 실제 문제(TP), 의도적 표현 등 오탐(FP), 보류로 분류한다.
2. **경고가 없는 Cue도** 독립적으로 검토한다. 실제 문제인데 Rule이 발생하지 않았으면 FN을 기록한다. 오류 목록만 보면 미탐률을 구할 수 없다.
3. Rule별 precision = TP/(TP+FP), recall = TP/(TP+FN), 미탐 비율 = FN/(TP+FN)을 계산한다. 분모 0은 N/A다. FP/(TP+FP)는 발생 중 오탐 비율이며 전체 음성 표본에 대한 FPR과 구분한다.
4. 같은 판정 단위(Cue/Rule, 시간 관계는 대상·참조 Cue 포함)를 유지하고 보류 및 파싱 실패는 별도 집계한다. 복수 Rule을 단일 오류로 섞지 않는다. 이 도구가 사람 판정이나 정확도 계산을 자동으로 수행하지는 않는다.

## 프리셋 변경 전 최소 표본 제안

다음은 통계적 충분성이나 외부 납품 기준이 아닌 **내부 검토 시작 조건 제안**이다. 아직 확정된 제품 정책이 아니다.

- 변경 대상 프리셋마다 독립 영상 10개 이상, 전체 1,000 Cue 이상. 최소 3개 콘텐츠/제작 출처 범주를 포함하고 단일 영상이 표본을 지배하지 않게 한다.
- 변경 대상 Rule마다 경계 전후·정상 사례와 의도적 예외를 포함한 사람 판정 사례 30개 이상. 드문 Rule의 사례가 부족하면 수치를 성급히 변경하지 않고 추가 표본을 모은다.
- 경고가 없는 Cue 최소 200개를 별도 검토하고, 두 검토자가 최소 20%를 중복 검토해 불일치를 조정한다. 조정용 샘플과 독립 검증용 영상(최소 20%)을 분리한다.
- 표본 출처/권리, TP/FP/FN/보류, 실패율, 변경 전후 영향, 회귀 fixture 추가 근거를 기록한다. 승인된 변경에만 profile/Rule/계산 정책의 해당 버전을 올리고 기존 전체 검증을 다시 실행한다. 이번 작업에서는 임계값이나 버전을 변경하지 않는다.

## 이번 구현 검증 기록

2026-08-31, Node 24.12.0. 기존 엔진·파서·프리셋·UI를 변경하지 않았다. CLI 어댑터(`scripts/corpus.ts`, `scripts/qa-corpus.ts`), 테스트(`tests/corpus-cli.test.ts`), npm 실행/포맷 스크립트, tsx 개발 의존성과 lockfile, Git 제외 규칙, 이 문서만 추가·수정했다.

- `npm test`: 7 suite / 115개 통과. 기존 105개 유지, 신규 10개로 재귀 검사, 기존 엔진 집계 일치, 모든 프리셋, 결정성, 원본 보존, 본문/손상 필드 비노출, UTF-8/용량/빈 파일, 심볼릭 링크 제외, Markdown 이스케이프, 출력 보존, 실제 CLI 종료 코드를 검증했다.
- `npm run test:corpus`: 기존 합성 계약 23개 통과.
- `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm run build`: 통과.
- `npm run qa:corpus -- ./tests/fixtures/v1`: 23개 파일 / 36 Cue, Critical 8 / Warning 13 / Info 2. 부분 파싱 2개, 검사 불가 0개. 손상 fixture가 있으므로 정상적으로 종료 코드 2와 Markdown/JSON을 생성했다. 전체 fixture에 General 프리셋을 적용한 결과이며, 파일별 지정 프리셋을 사용하는 기존 합성 계약 테스트의 기대값과 직접 혼동하지 않는다.
- 임시 Git 저장소에서 현재 `.gitignore`를 적용해 비공개 샘플·기본/사용자 지정 보고서 제외, 합성 SRT/VTT 미제외를 확인했다. 프로젝트 자체의 Git 상태는 `.git` 부재로 검증할 수 없다.

실제 샘플은 투입하지 않았다. 남은 작업은 권리·개인정보 확인, 비식별 샘플 ID 부여, 사람 판정 기록과 표본 구성 합의다. 대규모 Corpus는 집계·이슈를 메모리에 보관하므로 분할 실행을 권장한다. 검사 도중 입력 파일·디렉터리를 바꾸지 않는다. 이번 CLI 작업은 UI를 변경하지 않아 브라우저 E2E는 다시 실행하지 않았다.
