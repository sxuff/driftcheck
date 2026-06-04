import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig, shouldIgnorePath } from "../src/config.js";
import { initializeConfig } from "../src/init.js";
import { makeFixtureRepo } from "./fixtures.js";

describe("config", () => {
  it("loads repository config", async () => {
    const root = await makeFixtureRepo();
    await writeFile(
      path.join(root, "driftcheck.config.json"),
      JSON.stringify({ ignorePaths: ["generated/**"] }),
    );

    expect((await loadConfig({ cwd: root })).ignorePaths).toEqual([
      "generated/**",
    ]);
  });

  it("matches ignored paths", () => {
    expect(shouldIgnorePath("generated/client.ts", ["generated/**"])).toBe(
      true,
    );
    expect(shouldIgnorePath("src/client.ts", ["generated/**"])).toBe(false);
  });

  it("scaffolds config without overwriting it", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "driftcheck-init-"));

    expect(await initializeConfig(root)).toEqual({
      generated: "driftcheck.config.json",
    });
    expect(await initializeConfig(root)).toEqual({
      skipped: "driftcheck.config.json already exists",
    });
  });
});
