// Disposable production app + local HTTP auth double. No real Supabase project or credentials.
import { createServer } from "node:http";
import { mkdtemp, mkdir, cp, symlink, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
const configured = process.argv[2] === "configured";
const port = configured ? 3117 : 3116;
const root = resolve(".");
const fixture = await mkdtemp(join(tmpdir(), "viko-auth-e2e-"));
let app;
let stopping = false;
const user = {
  id: "00000000-0000-4000-8000-000000000001",
  aud: "authenticated",
  role: "authenticated",
  email: "reader@example.test",
  email_confirmed_at: "2026-01-01T00:00:00Z",
  created_at: "2026-01-01T00:00:00Z",
  app_metadata: { provider: "email" },
  user_metadata: {},
};
const encode = (value) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
function session() {
  const now = Math.floor(Date.now() / 1000);
  return {
    access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: user.id, aud: "authenticated", role: "authenticated", email: user.email, iat: now, exp: now + 3600 })}.synthetic-signature`,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: now + 3600,
    refresh_token: "synthetic-refresh-token",
    user,
  };
}
const mock = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", `http://127.0.0.1:${port}`);
  res.setHeader(
    "Access-Control-Allow-Headers",
    "authorization, apikey, content-type, x-client-info, x-supabase-api-version",
  );
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Content-Type", "application/json");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  const url = new URL(req.url, "http://127.0.0.1:4319");
  let body = "";
  for await (const chunk of req) body += chunk;
  const data = body ? JSON.parse(body) : {};
  if (url.pathname === "/auth/v1/token") {
    if (data.email === "denied@example.test") {
      res.writeHead(400);
      res.end(
        JSON.stringify({
          code: "invalid_credentials",
          msg: "INTERNAL_AUTH_RESPONSE",
        }),
      );
    } else res.end(JSON.stringify(session()));
  } else if (url.pathname === "/auth/v1/signup")
    res.end(JSON.stringify({ user, session: null }));
  else if (url.pathname === "/auth/v1/user") res.end(JSON.stringify(user));
  else if (url.pathname === "/auth/v1/logout") {
    res.writeHead(204);
    res.end();
  } else {
    res.writeHead(404);
    res.end("{}");
  }
});
async function stop() {
  if (stopping) return;
  stopping = true;
  if (app && app.exitCode === null) {
    app.kill("SIGTERM");
    await new Promise((resolve) => app.once("exit", resolve));
  }
  mock.closeAllConnections();
  mock.close();
  await rm(fixture, { recursive: true, force: true });
}
process.on("SIGTERM", () => void stop().then(() => process.exit(0)));
process.on("SIGINT", () => void stop().then(() => process.exit(0)));
try {
  if (configured)
    await new Promise((resolve) => mock.listen(4319, "127.0.0.1", resolve));
  for (const name of [
    "src",
    "public",
    "package.json",
    "tsconfig.json",
    "next-env.d.ts",
    "next.config.ts",
    "postcss.config.mjs",
  ]) {
    try {
      await access(join(root, name));
    } catch {
      continue;
    }
    await cp(join(root, name), join(fixture, name), {
      recursive: true,
      filter: (path) => !path.split("/").at(-1).startsWith("._"),
    });
  }
  await mkdir(join(fixture, ".next"), { recursive: true });
  await symlink(
    join(root, "node_modules"),
    join(fixture, "node_modules"),
    "dir",
  );
  const env = {
    PATH: process.env.PATH,
    HOME: fixture,
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    TRANSLATION_API_ENABLED: "",
    OPENAI_API_KEY: "",
    OPENAI_TRANSLATION_MODEL: "",
    NEXT_PUBLIC_SUPABASE_URL: configured ? "http://127.0.0.1:4319" : "",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: configured
      ? "sb_publishable_e2e_fixture"
      : "",
  };
  const next = join(root, "node_modules/next/dist/bin/next");
  const build = spawn(process.execPath, [next, "build", "--webpack"], {
    cwd: fixture,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  build.stdout.on("data", (chunk) => (output += chunk));
  build.stderr.on("data", (chunk) => (output += chunk));
  const code = await new Promise((resolve) => build.once("exit", resolve));
  if (code !== 0) throw new Error(`Disposable test build failed:\n${output}`);
  app = spawn(
    process.execPath,
    [next, "start", "--hostname", "127.0.0.1", "--port", String(port)],
    { cwd: fixture, env, stdio: "ignore" },
  );
  app.once("exit", () => {
    if (!stopping) void stop().then(() => process.exit(1));
  });
} catch (error) {
  console.error(error);
  await stop();
  process.exit(1);
}
