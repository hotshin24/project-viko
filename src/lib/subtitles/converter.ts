import type { Cue, SubtitleFormat } from "../../domain/models";
import { decodeUtf8, parseSubtitles } from "./parser";

type TimedCue = Cue & { readonly startMs: number; readonly endMs: number };
export interface ConversionInput {
  readonly cues: readonly TimedCue[];
  readonly targetFormat: SubtitleFormat;
  readonly filename: string;
  readonly warnings: readonly string[];
}
export interface ConversionOutput {
  readonly text: string;
  readonly filename: string;
  readonly mimeType: string;
}

/** No text normalization beyond the existing parser's BOM/line-ending handling. */
export function prepareConversion(
  buffer: ArrayBuffer,
  filename: string,
): ConversionInput {
  const extension = /\.(srt|vtt)$/i.exec(filename)?.[1].toLowerCase();
  if (extension !== "srt" && extension !== "vtt")
    throw new Error("SRT 또는 VTT 파일을 선택하세요.");
  const text = decodeUtf8(buffer);
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text))
    throw new Error(
      "파일에 지원하지 않는 제어 문자가 있어 변환할 수 없습니다.",
    );
  const parsed = parseSubtitles(text, extension);
  if (parsed.issues.length)
    throw new Error(
      "파일 구조·Cue 번호·타임코드가 손상되어 변환할 수 없습니다. 원본을 확인해 주세요.",
    );
  const cues: TimedCue[] = [];
  for (const cue of parsed.cues) {
    if (
      cue.startMs === null ||
      cue.endMs === null ||
      cue.endMs <= cue.startMs ||
      !cue.text.trim()
    ) {
      throw new Error(
        `Cue ${cue.order}: 빈 본문 또는 잘못된 시간 구간이 있어 변환할 수 없습니다.`,
      );
    }
    cues.push({ ...cue, startMs: cue.startMs, endMs: cue.endMs });
  }
  const warnings: string[] = [];
  if (extension === "vtt") {
    const blocks = text
      .replace(/^\uFEFF/, "")
      .replace(/\r\n?/g, "\n")
      .split(/\n[ \t]*\n/);
    if (blocks[0]?.trim() !== "WEBVTT")
      warnings.push(
        "VTT 헤더 설명과 헤더 메타데이터는 SRT에 저장되지 않습니다.",
      );
    if (
      blocks.some((block) =>
        /^(?:NOTE(?:[ \t\n]|$)|STYLE(?:\n|$)|REGION(?:\n|$))/.test(
          block.trimStart(),
        ),
      )
    ) {
      warnings.push("VTT의 NOTE·STYLE·REGION 블록은 SRT에 저장되지 않습니다.");
    }
    if (cues.some((cue) => cue.sourceIndex !== null))
      warnings.push(
        "VTT Cue ID는 제거되고 SRT 번호가 1부터 파일 순서대로 부여됩니다.",
      );
    if (
      cues.some((cue) =>
        /^\S+[ \t]+-->[ \t]+\S+(.*)$/.exec(cue.rawTiming)?.[1].trim(),
      )
    ) {
      warnings.push("VTT Cue의 위치·정렬 등 타임코드 뒤 설정은 제거됩니다.");
    }
    if (cues.some((cue) => /<[^>]+>/.test(cue.text)))
      warnings.push(
        "본문 태그는 그대로 보존하지만 SRT 플레이어에서는 화자·스타일·인라인 시간 표시가 달라질 수 있습니다.",
      );
  }
  const targetFormat = extension === "srt" ? "vtt" : "srt";
  const base = filename
    .split(/[\\/]/)
    .pop()!
    .replace(/\.(srt|vtt)$/i, "")
    .replace(/[\u0000-\u001f\u007f<>:"|?*\u202a-\u202e\u2066-\u2069]/g, "_")
    .replace(/^[. ]+|[. ]+$/g, "");
  return {
    cues,
    targetFormat,
    filename: `${base || "subtitle"}.${targetFormat}`,
    warnings,
  };
}
function timestamp(ms: number, format: SubtitleFormat) {
  return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}${format === "srt" ? "," : "."}${String(ms % 1000).padStart(3, "0")}`;
}
/** Loss acknowledgement is required before serialization, not just before downloading. */
export function convertSubtitles(
  input: ConversionInput,
  acknowledgeLoss = false,
): ConversionOutput {
  if (input.warnings.length && !acknowledgeLoss)
    throw new Error("메타데이터 손실 안내를 확인하고 동의해 주세요.");
  const { targetFormat, cues } = input;
  const body = cues
    .map(
      (cue, index) =>
        `${targetFormat === "srt" ? `${index + 1}\n` : ""}${timestamp(cue.startMs, targetFormat)} --> ${timestamp(cue.endMs, targetFormat)}\n${cue.text}`,
    )
    .join("\n\n");
  const text = `${targetFormat === "vtt" ? "WEBVTT\n\n" : ""}${body}\n`;
  // Refuse any representation that the shared parser cannot round-trip unchanged.
  const check = parseSubtitles(text, targetFormat);
  if (
    check.issues.length ||
    check.cues.length !== cues.length ||
    check.cues.some(
      (cue, index) =>
        cue.startMs !== cues[index].startMs ||
        cue.endMs !== cues[index].endMs ||
        cue.text !== cues[index].text,
    )
  ) {
    throw new Error(
      "이 파일은 시간과 본문을 보존하여 변환할 수 없습니다. 원본 구조를 확인하세요.",
    );
  }
  return {
    text,
    filename: input.filename,
    mimeType:
      targetFormat === "vtt"
        ? "text/vtt;charset=utf-8"
        : "application/x-subrip;charset=utf-8",
  };
}
