const messages = {
  CONFIGURATION: "서버의 번역 API 키와 모델 설정을 확인하세요.",
  AUTHENTICATION: "번역 서비스 인증 또는 접근 권한을 확인하세요.",
  RATE_LIMIT: "번역 서비스의 요청 한도에 도달했습니다. 나중에 다시 시도하세요.",
  TIMEOUT: "번역 서비스 응답 시간이 초과되었습니다.",
  SERVER: "번역 서비스에서 일시적인 오류가 발생했습니다.",
  REFUSAL: "모델이 이 번역 요청을 거부했습니다.",
  EMPTY_RESPONSE: "번역 서비스가 번역문을 반환하지 않았습니다.",
  SCHEMA_MISMATCH:
    "번역 결과의 구조 또는 Cue 연결 검증에 실패했습니다. 결과를 확정하지 않았습니다.",
  INCOMPLETE_RESPONSE:
    "번역 응답이 완료되지 않았습니다. 결과를 확정하지 않았습니다.",
  REQUEST: "번역 요청을 처리할 수 없습니다. 모델과 요청 설정을 확인하세요.",
  CONNECTION: "번역 서비스에 연결할 수 없습니다.",
} as const;

export type TranslationProviderErrorCode = keyof typeof messages;

/** Extends the Provider rejection contract without retaining SDK errors or payloads. */
export class TranslationProviderError extends Error {
  constructor(readonly code: TranslationProviderErrorCode) {
    super(messages[code]);
    this.name = "TranslationProviderError";
  }
}
