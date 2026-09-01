import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { POST } from "../src/app/api/translation/route";
import { createOpenAITranslationProvider } from "../src/lib/translation/providers/openai";
import {
  TranslationProviderError,
  type TranslationProviderErrorCode,
} from "../src/lib/translation/provider-error";
import { TRANSLATION_REQUEST_LIMITS as limits } from "../src/lib/translation/api-request";
import type { TranslationBatch } from "../src/lib/translation/types";

const auth = vi.hoisted(() => ({
  serverSupabase: vi.fn(),
  getUser: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("../src/lib/supabase/server", () => ({
  serverSupabase: auth.serverSupabase,
}));
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
  auth.serverSupabase.mockReset();
  auth.getUser.mockReset();
  auth.rpc.mockReset();
  auth.rpc.mockResolvedValue({
    data: [
      {
        reserved: true,
        usage_date: "2026-09-01",
        request_count: 1,
        cue_count: 1,
        source_grapheme_count: 16,
      },
    ],
    error: null,
  });
  auth.serverSupabase.mockResolvedValue({
    auth: { getUser: auth.getUser },
    rpc: auth.rpc,
  });
  auth.getUser.mockResolvedValue({
    data: { user: { id: "synthetic-user" } },
    error: null,
  });
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
    expect(auth.serverSupabase).not.toHaveBeenCalled();
    expect(auth.rpc).not.toHaveBeenCalled();
    expect(factory).not.toHaveBeenCalled();
  },
);

test.each([
  ["missing Supabase configuration", null],
  ["missing user", { data: { user: null }, error: null }],
  [
    "invalid or expired session",
    { data: { user: null }, error: { message: "PRIVATE_AUTH_ERROR" } },
  ],
] as const)(
  "unauthenticated: %s returns 401 before body/provider",
  async (_label, result) => {
    if (result === null) auth.serverSupabase.mockResolvedValueOnce(null);
    else auth.getUser.mockResolvedValueOnce(result);
    const req = request("private source text");
    const body = await errorCheck(req, 401, "UNAUTHORIZED");
    expect(req.bodyUsed).toBe(false);
    expect(auth.rpc).not.toHaveBeenCalled();
    expect(factory).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toMatch(
      /private source|PRIVATE_AUTH_ERROR/,
    );
  },
);

test("Auth service failure returns fixed 401 without logs or provider", async () => {
  auth.getUser.mockRejectedValueOnce(new Error("PRIVATE_AUTH_ERROR"));
  const spies = [
    vi.spyOn(console, "log"),
    vi.spyOn(console, "error"),
    vi.spyOn(console, "warn"),
    vi.spyOn(console, "info"),
    vi.spyOn(console, "debug"),
  ];
  await errorCheck(request("private source text"), 401, "UNAUTHORIZED");
  expect(factory).not.toHaveBeenCalled();
  expect(auth.rpc).not.toHaveBeenCalled();
  spies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
});

test("verified session enters the existing request pipeline", async () => {
  expect((await POST(request())).status).toBe(200);
  expect(auth.getUser).toHaveBeenCalledTimes(1);
  expect(auth.rpc).toHaveBeenCalledTimes(1);
  expect(factory).toHaveBeenCalledTimes(1);
});

test("reserves Cue count and standard graphemes before provider", async () => {
  const data = {
    ...payload(),
    cues: [cue(1, "👍🏽"), cue(2, "e\u0301"), cue(3, "👨‍👩‍👧‍👦")],
  };
  expect((await POST(request(data))).status).toBe(200);
  expect(auth.rpc).toHaveBeenCalledWith("reserve_translation_usage", {
    p_cue_count: 3,
    p_source_grapheme_count: 3,
  });
  expect(factory).toHaveBeenCalledTimes(1);
});

test("usage limit returns safe 429 before provider", async () => {
  auth.rpc.mockResolvedValueOnce({
    data: [
      {
        reserved: false,
        usage_date: "2026-09-01",
        request_count: 10,
        cue_count: 500,
        source_grapheme_count: 20000,
      },
    ],
    error: null,
  });
  const body = await errorCheck(request(), 429, "USAGE_LIMIT_EXCEEDED");
  expect(JSON.stringify(body)).not.toMatch(/10|500|20000|2026-09-01/);
  expect(factory).not.toHaveBeenCalled();
});

test.each([
  ["RPC error", { data: null, error: { message: "PRIVATE_DB_ERROR" } }],
  ["missing row", { data: [], error: null }],
  [
    "multiple rows",
    { data: [{ reserved: true }, { reserved: true }], error: null },
  ],
  ["invalid row", { data: [{ reserved: "true" }], error: null }],
] as const)("%s returns safe 503 before provider", async (_label, result) => {
  auth.rpc.mockResolvedValueOnce(result);
  const body = await errorCheck(request(), 503, "USAGE_SERVICE_UNAVAILABLE");
  expect(factory).not.toHaveBeenCalled();
  expect(JSON.stringify(body)).not.toContain("PRIVATE_DB_ERROR");
});

test("thrown RPC failure returns safe 503 without provider", async () => {
  auth.rpc.mockRejectedValueOnce(new Error("PRIVATE_DB_ERROR source text"));
  const body = await errorCheck(request(), 503, "USAGE_SERVICE_UNAVAILABLE");
  expect(factory).not.toHaveBeenCalled();
  expect(JSON.stringify(body)).not.toMatch(/PRIVATE_DB_ERROR|source text/);
});

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
  expect(auth.rpc).not.toHaveBeenCalled();
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
  expect(auth.rpc).not.toHaveBeenCalled();
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
  expect(auth.rpc).not.toHaveBeenCalled();
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
  expect(auth.rpc).not.toHaveBeenCalled();
  expect(factory).not.toHaveBeenCalled();
});

test("invalid UTF-8 is rejected", async () => {
  const req = new Request("http://localhost/api/translation", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: new Uint8Array([255]),
  });
  await errorCheck(req, 400, "INVALID_REQUEST");
  expect(auth.rpc).not.toHaveBeenCalled();
  expect(factory).not.toHaveBeenCalled();
});

test("content type rejects simple cross-site forms", async () => {
  await errorCheck(
    request(payload(), { "content-type": "text/plain" }),
    415,
    "UNSUPPORTED_MEDIA_TYPE",
  );
  expect(auth.rpc).not.toHaveBeenCalled();
  expect(factory).not.toHaveBeenCalled();
});
test.each<Record<string, string>>([
  { origin: "https://example.invalid" },
  { origin: "null" },
  { "sec-fetch-site": "cross-site" },
])("cross-origin request blocked", async (headers) => {
  await errorCheck(request(payload(), headers), 403, "FORBIDDEN");
  expect(auth.rpc).not.toHaveBeenCalled();
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
