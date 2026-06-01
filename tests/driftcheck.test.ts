import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeChanges } from "../src/driftcheck.js";
import { parseUnifiedDiff } from "../src/git.js";
import { scanRepo } from "../src/scan.js";
import {
  git,
  makeFixtureRepo,
  makePythonFixtureRepo,
  makeRustFixtureRepo,
} from "./fixtures.js";

describe("parseUnifiedDiff", () => {
  it("maps added lines from unified diff hunks", () => {
    const changed = parseUnifiedDiff(
      [
        "diff --git a/src/a.ts b/src/a.ts",
        "+++ b/src/a.ts",
        "@@ -1,0 +2,2 @@",
        "+const a = 1",
        "+const b = 2",
      ].join("\n"),
    );

    expect(changed).toEqual([
      { filePath: "src/a.ts", addedLines: new Set([2, 3]) },
    ]);
  });
});

describe("scanRepo", () => {
  it("builds a lightweight repo map", async () => {
    const root = await makeFixtureRepo();

    const map = await scanRepo(root);

    expect(map.files.map((file) => file.filePath).sort()).toEqual([
      "src/features/user.ts",
      "src/utils/date.ts",
    ]);
    expect(
      map.files.flatMap((file) => file.declarations).map((item) => item.name),
    ).toContain("formatDateForDisplay");
    expect(map.packageDependencies).toHaveProperty("zod");
  });

  it("includes Python declarations and dependencies", async () => {
    const root = await makePythonFixtureRepo();

    const map = await scanRepo(root);

    expect(map.files.map((file) => file.filePath).sort()).toEqual([
      "app/features/users.py",
      "app/utils/dates.py",
    ]);
    expect(
      map.files.flatMap((file) => file.declarations).map((item) => item.name),
    ).toContain("format_date_for_display");
    expect(map.packageDependencies).toHaveProperty("pydantic");
  });

  it("includes Rust declarations and dependencies", async () => {
    const root = await makeRustFixtureRepo();

    const map = await scanRepo(root);

    expect(map.files.map((file) => file.filePath).sort()).toEqual([
      "src/features/users.rs",
      "src/utils/dates.rs",
    ]);
    expect(
      map.files.flatMap((file) => file.declarations).map((item) => item.name),
    ).toContain("format_date_for_display");
    expect(map.packageDependencies).toHaveProperty("serde");
  });
});

