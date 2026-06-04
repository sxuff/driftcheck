import type { Finding } from "./types.js";

export function formatBrief(findings: Finding[]): string {
  const specificFindings = suppressShadowedFindings(findings);
  if (specificFindings.length === 0) {
    return "The current diff does not violate any detected repo conventions.";
  }

  const actions = Array.from(
    new Set(
      specificFindings.map((finding) =>
        normalizeSuggestion(finding.suggestion),
      ),
    ),
  );

  return [
    `The current diff violates ${actions.length} repo convention${actions.length === 1 ? "" : "s"}:`,
    ...actions.map((action, index) => `${index + 1}. ${action}`),
    "",
    "Fix the diff while keeping behavior unchanged.",
  ].join("\n");
}

function suppressShadowedFindings(findings: Finding[]): Finding[] {
  const inferredFiles = new Set(
    findings
      .filter((finding) => finding.kind === "inferred-rule-drift")
      .map((finding) => finding.filePath),
  );
  return findings.filter(
    (finding) =>
      !(
        inferredFiles.has(finding.filePath) &&
        (finding.code === "DC001" || finding.code === "DC002")
      ),
  );
}

function normalizeSuggestion(suggestion: string): string {
  const trimmed = suggestion.trim();
  return trimmed.endsWith(".") ? trimmed : `${trimmed}.`;
}
