import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initializeAgents, renderAgentsMarkdown } from "../src/agents.js";
import { formatBrief } from "../src/brief.js";
import { loadConfig } from "../src/config.js";
import { analyzeChanges } from "../src/driftcheck.js";
import { parseUnifiedDiff } from "../src/git.js";
import { inferRepoRules } from "../src/inferred-rules.js";
import { filterFindings, formatOutput, shouldFail } from "../src/reporters.js";
import { scanRepo } from "../src/scan.js";
import {
  git,
  makeAgentReadyFixtureRepo,
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

describe("agent-ready rule inference", () => {
  it("detects package manager, test framework, and dependency preferences", async () => {
    const root = await makeAgentReadyFixtureRepo();

    const rules = await inferRepoRules(root);

    expect(rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "package-manager",
          title: "Package manager: npm",
          confidence: "high",
        }),
        expect.objectContaining({
          kind: "test-framework",
          title: "Test framework: Vitest",
        }),
        expect.objectContaining({
          kind: "dependency-preference",
          title: "Preferred dates dependency: dayjs",
        }),
        expect.objectContaining({
          kind: "common-utility",
          title: "Existing date utility: src/utils/date.ts",
        }),
      ]),
    );
    expect(rules.every((rule) => rule.evidence.length > 0)).toBe(true);
  });

  it("generates AGENTS.md and machine-readable inferred rules safely", async () => {
    const root = await makeAgentReadyFixtureRepo();
    await writeFile(path.join(root, "AGENTS.md"), "# Existing instructions\n");

    const result = await initializeAgents({ cwd: root });
    const agents = await readFile(path.join(root, "AGENTS.md"), "utf8");
    const generatedConfig = JSON.parse(
      await readFile(path.join(root, "driftcheck.config.json"), "utf8"),
    ) as { inferredRules: Array<{ confidence: string }> };

    expect(result.generated).toContain("AGENTS.md");
    expect(result.generated).toContain("driftcheck.config.json");
    expect(result.backups).toContain("AGENTS.md.driftcheck.bak");
    expect(agents).toContain("Use npm");
    expect(agents).toContain("Use Vitest");
    expect(generatedConfig.inferredRules.length).toBeGreaterThan(0);
    expect(
      generatedConfig.inferredRules.every((rule) => rule.confidence !== "low"),
    ).toBe(true);
  });

  it("generates Cursor rules and safely appends to an existing CLAUDE.md", async () => {
    const root = await makeAgentReadyFixtureRepo();
    await mkdir(path.join(root, ".cursor"), { recursive: true });
    await writeFile(path.join(root, "CLAUDE.md"), "# Existing Claude rules\n");

    const result = await initializeAgents({ cwd: root });
    const claude = await readFile(path.join(root, "CLAUDE.md"), "utf8");
    const cursor = await readFile(
      path.join(root, ".cursor", "rules", "driftcheck.mdc"),
      "utf8",
    );

    expect(result.generated).toContain(".cursor/rules/driftcheck.mdc");
    expect(result.generated).toContain("CLAUDE.md");
    expect(result.backups).toContain("CLAUDE.md.driftcheck.bak");
    expect(claude).toContain("<!-- driftcheck:start -->");
    expect(cursor).toContain("Repository conventions inferred by driftcheck");
  });

  it("detects conservative architecture boundaries and generated files", async () => {
    const root = await makeAgentReadyFixtureRepo();
    await mkdir(path.join(root, "src", "client"), { recursive: true });
    await mkdir(path.join(root, "src", "server"), { recursive: true });
    await mkdir(path.join(root, "generated"), { recursive: true });
    await writeFile(
      path.join(root, "src", "client", "view.ts"),
      "export const view = 'client'\n",
    );
    await writeFile(
      path.join(root, "src", "server", "db.ts"),
      "export const db = 'server'\n",
    );
    await writeFile(
      path.join(root, "generated", "client.generated.ts"),
      "export const generated = true\n",
    );
    await git(root, ["add", "."]);
    await git(root, ["commit", "-m", "add boundaries"]);

    const rules = await inferRepoRules(root);

    expect(rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "architecture-boundary" }),
        expect.objectContaining({ kind: "generated-files" }),
      ]),
    );
  });

  it("renders a compact repair brief", () => {
    const brief = formatBrief([
      finding("DC005", "warning", "Reuse src/utils/date.ts."),
      finding("DC001", "info", "Consider the similar helper."),
      finding("DC006", "warning", "Match Vitest style."),
    ]);

    expect(brief).toContain("violates 2 repo conventions");
    expect(brief).toContain("1. Reuse src/utils/date.ts.");
    expect(brief).not.toContain("similar helper");
    expect(brief).toContain("Fix the diff while keeping behavior unchanged.");
  });

  it("renders practical AGENTS.md content", async () => {
    const root = await makeAgentReadyFixtureRepo();
    const markdown = renderAgentsMarkdown(await inferRepoRules(root));

    expect(markdown).toContain("# AGENTS.md");
    expect(markdown).toContain("## Package manager");
    expect(markdown).toContain("## Testing");
    expect(markdown).toContain("npx driftcheck diff");
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

describe("configuration", () => {
  it("loads driftcheck.config.json from the repo root", async () => {
    const root = await makeFixtureRepo();
    await writeFile(
      path.join(root, "driftcheck.config.json"),
      JSON.stringify({
        ignorePaths: ["src/features/**"],
        languages: ["typescript"],
        rules: {
          DC001: { threshold: 0.9 },
          DC003: { enabled: false },
        },
      }),
    );

    const config = await loadConfig({ cwd: root });

    expect(config.ignorePaths).toEqual(["src/features/**"]);
    expect(config.languages).toEqual(["typescript"]);
    expect(config.rules.DC001.threshold).toBe(0.9);
    expect(config.rules.DC003.enabled).toBe(false);
  });

  it("supports --no-config behavior through loadConfig", async () => {
    const root = await makeFixtureRepo();
    await writeFile(
      path.join(root, "driftcheck.config.json"),
      JSON.stringify({ languages: ["python"] }),
    );

    const config = await loadConfig({ cwd: root, noConfig: true });

    expect(config.languages).toContain("typescript");
    expect(config.languages).toContain("python");
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
          code: "DC001",
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
          code: "DC002",
          kind: "new-dependency",
          filePath: "src/features/slug.ts",
          line: 1,
        }),
      ]),
    );
  });

  it("honors config ignorePaths and disabled rules", async () => {
    const root = await makeFixtureRepo();
    await writeFile(
      path.join(root, "src", "features", "invoice.ts"),
      [
        "import slugify from 'slugify'",
        "",
        "export function formatDateForInvoice(value: Date): string {",
        "  return slugify(value.toISOString().slice(0, 10))",
        "}",
        "",
      ].join("\n"),
    );

    const result = await analyzeChanges({
      cwd: root,
      mode: "diff",
      config: {
        ignorePaths: ["src/features/**"],
        languages: ["typescript"],
        rules: {
          DC001: { enabled: true, threshold: 0.5 },
          DC002: { enabled: true },
          DC003: { enabled: true },
          DC004: { enabled: true },
          DC005: { enabled: true },
          DC006: { enabled: true },
          DC007: { enabled: true },
        },
        inferredRules: [],
      },
    });

    expect(result.findings).toEqual([]);
  });

  it("honors config severity overrides and thresholds", async () => {
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

    const result = await analyzeChanges({
      cwd: root,
      mode: "diff",
      config: {
        ignorePaths: [],
        languages: ["typescript"],
        rules: {
          DC001: { enabled: true, threshold: 0.1, severity: "error" },
          DC002: { enabled: true },
          DC003: { enabled: false },
          DC004: { enabled: true },
          DC005: { enabled: true },
          DC006: { enabled: true },
          DC007: { enabled: true },
        },
        inferredRules: [],
      },
    });

    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "DC001", severity: "error" }),
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
          code: "DC003",
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
          code: "DC002",
          kind: "new-dependency",
          filePath: "src/features/ids.rs",
          line: 1,
        }),
      ]),
    );
  });

  it("enforces inferred Vitest style against new Jest-style tests", async () => {
    const root = await makeAgentReadyFixtureRepo();
    await initializeAgents({ cwd: root });
    await writeFile(
      path.join(root, "tests", "new.test.ts"),
      [
        "describe('new behavior', () => {",
        "  it('works', () => {",
        "    const fn = jest.fn()",
        "    expect(fn).not.toHaveBeenCalled()",
        "  })",
        "})",
        "",
      ].join("\n"),
    );

    const result = await analyzeChanges({ cwd: root, mode: "diff" });

    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "DC006",
          filePath: "tests/new.test.ts",
        }),
      ]),
    );
  });

  it("enforces inferred dependency preferences in manifests", async () => {
    const root = await makeAgentReadyFixtureRepo();
    await initializeAgents({ cwd: root });
    const packageJson = JSON.parse(
      await readFile(path.join(root, "package.json"), "utf8"),
    ) as { dependencies: Record<string, string> };
    packageJson.dependencies["date-fns"] = "^4.1.0";
    await writeFile(
      path.join(root, "package.json"),
      `${JSON.stringify(packageJson, null, 2)}\n`,
    );

    const result = await analyzeChanges({ cwd: root, mode: "diff" });

    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "DC004", filePath: "package.json" }),
      ]),
    );
  });

  it("enforces inferred shared utility ownership", async () => {
    const root = await makeAgentReadyFixtureRepo();
    await initializeAgents({ cwd: root });
    await mkdir(path.join(root, "src", "features"), { recursive: true });
    await writeFile(
      path.join(root, "src", "features", "calendar.ts"),
      [
        "export function formatCalendarDate(value: Date): string {",
        "  return value.toISOString().slice(0, 10)",
        "}",
        "",
      ].join("\n"),
    );

    const result = await analyzeChanges({ cwd: root, mode: "diff" });

    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "DC005",
          filePath: "src/features/calendar.ts",
        }),
      ]),
    );
  });

  it("enforces inferred architecture and generated-file rules", async () => {
    const root = await makeAgentReadyFixtureRepo();
    await mkdir(path.join(root, "src", "client"), { recursive: true });
    await mkdir(path.join(root, "src", "server"), { recursive: true });
    await mkdir(path.join(root, "generated"), { recursive: true });
    await writeFile(
      path.join(root, "src", "client", "view.ts"),
      "export const view = 'client'\n",
    );
    await writeFile(
      path.join(root, "src", "server", "db.ts"),
      "export const db = 'server'\n",
    );
    await writeFile(
      path.join(root, "generated", "client.generated.ts"),
      "export const generated = true\n",
    );
    await git(root, ["add", "."]);
    await git(root, ["commit", "-m", "add boundaries"]);
    await initializeAgents({ cwd: root });

    await writeFile(
      path.join(root, "src", "client", "view.ts"),
      "import { db } from '../server/db.js'\nexport const view = db\n",
    );
    await writeFile(
      path.join(root, "generated", "client.generated.ts"),
      "export const generated = false\n",
    );

    const result = await analyzeChanges({ cwd: root, mode: "diff" });

    expect(
      result.findings.filter((finding) => finding.code === "DC007").length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("warns when a lockfile changes without its dependency manifest", async () => {
    const root = await makeAgentReadyFixtureRepo();
    await initializeAgents({ cwd: root });
    await writeFile(path.join(root, "package-lock.json"), '{"changed":true}\n');

    const result = await analyzeChanges({ cwd: root, mode: "diff" });

    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "DC007",
          filePath: "package-lock.json",
          title: "Lockfile changed without a dependency manifest change",
        }),
      ]),
    );
  });
});

