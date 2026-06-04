import path from "node:path";
import { analyzeSourceFile } from "./analyzers/index.js";
import { loadConfig, ruleDocs, shouldIgnorePath } from "./config.js";
import {
  isSupportedSourceFile,
  readTextFile,
  sourceLanguage,
} from "./files.js";
import { getChangedFiles, readHeadFile, repoRoot } from "./git.js";
import { scanRepo } from "./scan.js";
import type {
  AnalyzeOptions,
  AnalyzeResult,
  ChangedFile,
  DeclarationInfo,
  FileAnalysis,
  FileConventions,
  Finding,
  RepoMap,
} from "./types.js";

export async function analyzeChanges(
  options: AnalyzeOptions,
): Promise<AnalyzeResult> {
  const root = await repoRoot(options.cwd);
  const config =
    options.config ??
    (await loadConfig({
      cwd: root,
      configPath: options.configPath,
      noConfig: options.noConfig,
    }));
  const [repoMap, changedFiles] = await Promise.all([
    scanRepo(root, config),
    getChangedFiles(root, options.mode),
  ]);

  const changedAnalyses: Array<{
    changedFile: ChangedFile;
    current: FileAnalysis;
    previous?: FileAnalysis;
  }> = [];

  for (const changedFile of changedFiles) {
    if (!isSupportedSourceFile(changedFile.filePath)) continue;
    if (shouldIgnorePath(changedFile.filePath, config.ignorePaths)) continue;
    const language = sourceLanguage(changedFile.filePath);
    if (!language || !config.languages.includes(language)) continue;
    const currentText = await readTextFile(root, changedFile.filePath);
    if (currentText === undefined) continue;
    const current = analyzeSourceFile(changedFile.filePath, currentText);
    if (!current) continue;

    const previousText = await readHeadFile(root, changedFile.filePath);
    changedAnalyses.push({
      changedFile,
      current,
      previous: previousText
        ? analyzeSourceFile(changedFile.filePath, previousText)
        : undefined,
    });
  }

  const findings = [
    ...findSimilarDeclarations(repoMap, changedAnalyses, config),
    ...findNewDependencies(repoMap, changedAnalyses, config),
    ...findConventionDrift(repoMap, changedAnalyses, config),
    ...(await findInferredRuleDrift(
      root,
      changedFiles,
      changedAnalyses,
      config,
    )),
  ];

  return { findings: dedupeFindings(sortFindings(findings)) };
}

function findSimilarDeclarations(
  repoMap: RepoMap,
  changedAnalyses: Array<{
    changedFile: ChangedFile;
    current: FileAnalysis;
    previous?: FileAnalysis;
  }>,
  config: NonNullable<AnalyzeOptions["config"]>,
): Finding[] {
  const rule = config.rules.DC001;
  if (rule.enabled === false) return [];
  const threshold = rule.threshold ?? 0.5;
  const findings: Finding[] = [];
  for (const { changedFile, current, previous } of changedAnalyses) {
    const previousKeys = new Set(
      previous?.declarations.map((declaration) =>
        declarationKey(declaration),
      ) ?? [],
    );
    const existingDeclarations = repoMap.files
      .filter((file) => file.filePath !== changedFile.filePath)
      .flatMap((file) => file.declarations);
    const newDeclarations = current.declarations.filter(
      (declaration) =>
        changedFile.addedLines.has(declaration.line) &&
        !previousKeys.has(declarationKey(declaration)),
    );

    for (const declaration of newDeclarations) {
      const best = existingDeclarations
        .filter((candidate) => candidate.filePath !== declaration.filePath)
        .map((candidate) => ({
          candidate,
          score: jaccard(declaration.tokens, candidate.tokens),
        }))
        .sort((a, b) => b.score - a.score)[0];

      if (!best || best.score < threshold) continue;
      if (isSameHelperName(declaration.name, best.candidate.name)) continue;

      findings.push({
        code: "DC001",
        kind: "similar-declaration",
        severity: rule.severity ?? (best.score >= 0.72 ? "warning" : "info"),
        filePath: declaration.filePath,
        line: declaration.line,
        title: `New ${declaration.kind} resembles ${best.candidate.name}`,
        message: `${declaration.name} looks semantically similar to ${best.candidate.name} in ${best.candidate.filePath}:${best.candidate.line}. Similarity score: ${best.score.toFixed(2)}.`,
        suggestion:
          "Check whether the existing abstraction already owns this behavior. Reuse it, extend it, or rename the new code so the distinction is obvious.",
        docsUrl: ruleDocs.DC001,
      });
    }
  }

  return findings;
}

