import { describe, expect, it, vi } from "vitest";
import { displayText, graphemeCount } from "../src/lib/subtitles/metrics";

describe("Korean counting policy v1", () => {
  it.each([
    ["한글", "한글", 2],
    ["ABC", "ABC", 3],
    ["2026", "2026", 4],
    ["  가  나  ", "가  나", 4],
    [" 가 \r\n 나 ", "가\n나", 2],
    ["네, 좋아요!", "네, 좋아요!", 7],
    ["👍🏽👨‍👩‍👧‍👦🇰🇷", "👍🏽👨‍👩‍👧‍👦🇰🇷", 3],
    ["가e\u0301", "가é", 2],
    ["Ａ１가", "Ａ１가", 3],
    ["<v Mina><b>가</b></v>", "가", 1],
    ["[웃음]", "[웃음]", 4],
    ["민수: 네", "민수: 네", 5],
    ["♪ 노래 ♪", "♪ 노래 ♪", 6],
    ["<ruby>漢<rt>한</rt></ruby>", "漢", 1],
    ["<i>가</i><br/>나", "가\n나", 2],
    ["&lt;b&gt;", "<b>", 3],
    ["&amp;&#xAC00;", "&가", 2],
    ["가\t나", "가 나", 3],
    ["\u200b\u200e", "", 0],
    ["<unknown>가</unknown>", "<unknown>가</unknown>", 20],
  ])("%s", (raw, normalized, count) => {
    expect(displayText(raw as string)).toBe(normalized);
    expect(
      (normalized as string)
        .split("\n")
        .reduce((n, line) => n + graphemeCount(line), 0),
    ).toBe(count);
  });
  it("does not silently fall back to UTF-16 counting", () => {
    const segmenter = Intl.Segmenter;
    vi.stubGlobal("Intl", { ...Intl, Segmenter: undefined });
    try {
      expect(() => graphemeCount("가")).toThrow("브라우저");
    } finally {
      vi.unstubAllGlobals();
      expect(Intl.Segmenter).toBe(segmenter);
    }
  });
});
