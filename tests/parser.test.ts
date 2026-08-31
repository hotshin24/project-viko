import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  decodeUtf8,
  INPUT_LIMITS,
  parseSubtitles,
  parseTimestamp,
} from "../src/lib/subtitles/parser";
import { analyze } from "../src/lib/qa/analyze";

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const bytes = (text: string) => new TextEncoder().encode(text).buffer;

describe("UTF-8 and parser", () => {
  it("keeps an arrow in SRT prose without inventing another cue", () => {
    const source = "1\n00:00:01,000 --> 00:00:04,000\n이전 --> 다음";
    const result = parseSubtitles(source, "srt");
    expect(result.cues).toHaveLength(1);
    expect(result.cues[0].text).toBe("이전 --> 다음");
    expect(result.issues).toEqual([]);
  });
  it.each(["srt", "vtt"] as const)("parses valid %s fixtures", (format) => {
    const result = parseSubtitles(fixture(`valid.${format}`), format);
    expect(result.issues).toEqual([]);
    expect(result.cues).toHaveLength(2);
    expect(result.cues[0]).toMatchObject({
      order: 1,
      startMs: 1000,
      endMs: 3000,
    });
    expect(result.cues[1].text).toContain("오늘의 강의를");
  });
  it.each(["srt", "vtt"] as const)(
    "keeps malformed %s cues and explains errors",
    (format) => {
      const result = parseSubtitles(fixture(`broken.${format}`), format);
      expect(
        result.issues.some((entry) => entry.ruleId === "INVALID_TIMECODE"),
      ).toBe(true);
      expect(
        result.issues.some((entry) => entry.ruleId === "FILE_STRUCTURE"),
      ).toBe(true);
      expect(result.cues.some((cue) => cue.startMs === null)).toBe(true);
    },
  );
  it("preserves BOM, CRLF and original bytes while parsing a normalized copy", () => {
    const source = "\uFEFF" + fixture("valid.srt").replaceAll("\n", "\r\n");
    const buffer = bytes(source);
    const result = analyze({ buffer, format: "srt", profileId: "ko-general" });
    expect(result.track.originalText).toBe(source);
    expect(new Uint8Array(bytes(result.track.originalText))).toEqual(
      new Uint8Array(buffer),
    );
    expect(result.report.issues).toEqual([]);
  });
  it("rejects invalid UTF-8 rather than silently replacing characters", () => {
    expect(() => decodeUtf8(new Uint8Array([0xc3, 0x28]).buffer)).toThrow(
      "UTF-8",
    );
  });
  it("rejects oversized inputs", () => {
    expect(() =>
      decodeUtf8(new ArrayBuffer(INPUT_LIMITS.maxBytes + 1)),
    ).toThrow("5 MiB");
  });
  it.each(["", "\n\n", "WEBVTT\n\nNOTE only metadata"])(
    "detects files with no cues",
    (source) => {
      expect(
        parseSubtitles(source, "vtt").issues.some(
          (entry) => entry.ruleId === "FILE_STRUCTURE",
        ),
      ).toBe(true);
    },
  );
  it("recovers missing block separators and reports them", () => {
    const source =
      "1\n00:00:01,000 --> 00:00:02,000\n첫 줄\n2\n00:00:03,000 --> 00:00:04,000\n다음 줄";
    const result = parseSubtitles(source, "srt");
    expect(result.cues.map((cue) => cue.text)).toEqual(["첫 줄", "다음 줄"]);
    expect(
      result.issues.filter((entry) => entry.ruleId === "FILE_STRUCTURE"),
    ).toHaveLength(2);
  });
  it("does not drop an empty cue", () => {
    expect(
      parseSubtitles(
        "1\n00:00:01,000 --> 00:00:02,000\n\n2\n00:00:03,000 --> 00:00:04,000\n본문",
        "srt",
      ).cues[0].text,
    ).toBe("");
  });
  it("detects missing and duplicate SRT indices", () => {
    const result = parseSubtitles(
      "00:00:01,000 --> 00:00:02,000\n하나\n\n1\n00:00:03,000 --> 00:00:04,000\n둘",
      "srt",
    );
    expect(
      result.issues.filter((entry) => entry.ruleId === "INVALID_INDEX"),
    ).toHaveLength(2);
    expect(new Set(result.cues.map((cue) => cue.id)).size).toBe(2);
  });
  it("rejects a missing VTT header separator without dropping cues", () => {
    const result = parseSubtitles(
      "WEBVTT\n00:01.000 --> 00:02.000\n본문",
      "vtt",
    );
    expect(result.cues).toHaveLength(1);
    expect(
      result.issues.some((entry) => entry.ruleId === "FILE_STRUCTURE"),
    ).toBe(true);
  });
  it.each([
    "00:60:00,000",
    "00:00:60,000",
    "-01:00:00,000",
    "00:00:01.000",
    "00:00:01,00",
    "99999999999999:00:00,000",
  ])("rejects invalid SRT time %s", (value) => {
    expect(parseTimestamp(value, "srt")).toBeNull();
  });
  it("accepts long hours and short VTT times", () => {
    expect(parseTimestamp("100:00:00,001", "srt")).toBe(360000001);
    expect(parseTimestamp("01:02.345", "vtt")).toBe(62345);
  });
  it("detects null bytes in corrupted text", () => {
    expect(
      parseSubtitles(
        "1\n00:00:01,000 --> 00:00:02,000\n잘못\0됨",
        "srt",
      ).issues.some((entry) => entry.ruleId === "FILE_STRUCTURE"),
    ).toBe(true);
  });
  it("does not execute subtitle markup", () => {
    const source = "<script>alert('x')</script>";
    expect(
      parseSubtitles(`1\n00:00:01,000 --> 00:00:02,000\n${source}`, "srt")
        .cues[0].text,
    ).toBe(source);
  });
});
