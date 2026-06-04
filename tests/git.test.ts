import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseUnifiedDiff, repoRoot } from "../src/git.js";

describe("git", () => {
  it("maps added lines from unified diff hunks", () => {
    expect(
      parseUnifiedDiff(
        [
          "diff --git a/src/a.ts b/src/a.ts",
          "+++ b/src/a.ts",
          "@@ -1,0 +2,2 @@",
          "+const a = 1",
          "+const b = 2",
        ].join("\n"),
      ),
    ).toEqual([{ filePath: "src/a.ts", addedLines: new Set([2, 3]) }]);
  });

  it("explains when driftcheck runs outside a git repository", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "driftcheck-no-git-"));

    await expect(repoRoot(directory)).rejects.toThrow(
      "driftcheck must run inside a Git repository",
    );
  });
});
