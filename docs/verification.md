# QA MVP v1 검증 기록

검증일: 2026-08-31. 기준 문서는 `docs/VIKO_Localize_PRD_v2.0.md`와 이번 안정화 요청이다. PRD 및 AGENTS.md는 변경하지 않았다. 현재 폴더는 Git 저장소가 아니어서 Git diff/commit 비교는 할 수 없다. 기존 소스 구조와 디자인을 유지했고, 다른 프로젝트의 3000번 서버는 건드리지 않았다. VIKO의 IPv4 `127.0.0.1:3000` 개발 서버 cwd를 확인하고 재사용했다.

## 구현 및 자동 검증

환경: Node 24.12.0 / npm 11.6.2 / Next.js 16.3.3 / TypeScript 6.0.3 / Vitest 4.1.11 / Playwright 1.62.1. Playwright 러너는 기존 프로젝트에 없어 추가했고, 이미 설치된 Chromium 실행 파일을 재사용했다. 별도 테스트 도구나 브라우저를 중복 설치하지 않았다.

| 명령                   | 결과                                                      |
| ---------------------- | --------------------------------------------------------- |
| `npm test`             | 6개 suite, 105개 테스트 통과                              |
| `npm run test:corpus`  | v1 합성 fixture 23개, 전체 예상 이슈 목록 비교            |
| `npm run test:e2e`     | Chromium 5개 시나리오 통과                                |
| `npm run lint`         | 오류·경고 없이 통과                                       |
| `npm run typecheck`    | 통과                                                      |
| `npm run build`        | 프로덕션 빌드 통과, `/` 정적 사전 렌더링 + QA Worker 청크 |
| `npm run format:check` | 통과; 바이너리/자막 fixture와 PRD는 포맷 대상 제외        |

원래 35개 테스트를 보존하면서 70개를 추가했다. 기존 파서의 본문 `이전 --> 다음`을 새 Cue로 오인하는 문제도 회귀 테스트와 함께 수정했다. 10,000 Cue 성능 테스트는 기존 10초 기준을 통과한다. 이는 로컬 Node 합성 부하 결과이며 모든 기기의 화면 렌더링 성능 보증은 아니다.

## 검증 범위

- counting policy 1.0.0: 한글/영문/숫자/양끝·내부 공백/줄바꿈/문장부호/emoji/결합 문자/전각 문자/태그/SDH/화자/음악 기호를 수치로 검증한다. `Intl.Segmenter` 부재 시 명시적 오류도 테스트한다.
- 기존 Rule ID는 유지하고 LONG_DURATION/RECOMMENDED_CPL/DUPLICATE_TIMING을 추가했다. 모든 최종 이슈에 profile ID/version 및 Rule version이 있다.
- 23개의 새 합성 파일과 기존 4개 파일이 있다. 정상 일반·교육 자막, 긴 문장/빠른 대화, 혼합 문자, emoji, 태그, SDH, 중복, 부족한 간격, 빈/공백 Cue, 손상 SRT/VTT, CRLF, BOM, 마지막 개행 없음, 긴 단일 Cue, 반복 타임코드 등을 포함한다.
- `tests/fixtures/v1/expectations.json`은 Rule/Cue/severity/currentValue/threshold를 명시한다. 전체 목록을 비교하므로 예상하지 않은 추가 이슈도 실패한다. 문자 수 기대값과 원본 바이트 보존, 이슈 ID 유일성도 확인한다.
- 각 프로필의 권장/최대 CPL, 최소/최대 표시 시간, CPS 경계값과 overlap 허용 설정을 검증한다. 동일 입력 재실행/불변 입력 검증을 유지했다.
- 저장 모듈은 schema·profile·rule·계산 정책 버전, JSON 손상, 타입 불일치, 미래/만료 시각, 용량 초과, storage getter 차단, quota 실패, 삭제 후 복원 없음, 다른 저장 key 보존을 테스트한다.

## 키보드·브라우저 E2E

재현 코드: `tests/e2e/qa.spec.ts`, 설정: `playwright.config.ts`. 모든 테스트는 합성 데이터와 격리된 브라우저 컨텍스트만 사용한다.

1. **키보드 주요 흐름:** 문서에서 Tab → skip link → 홈 링크 → file input 순서를 검증한다. Enter로 실제 file chooser를 연 뒤 fixture 경로만 러너가 공급한다. 프리셋에서 키보드 문자열 검색으로 Korean Education 선택 → Tab/Enter 검사 실행 → Tab으로 severity/Rule 필터 접근 및 키보드 문자열 검색 → Space로 Cue 선택 → Tab/Enter로 원본 상세 열기 → Tab/Enter로 저장본 삭제 → file input으로 포커스 복귀 → 새로고침 시 복원되지 않음을 검증한다. 이 시나리오에는 `.click()`, `.focus()`, `.selectOption()` 또는 DOM 이벤트 주입이 없다.
2. **복원:** 시간 중복 SRT 검사 → 저장 상태 확인 → reload → 복원 완료와 동일 요약·파일명 확인 → 삭제 → reload 시 저장본 없음.
3. **파일 처리:** 정상 교육 VTT에서 불필요한 Critical 없음, 비 UTF-8 입력에서 이해 가능한 오류, 자막 처리 중 POST/PUT/PATCH 요청 없음.
4. **저장 실패:** quota 오류를 주입해도 정상 QA 리포트와 성공 화면 유지, 저장 실패 메시지 표시.
5. **폐기:** schema 불일치 및 만료 데이터가 복원되지 않고 삭제 안내가 표시됨.