describe("analyzeChanges", () => {
  it("flags a new declaration that resembles an existing local abstraction", async () => {
    const root = await makeFixtureRepo();
    await writeFile(
      path.join(root, "src", "features", "invoice.ts"),
      [
        "export function formatDateForInvoice(value: Date): string {",
        "  return value.toISOString().slice(0, 10)",
        "}",
        "",
      ].join("\n"),
    );

    const result = await analyzeChanges({ cwd: root, mode: "diff" });

    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "similar-declaration",
          filePath: "src/features/invoice.ts",
        }),
      ]),
    );
  });

  it("flags new external dependencies in changed files", async () => {
    const root = await makeFixtureRepo();
    await writeFile(
      path.join(root, "src", "features", "slug.ts"),
      [
        "import slugify from 'slugify'",
        "",
        "export const makeSlug = (value: string): string => {",
        "  return slugify(value)",
        "}",
        "",
      ].join("\n"),
    );

    const result = await analyzeChanges({ cwd: root, mode: "diff" });

    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "new-dependency",
          filePath: "src/features/slug.ts",
          line: 1,
        }),
      ]),
    );
  });

  it("does not flag declared dependencies as drift", async () => {
    const root = await makeFixtureRepo();
    await writeFile(
      path.join(root, "src", "features", "schema.ts"),
      [
        "import { z } from 'zod'",
        "",
        "export const userSchema = z.object({ name: z.string() })",
        "",
      ].join("\n"),
    );

    const result = await analyzeChanges({ cwd: root, mode: "diff" });

    expect(
      result.findings.some(
        (finding) =>
          finding.kind === "new-dependency" &&
          finding.filePath === "src/features/schema.ts",
      ),
    ).toBe(false);
  });

  it("does not normalize hyphenated JavaScript package names as Rust crate names", async () => {
    const root = await makeFixtureRepo();
    await writeFile(
      path.join(root, "src", "features", "calendar.ts"),
      [
        "import { format } from 'date-fns'",
        "",
        "export const formatCalendarDate = (value: Date): string => {",
        "  return format(value, 'yyyy-MM-dd')",
        "}",
        "",
      ].join("\n"),
    );

    const result = await analyzeChanges({ cwd: root, mode: "diff" });

    expect(
      result.findings.some(
        (finding) =>
          finding.kind === "new-dependency" &&
          finding.filePath === "src/features/calendar.ts",
      ),
    ).toBe(false);
  });

  it("flags undeclared dependencies added to tracked files", async () => {
    const root = await makeFixtureRepo();
    await writeFile(
      path.join(root, "src", "features", "user.ts"),
      [
        "import slugify from 'slugify'",
        "",
        "export const normalizeUserName = (name: string): string => {",
        "  return slugify(name.trim().toLowerCase())",
        "}",
        "",
      ].join("\n"),
    );

    const result = await analyzeChanges({ cwd: root, mode: "diff" });

    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "new-dependency",
          filePath: "src/features/user.ts",
          line: 1,
        }),
      ]),
    );
  });

  it("learns nearby conventions and flags drift", async () => {
    const root = await makeFixtureRepo();
    await writeFile(
      path.join(root, "src", "features", "display.ts"),
      [
        "export function DisplayName(name: string): string {",
        '  return "Name: " + name;',
        "}",
        "",
      ].join("\n"),
    );

    const result = await analyzeChanges({ cwd: root, mode: "diff" });

    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "convention-drift",
          filePath: "src/features/display.ts",
          title: expect.stringContaining("function style"),
        }),
      ]),
    );
  });

  it("analyzes staged changes separately from the working tree", async () => {
    const root = await makeFixtureRepo();
    await mkdir(path.join(root, "src", "new"), { recursive: true });
    await writeFile(
      path.join(root, "src", "new", "date.ts"),
      [
        "export function formatDateForReport(value: Date): string {",
        "  return value.toISOString().slice(0, 10)",
        "}",
        "",
      ].join("\n"),
    );
    await git(root, ["add", "src/new/date.ts"]);

    const result = await analyzeChanges({ cwd: root, mode: "staged" });

    expect(
      result.findings.some((finding) => finding.kind === "similar-declaration"),
    ).toBe(true);
  });

  it("flags similar Python declarations", async () => {
    const root = await makePythonFixtureRepo();
    await writeFile(
      path.join(root, "app", "features", "invoice.py"),
      [
        "def format_date_for_invoice(value):",
        "    return value.isoformat()[:10]",
        "",
      ].join("\n"),
    );

    const result = await analyzeChanges({ cwd: root, mode: "diff" });

    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "similar-declaration",
          filePath: "app/features/invoice.py",
        }),
      ]),
    );
  });

  it("flags new Python external dependencies", async () => {
    const root = await makePythonFixtureRepo();
    await writeFile(
      path.join(root, "app", "features", "http_client.py"),
      [
        "import requests",
        "",
        "def fetch_user(url):",
        "    return requests.get(url).json()",
        "",
      ].join("\n"),
    );

    const result = await analyzeChanges({ cwd: root, mode: "diff" });

    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "new-dependency",
          filePath: "app/features/http_client.py",
          line: 1,
        }),
      ]),
    );
  });

  it("flags similar Rust declarations", async () => {
    const root = await makeRustFixtureRepo();
    await writeFile(
      path.join(root, "src", "features", "invoice.rs"),
      [
        "pub fn format_date_for_invoice(value: &str) -> String {",
        "    value.to_string()",
        "}",
        "",
      ].join("\n"),
    );

    const result = await analyzeChanges({ cwd: root, mode: "diff" });

    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "similar-declaration",
          filePath: "src/features/invoice.rs",
        }),
      ]),
    );
  });

  it("flags new Rust external dependencies", async () => {
    const root = await makeRustFixtureRepo();
    await writeFile(
      path.join(root, "src", "features", "ids.rs"),
      [
        "use uuid::Uuid;",
        "",
        "pub fn make_id() -> String {",
        "    Uuid::new_v4().to_string()",
        "}",
        "",
      ].join("\n"),
    );

    const result = await analyzeChanges({ cwd: root, mode: "diff" });

    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "new-dependency",
          filePath: "src/features/ids.rs",
          line: 1,
        }),
      ]),
    );
  });
});
