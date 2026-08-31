import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { POST } from "../src/app/api/translation/route";
import { createOpenAITranslationProvider } from "../src/lib/translation/providers/openai";
import {
  TranslationProviderError,
  type TranslationProviderErrorCode,
} from "../src/lib/translation/provider-error";
import { TRANSLATION_REQUEST_LIMITS as limits } from "../src/lib/translation/api-request";
import type { TranslationBatch } from "../src/lib/translation/types";

vi.mock("server-only", () => ({}));
vi.mock("../src/lib/translation/providers/openai", () => ({
  createOpenAITranslationProvider: vi.fn(),
}));
const factory = vi.mocked(createOpenAITranslationProvider);
const translate = vi.fn<(batch: TranslationBatch) => Promise<unknown>>();
const noNetwork = vi.fn(() => {
  throw new Error("Network forbidden in route tests");
});
const cue = (i = 1, text = "Synthetic source") => ({
  cueId: `cue-${i}`,
  order: i,
  text,
  startMs: i * 2000,
  endMs: i * 2000 + 1000,
});
const payload = () => ({
  sourceLanguage: "en",
  targetLanguage: "ko",
  style: "natural",
  cues: [cue()],
});
function request(
  body: unknown = payload(),
  headers: Record<string, string> = {},
) {
  return new Request("http://localhost/api/translation", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
const good = async (batch: TranslationBatch) =>
  batch.items.map((item) => ({
    cueId: item.cueId,
    order: item.order,
    startMs: item.startMs,
    endMs: item.endMs,
    text: "합성 번역",
  }));
beforeEach(() => {
  vi.stubEnv("TRANSLATION_API_ENABLED", "true");
  vi.stubGlobal("fetch", noNetwork);
  noNetwork.mockClear();
  factory.mockReset();
  translate.mockReset();
  translate.mockImplementation(good);
  factory.mockReturnValue({ translateBatch: translate });
});
afterEach(() => {
  expect(noNetwork).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function errorCheck(req: Request, status: number, code: string) {
  const res = await POST(req);
  expect(res.status).toBe(status);
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(res.headers.get("access-control-allow-origin")).toBeNull();
  const body = await res.json();
  expect(body).toEqual({ error: { code, message: expect.any(String) } });
  return body;
}

test.each([undefined, "", "false", "TRUE", "1"])(
  "disabled flag %s returns 404 before body/provider",
  async (flag) => {
    vi.stubEnv("TRANSLATION_API_ENABLED", flag);
    await errorCheck(request("invalid"), 404, "NOT_FOUND");
    expect(factory).not.toHaveBeenCalled();
  },
);

test.each(["OPENAI_API_KEY", "OPENAI_TRANSLATION_MODEL"] as const)(
  "missing server config %s returns safe 503",
  async (name) => {
    vi.stubEnv("OPENAI_API_KEY", "synthetic-key");
    vi.stubEnv("OPENAI_TRANSLATION_MODEL", "synthetic-model");
    vi.stubEnv(name, "");
    const actual = await vi.importActual<
      typeof import("../src/lib/translation/providers/openai")
    >("../src/lib/translation/providers/openai");
    factory.mockImplementation(actual.createOpenAITranslationProvider);
    await errorCheck(request(), 503, "CONFIGURATION");
    expect(translate).not.toHaveBeenCalled();
  },
);

test("normal request uses real Core, preserves empty positions and batches, excludes source/model", async () => {
  const data = {
    ...payload(),
    cues: Array.from({ length: 34 }, (_, i) =>
      cue(i + 1, i === 1 ? " " : "Synthetic source"),
    ),
  };
  const before = structuredClone(data);
  const res = await POST(request(data));
  expect(res.status).toBe(200);
  const result = await res.json();
  expect(result.metadata).toEqual({
    sourceLanguage: "en",
    targetLanguage: "ko",
    style: "natural",
    totalCues: 34,
    translatedCues: 33,
    batchCount: 2,
  });
  expect(result.cues).toHaveLength(34);
  expect(result.cues[1]).toMatchObject({
    ...cue(2, " "),
    status: "skipped-empty",
  });
  expect(result.cues[0]).toEqual({
    ...cue(1, "합성 번역"),
    status: "translated",
  });
  expect(JSON.stringify(result)).not.toContain("Synthetic source");
  expect(result.metadata).not.toHaveProperty("model");
  expect(translate).toHaveBeenCalledTimes(2);
  expect(data).toEqual(before);
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(res.headers.get("access-control-allow-origin")).toBeNull();
});

test.each([
  ["empty body", ""],
  ["malformed JSON", "{"],
  ["null", null],
  ["array", []],
  ["empty object", {}],
  ["empty cues", { ...payload(), cues: [] }],
  ["all blank", { ...payload(), cues: [cue(1, " ")] }],
  ["language", { ...payload(), sourceLanguage: "not a language" }],
  ["Korean source", { ...payload(), sourceLanguage: "ko-KR" }],
  ["target", { ...payload(), targetLanguage: "en" }],
  ["style", { ...payload(), style: "toString" }],
  ["model injection", { ...payload(), model: "override" }],
  [
    "duplicate ID",
    { ...payload(), cues: [cue(), { ...cue(2), cueId: "cue-1" }] },
  ],
  ["order", { ...payload(), cues: [cue(2), cue()] }],
  ["empty ID", { ...payload(), cues: [{ ...cue(), cueId: "" }] }],
  ["long ID", { ...payload(), cues: [{ ...cue(), cueId: "a".repeat(129) }] }],
  ["noninteger time", { ...payload(), cues: [{ ...cue(), startMs: 0.5 }] }],
  ["null time", { ...payload(), cues: [{ ...cue(), startMs: null }] }],
  ["negative time", { ...payload(), cues: [{ ...cue(), startMs: -1 }] }],
  ["reversed time", { ...payload(), cues: [{ ...cue(), endMs: 1 }] }],
  [
    "unsafe time",
    { ...payload(), cues: [{ ...cue(), endMs: Number.MAX_SAFE_INTEGER + 1 }] },
  ],
  ["numeric text", { ...payload(), cues: [{ ...cue(), text: 42 }] }],
  ["extra Cue field", { ...payload(), cues: [{ ...cue(), extra: true }] }],
  ["surrogate", { ...payload(), cues: [cue(1, "\ud800")] }],
])("rejects %s before provider", async (_label, body) => {
  await errorCheck(request(body), 400, "INVALID_REQUEST");
  expect(factory).not.toHaveBeenCalled();
});

test.each([
  [
    "Cue count",
    {
      ...payload(),
      cues: Array.from({ length: limits.maxCues + 1 }, (_, i) => cue(i + 1)),
    },
  ],
  [
    "UTF-8 text",
    {
      ...payload(),
      cues: [cue(1, "한".repeat(Math.ceil(limits.maxTextBytes / 3)))],
    },
  ],
  ["raw request", " ".repeat(limits.maxBytes + 1)],
])("rejects %s limit before provider", async (_label, data) => {
  await errorCheck(request(data), 413, "REQUEST_TOO_LARGE");
  expect(factory).not.toHaveBeenCalled();
});

test("accepts exact body byte limit and exact Cue/text limits", async () => {
  const json = JSON.stringify(payload());
  expect(
    (
      await POST(
        request(
          json +
            " ".repeat(limits.maxBytes - new TextEncoder().encode(json).length),
        ),
      )
    ).status,
  ).toBe(200);
  const data = {
    ...payload(),
    cues: Array.from({ length: limits.maxCues }, (_, i) =>
      cue(i + 1, i === 0 ? "x".repeat(limits.maxTextBytes) : "Test"),
    ),
  };
  expect((await POST(request(data))).status).toBe(200);
});

test("declared oversized Content-Length rejects before reading body", async () => {
  const req = request(payload(), {
    "content-length": String(limits.maxBytes + 1),
  });
  await errorCheck(req, 413, "REQUEST_TOO_LARGE");
  expect(req.bodyUsed).toBe(false);
  expect(factory).not.toHaveBeenCalled();
});

test("chunked body with dishonest Content-Length is bounded and cancelled", async () => {
  const cancelled = vi.fn();
  let chunks = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(65536));
      chunks++;
    },
    cancel: cancelled,
  });
  const req = new Request("http://localhost/api/translation", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": "1" },
    body: stream,
    duplex: "half",
  } as RequestInit);
  await errorCheck(req, 413, "REQUEST_TOO_LARGE");
  expect(cancelled).toHaveBeenCalled();
  expect(chunks).toBeLessThan(8);
  expect(factory).not.toHaveBeenCalled();
});

