import { test, expect } from "@playwright/test";
import path from "node:path";

for (const format of ["srt", "vtt"] as const) {
  test(`${format} conversion preview and UTF-8 download stay local`, async ({
    page,
  }) => {
    const uploads: string[] = [];
    page.on("request", (request) => {
      if (["POST", "PUT", "PATCH"].includes(request.method()))
        uploads.push(request.url());
    });
    await page.goto("/");
    await page.getByRole("link", { name: "Subtitle Converter 시작" }).click();
    await expect(page).toHaveURL(/\/tools\/subtitle-converter$/);
    await expect(page.getByRole("banner")).toContainText("Subtitle Converter");
    await expect(page.getByLabel("변환할 SRT 또는 VTT 파일")).toBeEnabled();
    await page
      .getByLabel("변환할 SRT 또는 VTT 파일")
      .setInputFiles(path.resolve(`tests/fixtures/valid.${format}`));
    await expect(
      page.getByRole("status", { name: "변환 처리 상태" }),
    ).toContainText("파싱 완료");
    const preview = page.getByRole("button", { name: "변환 미리보기" });
    if (format === "vtt") {
      await expect(preview).toBeDisabled();
      await expect(
        page.getByRole("link", { name: "변환 파일 다운로드" }),
      ).toHaveCount(0);
      await page.getByRole("checkbox").check();
    }
    await preview.click();
    const text = await page.getByLabel("변환된 자막 미리보기").inputValue();
    const link = page.getByRole("link", { name: "변환 파일 다운로드" });
    const target = format === "srt" ? "vtt" : "srt";
    await expect(link).toHaveAttribute("download", `valid.${target}`);
    const mime = await link.evaluate(async (element) =>
      (await fetch((element as HTMLAnchorElement).href)).headers.get(
        "content-type",
      ),
    );
    expect(mime).toBe(
      target === "vtt"
        ? "text/vtt;charset=utf-8"
        : "application/x-subrip;charset=utf-8",
    );
    const pending = page.waitForEvent("download");
    await link.click();
    const download = await pending;
    expect(download.suggestedFilename()).toBe(`valid.${target}`);
    const stream = await download.createReadStream();
    const parts: Buffer[] = [];
    for await (const chunk of stream!) parts.push(Buffer.from(chunk));
    expect(
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(parts)),
    ).toBe(text);
    expect(uploads).toEqual([]);
    if (format === "vtt") {
      await page.getByRole("checkbox").uncheck();
      await expect(link).toHaveCount(0);
    }
    await page
      .getByLabel("변환할 SRT 또는 VTT 파일")
      .setInputFiles(path.resolve("tests/fixtures/broken.srt"));
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "변환할 수 없습니다",
    );
    await expect(link).toHaveCount(0);
    await expect(preview).toBeDisabled();
  });
}

test("converter supports keyboard file selection, preview and download", async ({
  page,
}) => {
  await page.goto("/tools/subtitle-converter");
  await expect(page.getByLabel("변환할 SRT 또는 VTT 파일")).toBeEnabled();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "본문으로 이동" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "VIKO Localize 홈" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("변환할 SRT 또는 VTT 파일")).toBeFocused();
  const chooserPromise = page.waitForEvent("filechooser");
  await page.keyboard.press("Enter");
  await (
    await chooserPromise
  ).setFiles(path.resolve("tests/fixtures/valid.srt"));
  await expect(
    page.getByRole("status", { name: "변환 처리 상태" }),
  ).toContainText("파싱 완료");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "변환 미리보기" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("status", { name: "변환 처리 상태" }),
  ).toContainText("변환 완료");
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("변환된 자막 미리보기")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "변환 파일 다운로드" }),
  ).toBeFocused();
  const download = page.waitForEvent("download");
  await page.keyboard.press("Enter");
  expect((await download).suggestedFilename()).toBe("valid.vtt");
});
