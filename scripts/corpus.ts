import { readdir, lstat, open, mkdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join, relative, resolve, extname } from "node:path";
import { createHash } from "node:crypto";
import type { Cue, RuleId, Severity } from "../src/domain/models";
import {
  decodeUtf8,
  INPUT_LIMITS,
  parseSubtitles,
} from "../src/lib/subtitles/parser";
import { runQA } from "../src/lib/qa/engine";
import { QA_PROFILES } from "../src/lib/qa/profiles";
import { RULES } from "../src/lib/qa/issues";
import { RULE_VERSION, COUNTING_POLICY_VERSION } from "../src/lib/qa/versions";

const counts = (): Record<Severity, number> => ({
  Critical: 0,
  Warning: 0,
  Info: 0,
});
const ruleCounts = () =>
  Object.fromEntries(Object.keys(RULES).map((id) => [id, 0])) as Record<
    RuleId,
    number
  >;
const reasons = {
  READ_FAILED: "파일을 읽을 수 없습니다.",
  TOO_LARGE: "파일이 5 MiB 한도를 초과합니다.",
  INVALID_UTF8: "UTF-8 디코딩에 실패했습니다.",
  PARSE_FAILED:
    "파싱을 완료하지 못했습니다. 10,000 Cue 한도와 파일 구조를 확인하세요.",
  FILE_STRUCTURE: "파일 구조가 손상되었습니다.",
  INVALID_TIMECODE: "타임코드 형식 또는 범위가 잘못되었습니다.",
} as const;
type FailureCode = keyof typeof reasons;
function location(cue: Cue) {
  return {
    cueId: cue.id,
    order: cue.order,
    sourceLine: cue.sourceLine,
    startMs: cue.startMs,
    endMs: cue.endMs,
  };
}
type Location = ReturnType<typeof location>;
export interface CorpusFile {
  file: string;
  sha256: string | null;
  status: "ok" | "partial" | "failed";
  totalCues: number;
  bySeverity: Record<Severity, number>;
  byRule: Record<RuleId, number>;
  failures: { code: FailureCode; reason: string }[];
  issues: {
    ruleId: RuleId;
    severity: Severity;
    cue: Location | null;
    relatedCue: Location | null;
  }[];
}

