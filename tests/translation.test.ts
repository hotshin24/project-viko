import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import type { SubtitleTrack } from "../src/domain/models";
import { parseSubtitles } from "../src/lib/subtitles/parser";
import {
  batchBytes,
  createTranslationBatches,
} from "../src/lib/translation/batching";
import { translateTrack } from "../src/lib/translation/translate";
import {
  TranslationValidationError,
  validateTranslationResult,
} from "../src/lib/translation/validation";
import type {
  TranslationBatch,
  TranslationOptions,
  TranslationProvider,
  TranslationResponseItem,
} from "../src/lib/translation/types";

const options: TranslationOptions = { sourceLanguage: "en", style: "natural" };
function track(
  texts = ["Hello", "   ", "How are you?", "Goodbye"],
): SubtitleTrack {
  const originalText = texts
    .map(
      (text, i) =>
        `${i + 1}\n00:00:${String(i * 2).padStart(2, "0")},000 --> 00:00:${String(i * 2 + 1).padStart(2, "0")},000\n${text}`,
    )
    .join("\n\n");
  return {
    id: "source",
    projectId: "project",
    language: "en",
    format: "srt",
    version: 1,
    originalText,
    cues: parseSubtitles(originalText, "srt", "source").cues,
  };
}
const good = (batch: TranslationBatch): TranslationResponseItem[] =>
  batch.items.map((item) => ({
    cueId: item.cueId,
    order: item.order,
    startMs: item.startMs,
    endMs: item.endMs,
    text: `번역 ${item.order}`,
  }));
/** Test double only: does not translate semantically and never performs I/O. */
class FakeProvider implements TranslationProvider {
  calls: TranslationBatch[] = [];
  constructor(
    private readonly respond: (
      batch: TranslationBatch,
    ) => unknown | Promise<unknown> = good,
  ) {}
  async translateBatch(batch: TranslationBatch): Promise<unknown> {
    this.calls.push(batch);
    return this.respond(batch);
  }
}

test("normal multi-batch result preserves every source position and track bytes", async () => {
  const source = track();
  const before = structuredClone(source);
  Object.freeze(source);
  Object.freeze(source.cues);
  source.cues.forEach(Object.freeze);
  const provider = new FakeProvider();
  const result = await translateTrack(source, provider, {
    ...options,
    limits: { maxItems: 1 },
  });
  expect(provider.calls).toHaveLength(3);
  expect(result.cues).toHaveLength(4);
  expect(
    result.cues.map((cue) => [
      cue.cueId,
      cue.order,
      cue.startMs,
      cue.endMs,
      cue.sourceText,
    ]),
  ).toEqual(
    source.cues.map((cue) => [
      cue.id,
      cue.order,
      cue.startMs,
      cue.endMs,
      cue.text,
    ]),
  );
  expect(result.cues[1]).toMatchObject({
    status: "skipped-empty",
    translatedText: source.cues[1].text,
  });
  expect(
    result.cues
      .filter((cue) => cue.status === "translated")
      .map((cue) => cue.translatedText),
  ).toEqual(["번역 1", "번역 3", "번역 4"]);
  expect(result.targetLanguage).toBe("ko");
  expect(source).toEqual(before);
});
test("reuses existing VTT fixture parser and retains cue metadata without changing original track", async () => {
  const originalText = readFileSync("tests/fixtures/valid.vtt", "utf8");
  const source: SubtitleTrack = {
    ...track(),
    format: "vtt",
    originalText,
    cues: parseSubtitles(originalText, "vtt", "source").cues,
  };
  const before = structuredClone(source);
  const result = await translateTrack(source, new FakeProvider(), options);
  expect(result.cues.map((cue) => cue.cueId)).toEqual(
    source.cues.map((cue) => cue.id),
  );
  expect(source).toEqual(before);
});
test("context crosses batch boundaries and uses immediate neighbors including empty cues", () => {
  const source = track();
  const batches = createTranslationBatches(source, {
    ...options,
    limits: { maxItems: 1 },
  });
  expect(batches[0].items[0].previous).toBeNull();
  expect(batches[0].items[0].next?.cueId).toBe(source.cues[1].id);
  expect(batches[1].items[0].previous?.cueId).toBe(source.cues[1].id);
  expect(batches[1].items[0].next?.text).toBe("Goodbye");
  expect(batches[2].items[0].previous?.text).toBe("How are you?");
  expect(batches[2].items[0].next).toBeNull();
});
test("UTF-8 JSON budget includes context and escaping; source cues are never truncated", () => {
  const source = track([
    "文".repeat(20),
    'Quotes " and \\ slash',
    "😀".repeat(10),
  ]);
  const settings = { ...options, limits: { contextBytes: 5 } };
  const singles = createTranslationBatches(source, {
    ...settings,
    limits: { ...settings.limits, maxItems: 1 },
  });
  const limit = Math.max(...singles.map(batchBytes));
  const batches = createTranslationBatches(source, {
    ...settings,
    limits: { ...settings.limits, maxBytes: limit },
  });
  expect(batches).toHaveLength(3);
  expect(batches.every((batch) => batchBytes(batch) <= limit)).toBe(true);
  expect(
    batches.flatMap((batch) => batch.items.map((item) => item.sourceText)),
  ).toEqual(source.cues.map((cue) => cue.text));
  expect(batches[1].items[0].next).toMatchObject({
    text: "😀",
    truncated: true,
  });
  expect(createTranslationBatches(source, settings)).toEqual(
    createTranslationBatches(source, settings),
  );
});
test("oversized later cue rejects during preflight without any provider calls", async () => {
  const provider = new FakeProvider();
  await expect(
    translateTrack(track(["Short", "x".repeat(2000)]), provider, {
      ...options,
      limits: { maxBytes: 500, contextBytes: 10 },
    }),
  ).rejects.toThrow("단일 배치");
  expect(provider.calls).toHaveLength(0);
});
test.each([{ texts: [] }, { texts: ["", " \t"] }])(
  "empty-only input makes no provider calls",
  async ({ texts }) => {
    const provider = new FakeProvider();
    const source = track(texts);
    const result = await translateTrack(source, provider, options);
    expect(provider.calls).toHaveLength(0);
    expect(result.cues).toHaveLength(source.cues.length);
    expect(result.cues.every((cue) => cue.status === "skipped-empty")).toBe(
      true,
    );
  },
);

