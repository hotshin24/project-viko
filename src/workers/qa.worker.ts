import {
  analyze,
  type AnalysisRequest,
  type AnalysisResponse,
} from "../lib/qa/analyze";

self.onmessage = (event: MessageEvent<AnalysisRequest>) => {
  let response: AnalysisResponse;
  try {
    response = { ok: true, analysis: analyze(event.data) };
  } catch (error) {
    response = {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "파일을 검사하지 못했습니다. 다시 선택해 주세요.",
    };
  }
  self.postMessage(response);
};