폼 label, 명명된 QA 요약 group, QA 처리/필터/저장 live status, 텍스트 severity, Cue 선택 `aria-pressed`, 상세 `aria-controls`, file input과 실행 버튼의 focus outline을 확인한다. 실제 스크린리더 음성 출력이나 모든 보조공학 제품의 인증 검사는 아니다.

macOS headless Chromium의 native select 팝업은 방향키 시퀀스를 기대대로 확정하지 않았다. 별도 임시 진단으로 **native typeahead(문자열 검색)**는 정상 동작함을 확인하고 그 실제 키보드 경로로 E2E를 작성했다. Rule 옵션은 ID와 한국어 이름을 함께 표시해 정확한 검색·식별을 지원한다. 진단용 테스트 파일은 제거했다. v0에서 미확인이었던 주요 키보드 흐름은 이 저장된 E2E로 대체 검증했다. 방향키 팝업 조작 및 OS 파일 대화상자 내부 탐색은 별도 수동 검증 대상이다.

## 임시 저장과 개인정보

- 선택: **sessionStorage**, key `viko:qa-session`, schemaVersion=1. localStorage보다 탭 수명에 맞고 IndexedDB보다 단순하다. 일반적인 세션 특성은 [MDN sessionStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/sessionStorage)를 참고했다.
- 저장 항목: 자막 원문, 파일명, 형식, profile ID/version, Rule/counting version, 저장 시각. 영상/오디오, 원본 File 객체, 중복 Cue 트리, 리포트 트리, 사용자 계정 정보는 저장하지 않는다.
- 복원 시 저장된 원문을 Worker에 전달해 같은 결과를 재계산한다. 필터/선택 Cue는 기본값으로 돌아간다. 원문 저장 여부와 서버 전송 없음은 업로드 전에 표시한다.
- 직렬화 문자열 최대 500,000 UTF-16 code unit(약 1 MB). 이 `.length`는 저장 용량 제한이며 자막 CPL/CPS 계산이 아니다. 초과해도 QA는 정상 동작하고 복원 불가를 알린다.
- 저장 후 24시간 경과, 미래 시각, 버전/형식/스키마 불일치, JSON 손상은 **복원 시** 폐기한다. 읽기만으로 TTL을 연장하지 않는다. 계속 열린 탭의 만료 데이터를 물리적으로 정리하는 백그라운드 타이머는 없다.
- 새 파일·프리셋 선택 시 이전 저장본을 지우며, 삭제 버튼은 처리 중 Worker도 취소하고 원문 File/결과 상태/저장 key를 지운다. 다른 origin 데이터나 다른 key는 삭제하지 않는다.
- 저장 실패는 QA 실패와 구분한다. 삭제 권한 자체가 차단되면 삭제 성공을 주장하지 않고 브라우저 사이트 데이터 확인을 안내한다.
- sessionStorage는 암호화 저장소가 아니다. 같은 origin 스크립트가 접근할 수 있으며 브라우저 세션 복구나 opener에 의한 복사 동작이 있을 수 있다. 공용 기기에서는 직접 삭제를 권장한다. 서버/AI 전송, 파일 본문 로그, analytics는 없다.

## ESLint 고정 재검토

현재 조합: eslint **9.39.5**, eslint-config-next **16.3.3**, 해당 설정에 포함된 eslint-plugin-react **7.37.5**, eslint-plugin-import **2.32.0**, eslint-plugin-jsx-a11y **6.10.2**. Next 설정의 넓은 peer 선언(`eslint >=9`)만으로 ESLint 10 호환성을 판단할 수 없다.

2026-08-31에 프로젝트 의존성을 바꾸지 않고 다음으로 재현했다:

```sh
npm exec --yes --package=eslint@10.9.1 -- eslint --config eslint.config.mjs src/components/qa-workspace.tsx
```

ESLint 10.9.1에서 exit 2:

```text
TypeError: Error while loading rule 'react/display-name': contextOrFilename.getFilename is not a function
```

호출 지점은 `eslint-plugin-react/lib/util/version.js:31`. 따라서 9.39.5 고정을 유지했다. rule 비활성화, `--legacy-peer-deps`, peer 강제 무시는 사용하지 않았다. `package.json`, lockfile root, 실제 resolved version이 모든 직접 의존성에서 일치함을 검사했다.