const invalidCases: [
  string,
  (items: TranslationResponseItem[]) => unknown,
  string,
][] = [
  ["missing", (items) => items.slice(1), "MISSING_CUE"],
  ["duplicate", (items) => [items[0], items[0]], "DUPLICATE_CUE"],
  [
    "unknown",
    (items) => [{ ...items[0], cueId: "unknown" }, items[1]],
    "UNKNOWN_CUE",
  ],
  ["reordered", (items) => [...items].reverse(), "ORDER_CHANGED"],
  [
    "changed order field",
    (items) => [{ ...items[0], order: 2 }, items[1]],
    "ORDER_CHANGED",
  ],
  [
    "empty",
    (items) => [{ ...items[0], text: " \n\t" }, items[1]],
    "EMPTY_TRANSLATION",
  ],
  [
    "changed time",
    (items) => [{ ...items[0], startMs: 5 }, items[1]],
    "TIMECODE_CHANGED",
  ],
  ["extra item", (items) => [...items, items[0]], "COUNT_MISMATCH"],
  ["invalid schema", () => ({ items: [] }), "INVALID_SCHEMA"],
  [
    "unknown fields",
    (items) => [{ ...items[0], rawTiming: "changed" }, items[1]],
    "INVALID_SCHEMA",
  ],
  [
    "nonfinite time",
    (items) => [{ ...items[0], endMs: NaN }, items[1]],
    "TIMECODE_CHANGED",
  ],
  ["null entry", (items) => [null, items[1]], "INVALID_SCHEMA"],
];
test.each(invalidCases)(
  "blocks %s provider output atomically",
  async (_name, change, code) => {
    const source = track(["one", "two"]);
    const batch = createTranslationBatches(source, options)[0];
    try {
      validateTranslationResult(batch, change(good(batch)));
      throw new Error("Expected validation rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(TranslationValidationError);
      expect(
        (error as TranslationValidationError).issues.map((issue) => issue.code),
      ).toContain(code);
    }
    await expect(
      translateTrack(
        source,
        new FakeProvider((batch) => change(good(batch))),
        options,
      ),
    ).rejects.toBeInstanceOf(TranslationValidationError);
  },
);
test("provider failure after first batch propagates unchanged; no partial result or later calls", async () => {
  const failure = new Error("fake provider failure");
  const provider = new FakeProvider((batch) => {
    if (batch.id === 2) throw failure;
    return good(batch);
  });
  const source = track(["one", "two", "three"]);
  const before = structuredClone(source);
  await expect(
    translateTrack(source, provider, { ...options, limits: { maxItems: 1 } }),
  ).rejects.toBe(failure);
  expect(provider.calls).toHaveLength(2);
  expect(source).toEqual(before);
});
test("later invalid batch and cross-batch IDs cannot produce a partial success", async () => {
  const provider: FakeProvider = new FakeProvider((batch) =>
    batch.id === 2 ? good(provider.calls[0]) : good(batch),
  );
  await expect(
    translateTrack(track(["one", "two", "three"]), provider, {
      ...options,
      limits: { maxItems: 1 },
    }),
  ).rejects.toBeInstanceOf(TranslationValidationError);
  expect(provider.calls).toHaveLength(2);
});
test("provider cannot mutate requests and caller changes during await do not alter the source snapshot", async () => {
  const source = track(["one"]);
  const provider = new FakeProvider((batch) => {
    expect(Object.isFrozen(batch)).toBe(true);
    expect(Object.isFrozen(batch.items[0])).toBe(true);
    (source.cues[0] as { text: string }).text = "caller changed";
    return good(batch);
  });
  const result = await translateTrack(source, provider, options);
  expect(result.cues[0].sourceText).toBe("one");
});
test.each(["faithful", "natural", "concise"] as const)(
  "style %s and languages are carried on every item",
  (style) => {
    const batch = createTranslationBatches(track(["hello"]), {
      ...options,
      style,
    })[0];
    expect(batch.items[0]).toMatchObject({
      style,
      sourceLanguage: "en",
      targetLanguage: "ko",
    });
  },
);
test("rejects invalid source IDs/times/order, Korean source and invalid batch configuration", () => {
  const source = track(["one", "two"]);
  for (const cue of [
    { ...source.cues[1], id: source.cues[0].id },
    { ...source.cues[1], startMs: null },
    { ...source.cues[1], order: 1 },
  ])
    expect(() =>
      createTranslationBatches(
        { ...source, cues: [source.cues[0], cue] },
        options,
      ),
    ).toThrow();
  expect(() =>
    createTranslationBatches(source, { ...options, sourceLanguage: "ko-KR" }),
  ).toThrow();
  expect(() =>
    createTranslationBatches(source, { ...options, limits: { maxItems: 0 } }),
  ).toThrow();
  expect(() =>
    createTranslationBatches(source, {
      ...options,
      limits: { maxBytes: Infinity },
    }),
  ).toThrow();
});
