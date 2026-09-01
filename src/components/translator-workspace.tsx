"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  prepareTranslationFile,
  serializeTranslation,
  translationRequest,
  validateTranslationPreview,
  type TranslationFile,
  type TranslationPreviewCue,
  type TranslatorSourceLanguage,
  type TranslatorStyle,
  TRANSLATOR_MAX_CUES,
} from "../lib/subtitles/translator";

const errorMessages: Record<number, string> = {
  400: "요청 형식을 확인할 수 없습니다. 파일과 번역 설정을 다시 확인하세요.",
  401: "로그인 세션이 만료되었습니다. 다시 로그인해 주세요.",
  413: "번역 요청 크기 제한을 초과했습니다. 파일을 나누어 주세요.",
  429: "오늘의 번역 사용 한도에 도달했습니다. 다음 UTC 날짜에 다시 시도하세요.",
  503: "번역 서비스를 지금 사용할 수 없습니다. 잠시 후 다시 시도하세요.",
};

function time(ms: number | null) {
  if (ms === null) return "--:--:--.---";
  return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
}

export function TranslatorWorkspace({
  toolName,
  authenticated,
}: {
  toolName: string;
  authenticated: boolean;
}) {
  const [input, setInput] = useState<TranslationFile | null>(null);
  const [sourceLanguage, setSourceLanguage] =
    useState<TranslatorSourceLanguage>("auto");
  const [style, setStyle] = useState<TranslatorStyle>("natural");
  const [result, setResult] = useState<readonly TranslationPreviewCue[] | null>(
    null,
  );
  const [message, setMessage] = useState("SRT 또는 VTT 파일을 선택하세요.");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const download = useRef<string | null>(null);

  function clearResult() {
    if (download.current) URL.revokeObjectURL(download.current);
    download.current = null;
    setDownloadUrl(null);
    setResult(null);
  }
  useEffect(
    () => () => {
      if (download.current) URL.revokeObjectURL(download.current);
    },
    [],
  );

  async function chooseFile(file?: File) {
    clearResult();
    setInput(null);
    setError("");
    if (!file) {
      setMessage("SRT 또는 VTT 파일을 선택하세요.");
      return;
    }
    setMessage("파일 파싱 중…");
    try {
      const prepared = prepareTranslationFile(
        await file.arrayBuffer(),
        file.name,
      );
      setInput(prepared);
      setMessage(`${prepared.track.cues.length} Cue 파싱 완료`);
    } catch (caught) {
      setMessage("파일을 번역할 수 없습니다.");
      setError(
        caught instanceof Error ? caught.message : "파일을 읽을 수 없습니다.",
      );
    }
  }

  async function translate() {
    if (!input || !authenticated || busy) return;
    clearResult();
    setBusy(true);
    setError("");
    setMessage("한국어 자막 번역 중…");
    try {
      const response = await fetch("/api/translation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(translationRequest(input, sourceLanguage, style)),
      });
      if (!response.ok) {
        setMessage("번역을 완료하지 못했습니다.");
        setError(
          errorMessages[response.status] ??
            "번역 처리 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.",
        );
        return;
      }
      const translated = validateTranslationPreview(
        input,
        (await response.json()) as unknown,
      );
      const output = serializeTranslation(input, translated);
      download.current = URL.createObjectURL(
        new Blob([output.text], { type: output.mimeType }),
      );
      setDownloadUrl(download.current);
      setResult(translated);
      setMessage("번역 완료 · 결과를 확인하고 다운로드하세요.");
    } catch (caught) {
      setMessage("번역을 완료하지 못했습니다.");
      setError(
        caught instanceof Error && caught.message.includes("Cue")
          ? caught.message
          : "번역 결과를 확인할 수 없습니다. 잠시 후 다시 시도하세요.",
      );
    } finally {
      setBusy(false);
    }
  }

  const output = input && result ? serializeTranslation(input, result) : null;
  return (
    <main id="main" tabIndex={-1} className="translator-workspace">
      <div className="heading">
        <div>
          <p className="eyebrow">LOCALIZE / {toolName}</p>
          <h1>
            외국어 자막을 <span>자연스러운 한국어로.</span>
          </h1>
          <p className="intro">
            원본 파일은 수정하거나 저장하지 않습니다. 로그인 후 번역 요청만
            서버로 전송합니다.
          </p>
        </div>
      </div>

      <section
        className="panel translator-setup"
        aria-labelledby="translator-input-title"
      >
        <h2 id="translator-input-title">번역할 자막</h2>
        <p>
          UTF-8 SRT·VTT · 최대 {TRANSLATOR_MAX_CUES} Cue. 초과 파일은 번역 전에
          차단합니다.
        </p>
        <label htmlFor="translator-file">SRT 또는 VTT 자막 파일</label>
        <input
          id="translator-file"
          type="file"
          accept=".srt,.vtt"
          disabled={busy}
          onChange={(event) => void chooseFile(event.target.files?.[0])}
        />
        <div className="translator-options">
          <label>
            원문 언어
            <select
              value={sourceLanguage}
              disabled={busy}
              onChange={(event) => {
                setSourceLanguage(
                  event.target.value as TranslatorSourceLanguage,
                );
                clearResult();
              }}
            >
              <option value="auto">자동 감지</option>
              <option value="en">영어</option>
              <option value="ja">일본어</option>
              <option value="zh">중국어</option>
            </select>
          </label>
          <label>
            대상 언어
            <input value="한국어" readOnly aria-readonly="true" />
          </label>
          <label>
            번역 스타일
            <select
              value={style}
              disabled={busy}
              onChange={(event) => {
                setStyle(event.target.value as TranslatorStyle);
                clearResult();
              }}
            >
              <option value="natural">자연스러운 자막</option>
              <option value="faithful">원문 충실</option>
            </select>
          </label>
        </div>
        <p role="status" aria-label="번역 처리 상태">
          {message}
        </p>
        {error ? <p role="alert">{error}</p> : null}
        {!authenticated ? (
          <p className="translator-login">
            번역을 실행하려면{" "}
            <Link href="/login?next=/tools/subtitle-translator">로그인</Link>해
            주세요.
          </p>
        ) : null}
        <button
          type="button"
          disabled={!input || !authenticated || busy}
          onClick={() => void translate()}
        >
          {busy ? "번역 중…" : "한국어로 번역"}
        </button>
      </section>

      {input ? (
        <section
          className="panel translator-preview"
          aria-labelledby="source-preview-title"
        >
          <h2 id="source-preview-title">원문 미리보기</h2>
          <p>
            {input.filename} · {input.format.toUpperCase()} ·{" "}
            {input.track.cues.length} Cue
          </p>
          <ol className="translator-cues">
            {input.track.cues.map((cue) => (
              <li key={cue.id}>
                <span>
                  Cue {cue.order} · {time(cue.startMs)} → {time(cue.endMs)}
                </span>
                <pre>{cue.text || "(빈 Cue)"}</pre>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {input && result && output && downloadUrl ? (
        <section
          className="panel translator-preview"
          aria-labelledby="translation-preview-title"
        >
          <h2 id="translation-preview-title">원문 · 한국어 번역</h2>
          <ol className="translator-cues parallel">
            {input.track.cues.map((cue, index) => (
              <li key={cue.id}>
                <span>
                  Cue {cue.order} · {time(cue.startMs)} → {time(cue.endMs)}
                </span>
                <div>
                  <pre>{cue.text || "(빈 Cue)"}</pre>
                  <pre lang="ko">{result[index].text || "(빈 Cue)"}</pre>
                </div>
              </li>
            ))}
          </ol>
          <a
            className="tool-start"
            href={downloadUrl}
            download={output.filename}
          >
            한국어 자막 다운로드
          </a>
        </section>
      ) : null}
    </main>
  );
}
