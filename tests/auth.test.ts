import { beforeEach, afterEach, expect, test, vi } from "vitest";
import type { CookieMethodsServer } from "@supabase/ssr";
import { NextRequest } from "next/server";
import { supabaseConfig } from "../src/lib/supabase/config";
import { browserSupabase } from "../src/lib/supabase/browser";
import { serverSupabase, verifiedEmail } from "../src/lib/supabase/server";
import { refreshSession } from "../src/lib/supabase/proxy";
import {
  safeNext,
  validCredentials,
  AUTH_MESSAGES,
} from "../src/lib/auth/policy";
import { submitAuth, logout } from "../src/lib/auth/browser-actions";
import { GET } from "../src/app/auth/callback/route";

const mocks = vi.hoisted(() => ({
  browser: vi.fn(),
  server: vi.fn(),
  cookies: vi.fn(),
  getAll: vi.fn(),
  set: vi.fn(),
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  getUser: vi.fn(),
  getClaims: vi.fn(),
  exchangeCodeForSession: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@supabase/ssr", () => ({
  createBrowserClient: mocks.browser,
  createServerClient: mocks.server,
}));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
const network = vi.fn(() => {
  throw new Error("No real auth calls allowed");
});
const adapter = (): CookieMethodsServer =>
  mocks.server.mock.calls.at(-1)![2].cookies;
beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  network.mockClear();
  vi.stubGlobal("fetch", network);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "sb_publishable_test_fixture",
  );
  mocks.cookies.mockResolvedValue({ getAll: mocks.getAll, set: mocks.set });
  mocks.getAll.mockReturnValue([{ name: "auth-test", value: "synthetic" }]);
  const client = { auth: mocks };
  mocks.browser.mockReturnValue(client);
  mocks.server.mockReturnValue(client);
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "test-user", email: "reader@example.test" } },
    error: null,
  });
  mocks.getClaims.mockResolvedValue({ data: null, error: null });
  mocks.exchangeCodeForSession.mockResolvedValue({ error: null });
  mocks.signInWithPassword.mockResolvedValue({ error: null });
  mocks.signUp.mockResolvedValue({ data: { session: null }, error: null });
  mocks.signOut.mockResolvedValue({ error: null });
});
afterEach(() => {
  expect(network).not.toHaveBeenCalled();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test.each([
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
] as const)(
  "missing %s disables clients and proxy without network",
  async (key) => {
    vi.stubEnv(key, "");
    expect(supabaseConfig()).toBeNull();
    expect(browserSupabase()).toBeNull();
    expect(await serverSupabase()).toBeNull();
    expect(await verifiedEmail()).toBeNull();
    const response = await refreshSession(
      new NextRequest("http://localhost/tools/subtitle-qa"),
    );
    expect(response.status).toBe(200);
    expect(mocks.cookies).not.toHaveBeenCalled();
    expect(mocks.server).not.toHaveBeenCalled();
  },
);

test.each([
  "javascript:bad",
  "http://remote.example",
  "https://user:pass@example.test",
  "https://example.test/?token=x",
  "bad",
])("invalid configuration URL disabled: %s", (url) => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
  expect(supabaseConfig()).toBeNull();
});
test("only publishable keys accepted", () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "not-a-publishable-key");
  expect(supabaseConfig()).toBeNull();
});
test.each([
  "/",
  "/tools/subtitle-qa",
  "/tools/subtitle-converter",
  "/tools/subtitle-translator",
])("safe internal %s", (path) => expect(safeNext(path)).toBe(path));
test.each([
  undefined,
  ["/"],
  "https://evil.test",
  "//evil.test",
  "/\\evil.test",
  "/%2fevil.test",
  "/%252fevil.test",
  "/tools/../auth/callback",
  "/login",
  "/api/translation",
  "/tools/subtitle-qa?next=//evil.test",
  "javascript:alert(1)",
  " /tools/subtitle-qa",
  "/\n/evil.test",
])("unsafe next rejected: %s", (value) => expect(safeNext(value)).toBe("/"));
test.each([
  "",
  "bad",
  "a@b",
  "a b@example.test",
  "a".repeat(255) + "@example.test",
])("invalid email %s", (email) =>
  expect(validCredentials("signup", email, "password8")).toBe(false),
);
test("password limits and trimming policy", async () => {
  expect(validCredentials("signup", "a@example.test", "short")).toBe(false);
  expect(validCredentials("signup", "a@example.test", "x".repeat(129))).toBe(
    false,
  );
  expect(validCredentials("login", "a@example.test", "x")).toBe(true);
  expect(validCredentials("login", "a@example.test", "")).toBe(false);
  await submitAuth(
    "login",
    " a@example.test ",
    " password ",
    "/",
    "http://localhost",
  );
  expect(mocks.signInWithPassword).toHaveBeenCalledWith({
    email: "a@example.test",
    password: " password ",
  });
});
test("invalid inputs never reach SDK", async () => {
  expect(
    await submitAuth("signup", "bad", "x", "/", "http://localhost"),
  ).toEqual({ error: true, message: AUTH_MESSAGES.input });
  expect(mocks.browser).not.toHaveBeenCalled();
});
test("login redirect sanitized and signup callback uses PKCE destination", async () => {
  expect(
    await submitAuth(
      "login",
      "a@example.test",
      "password8",
      "//evil.test",
      "http://localhost",
    ),
  ).toEqual({ error: false, redirect: "/" });
  expect(
    await submitAuth(
      "signup",
      "a@example.test",
      "password8",
      "/tools/subtitle-qa",
      "http://localhost",
    ),
  ).toEqual({ error: false, message: AUTH_MESSAGES.sent });
  const callback = new URL(
    mocks.signUp.mock.calls[0][0].options.emailRedirectTo,
  );
  expect(callback.origin).toBe("http://localhost");
  expect(callback.pathname).toBe("/auth/callback");
  expect(callback.searchParams.get("next")).toBe("/tools/subtitle-qa");
});
test.each(["login", "signup"] as const)(
  "%s hides internal returned errors and thrown errors",
  async (mode) => {
    const fn = mode === "login" ? mocks.signInWithPassword : mocks.signUp;
    fn.mockResolvedValueOnce({
      data: null,
      error: { message: "INTERNAL_SECRET" },
    }).mockRejectedValueOnce(new Error("INTERNAL_SECRET"));
    for (let i = 0; i < 2; i++)
      expect(
        await submitAuth(
          mode,
          "a@example.test",
          "password8",
          "/",
          "http://localhost",
        ),
      ).toEqual({ error: true, message: AUTH_MESSAGES[mode] });
  },
);
test("signup without confirmation immediately returns a safe target", async () => {
  mocks.signUp.mockResolvedValue({ data: { session: {} }, error: null });
  expect(
    await submitAuth(
      "signup",
      "a@example.test",
      "password8",
      "/tools/subtitle-converter",
      "http://localhost",
    ),
  ).toMatchObject({ redirect: "/tools/subtitle-converter" });
});
test("logout clears current browser session and sanitizes errors", async () => {
  expect(await logout()).toBeNull();
  expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
  mocks.signOut
    .mockResolvedValueOnce({ error: { message: "INTERNAL_SECRET" } })
    .mockRejectedValueOnce(new Error("INTERNAL_SECRET"));
  expect(await logout()).toBe(AUTH_MESSAGES.logout);
  expect(await logout()).toBe(AUTH_MESSAGES.logout);
});
test("server uses verified getUser, never user metadata", async () => {
  expect(await verifiedEmail()).toBe("reader@example.test");
  mocks.getUser.mockResolvedValue({
    data: {
      user: { email: "spoof@example.test", user_metadata: { admin: true } },
    },
    error: { message: "invalid" },
  });
  expect(await verifiedEmail()).toBeNull();
  mocks.getUser.mockRejectedValue(new Error("INTERNAL_SECRET"));
  expect(await verifiedEmail()).toBeNull();
});
test("server cookie adapter supports all chunks and only writes in route context", async () => {
  await serverSupabase();
  expect(await adapter().getAll!()).toEqual(mocks.getAll.mock.results[0].value);
  const values = [
    { name: "auth.0", value: "part0", options: { path: "/" } },
    { name: "auth.1", value: "part1", options: { path: "/" } },
  ];
  await adapter().setAll!(values, {});
  expect(mocks.set).not.toHaveBeenCalled();
  await serverSupabase(true);
  await adapter().setAll!(values, {});
  expect(mocks.set).toHaveBeenCalledTimes(2);
});
test("proxy refresh preserves request and response cookies, removal and cache headers", async () => {
  mocks.getClaims.mockImplementation(async () => {
    await adapter().setAll!(
      [
        {
          name: "auth.0",
          value: "new",
          options: { path: "/", sameSite: "lax" },
        },
        { name: "auth.1", value: "", options: { path: "/", maxAge: 0 } },
      ],
      {
        "Cache-Control": "private, no-store",
        Expires: "0",
        Pragma: "no-cache",
      },
    );
    return { data: { claims: { sub: "user" } }, error: null };
  });
  const request = new NextRequest("http://localhost/", {
    headers: { cookie: "auth.0=old; auth.1=stale" },
  });
  const response = await refreshSession(request);
  expect(request.cookies.get("auth.0")?.value).toBe("new");
  expect(response.cookies.get("auth.0")?.value).toBe("new");
  expect(response.cookies.get("auth.1")?.maxAge).toBe(0);
  expect(response.headers.get("x-middleware-request-cookie")).toContain(
    "auth.0=new",
  );
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(response.headers.get("expires")).toBe("0");
  expect(mocks.getClaims).toHaveBeenCalledTimes(1);
});
test("proxy outage does not block local tools", async () => {
  mocks.getClaims.mockRejectedValue(new Error("INTERNAL_SECRET"));
  expect(
    (
      await refreshSession(
        new NextRequest("http://localhost/tools/subtitle-converter"),
      )
    ).status,
  ).toBe(200);
});
test("callback exchanges code, verifies user, and permits only safe redirect", async () => {
  const response = await GET(
    new Request(
      "http://localhost/auth/callback?code=synthetic&next=https://evil.test",
    ),
  );
  expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith("synthetic");
  expect(mocks.getUser).toHaveBeenCalled();
  expect(response.headers.get("location")).toBe("/");
  expect(response.headers.get("cache-control")).toContain("no-store");
});
test.each(["?error=INTERNAL_SECRET", "", "?code=synthetic"])(
  "callback failures use fixed error: %s",
  async (query) => {
    mocks.exchangeCodeForSession.mockResolvedValue({
      error: { message: "INTERNAL_SECRET" },
    });
    const response = await GET(
      new Request(`http://localhost/auth/callback${query}`),
    );
    expect(response.headers.get("location")).toBe("/login?error=confirmation");
  },
);
test("callback verifies exchanged user and writes session cookies", async () => {
  mocks.exchangeCodeForSession.mockImplementation(async () => {
    await adapter().setAll!(
      [{ name: "auth", value: "synthetic-session", options: { path: "/" } }],
      {},
    );
    return { error: null };
  });
  const response = await GET(
    new Request(
      "http://localhost/auth/callback?code=synthetic&next=/tools/subtitle-qa",
    ),
  );
  expect(mocks.set).toHaveBeenCalledWith("auth", "synthetic-session", {
    path: "/",
  });
  expect(response.headers.get("location")).toBe("/tools/subtitle-qa");
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
  expect(
    (
      await GET(new Request("http://localhost/auth/callback?code=synthetic"))
    ).headers.get("location"),
  ).toContain("error=confirmation");
});

test("callback forwards validated PKCE flow id and rejects invalid flow before exchange", async () => {
  await GET(
    new Request(
      "http://localhost/auth/callback?code=synthetic&sb_flow_id=valid_flow_123",
    ),
  );
  expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith("synthetic", {
    flowId: "valid_flow_123",
  });
  mocks.exchangeCodeForSession.mockClear();
  const result = await GET(
    new Request("http://localhost/auth/callback?code=synthetic&sb_flow_id=bad"),
  );
  expect(result.headers.get("location")).toBe("/login?error=confirmation");
  expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
});
