import { expect, test } from "@playwright/test";

test.beforeEach(async ({ context }) => {
  // Forbid all non-local browser traffic, even if configuration accidentally changes.
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.hostname === "127.0.0.1" ? route.continue() : route.abort();
  });
});
test("login, verified Header, reload persistence and logout", async ({
  page,
}) => {
  await page.goto("/login?next=/tools/subtitle-converter");
  await page.getByLabel("이메일", { exact: true }).fill("reader@example.test");
  await page
    .getByLabel("비밀번호", { exact: true })
    .fill("synthetic-password8");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/tools\/subtitle-converter$/);
  await expect(page.getByRole("banner")).toContainText("reader@example.test");
  await page.reload();
  await expect(page.getByRole("banner")).toContainText("reader@example.test");
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("banner").getByRole("link", { name: "로그인", exact: true }),
  ).toBeVisible();
});
test("signup confirmation uses same-browser PKCE callback and safe next", async ({
  page,
}) => {
  await page.goto("/login?next=https://example.invalid");
  await page.getByRole("button", { name: "회원가입 모드" }).click();
  await page.getByLabel("이메일", { exact: true }).fill("reader@example.test");
  await page
    .getByLabel("비밀번호", { exact: true })
    .fill("synthetic-password8");
  const signupRequest = page.waitForRequest((request) =>
    request.url().includes("/auth/v1/signup"),
  );
  await page.getByRole("button", { name: "회원가입", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("확인 메일");
  // Emulates clicking the service's confirmation redirect; no email is sent.
  const callbackResponse = page.waitForResponse((response) =>
    response.url().includes("/auth/callback?"),
  );
  const sent = await signupRequest;
  const destination = new URL(
    new URL(sent.url()).searchParams.get("redirect_to")!,
  );
  destination.searchParams.set("code", "synthetic-confirmation");
  destination.searchParams.set("next", "https://example.invalid");
  await page.goto(destination.href);
  const response = await callbackResponse;
  expect(!!(await response.allHeaders())["set-cookie"]).toBe(true);
  expect(
    (await page.context().cookies()).some((cookie) =>
      /-auth-token(?:\.\d+)?$/.test(cookie.name),
    ),
  ).toBe(true);
  await expect(page).toHaveURL("http://127.0.0.1:3117/");
  await expect(page.getByRole("banner")).toContainText("reader@example.test");
  await page.reload();
  await expect(page.getByRole("banner")).toContainText("reader@example.test");
});
test("input validation and safe internal error messages", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "이메일 인증" }).getByRole("alert"),
  ).toContainText("이메일 형식");
  await page.getByLabel("이메일", { exact: true }).fill("denied@example.test");
  await page
    .getByLabel("비밀번호", { exact: true })
    .fill("synthetic-password8");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "이메일 인증" }).getByRole("alert"),
  ).toContainText("로그인하지 못했습니다");
  await expect(page.locator("body")).not.toContainText(
    "INTERNAL_AUTH_RESPONSE",
  );
  await page.goto("/auth/callback?error=INTERNAL_AUTH_RESPONSE");
  await expect(
    page.getByRole("region", { name: "이메일 인증" }).getByRole("alert"),
  ).toContainText("확인 링크");
});