function findNewDependencies(
  repoMap: RepoMap,
  changedAnalyses: Array<{
    changedFile: ChangedFile;
    current: FileAnalysis;
    previous?: FileAnalysis;
  }>,
  config: NonNullable<AnalyzeOptions["config"]>,
): Finding[] {
  const rule = config.rules.DC002;
  if (rule.enabled === false) return [];
  const changedFilePaths = new Set(
    changedAnalyses.map(({ changedFile }) => changedFile.filePath),
  );
  const existingExternalImports = new Set(
    [
      ...repoMap.files
        .filter((file) => !changedFilePaths.has(file.filePath))
        .flatMap((file) => file.imports),
      ...changedAnalyses.flatMap(({ previous }) => previous?.imports ?? []),
    ]
      .filter((importInfo) => importInfo.isExternal)
      .map((importInfo) => packageName(importInfo.source)),
  );
  const packageDependencies = new Set(Object.keys(repoMap.packageDependencies));
  const localDeclarationTokens = repoMap.files
    .flatMap((file) => file.declarations)
    .flatMap((declaration) => declaration.tokens);
  const findings: Finding[] = [];

  for (const { changedFile, current, previous } of changedAnalyses) {
    const previousImports = new Set(
      previous?.imports.map((importInfo) => importInfo.source) ?? [],
    );
    const newImports = current.imports.filter(
      (importInfo) =>
        importInfo.isExternal &&
        changedFile.addedLines.has(importInfo.line) &&
        !previousImports.has(importInfo.source),
    );

    for (const importInfo of newImports) {
      const name = packageName(importInfo.source);
      if (existingExternalImports.has(name)) continue;

      const installed = packageDependencies.has(name);
      if (installed) continue;

      const overlappingTokens = tokenizePackageName(name).filter((token) =>
        localDeclarationTokens.includes(token),
      );

      findings.push({
        code: "DC002",
        kind: "new-dependency",
        severity: rule.severity ?? "warning",
        filePath: importInfo.filePath,
        line: importInfo.line,
        title: `New external dependency: ${name}`,
        message: `${name} is not currently used by tracked source files or listed in a dependency manifest.${overlappingTokens.length > 0 ? ` Local code already uses related terms: ${overlappingTokens.join(", ")}.` : ""}`,
        suggestion:
          "Use an existing dependency or local abstraction if it already covers the job; otherwise add the package to the manifest with a clear reason.",
        docsUrl: ruleDocs.DC002,
      });
    }
  }

  return findings;
}

