import { describe, expect, it } from "vitest";
import { analyzeSourceFile } from "../src/analyzers/index.js";

describe("analyzers", () => {
  it.each([
    {
      filePath: "src/example.ts",
      source:
        "export function formatDate(value: Date) { return value.toISOString(); }",
      language: "typescript",
      declaration: "formatDate",
    },
    {
      filePath: "src/example.js",
      source:
        "export function formatDate(value) { return value.toISOString(); }",
      language: "javascript",
      declaration: "formatDate",
    },
    {
      filePath: "src/example.py",
      source: "def format_date(value):\n    return value.isoformat()\n",
      language: "python",
      declaration: "format_date",
    },
    {
      filePath: "src/example.rs",
      source: "pub fn format_date(value: &str) -> String { value.to_string() }",
      language: "rust",
      declaration: "format_date",
    },
  ] as const)("analyzes $language source files", (example) => {
    const analysis = analyzeSourceFile(example.filePath, example.source);

    expect(analysis?.language).toBe(example.language);
    expect(analysis?.declarations.map(({ name }) => name)).toContain(
      example.declaration,
    );
  });

  it("ignores unsupported files", () => {
    expect(analyzeSourceFile("README.md", "# driftcheck")).toBeUndefined();
  });
});
