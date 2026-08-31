import type { Analysis } from "../qa/analyze";
import { QA_PROFILES } from "../qa/profiles";
import { RULE_VERSION, COUNTING_POLICY_VERSION } from "../qa/versions";
import type { SubtitleFormat } from "../../domain/models";

export const SESSION_KEY = "viko:qa-session";
export const SESSION_SCHEMA = 1;
export const SESSION_MAX_CHARS = 500_000;
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
type SessionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type StorageProvider = () => SessionStorage;
const browserStorage: StorageProvider = () => window.sessionStorage;

export interface SavedSession {
  schemaVersion: number;
  savedAt: number;
  ruleVersion: string;
  countingPolicyVersion: string;
  profileId: string;
  profileVersion: string;
  filename: string;
  format: SubtitleFormat;
  originalText: string;
}
export interface StorageNotice {
  ok: boolean;
  message: string;
}
export type LoadResult = { snapshot: SavedSession | null; message: string };

export function clearSession(
  getStorage: StorageProvider = browserStorage,
): StorageNotice {
  try {
    getStorage().removeItem(SESSION_KEY);
    return { ok: true, message: "저장된 검사 결과를 삭제했습니다." };
  } catch {
    return {
      ok: false,
      message:
        "브라우저 저장소 접근이 차단되어 저장본 삭제를 확인할 수 없습니다. 탭을 닫고 브라우저의 사이트 데이터를 확인해 주세요.",
    };
  }
}

/** Persist only the minimal reproducible input, never duplicate Cue/report trees. */
export function saveSession(
  analysis: Analysis,
  filename: string,
  getStorage: StorageProvider = browserStorage,
  now = Date.now(),
): StorageNotice {
  try {
    const storage = getStorage();
    // Remove a previous result before attempting replacement, including oversized input.
    storage.removeItem(SESSION_KEY);
    const snapshot: SavedSession = {
      schemaVersion: SESSION_SCHEMA,
      savedAt: now,
      ruleVersion: analysis.report.ruleVersion,
      countingPolicyVersion: analysis.report.countingPolicyVersion,
      profileId: analysis.report.profile.id,
      profileVersion: analysis.report.profile.version,
      filename: filename.slice(0, 255),
      format: analysis.track.format,
      originalText: analysis.track.originalText,
    };
    const serialized = JSON.stringify(snapshot);
    if (serialized.length > SESSION_MAX_CHARS)
      return {
        ok: false,
        message:
          "검사는 완료됐지만 임시 저장 한도(약 1 MB)를 초과했습니다. 이 결과는 새로고침하면 사라집니다.",
      };
    storage.setItem(SESSION_KEY, serialized);
    return {
      ok: true,
      message:
        "자막 원문·파일명·프리셋을 이 탭에만 임시 저장했습니다. 새로고침 후 결과를 재계산해 복원합니다.",
    };
  } catch {
    return {
      ok: false,
      message:
        "검사는 완료됐지만 임시 저장에 실패했습니다. 현재 결과는 사용할 수 있으나 새로고침 복원은 보장되지 않습니다.",
    };
  }
}

export function loadSession(
  getStorage: StorageProvider = browserStorage,
  now = Date.now(),
): LoadResult {
  try {
    const storage = getStorage();
    const serialized = storage.getItem(SESSION_KEY);
    if (!serialized)
      return { snapshot: null, message: "저장된 검사 결과가 없습니다." };
    const discard = (): LoadResult => {
      storage.removeItem(SESSION_KEY);
      return {
        snapshot: null,
        message:
          "만료되었거나 호환되지 않는 저장 데이터를 안전하게 폐기했습니다.",
      };
    };
    if (serialized.length > SESSION_MAX_CHARS) return discard();
    let parsed: unknown;
    try {
      parsed = JSON.parse(serialized);
    } catch {
      return discard();
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return discard();
    const value = parsed as Record<string, unknown>;
    const profile = QA_PROFILES.find((entry) => entry.id === value.profileId);
    if (
      value.schemaVersion !== SESSION_SCHEMA ||
      value.ruleVersion !== RULE_VERSION ||
      value.countingPolicyVersion !== COUNTING_POLICY_VERSION ||
      !profile ||
      value.profileVersion !== profile.version ||
      typeof value.savedAt !== "number" ||
      !Number.isFinite(value.savedAt) ||
      value.savedAt > now ||
      now - value.savedAt >= SESSION_TTL_MS ||
      typeof value.filename !== "string" ||
      !value.filename.length ||
      value.filename.length > 255 ||
      typeof value.originalText !== "string" ||
      (value.format !== "srt" && value.format !== "vtt")
    )
      return discard();
    return {
      snapshot: {
        schemaVersion: SESSION_SCHEMA,
        savedAt: value.savedAt,
        ruleVersion: RULE_VERSION,
        countingPolicyVersion: COUNTING_POLICY_VERSION,
        profileId: profile.id,
        profileVersion: profile.version,
        filename: value.filename,
        format: value.format,
        originalText: value.originalText,
      },
      message: "저장된 자막을 불러와 검사 결과를 복원합니다.",
    };
  } catch {
    return {
      snapshot: null,
      message:
        "브라우저 임시 저장소를 사용할 수 없습니다. 파일을 선택하면 저장 없이 검사할 수 있습니다.",
    };
  }
}
