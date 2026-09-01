# Translation usage DB foundation

번역 API의 사용자별 일일 사용량을 예약하기 위한 DB 기반이다. API·UI·결제·크레딧과 연결하지 않으며, 일일 한도 수치를 제품 정책으로 확정하지 않는다.

## 데이터 구조

`public.translation_daily_usage`는 `(user_id, usage_date)`를 기본 키로 사용한다. `user_id`는 `auth.users.id`를 참조하며 사용자 삭제 시 함께 삭제된다. 날짜는 예약 함수가 계산한 UTC 날짜다. `request_count`, `cue_count`, `source_grapheme_count`는 음수가 될 수 없는 `bigint` 누적값이고 `created_at`, `updated_at`은 `timestamptz`다.

`private.translation_usage_limits`는 노출되지 않는 단일 행 설정이다. 일일 요청·Cue·원문 grapheme 한도를 양의 `bigint`로 저장한다. 개발 환경에는 하루 요청 10회, Cue 500개, 원문 20,000 grapheme을 UTC 날짜 기준으로 적용한다. 이 값은 확정 요금제나 출시 정책이 아니라 실제 사용 패턴을 검증하기 위한 **초기 베타 가설**이다. `PUBLIC`, `anon`, `authenticated`에는 이 스키마와 테이블 권한이 없으며 방어적으로 RLS도 활성화하고 정책은 만들지 않는다.

## 접근 제어

공개 사용량 테이블은 RLS가 활성화되어 있다. `authenticated`에는 `SELECT`만 부여하고, 정책은 `(select auth.uid()) = user_id`인 자기 행만 허용한다. INSERT·UPDATE·DELETE 권한과 정책이 없으므로 사용자는 직접 사용량을 변경하거나 삭제할 수 없다. `anon`과 `PUBLIC`에는 테이블 권한이 없다.

## 예약 함수

`public.reserve_translation_usage(p_cue_count bigint, p_source_grapheme_count bigint)`는 한 요청을 예약하고 다음을 한 행으로 반환한다.

- `reserved`: 예약 성공 여부
- `usage_date`: UTC 사용 날짜
- `request_count`, `cue_count`, `source_grapheme_count`: 예약 후 또는 거절 시 현재 누적값

함수는 사용자 ID를 받지 않고 `auth.uid()`를 내부에서 확인한다. 인증이 없거나 증가량이 잘못됐거나 한도 설정이 없으면 고정된 DB 오류로 실패한다. 함수는 `SECURITY DEFINER`와 빈 `search_path`를 사용하고 모든 객체를 스키마로 한정한다. 기본 함수 실행 권한은 `PUBLIC`·`anon`에서 제거하며 `authenticated`만 실행할 수 있다.

함수의 `INSERT ... ON CONFLICT ... DO UPDATE ... WHERE`는 `(user_id, usage_date)` 기본 키 충돌 행을 잠근 상태에서 현재 누적값과 한도를 비교하고 증가한다. 경쟁 요청은 같은 행에서 직렬화되며, 조건을 통과한 요청만 값을 바꾼다. 한도를 넘는 요청은 현재값과 `reserved=false`를 반환한다. 예약 후 외부 작업 실패에 대한 환불·보상 정책은 아직 없다.

grapheme 수는 DB가 원문을 저장하거나 다시 계산하지 않는다. 향후 API가 고정된 자막 counting policy로 계산한 값을 전달해야 한다. 직접 RPC 호출은 자기 사용량을 늘릴 수만 있고 다른 사용자 ID를 지정하거나 누적값을 줄일 수 없다.

## 아직 결정할 정책

- 초기 베타 한도의 유지·조정과 플랜별 차등 여부
- 예약 후 Provider 실패·타임아웃·사용자 취소 시 보상 여부
- 날짜 경계의 사용자 안내와 운영 모니터링
- 한도 설정 변경의 승인·감사 절차

## DB 검증과 Advisor

`supabase/tests/translation_usage.sql`은 기존 Auth 사용자 ID를 출력하지 않고 세션 claim에만 사용한다. 테스트 한도 설정과 사용량 행은 하나의 트랜잭션 안에서 만들며 첫 예약 성공, 10번째 요청에서 Cue 500개·원문 20,000 grapheme의 정확한 경계 성공, 다음 요청 거절, UTC 날짜, 자기 행 조회, 사용량 직접 쓰기 차단, 비공개 한도 읽기·쓰기 차단, 무인증 거절, 함수 ACL, RLS를 확인한 뒤 Rollback한다. 실제 사용량과 개발용 한도 설정은 테스트 종료 시 원래 상태로 복원된다.

Security Advisor의 `authenticated_security_definer_function_executable` 경고는 요구된 RPC 계약이므로 수용한다. 함수는 내부 `auth.uid()` 확인, 사용자 ID 인자 없음, 빈 `search_path`, 스키마 한정 객체, 원자적 조건부 UPSERT를 사용한다. private 설정 테이블의 “RLS enabled, no policy” 정보는 누구에게도 직접 접근을 허용하지 않는 의도된 deny-all 상태다. 프로젝트 수준의 leaked-password protection 경고와 Auth DB connection 설정 정보는 이 migration 범위 밖이며 별도 운영 결정이 필요하다.
