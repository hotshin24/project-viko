# Supabase Auth 기반

이메일 가입·로그인·로그아웃·쿠키 세션 유지만 구현한다. 프로젝트 설정·DB·RLS·Google·프로필·Translation API 권한·사용량 제한·결제·Translator UI는 변경하지 않는다.

## 구조

- `src/lib/supabase/config.ts`: 공개 URL과 publishable key를 함께 검증한다. 누락/잘못된 값은 비활성으로 처리한다. HTTPS 또는 로컬 개발 HTTP만 허용한다. legacy key나 privileged key로 대체하지 않는다.
- `browser.ts`: `@supabase/ssr`의 브라우저 Client, PKCE와 쿠키 저장을 SDK에 맡긴다. 이메일·비밀번호는 Supabase Auth로 직접 전송하며 별도로 저장하지 않는다.
- `server.ts`: 요청별 서버 Client. 비동기 cookies API를 사용한다. Server Component는 읽기 전용, Callback Route만 쓰기를 허용한다. Header의 사용자 표시는 `getUser()`의 서버 확인 결과만 사용한다.
- `src/proxy.ts`와 `lib/supabase/proxy.ts`: 홈·로그인·도구·Auth 경로에서 `getClaims()`를 호출해 세션 갱신. 요청과 응답의 모든 쿠키 조각을 동기화하고 만료 쿠키도 전달한다. SSR의 캐시 방지 헤더를 반영한다. 인증을 강제하는 경계가 아니며 Auth 장애에도 로컬 도구를 차단하지 않는다. API 경로는 대상에서 제외했다.
- `/login`: 로그인/가입 모드, 폼 라벨·키보드·진행 상태·고정 오류 메시지 제공. 설정이 없으면 폼을 비활성화하고 도구 이용 안내를 표시한다.
- `/auth/callback`: PKCE code와 SDK의 `sb_flow_id`를 검증해 세션으로 교환한 뒤 `getUser()`로 확인하고 안전한 내부 경로로 이동한다. 오류는 `/login?error=confirmation`으로만 이동한다. 토큰·코드·내부 오류를 HTML이나 오류 URL에 반향하지 않는다. 상대 Location으로 응답해 원래 브라우저 호스트를 유지하고 프록시/로컬 호스트 이름 정규화로 인한 쿠키 유실을 방지한다.
- Header: 확인된 이메일과 로그아웃, 또는 로그인 링크. Auth 이벤트 시 서버 화면을 새로 읽으며 사용자·토큰 객체를 Client Component에 전달하지 않는다.

패키지 고정 버전: `@supabase/supabase-js` 2.112.4, `@supabase/ssr` 0.12.5. Node 24 / TypeScript 6 / Next.js 16.3.3 환경을 사용한다.

## 환경변수

| 이름                                 | 용도                               |
| ------------------------------------ | ---------------------------------- |
| NEXT_PUBLIC_SUPABASE_URL             | Supabase 프로젝트 URL              |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | `sb_publishable_` 접두사의 공개 키 |

두 값은 브라우저에서 사용되므로 공개 정보다. 실제 값은 이번 작업에서 만들거나 저장하지 않는다. `.env.example`은 빈 값과 설명만 포함한다. 설정이 없으면 클라이언트 생성·Auth 네트워크 요청 없이 QA·Converter가 동작한다. NEXT_PUBLIC 값은 빌드 시 반영되므로 설정 변경 후 재시작/재빌드해야 한다.

## 사용자 흐름

1. Header 로그인 → `/login`, 이메일과 비밀번호 입력.
2. 가입은 이메일 형식·최대 254자, 비밀번호 8~~128자를 확인한다. 로그인 비밀번호는 기존 계정 호환을 위해 1~~128자다. 비밀번호 공백을 제거하지 않는다. 서버의 실제 비밀번호 정책은 프로젝트 설정을 따른다.
3. 확인이 필요한 가입이면 계정 존재 여부를 드러내지 않는 안내를 표시한다. 기본 Supabase 확인 메일 링크는 PKCE code와 함께 `/auth/callback`으로 돌아와야 한다. 별도 token_hash 템플릿은 이번 구현에서 지원하지 않는다.
4. **가입한 동일 브라우저**에서 확인 링크를 열어야 PKCE verifier 쿠키를 사용할 수 있다. 다른 브라우저나 만료된 링크는 고정 오류 안내를 표시한다.
5. 로그인 성공 후 Header가 검증된 이메일을 표시하고 새로고침에도 쿠키 세션을 유지한다.
6. 로그아웃은 `scope: local`로 현재 브라우저 세션을 종료한다. 다른 기기의 세션까지 종료하는 기능은 포함하지 않는다.

## 보안 검토

