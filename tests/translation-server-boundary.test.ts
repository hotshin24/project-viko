import { execFile } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  cp,
  readFile,
  writeFile,
  symlink,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";

const execute = promisify(execFile);

test("Next production compiler rejects the adapter in a Client Component", async () => {
  const root = resolve(".");
  const fixture = await mkdtemp(join(tmpdir(), "viko-server-boundary-"));
  try {
    await mkdir(join(fixture, "app"));
    await mkdir(join(fixture, "src/lib"), { recursive: true });
    await cp(
      join(root, "src/lib/translation"),
      join(fixture, "src/lib/translation"),
      {
        recursive: true,
        filter: (path) => !path.split("/").at(-1)?.startsWith("._"),
      },
    );
    await symlink(
      join(root, "node_modules"),
      join(fixture, "node_modules"),
      "dir",
    );
    await writeFile(
      join(fixture, "package.json"),
      await readFile(join(root, "package.json")),
    );
    await writeFile(
      join(fixture, "app/layout.js"),
      "export default function Layout({children}) { return <html><body>{children}</body></html>; }",
    );
    await writeFile(
      join(fixture, "app/page.js"),
      '"use client";\nimport {createOpenAITranslationProvider} from "../src/lib/translation/providers/openai";\nexport default function Page() { return <p>{String(createOpenAITranslationProvider)}</p>; }',
    );
    // No keys, .env files or actual API calls. Build only a disposable negative fixture.
    const result = await execute(
      process.execPath,
      [join(root, "node_modules/next/dist/bin/next"), "build", "--webpack"],
      {
        cwd: fixture,
        timeout: 60_000,
        maxBuffer: 2_000_000,
        env: {
          NODE_ENV: "production",
          PATH: process.env.PATH,
          HOME: fixture,
          NEXT_TELEMETRY_DISABLED: "1",
        },
      },
    ).then(
      () => ({ failed: false, output: "" }),
      (error: unknown) => {
        const failure = error as {
          code?: number;
          stdout?: string;
          stderr?: string;
        };
        return {
          failed: failure.code === 1,
          output: `${failure.stdout}\n${failure.stderr}`,
        };
      },
    );
    expect(result.failed).toBe(true);
    expect(result.output).toContain("server-only");
    expect(result.output).toContain("only available in Server Components");
    expect(result.output).toContain("./app/page.js");
  } finally {
    // Only the directory created by this test; never the shared repository or modules target.
    await rm(fixture, { recursive: true, force: true });
  }
}, 75_000);
