/** Shared entities: tools operate on tracks, not on QA page state. */
export type SubtitleFormat = "srt" | "vtt";
export type Severity = "Critical" | "Warning" | "Info";
export type ProjectStatus =
  "Draft" | "Processing" | "Needs Review" | "Ready" | "Exported" | "Failed";

export interface Project {
  readonly id: string;
  readonly name: string;
  readonly sourceLanguage: string | null;
  readonly targetLanguage: "ko";
  readonly profileId: string;
  readonly status: ProjectStatus;
}
export interface MediaAsset {
  readonly id: string;
  readonly projectId: string;
  readonly kind: "video" | "audio";
  readonly storagePath: string;
  readonly durationMs: number | null;
}
export interface Cue {
  readonly id: string;
  readonly trackId: string;
  readonly order: number;
  readonly sourceIndex: string | null;
  readonly sourceLine: number;
  readonly startMs: number | null;
  readonly endMs: number | null;
  readonly rawTiming: string;
  readonly text: string;
  readonly rawBlock: string;
}
export interface SubtitleTrack {
  readonly id: string;
  readonly projectId: string;
  readonly language: string | null;
  readonly format: SubtitleFormat;
  readonly version: number;
  readonly originalText: string;
  readonly cues: readonly Cue[];
}
export interface QAProfile {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly source: string;
  readonly effectiveDate: string;
  readonly provisional: boolean;
  readonly description: string;
  readonly targetContents: readonly string[];
  readonly updatedAt: string;
  readonly thresholdBasis: Readonly<
    Record<keyof QAProfile["thresholds"], string>
  >;
  readonly thresholds: {
    readonly maxLines: number;
    readonly recommendedCpl: number;
    readonly maxCpl: number;
    readonly maxCps: number;
    readonly minDurationMs: number;
    readonly maxDurationMs: number;
    readonly minGapMs: number;
    readonly allowOverlap: boolean;
  };
}
export type RuleId =
  | "FILE_STRUCTURE"
  | "INVALID_INDEX"
  | "INVALID_TIMECODE"
  | "EMPTY_CUE"
  | "INVALID_DURATION"
  | "OVERLAP"
  | "OUT_OF_ORDER"
  | "SHORT_DURATION"
  | "LONG_DURATION"
  | "RECOMMENDED_CPL"
  | "DUPLICATE_TIMING"
  | "SHORT_GAP"
  | "MAX_LINES"
  | "CPL"
  | "CPS";
export interface QAIssue {
  readonly profileId: string;
  readonly profileVersion: string;
  readonly ruleVersion: string;
  readonly id: string;
  readonly ruleId: RuleId;
  readonly ruleName: string;
  readonly description: string;
  readonly severity: Severity;
  readonly cueId: string | null;
  readonly relatedCueId?: string;
  readonly currentValue: string | number;
  readonly threshold: string | number;
  readonly guidance: string;
}
/** Parser diagnostics are enriched with profile metadata when QA runs. */
export type QADiagnostic = Omit<
  QAIssue,
  "profileId" | "profileVersion" | "ruleVersion"
>;
export interface CueMetrics {
  readonly cueId: string;
  readonly lineCount: number;
  readonly cpl: readonly number[];
  readonly characters: number;
  readonly durationMs: number | null;
  readonly cps: number | null;
}
export interface QAReport {
  readonly ruleVersion: string;
  readonly countingPolicyVersion: string;
  readonly profile: QAProfile;
  readonly issues: readonly QAIssue[];
  readonly metrics: readonly CueMetrics[];
  readonly summary: {
    readonly totalCues: number;
    readonly problemCues: number;
    readonly bySeverity: Readonly<Record<Severity, number>>;
    readonly byRule: Readonly<Partial<Record<RuleId, number>>>;
  };
}
export interface Suggestion {
  readonly id: string;
  readonly issueId: string;
  readonly before: string;
  readonly after: string;
  readonly rationale: string;
  readonly status: "pending" | "accepted" | "rejected";
}
export interface Glossary {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly terms: readonly {
    source: string;
    target: string;
    mode: "fixed" | "forbidden" | "preserve";
  }[];
}
export interface Export {
  readonly id: string;
  readonly trackId: string;
  readonly format: SubtitleFormat | "txt";
  readonly status: "pending" | "ready" | "failed";
  readonly filePath: string | null;
}
