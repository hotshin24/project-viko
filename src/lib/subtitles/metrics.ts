import type { Cue, CueMetrics } from "../../domain/models";

const entities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  nbsp: " ",
  lrm: "\u200e",
  rlm: "\u200f",
  quot: '"',
  apos: "'",
};
let segmenter: Intl.Segmenter | undefined;

/** Calculation copy only. See docs/subtitle-counting-policy.md v1. */
export function displayText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/<rt(?:\s[^>\n]*)?>[^<]*<\/rt>/gi, "")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(
      /<\/?(?:b|i|u|s|em|strong|span|ruby|rt|c(?:\.[\w-]+)*|v|lang|font)(?:[ \t][^>\n]*)?>/gi,
      "",
    )
    .replace(/<(?:\d{2,}:)?\d{2}:\d{2}\.\d{3}>/g, "")
    .replace(
      /&(#x[0-9a-f]+|#\d+|amp|lt|gt|nbsp|lrm|rlm|quot|apos);/gi,
      (whole, name: string) => {
        if (!name.startsWith("#")) return entities[name.toLowerCase()] ?? whole;
        const point =
          name[1].toLowerCase() === "x"
            ? parseInt(name.slice(2), 16)
            : Number(name.slice(1));
        return point > 0 &&
          point <= 0x10ffff &&
          !(point >= 0xd800 && point <= 0xdfff)
          ? String.fromCodePoint(point)
          : whole;
      },
    )
    .replace(/[\u200b\u200e\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, "")
    .replace(/\t/g, " ")
    .normalize("NFC")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/^\n+|\n+$/g, "");
}

export function graphemeCount(text: string): number {
  if (typeof Intl.Segmenter !== "function")
    throw new Error(
      "이 브라우저는 정확한 글자 수 계산을 지원하지 않습니다. 최신 Chrome, Edge, Firefox 또는 Safari에서 다시 실행해 주세요.",
    );
  segmenter ??= new Intl.Segmenter("ko", { granularity: "grapheme" });
  let count = 0;
  for (const _segment of segmenter.segment(text)) {
    void _segment;
    count++;
  }
  return count;
}

export function cueMetrics(cue: Cue): CueMetrics {
  const text = displayText(cue.text);
  const lines = text ? text.split("\n") : [];
  const cpl = lines.map(graphemeCount);
  const characters = cpl.reduce((total, value) => total + value, 0);
  const durationMs =
    cue.startMs === null || cue.endMs === null ? null : cue.endMs - cue.startMs;
  return {
    cueId: cue.id,
    lineCount: lines.length,
    cpl,
    characters,
    durationMs,
    cps:
      durationMs !== null && durationMs > 0
        ? characters / (durationMs / 1000)
        : null,
  };
}