로컬 `npm ls --depth=0`에는 이전 설치 과정의 optional WASM 잔여 패키지 3개가 extraneous로 표시된다 (`@img/sharp-wasm32`, `@napi-rs/wasm-runtime`, `@tybys/wasm-util`). 이번 작업에서 임의 삭제하지 않았다. 이 항목과 별개로 선언된 직접 의존성의 package/lock/resolved 버전 일치는 확인했다. 새 환경은 lockfile을 사용하는 `npm ci`로 설치한다.

업그레이드 조건: React/import/a11y 플러그인 및 Next ESLint 설정이 ESLint 10 API와 peer 범위를 지원하고, 격리 실행에서 동일 오류가 없어지며, 전체 lint/type/unit/E2E/build가 통과할 때 함께 갱신한다. ESLint 9의 지원 종료 설치 경고는 남은 개발 도구 유지보수 위험이다.

## 한계와 다음 검증

- 임계값은 명시적 가설이며 실제 한국어 corpus 오탐률/미탐률을 측정하지 않았다. 합성 fixture 통과를 현장 품질 인증으로 표현하지 않는다.
- 고급 VTT 스타일/배치/복잡한 루비는 완전한 렌더러로 검증하지 않는다. 시간 겹침은 Cue당 대표 참조를 사용한다.
- 다양한 브라우저/ICU와 보조공학, 극단적으로 긴 텍스트의 실제 렌더링 부하는 추가 검증 대상이다. 5 MiB / 10,000 Cue 입력 한도를 유지했다.
- DB/로그인/AI/영상 처리/결제/Glossary/Doctor/배포 자동화를 추가하지 않았다.
- 다음 단계는 권리와 개인정보를 확인한 실제 자막 샘플에 대한 오탐·미탐 리뷰 및 프리셋 보정이다. 계산 계약·기대값 변경 시 버전을 함께 갱신한다.

## Tool Registry 플랫폼 구조 검증 (2026-08-31)

이번 작업 시작 시 작업 트리는 깨끗했고 `main`, `origin/main`, GitHub의 main/HEAD가 기준 커밋 `5b5eebb3ad1b8fec6527bce0451b30c4ea45b33e`에서 일치했다. 위의 Git 부재 기록은 초기 구현 당시의 기록이다.

- `/`는 Registry의 도구 6개를 표시하는 탐색 화면이다. QA만 실행 링크가 있고 나머지 5개는 준비 중 안내와 미정인 형식만 표시한다.
- `/tools/subtitle-qa`에서 기존 QA를 실행한다. `/tools/[toolId]`는 Registry의 available 항목만 로드하며 준비 중 및 미등록 도구는 404다. 홈·공통 Header·페이지 제목이 같은 Registry 정보를 사용한다.
- 기존 Rule/프리셋/임계값/파서/Worker/sessionStorage 모듈·키·schema와 PRD, 패키지 의존성은 Git diff로 변경 없음을 확인했다. 기존 화면에는 Header 분리·도구명 prop·본문 포커스 대상만 적용했다.
- `npm run lint`, `npm run typecheck`, `npm test` (8 suite / 117개), `npm run test:e2e` (Chromium 12개), `npm run format:check`, `npm run build` 통과. 빌드에서 홈은 정적, QA는 Registry의 generateStaticParams로 사전 렌더링된다.
- E2E: 기존 QA 5개를 새 경로에서 검증했고, 홈 카드·키보드 진입·홈 왕복 및 새로고침 복원 1개, 준비 중 직접 접근 차단 5개, 미등록 경로 1개를 추가했다. 복원 비교는 innerText를 수집하므로 검증도 useInnerText를 사용한다.
- 최초 빌드 병행 E2E에서는 홈 진입 URL 대기가 한 차례 실패했으나 단독 재실행에서 진입했고, 이후 발견한 텍스트 비교 방식 차이를 수정한 전체 실행은 통과했다. 임의 대기나 자동 retry로 실패를 숨기지 않았다. `NO_COLOR`/`FORCE_COLOR` 충돌 경고는 러너 출력 색상에 관한 환경 경고다.
- React 점검: 홈·라우트·Header는 Server Component로 유지하고 실행 함수가 포함된 Registry 객체를 클라이언트에 직렬화하지 않는다. 선택된 화면에 도구명 문자열만 전달하며 기존 QA hooks를 변경하지 않았다.

Registry에 준비 중 도구를 추가하는 것과 실제 기능 구현은 별개다. 새로 구현한 화면의 loader와 available 상태를 등록하면 홈/경로/제목이 연결되지만, 준비 중 도구의 실제 입출력 계약과 기능은 여전히 후속 범위다. 이번 변경은 커밋하거나 원격으로 push하지 않았다.
