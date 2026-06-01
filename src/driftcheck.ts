import path from "node:path";
import { analyzeSourceFile } from "./analyzers/index.js";
import { isSupportedSourceFile, readTextFile } from "./files.js";
import { getChangedFiles, readHeadFile, repoRoot } from "./git.js";
import { scanRepo } from "./scan.js";
import {
  AnalyzeOptions,
  AnalyzeResult,
  ChangedFile,
  DeclarationInfo,
  FileAnalysis,
  FileConventions,
  Finding,
  ImportInfo,
  RepoMap,
} from "./types.js";

export async function analyzeChanges(
  options: AnalyzeOptions,
): Promise<AnalyzeResult> {
  const root = await repoRoot(options.cwd);
  const [repoMap, changedFiles] = await Promise.all([
    scanRepo(root),
    getChangedFiles(root, options.mode),
  ]);

  const changedAnalyses: Array<{
    changedFile: ChangedFile;
    current: FileAnalysis;
    previous?: FileAnalysis;
  }> = [];

  for (const changedFile of changedFiles) {
    if (!isSupportedSourceFile(changedFile.filePath)) continue;
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
    ...findSimilarDeclarations(repoMap, changedAnalyses),
    ...findNewDependencies(repoMap, changedAnalyses),
    ...findConventionDrift(repoMap, changedAnalyses),
  ];

  return { findings: sortFindings(findings) };
}

function findSimilarDeclarations(
  repoMap: RepoMap,
  changedAnalyses: Array<{
    changedFile: ChangedFile;
    current: FileAnalysis;
    previous?: FileAnalysis;
  }>,
): Finding[] {
  const findings: Finding[] = [];
  for (const { changedFile, current, previous } of changedAnalyses) {
    const previousKeys = new Set(
      previous?.declarations.map((declaration) => declarationKey(declaration)) ?? [],
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

      if (!best || best.score < 0.5) continue;

      findings.push({
        kind: "similar-declaration",
        severity: best.score >= 0.72 ? "warning" : "info",
        filePath: declaration.filePath,
        line: declaration.line,
        title: `New ${declaration.kind} resembles ${best.candidate.name}`,
        message: `${declaration.name} looks semantically similar to ${best.candidate.name} in ${best.candidate.filePath}:${best.candidate.line}. Similarity score: ${best.score.toFixed(2)}.`,
        suggestion:
          "Reuse or extend the existing abstraction if it owns this behavior; otherwise rename or narrow the new code so the distinction is obvious.",
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
): Finding[] {
  const existingExternalImports = new Set(
    repoMap.files
      .flatMap((file) => file.imports)
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
        kind: "new-dependency",
        severity: "warning",
        filePath: importInfo.filePath,
        line: importInfo.line,
        title: `New external dependency: ${name}`,
        message: `${name} is not currently used by tracked source files or listed in a dependency manifest.${overlappingTokens.length > 0 ? ` Local code already uses related terms: ${overlappingTokens.join(", ")}.` : ""}`,
        suggestion:
          "Prefer an existing package or local abstraction when it already covers the job; add the dependency only when it clearly buys enough behavior.",
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
): Finding[] {
  const findings: Finding[] = [];

  for (const { changedFile, current, previous } of changedAnalyses) {
    const nearby = nearbyFiles(repoMap.files, current.filePath);
    if (nearby.length === 0) continue;

    const baseline = majorityConventions(nearby.map((file) => file.conventions));
    const newDeclarationLines = current.declarations
      .filter((declaration) => changedFile.addedLines.has(declaration.line))
      .map((declaration) => declaration.line);
    const line = Math.min(...newDeclarationLines, ...Array.from(changedFile.addedLines));

    compareConvention(
      findings,
      current.filePath,
      Number.isFinite(line) ? line : undefined,
      "quoteStyle",
      "quote style",
      current.conventions.quoteStyle,
      baseline.quoteStyle,
    );
    compareConvention(
      findings,
      current.filePath,
      Number.isFinite(line) ? line : undefined,
      "semicolons",
      "semicolon usage",
      current.conventions.semicolons,
      baseline.semicolons,
    );
    compareConvention(
      findings,
      current.filePath,
      Number.isFinite(line) ? line : undefined,
      "exportStyle",
      "export style",
      current.conventions.exportStyle,
      baseline.exportStyle,
    );
    compareConvention(
      findings,
      current.filePath,
      Number.isFinite(line) ? line : undefined,
      "functionStyle",
      "function style",
      current.conventions.functionStyle,
      baseline.functionStyle,
    );
    compareConvention(
      findings,
      current.filePath,
      Number.isFinite(line) ? line : undefined,
      "errorStyle",
      "error handling",
      current.conventions.errorStyle,
      baseline.errorStyle,
    );

    const previousDeclarationCount = previous?.declarations.length ?? 0;
    if (
      previousDeclarationCount === 0 &&
      current.declarations.length > 0 &&
      nearby.some((file) => isTestFile(file.filePath)) !== isTestFile(current.filePath)
    ) {
      findings.push({
        kind: "convention-drift",
        severity: "info",
        filePath: current.filePath,
        line: Number.isFinite(line) ? line : undefined,
        title: "File placement may not match nearby test/source layout",
        message:
          "Nearby files suggest a different source-vs-test placement pattern for this folder.",
        suggestion:
          "Move the file beside matching source or test files, or keep it here only if this folder intentionally mixes those roles.",
      });
    }
  }

  return findings;
}

function compareConvention<T extends keyof FileConventions>(
  findings: Finding[],
  filePath: string,
  line: number | undefined,
  key: T,
  label: string,
  actual: FileConventions[T],
  expected: FileConventions[T],
): void {
  if (actual === undefined || expected === undefined) return;
  if (actual === expected || actual === "mixed" || expected === "mixed") return;

  findings.push({
    kind: "convention-drift",
    severity: "info",
    filePath,
    line,
    title: `Convention drift: ${label}`,
    message: `This file uses ${String(actual)}, while nearby files mostly use ${String(expected)}.`,
    suggestion: `Match the nearby ${label} unless this file has a deliberate reason to differ.`,
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

function jaccard(left: string[], right: string[]): number {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const intersection = Array.from(leftSet).filter((token) => rightSet.has(token));
  const union = new Set([...leftSet, ...rightSet]);
  return union.size === 0 ? 0 : intersection.length / union.size;
}

function packageName(source: string): string {
  if (source.startsWith("@")) return source.split("/").slice(0, 2).join("/");
  return source.split("/")[0]?.replaceAll("-", "_") ?? source;
}

function tokenizePackageName(name: string): string[] {
  return name
    .replace(/^@/, "")
    .split(/[^a-zA-Z0-9]+/)
    .map((token) => token.toLowerCase())
    .filter((token) => token.length > 2);
}

function isTestFile(filePath: string): boolean {
  return /(\.|\/)(test|spec)\.[cm]?[jt]sx?$/.test(filePath.replaceAll("\\", "/"));
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