test("invalid UTF-8 is rejected", async () => {
  const req = new Request("http://localhost/api/translation", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: new Uint8Array([255]),
  });
  await errorCheck(req, 400, "INVALID_REQUEST");
  expect(factory).not.toHaveBeenCalled();
});

test("content type rejects simple cross-site forms", async () => {
  await errorCheck(
    request(payload(), { "content-type": "text/plain" }),
    415,
    "UNSUPPORTED_MEDIA_TYPE",
  );
  expect(factory).not.toHaveBeenCalled();
});
test.each<Record<string, string>>([
  { origin: "https://example.invalid" },
  { origin: "null" },
  { "sec-fetch-site": "cross-site" },
])("cross-origin request blocked", async (headers) => {
  await errorCheck(request(payload(), headers), 403, "FORBIDDEN");
  expect(factory).not.toHaveBeenCalled();
});

const providerStatuses: [TranslationProviderErrorCode, number][] = [
  ["CONFIGURATION", 503],
  ["AUTHENTICATION", 502],
  ["RATE_LIMIT", 429],
  ["TIMEOUT", 504],
  ["SERVER", 502],
  ["REFUSAL", 422],
  ["EMPTY_RESPONSE", 502],
  ["SCHEMA_MISMATCH", 502],
  ["INCOMPLETE_RESPONSE", 502],
  ["REQUEST", 502],
  ["CONNECTION", 502],
];
test.each(providerStatuses)(
  "safe Provider %s response",
  async (code, status) => {
    const error = new TranslationProviderError(code);
    error.message = "Synthetic source synthetic-key SDK response body";
    Object.assign(error, { cause: { secret: "synthetic-key" } });
    translate.mockRejectedValue(error);
    const spies = [
      vi.spyOn(console, "log"),
      vi.spyOn(console, "error"),
      vi.spyOn(console, "warn"),
      vi.spyOn(console, "info"),
      vi.spyOn(console, "debug"),
    ];
    const body = await errorCheck(request(), status, code);
    expect(JSON.stringify(body)).not.toMatch(
      /Synthetic source|synthetic-key|SDK response/,
    );
    spies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  },
);

test("unknown errors do not escape", async () => {
  translate.mockRejectedValue(new Error("synthetic secret"));
  await errorCheck(request(), 500, "INTERNAL_ERROR");
});
test("invalid later batch cannot return partial results", async () => {
  translate.mockImplementationOnce(good).mockResolvedValueOnce([]);
  await errorCheck(
    request({
      ...payload(),
      cues: Array.from({ length: 33 }, (_, i) => cue(i + 1)),
    }),
    502,
    "SCHEMA_MISMATCH",
  );
  expect(translate).toHaveBeenCalledTimes(2);
});