function findConventionDrift(
  repoMap: RepoMap,
  changedAnalyses: Array<{
    changedFile: ChangedFile;
    current: FileAnalysis;
    previous?: FileAnalysis;
  }>,
  config: NonNullable<AnalyzeOptions["config"]>,
): Finding[] {
  const rule = config.rules.DC003;
  if (rule.enabled === false) return [];
  const findings: Finding[] = [];

  for (const { changedFile, current, previous } of changedAnalyses) {
    const nearby = nearbyFiles(repoMap.files, current.filePath);
    if (nearby.length === 0) continue;

    const baseline = majorityConventions(
      nearby.map((file) => file.conventions),
    );
    const newDeclarationLines = current.declarations
      .filter((declaration) => changedFile.addedLines.has(declaration.line))
      .map((declaration) => declaration.line);
    const line = Math.min(
      ...newDeclarationLines,
      ...Array.from(changedFile.addedLines),
    );

    compareConvention(
      findings,
      current.filePath,
      Number.isFinite(line) ? line : undefined,
      "quoteStyle",
      "quote style",
      current.conventions.quoteStyle,
      baseline.quoteStyle,
      rule.severity ?? "info",
    );
    compareConvention(
      findings,
      current.filePath,
      Number.isFinite(line) ? line : undefined,
      "semicolons",
      "semicolon usage",
      current.conventions.semicolons,
      baseline.semicolons,
      rule.severity ?? "info",
    );
    compareConvention(
      findings,
      current.filePath,
      Number.isFinite(line) ? line : undefined,
      "exportStyle",
      "export style",
      current.conventions.exportStyle,
      baseline.exportStyle,
      rule.severity ?? "info",
    );
    compareConvention(
      findings,
      current.filePath,
      Number.isFinite(line) ? line : undefined,
      "functionStyle",
      "function style",
      current.conventions.functionStyle,
      baseline.functionStyle,
      rule.severity ?? "info",
    );
    compareConvention(
      findings,
      current.filePath,
      Number.isFinite(line) ? line : undefined,
      "errorStyle",
      "error handling",
      current.conventions.errorStyle,
      baseline.errorStyle,
      rule.severity ?? "info",
    );

    const previousDeclarationCount = previous?.declarations.length ?? 0;
    if (
      previousDeclarationCount === 0 &&
      current.declarations.length > 0 &&
      nearby.some((file) => isTestFile(file.filePath)) !==
        isTestFile(current.filePath)
    ) {
      findings.push({
        code: "DC003",
        kind: "convention-drift",
        severity: rule.severity ?? "info",
        filePath: current.filePath,
        line: Number.isFinite(line) ? line : undefined,
        title: "File placement may not match nearby test/source layout",
        message:
          "Nearby files suggest a different source-vs-test placement pattern for this folder.",
        suggestion:
          "Move the file beside matching source or test files, or keep it here only if this folder intentionally mixes those roles.",
        docsUrl: ruleDocs.DC003,
      });
    }
  }

  return findings;
}

function compareConvention<T extends keyof FileConventions>(
  findings: Finding[],
  filePath: string,
  line: number | undefined,
  _key: T,
  label: string,
  actual: FileConventions[T],
  expected: FileConventions[T],
  severity: Finding["severity"],
): void {
  if (actual === undefined || expected === undefined) return;
  if (actual === expected || actual === "mixed" || expected === "mixed") return;

  findings.push({
    code: "DC003",
    kind: "convention-drift",
    severity,
    filePath,
    line,
    title: `Convention drift: ${label}`,
    message: `This file uses ${String(actual)}, while nearby files mostly use ${String(expected)}.`,
    suggestion: `Match the nearby ${label} unless this file has a deliberate reason to differ.`,
    docsUrl: ruleDocs.DC003,
  });
}

function majorityConventions(conventions: FileConventions[]): FileConventions {
  return {
    quoteStyle: majority(conventions.map((item) => item.quoteStyle)),
    semicolons: majority(conventions.map((item) => item.semicolons)),
    exportStyle: majority(conventions.map((item) => item.exportStyle)),
    functionStyle: majority(conventions.map((item) => item.functionStyle)),
    errorStyle: majority(conventions.map((item) => item.errorStyle)),
  };
}

