import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createOpenAITranslationProvider } from "../src/lib/translation/providers/openai";
import { TranslationProviderError } from "../src/lib/translation/provider-error";
import { createTranslationBatches } from "../src/lib/translation/batching";
import { translateTrack } from "../src/lib/translation/translate";
import { parseSubtitles } from "../src/lib/subtitles/parser";
import type { SubtitleTrack } from "../src/domain/models";

// Only this HTTP-boundary test bypasses the RSC marker. Production remains guarded.
vi.mock("server-only", () => ({}));
const http = vi.fn<typeof fetch>();
const originalText =
  "1\n00:00:01,000 --> 00:00:02,000\nHello\n\n2\n00:00:03,000 --> 00:00:04,000\nGoodbye";
const track: SubtitleTrack = {
  id: "source",
  projectId: "project",
  language: "en",
  format: "srt",
  version: 1,
  originalText,
  cues: parseSubtitles(originalText, "srt", "source").cues,
};
const options = { sourceLanguage: "en", style: "natural" } as const;
const batch = createTranslationBatches(track, options)[0];
const translations = batch.items.map((item) => ({
  cueId: item.cueId,
  text: "합성 번역",
}));
function response(
  text = JSON.stringify({ translations }),
  status = "completed",
  refusal = false,
) {
  return Response.json({
    id: "test-response",
    object: "response",
    status,
    output: [
      {
        type: "message",
        role: "assistant",
        status: "completed",
        content: refusal
          ? [{ type: "refusal", refusal: "synthetic refusal" }]
          : [{ type: "output_text", text, annotations: [] }],
      },
    ],
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", http);
  vi.stubEnv("OPENAI_API_KEY", "synthetic-test-credential");
  vi.stubEnv("OPENAI_TRANSLATION_MODEL", "configured-test-model");
  vi.stubEnv("OPENAI_LOG", "debug");
  http.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("real SDK sends strict Responses request and preserves Cue metadata through Core", async () => {
  http.mockResolvedValueOnce(response());
  const result = await translateTrack(
    track,
    createOpenAITranslationProvider(),
    options,
  );
  expect(
    result.cues.map((item) => [
      item.cueId,
      item.order,
      item.startMs,
      item.endMs,
    ]),
  ).toEqual(
    track.cues.map((item) => [item.id, item.order, item.startMs, item.endMs]),
  );
  const [url, init] = http.mock.calls[0];
  expect(String(url)).toBe("https://api.openai.com/v1/responses");
  const body = JSON.parse(String(init?.body));
  expect(body).toMatchObject({
    model: "configured-test-model",
    store: false,
    stream: false,
    truncation: "disabled",
    text: {
      format: {
        type: "json_schema",
        strict: true,
        schema: { additionalProperties: false, required: ["translations"] },
      },
    },
  });
  expect(
    body.text.format.schema.properties.translations.items.required,
  ).toEqual(["cueId", "text"]);
  expect(JSON.parse(body.input[0].content)).toEqual(batch);
  expect(new Headers(init?.headers).get("authorization")).toBe(
    "Bearer synthetic-test-credential",
  );
  expect(originalText).toBe(track.originalText);
});

test.each(["OPENAI_API_KEY", "OPENAI_TRANSLATION_MODEL"] as const)(
  "missing %s fails without HTTP",
  (key) => {
    vi.stubEnv(key, " ");
    expect(() => createOpenAITranslationProvider()).toThrowError(
      expect.objectContaining({ code: "CONFIGURATION" }),
    );
    expect(http).not.toHaveBeenCalled();
  },
);

test("public/admin keys never substitute for the server API key", () => {
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("NEXT_PUBLIC_OPENAI_API_KEY", "synthetic-public-credential");
  vi.stubEnv("OPENAI_ADMIN_KEY", "synthetic-admin-credential");
  expect(() => createOpenAITranslationProvider()).toThrowError(
    expect.objectContaining({ code: "CONFIGURATION" }),
  );
  expect(http).not.toHaveBeenCalled();
});

test("SDK endpoint/admin environment cannot redirect the server credential", async () => {
  vi.stubEnv("OPENAI_BASE_URL", "https://example.invalid");
  vi.stubEnv("OPENAI_ADMIN_KEY", "synthetic-admin-credential");
  http.mockResolvedValueOnce(response());
  await createOpenAITranslationProvider().translateBatch(batch);
  const [url, init] = http.mock.calls[0];
  expect(String(url)).toBe("https://api.openai.com/v1/responses");
  expect(new Headers(init?.headers).get("authorization")).toBe(
    "Bearer synthetic-test-credential",
  );
});

test.each([429, 500, 502, 503, 504])(
  "retries HTTP %i twice, then succeeds",
  async (status) => {
    http
      .mockImplementationOnce(async () =>
        Response.json({ error: { message: "synthetic" } }, { status }),
      )
      .mockImplementationOnce(async () => Response.json({}, { status }))
      .mockResolvedValueOnce(response());
    const pending = createOpenAITranslationProvider().translateBatch(batch);
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toHaveLength(2);
    expect(http).toHaveBeenCalledTimes(3);
  },
);

test.each([
  [429, "RATE_LIMIT"],
  [503, "SERVER"],
])("retry exhaustion for %i is bounded", async (status, code) => {
  http.mockImplementation(async () =>
    Response.json({}, { status: Number(status) }),
  );
  const check = expect(
    createOpenAITranslationProvider().translateBatch(batch),
  ).rejects.toMatchObject({ code });
  await vi.runAllTimersAsync();
  await check;
  expect(http).toHaveBeenCalledTimes(3);
});

test.each([
  [401, "AUTHENTICATION"],
  [403, "AUTHENTICATION"],
  [400, "REQUEST"],
  [408, "TIMEOUT"],
  [409, "REQUEST"],
  [501, "SERVER"],
])("HTTP %i is not retried", async (status, code) => {
  http.mockResolvedValueOnce(
    Response.json(
      { error: { message: originalText } },
      { status: Number(status) },
    ),
  );
  await expect(
    createOpenAITranslationProvider().translateBatch(batch),
  ).rejects.toMatchObject({ code });
  expect(http).toHaveBeenCalledTimes(1);
});

test("SDK timeout aborts HTTP at 30 seconds without retry", async () => {
  http.mockImplementation(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("synthetic", "AbortError")),
          { once: true },
        );
      }),
  );
  const check = expect(
    createOpenAITranslationProvider().translateBatch(batch),
  ).rejects.toMatchObject({ code: "TIMEOUT" });
  await vi.advanceTimersByTimeAsync(30_000);
  await check;
  expect(http).toHaveBeenCalledTimes(1);
});

