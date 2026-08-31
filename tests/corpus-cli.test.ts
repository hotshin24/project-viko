import { afterEach, expect, test } from "vitest";
import {
  mkdtemp,
  readFile,
  writeFile,
  mkdir,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  inspectCorpus,
  corpusMarkdown,
  writeCorpusReport,
} from "../scripts/corpus";
import { analyze } from "../src/lib/qa/analyze";
import { QA_PROFILES } from "../src/lib/qa/profiles";
import { INPUT_LIMITS } from "../src/lib/subtitles/parser";

const temporary: string[] = [];
async function directory() {
  const path = await mkdtemp(join(tmpdir(), "viko-corpus-"));
  temporary.push(path);
  return path;
}
afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

test("all 27 synthetic SRT/VTT fixtures match the existing engine and are repeatable", async () => {
  const root = resolve("tests/fixtures");
  const report = await inspectCorpus(root);
  expect(report.files).toHaveLength(27);
  let total = 0;
  for (const file of report.files) {
    const bytes = await readFile(join(root, file.file));
    const result = analyze({
      buffer: Uint8Array.from(bytes).buffer,
      format: file.file.endsWith(".vtt") ? "vtt" : "srt",
      profileId: "ko-general",
    });
    expect(file.totalCues).toBe(result.report.summary.totalCues);
    expect(file.bySeverity).toEqual(result.report.summary.bySeverity);
    for (const [id, count] of Object.entries(file.byRule))
      expect(count).toBe(
        result.report.summary.byRule[id as keyof typeof file.byRule] ?? 0,
      );
    total += file.totalCues;
    expect(await readFile(join(root, file.file))).toEqual(bytes);
  }
  expect(report.summary.totalCues).toBe(total);
  expect(report.summary.partialFiles).toBeGreaterThan(0);
  expect(await inspectCorpus(root)).toEqual(report);
  expect(
    report.files
      .find((file) => file.file === "v1/overlap.srt")
      ?.issues.some((issue) => issue.relatedCue !== null),
  ).toBe(true);
});

test.each(QA_PROFILES)("preserves $id configuration", async (profile) => {
  const report = await inspectCorpus(resolve("tests/fixtures/v1"), profile.id);
  expect(report.profile).toEqual(profile);
  expect(report.ruleVersion).toBe("1.0.0");
  expect(report.countingPolicyVersion).toBe("1.0.0");
});

test("no body, malformed index, raw timing, or VTT identifier enters either report", async () => {
  const root = await directory();
  const secret = "PRIVATE_SENTINEL_비공개";
  await writeFile(
    join(root, "broken.srt"),
    `${secret}\n${secret} --> 00:00:03,000\n${secret}\n`,
  );
  await writeFile(
    join(root, "normal.vtt"),
    `WEBVTT\n\n${secret}\n00:00.000 --> 00:03.000\n${secret}\n`,
  );
  const report = await inspectCorpus(root);
  expect(report.files[0].failures.map((failure) => failure.code)).toContain(
    "INVALID_TIMECODE",
  );
  expect(report.files.flatMap((file) => file.issues)).not.toHaveLength(0);
  const json = JSON.stringify(report);
  expect(json).not.toContain(secret);
  expect(corpusMarkdown(report)).not.toContain(secret);
  for (const field of [
    "rawTiming",
    "sourceIndex",
    "currentValue",
    "rawBlock",
    "originalText",
  ])
    expect(json).not.toContain(field);
});

