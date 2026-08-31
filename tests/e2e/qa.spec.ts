import { test, expect, type Page, type Locator } from "@playwright/test";
import path from "node:path";

const fixture = (name: string) => path.resolve("tests/fixtures/v1", name);
const fileInput = (page: Page) =>
  page.getByLabel("SRT 또는 VTT 자막 파일 선택");
const status = (page: Page) =>
  page.getByRole("status", { name: "QA 처리 상태" });
const storageStatus = (page: Page) =>
  page.getByRole("status", { name: "임시 저장 상태" });

async function tabTo(page: Page, locator: Locator) {
  for (let step = 0; step < 50; step++) {
    if (await locator.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  await expect(locator).toBeFocused();
}
async function uploadAndRun(page: Page, name: string) {
  await fileInput(page).setInputFiles(fixture(name));
  await page.getByRole("button", { name: "QA 검사 실행", exact: true }).click();
  await expect(status(page)).toContainText("검사 완료");
}

test("keyboard-only flow: file chooser, preset, run, both filters, cue, details, delete", async ({
  page,
}) => {
  await page.goto("/tools/subtitle-qa");
  await expect(fileInput(page)).toBeEnabled();
  // Actual Tab order from the document, without focus(), clicks or DOM event injection.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "본문으로 이동" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "VIKO Localize 홈" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("banner").getByRole("link", { name: "로그인", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(fileInput(page)).toBeFocused();
  await expect(fileInput(page).locator("..")).toHaveCSS(
    "outline-style",
    "solid",
  );
  const chooserPromise = page.waitForEvent("filechooser");
  await page.keyboard.press("Enter");
  const chooser = await chooserPromise;
  // Only OS file selection is supplied by the runner. The chooser was opened by Enter.
  await chooser.setFiles(fixture("long-korean.srt"));
  await page.keyboard.press("Tab");
  const preset = page.getByLabel("프리셋", { exact: true });
  await expect(preset).toBeFocused();
  // Native typeahead avoids macOS headless popup-menu key routing.
  await page.keyboard.type("Korean Education");
  await expect(preset).toHaveValue("ko-education");
  await page.keyboard.press("Tab");
  const run = page.getByRole("button", { name: "QA 검사 실행", exact: true });
  await expect(run).toBeFocused();
  await expect(run).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("Enter");
  await expect(status(page)).toContainText("검사 완료");
  await expect(page.getByRole("group", { name: "QA 오류 요약" })).toContainText(
    "Warning",
  );
  const severity = page.getByLabel("심각도", { exact: true });
  await tabTo(page, severity);
  await page.keyboard.type("Warning");
  await expect(severity).toHaveValue("Warning");
  await page.keyboard.press("Tab");
  const rule = page.getByLabel("오류 유형", { exact: true });
  await expect(rule).toBeFocused();
  await page.keyboard.type("CPL");
  await expect(rule).toHaveValue("CPL");
  await page.keyboard.press("Tab");
  const cue = page.getByRole("button", { name: "Cue 1 선택", exact: true });
  await expect(cue).toBeFocused();
  await page.keyboard.press("Space");
  await expect(cue).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Tab");
  const detail = page
    .locator("summary")
    .filter({ hasText: "Cue 1 원본 블록 확인" });
  await expect(detail).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(detail.locator("..")).toHaveAttribute("open", "");
  await expect(detail.locator("..")).toContainText(
    "00:00:01,000 --> 00:00:07,000",
  );
  const remove = page.getByRole("button", { name: "저장된 검사 결과 삭제" });
  await tabTo(page, remove);
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("region", { name: "검사 결과", exact: true }),
  ).toHaveCount(0);
  await expect(storageStatus(page)).toContainText("삭제했습니다");
  await expect(fileInput(page)).toBeFocused();
  await page.reload();
  await expect(storageStatus(page)).toContainText(
    "저장된 검사 결과가 없습니다",
  );
});

test("reload restores deterministic QA; deletion prevents resurrection", async ({
  page,
}) => {
  await page.goto("/tools/subtitle-qa");
  await uploadAndRun(page, "overlap.srt");
  const before = await page
    .getByRole("group", { name: "QA 오류 요약" })
    .textContent();
  await expect(storageStatus(page)).toContainText("임시 저장했습니다");
  await page.reload();
  await expect(status(page)).toContainText("복원 완료");
  await expect(page.getByRole("group", { name: "QA 오류 요약" })).toHaveText(
    before!,
  );
  await expect(page.getByText("overlap.srt", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "저장된 검사 결과 삭제" }).click();
  await page.reload();
  await expect(storageStatus(page)).toContainText(
    "저장된 검사 결과가 없습니다",
  );
});

test("normal VTT success, invalid UTF-8 error, and no subtitle network upload", async ({
  page,
}) => {
  const uploads: string[] = [];
  page.on("request", (request) => {
    if (["POST", "PUT", "PATCH"].includes(request.method()))
      uploads.push(request.url());
  });
  await page.goto("/tools/subtitle-qa");
  await uploadAndRun(page, "education-normal.vtt");
  await expect(page.getByRole("group", { name: "QA 오류 요약" })).toContainText(
    "Critical0",
  );
  await fileInput(page).setInputFiles({
    name: "invalid.srt",
    mimeType: "text/plain",
    buffer: Buffer.from([0xc3, 0x28]),
  });
  await page.getByRole("button", { name: "QA 검사 실행", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "UTF-8" }),
  ).toBeVisible();
  expect(uploads).toEqual([]);
});

test("blocked session writes never prevent a QA report", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("quota", "QuotaExceededError");
    };
  });
  await page.goto("/tools/subtitle-qa");
  await uploadAndRun(page, "general-normal.srt");
  await expect(storageStatus(page)).toContainText("임시 저장에 실패");
  await expect(page.getByText("규칙 검사 완료", { exact: true })).toBeVisible();
});

test("incompatible and expired snapshots are discarded", async ({ page }) => {
  await page.goto("/tools/subtitle-qa");
  await uploadAndRun(page, "general-normal.srt");
  await page.evaluate(() => {
    const key = "viko:qa-session";
    const saved = JSON.parse(sessionStorage.getItem(key)!);
    saved.schemaVersion = -1;
    sessionStorage.setItem(key, JSON.stringify(saved));
  });
  await page.reload();
  await expect(storageStatus(page)).toContainText("안전하게 폐기");
  await uploadAndRun(page, "general-normal.srt");
  await page.evaluate(() => {
    const key = "viko:qa-session";
    const saved = JSON.parse(sessionStorage.getItem(key)!);
    saved.savedAt = 0;
    sessionStorage.setItem(key, JSON.stringify(saved));
  });
  await page.reload();
  await expect(storageStatus(page)).toContainText("안전하게 폐기");
});
