import type { Cue } from "../../domain/models";

export const TRANSLATION_STYLES = {
  faithful: "원문 충실",
  natural: "자연스러운 한국어",
  concise: "짧은 자막",
} as const;
export type TranslationStyle = keyof typeof TRANSLATION_STYLES;
export interface CueContext {
  readonly cueId: Cue["id"];
  readonly text: string;
  readonly truncated: boolean;
}
export interface TranslationRequestItem {
  readonly cueId: Cue["id"];
  readonly order: Cue["order"];
  readonly sourceText: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly previous: CueContext | null;
  readonly next: CueContext | null;
  readonly sourceLanguage: string;
  readonly targetLanguage: "ko";
  readonly style: TranslationStyle;
}
export interface TranslationBatch {
  readonly id: number;
  readonly items: readonly TranslationRequestItem[];
}
/** Provider must return this shape, but its runtime output is always untrusted. */
export interface TranslationResponseItem {
  readonly cueId: string;
  readonly order: number;
  readonly text: string;
  readonly startMs: number;
  readonly endMs: number;
}
export interface TranslationProvider {
  translateBatch(batch: TranslationBatch): Promise<unknown>;
}
export interface BatchLimits {
  readonly maxItems: number;
  readonly maxBytes: number;
  readonly contextBytes: number;
}
export interface TranslationOptions {
  readonly sourceLanguage: string;
  readonly style: TranslationStyle;
  readonly limits?: Partial<BatchLimits>;
}
export interface TranslatedCue {
  readonly cueId: Cue["id"];
  readonly order: Cue["order"];
  readonly startMs: number;
  readonly endMs: number;
  readonly sourceText: string;
  readonly translatedText: string;
  readonly status: "translated" | "skipped-empty";
}
export interface TranslationResult {
  readonly sourceTrackId: string;
  readonly sourceTrackVersion: number;
  readonly sourceLanguage: string;
  readonly targetLanguage: "ko";
  readonly style: TranslationStyle;
  readonly cues: readonly TranslatedCue[];
}
