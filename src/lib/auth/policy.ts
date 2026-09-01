/** Exact allowlist prevents URL normalization, encoded redirects and auth/API loops. */
export function safeNext(value: unknown): string {
  return typeof value === "string" &&
    [
      "/",
      "/tools/subtitle-qa",
      "/tools/subtitle-converter",
      "/tools/subtitle-translator",
    ].includes(value)
    ? value
    : "/";
}
export type AuthMode = "login" | "signup";
export const AUTH_MESSAGES = {
  unavailable:
    "로그인은 아직 설정되지 않았습니다. 자막 도구는 계속 이용할 수 있습니다.",
  input: "이메일 형식과 비밀번호를 확인하세요. 가입 비밀번호는 8~128자입니다.",
  login:
    "로그인하지 못했습니다. 이메일·비밀번호와 이메일 확인 여부를 확인하세요.",
  signup:
    "가입 요청을 처리하지 못했습니다. 입력 정보를 확인하고 잠시 후 다시 시도하세요.",
  confirmation:
    "확인 링크가 만료되었거나 유효하지 않습니다. 가입한 브라우저에서 다시 시도하세요.",
  sent: "가입 가능한 이메일이면 확인 메일이 전송됩니다. 같은 브라우저에서 메일의 링크를 열어 주세요.",
  logout: "로그아웃하지 못했습니다. 잠시 후 다시 시도하세요.",
} as const;
export function validCredentials(
  mode: AuthMode,
  email: string,
  password: string,
) {
  return (
    email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) &&
    password.length >= (mode === "signup" ? 8 : 1) &&
    password.length <= 128
  );
}
