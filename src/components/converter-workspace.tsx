"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  prepareConversion,
  convertSubtitles,
  type ConversionInput,
  type ConversionOutput,
} from "../lib/subtitles/converter";
import { INPUT_LIMITS } from "../lib/subtitles/parser";

const subscribeToHydration = () => () => {};

export function ConverterWorkspace({ toolName }: { toolName: string }) {
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
  const [input, setInput] = useState<ConversionInput | null>(null);
  const [output, setOutput] = useState<ConversionOutput | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [message, setMessage] = useState("SRT 또는 VTT 파일을 선택하세요.");
  const [error, setError] = useState("");
  const generation = useRef(0);
  const url = useRef<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  function clearDownload() {
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = null;
    setDownloadUrl(null);
    setOutput(null);
  }
  useEffect(
    () => () => {
      generation.current++;
      if (url.current) URL.revokeObjectURL(url.current);
    },
    [],
  );

  async function chooseFile(file?: File) {
    const request = ++generation.current;
    clearDownload();
    setInput(null);
    setAcknowledged(false);
    setError("");
    if (!file) {
      setMessage("SRT 또는 VTT 파일을 선택하세요.");
      return;
    }
    setMessage("파일 파싱 중…");
    try {
      if (file.size > INPUT_LIMITS.maxBytes)
        throw new Error("파일은 5 MiB 이하로 선택해 주세요.");
      const buffer = await file.arrayBuffer();
      if (request !== generation.current) return;
      const prepared = prepareConversion(buffer, file.name);
      setInput(prepared);
      setMessage(
        `${prepared.cues.length} Cue 파싱 완료 · ${prepared.targetFormat.toUpperCase()}로 변환할 수 있습니다.`,
      );
    } catch (caught) {
      if (request !== generation.current) return;
      setMessage("변환 불가");
      setError(
        caught instanceof Error
          ? caught.message
          : "파일을 읽을 수 없습니다. 파일을 다시 선택하세요.",
      );
    }
  }
  function preview() {
    if (!input) return;
    clearDownload();
    setError("");
    try {
      const result = convertSubtitles(input, acknowledged);
      url.current = URL.createObjectURL(
        new Blob([result.text], { type: result.mimeType }),
      );
      setDownloadUrl(url.current);
      setOutput(result);
      setMessage("변환 완료 · 미리보기를 확인하고 다운로드하세요.");
    } catch (caught) {
      setMessage("변환 불가");
      setError(
        caught instanceof Error
          ? caught.message
          : "변환에 실패했습니다. 원본을 확인하세요.",
      );
    }
  }
  return (
    <main id="main" tabIndex={-1} className="converter-workspace">
      <div className="heading">
        <div>
          <p className="eyebrow">LOCALIZE / {toolName}</p>
          <h1>
            SRT와 VTT, <span>본문 그대로.</span>
          </h1>
          <p className="intro">
            Cue 순서·시간·본문을 유지하며 파일 형식만 변환합니다. 원본은
            수정하지 않습니다.
          </p>
        </div>
      </div>
      <section
        className="panel converter-panel"
        aria-labelledby="converter-input-title"
      >
        <h2 id="converter-input-title">자막 불러오기</h2>
        <p>
          UTF-8 · 최대 5 MiB / 10,000 Cue. 파일은 서버로 전송하거나 브라우저
          저장소에 보관하지 않습니다.
        </p>
        <label htmlFor="converter-file">변환할 SRT 또는 VTT 파일</label>
        <input
          id="converter-file"
          type="file"
          disabled={!hydrated}
          accept=".srt,.vtt"
          onChange={(event) => {
            void chooseFile(event.target.files?.[0]);
          }}
        />
        <p role="status" aria-label="변환 처리 상태">
          {message}
        </p>
        {error ? <p role="alert">{error}</p> : null}
        {input?.warnings.length ? (
          <section
            className="converter-warning"
            aria-labelledby="conversion-warning-title"
          >
            <h3 id="conversion-warning-title">변환 전 확인</h3>
            <ul>
              {input.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
            <label>
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => {
                  setAcknowledged(event.target.checked);
                  clearDownload();
                }}
              />{" "}
              메타데이터 손실 및 표시 차이를 확인했습니다.
            </label>
          </section>
        ) : null}
        <button
          type="button"
          onClick={preview}
          disabled={!input || (input.warnings.length > 0 && !acknowledged)}
        >
          변환 미리보기
        </button>
      </section>
      {output && downloadUrl ? (
        <section
          className="panel converter-panel"
          aria-labelledby="converter-preview-title"
        >
          <h2 id="converter-preview-title">변환 결과</h2>
          <label htmlFor="converter-preview">변환된 자막 미리보기</label>
          <textarea
            id="converter-preview"
            value={output.text}
            readOnly
            spellCheck={false}
            rows={16}
          />
          <p>
            {output.filename} · {output.mimeType}
          </p>
          <a
            className="tool-start"
            href={downloadUrl}
            download={output.filename}
          >
            변환 파일 다운로드
          </a>
        </section>
      ) : null}
    </main>
  );
}
