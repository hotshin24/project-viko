import type { SubtitleTrack } from "../../domain/models";
import { createTranslationBatches } from "./batching";
import { validateTranslationResult } from "./validation";
import type {
  TranslatedCue,
  TranslationOptions,
  TranslationProvider,
  TranslationResult,
} from "./types";

/** Atomic in-memory result: any batch rejection aborts without exposing partial translations. */
export async function translateTrack(
  track: SubtitleTrack,
  provider: TranslationProvider,
  options: TranslationOptions,
): Promise<TranslationResult> {
  // Capture caller-owned data before the first await; provider receives separate frozen request objects.
  const source = { ...track, cues: track.cues.map((cue) => ({ ...cue })) };
  const settings = {
    ...options,
    limits: options.limits ? { ...options.limits } : undefined,
  };
  const batches = createTranslationBatches(source, settings);
  const translations = new Map<string, string>();
  for (const batch of batches) {
    const validated = validateTranslationResult(
      batch,
      await provider.translateBatch(batch),
    );
    for (const item of validated) translations.set(item.cueId, item.text);
  }
  const cues = source.cues.map((cue): TranslatedCue => ({
    cueId: cue.id,
    order: cue.order,
    startMs: cue.startMs!,
    endMs: cue.endMs!,
    sourceText: cue.text,
    translatedText: cue.text.trim() ? translations.get(cue.id)! : cue.text,
    status: cue.text.trim() ? "translated" : "skipped-empty",
  }));
  return Object.freeze({
    sourceTrackId: source.id,
    sourceTrackVersion: source.version,
    sourceLanguage: settings.sourceLanguage,
    targetLanguage: "ko",
    style: settings.style,
    cues: Object.freeze(cues.map((cue) => Object.freeze(cue))),
  });
}
