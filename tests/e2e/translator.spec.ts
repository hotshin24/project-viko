import { expect, test, type Locator, type Page } from "@playwright/test";

const source = `1
00:00:01,000 --> 00:00:02,000
Hello

2
00:00:03,000 --> 00:00:04,000

3
00:00:05,000 --> 00:00:06,000
World
`;

async function login(page: Page) {
  await page.goto("/login?next=/tools/subtitle-translator");
  await page.getByLabel("이메일", { exact: true }).fill("reader@example.test");
  await page
    .getByLabel("비밀번호", { exact: true })
    .fill("synthetic-password8");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/tools\/subtitle-translator$/);
}

async function tabTo(page: Page, locator: Locator) {
  for (let step = 0; step < 20; step++) {
    if (await locator.evaluate((element) => element === document.activeElement))
      return;
    await page.keyboard.press("Tab");
  }
  await expect(locator).toBeFocused();
}

function translated(payload: {
  cues: Array<{
    cueId: string;
    order: number;
    text: string;
    startMs: number;
    endMs: number;
  }>;
}) {
  return {
    cues: payload.cues.map((cue) => ({
      cueId: cue.cueId,
      order: cue.order,
      startMs: cue.startMs,
      endMs: cue.endMs,
      text: cue.text ? `번역 ${cue.order}` : "",
      status: cue.text ? "translated" : "skipped-empty",
    })),
    metadata: {},
  };
}

test("keyboard translation preserves Cues and downloads original format", async ({
  page,
}) => {
  const requests: Parameters<typeof translated>[0][] = [];
  await page.route("**/api/translation", async (route) => {
    const requestPayload = route.request().postDataJSON() as Parameters<
      typeof translated
    >[0];
    requests.push(requestPayload);
    await route.fulfill({ status: 200, json: translated(requestPayload) });
  });
  await login(page);
  const input = page.getByLabel("SRT 또는 VTT 자막 파일");
  await tabTo(page, input);
  await expect(input).toBeFocused();
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    input.press("Enter"),
  ]);
  await chooser.setFiles({
    name: "interview.srt",
    mimeType: "application/x-subrip",
    buffer: Buffer.from(source, "utf8"),
  });
  await expect(
    page.getByRole("status", { name: "번역 처리 상태" }),
  ).toContainText("3 Cue 파싱 완료");
  await page.keyboard.press("Tab");
  const language = page.getByLabel("원문 언어");
  await expect(language).toBeFocused();
  await language.selectOption("en");
  await expect(language).toHaveValue("en");
  const style = page.getByLabel("번역 스타일");
  await style.selectOption("faithful");
  await expect(style).toHaveValue("faithful");
  const run = page.getByRole("button", { name: "한국어로 번역" });
  await tabTo(page, run);
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("status", { name: "번역 처리 상태" }),
  ).toContainText("번역 완료");
  expect(requests[0]).toMatchObject({
    sourceLanguage: "en",
    targetLanguage: "ko",
    style: "faithful",
  });
  expect(
    requests[0].cues.map((cue) => [
      cue.order,
      cue.startMs,
      cue.endMs,
      cue.text,
    ]),
  ).toEqual([
    [1, 1000, 2000, "Hello"],
    [2, 3000, 4000, ""],
    [3, 5000, 6000, "World"],
  ]);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "한국어 자막 다운로드" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("interview.ko.srt");
  const stream = await download.createReadStream();
  const parts: Buffer[] = [];
  for await (const chunk of stream!) parts.push(Buffer.from(chunk));
  expect(
    new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(parts)),
  ).toContain("2\n00:00:03,000 --> 00:00:04,000\n\n\n3");
});

test("maps API and response validation errors without exposing bodies", async ({
  page,
}) => {
  const replies: Array<{ status: number; json: unknown }> = [
    { status: 401, json: { private: "session" } },
    { status: 429, json: { private: "usage" } },
    { status: 503, json: { private: "database" } },
    { status: 400, json: { private: "validation" } },
    {
      status: 200,
      json: {
        cues: [
          {
            cueId: "wrong",
            order: 1,
            startMs: 1000,
            endMs: 2000,
            text: "번역",
            status: "translated",
          },
        ],
      },
    },
  ];
  await page.route("**/api/translation", async (route) => {
    const reply = replies.shift()!;
    await route.fulfill(reply);
  });
  await login(page);
  await page.getByLabel("SRT 또는 VTT 자막 파일").setInputFiles({
    name: "source.vtt",
    mimeType: "text/vtt",
    buffer: Buffer.from("WEBVTT\n\n00:01.000 --> 00:02.000\nHello\n", "utf8"),
  });
  const run = page.getByRole("button", { name: "한국어로 번역" });
  for (const expected of [
    "로그인 세션",
    "사용 한도",
    "사용할 수 없습니다",
    "요청 형식",
    "Cue 1",
  ]) {
    await run.click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      expected,
    );
    await expect(page.locator("body")).not.toContainText("private");
    await expect(
      page.getByRole("link", { name: "한국어 자막 다운로드" }),
    ).toHaveCount(0);
  }
});