- 서버 인증 판단에 `getSession()`을 호출하지 않는다. 검증 없이 쿠키의 사용자 객체를 신뢰하거나 사용자 메타데이터로 권한을 판단하지 않는다.
- `next`는 `/`, `/tools/subtitle-qa`, `/tools/subtitle-converter`의 정확한 allowlist만 허용한다. 나머지는 `/`로 이동한다. 외부·프로토콜 상대 URL, 역슬래시·인코딩·쿼리·경로 정규화 우회와 인증/API 경로를 차단한다. 새로운 이동 대상은 명시적으로 추가해야 한다.
- Auth 오류는 고정 메시지로만 표시한다. 비밀번호·토큰·Supabase 내부 응답을 앱 로그에 출력하지 않는다. 모킹 테스트의 이메일·비밀번호·토큰은 합성 값이다.
- Callback은 `private, no-store`와 `Referrer-Policy: no-referrer`를 반환한다. Proxy도 설정된 경우 응답 캐시를 금지한다. 배포 CDN이 이를 덮어쓰지 않도록 확인해야 한다.
- 브라우저 SSR 세션 쿠키는 SDK가 읽을 수 있어야 한다. HttpOnly로 임의 변경하지 않으며, XSS 방어와 배포 HTTPS가 중요하다.
- `getClaims`는 서명·만료를 검증하지만 원격 세션 폐기 여부를 매번 확인하지는 않는다. 현재 Header는 최신 확인을 위해 `getUser`를 사용한다. 향후 민감한 작업은 각 서버 작업에서 별도의 인증·권한 검사가 필요하다.
- Translation API의 기존 플래그는 그대로다. 이번 Auth는 해당 API를 보호하지 않는다. 인증 연결 전 공개 배포에서 Translation 플래그를 켜지 않는다.

## 검증 방식

`tests/auth.test.ts`: SDK와 쿠키 경계를 모킹하여 설정 누락, 입력 검증, 안전한 redirect, 가입·로그인·로그아웃, 서버 확인, Proxy 쿠키 갱신·삭제·캐시 헤더, Callback 성공·실패, 내부 오류 비노출을 검사한다.

`npm run test:e2e`는 설정 없는 기존 도구/로그인 화면 테스트와 설정된 Auth 흐름 테스트를 순서대로 실행한다. `scripts/auth-e2e-server.mjs`는 임시 디렉터리에 앱을 복사하고 고정된 합성 환경변수로 빌드한다. 설정된 테스트는 로컬 HTTP Auth 서버를 사용하며 실제 Supabase 서비스를 호출하거나 이메일을 발송하지 않는다. 현재 작업 디렉터리의 `.env`와 API 키를 복사하지 않는다. 모든 임시 앱·프로세스는 테스트 종료 시 정리한다. 기존 도구 E2E의 키보드 순서는 새 Header 링크에 맞게 갱신했지만 도구 기능은 변경하지 않았다.

E2E 포트: 설정 없음 3116, 설정 있음 3117, 로컬 Auth 모킹 4319. 테스트 서버 재사용은 하지 않는다. 실제 프로젝트의 이메일 전달·쿠키 도메인·SMTP·서비스 비밀번호 정책까지 검증한 것은 아니다.

## 실제 프로젝트 연결 전

- 프로젝트 URL/publishable key, Email provider 및 Confirm email 정책을 확인한다.
- Site URL과 허용 Redirect URL에 정확한 개발/운영 `/auth/callback` 경로를 등록한다. 와일드카드를 무분별하게 사용하지 않는다. 기본 ConfirmationURL 흐름과 동일 브라우저 PKCE를 점검한다.
- SMTP/발송 제한·비밀번호 정책·Auth 요청 제한을 검토한다. 이번에 프로젝트 설정은 변경하지 않았다.
- HTTPS, 프록시 origin, 쿠키 도메인, CDN 캐시·민감 query/body 로그 정책을 확인한다.
- 승인을 받은 실제 테스트 계정으로 메일 수신·만료·새로고침·로그아웃을 별도로 점검한다. 이번 단계에서는 라이브 호출을 하지 않는다.

근거: [Supabase SSR Client 공식 문서](https://supabase.com/docs/guides/auth/server-side/creating-a-client), [Password/PKCE](https://supabase.com/docs/guides/auth/passwords?flow=pkce), [Changelog](https://supabase.com/changelog), 설치 Next.js Proxy·cookies 문서. 최신 SSR setAll의 캐시 헤더 인자를 설치 타입에서 확인했다.

## 이번 작업 검증 결과

단위 테스트 14 suite / 300개(Auth 47개 포함), E2E 18개(설정 없음 15 + Auth 3), 린트·타입·포맷·프로덕션 빌드 통과. 클라이언트 JS 52개에서 기존 OpenAI 서버 키·모델 변수·Provider 표식이 발견되지 않았다. 실제 프로젝트 변경·라이브 Supabase/OpenAI 호출·커밋·push는 수행하지 않았다.

진단 과정에서 Header의 새 로그인 링크에 맞춰 기존 키보드 테스트 순서를 수정했고, Callback의 절대 URL이 로컬 호스트를 바꾸는 문제를 상대 Location으로 해결했다. 부하가 겹친 실행의 기존 Corpus CLI 테스트와 한 차례의 Converter 파일 선택 대기에 시간 초과가 있었으나, 도구 구현이나 재시도 설정을 변경하지 않고 단독/전체 재실행에서 통과했다. 환경별 native 파일 선택 및 테스트 실행 시간 변동은 계속 관찰한다. 러너의 NO_COLOR/FORCE_COLOR 경고는 기능 오류가 아니다.
