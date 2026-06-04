import { stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { scanRepo } from "../src/scan.js";
import { git, makeFixtureRepo } from "./fixtures.js";

describe("scan cache", () => {
  it("caches by HEAD and invalidates after a commit", async () => {
    const root = await makeFixtureRepo();

    await scanRepo(root);
    await expect(
      stat(path.join(root, ".git", "driftcheck-scan-cache.json")),
    ).resolves.toBeDefined();

    await writeFile(
      path.join(root, "src", "new.ts"),
      "export const newValue = true\n",
    );
    await git(root, ["add", "src/new.ts"]);
    await git(root, ["commit", "-m", "add new file"]);

    expect((await scanRepo(root)).files.map((file) => file.filePath)).toContain(
      "src/new.ts",
    );
  });
});