describe("reporters", () => {
  it("filters findings by severity and quiet mode", () => {
    const findings = [
      finding("DC001", "info"),
      finding("DC002", "warning"),
      finding("DC003", "error"),
    ];

    expect(filterFindings(findings, { minSeverity: "warning" })).toHaveLength(
      2,
    );
    expect(filterFindings(findings, { quiet: true })).toHaveLength(2);
  });

  it("formats text, json, and GitHub annotations", () => {
    const findings = [finding("DC002", "warning")];

    expect(formatOutput({ findings }, "text")).toContain("DC002");
    expect(formatOutput({ findings }, "json")).toContain('"code": "DC002"');
    expect(formatOutput({ findings }, "github")).toContain("::warning");
  });

  it("checks configurable fail thresholds", () => {
    const findings = [finding("DC002", "warning")];

    expect(shouldFail(findings, "error")).toBe(false);
    expect(shouldFail(findings, "warning")).toBe(true);
  });
});

function finding(
  code: "DC001" | "DC002" | "DC003" | "DC004" | "DC005" | "DC006" | "DC007",
  severity: "info" | "warning" | "error",
  suggestion = "Example suggestion",
) {
  return {
    code,
    kind:
      code === "DC001"
        ? "similar-declaration"
        : code === "DC002"
          ? "new-dependency"
          : code === "DC003"
            ? "convention-drift"
            : "inferred-rule-drift",
    severity,
    filePath: "src/example.ts",
    line: 1,
    title: "Example",
    message: "Example message",
    suggestion,
  } as const;
}
