import type { TranslationBatch, TranslationResponseItem } from "./types";

export type TranslationValidationCode =
  | "INVALID_SCHEMA"
  | "COUNT_MISMATCH"
  | "MISSING_CUE"
  | "UNKNOWN_CUE"
  | "DUPLICATE_CUE"
  | "ORDER_CHANGED"
  | "EMPTY_TRANSLATION"
  | "TIMECODE_CHANGED";
export interface TranslationValidationIssue {
  readonly code: TranslationValidationCode;
  readonly resultIndex?: number;
}
export class TranslationValidationError extends Error {
  constructor(readonly issues: readonly TranslationValidationIssue[]) {
    super(
      "번역 결과의 Cue 연결·순서·시간·본문 검증에 실패했습니다. 전체 결과를 확정하지 않았습니다.",
    );
    this.name = "TranslationValidationError";
  }
}
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Validate the raw response array; do not silently sort, drop or repair provider output. */
export function validateTranslationResult(
  batch: TranslationBatch,
  raw: unknown,
): readonly TranslationResponseItem[] {
  if (!Array.isArray(raw))
    throw new TranslationValidationError([{ code: "INVALID_SCHEMA" }]);
  const issues: TranslationValidationIssue[] = [];
  if (raw.length !== batch.items.length)
    issues.push({ code: "COUNT_MISMATCH" });
  const expected = new Map(batch.items.map((item) => [item.cueId, item]));
  const seen = new Set<string>();
  const result: TranslationResponseItem[] = [];
  raw.forEach((value: unknown, index) => {
    if (
      !record(value) ||
      typeof value.cueId !== "string" ||
      typeof value.order !== "number" ||
      typeof value.text !== "string" ||
      typeof value.startMs !== "number" ||
      typeof value.endMs !== "number" ||
      Object.keys(value).some(
        (key) => !["cueId", "order", "text", "startMs", "endMs"].includes(key),
      )
    ) {
      issues.push({ code: "INVALID_SCHEMA", resultIndex: index });
      return;
    }
    const source = expected.get(value.cueId);
    if (seen.has(value.cueId))
      issues.push({ code: "DUPLICATE_CUE", resultIndex: index });
    seen.add(value.cueId);
    if (!source) issues.push({ code: "UNKNOWN_CUE", resultIndex: index });
    if (
      source &&
      (source.order !== value.order ||
        batch.items[index]?.cueId !== value.cueId)
    )
      issues.push({ code: "ORDER_CHANGED", resultIndex: index });
    if (
      source &&
      (source.startMs !== value.startMs || source.endMs !== value.endMs)
    )
      issues.push({ code: "TIMECODE_CHANGED", resultIndex: index });
    if (!value.text.trim())
      issues.push({ code: "EMPTY_TRANSLATION", resultIndex: index });
    result.push(
      Object.freeze({
        cueId: value.cueId,
        order: value.order,
        text: value.text,
        startMs: value.startMs,
        endMs: value.endMs,
      }),
    );
  });
  for (const id of expected.keys())
    if (!seen.has(id)) issues.push({ code: "MISSING_CUE" });
  if (issues.length)
    throw new TranslationValidationError(Object.freeze(issues));
  return Object.freeze(result);
}
