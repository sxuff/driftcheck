import { readFile } from "node:fs/promises";
import path from "node:path";
import { listTrackedFiles, repoRoot } from "./git.js";
import { scanRepo } from "./scan.js";
import type {
  DriftcheckConfig,
  InferredRule,
  RepoMap,
  RuleConfidence,
  RuleEvidence,
} from "./types.js";

const dependencyCategories: Record<string, string[]> = {
  dates: ["dayjs", "date-fns", "luxon", "moment"],
  http: ["axios", "ky", "got"],
  validation: ["zod", "yup", "valibot", "pydantic"],
  testing: ["vitest", "jest", "pytest"],
  logging: ["pino", "winston", "structlog"],
};

const utilityKeywords: Record<string, string[]> = {
  date: ["date", "format", "time"],
  http: ["api", "http", "fetch", "client"],
  error: ["error", "exception"],
};

const boundaryPairs: Array<[string, string]> = [
  ["src/client", "src/server"],
  ["src/frontend", "src/backend"],
  ["app/client", "app/server"],
  ["src/components", "src/server"],
  ["src/components", "src/lib/server"],
];

export async function inferRepoRules(
  cwd: string,
  config?: DriftcheckConfig,
): Promise<InferredRule[]> {
  const root = await repoRoot(cwd);
  const [trackedFiles, repoMap, packageJson] = await Promise.all([
    listTrackedFiles(root),
    scanRepo(root, config),
    readJson(path.join(root, "package.json")),
  ]);

  const packageManagerRules = inferPackageManager(trackedFiles);
  return sortRules([
    ...packageManagerRules,
    ...inferTestFramework(repoMap, trackedFiles, packageJson),
    ...inferDependencyPreferences(repoMap, trackedFiles),
    ...inferCommonUtilities(repoMap),
    ...inferArchitectureBoundaries(trackedFiles),
    ...inferGeneratedFiles(trackedFiles),
    ...inferCommands(packageJson, packageManagerRules),
  ]);
}

export function enforceableRules(rules: InferredRule[]): InferredRule[] {
  return rules.filter(
    (rule) => rule.confidence === "high" || rule.confidence === "medium",
  );
}

function inferPackageManager(files: string[]): InferredRule[] {
  const managers: Array<[string, string]> = [
    ["package-lock.json", "npm"],
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lockb", "bun"],
    ["bun.lock", "bun"],
  ];

  const detected = managers
    .filter(([lockfile]) => files.includes(lockfile))
    .map(([lockfile, manager]) =>
      rule({
        id: `package-manager:${manager}`,
        kind: "package-manager",
        title: `Package manager: ${manager}`,
        description: `Use ${manager}; do not switch package managers unless repository configuration changes.`,
        confidence: "high",
        severity: "warning",
        evidence: [{ path: lockfile, reason: `${lockfile} is tracked` }],
        data: { manager },
      }),
    );
  return detected.length > 1
    ? detected.map((item) => ({
        ...item,
        confidence: "low",
        description: `${item.description} Multiple package-manager lockfiles were detected, so this rule is not enforced by default.`,
      }))
    : detected;
}

