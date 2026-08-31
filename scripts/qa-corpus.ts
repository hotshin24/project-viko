import { resolve } from "node:path";
import { inspectCorpus, writeCorpusReport } from "./corpus";

async function main() {
  const [directory, ...options] = process.argv.slice(2);
  if (!directory || directory.startsWith("--") || options.length % 2)
    throw new Error("usage");
  let profile = "ko-general";
  let output = "corpus/reports";
  const seen = new Set<string>();
  for (let i = 0; i < options.length; i += 2) {
    const key = options[i];
    const value = options[i + 1];
    if (!value || value.startsWith("--") || seen.has(key))
      throw new Error("usage");
    seen.add(key);
    if (key === "--profile") profile = value;
    else if (key === "--output") output = value;
    else throw new Error("usage");
  }
  const report = await inspectCorpus(directory, profile);
  const saved = await writeCorpusReport(report, resolve(output));
  console.log(
    `검사 파일 ${report.summary.inspectedFiles}, Cue ${report.summary.totalCues}. 보고서: ${JSON.stringify(saved)}`,
  );
  // QA warnings are not execution failures. Empty or incompletely parsed corpora need attention.
  process.exitCode =
    !report.summary.inspectedFiles ||
    report.summary.failedFiles ||
    report.summary.partialFiles
      ? 2
      : 0;
}
main().catch(() => {
  console.error(
    "Corpus 검사를 완료하지 못했습니다. 입력 디렉터리·접근 권한·출력 경로·프리셋을 확인하세요.\n사용법: npm run qa:corpus -- <디렉터리> [--profile ko-general|ko-education|ko-shorts|ko-sdh] [--output corpus/reports]",
  );
  process.exitCode = 1;
});