/** Local-only, sequential bounded reads. Symlinks and hidden/AppleDouble entries are excluded. */
export async function inspectCorpus(
  directory: string,
  profileId = "ko-general",
) {
  const profile = QA_PROFILES.find((item) => item.id === profileId);
  if (!profile) throw new Error("지원하지 않는 프리셋입니다.");
  const root = resolve(directory);
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())
    throw new Error("실제 디렉터리를 지정하세요.");
  const paths: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && /\.(srt|vtt)$/i.test(entry.name))
        paths.push(path);
    }
  }
  await walk(root);
  paths.sort();
  const files: CorpusFile[] = [];
  for (const path of paths) {
    const file: CorpusFile = {
      file: relative(root, path).split("\\").join("/"),
      sha256: null,
      status: "ok",
      totalCues: 0,
      bySeverity: counts(),
      byRule: ruleCounts(),
      failures: [],
      issues: [],
    };
    const fail = (code: FailureCode) => {
      file.status = "failed";
      file.failures.push({ code, reason: reasons[code] });
    };
    files.push(file);
    let bytes: Uint8Array;
    try {
      const handle = await open(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const stat = await handle.stat();
        if (!stat.isFile()) {
          fail("READ_FAILED");
          continue;
        }
        if (stat.size > INPUT_LIMITS.maxBytes) {
          fail("TOO_LARGE");
          continue;
        }
        // A bounded read also handles a file growing after stat without allocating unbounded memory.
        const buffer = Buffer.alloc(INPUT_LIMITS.maxBytes + 1);
        let length = 0;
        while (length < buffer.length) {
          const read = await handle.read(
            buffer,
            length,
            buffer.length - length,
            null,
          );
          if (!read.bytesRead) break;
          length += read.bytesRead;
        }
        if (length > INPUT_LIMITS.maxBytes) {
          fail("TOO_LARGE");
          continue;
        }
        bytes = buffer.subarray(0, length);
      } finally {
        await handle.close();
      }
    } catch {
      fail("READ_FAILED");
      continue;
    }
    file.sha256 = createHash("sha256").update(bytes).digest("hex");
    let text: string;
    try {
      text = decodeUtf8(Uint8Array.from(bytes).buffer);
    } catch {
      fail("INVALID_UTF8");
      continue;
    }
    let parsed;
    try {
      parsed = parseSubtitles(
        text,
        extname(path).toLowerCase() === ".srt" ? "srt" : "vtt",
      );
    } catch {
      fail("PARSE_FAILED");
      continue;
    }
    const report = runQA(parsed.cues, profile, parsed.issues);
    const locations = new Map(
      parsed.cues.map((cue) => [cue.id, location(cue)]),
    );
    file.totalCues = parsed.cues.length;
    file.bySeverity = { ...report.summary.bySeverity };
    Object.assign(file.byRule, report.summary.byRule);
    // Explicit allowlist: never export text/rawTiming/sourceIndex/currentValue/description.
    file.issues = report.issues.map((issue) => ({
      ruleId: issue.ruleId,
      severity: issue.severity,
      cue: issue.cueId ? (locations.get(issue.cueId) ?? null) : null,
      relatedCue: issue.relatedCueId
        ? (locations.get(issue.relatedCueId) ?? null)
        : null,
    }));
    for (const code of ["FILE_STRUCTURE", "INVALID_TIMECODE"] as const) {
      if (parsed.issues.some((issue) => issue.ruleId === code))
        file.failures.push({ code, reason: reasons[code] });
    }
    if (file.failures.length)
      file.status = file.totalCues ? "partial" : "failed";
  }
  const byRule = ruleCounts();
  const bySeverity = counts();
  for (const file of files) {
    for (const id of Object.keys(byRule) as RuleId[])
      byRule[id] += file.byRule[id];
    for (const severity of Object.keys(bySeverity) as Severity[])
      bySeverity[severity] += file.bySeverity[severity];
  }
  const maximum = Math.max(0, ...Object.values(byRule));
  return {
    schemaVersion: 1,
    profile,
    ruleVersion: RULE_VERSION,
    countingPolicyVersion: COUNTING_POLICY_VERSION,
    runtime: { node: process.versions.node, icu: process.versions.icu },
    summary: {
      inspectedFiles: files.length,
      totalCues: files.reduce((sum, file) => sum + file.totalCues, 0),
      partialFiles: files.filter((file) => file.status === "partial").length,
      failedFiles: files.filter((file) => file.status === "failed").length,
      bySeverity,
      byRule,
      mostFrequentRules: Object.entries(byRule)
        .filter(([, n]) => n > 0 && n === maximum)
        .map(([id]) => id),
    },
    files,
  };
}
export type CorpusReport = Awaited<ReturnType<typeof inspectCorpus>>;
const escapeCell = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\\`*_[\]{}|]/g, (char) => `&#${char.charCodeAt(0)};`)
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ");
function time(ms: number | null): string {
  if (ms === null) return "?";
  return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
}
function cueLabel(cue: Location | null) {
  return cue
    ? `${cue.cueId} (순서 ${cue.order}, 줄 ${cue.sourceLine}, ${time(cue.startMs)} → ${time(cue.endMs)})`
    : "파일 수준 / 위치 없음";
}
export function corpusMarkdown(report: CorpusReport): string {
  const { summary } = report;
  return [
    "# VIKO Corpus 검증",
    "",
    `프리셋: ${report.profile.id} v${report.profile.version} · Rule ${report.ruleVersion} · 계산 ${report.countingPolicyVersion}`,
    `Node ${report.runtime.node} · ICU ${report.runtime.icu}`,
    "",
    `검사 파일 ${summary.inspectedFiles} · 복구된 Cue ${summary.totalCues} · 부분 파싱 ${summary.partialFiles} · 실패 ${summary.failedFiles}`,
    `Critical ${summary.bySeverity.Critical} · Warning ${summary.bySeverity.Warning} · Info ${summary.bySeverity.Info}`,
    `최다 Rule (동률 포함): ${summary.mostFrequentRules.join(", ") || "없음"}`,
    "",
    "발생 건수는 정확도/오탐률이 아닙니다. 본문은 포함하지 않지만 파일명과 위치도 비공개로 취급하세요.",
    "",
    "## Rule별 발생",
    "",
    "| Rule | 건수 |",
    "| --- | ---: |",
    ...Object.entries(summary.byRule).map(
      ([id, count]) => `| ${id} | ${count} |`,
    ),
    "",
    "## 파일별 결과",
    "",
    "| 파일 | 상태 | Cue | Critical | Warning | Info |",
    "| --- | --- | ---: | ---: | ---: | ---: |",
    ...report.files.map(
      (file) =>
        `| ${escapeCell(file.file)} | ${file.status} | ${file.totalCues} | ${file.bySeverity.Critical} | ${file.bySeverity.Warning} | ${file.bySeverity.Info} |`,
    ),
    "",
    "## 파싱·읽기 실패 (부분 복구 포함)",
    "",
    "| 파일 | 코드 | 이유 |",
    "| --- | --- | --- |",
    ...report.files.flatMap((file) =>
      file.failures.map(
        (failure) =>
          `| ${escapeCell(file.file)} | ${failure.code} | ${failure.reason} |`,
      ),
    ),
    "",
    "## 문제 위치",
    "",
    "| 파일 | Rule | Severity | Cue / 타임코드 | 참조 Cue |",
    "| --- | --- | --- | --- | --- |",
    ...report.files.flatMap((file) =>
      file.issues.map(
        (issue) =>
          `| ${escapeCell(file.file)} | ${issue.ruleId} | ${issue.severity} | ${cueLabel(issue.cue)} | ${cueLabel(issue.relatedCue)} |`,
      ),
    ),
    "",
  ].join("\n");
}
/** A new run directory prevents overwriting previous comparisons; private permissions where supported. */
export async function writeCorpusReport(
  report: CorpusReport,
  outputRoot: string,
) {
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  const { mkdtemp } = await import("node:fs/promises");
  const directory = await mkdtemp(join(outputRoot, "run-"));
  await writeFile(
    join(directory, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
    { mode: 0o600 },
  );
  await writeFile(join(directory, "report.md"), corpusMarkdown(report), {
    mode: 0o600,
  });
  return directory;
}
