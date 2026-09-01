import { expect, test } from "vitest";
import { parseSubtitles } from "../src/lib/subtitles/parser";
import {
  prepareTranslationFile,
  serializeTranslation,
  translationRequest,
  validateTranslationPreview,
} from "../src/lib/subtitles/translator";

const buffer = (text: string) => new TextEncoder().encode(text).buffer;
const source = `1
00:00:01,000 --> 00:00:02,000
Hello

2
00:00:03,000 --> 00:00:04,000

3
00:00:05,000 --> 00:00:06,000
World
`;

test("prepares a shared-parser track and maps auto language without mutation", () => {
  const input = prepareTranslationFile(buffer(source), "lesson.srt");
  expect(input.track.cues.map((cue) => cue.text)).toEqual([
    "Hello",
    "",
    "World",
  ]);
  expect(translationRequest(input, "auto", "natural")).toMatchObject({
    sourceLanguage: "und",
    targetLanguage: "ko",
    style: "natural",
  });
  expect(input.track.originalText).toBe(source);
});

test("validates Cue identity/order/time/empty position and serializes UTF-8 SRT", () => {
  const input = prepareTranslationFile(buffer(source), "lesson.srt");
  const response = {
    cues: input.track.cues.map((cue) => ({
      cueId: cue.id,
      order: cue.order,
      startMs: cue.startMs,
      endMs: cue.endMs,
      text: cue.text ? `번역 ${cue.order}` : "",
      status: cue.text ? "translated" : "skipped-empty",
    })),
  };
  const translated = validateTranslationPreview(input, response);
  const output = serializeTranslation(input, translated);
  expect(output.filename).toBe("lesson.ko.srt");
  expect(output.mimeType).toBe("application/x-subrip;charset=utf-8");
  const roundTrip = parseSubtitles(output.text, "srt");
  expect(roundTrip.issues).toEqual([]);
  expect(
    roundTrip.cues.map((cue) => [cue.startMs, cue.endMs, cue.text]),
  ).toEqual([
    [1000, 2000, "번역 1"],
    [3000, 4000, ""],
    [5000, 6000, "번역 3"],
  ]);
});

test("keeps VTT format and timing in the Korean download", () => {
  const input = prepareTranslationFile(
    buffer("WEBVTT\n\nintro\n00:01.000 --> 00:02.000\nHello\n"),
    "lesson.vtt",
  );
  const translated = validateTranslationPreview(input, {
    cues: [
      {
        cueId: input.track.cues[0].id,
        order: 1,
        startMs: 1000,
        endMs: 2000,
        text: "안녕하세요",
        status: "translated",
      },
    ],
  });
  const output = serializeTranslation(input, translated);
  expect(output.filename).toBe("lesson.ko.vtt");
  expect(output.mimeType).toBe("text/vtt;charset=utf-8");
  expect(output.text).toBe(
    "WEBVTT\n\nintro\n00:00:01.000 --> 00:00:02.000\n안녕하세요\n",
  );
});

test("rejects Cue limit, damaged input and changed response order", () => {
  const cues = Array.from(
    { length: 129 },
    (_, index) =>
      `${index + 1}\n00:00:${String(index % 60).padStart(2, "0")},000 --> 00:00:${String(index % 60).padStart(2, "0")},500\nText`,
  ).join("\n\n");
  expect(() => prepareTranslationFile(buffer(cues), "large.srt")).toThrow(
    "128 Cue",
  );
  expect(() => prepareTranslationFile(buffer("broken"), "broken.srt")).toThrow(
    "손상",
  );
  const input = prepareTranslationFile(buffer(source), "lesson.srt");
  expect(() =>
    validateTranslationPreview(input, {
      cues: input.track.cues.map((cue, index) => ({
        cueId: cue.id,
        order: index === 0 ? 2 : cue.order,
        startMs: cue.startMs,
        endMs: cue.endMs,
        text: cue.text ? "번역" : "",
        status: cue.text ? "translated" : "skipped-empty",
      })),
    }),
  ).toThrow("Cue 1");
});
