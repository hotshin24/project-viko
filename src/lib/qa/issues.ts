import type { QADiagnostic, RuleId, Severity } from "../../domain/models";

export const RULES: Record<
  RuleId,
  { name: string; severity: Severity; guidance: string }
> = {
  FILE_STRUCTURE: {
    name: "파일 구조",
    severity: "Critical",
    guidance:
      "원본 파일에서 형식과 빈 줄 구분을 확인한 뒤 UTF-8로 다시 저장하세요.",
  },
  INVALID_INDEX: {
    name: "Cue 번호",
    severity: "Warning",
    guidance: "SRT 번호를 1부터 중복 없이 순서대로 지정하세요.",
  },
  INVALID_TIMECODE: {
    name: "잘못된 타임코드",
    severity: "Critical",
    guidance:
      "SRT는 HH:MM:SS,mmm, VTT는 HH:MM:SS.mmm 또는 MM:SS.mmm 형식을 확인하세요.",
  },
  EMPTY_CUE: {
    name: "빈 Cue",
    severity: "Critical",
    guidance: "표시할 자막을 입력하거나 불필요한 Cue를 삭제하세요.",
  },
  INVALID_DURATION: {
    name: "잘못된 표시 구간",
    severity: "Critical",
    guidance: "종료 시간을 시작 시간보다 뒤로 지정하세요.",
  },
  OVERLAP: {
    name: "시간 중복",
    severity: "Warning",
    guidance:
      "참조 Cue와 시간을 조정하세요. 의도적인 동시 화자 표시는 유지할 수 있습니다.",
  },
  OUT_OF_ORDER: {
    name: "시간 순서",
    severity: "Warning",
    guidance: "자막의 시작 시간이 파일 순서대로 증가하는지 확인하세요.",
  },
  SHORT_DURATION: {
    name: "짧은 표시 시간",
    severity: "Warning",
    guidance: "영상 발화 범위에서 표시 시간을 늘리거나 인접 Cue와 병합하세요.",
  },
  LONG_DURATION: {
    name: "긴 표시 시간",
    severity: "Warning",
    guidance:
      "발화·화면 전환을 확인하고 필요하면 Cue를 나누거나 종료 시간을 조정하세요.",
  },
  RECOMMENDED_CPL: {
    name: "권장 한 줄 글자 수",
    severity: "Info",
    guidance: "최대 길이 이내지만 줄바꿈 또는 간결한 표현을 검토하세요.",
  },
  DUPLICATE_TIMING: {
    name: "동일 타임코드",
    severity: "Warning",
    guidance:
      "동시 화자 자막인지 중복 입력인지 확인하세요. 원문을 자동 삭제하지 않습니다.",
  },
  SHORT_GAP: {
    name: "짧은 Cue 간격",
    severity: "Info",
    guidance: "연속 표시 의도를 확인하고 필요하면 Cue 사이 여백을 확보하세요.",
  },
  MAX_LINES: {
    name: "최대 줄 수",
    severity: "Warning",
    guidance: "의미 단위를 유지하며 줄을 합치거나 Cue를 분할하세요.",
  },
  CPL: {
    name: "한 줄 글자 수",
    severity: "Warning",
    guidance: "긴 줄을 의미 단위로 나누거나 표현을 간결하게 다듬으세요.",
  },
  CPS: {
    name: "읽기 속도",
    severity: "Warning",
    guidance: "의미를 보존하며 글자 수를 줄이거나 표시 시간을 늘리세요.",
  },
};

export function issue(
  ruleId: RuleId,
  cueId: string | null,
  currentValue: string | number,
  threshold: string | number,
  description: string,
  relatedCueId?: string,
): QADiagnostic {
  const rule = RULES[ruleId];
  return {
    id: `${cueId ?? "file"}:${ruleId}`,
    ruleId,
    ruleName: rule.name,
    severity: rule.severity,
    guidance: rule.guidance,
    cueId,
    currentValue,
    threshold,
    description,
    ...(relatedCueId ? { relatedCueId } : {}),
  };
}
