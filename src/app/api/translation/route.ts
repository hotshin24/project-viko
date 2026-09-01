import {
  readTranslationJSON,
  validateTranslationRequest,
  TranslationRequestError,
} from "../../../lib/translation/api-request";
import { createOpenAITranslationProvider } from "../../../lib/translation/providers/openai";
import {
  TranslationProviderError,
  type TranslationProviderErrorCode,
} from "../../../lib/translation/provider-error";
import { translateTrack } from "../../../lib/translation/translate";
import { TranslationValidationError } from "../../../lib/translation/validation";
import { serverSupabase } from "../../../lib/supabase/server";
import { cueMetrics } from "../../../lib/subtitles/metrics";

export const runtime = "nodejs";

const failures = {
  NOT_FOUND: [404, "요청한 기능을 사용할 수 없습니다."],
  UNAUTHORIZED: [401, "로그인이 필요한 요청입니다."],
  FORBIDDEN: [403, "이 출처의 요청은 허용하지 않습니다."],
  INVALID_REQUEST: [400, "요청 언어·스타일·Cue 형식과 내용을 확인하세요."],
  REQUEST_TOO_LARGE: [413, "요청 크기 또는 Cue·본문 제한을 초과했습니다."],
  UNSUPPORTED_MEDIA_TYPE: [415, "UTF-8 application/json 요청만 지원합니다."],
  USAGE_LIMIT_EXCEEDED: [
    429,
    "오늘의 번역 사용 한도에 도달했습니다. 다음 UTC 날짜에 다시 시도하세요.",
  ],
  USAGE_SERVICE_UNAVAILABLE: [
    503,
    "번역 사용량을 확인할 수 없습니다. 잠시 후 다시 시도하세요.",
  ],
  CONFIGURATION: [503, "번역 서비스를 사용할 준비가 되지 않았습니다."],
  AUTHENTICATION: [
    502,
    "번역 서비스 인증에 실패했습니다. 관리자에게 문의하세요.",
  ],
  RATE_LIMIT: [
    429,
    "번역 서비스 요청 한도에 도달했습니다. 나중에 다시 시도하세요.",
  ],
  TIMEOUT: [504, "번역 서비스 응답 시간이 초과되었습니다."],
  SERVER: [502, "번역 서비스 오류가 발생했습니다."],
  REFUSAL: [422, "번역 서비스가 요청을 거부했습니다."],
  EMPTY_RESPONSE: [502, "번역 서비스가 결과를 반환하지 않았습니다."],
  SCHEMA_MISMATCH: [
    502,
    "번역 결과 검증에 실패했습니다. 결과를 확정하지 않았습니다.",
  ],
  INCOMPLETE_RESPONSE: [
    502,
    "번역이 완료되지 않았습니다. 결과를 확정하지 않았습니다.",
  ],
  REQUEST: [502, "번역 서비스가 요청을 처리하지 못했습니다."],
  CONNECTION: [502, "번역 서비스에 연결할 수 없습니다."],
  INTERNAL_ERROR: [500, "번역 처리 중 오류가 발생했습니다."],
} as const satisfies Record<
  TranslationProviderErrorCode | string,
  readonly [number, string]
>;
function failure(code: keyof typeof failures) {
  const [status, message] = failures[code];
  return Response.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

type UsageReservation = {
  reserved: boolean;
  usage_date: string;
  request_count: number;
  cue_count: number;
  source_grapheme_count: number;
};

function isUsageReservation(value: unknown): value is UsageReservation {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const reservation = value as Record<string, unknown>;
  return (
    typeof reservation.reserved === "boolean" &&
    typeof reservation.usage_date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(reservation.usage_date) &&
    typeof reservation.request_count === "number" &&
    Number.isSafeInteger(reservation.request_count) &&
    reservation.request_count >= 0 &&
    typeof reservation.cue_count === "number" &&
    Number.isSafeInteger(reservation.cue_count) &&
    reservation.cue_count >= 0 &&
    typeof reservation.source_grapheme_count === "number" &&
    Number.isSafeInteger(reservation.source_grapheme_count) &&
    reservation.source_grapheme_count >= 0
  );
}

export async function POST(request: Request): Promise<Response> {
  if (process.env.TRANSLATION_API_ENABLED !== "true")
    return failure("NOT_FOUND");
  let client: Awaited<ReturnType<typeof serverSupabase>>;
  try {
    client = await serverSupabase();
    if (!client) return failure("UNAUTHORIZED");
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return failure("UNAUTHORIZED");
  } catch {
    return failure("UNAUTHORIZED");
  }
  if (!client) return failure("UNAUTHORIZED");
  // No CORS opt-in. Reject cross-origin browser requests even before parsing JSON.
  const origin = request.headers.get("origin");
  if (
    (origin !== null && origin !== new URL(request.url).origin) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    return failure("FORBIDDEN");
  try {
    const { track, options, batchCount } = validateTranslationRequest(
      await readTranslationJSON(request),
    );
    const sourceGraphemeCount = track.cues.reduce(
      (total, cue) => total + cueMetrics(cue).characters,
      0,
    );
    let reservationResult: { data: unknown; error: unknown };
    try {
      reservationResult = await client.rpc("reserve_translation_usage", {
        p_cue_count: track.cues.length,
        p_source_grapheme_count: sourceGraphemeCount,
      });
    } catch {
      return failure("USAGE_SERVICE_UNAVAILABLE");
    }
    if (
      reservationResult.error ||
      !Array.isArray(reservationResult.data) ||
      reservationResult.data.length !== 1 ||
      !isUsageReservation(reservationResult.data[0])
    )
      return failure("USAGE_SERVICE_UNAVAILABLE");
    if (!reservationResult.data[0].reserved)
      return failure("USAGE_LIMIT_EXCEEDED");
    const result = await translateTrack(
      track,
      createOpenAITranslationProvider(),
      options,
    );
    return Response.json(
      {
        cues: result.cues.map(
          ({ cueId, order, startMs, endMs, translatedText, status }) => ({
            cueId,
            order,
            startMs,
            endMs,
            text: translatedText,
            status,
          }),
        ),
        metadata: {
          sourceLanguage: result.sourceLanguage,
          targetLanguage: result.targetLanguage,
          style: result.style,
          totalCues: result.cues.length,
          translatedCues: result.cues.filter(
            (cue) => cue.status === "translated",
          ).length,
          batchCount,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof TranslationRequestError) return failure(error.code);
    if (error instanceof TranslationValidationError)
      return failure("SCHEMA_MISMATCH");
    if (
      error instanceof TranslationProviderError &&
      Object.hasOwn(failures, error.code)
    )
      return failure(error.code);
    return failure("INTERNAL_ERROR");
  }
}