test("connection errors are sanitized and not retried", async () => {
  http.mockRejectedValueOnce(new Error(originalText));
  await expect(
    createOpenAITranslationProvider().translateBatch(batch),
  ).rejects.toMatchObject({ code: "CONNECTION" });
  expect(http).toHaveBeenCalledTimes(1);
});

test.each([
  ["refusal", "REFUSAL"],
  ["empty", "EMPTY_RESPONSE"],
  ["incomplete", "INCOMPLETE_RESPONSE"],
  ["failed", "SERVER"],
])("%s response fails without retry", async (kind, code) => {
  http.mockResolvedValueOnce(
    response(
      kind === "empty" ? " " : undefined,
      kind === "incomplete" || kind === "failed" ? kind : "completed",
      kind === "refusal",
    ),
  );
  await expect(
    createOpenAITranslationProvider().translateBatch(batch),
  ).rejects.toMatchObject({ code });
  expect(http).toHaveBeenCalledTimes(1);
});

test.each([
  ["invalid JSON", "{"],
  ["wrong root", "[]"],
  ["missing field", "{}"],
  [
    "wrong type",
    JSON.stringify({ translations: [{ cueId: 1, text: "번역" }] }),
  ],
  ["missing Cue", JSON.stringify({ translations: translations.slice(0, 1) })],
  [
    "duplicate Cue",
    JSON.stringify({ translations: [translations[0], translations[0]] }),
  ],
  [
    "unknown Cue",
    JSON.stringify({
      translations: [translations[0], { cueId: "unknown", text: "번역" }],
    }),
  ],
  [
    "order changed",
    JSON.stringify({ translations: [...translations].reverse() }),
  ],
  [
    "empty translation",
    JSON.stringify({
      translations: translations.map((item) => ({ ...item, text: " " })),
    }),
  ],
  [
    "timestamp attempt",
    JSON.stringify({
      translations: translations.map((item) => ({ ...item, startMs: 99 })),
    }),
  ],
  ["extra root field", JSON.stringify({ translations, extra: true })],
])("%s is rejected by shape/Core validation", async (_label, text) => {
  http.mockResolvedValueOnce(response(text));
  await expect(
    createOpenAITranslationProvider().translateBatch(batch),
  ).rejects.toMatchObject({ code: "SCHEMA_MISMATCH" });
  expect(http).toHaveBeenCalledTimes(1);
});

test("later batch failure rejects the entire Track, with no partial success", async () => {
  http
    .mockResolvedValueOnce(
      response(JSON.stringify({ translations: [translations[0]] })),
    )
    .mockResolvedValueOnce(response(JSON.stringify({ translations: [] })));
  await expect(
    translateTrack(track, createOpenAITranslationProvider(), {
      ...options,
      limits: { maxItems: 1 },
    }),
  ).rejects.toMatchObject({ code: "SCHEMA_MISMATCH" });
  expect(http).toHaveBeenCalledTimes(2);
});

test("SDK debug environment cannot log text/key; errors contain only safe fields", async () => {
  const spies = ["debug", "info", "warn", "error", "log"].map((method) =>
    vi.spyOn(console, method as "debug").mockImplementation(() => {}),
  );
  http.mockResolvedValueOnce(
    Response.json(
      { error: { message: `${originalText} synthetic-test-credential` } },
      { status: 401 },
    ),
  );
  const error = await createOpenAITranslationProvider()
    .translateBatch(batch)
    .catch((value: unknown) => value);
  expect(error).toBeInstanceOf(TranslationProviderError);
  expect(String(error)).not.toContain("Hello");
  expect(String(error)).not.toContain("synthetic-test-credential");
  expect(error).not.toHaveProperty("cause");
  spies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
});
