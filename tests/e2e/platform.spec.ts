import { test, expect } from "@playwright/test";
import path from "node:path";
import { TOOL_REGISTRY } from "../../src/lib/tools/registry";

test("home lists registry tools; keyboard navigation opens QA and home roundtrip preserves session", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("VIKO");
  await expect(page.getByRole("article")).toHaveCount(6);
  for (const tool of TOOL_REGISTRY) {
    const card = page.getByRole("article", { name: tool.name, exact: true });
    await expect(card).toContainText(
      tool.status === "available" ? "사용 가능" : "준비 중",
    );
    if (tool.status === "coming-soon") {
      await expect(card.locator("a, button, input, select")).toHaveCount(0);
    }
  }
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "본문으로 이동" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "VIKO Localize 홈" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  const start = page.getByRole("link", { name: "Subtitle QA 시작" });
  await expect(start).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/tools\/subtitle-qa$/);
  await expect(page.getByRole("banner")).toContainText("Subtitle QA");
  await expect(page).toHaveTitle("Subtitle QA · VIKO Localize");
  await page
    .getByLabel("SRT 또는 VTT 자막 파일 선택")
    .setInputFiles(path.resolve("tests/fixtures/v1/overlap.srt"));
  await page.getByRole("button", { name: "QA 검사 실행", exact: true }).click();
  await expect(
    page.getByRole("status", { name: "QA 처리 상태" }),
  ).toContainText("검사 완료");
  const before = await page
    .getByRole("group", { name: "QA 오류 요약" })
    .innerText();
  await page.getByRole("link", { name: "VIKO Localize 홈" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByLabel("SRT 또는 VTT 자막 파일 선택")).toHaveCount(0);
  await page.getByRole("link", { name: "Subtitle QA 시작" }).click();
  await expect(page.getByRole("group", { name: "QA 오류 요약" })).toHaveText(
    before,
    { useInnerText: true },
  );
  await page.reload();
  await expect(page.getByRole("group", { name: "QA 오류 요약" })).toHaveText(
    before,
    { useInnerText: true },
  );
});

for (const tool of TOOL_REGISTRY.filter(
  (tool) => tool.status === "coming-soon",
)) {
  test(`${tool.id} cannot run through a direct URL`, async ({ page }) => {
    const response = await page.goto(tool.path);
    expect(response?.status()).toBe(404);
    await expect(page.getByLabel("SRT 또는 VTT 자막 파일 선택")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "QA 검사 실행", exact: true }),
    ).toHaveCount(0);
  });
}
test("unregistered tool returns 404", async ({ page }) => {
  expect((await page.goto("/tools/unknown-tool"))?.status()).toBe(404);
});
