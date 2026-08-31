import type { SubtitleTrack } from "../../domain/models";
import { INPUT_LIMITS } from "../subtitles/parser";
import {
  TRANSLATION_STYLES,
  type BatchLimits,
  type CueContext,
  type TranslationBatch,
  type TranslationOptions,
  type TranslationRequestItem,
} from "./types";

export const DEFAULT_BATCH_LIMITS: Readonly<BatchLimits> = Object.freeze({
  maxItems: 32,
  maxBytes: 32768,
  contextBytes: 2048,
});
const encoder = new TextEncoder();
export const batchBytes = (batch: TranslationBatch): number =>
  encoder.encode(JSON.stringify(batch)).byteLength;

function context(
  cue: SubtitleTrack["cues"][number] | undefined,
  limit: number,
): CueContext | null {
  if (!cue) return null;
  let text = "";
  let size = 0;
  for (const point of cue.text) {
    const bytes = encoder.encode(point).byteLength;
    if (size + bytes > limit) break;
    text += point;
    size += bytes;
  }
  return Object.freeze({
    cueId: cue.id,
    text,
    truncated: text.length !== cue.text.length,
  });
}

/** Plan every batch before calling a provider. Never split or truncate a source cue. */
export function createTranslationBatches(
  track: SubtitleTrack,
  options: TranslationOptions,
): readonly TranslationBatch[] {
  const limits = { ...DEFAULT_BATCH_LIMITS, ...options.limits };
  if (
    Object.values(limits).some(
      (value) => !Number.isSafeInteger(value) || value <= 0,
    )
  )
    throw new Error("배치 한도는 양의 안전한 정수여야 합니다.");
  if (
    !options.sourceLanguage.trim() ||
    options.sourceLanguage.length > 64 ||
    /^ko(?:-|$)/i.test(options.sourceLanguage.trim())
  )
    throw new Error(
      "외국어 원문 언어를 명시해 주세요. 대상 언어는 한국어입니다.",
    );
  if (!Object.hasOwn(TRANSLATION_STYLES, options.style))
    throw new Error("지원하지 않는 번역 스타일입니다.");
  if (!track.id || track.cues.length > INPUT_LIMITS.maxCues)
    throw new Error("원본 Track과 10,000 Cue 한도를 확인하세요.");
  const ids = new Set<string>();
  let previousOrder = 0;
  for (const cue of track.cues) {
    if (
      !cue.id ||
      ids.has(cue.id) ||
      cue.trackId !== track.id ||
      !Number.isSafeInteger(cue.order) ||
      cue.order <= previousOrder ||
      cue.startMs === null ||
      cue.endMs === null ||
      !Number.isSafeInteger(cue.startMs) ||
      !Number.isSafeInteger(cue.endMs) ||
      cue.startMs < 0 ||
      cue.endMs <= cue.startMs
    )
      throw new Error(
        "원본 Cue의 ID·순서·Track 연결·타임코드가 올바르지 않습니다.",
      );
    ids.add(cue.id);
    previousOrder = cue.order;
  }
  const batches: TranslationBatch[] = [];
  let items: TranslationRequestItem[] = [];
  for (let index = 0; index < track.cues.length; index++) {
    const cue = track.cues[index];
    if (!cue.text.trim()) continue;
    // Source timing was validated above; no guessed or repaired values are used.
    const item: TranslationRequestItem = Object.freeze({
      cueId: cue.id,
      order: cue.order,
      sourceText: cue.text,
      startMs: cue.startMs!,
      endMs: cue.endMs!,
      previous: context(track.cues[index - 1], limits.contextBytes),
      next: context(track.cues[index + 1], limits.contextBytes),
      sourceLanguage: options.sourceLanguage,
      targetLanguage: "ko",
      style: options.style,
    });
    const id = batches.length + 1;
    if (
      items.length &&
      (items.length >= limits.maxItems ||
        batchBytes({ id, items: [...items, item] }) > limits.maxBytes)
    ) {
      batches.push(Object.freeze({ id, items: Object.freeze(items) }));
      items = [];
    }
    if (batchBytes({ id: batches.length + 1, items: [item] }) > limits.maxBytes)
      throw new Error(
        `Cue 순서 ${cue.order}: 원문과 문맥이 단일 배치 한도를 초과합니다. 분할하지 않았습니다.`,
      );
    items.push(item);
  }
  if (items.length)
    batches.push(
      Object.freeze({ id: batches.length + 1, items: Object.freeze(items) }),
    );
  return Object.freeze(batches);
}
