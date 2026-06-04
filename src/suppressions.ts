import { copyFile, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BaselineFile, Finding, RuleCode } from "./types.js";

export async function applySuppressions(options: {
  root: string;
  findings: Finding[];
  baselinePath?: string;
}): Promise<Finding[]> {
  const baseline = await readBaseline(options.root, options.baselinePath);
  const baselineFingerprints = new Set(
    baseline?.findings.map((finding) => finding.fingerprint) ?? [],
  );
  const sourceCache = new Map<string, string[]>();

  const kept: Finding[] = [];
  for (const finding of options.findings) {
    if (baselineFingerprints.has(findingFingerprint(finding))) continue;
    if (
      finding.line !== undefined &&
      (await hasInlineSuppression(options.root, finding, sourceCache))
    ) {
      continue;
    }
    kept.push(finding);
  }
  return kept;
}

export function createBaseline(findings: Finding[]): BaselineFile {
  return {
    version: 1,
    findings: findings.map((finding) => ({
      fingerprint: findingFingerprint(finding),
      code: finding.code,
      filePath: finding.filePath,
      title: finding.title,
    })),
  };
}

export async function writeBaseline(
  root: string,
  relativePath: string,
  findings: Finding[],
): Promise<{ path: string; backup?: string }> {
  const fullPath = path.resolve(root, relativePath);
  let backup: string | undefined;
  if (await exists(fullPath)) {
    backup = `${fullPath}.driftcheck.bak`;
    await copyFile(fullPath, backup);
  }
  await writeFile(
    fullPath,
    `${JSON.stringify(createBaseline(findings), null, 2)}\n`,
  );
  return {
    path: path.relative(root, fullPath).replaceAll("\\", "/"),
    backup: backup
      ? path.relative(root, backup).replaceAll("\\", "/")
      : undefined,
  };
}

export function findingFingerprint(finding: Finding): string {
  return [
    finding.code,
    finding.filePath,
    finding.line ?? "",
    finding.title,
  ].join("|");
}

async function hasInlineSuppression(
  root: string,
  finding: Finding,
  cache: Map<string, string[]>,
): Promise<boolean> {
  let lines = cache.get(finding.filePath);
  if (!lines) {
    try {
      lines = (await readFile(path.join(root, finding.filePath), "utf8")).split(
        /\r?\n/,
      );
    } catch {
      lines = [];
    }
    cache.set(finding.filePath, lines);
  }
  const previousLine = lines[(finding.line ?? 1) - 2] ?? "";
  return suppressionCodes(previousLine).has(finding.code);
}

function suppressionCodes(line: string): Set<RuleCode> {
  const match =
    /^\s*(?:\/\/|#)\s*driftcheck-disable-next-line\s+(.+?)\s*$/.exec(line);
  if (!match) return new Set();
  return new Set(
    match[1]
      .split(/[,\s]+/)
      .filter((code): code is RuleCode => /^DC\d{3}$/.test(code)),
  );
}

async function readBaseline(
  root: string,
  relativePath?: string,
): Promise<BaselineFile | undefined> {
  if (!relativePath) return undefined;
  try {
    return JSON.parse(
      await readFile(path.resolve(root, relativePath), "utf8"),
    ) as BaselineFile;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}
