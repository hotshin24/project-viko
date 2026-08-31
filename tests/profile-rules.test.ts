import { expect, it } from "vitest";
import { QA_PROFILES } from "../src/lib/qa/profiles";
import { runQA } from "../src/lib/qa/engine";
import { parseSubtitles } from "../src/lib/subtitles/parser";

const cue = (text: string, ms: number) => ({
  ...parseSubtitles(`1\n00:00:00,000 --> 00:00:01,000\n${text}`, "srt").cues[0],
  endMs: ms,
});
for (const profile of QA_PROFILES) {
  it(`${profile.id}: metadata and threshold boundaries`, () => {
    expect(profile.version).toBe("1.0.0");
    expect(Object.keys(profile.thresholdBasis).sort()).toEqual(
      Object.keys(profile.thresholds).sort(),
    );
    expect(profile.targetContents.length).toBeGreaterThan(0);
    const t = profile.thresholds;
    expect(
      runQA([cue("가".repeat(t.recommendedCpl), 3000)], profile).issues,
    ).toEqual([]);
    const recommended = runQA(
      [cue("가".repeat(t.recommendedCpl + 1), 3000)],
      profile,
    ).issues;
    expect(recommended).toHaveLength(1);
    expect(recommended[0]).toMatchObject({
      ruleId: "RECOMMENDED_CPL",
      severity: "Info",
      currentValue: t.recommendedCpl + 1,
      threshold: t.recommendedCpl,
    });
    expect(
      runQA([cue("가".repeat(t.maxCpl), 3000)], profile).issues.map(
        (i) => i.ruleId,
      ),
    ).toEqual(["RECOMMENDED_CPL"]);
    expect(
      runQA([cue("가".repeat(t.maxCpl + 1), 3000)], profile).issues.map(
        (i) => i.ruleId,
      ),
    ).toEqual(["CPL"]);
    expect(runQA([cue("가", t.maxDurationMs)], profile).issues).toEqual([]);
    expect(
      runQA([cue("가", t.maxDurationMs + 1)], profile).issues[0],
    ).toMatchObject({
      ruleId: "LONG_DURATION",
      currentValue: t.maxDurationMs + 1,
      threshold: t.maxDurationMs,
    });
    expect(runQA([cue("가", t.minDurationMs)], profile).issues).toEqual([]);
    expect(
      runQA([cue("가", t.minDurationMs - 1)], profile).issues[0].ruleId,
    ).toBe("SHORT_DURATION");
    expect(
      runQA([cue("가".repeat(t.maxCps), 1000)], profile).issues.some(
        (i) => i.ruleId === "CPS",
      ),
    ).toBe(false);
    expect(
      runQA([cue("가".repeat(t.maxCps + 1), 1000)], profile).issues.find(
        (i) => i.ruleId === "CPS",
      ),
    ).toMatchObject({ currentValue: t.maxCps + 1, threshold: t.maxCps });
  });
}
it("overlap permission does not turn a negative gap into SHORT_GAP; duplicate timings stay reviewable", () => {
  const profile = {
    ...QA_PROFILES[0],
    thresholds: { ...QA_PROFILES[0].thresholds, allowOverlap: true },
  };
  const first = cue("가", 3000);
  const second = { ...first, id: "second", order: 2 };
  expect(runQA([first, second], profile).issues.map((i) => i.ruleId)).toEqual([
    "DUPLICATE_TIMING",
  ]);
});
