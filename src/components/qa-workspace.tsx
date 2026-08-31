"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type {
  QAIssue,
  RuleId,
  Severity,
  SubtitleFormat,
} from "../domain/models";
import type { Analysis, AnalysisResponse } from "../lib/qa/analyze";
import { QA_PROFILES } from "../lib/qa/profiles";
import { RULES } from "../lib/qa/issues";
import { INPUT_LIMITS } from "../lib/subtitles/parser";
import { clearSession, loadSession, saveSession } from "../lib/session/storage";

const PAGE_SIZE = 30;
const severityOrder: Record<Severity, number> = {
  Critical: 0,
  Warning: 1,
  Info: 2,
};
const number = (value: string | number) =>
  typeof value === "number"
    ? value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })
    : value;

function IssueDetail({ entry }: { entry: QAIssue }) {
  return (
    <div className="issue-detail">
      <div className="issue-title">
        <span className={`badge ${entry.severity.toLowerCase()}`}>
          {entry.severity}
        </span>
        <strong>{entry.ruleName}</strong>
        <code>{entry.ruleId}</code>
      </div>
      <p>{entry.description}</p>
      <p className="values">
        현재 <b>{number(entry.currentValue)}</b>
        <span>
          기준 <b>{number(entry.threshold)}</b>
        </span>
      </p>
      <p className="guidance">수정 안내 · {entry.guidance}</p>
      <p className="issue-version">
        {entry.profileId} v{entry.profileVersion} · Rule v{entry.ruleVersion}
      </p>
    </div>
  );
}

