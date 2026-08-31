import type {
  Project,
  QAReport,
  SubtitleFormat,
  SubtitleTrack,
} from "../../domain/models";
import { decodeUtf8, parseSubtitles } from "../subtitles/parser";
import { runQA } from "./engine";
import { QA_PROFILES } from "./profiles";

export interface Analysis {
  project: Project;
  track: SubtitleTrack;
  report: QAReport;
}
export interface AnalysisRequest {
  buffer: ArrayBuffer;
  format: SubtitleFormat;
  profileId: string;
}
export type AnalysisResponse =
  { ok: true; analysis: Analysis } | { ok: false; message: string };

/** Entry point reusable by other tools; no file upload or provider side effects. */
export function analyze({
  buffer,
  format,
  profileId,
}: AnalysisRequest): Analysis {
  const profile = QA_PROFILES.find((entry) => entry.id === profileId);
  if (!profile) throw new Error("검사 프리셋을 다시 선택해 주세요.");
  const originalText = decodeUtf8(buffer);
  const parsed = parseSubtitles(originalText, format);
  const report = runQA(parsed.cues, profile, parsed.issues);
  const project: Project = {
    id: "project-1",
    name: "로컬 자막 검사",
    sourceLanguage: null,
    targetLanguage: "ko",
    profileId,
    status: report.issues.length ? "Needs Review" : "Ready",
  };
  const track: SubtitleTrack = {
    id: "track-1",
    projectId: project.id,
    language: null,
    format,
    version: 1,
    originalText,
    cues: parsed.cues,
  };
  return { project, track, report };
}