function majority<T>(values: Array<T | undefined>): T | undefined {
  const counts = new Map<T, number>();
  for (const value of values) {
    if (value === undefined || value === "mixed") continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
}

function nearbyFiles(files: FileAnalysis[], filePath: string): FileAnalysis[] {
  const dir = path.posix.dirname(filePath.replaceAll("\\", "/"));
  const parent = path.posix.dirname(dir);

  return files.filter((file) => {
    if (file.filePath === filePath) return false;
    const fileDir = path.posix.dirname(file.filePath.replaceAll("\\", "/"));
    return fileDir === dir || fileDir === parent;
  });
}

function declarationKey(declaration: DeclarationInfo): string {
  return `${declaration.kind}:${declaration.name}:${declaration.line}`;
}

function isSameHelperName(left: string, right: string): boolean {
  return normalizeName(left) === normalizeName(right);
}

function normalizeName(name: string): string {
  return name
    .replace(/^impl_/, "")
    .replace(/_/g, "")
    .replace(/([a-z])([A-Z])/g, "$1$2")
    .toLowerCase();
}

function jaccard(left: string[], right: string[]): number {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const intersection = Array.from(leftSet).filter((token) =>
    rightSet.has(token),
  );
  const union = new Set([...leftSet, ...rightSet]);
  return union.size === 0 ? 0 : intersection.length / union.size;
}

function packageName(source: string): string {
  if (source.startsWith("@")) return source.split("/").slice(0, 2).join("/");
  return source.split("/")[0] ?? source;
}

function tokenizePackageName(name: string): string[] {
  return name
    .replace(/^@/, "")
    .split(/[^a-zA-Z0-9]+/)
    .map((token) => token.toLowerCase())
    .filter((token) => token.length > 2);
}

function isTestFile(filePath: string): boolean {
  return /(\.|\/)(test|spec)\.[cm]?[jt]sx?$/.test(
    filePath.replaceAll("\\", "/"),
  );
}

function sortFindings(findings: Finding[]): Finding[] {
  const severityRank = { error: 0, warning: 1, info: 2 };
  return [...findings].sort(
    (a, b) =>
      severityRank[a.severity] - severityRank[b.severity] ||
      a.filePath.localeCompare(b.filePath) ||
      (a.line ?? 0) - (b.line ?? 0),
  );
}

function dedupeFindings(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = [
      finding.code,
      finding.filePath,
      finding.line ?? "",
      finding.title,
      finding.message,
    ].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function findInferredRuleDrift(
  root: string,
  changedFiles: ChangedFile[],
  changedAnalyses: Array<{
    changedFile: ChangedFile;
    current: FileAnalysis;
    previous?: FileAnalysis;
  }>,
  config: NonNullable<AnalyzeOptions["config"]>,
): Promise<Finding[]> {
  const findings: Finding[] = [];

  for (const rule of config.inferredRules) {
    if (rule.confidence === "low") continue;
    if (
      rule.kind === "test-framework" &&
      config.rules.DC006.enabled !== false
    ) {
      findings.push(
        ...(await checkTestFrameworkRule(root, changedFiles, rule, config)),
      );
    }
    if (
      rule.kind === "dependency-preference" &&
      config.rules.DC004.enabled !== false
    ) {
      findings.push(
        ...(await checkDependencyPreferenceRule(
          root,
          changedFiles,
          changedAnalyses,
          rule,
          config,
        )),
      );
    }
    if (
      rule.kind === "common-utility" &&
      config.rules.DC005.enabled !== false
    ) {
      findings.push(...checkCommonUtilityRule(changedAnalyses, rule, config));
    }
    if (
      rule.kind === "architecture-boundary" &&
      config.rules.DC007.enabled !== false
    ) {
      findings.push(...checkArchitectureRule(changedAnalyses, rule, config));
    }
    if (
      rule.kind === "generated-files" &&
      config.rules.DC007.enabled !== false
    ) {
      findings.push(...checkGeneratedFilesRule(changedFiles, rule, config));
    }
    if (
      rule.kind === "package-manager" &&
      config.rules.DC007.enabled !== false
    ) {
      findings.push(...checkPackageManagerRule(changedFiles, rule, config));
    }
  }
  return findings;
}

async function checkTestFrameworkRule(
  root: string,
  changedFiles: ChangedFile[],
  rule: NonNullable<AnalyzeOptions["config"]>["inferredRules"][number],
  config: NonNullable<AnalyzeOptions["config"]>,
): Promise<Finding[]> {
  const framework = String(rule.data?.framework ?? "");
  const forbidden =
    framework === "vitest"
      ? [/\bjest\./, /from\s+["']@?jest/, /require\(["']@?jest/]
      : framework === "jest"
        ? [/from\s+["']vitest["']/]
        : [];
  if (forbidden.length === 0) return [];

  const findings: Finding[] = [];
  for (const changedFile of changedFiles.filter((item) =>
    isTestFile(item.filePath),
  )) {
    const current = await readTextFile(root, changedFile.filePath);
    if (!current || !forbidden.some((pattern) => pattern.test(current)))
      continue;
    findings.push(
      inferredFinding(
        "DC006",
        config,
        changedFile.filePath,
        Math.min(...changedFile.addedLines),
        `Test style conflicts with ${rule.title}`,
        `This changed test uses a different framework style, but driftcheck inferred ${framework} from ${evidenceSummary(rule)}.`,
        `Rewrite the test using ${framework} conventions while preserving behavior.`,
      ),
    );
  }
  return findings;
}

async function checkDependencyPreferenceRule(
  root: string,
  changedFiles: ChangedFile[],
  changedAnalyses: Array<{ current: FileAnalysis }>,
  rule: NonNullable<AnalyzeOptions["config"]>["inferredRules"][number],
  config: NonNullable<AnalyzeOptions["config"]>,
): Promise<Finding[]> {
  const preferred = String(rule.data?.preferred ?? "");
  const alternatives = arrayData(rule.data?.alternatives);
  const findings: Finding[] = [];

  for (const alternative of alternatives) {
    const imported = changedAnalyses.find(({ current }) =>
      current.imports.some((item) => packageName(item.source) === alternative),
    );
    if (imported) {
      const importInfo = imported.current.imports.find(
        (item) => packageName(item.source) === alternative,
      );
      findings.push(
        inferredFinding(
          "DC004",
          config,
          imported.current.filePath,
          importInfo?.line,
          `New ${String(rule.data?.category)} dependency conflicts with ${preferred}`,
          `${alternative} is introduced, but ${preferred} is the established choice. Evidence: ${evidenceSummary(rule)}.`,
          `Use ${preferred} instead of adding ${alternative}, unless the repository intentionally changes its dependency preference.`,
        ),
      );
    }

    for (const changedFile of changedFiles.filter((item) =>
      /(?:^|\/)(package\.json|pyproject\.toml|Cargo\.toml|requirements\.txt)$/.test(
        item.filePath,
      ),
    )) {
      const [current, previous] = await Promise.all([
        readTextFile(root, changedFile.filePath),
        readHeadFile(root, changedFile.filePath),
      ]);
      if (!current?.includes(alternative) || previous?.includes(alternative))
        continue;
      findings.push(
        inferredFinding(
          "DC004",
          config,
          changedFile.filePath,
          Math.min(...changedFile.addedLines),
          `New ${String(rule.data?.category)} dependency conflicts with ${preferred}`,
          `${alternative} was added to a dependency manifest, but ${preferred} is the established choice. Evidence: ${evidenceSummary(rule)}.`,
          `Keep ${preferred}, or document why the repository now needs both ${preferred} and ${alternative}.`,
        ),
      );
    }
  }
  return findings;
}

function checkCommonUtilityRule(
  changedAnalyses: Array<{
    changedFile: ChangedFile;
    current: FileAnalysis;
    previous?: FileAnalysis;
  }>,
  rule: NonNullable<AnalyzeOptions["config"]>["inferredRules"][number],
  config: NonNullable<AnalyzeOptions["config"]>,
): Finding[] {
  const ownerPath = String(rule.data?.path ?? "");
  const keywords = arrayData(rule.data?.keywords);
  const findings: Finding[] = [];

  for (const { changedFile, current, previous } of changedAnalyses) {
    if (current.filePath === ownerPath) continue;
    const previousNames = new Set(
      previous?.declarations.map((item) => item.name) ?? [],
    );
    for (const declaration of current.declarations) {
      if (
        !changedFile.addedLines.has(declaration.line) ||
        previousNames.has(declaration.name)
      ) {
        continue;
      }
      const haystack = `${declaration.name} ${declaration.text}`.toLowerCase();
      if (!keywords.some((keyword) => haystack.includes(keyword))) continue;
      findings.push(
        inferredFinding(
          "DC005",
          config,
          current.filePath,
          declaration.line,
          `Existing utility may already own this concern`,
          `${ownerPath} appears to own ${String(rule.data?.concern)} utilities. Evidence: ${evidenceSummary(rule)}.`,
          `Check and reuse ${ownerPath} before adding ${declaration.name} here.`,
        ),
      );
    }
  }
  return findings;
}

function checkArchitectureRule(
  changedAnalyses: Array<{ current: FileAnalysis }>,
  rule: NonNullable<AnalyzeOptions["config"]>["inferredRules"][number],
  config: NonNullable<AnalyzeOptions["config"]>,
): Finding[] {
  const from = String(rule.data?.from ?? "");
  const forbidden = String(rule.data?.forbidden ?? "");
  const findings: Finding[] = [];
  for (const { current } of changedAnalyses.filter(({ current }) =>
    current.filePath.startsWith(`${from}/`),
  )) {
    for (const importInfo of current.imports.filter((item) =>
      resolvesInto(current.filePath, item.source, forbidden),
    )) {
      findings.push(
        inferredFinding(
          "DC007",
          config,
          current.filePath,
          importInfo.line,
          `Import crosses inferred architecture boundary`,
          `${from} should not import ${forbidden}. Evidence: ${evidenceSummary(rule)}.`,
          `Move shared behavior behind a neutral module or keep this import within ${forbidden}.`,
        ),
      );
    }
  }
  return findings;
}

function checkGeneratedFilesRule(
  changedFiles: ChangedFile[],
  rule: NonNullable<AnalyzeOptions["config"]>["inferredRules"][number],
  config: NonNullable<AnalyzeOptions["config"]>,
): Finding[] {
  const patterns = arrayData(rule.data?.patterns);
  return changedFiles
    .filter((changedFile) =>
      patterns.some((pattern) => changedFile.filePath.includes(pattern)),
    )
    .map((changedFile) =>
      inferredFinding(
        "DC007",
        config,
        changedFile.filePath,
        Math.min(...changedFile.addedLines),
        "Changed file appears to be generated output",
        `This path matches generated output already detected in the repository. Evidence: ${evidenceSummary(rule)}.`,
        "Update the source or generator instead of editing generated output directly.",
      ),
    );
}

function checkPackageManagerRule(
  changedFiles: ChangedFile[],
  rule: NonNullable<AnalyzeOptions["config"]>["inferredRules"][number],
  config: NonNullable<AnalyzeOptions["config"]>,
): Finding[] {
  const manager = String(rule.data?.manager ?? "");
  const lockfiles: Record<string, string> = {
    npm: "package-lock.json",
    pnpm: "pnpm-lock.yaml",
    yarn: "yarn.lock",
    bun: "bun.lock",
  };
  const expected = lockfiles[manager];
  if (!expected) return [];
  const findings = changedFiles
    .filter(
      (changedFile) =>
        Object.values(lockfiles).includes(changedFile.filePath) &&
        changedFile.filePath !== expected,
    )
    .map((changedFile) =>
      inferredFinding(
        "DC007",
        config,
        changedFile.filePath,
        Math.min(...changedFile.addedLines),
        `New lockfile conflicts with inferred package manager ${manager}`,
        `The repository appears to use ${manager}. Evidence: ${evidenceSummary(rule)}.`,
        `Remove ${changedFile.filePath} and use ${manager} unless the repository intentionally changes package managers.`,
      ),
    );
  const expectedLockChanged = changedFiles.find(
    (changedFile) => changedFile.filePath === expected,
  );
  const manifestChanged = changedFiles.some((changedFile) =>
    /(?:^|\/)(package\.json|pyproject\.toml|Cargo\.toml|requirements\.txt)$/.test(
      changedFile.filePath,
    ),
  );
  if (expectedLockChanged && !manifestChanged) {
    findings.push(
      inferredFinding(
        "DC007",
        config,
        expected,
        Math.min(...expectedLockChanged.addedLines),
        "Lockfile changed without a dependency manifest change",
        `${expected} changed, but no dependency manifest changed. Evidence: ${evidenceSummary(rule)}.`,
        "Revert the lockfile-only change unless it was intentionally regenerated.",
      ),
    );
  }
  return findings;
}

function inferredFinding(
  code: "DC004" | "DC005" | "DC006" | "DC007",
  config: NonNullable<AnalyzeOptions["config"]>,
  filePath: string,
  line: number | undefined,
  title: string,
  message: string,
  suggestion: string,
): Finding {
  return {
    code,
    kind: "inferred-rule-drift",
    severity: config.rules[code].severity ?? "warning",
    filePath,
    line: Number.isFinite(line) ? line : undefined,
    title,
    message,
    suggestion,
    docsUrl: ruleDocs[code],
  };
}

function evidenceSummary(
  rule: NonNullable<AnalyzeOptions["config"]>["inferredRules"][number],
): string {
  return rule.evidence.map((item) => item.path).join(", ");
}

function arrayData(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function resolvesInto(
  importer: string,
  source: string,
  forbidden: string,
): boolean {
  if (!source.startsWith(".")) return source.startsWith(forbidden);
  const resolved = path.posix.normalize(
    path.posix.join(path.posix.dirname(importer.replaceAll("\\", "/")), source),
  );
  return resolved.startsWith(forbidden);
}
