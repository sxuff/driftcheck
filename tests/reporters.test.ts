import { describe, expect, it } from "vitest";
import { formatOutput, formatSarif } from "../src/reporters.js";
import type { Finding } from "../src/types.js";

const finding: Finding = {
  code: "DC001",
  kind: "similar-declaration",
  severity: "warning",
  filePath: "src/example.ts",
  line: 3,
  title: "Similar declaration",
  message: "This looks similar.",
  suggestion: "Reuse the existing declaration.",
};

describe("reporters", () => {
  it("emits SARIF 2.1.0", () => {
    const sarif = formatSarif([finding]) as {
      version: string;
      runs: Array<{ results: Array<{ ruleId: string }> }>;
    };
    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs[0].results[0].ruleId).toBe("DC001");
  });

  it("supports SARIF through formatOutput", () => {
    expect(formatOutput({ findings: [finding] }, "sarif")).toContain(
      '"version": "2.1.0"',
    );
  });
});
