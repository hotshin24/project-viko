import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import cases from "./fixtures/v1/expectations.json";
import { analyze } from "../src/lib/qa/analyze";

// Hand-reviewed expectations, separate from implementation. Never update from engine output.
describe("v1 synthetic corpus: exact rule/cue/severity/value/threshold contracts", () => {
  for (const entry of cases)
    it(entry.file, () => {
      const source = readFileSync(
        new URL(`./fixtures/v1/${entry.file}`, import.meta.url),
      );
      const input = {
        buffer: Uint8Array.from(source).buffer,
        format: entry.file.endsWith(".vtt")
          ? ("vtt" as const)
          : ("srt" as const),
        profileId: entry.profileId,
      };
      const analysis = analyze(input);
      const actual = analysis.report.issues.map((issue) => ({
        cue:
          analysis.track.cues.find((cue) => cue.id === issue.cueId)?.order ??
          null,
        ruleId: issue.ruleId,
        severity: issue.severity,
        currentValue: issue.currentValue,
        threshold: issue.threshold,
      }));
      expect(actual).toEqual(entry.expected);
      if (entry.characters)
        expect(
          analysis.report.metrics.map((metric) => metric.characters),
        ).toEqual(entry.characters);
      expect(analysis).toEqual(analyze(input));
      expect(Buffer.from(analysis.track.originalText, "utf8")).toEqual(source);
      for (const issue of analysis.report.issues) {
        expect(issue).toMatchObject({
          profileId: entry.profileId,
          profileVersion: "1.0.0",
          ruleVersion: "1.0.0",
        });
        expect(issue.guidance).not.toBe("");
      }
      expect(
        new Set(analysis.report.issues.map((issue) => issue.id)).size,
      ).toBe(analysis.report.issues.length);
    });
});
