import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Cue, QAProfile, RuleId } from "../src/domain/models";
import { runQA } from "../src/lib/qa/engine";
import { QA_PROFILES } from "../src/lib/qa/profiles";
import { parseSubtitles } from "../src/lib/subtitles/parser";
import { cueMetrics, displayText } from "../src/lib/subtitles/metrics";
import { analyze } from "../src/lib/qa/analyze";

const profile = QA_PROFILES[0];
const makeCue = (
  order: number,
  startMs: number | null,
  endMs: number | null,
  text = "자막",
): Cue => ({
  id: `t:${order}`,
  trackId: "t",
  order,
  sourceIndex: String(order),
  sourceLine: order * 4 - 3,
  startMs,
  endMs,
  text,
  rawBlock: text,
  rawTiming: "",
});
const ids = (cues: Cue[], selected = profile) =>
  runQA(cues, selected).issues.map((entry) => entry.ruleId);

describe("deterministic QA", () => {
  it.each(["srt", "vtt"] as const)("passes valid %s", (format) => {
    const text = readFileSync(
      new URL(`./fixtures/valid.${format}`, import.meta.url),
      "utf8",
    );
    const parsed = parseSubtitles(text, format);
    expect(runQA(parsed.cues, profile, parsed.issues).issues).toEqual([]);
  });
  it("detects every required violation in the damaged fixture", () => {
    const text = readFileSync(
      new URL("./fixtures/broken.srt", import.meta.url),
      "utf8",
    );
    const parsed = parseSubtitles(text, "srt");
    const report = runQA(parsed.cues, profile, parsed.issues);
    const expected: RuleId[] = [
      "FILE_STRUCTURE",
      "INVALID_INDEX",
      "INVALID_TIMECODE",
      "EMPTY_CUE",
      "INVALID_DURATION",
      "OVERLAP",
      "SHORT_DURATION",
      "SHORT_GAP",
      "MAX_LINES",
      "CPL",
      "CPS",
    ];
    expect(report.issues.map((entry) => entry.ruleId)).toEqual(
      expect.arrayContaining(expected),
    );
    expect(report.summary.totalCues).toBe(6);
    expect(report.summary.bySeverity.Critical).toBeGreaterThan(0);
    expect(report.summary.bySeverity.Warning).toBeGreaterThan(0);
    expect(report.summary.bySeverity.Info).toBeGreaterThan(0);
    expect(
      Object.values(report.summary.bySeverity).reduce((a, b) => a + b, 0),
    ).toBe(report.issues.length);
    expect(
      Object.values(report.summary.byRule).reduce((a, b) => a + b, 0),
    ).toBe(report.issues.length);
    for (const entry of report.issues) {
      expect(entry.ruleName).toBeTruthy();
      expect(entry.guidance).toBeTruthy();
      expect(entry.description).toBeTruthy();
      expect(entry.threshold).toBeDefined();
      expect(entry.currentValue).toBeDefined();
    }
  });
  it("preserves frozen inputs and returns identical reports", () => {
    const cues = Object.freeze([
      Object.freeze(makeCue(1, 0, 200, "긴 문장입니다.")),
    ]);
    const before = JSON.stringify(cues);
    expect(runQA(cues, profile)).toEqual(runQA(cues, profile));
    expect(JSON.stringify(cues)).toBe(before);
  });
  it("checks exact duration boundary without false positives", () => {
    expect(ids([makeCue(1, 0, 833)])).not.toContain("SHORT_DURATION");
    expect(ids([makeCue(1, 0, 832)])).toContain("SHORT_DURATION");
  });
  it("checks exact CPL/CPS/line boundaries", () => {
    const selected: QAProfile = {
      ...profile,
      thresholds: { ...profile.thresholds, maxCps: 20 },
    };
    expect(ids([makeCue(1, 0, 1000, "가".repeat(20))], selected)).not.toContain(
      "CPS",
    );
    expect(ids([makeCue(1, 0, 1000, "가".repeat(21))], selected)).toEqual(
      expect.arrayContaining(["CPS", "CPL"]),
    );
    expect(ids([makeCue(1, 0, 3000, "하나\n둘")])).not.toContain("MAX_LINES");
    expect(ids([makeCue(1, 0, 3000, "하나\n둘\n셋")])).toContain("MAX_LINES");
  });
  it("finds nested overlaps, marks related cues, and does not mutate file order", () => {
    const cues = [
      makeCue(1, 0, 10000),
      makeCue(2, 1000, 2000),
      makeCue(3, 3000, 4000),
    ];
    const report = runQA(cues, profile);
    expect(
      report.issues
        .filter((entry) => entry.ruleId === "OVERLAP")
        .map((entry) => entry.relatedCueId),
    ).toEqual(["t:1", "t:1"]);
    expect(report.summary.problemCues).toBe(3);
    expect(ids([makeCue(1, 3000, 4000), makeCue(2, 0, 2000)])).toContain(
      "OUT_OF_ORDER",
    );
  });
  it("distinguishes overlaps, touching cues and exact gap threshold", () => {
    expect(ids([makeCue(1, 0, 1000), makeCue(2, 1000, 2000)])).toContain(
      "SHORT_GAP",
    );
    expect(ids([makeCue(1, 0, 1000), makeCue(2, 1080, 2000)])).not.toContain(
      "SHORT_GAP",
    );
    expect(ids([makeCue(1, 0, 1000), makeCue(2, 999, 2000)])).toContain(
      "OVERLAP",
    );
    expect(ids([makeCue(1, 0, 1000), makeCue(2, 999, 2000)])).not.toContain(
      "SHORT_GAP",
    );
  });
  it("does not compute CPS for invalid duration", () => {
    for (const cue of [
      makeCue(1, 1000, 1000),
      makeCue(1, 2000, 1000),
      makeCue(1, null, 1000),
    ]) {
      expect(cueMetrics(cue).cps).toBeNull();
      expect(ids([cue])).not.toContain("CPS");
    }
  });
  it("uses the selected preset", () => {
    expect(
      ids([makeCue(1, 0, 3000, "가".repeat(17))], QA_PROFILES[0]),
    ).not.toContain("CPL");
    expect(
      ids([makeCue(1, 0, 3000, "가".repeat(17))], QA_PROFILES[1]),
    ).toContain("CPL");
  });
  it("counts normalized graphemes, spaces and entities; excludes supported tags", () => {
    const text = "<v Mina><b>가 👨‍👩‍👧‍👦</b></v>\n&amp;&lt;";
    expect(cueMetrics(makeCue(1, 0, 1000, text))).toMatchObject({
      cpl: [3, 2],
      characters: 5,
      cps: 5,
    });
    expect(displayText("&#xAC00;&#44032;<00:01.000>")).toBe("가가");
    expect(ids([makeCue(1, 0, 1000, "<i> </i>")])).toContain("EMPTY_CUE");
  });
  it("processes 10,000 cues within the PRD 10-second target", () => {
    const text =
      "WEBVTT\n\n" +
      Array.from(
        { length: 10000 },
        (_, index) => `${index}\n00:01.000 --> 00:03.000\n본문\n`,
      ).join("\n");
    const buffer = new TextEncoder().encode(text).buffer;
    const started = performance.now();
    const result = analyze({ buffer, format: "vtt", profileId: profile.id });
    expect(result.track.cues).toHaveLength(10000);
    expect(
      result.report.issues.filter((entry) => entry.ruleId === "OVERLAP"),
    ).toHaveLength(9999);
    expect(performance.now() - started).toBeLessThan(10000);
    expect(() =>
      parseSubtitles(text + "\n10001\n00:04.000 --> 00:05.000\n추가", "vtt"),
    ).toThrow("10,000");
  });
});