function inferTestFramework(
  repoMap: RepoMap,
  files: string[],
  packageJson: JsonObject | undefined,
): InferredRule[] {
  const dependencies = packageJsonDependencies(packageJson);
  const allDependencies = new Set([
    ...dependencies,
    ...Object.keys(repoMap.packageDependencies),
  ]);
  const candidates: Array<{
    framework: string;
    dependency?: string;
    filePattern?: RegExp;
    language: string;
  }> = [
    {
      framework: "Vitest",
      dependency: "vitest",
      filePattern: /\bfrom\s+["']vitest["']/,
      language: "JavaScript/TypeScript",
    },
    {
      framework: "Jest",
      dependency: "jest",
      filePattern: /\bfrom\s+["']@?jest/,
      language: "JavaScript/TypeScript",
    },
    {
      framework: "pytest",
      dependency: "pytest",
      filePattern: /\bimport\s+pytest\b/,
      language: "Python",
    },
  ];
  const rules: InferredRule[] = [];

  for (const candidate of candidates) {
    const evidence: RuleEvidence[] = [];
    if (candidate.dependency && allDependencies.has(candidate.dependency)) {
      evidence.push({
        path:
          packageJson && dependencies.has(candidate.dependency)
            ? "package.json"
            : "pyproject.toml",
        reason: `${candidate.dependency} is declared`,
      });
    }
    if (candidate.filePattern) {
      for (const file of repoMap.files) {
        if (
          candidate.filePattern.test(
            file.declarations.map((item) => item.text).join("\n"),
          ) ||
          file.imports.some((item) =>
            item.source.includes(candidate.dependency ?? ""),
          )
        ) {
          evidence.push({
            path: file.filePath,
            reason: `uses ${candidate.framework}`,
          });
          break;
        }
      }
    }
    if (evidence.length === 0) continue;
    rules.push(
      rule({
        id: `test-framework:${candidate.framework.toLowerCase()}`,
        kind: "test-framework",
        title: `Test framework: ${candidate.framework}`,
        description: `Use ${candidate.framework} style for ${candidate.language} tests.`,
        confidence: evidence.length > 1 ? "high" : "medium",
        severity: "warning",
        evidence,
        data: { framework: candidate.framework.toLowerCase() },
      }),
    );
  }

  if (
    files.some((file) => file === "Cargo.toml") &&
    files.some((file) => file.endsWith(".rs") && /(?:^|\/)tests?\//.test(file))
  ) {
    rules.push(
      rule({
        id: "test-framework:cargo-test",
        kind: "test-framework",
        title: "Test framework: cargo test",
        description: "Use Rust's cargo test conventions for Rust tests.",
        confidence: "medium",
        severity: "warning",
        evidence: [
          {
            path: "Cargo.toml",
            reason: "Rust project with tracked test files",
          },
        ],
        data: { framework: "cargo-test" },
      }),
    );
  }

  return rules.length > 1
    ? rules.map((item) => ({
        ...item,
        confidence: "low",
        description: `${item.description} Multiple test frameworks were detected, so this rule is not enforced by default.`,
      }))
    : rules;
}

function inferDependencyPreferences(
  repoMap: RepoMap,
  files: string[],
): InferredRule[] {
  const dependencies = new Set(Object.keys(repoMap.packageDependencies));
  const manifest = dependencyManifest(files);
  const rules: InferredRule[] = [];

  for (const [category, choices] of Object.entries(dependencyCategories)) {
    const present = choices.filter(
      (choice) =>
        dependencies.has(choice) ||
        dependencies.has(choice.replaceAll("-", "_")),
    );
    if (present.length !== 1) continue;
    const preferred = present[0];
    rules.push(
      rule({
        id: `dependency-preference:${category}:${preferred}`,
        kind: "dependency-preference",
        title: `Preferred ${category} dependency: ${preferred}`,
        description: `Prefer ${preferred} for ${category}; avoid adding a second library for the same concern.`,
        confidence: "high",
        severity: "warning",
        evidence: [{ path: manifest, reason: `${preferred} is declared` }],
        data: {
          category,
          preferred,
          alternatives: choices.filter((item) => item !== preferred),
        },
      }),
    );
  }
  return rules;
}

function inferCommonUtilities(repoMap: RepoMap): InferredRule[] {
  const utilityPath =
    /^(?:src\/(?:utils|lib|common|shared)|app\/lib|lib|packages\/[^/]+\/src\/utils)\//;
  const rules: InferredRule[] = [];

  for (const file of repoMap.files.filter((item) =>
    utilityPath.test(item.filePath),
  )) {
    const haystack =
      `${file.filePath} ${file.declarations.map((item) => item.name).join(" ")}`.toLowerCase();
    for (const [concern, keywords] of Object.entries(utilityKeywords)) {
      if (!keywords.some((keyword) => haystack.includes(keyword))) continue;
      rules.push(
        rule({
          id: `common-utility:${concern}:${file.filePath}`,
          kind: "common-utility",
          title: `Existing ${concern} utility: ${file.filePath}`,
          description: `Prefer ${file.filePath} before creating another ${concern} helper.`,
          confidence: file.declarations.length > 0 ? "medium" : "low",
          severity: "warning",
          evidence: [
            {
              path: file.filePath,
              reason:
                file.declarations.length > 0
                  ? `exports ${file.declarations
                      .map((item) => item.name)
                      .slice(0, 4)
                      .join(", ")}`
                  : "matches a shared utility path",
            },
          ],
          data: { concern, path: file.filePath, keywords },
        }),
      );
    }
  }
  return uniqueRules(rules);
}

function inferArchitectureBoundaries(files: string[]): InferredRule[] {
  return boundaryPairs
    .filter(
      ([from, forbidden]) =>
        files.some((file) => file.startsWith(`${from}/`)) &&
        files.some((file) => file.startsWith(`${forbidden}/`)),
    )
    .map(([from, forbidden]) =>
      rule({
        id: `architecture-boundary:${from}:${forbidden}`,
        kind: "architecture-boundary",
        title: `Boundary: ${from} must not import ${forbidden}`,
        description: `Keep browser/client-facing code in ${from} separate from ${forbidden}.`,
        confidence: "medium",
        severity: "warning",
        evidence: [
          { path: from, reason: "folder exists" },
          { path: forbidden, reason: "folder exists" },
        ],
        data: { from, forbidden },
      }),
    );
}

function inferGeneratedFiles(files: string[]): InferredRule[] {
  const patterns = [
    "dist/",
    "build/",
    "coverage/",
    "generated/",
    ".generated.",
  ];
  const evidence = files
    .filter((file) => patterns.some((pattern) => file.includes(pattern)))
    .slice(0, 5)
    .map((file) => ({ path: file, reason: "looks generated" }));
  if (evidence.length === 0) return [];
  return [
    rule({
      id: "generated-files:detected",
      kind: "generated-files",
      title: "Generated files detected",
      description:
        "Avoid editing generated output directly; update its source or generator.",
      confidence: "medium",
      severity: "warning",
      evidence,
      data: { patterns },
    }),
  ];
}

function inferCommands(
  packageJson: JsonObject | undefined,
  packageManagerRules: InferredRule[],
): InferredRule[] {
  const scripts = packageJson?.scripts;
  if (!scripts || typeof scripts !== "object" || Array.isArray(scripts))
    return [];
  const scriptMap = scripts as Record<string, unknown>;
  const preferred = ["test", "typecheck", "lint", "check"].filter(
    (name) => typeof scriptMap[name] === "string",
  );
  const manager =
    packageManagerRules.find((item) => item.confidence !== "low")?.data
      ?.manager ?? "npm";
  return preferred.map((name) =>
    rule({
      id: `command:${manager}-${name}`,
      kind: "command",
      title: `Validation command: ${scriptCommand(String(manager), name)}`,
      description: `Run ${scriptCommand(String(manager), name)} before finishing relevant changes.`,
      confidence: "high",
      severity: "info",
      evidence: [{ path: "package.json", reason: `defines scripts.${name}` }],
      data: { command: scriptCommand(String(manager), name) },
    }),
  );
}

function scriptCommand(manager: string, script: string): string {
  if (manager === "npm") return `npm run ${script}`;
  if (manager === "bun") return `bun run ${script}`;
  return `${manager} ${script}`;
}

function rule(input: InferredRule): InferredRule {
  return input;
}

function sortRules(rules: InferredRule[]): InferredRule[] {
  const rank: Record<RuleConfidence, number> = { high: 0, medium: 1, low: 2 };
  return uniqueRules(rules).sort(
    (a, b) =>
      rank[a.confidence] - rank[b.confidence] || a.title.localeCompare(b.title),
  );
}

function uniqueRules(rules: InferredRule[]): InferredRule[] {
  return Array.from(new Map(rules.map((item) => [item.id, item])).values());
}

function dependencyManifest(files: string[]): string {
  if (files.includes("package.json")) return "package.json";
  if (files.includes("pyproject.toml")) return "pyproject.toml";
  if (files.includes("Cargo.toml")) return "Cargo.toml";
  return "dependency manifest";
}

function packageJsonDependencies(
  packageJson: JsonObject | undefined,
): Set<string> {
  const names: string[] = [];
  for (const key of ["dependencies", "devDependencies", "peerDependencies"]) {
    const value = packageJson?.[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      names.push(...Object.keys(value));
    }
  }
  return new Set(names);
}

async function readJson(filePath: string): Promise<JsonObject | undefined> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as JsonObject;
  } catch {
    return undefined;
  }
}

type JsonObject = Record<string, unknown>;
