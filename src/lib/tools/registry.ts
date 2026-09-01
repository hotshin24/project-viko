import type { ComponentType } from "react";

export type ToolFormat = "SRT" | "VTT" | "QA Report" | "미정";
interface ToolMetadata {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly path: `/tools/${string}`;
  readonly inputFormats: readonly ToolFormat[];
  readonly outputFormats: readonly ToolFormat[];
}
/** Available tools must provide a workspace; planned tools cannot execute one. */
export type ToolDefinition = ToolMetadata &
  (
    | {
        readonly status: "available";
        readonly loadWorkspace: () => Promise<
          ComponentType<{ toolName: string; authenticated: boolean }>
        >;
      }
    | { readonly status: "coming-soon"; readonly loadWorkspace?: never }
  );

export const TOOL_REGISTRY = [
  {
    id: "subtitle-qa",
    name: "Subtitle QA",
    description:
      "자막의 읽기 속도, 줄 수, 타임코드를 검사하고 문제 Cue를 확인하세요.",
    path: "/tools/subtitle-qa",
    status: "available",
    inputFormats: ["SRT", "VTT"],
    outputFormats: ["QA Report"],
    loadWorkspace: async () =>
      (await import("../../components/qa-workspace")).QAWorkspace,
  },
  {
    id: "subtitle-doctor",
    name: "Subtitle Doctor",
    description:
      "문제 자막의 수정안과 이유를 검토하는 도구를 준비하고 있습니다.",
    path: "/tools/subtitle-doctor",
    status: "coming-soon",
    inputFormats: ["미정"],
    outputFormats: ["미정"],
  },
  {
    id: "source-transcript-cleaner",
    name: "Source Transcript Cleaner",
    description: "번역 전 원문 자막을 정리하는 도구를 준비하고 있습니다.",
    path: "/tools/source-transcript-cleaner",
    status: "coming-soon",
    inputFormats: ["미정"],
    outputFormats: ["미정"],
  },
  {
    id: "subtitle-translator",
    name: "Korean Subtitle Translator",
    description: "외국어 SRT·VTT를 자연스러운 한국어 자막으로 번역하세요.",
    path: "/tools/subtitle-translator",
    status: "available",
    inputFormats: ["SRT", "VTT"],
    outputFormats: ["SRT", "VTT"],
    loadWorkspace: async () =>
      (await import("../../components/translator-workspace"))
        .TranslatorWorkspace,
  },
  {
    id: "glossary",
    name: "Glossary",
    description: "일관된 용어와 번역 표기를 관리하는 도구를 준비하고 있습니다.",
    path: "/tools/glossary",
    status: "coming-soon",
    inputFormats: ["미정"],
    outputFormats: ["미정"],
  },
  {
    id: "subtitle-converter",
    name: "Subtitle Converter",
    description: "Cue 순서·시간·본문을 보존하며 SRT와 VTT를 변환하세요.",
    path: "/tools/subtitle-converter",
    status: "available",
    inputFormats: ["SRT", "VTT"],
    outputFormats: ["SRT", "VTT"],
    loadWorkspace: async () =>
      (await import("../../components/converter-workspace")).ConverterWorkspace,
  },
] as const satisfies readonly ToolDefinition[];
export type ToolId = (typeof TOOL_REGISTRY)[number]["id"];
export function getTool(id: string): ToolDefinition | undefined {
  return TOOL_REGISTRY.find((tool) => tool.id === id);
}
