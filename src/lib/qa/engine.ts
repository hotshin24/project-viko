import type {
  Cue,
  QAProfile,
  QAIssue,
  QADiagnostic,
  QAReport,
  RuleId,
  Severity,
} from "../../domain/models";
import { cueMetrics, displayText } from "../subtitles/metrics";
import { issue } from "./issues";
import { RULE_VERSION, COUNTING_POLICY_VERSION } from "./versions";

/** Pure deterministic QA; input cues, profile and parser diagnostics are immutable. */
export function runQA(
  cues: readonly Cue[],
  profile: QAProfile,
  diagnostics: readonly QADiagnostic[] = [],
): QAReport {
  const issues: QADiagnostic[] = [...diagnostics];
  const metrics = cues.map(cueMetrics);
  const limits = profile.thresholds;
  let previousStart: number | null = null;
  cues.forEach((cue, index) => {
    const metric = metrics[index];
    if (!displayText(cue.text).trim())
      issues.push(
        issue(
          "EMPTY_CUE",
          cue.id,
          0,
          "본문 필요",
          "표시할 자막 내용이 없습니다.",
        ),
      );
    if (metric.durationMs !== null && metric.durationMs <= 0)
      issues.push(
        issue(
          "INVALID_DURATION",
          cue.id,
          metric.durationMs,
          "> 0 ms",
          "종료 시간이 시작 시간보다 빠르거나 같습니다.",
        ),
      );
    else if (
      metric.durationMs !== null &&
      metric.durationMs < limits.minDurationMs
    )
      issues.push(
        issue(
          "SHORT_DURATION",
          cue.id,
          metric.durationMs,
          limits.minDurationMs,
          "표시 시간이 최소 권고값보다 짧습니다. (ms)",
        ),
      );
    if (metric.lineCount > limits.maxLines)
      issues.push(
        issue(
          "MAX_LINES",
          cue.id,
          metric.lineCount,
          limits.maxLines,
          "자막 줄 수가 기준을 초과합니다.",
        ),
      );
    if (metric.durationMs !== null && metric.durationMs > limits.maxDurationMs)
      issues.push(
        issue(
          "LONG_DURATION",
          cue.id,
          metric.durationMs,
          limits.maxDurationMs,
          "표시 시간이 최대 권고값보다 깁니다. (ms)",
        ),
      );
    const maxCpl = metric.cpl.reduce((max, count) => Math.max(max, count), 0);
    if (maxCpl > limits.maxCpl)
      issues.push(
        issue(
          "CPL",
          cue.id,
          maxCpl,
          limits.maxCpl,
          "가장 긴 줄의 글자 수가 기준을 초과합니다. 공백·문장부호 포함.",
        ),
      );
    else if (maxCpl > limits.recommendedCpl)
      issues.push(
        issue(
          "RECOMMENDED_CPL",
          cue.id,
          maxCpl,
          limits.recommendedCpl,
          "최대 CPL 이내지만 권장 CPL을 초과합니다.",
        ),
      );
    if (metric.cps !== null && metric.cps > limits.maxCps)
      issues.push(
        issue(
          "CPS",
          cue.id,
          metric.cps,
          limits.maxCps,
          "초당 읽어야 할 글자 수가 기준을 초과합니다.",
        ),
      );
    if (cue.startMs !== null) {
      if (previousStart !== null && cue.startMs < previousStart)
        issues.push(
          issue(
            "OUT_OF_ORDER",
            cue.id,
            cue.startMs,
            previousStart,
            "앞 Cue보다 시작 시간이 빠릅니다. (ms)",
          ),
        );
      previousStart = cue.startMs;
    }
  });

  // Furthest-end sweep catches nested/non-adjacent overlaps in O(n log n).
  const timed = cues
    .filter(
      (cue): cue is Cue & { startMs: number; endMs: number } =>
        cue.startMs !== null && cue.endMs !== null && cue.endMs > cue.startMs,
    )
    .sort((a, b) => a.startMs - b.startMs || a.order - b.order);
  let frontier: (typeof timed)[number] | undefined;
  const timingOwners = new Map<string, (typeof timed)[number]>();
  for (const cue of timed) {
    const key = `${cue.startMs}:${cue.endMs}`;
    const owner = timingOwners.get(key);
    if (owner)
      issues.push(
        issue(
          "DUPLICATE_TIMING",
          cue.id,
          `${cue.startMs}–${cue.endMs} ms`,
          "고유 시간 구간",
          `Cue ${owner.order} / Cue ${cue.order}의 시작·종료 시간이 같습니다. 본문 동일 여부와 무관한 확인 항목입니다.`,
          owner.id,
        ),
      );
    else timingOwners.set(key, cue);
    if (frontier) {
      const gap = cue.startMs - frontier.endMs;
      if (gap < 0 && !limits.allowOverlap)
        issues.push(
          issue(
            "OVERLAP",
            cue.id,
            Math.min(cue.endMs, frontier.endMs) - cue.startMs,
            0,
            `Cue ${frontier.order} / Cue ${cue.order}의 시간이 겹칩니다. 대표 중복 구간 길이(ms).`,
            frontier.id,
          ),
        );
      else if (gap >= 0 && gap < limits.minGapMs)
        issues.push(
          issue(
            "SHORT_GAP",
            cue.id,
            gap,
            limits.minGapMs,
            `Cue ${frontier.order} 뒤의 여백이 최소 권고값보다 짧습니다. (ms)`,
            frontier.id,
          ),
        );
    }
    if (!frontier || cue.endMs > frontier.endMs) frontier = cue;
  }
  const bySeverity: Record<Severity, number> = {
    Critical: 0,
    Warning: 0,
    Info: 0,
  };
  const byRule: Partial<Record<RuleId, number>> = {};
  const problemIds = new Set<string>();
  for (const entry of issues) {
    bySeverity[entry.severity]++;
    byRule[entry.ruleId] = (byRule[entry.ruleId] ?? 0) + 1;
    if (entry.cueId) problemIds.add(entry.cueId);
    if (entry.relatedCueId) problemIds.add(entry.relatedCueId);
  }
  return {
    profile,
    ruleVersion: RULE_VERSION,
    countingPolicyVersion: COUNTING_POLICY_VERSION,
    issues: issues.map((entry): QAIssue => ({
      ...entry,
      profileId: profile.id,
      profileVersion: profile.version,
      ruleVersion: RULE_VERSION,
    })),
    metrics,
    summary: {
      totalCues: cues.length,
      problemCues: problemIds.size,
      bySeverity,
      byRule,
    },
  };
}
