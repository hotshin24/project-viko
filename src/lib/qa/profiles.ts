import type { QAProfile } from "../../domain/models";

const thresholdBasis: QAProfile["thresholdBasis"] = {
  maxLines: "PRD v2.0 §7.2의 한국어 일반/SDH 2줄을 공통 작업 기준으로 채택",
  recommendedCpl:
    "temporary hypothesis: 작은 화면에서 줄 길이를 미리 검토하기 위한 권고",
  maxCpl: "temporary hypothesis: 자체 프리셋, 납품 규격 아님",
  maxCps: "temporary hypothesis: 공백 포함 grapheme 정책에 맞춘 검증 시작값",
  minDurationMs: "temporary hypothesis: 빠르게 사라지는 Cue 탐지용",
  maxDurationMs: "temporary hypothesis: 오래 남는 Cue 탐지용, 발화 확인 필요",
  minGapMs: "temporary hypothesis: 연속 표시 의도 확인용, 프레임률 기준 아님",
  allowOverlap: "temporary hypothesis: 중복을 Warning으로 검토, 자동 수정 금지",
};

function profile(
  id: string,
  name: string,
  description: string,
  targetContents: string[],
  thresholds: QAProfile["thresholds"],
): QAProfile {
  return {
    id,
    name,
    description,
    targetContents,
    thresholds,
    version: "1.0.0",
    source: "PRD v2.0 §7.2 및 VIKO 자체 가설 (temporary hypothesis)",
    effectiveDate: "2026-08-31",
    updatedAt: "2026-08-31",
    provisional: true,
    thresholdBasis,
  };
}

/** v1 freezes reproducible configurations, not their empirical validity. Existing IDs stay stable. */
export const QA_PROFILES: readonly QAProfile[] = [
  profile(
    "ko-general",
    "Korean General · 일반 영상",
    "일반 정보 영상의 읽기 편의성을 우선합니다.",
    ["YouTube", "인터뷰", "정보 영상", "크리에이터 영상"],
    {
      maxLines: 2,
      recommendedCpl: 16,
      maxCpl: 20,
      maxCps: 12,
      minDurationMs: 833,
      maxDurationMs: 7000,
      minGapMs: 80,
      allowOverlap: false,
    },
  ),
  {
    ...profile(
      "ko-sdh",
      "Korean SDH · 참고",
      "기존 SDH 참고 프로필을 유지합니다. 화자·효과음도 글자 수에 포함합니다.",
      ["접근성 자막"],
      {
        maxLines: 2,
        recommendedCpl: 14,
        maxCpl: 16,
        maxCps: 14,
        minDurationMs: 833,
        maxDurationMs: 7000,
        minGapMs: 80,
        allowOverlap: false,
      },
    ),
    thresholdBasis: {
      ...thresholdBasis,
      maxCpl: "PRD v2.0 §7.2: SDH 한 줄 16자",
      maxCps: "PRD v2.0 §7.2: SDH 성인 14 CPS; 본 계산 정책 적용",
    },
  },
  profile(
    "ko-education",
    "Korean Education · 교육",
    "전문 용어와 정보 보존을 위해 일반 영상보다 긴 줄과 표시 구간을 허용합니다.",
    ["해외 강의", "웨비나", "튜토리얼", "전문 지식"],
    {
      maxLines: 2,
      recommendedCpl: 18,
      maxCpl: 22,
      maxCps: 15,
      minDurationMs: 1000,
      maxDurationMs: 10000,
      minGapMs: 80,
      allowOverlap: false,
    },
  ),
  profile(
    "ko-shorts",
    "Korean Shorts · 세로 영상",
    "큰 화면 자막을 가정해 줄 길이를 줄이고 짧은 표시 구간을 허용합니다.",
    ["세로형 숏폼", "빠른 대사", "큰 화면 자막"],
    {
      maxLines: 2,
      recommendedCpl: 10,
      maxCpl: 12,
      maxCps: 14,
      minDurationMs: 500,
      maxDurationMs: 4000,
      minGapMs: 40,
      allowOverlap: false,
    },
  ),
];
