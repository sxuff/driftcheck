import { writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeChanges } from "../src/driftcheck.js";
import { inferRepoRules } from "../src/inferred-rules.js";
import { findingFingerprint, writeBaseline } from "../src/suppressions.js";
import { makeAgentReadyFixtureRepo } from "./fixtures.js";

describe("rules and suppression", () => {
  it("infers npm and Vitest rules", async () => {
    const root = await makeAgentReadyFixtureRepo();
    const rules = await inferRepoRules(root);
    expect(rules.some((rule) => rule.id === "package-manager:npm")).toBe(true);
    expect(rules.some((rule) => rule.id === "test-framework:vitest")).toBe(
      true,
    );
  });

  it("suppresses the next line with language comment syntax", async () => {
    const root = await makeAgentReadyFixtureRepo();
    await writeFile(
      path.join(root, "src", "other.ts"),
      [
        "// driftcheck-disable-next-line DC001",
        "export function formatDateAgain(value: Date): string {",
        "  return value.toISOString()",
        "}",
      ].join("\n"),
    );

    const result = await analyzeChanges({ cwd: root, mode: "diff" });
    expect(result.findings.some((finding) => finding.code === "DC001")).toBe(
      false,
    );
  });

  it("creates stable finding fingerprints", () => {
    expect(
      findingFingerprint({
        code: "DC001",
        kind: "similar-declaration",
        severity: "warning",
        filePath: "src/example.ts",
        line: 2,
        title: "Example",
        message: "Message",
        suggestion: "Suggestion",
      }),
    ).toBe("DC001|src/example.ts|2|Example");
  });

  it("accepts current findings through a baseline file", async () => {
    const root = await makeAgentReadyFixtureRepo();
    await writeFile(
      path.join(root, "src", "other.ts"),
      "export function formatDateAgain(value: Date): string { return value.toISOString() }\n",
    );
    const current = await analyzeChanges({
      cwd: root,
      mode: "diff",
      suppressions: false,
    });
    expect(current.findings.length).toBeGreaterThan(0);
    await writeBaseline(root, "driftcheck-baseline.json", current.findings);

    expect(
      (await analyzeChanges({ cwd: root, mode: "diff" })).findings,
    ).toEqual([]);
  });
});