export function QAWorkspace() {
  const [profileId, setProfileId] = useState(QA_PROFILES[0].id);
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [status, setStatus] = useState(
    "파일을 선택하면 검사를 시작할 수 있습니다.",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [severity, setSeverity] = useState<Severity | "all">("all");
  const [rule, setRule] = useState<RuleId | "all">("all");
  const [page, setPage] = useState(0);
  const [selectedCue, setSelectedCue] = useState<string | null>(null);
  const [storageMessage, setStorageMessage] = useState(
    "검사 후 자막 원문·파일명·프리셋을 이 탭에만 임시 저장합니다.",
  );
  const [restoring, setRestoring] = useState(true);
  const worker = useRef<Worker | null>(null);
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const profile = QA_PROFILES.find((entry) => entry.id === profileId)!;

  const disposeWorker = useCallback(() => {
    generation.current++;
    worker.current?.terminate();
    worker.current = null;
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const cancelPending = useCallback(() => {
    disposeWorker();
    setBusy(false);
  }, [disposeWorker]);

  function chooseFile(selected: File | undefined) {
    if (!selected) return;
    cancelPending();
    setAnalysis(null);
    setError("");
    setPage(0);
    setRule("all");
    setSeverity("all");
    setSelectedCue(null);
    setStorageMessage(clearSession().message);
    setStatus("선택한 파일을 확인해 주세요.");
    if (!/\.(srt|vtt)$/i.test(selected.name)) {
      setFile(null);
      setError("SRT 또는 VTT 파일을 선택해 주세요.");
      return;
    }
    if (selected.size > INPUT_LIMITS.maxBytes) {
      setFile(null);
      setError("파일은 5 MiB 이하로 선택해 주세요.");
      return;
    }
    setFile(selected);
    setStatus("파일 준비 완료 · 검사 프리셋을 확인하고 QA를 실행하세요.");
  }

  const inspect = useCallback(
    async (
      input: File,
      selectedProfile: string,
      isRestore = false,
      restoredFormat?: SubtitleFormat,
    ) => {
      cancelPending();
      const current = generation.current;
      setBusy(true);
      setAnalysis(null);
      setError("");
      setPage(0);
      setRule("all");
      setSeverity("all");
      setSelectedCue(null);
      setStatus("1 / 2 · UTF-8 원본 파일을 읽고 있습니다…");
      try {
        const buffer = await input.arrayBuffer();
        if (current !== generation.current) return;
        setStatus("2 / 2 · Cue 파싱 및 결정적 규칙 검사 중…");
        const task = new Worker(
          new URL("../workers/qa.worker.ts", import.meta.url),
        );
        worker.current = task;
        const finish = () => {
          task.terminate();
          worker.current = null;
          if (timer.current) clearTimeout(timer.current);
          setBusy(false);
          setRestoring(false);
        };
        timer.current = setTimeout(() => {
          if (current !== generation.current) return;
          finish();
          setError(
            "검사가 지연되어 중단했습니다. 파일을 나누거나 다시 시도해 주세요.",
          );
          setStatus("검사 중단");
        }, 30_000);
        task.onmessage = (event: MessageEvent<AnalysisResponse>) => {
          if (current !== generation.current) return;
          finish();
          if (event.data.ok) {
            setAnalysis(event.data.analysis);
            const summary = event.data.analysis.report.summary;
            setStatus(
              `${isRestore ? "복원 완료" : "검사 완료"} · ${summary.totalCues} Cue · Critical ${summary.bySeverity.Critical}, Warning ${summary.bySeverity.Warning}, Info ${summary.bySeverity.Info} · 원본은 변경되지 않았습니다.`,
            );
            setStorageMessage(
              isRestore
                ? "이 탭의 저장본에서 결과를 복원했습니다. 서버 전송 없음 · 저장 시점부터 24시간 유효."
                : saveSession(event.data.analysis, input.name).message,
            );
          } else {
            setError(event.data.message);
            setStatus("검사 실패 · 파일을 확인하고 다시 시도하세요.");
            if (isRestore) setStorageMessage(clearSession().message);
          }
        };
        task.onerror = () => {
          if (current !== generation.current) return;
          finish();
          setError(
            "검사 모듈을 실행하지 못했습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.",
          );
          setStatus("검사 실패");
        };
        const format =
          restoredFormat ??
          (input.name.toLowerCase().endsWith(".vtt") ? "vtt" : "srt");
        task.postMessage({ buffer, format, profileId: selectedProfile }, [
          buffer,
        ]);
      } catch {
        if (current !== generation.current) return;
        cancelPending();
        setRestoring(false);
        setError(
          "파일을 읽지 못했습니다. 파일 접근 권한을 확인하고 다시 선택해 주세요.",
        );
        setStatus("검사 실패");
      }
    },
    [cancelPending],
  );

  useEffect(() => {
    let active = true;
    // Read external storage after hydration. Strict Mode cleanup cancels stale work.
    queueMicrotask(() => {
      if (!active) return;
      const restored = loadSession();
      setStorageMessage(restored.message);
      if (restored.snapshot) {
        const snapshot = restored.snapshot;
        const restoredFile = new File(
          [snapshot.originalText],
          snapshot.filename,
        );
        setFile(restoredFile);
        setProfileId(snapshot.profileId);
        void inspect(restoredFile, snapshot.profileId, true, snapshot.format);
      } else setRestoring(false);
    });
    return () => {
      active = false;
      disposeWorker();
    };
  }, [inspect, disposeWorker]);

  function deleteResult() {
    cancelPending();
    setRestoring(false);
    setFile(null);
    setAnalysis(null);
    setError("");
    setPage(0);
    setSeverity("all");
    setRule("all");
    setSelectedCue(null);
    setStorageMessage(clearSession().message);
    setStatus("현재 검사 결과를 지웠습니다. 새 파일을 선택해 주세요.");
    inputRef.current?.focus();
  }

  const report = analysis?.report;
  const filtered = useMemo(
    () =>
      report?.issues.filter(
        (entry) =>
          (severity === "all" || entry.severity === severity) &&
          (rule === "all" || entry.ruleId === rule),
      ) ?? [],
    [report, severity, rule],
  );
  const groups = useMemo(() => {
    if (!analysis) return [];
    const issuesByCue = new Map<string, QAIssue[]>();
    filtered.forEach((entry) => {
      for (const id of new Set(
        [entry.cueId, entry.relatedCueId].filter((id): id is string =>
          Boolean(id),
        ),
      )) {
        const entries = issuesByCue.get(id) ?? [];
        entries.push(entry);
        issuesByCue.set(id, entries);
      }
    });
    return analysis.track.cues
      .filter((cue) => issuesByCue.has(cue.id))
      .map((cue) => ({
        cue,
        issues: issuesByCue.get(cue.id)!,
        metrics: analysis.report.metrics[cue.order - 1],
      }))
      .sort(
        (a, b) =>
          Math.min(...a.issues.map((entry) => severityOrder[entry.severity])) -
            Math.min(
              ...b.issues.map((entry) => severityOrder[entry.severity]),
            ) || a.cue.order - b.cue.order,
      );
  }, [analysis, filtered]);
  const fileIssues = filtered.filter((entry) => entry.cueId === null);
  const pages = Math.max(1, Math.ceil(groups.length / PAGE_SIZE));

  return (
    <div className="workspace">
      <a className="skip-link" href="#main">
        본문으로 이동
      </a>
      <header className="topbar">
        <Link className="brand" href="/" aria-label="VIKO Localize 홈">
          VIKO<span>LOCALIZE</span>
        </Link>
        <span className="product-direction">
          Foreign Video <span aria-hidden="true">→</span> Natural Korean
          Subtitle
        </span>
        <span className="local-badge">
          <i /> 내 기기에서 처리
        </span>
      </header>
      <main id="main">
        <div className="heading">
          <div>
            <p className="eyebrow">LOCALIZE / SUBTITLE QA</p>
            <h1>
              고쳐야 할 자막부터, <span>명확하게.</span>
            </h1>
            <p className="intro">
              자막의 읽기 속도, 줄 수, 타임코드를 검사하고 문제 Cue를
              확인하세요.
            </p>
          </div>
          <span className="version">
            RULE QA <b>01</b>
          </span>
        </div>
        <section className="setup panel" aria-labelledby="upload-heading">
          <div className="upload-side">
            <h2 id="upload-heading">
              <span className="step">01</span> 자막 불러오기
            </h2>
            <div
              className={`dropzone ${dragging ? "dragging" : ""}`}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                if (event.dataTransfer.files.length > 1) {
                  setError("한 번에 자막 파일 하나만 선택해 주세요.");
                  return;
                }
                chooseFile(event.dataTransfer.files[0]);
              }}
            >
              <span className="file-symbol" aria-hidden="true">
                [ ≡ ]
              </span>
              <strong className="filename">
                {file ? file.name : "SRT · VTT 파일을 여기에 놓으세요"}
              </strong>
              <span>
                {file
                  ? `${(file.size / 1024).toFixed(1)} KiB · 원본 보존`
                  : "UTF-8 · 최대 5 MiB · 10,000 Cue"}
              </span>
              <label className="file-button">
                {file ? "다른 파일 선택" : "파일 선택"}
                <input
                  ref={inputRef}
                  type="file"
                  disabled={restoring}
                  accept=".srt,.vtt"
                  aria-label="SRT 또는 VTT 자막 파일 선택"
                  onChange={(event) => {
                    chooseFile(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
              </label>
            </div>
            <p className="privacy">
              서버 전송 없음. 검사 후 자막 원문·파일명·프리셋을 이 탭에 임시
              저장합니다. 영상은 저장하지 않습니다. 약 1 MB 한도 · 24시간 유효 ·
              직접 삭제 가능.
            </p>
          </div>
          <div className="preset-side">
            <h2>
              <span className="step">02</span> 검사 기준
            </h2>
            <label htmlFor="profile">프리셋</label>
            <select
              id="profile"
              disabled={restoring}
              value={profileId}
              onChange={(event) => {
                cancelPending();
                setProfileId(event.target.value);
                setAnalysis(null);
                setSelectedCue(null);
                setStorageMessage(clearSession().message);
                setError("");
                setStatus("프리셋 변경 · QA 검사를 실행해 주세요.");
              }}
            >
              {QA_PROFILES.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
            <div className="threshold-grid">
              <div>
                <b>{profile.thresholds.maxLines}</b>
                <span>최대 줄 수</span>
              </div>
              <div>
                <b>{profile.thresholds.maxCpl}</b>
                <span>CPL</span>
              </div>
              <div>
                <b>{profile.thresholds.maxCps}</b>
                <span>CPS</span>
              </div>
            </div>
            <p className="preset-note">
              {profile.description}
              <br />
              권장 CPL {profile.thresholds.recommendedCpl} · 최대 CPL{" "}
              {profile.thresholds.maxCpl}
              <br />
              표시 {profile.thresholds.minDurationMs}–
              {profile.thresholds.maxDurationMs}ms · 최소 간격{" "}
              {profile.thresholds.minGapMs}ms
              <br />
              시간 중복 {profile.thresholds.allowOverlap ? "허용" : "검토"} ·
              가설 기준 v{profile.version} · 납품 인증 아님.
              <br />
              CPL: 한 줄 글자 수 · CPS: 초당 글자 수
            </p>
            <button
              className="primary"
              disabled={!file || busy || restoring}
              onClick={() => {
                if (file) void inspect(file, profileId);
              }}
            >
              {busy ? "검사 중…" : "QA 검사 실행"}
              <span aria-hidden="true">→</span>
            </button>
            <details className="policy">
              <summary>규칙 출처와 글자 수 정책</summary>
              <p>
                {profile.source} · 변경일 {profile.updatedAt}. NFC grapheme
                단위로 내부 공백·문장부호를 포함하며, 각 줄 양끝
                공백·줄바꿈·지원 서식 태그는 제외합니다. 언어 품질과 실제 영상
                싱크는 검사하지 않습니다.
              </p>
            </details>
          </div>
        </section>
        <div
          className={`status ${busy ? "processing" : ""}`}
          role="status"
          aria-label="QA 처리 상태"
          aria-live="polite"
        >
          <span aria-hidden="true">{busy ? "◌" : analysis ? "✓" : "○"}</span>
          {status}
        </div>
        <div className="storage-notice panel">
          <p role="status" aria-label="임시 저장 상태">
            {storageMessage}
          </p>
          <button type="button" onClick={deleteResult}>
            저장된 검사 결과 삭제
          </button>
        </div>
        {error && (
          <p className="error-banner" role="alert">
            {error}
          </p>
        )}
        {report && analysis ? (
          <section aria-labelledby="report-heading" aria-busy={busy}>
            <div className="section-heading">
              <div>
                <p className="eyebrow">QA REPORT</p>
                <h2 id="report-heading">검사 결과</h2>
              </div>
              <span className="muted">
                {report.profile.name} · v{report.profile.version}
              </span>
            </div>
            <div
              className="summary-grid"
              role="group"
              aria-label="QA 오류 요약"
            >
              <div className="summary-card">
                <span>전체 Cue</span>
                <strong>{report.summary.totalCues.toLocaleString()}</strong>
                <small>복구된 Cue 포함</small>
              </div>
              <div className="summary-card">
                <span>문제가 있는 Cue</span>
                <strong>{report.summary.problemCues.toLocaleString()}</strong>
                <small>중복 참조 Cue 포함</small>
              </div>
              {(["Critical", "Warning", "Info"] as const).map((level) => (
                <div
                  className={`summary-card ${level.toLowerCase()}`}
                  key={level}
                >
                  <span>{level}</span>
                  <strong>
                    {report.summary.bySeverity[level].toLocaleString()}
                  </strong>
                  <small>
                    {level === "Critical"
                      ? "구조 확인 필요"
                      : level === "Warning"
                        ? "검토 권장"
                        : "참고 사항"}
                  </small>
                </div>
              ))}
            </div>
            <div className="rule-stats panel">
              <h3>오류 유형별 통계</h3>
              <div>
                {(Object.keys(RULES) as RuleId[]).map((id) => (
                  <span className="rule-stat" key={id}>
                    {RULES[id].name}
                    <b>{report.summary.byRule[id] ?? 0}</b>
                  </span>
                ))}
              </div>
            </div>
            <div className="report-note">
              {report.issues.length
                ? "문제 Cue를 심각도 순으로 표시합니다. 하나의 Cue에 여러 문제가 있을 수 있습니다."
                : "선택한 결정적 규칙에서 문제가 발견되지 않았습니다. 번역·맞춤법 품질을 보증하지 않습니다."}
            </div>
            <div className="filters panel">
              <div>
                <label htmlFor="severity">심각도</label>
                <select
                  id="severity"
                  value={severity}
                  onChange={(event) => {
                    setSeverity(event.target.value as Severity | "all");
                    setPage(0);
                  }}
                >
                  <option value="all">모든 심각도</option>
                  <option>Critical</option>
                  <option>Warning</option>
                  <option>Info</option>
                </select>
              </div>
              <div>
                <label htmlFor="rule">오류 유형</label>
                <select
                  id="rule"
                  value={rule}
                  onChange={(event) => {
                    setRule(event.target.value as RuleId | "all");
                    setPage(0);
                  }}
                >
                  <option value="all">모든 오류 유형</option>
                  {(Object.keys(RULES) as RuleId[]).map((id) => (
                    <option key={id} value={id}>
                      {id} · {RULES[id].name}
                    </option>
                  ))}
                </select>
              </div>
              <p role="status" aria-label="필터 결과">
                문제 Cue <b>{groups.length}</b>개 · 오류{" "}
                <b>{filtered.length}</b>건
              </p>
            </div>
            {fileIssues.map((entry) => (
              <div className="panel file-issue" key={entry.id}>
                <h3>파일 전체 오류</h3>
                <IssueDetail entry={entry} />
              </div>
            ))}
            <div className="cue-list">
              {groups
                .slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
                .map(({ cue, issues, metrics }) => (
                  <article
                    className={`cue-card panel ${selectedCue === cue.id ? "selected" : ""}`}
                    key={cue.id}
                    aria-label={`Cue ${cue.order}`}
                  >
                    <div className="cue-source">
                      <div className="cue-label">
                        <h3>
                          <button
                            type="button"
                            aria-pressed={selectedCue === cue.id}
                            aria-controls={`detail-${cue.id}`}
                            onClick={() =>
                              setSelectedCue(
                                selectedCue === cue.id ? null : cue.id,
                              )
                            }
                          >
                            Cue {cue.order} 선택
                          </button>
                        </h3>
                        <span>
                          원본 {cue.sourceLine}행 · 번호{" "}
                          {cue.sourceIndex ?? "없음"}
                        </span>
                      </div>
                      <code className="timecode">
                        {cue.rawTiming || "타임코드 없음"}
                      </code>
                      <pre>{cue.text || "(빈 Cue)"}</pre>
                      <div className="metric-row">
                        <span>{metrics.lineCount}줄</span>
                        <span>CPL {metrics.cpl.join(" / ") || "0"}</span>
                        <span>
                          CPS{" "}
                          {metrics.cps === null
                            ? "계산 불가"
                            : number(metrics.cps)}
                        </span>
                        <span>
                          {metrics.durationMs === null
                            ? "시간 불명"
                            : `${number(metrics.durationMs)}ms`}
                        </span>
                      </div>
                      <details id={`detail-${cue.id}`}>
                        <summary>Cue {cue.order} 원본 블록 확인</summary>
                        <pre>{cue.rawBlock}</pre>
                      </details>
                    </div>
                    <div className="cue-issues">
                      {issues.map((entry) => (
                        <IssueDetail key={entry.id} entry={entry} />
                      ))}
                    </div>
                  </article>
                ))}
            </div>
            {!groups.length && !fileIssues.length && (
              <div className="empty panel">
                <strong>
                  {report.issues.length
                    ? "선택한 필터에 해당하는 문제가 없습니다."
                    : "규칙 검사 완료"}
                </strong>
                <p>
                  {report.issues.length
                    ? "다른 심각도나 오류 유형을 선택해 보세요."
                    : "원본 자막은 그대로 보존되어 있습니다."}
                </p>
              </div>
            )}
            {groups.length > PAGE_SIZE && (
              <nav className="pagination" aria-label="문제 Cue 페이지">
                <button disabled={page === 0} onClick={() => setPage(page - 1)}>
                  이전
                </button>
                <span aria-live="polite">
                  {page + 1} / {pages} 페이지 · 페이지당 {PAGE_SIZE} Cue
                </span>
                <button
                  disabled={page + 1 >= pages}
                  onClick={() => setPage(page + 1)}
                >
                  다음
                </button>
              </nav>
            )}
          </section>
        ) : (
          <section className="empty initial-empty">
            <span className="eyebrow">READY WHEN YOU ARE</span>
            <h2>전체 자막 대신, 문제에 집중하세요.</h2>
            <p>
              파일을 선택하고 검사를 실행하면 오류 요약과 문제 Cue가 여기에
              표시됩니다.
            </p>
            <div>
              <span>01 구조·타임코드</span>
              <span>02 읽기 속도·줄 수</span>
              <span>03 오류별 수정 안내</span>
            </div>
          </section>
        )}
        <footer>
          <span>VIKO Localize · Subtitle QA</span>
          <span>결정적 규칙 검사 전용 · AI 번역 및 자동 수정 없음</span>
        </footer>
      </main>
    </div>
  );
}
