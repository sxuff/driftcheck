import type {
  AnalyzeResult,
  Finding,
  OutputFormat,
  RepoMap,
  Severity,
} from "./types.js";

export function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function formatText(
  value: AnalyzeResult | { repoMap: RepoMap },
): string {
  if ("repoMap" in value) return formatRepoMap(value.repoMap);
  return formatFindings(value.findings);
}

export function formatOutput(
  value: AnalyzeResult | { repoMap: RepoMap },
  format: OutputFormat,
): string {
  if (format === "json") return formatJson(value);
  if (format === "github" && !("repoMap" in value)) {
    return formatGithub(value.findings);
  }
  return formatText(value);
}

export function filterFindings(
  findings: Finding[],
  options: { minSeverity?: Severity; quiet?: boolean },
): Finding[] {
  const minSeverity = options.quiet ? "warning" : options.minSeverity;
  if (!minSeverity) return findings;
  return findings.filter(
    (finding) => severityRank(finding.severity) <= severityRank(minSeverity),
  );
}

export function shouldFail(findings: Finding[], failOn: Severity): boolean {
  return findings.some(
    (finding) => severityRank(finding.severity) <= severityRank(failOn),
  );
}

function formatRepoMap(repoMap: RepoMap): string {
  const declarations = repoMap.files.reduce(
    (count, file) => count + file.declarations.length,
    0,
  );
  const imports = repoMap.files.reduce(
    (count, file) => count + file.imports.length,
    0,
  );

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
    ...groupByFile(findings).flatMap(([filePath, fileFindings]) => [
      filePath,
      ...fileFindings.map(formatFinding),
      "",
    ]),
  ].join("\n");
}

function formatFinding(finding: Finding): string {
  const location =
    finding.line === undefined
      ? finding.filePath
      : `${finding.filePath}:${finding.line}`;

  return [
    `  [${finding.severity}] ${finding.code} ${finding.title}`,
    `  ${location}`,
    `  ${finding.message}`,
    `  Suggestion: ${finding.suggestion}`,
    finding.docsUrl ? `  Docs: ${finding.docsUrl}` : undefined,
  ].join("\n");
}

function formatGithub(findings: Finding[]): string {
  if (findings.length === 0) return "";
  return findings.map(formatGithubAnnotation).join("\n");
}

function formatGithubAnnotation(finding: Finding): string {
  const level = finding.severity === "error" ? "error" : "warning";
  const location = [
    `file=${escapeGithubProperty(finding.filePath)}`,
    finding.line === undefined ? undefined : `line=${finding.line}`,
    `title=${escapeGithubProperty(`${finding.code} ${finding.title}`)}`,
  ]
    .filter(Boolean)
    .join(",");
  return `::${level} ${location}::${escapeGithubMessage(`${finding.message} Suggestion: ${finding.suggestion}`)}`;
}

function groupByFile(findings: Finding[]): Array<[string, Finding[]]> {
  const groups = new Map<string, Finding[]>();
  for (const finding of findings) {
    groups.set(finding.filePath, [
      ...(groups.get(finding.filePath) ?? []),
      finding,
    ]);
  }
  return Array.from(groups.entries());
}

function severityRank(severity: Severity): number {
  return { error: 0, warning: 1, info: 2 }[severity];
}

function escapeGithubProperty(value: string): string {
  return value
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A")
    .replaceAll(":", "%3A")
    .replaceAll(",", "%2C");
}

function escapeGithubMessage(value: string): string {
  return value
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
}