test("recurses, accepts uppercase extensions, skips links and metadata; isolates failures", async () => {
  const root = await directory();
  await mkdir(join(root, "nested"));
  const normal = await readFile("tests/fixtures/valid.srt");
  await writeFile(join(root, "nested", "good.SRT"), normal);
  await writeFile(join(root, "._ignored.srt"), normal);
  await writeFile(join(root, "other.txt"), normal);
  await symlink(join(root, "nested"), join(root, "loop"));
  await symlink(join(root, "nested", "good.SRT"), join(root, "link.srt"));
  await writeFile(join(root, "bad.vtt"), Buffer.from([0xff, 0xfe]));
  await writeFile(
    join(root, "large.srt"),
    Buffer.alloc(INPUT_LIMITS.maxBytes + 1),
  );
  await writeFile(join(root, "empty.srt"), "");
  const report = await inspectCorpus(root);
  expect(report.summary.inspectedFiles).toBe(4);
  expect(report.summary.failedFiles).toBe(3);
  expect(
    report.files.flatMap((file) =>
      file.failures.map((failure) => failure.code),
    ),
  ).toEqual(["INVALID_UTF8", "FILE_STRUCTURE", "TOO_LARGE"]);
  expect(report.files[3].file).toBe("nested/good.SRT");
  expect(report.files[3].totalCues).toBeGreaterThan(0);
  await expect(inspectCorpus(join(root, "loop"))).rejects.toThrow();
});

test("empty corpus produces explicit zero totals, invalid input rejects", async () => {
  const root = await directory();
  const report = await inspectCorpus(root);
  expect(report.summary.inspectedFiles).toBe(0);
  expect(report.summary.totalCues).toBe(0);
  expect(report.summary.mostFrequentRules).toEqual([]);
  await expect(inspectCorpus(root, "unknown")).rejects.toThrow();
  await expect(inspectCorpus(join(root, "missing"))).rejects.toThrow();
});

test("writes distinct JSON/Markdown runs, escaping Markdown filenames", async () => {
  const root = await directory();
  await writeFile(
    join(root, "<img>pipe|[x].srt"),
    await readFile("tests/fixtures/broken.srt"),
  );
  const report = await inspectCorpus(root);
  const destination = join(root, "reports");
  const first = await writeCorpusReport(report, destination);
  const second = await writeCorpusReport(report, destination);
  expect(first).not.toBe(second);
  expect(
    JSON.parse(await readFile(join(first, "report.json"), "utf8")),
  ).toEqual(report);
  const markdown = await readFile(join(first, "report.md"), "utf8");
  expect(markdown).toBe(corpusMarkdown(report));
  expect(markdown).not.toContain("<img>");
  expect(markdown).toContain("&lt;img&gt;pipe&#124;&#91;x&#93;");
});

test("CLI writes reports and distinguishes success, incomplete corpus, and invalid arguments", async () => {
  const { spawnSync } = await import("node:child_process");
  const root = await directory();
  const output = join(root, "output");
  const invoke = (...args: string[]) =>
    spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/qa-corpus.ts", ...args],
      { encoding: "utf8" },
    );
  await writeFile(
    join(root, "normal.srt"),
    await readFile("tests/fixtures/valid.srt"),
  );
  const success = invoke(root, "--output", output);
  expect(success.status, success.stderr).toBe(0);
  const { readdir } = await import("node:fs/promises");
  const runs = await readdir(output);
  expect(runs.filter((name) => name.startsWith("run-"))).toHaveLength(1);
  const report = JSON.parse(
    await readFile(
      join(
        output,
        runs.find((name) => name.startsWith("run-"))!,
        "report.json",
      ),
      "utf8",
    ),
  );
  expect(report.summary.inspectedFiles).toBe(1);
  await writeFile(join(root, "bad.vtt"), Buffer.from([0xff]));
  expect(invoke(root, "--output", output).status).toBe(2);
  const empty = await directory();
  expect(invoke(empty, "--output", output).status).toBe(2);
  for (const args of [
    [],
    [root, "--profile", "unknown"],
    [root, "--bad", "x"],
    [root, "--profile"],
    [join(root, "missing")],
  ]) {
    const failure = invoke(...args);
    expect(failure.status).toBe(1);
    expect(failure.stderr).not.toContain("Error:");
  }
});
