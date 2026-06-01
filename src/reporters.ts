import { AnalyzeResult, Finding, RepoMap } from "./types.js";

export function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function formatText(value: AnalyzeResult | { repoMap: RepoMap }): string {
  if ("repoMap" in value) return formatRepoMap(value.repoMap);
  return formatFindings(value.findings);
}

function formatRepoMap(repoMap: RepoMap): string {
  const declarations = repoMap.files.reduce(
    (count, file) => count + file.declarations.length,
    0,
  );
  const imports = repoMap.files.reduce((count, file) => count + file.imports.length, 0);

  return [
    "driftcheck scan",
    "",
    `Root: ${repoMap.root}`,
    `Source files: ${repoMap.files.length}`,
    `Declarations: ${declarations}`,
    `Imports: ${imports}`,
    `Package dependencies: ${Object.keys(repoMap.packageDependencies).length}`,
  ].join("\n");
}

function formatFindings(findings: Finding[]): string {
  if (findings.length === 0) {
    return "driftcheck found no drift in the changed supported source files.";
  }

  return [
    `driftcheck found ${findings.length} finding${findings.length === 1 ? "" : "s"}:`,
    "",
    ...findings.map(formatFinding),
  ].join("\n");
}

function formatFinding(finding: Finding): string {
  const location =
    finding.line === undefined
      ? finding.filePath
      : `${finding.filePath}:${finding.line}`;

  return [
    `[${finding.severity}] ${finding.title}`,
    `  ${location}`,
    `  ${finding.message}`,
    `  Suggestion: ${finding.suggestion}`,
  ].join("\n");
}
