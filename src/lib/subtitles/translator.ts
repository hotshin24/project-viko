import type { Cue, SubtitleFormat, SubtitleTrack } from "../../domain/models";
import { decodeUtf8, INPUT_LIMITS, parseSubtitles } from "./parser";

export const TRANSLATOR_MAX_CUES = 128;
export type TranslatorSourceLanguage = "auto" | "en" | "ja" | "zh";
export type TranslatorStyle = "natural" | "faithful";

export interface TranslationFile {
  readonly filename: string;
  readonly format: SubtitleFormat;
  readonly track: SubtitleTrack;
}

export interface TranslationPreviewCue {
  readonly cueId: string;
  readonly order: number;
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
  readonly status: "translated" | "skipped-empty";
}

const extensionOf = (filename: string): SubtitleFormat | null => {
  const match = /\.(srt|vtt)$/i.exec(filename);
  return match ? (match[1].toLowerCase() as SubtitleFormat) : null;
};

export function prepareTranslationFile(
  buffer: ArrayBuffer,
  filename: string,
): TranslationFile {
  if (buffer.byteLength > INPUT_LIMITS.maxBytes)
    throw new Error("파일은 5 MiB 이하로 선택해 주세요.");
  const format = extensionOf(filename);
  if (!format) throw new Error("SRT 또는 VTT 파일을 선택하세요.");
  const originalText = decodeUtf8(buffer);
  const parsed = parseSubtitles(originalText, format, "translation-track");
  if (parsed.issues.length)
    throw new Error(
      "파일 구조나 타임코드가 손상되어 번역할 수 없습니다. 원본을 확인해 주세요.",
    );
  if (parsed.cues.length > TRANSLATOR_MAX_CUES)
    throw new Error(
      `현재 번역은 한 파일당 최대 ${TRANSLATOR_MAX_CUES} Cue까지 지원합니다. 파일을 나누어 주세요.`,
    );
  if (!parsed.cues.some((cue) => cue.text.trim()))
    throw new Error("번역할 원문이 있는 Cue를 찾지 못했습니다.");
  if (
    parsed.cues.some(
      (cue) =>
        cue.startMs === null || cue.endMs === null || cue.endMs <= cue.startMs,
    )
  )
    throw new Error("잘못된 타임코드가 있어 번역할 수 없습니다.");
  return {
    filename,
    format,
    track: {
      id: "translation-track",
      projectId: "translation-project",
      language: null,
      format,
      version: 1,
      originalText,
      cues: parsed.cues,
    },
  };
}

export function translationRequest(
  input: TranslationFile,
  sourceLanguage: TranslatorSourceLanguage,
  style: TranslatorStyle,
) {
  return {
    sourceLanguage: sourceLanguage === "auto" ? "und" : sourceLanguage,
    targetLanguage: "ko" as const,
    style,
    cues: input.track.cues.map((cue) => ({
      cueId: cue.id,
      order: cue.order,
      text: cue.text,
      startMs: cue.startMs!,
      endMs: cue.endMs!,
    })),
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateTranslationPreview(
  input: TranslationFile,
  response: unknown,
): readonly TranslationPreviewCue[] {
  if (!record(response) || !Array.isArray(response.cues))
    throw new Error("번역 결과 형식을 확인할 수 없습니다.");
  if (response.cues.length !== input.track.cues.length)
    throw new Error("일부 Cue가 누락되어 결과를 표시하지 않았습니다.");
  return response.cues.map((value, index) => {
    const source = input.track.cues[index];
    if (
      !record(value) ||
      value.cueId !== source.id ||
      value.order !== source.order ||
      typeof value.startMs !== "number" ||
      typeof value.endMs !== "number" ||
      value.startMs !== source.startMs ||
      value.endMs !== source.endMs ||
      typeof value.text !== "string" ||
      (value.status !== "translated" && value.status !== "skipped-empty") ||
      (source.text.trim()
        ? value.status !== "translated" || !value.text.trim()
        : value.status !== "skipped-empty" || value.text !== source.text)
    )
      throw new Error(
        `Cue ${source.order}의 순서·시간·본문 보존을 확인할 수 없습니다.`,
      );
    return {
      cueId: value.cueId,
      order: value.order,
      startMs: value.startMs,
      endMs: value.endMs,
      text: value.text,
      status: value.status,
    };
  });
}

function timestamp(ms: number, format: SubtitleFormat) {
  return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}${format === "srt" ? "," : "."}${String(ms % 1000).padStart(3, "0")}`;
}

function safeFilename(filename: string, format: SubtitleFormat) {
  const base = filename
    .split(/[\\/]/)
    .pop()!
    .replace(/\.(srt|vtt)$/i, "")
    .replace(/[\u0000-\u001f\u007f<>:"|?*\u202a-\u202e\u2066-\u2069]/g, "_")
    .replace(/^[. ]+|[. ]+$/g, "");
  return `${base || "subtitle"}.ko.${format}`;
}

export function serializeTranslation(
  input: TranslationFile,
  translated: readonly TranslationPreviewCue[],
) {
  const cues: Cue[] = input.track.cues.map((cue, index) => ({
    ...cue,
    text: translated[index].text,
  }));
  const blocks = cues.map((cue, index) => {
    const timing = `${timestamp(cue.startMs!, input.format)} --> ${timestamp(cue.endMs!, input.format)}`;
    if (input.format === "srt") return `${index + 1}\n${timing}\n${cue.text}`;
    const cueId = cue.sourceIndex ? `${cue.sourceIndex}\n` : "";
    return `${cueId}${timing}\n${cue.text}`;
  });
  return {
    text: `${input.format === "vtt" ? "WEBVTT\n\n" : ""}${blocks.join("\n\n")}\n`,
    filename: safeFilename(input.filename, input.format),
    mimeType:
      input.format === "vtt"
        ? "text/vtt;charset=utf-8"
        : "application/x-subrip;charset=utf-8",
  };
}
