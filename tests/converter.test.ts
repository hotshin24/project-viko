import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
  prepareConversion,
  convertSubtitles,
} from "../src/lib/subtitles/converter";
import { parseSubtitles } from "../src/lib/subtitles/parser";
const bytes = (text: string) => new TextEncoder().encode(text).buffer;
const fixture = (name: string) =>
  Uint8Array.from(readFileSync(`tests/fixtures/${name}`)).buffer;
const project = (text: string, format: "srt" | "vtt") =>
  parseSubtitles(text, format).cues.map(({ startMs, endMs, text }) => ({
    startMs,
    endMs,
    text,
  }));

test.each(["srt", "vtt"] as const)(
  "%s roundtrip preserves cue order, times and exact body",
  (format) => {
    const buffer = fixture(`valid.${format}`);
    const before = new Uint8Array(buffer).slice();
    const input = prepareConversion(buffer, `lesson.${format}`);
    const result = convertSubtitles(input, true);
    expect(result.filename).toBe(`lesson.${input.targetFormat}`);
    expect(result.mimeType).toBe(
      format === "srt"
        ? "text/vtt;charset=utf-8"
        : "application/x-subrip;charset=utf-8",
    );
    expect(result.text.startsWith("WEBVTT\n\n")).toBe(format === "srt");
    expect(result.text).toContain(
      format === "srt"
        ? "00:00:01.000 --> 00:00:03.000"
        : "00:00:01,000 --> 00:00:03,000",
    );
    const roundtrip = convertSubtitles(
      prepareConversion(bytes(result.text), result.filename),
      true,
    );
    expect(project(roundtrip.text, format)).toEqual(
      project(new TextDecoder().decode(buffer), format),
    );
    expect(new Uint8Array(buffer)).toEqual(before);
  },
);

test("preserves unsorted and overlapping cue order, whitespace, markup, entities, emoji and decomposed Unicode", () => {
  const text =
    "\ufeff1\r\n02:00:01,123 --> 02:00:04,567\r\n  <b>한</b> &amp; 👨‍👩‍👧‍👦  \r\n둘째 줄\r\n\r\n2\r\n00:00:01,000 --> 00:00:02,000\r\n이전 --> 다음";
  const result = convertSubtitles(prepareConversion(bytes(text), "lesson.SRT"));
  expect(project(result.text, "vtt")).toEqual(project(text, "srt"));
  expect(result.text).toContain("02:00:01.123 --> 02:00:04.567");
});

test.each([
  "broken.srt",
  "broken.vtt",
  "v1/damaged.srt",
  "v1/damaged.vtt",
  "v1/empty-whitespace.srt",
])("blocks damaged fixture %s", (name) => {
  expect(() => prepareConversion(fixture(name), name)).toThrow();
});
test.each([
  "",
  "1\n00:00:03,000 --> 00:00:02,000\n역전",
  "1\n00:00:01,000 --> 00:00:01,000\n0초",
  "2\n00:00:01,000 --> 00:00:02,000\n잘못된 번호",
  "1\n00:00:01,000 --> 00:00:02,000\n본문\n2\n00:00:03,000 --> 00:00:04,000\n구분 없음",
])("blocks invalid structure without repairing it", (text) => {
  expect(() => prepareConversion(bytes(text), "input.srt")).toThrow();
});
test("invalid encoding, extension, size and cue limits are blocked", () => {
  expect(() =>
    prepareConversion(new Uint8Array([255]).buffer, "input.srt"),
  ).toThrow("UTF-8");
  expect(() => prepareConversion(bytes("abc"), "input.ass")).toThrow(
    "SRT 또는 VTT",
  );
  expect(() =>
    prepareConversion(new ArrayBuffer(5 * 1024 * 1024 + 1), "input.srt"),
  ).toThrow("5 MiB");
  const many = Array.from(
    { length: 10001 },
    (_, i) => `${i + 1}\n00:00:01,000 --> 00:00:02,000\n가`,
  ).join("\n\n");
  expect(() => prepareConversion(bytes(many), "input.srt")).toThrow("10,000");
});
test("VTT loss requires acknowledgement before conversion and removes metadata only", () => {
  const text =
    "WEBVTT description\nLanguage: ko\n\nNOTE\nprivate comment\n\nSTYLE\n::cue {color:red}\n\nREGION\nid:region\n\nintro\n00:01.000 --> 00:03.000 align:start\n<v Mina>본문</v>";
  const input = prepareConversion(bytes(text), "lecture.vtt");
  expect(input.warnings).toHaveLength(5);
  expect(() => convertSubtitles(input)).toThrow("동의");
  const result = convertSubtitles(input, true);
  expect(result.text).toBe(
    "1\n00:00:01,000 --> 00:00:03,000\n<v Mina>본문</v>\n",
  );
});
test("plain VTT has no loss warning and download names cannot contain path/control characters", () => {
  const input = prepareConversion(
    bytes("WEBVTT\n\n00:01.000 --> 00:03.000\n내용"),
    "folder/../lesson\u202e.VTT",
  );
  expect(input.warnings).toEqual([]);
  expect(convertSubtitles(input).filename).toBe("lesson_.srt");
});
