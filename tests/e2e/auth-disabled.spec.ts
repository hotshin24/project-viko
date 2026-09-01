import { expect, test } from "@playwright/test";
test("missing Supabase configuration leaves local tools available", async ({
  page,
}) => {
  await page.goto("/login?next=//example.invalid");
  await expect(page.getByRole("status")).toContainText(
    "아직 설정되지 않았습니다",
  );
  await expect(
    page.getByRole("button", { name: "로그인", exact: true }),
  ).toBeDisabled();
  await page.getByRole("link", { name: "VIKO Localize 홈" }).click();
  await page.getByRole("link", { name: "Subtitle QA 시작" }).click();
  await expect(page.getByLabel("SRT 또는 VTT 자막 파일 선택")).toBeEnabled();
});

test("translator requires login before execution", async ({ page }) => {
  await page.goto("/tools/subtitle-translator");
  await page.getByLabel("SRT 또는 VTT 자막 파일").setInputFiles({
    name: "source.srt",
    mimeType: "application/x-subrip",
    buffer: Buffer.from("1\n00:00:01,000 --> 00:00:02,000\nHello\n", "utf8"),
  });
  await expect(
    page.getByRole("button", { name: "한국어로 번역" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("link", { name: "로그인", exact: true }).last(),
  ).toHaveAttribute("href", "/login?next=/tools/subtitle-translator");
});
