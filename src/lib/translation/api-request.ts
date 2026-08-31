import "server-only";
import type { Cue, SubtitleTrack } from "../../domain/models";
import { createTranslationBatches } from "./batching";
import { TRANSLATION_STYLES, type TranslationOptions } from "./types";

export const TRANSLATION_REQUEST_LIMITS = Object.freeze({
  maxBytes: 256 * 1024,
  maxCues: 128,
  maxTextBytes: 8 * 1024,
  maxIdLength: 128,
});
export class TranslationRequestError extends Error {
  constructor(
    readonly code:
      "INVALID_REQUEST" | "REQUEST_TOO_LARGE" | "UNSUPPORTED_MEDIA_TYPE",
  ) {
    super(code);
  }
}
function invalid(): never {
  throw new TranslationRequestError("INVALID_REQUEST");
}
function tooLarge(): never {
  throw new TranslationRequestError("REQUEST_TOO_LARGE");
}
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));

/** Bound actual streamed bytes, not just the untrusted Content-Length header. */
export async function readTranslationJSON(request: Request): Promise<unknown> {
  if (
    request.headers
      .get("content-type")
      ?.split(";", 1)[0]
      .trim()
      .toLowerCase() !== "application/json"
  )
    throw new TranslationRequestError("UNSUPPORTED_MEDIA_TYPE");
  const length = request.headers.get("content-length");
  if (length !== null) {
    if (!/^\d+$/.test(length)) invalid();
    if (Number(length) > TRANSLATION_REQUEST_LIMITS.maxBytes) tooLarge();
  }
  if (!request.body) invalid();
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > TRANSLATION_REQUEST_LIMITS.maxBytes) tooLarge();
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } catch (error) {
    void reader.cancel().catch(() => {});
    if (error instanceof TranslationRequestError) throw error;
    return invalid();
  } finally {
    reader.releaseLock();
  }
}

/** Strict transport DTO → ephemeral existing Track; no original file is fabricated or stored. */
export function validateTranslationRequest(raw: unknown): {
  track: SubtitleTrack;
  options: TranslationOptions;
  batchCount: number;
} {
  if (
    !record(raw) ||
    !exact(raw, ["sourceLanguage", "targetLanguage", "style", "cues"])
  )
    invalid();
  const { sourceLanguage, targetLanguage, style, cues } = raw;
  if (
    typeof sourceLanguage !== "string" ||
    sourceLanguage.length > 64 ||
    sourceLanguage.trim() !== sourceLanguage
  )
    invalid();
  try {
    if (new Intl.Locale(sourceLanguage).language === "ko") invalid();
  } catch {
    invalid();
  }
  if (
    targetLanguage !== "ko" ||
    typeof style !== "string" ||
    !Object.hasOwn(TRANSLATION_STYLES, style)
  )
    invalid();
  if (!Array.isArray(cues) || !cues.length) invalid();
  if (cues.length > TRANSLATION_REQUEST_LIMITS.maxCues) tooLarge();
  const ids = new Set<string>();
  let previousOrder = 0;
  const encoder = new TextEncoder();
  const parsed = cues.map((value: unknown): Cue => {
    if (
      !record(value) ||
      !exact(value, ["cueId", "order", "text", "startMs", "endMs"])
    )
      invalid();
    const { cueId, order, text, startMs, endMs } = value;
    if (
      typeof cueId !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(cueId) ||
      cueId.length > TRANSLATION_REQUEST_LIMITS.maxIdLength ||
      ids.has(cueId)
    )
      invalid();
    if (
      typeof order !== "number" ||
      !Number.isSafeInteger(order) ||
      order <= previousOrder
    )
      invalid();
    if (typeof text !== "string" || !text.isWellFormed()) invalid();
    if (
      encoder.encode(text).byteLength > TRANSLATION_REQUEST_LIMITS.maxTextBytes
    )
      tooLarge();
    if (
      typeof startMs !== "number" ||
      typeof endMs !== "number" ||
      !Number.isSafeInteger(startMs) ||
      !Number.isSafeInteger(endMs) ||
      startMs < 0 ||
      endMs <= startMs
    )
      invalid();
    ids.add(cueId);
    previousOrder = order;
    return {
      id: cueId,
      order,
      text,
      startMs,
      endMs,
      trackId: "request-track",
      sourceIndex: null,
      sourceLine: 0,
      rawTiming: "",
      rawBlock: "",
    };
  });
  if (!parsed.some((cue) => cue.text.trim())) invalid();
  const track: SubtitleTrack = {
    id: "request-track",
    projectId: "request-project",
    language: sourceLanguage,
    format: "srt",
    version: 1,
    originalText: "",
    cues: parsed,
  };
  const options: TranslationOptions = {
    sourceLanguage,
    style: style as keyof typeof TRANSLATION_STYLES,
  };
  // Reject any Core preflight error before constructing a provider or making a request.
  try {
    return {
      track,
      options,
      batchCount: createTranslationBatches(track, options).length,
    };
  } catch {
    return invalid();
  }
}
