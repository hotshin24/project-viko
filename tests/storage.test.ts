import { describe, expect, it } from "vitest";
import { analyze } from "../src/lib/qa/analyze";
import {
  clearSession,
  loadSession,
  saveSession,
  SESSION_KEY,
  SESSION_MAX_CHARS,
  SESSION_TTL_MS,
} from "../src/lib/session/storage";

const analysis = () =>
  analyze({
    buffer: new TextEncoder().encode("1\n00:00:01,000 --> 00:00:03,000\n원본\n")
      .buffer,
    format: "srt",
    profileId: "ko-general",
  });
function memory() {
  const map = new Map<string, string>();
  const storage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
  return { map, storage, get: () => storage };
}

describe("bounded versioned session storage", () => {
  it("round-trips reproducible inputs without duplicate reports or media", () => {
    const store = memory();
    expect(
      saveSession(analysis(), "example.srt", store.get, 100),
    ).toMatchObject({ ok: true });
    const loaded = loadSession(store.get, 101);
    expect(loaded.snapshot).toMatchObject({
      schemaVersion: 1,
      profileVersion: "1.0.0",
      filename: "example.srt",
      originalText: analysis().track.originalText,
    });
    const raw = JSON.parse(store.map.get(SESSION_KEY)!);
    expect(raw.report).toBeUndefined();
    expect(raw.buffer).toBeUndefined();
    expect(raw.cues).toBeUndefined();
  });
  it.each([
    ["schemaVersion", 0],
    ["profileVersion", "0.1.0"],
    ["ruleVersion", "0.0.0"],
    ["countingPolicyVersion", "0.0.0"],
    ["profileId", "missing"],
    ["format", "exe"],
    ["filename", null],
    ["originalText", {}],
    ["savedAt", "100"],
    ["savedAt", 102],
  ])("discards incompatible %s", (key, value) => {
    const store = memory();
    saveSession(analysis(), "test.srt", store.get, 100);
    const object = JSON.parse(store.map.get(SESSION_KEY)!);
    object[key] = value;
    store.map.set(SESSION_KEY, JSON.stringify(object));
    expect(loadSession(store.get, 101).snapshot).toBeNull();
    expect(store.map.has(SESSION_KEY)).toBe(false);
  });
  it.each(["{", "null", "[]", "x".repeat(SESSION_MAX_CHARS + 1)])(
    "discards corrupt or oversized serialization %#",
    (text) => {
      const store = memory();
      store.map.set(SESSION_KEY, text);
      expect(loadSession(store.get).snapshot).toBeNull();
      expect(store.map.has(SESSION_KEY)).toBe(false);
    },
  );
  it("expires at 24 hours and does not renew on reads", () => {
    const store = memory();
    saveSession(analysis(), "test.srt", store.get, 100);
    expect(
      loadSession(store.get, 100 + SESSION_TTL_MS - 1).snapshot?.savedAt,
    ).toBe(100);
    expect(loadSession(store.get, 100 + SESSION_TTL_MS).snapshot).toBeNull();
  });
  it("leaves QA usable on quota failure and clears previous data", () => {
    const store = memory();
    saveSession(analysis(), "old.srt", store.get);
    const quota = () => ({
      ...store.storage,
      setItem: () => {
        throw new Error("quota");
      },
    });
    const result = analysis();
    expect(saveSession(result, "new.srt", quota).ok).toBe(false);
    expect(store.map.has(SESSION_KEY)).toBe(false);
    expect(result.report.summary.totalCues).toBe(1);
  });
  it("rejects oversized snapshots but keeps the current analysis", () => {
    const store = memory();
    const result = analysis();
    const oversized = {
      ...result,
      track: { ...result.track, originalText: "가".repeat(SESSION_MAX_CHARS) },
    };
    expect(saveSession(oversized, "large.srt", store.get).ok).toBe(false);
    expect(result.track.cues).toHaveLength(1);
  });
  it("handles blocked storage getters and deletion honestly", () => {
    const denied = () => {
      throw new Error("denied");
    };
    expect(loadSession(denied).snapshot).toBeNull();
    expect(saveSession(analysis(), "a.srt", denied).ok).toBe(false);
    expect(clearSession(denied).ok).toBe(false);
  });
  it("only deletes its own key and cannot restore after deletion", () => {
    const store = memory();
    store.map.set("unrelated", "keep");
    saveSession(analysis(), "a.srt", store.get);
    expect(clearSession(store.get).ok).toBe(true);
    expect(loadSession(store.get).snapshot).toBeNull();
    expect(store.map.get("unrelated")).toBe("keep");
  });
});
