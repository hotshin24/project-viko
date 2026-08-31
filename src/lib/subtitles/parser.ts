import type { Cue, QADiagnostic, SubtitleFormat } from "../../domain/models";
import { issue } from "../qa/issues";

export const INPUT_LIMITS = {
  maxBytes: 5 * 1024 * 1024,
  maxCues: 10_000,
} as const;
export interface ParseResult {
  cues: Cue[];
  issues: QADiagnostic[];
}

export function decodeUtf8(buffer: ArrayBuffer): string {
  if (buffer.byteLength > INPUT_LIMITS.maxBytes)
    throw new Error("파일은 5 MiB 이하로 선택해 주세요.");
  try {
    // Preserve the BOM in the original; remove it only in the parsing copy.
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      buffer,
    );
  } catch {
    throw new Error(
      "UTF-8 파일이 아닙니다. 자막 편집기에서 UTF-8로 저장한 뒤 다시 선택해 주세요.",
    );
  }
}

export function parseTimestamp(
  value: string,
  format: SubtitleFormat,
): number | null {
  const pattern =
    format === "srt"
      ? /^(\d{2,}):([0-5]\d):([0-5]\d),(\d{3})$/
      : /^(?:(\d{2,}):)?([0-5]\d):([0-5]\d)\.(\d{3})$/;
  const match = pattern.exec(value);
  if (!match) return null;
  const ms =
    ((Number(match[1] ?? 0) * 60 + Number(match[2])) * 60 + Number(match[3])) *
      1000 +
    Number(match[4]);
  return Number.isSafeInteger(ms) ? ms : null;
}

/** Tolerant block recovery, strict timestamps; original text is never mutated. */
export function parseSubtitles(
  original: string,
  format: SubtitleFormat,
  trackId = "track-1",
): ParseResult {
  const text = original.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  const cues: Cue[] = [];
  const issues: QADiagnostic[] = [];
  let offset = 0;
  if (format === "vtt") {
    if (!/^WEBVTT(?:[ \t].*)?$/.test(lines[0]) || lines[0].includes("-->")) {
      issues.push(
        issue(
          "FILE_STRUCTURE",
          null,
          "VTT 헤더 없음/손상",
          "WEBVTT",
          "첫 줄에 올바른 WEBVTT 헤더가 필요합니다.",
        ),
      );
    } else {
      offset = 1;
      // Header metadata is separate from cues and must end with a blank line.
      while (
        offset < lines.length &&
        lines[offset].trim() &&
        !lines[offset].includes("-->")
      )
        offset++;
      if (lines[offset]?.includes("-->")) {
        issues.push(
          issue(
            "FILE_STRUCTURE",
            null,
            "헤더 구분 없음",
            "헤더 뒤 빈 줄",
            "VTT 헤더와 Cue를 빈 줄로 구분하세요.",
          ),
        );
        offset = 1;
      }
    }
  }

  const blocks: { lines: string[]; line: number; recovered: boolean }[] = [];
  while (offset < lines.length) {
    if (!lines[offset].trim()) {
      offset++;
      continue;
    }
    const start = offset;
    while (offset < lines.length && lines[offset].trim()) offset++;
    const block = lines.slice(start, offset);
    if (format === "vtt" && /^(NOTE(?:[ \t]|$)|STYLE$|REGION$)/.test(block[0]))
      continue;
    // Recover subsequent cues missing their blank-line separator.
    let segmentStart = 0;
    let seenTiming = false;
    for (let i = 0; i < block.length; i++) {
      if (!block[i].includes("-->")) continue;
      // An arrow in subtitle prose is not another timing line.
      if (seenTiming && !/^\s*-?\d+:\S+[ \t]+-->/.test(block[i])) continue;
      if (seenTiming) {
        const splitAt =
          format === "srt" && /^\d+$/.test(block[i - 1]?.trim()) ? i - 1 : i;
        blocks.push({
          lines: block.slice(segmentStart, splitAt),
          line: start + segmentStart + 1,
          recovered: true,
        });
        segmentStart = splitAt;
      }
      seenTiming = true;
    }
    blocks.push({
      lines: block.slice(segmentStart),
      line: start + segmentStart + 1,
      recovered: segmentStart > 0,
    });
  }

  if (blocks.length > INPUT_LIMITS.maxCues)
    throw new Error(
      "한 번에 10,000 Cue까지 검사할 수 있습니다. 파일을 나누어 주세요.",
    );
  for (const block of blocks) {
    const order = cues.length + 1;
    const id = `${trackId}:cue-${order}`;
    const timingIndex = block.lines.findIndex((line) => line.includes("-->"));
    const sourceIndex =
      timingIndex > 0
        ? block.lines[0]
        : timingIndex === 0
          ? null
          : block.lines[0];
    const rawTiming =
      timingIndex >= 0 ? block.lines[timingIndex] : (block.lines[1] ?? "");
    const match = /^(\S+)[ \t]+-->[ \t]+(\S+)(.*)$/.exec(rawTiming);
    const suffixValid = format === "vtt" || !match?.[3].trim();
    const startMs =
      match && suffixValid ? parseTimestamp(match[1], format) : null;
    const endMs =
      match && suffixValid ? parseTimestamp(match[2], format) : null;
    const cueText =
      timingIndex >= 0
        ? block.lines.slice(timingIndex + 1).join("\n")
        : block.lines.join("\n");
    cues.push({
      id,
      trackId,
      order,
      sourceIndex,
      sourceLine: block.line,
      startMs,
      endMs,
      rawTiming,
      text: cueText,
      rawBlock: block.lines.join("\n"),
    });

    if (
      block.recovered ||
      timingIndex < 0 ||
      timingIndex > 1 ||
      /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(cueText)
    ) {
      issues.push(
        issue(
          "FILE_STRUCTURE",
          id,
          block.recovered ? "빈 줄 구분 누락" : "손상된 Cue 구조",
          "번호(선택) / 시간 / 본문",
          `원본 ${block.line}행부터의 Cue 구조를 확인하세요. 복구된 내용은 추정입니다.`,
        ),
      );
    }
    if (
      format === "srt" &&
      (!sourceIndex ||
        !/^\d+$/.test(sourceIndex) ||
        Number(sourceIndex) !== order)
    ) {
      issues.push(
        issue(
          "INVALID_INDEX",
          id,
          sourceIndex ?? "번호 없음",
          order,
          "SRT Cue 번호가 파일 순서와 일치하지 않습니다.",
        ),
      );
    }
    if (startMs === null || endMs === null)
      issues.push(
        issue(
          "INVALID_TIMECODE",
          id,
          rawTiming || "타임코드 없음",
          format === "srt" ? "HH:MM:SS,mmm" : "HH:MM:SS.mmm / MM:SS.mmm",
          "시간 형식 또는 분·초 범위가 잘못되었습니다.",
        ),
      );
  }
  if (!cues.length)
    issues.push(
      issue(
        "FILE_STRUCTURE",
        null,
        0,
        "1개 이상의 Cue",
        "검사할 Cue를 찾지 못했습니다. 빈 파일 또는 자막이 아닌 파일인지 확인하세요.",
      ),
    );
  return {
    cues,
    issues: issues.map((entry, index) => ({
      ...entry,
      id: `${entry.id}:${index}`,
    })),
  };
}
