import { readFile } from "node:fs/promises";
import path from "node:path";
import { analyzeSourceFile } from "./analyzers/index.js";
import { loadConfig, shouldIgnorePath } from "./config.js";
import {
  isSupportedSourceFile,
  readTextFile,
  sourceLanguage,
} from "./files.js";
import { listTrackedFiles, repoRoot } from "./git.js";
import type { DriftcheckConfig, FileAnalysis, RepoMap } from "./types.js";

export async function scanRepo(
  cwd: string,
  config?: DriftcheckConfig,
): Promise<RepoMap> {
  const root = await repoRoot(cwd);
  const resolvedConfig = config ?? (await loadConfig({ cwd: root }));
  const trackedFiles = await listTrackedFiles(root);
  const files: FileAnalysis[] = [];

  for (const filePath of trackedFiles) {
    if (!isSupportedSourceFile(filePath)) continue;
    if (shouldIgnorePath(filePath, resolvedConfig.ignorePaths)) continue;
    const language = sourceLanguage(filePath);
    if (!language || !resolvedConfig.languages.includes(language)) continue;
    if (filePath.includes("node_modules/") || filePath.includes("dist/"))
      continue;

    const text = await readTextFile(root, filePath);
    if (text === undefined) continue;
    const analysis = analyzeSourceFile(filePath, text);
    if (analysis) files.push(analysis);
  }

  return {
    root,
    files,
    packageDependencies: await readPackageDependencies(root),
  };
}

export async function readPackageDependencies(
  root: string,
): Promise<Record<string, string>> {
  try {
    const packageJson = JSON.parse(
      await readFile(path.join(root, "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };

    const manifestDependencies = await readOtherManifestDependencies(root);
    return {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
      ...packageJson.peerDependencies,
      ...packageJson.optionalDependencies,
      ...manifestDependencies,
    };
  } catch {
    return readOtherManifestDependencies(root);
  }
}

async function readOtherManifestDependencies(
  root: string,
): Promise<Record<string, string>> {
  return {
    ...(await readPythonDependencies(root)),
    ...(await readCargoDependencies(root)),
  };
}

async function readPythonDependencies(
  root: string,
): Promise<Record<string, string>> {
  return {
    ...(await readRequirements(root)),
    ...(await readPyproject(root)),
  };
}

async function readRequirements(root: string): Promise<Record<string, string>> {
  try {
    const text = await readFile(path.join(root, "requirements.txt"), "utf8");
    const dependencies: Record<string, string> = {};

    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("-"))
        continue;
      const match = /^([A-Za-z0-9_.-]+)\s*([<>=!~].*)?$/.exec(trimmed);
      if (match)
        dependencies[normalizePythonPackageName(match[1])] = match[2] ?? "*";
    }

    return dependencies;
  } catch {
    return {};
  }
}

async function readPyproject(root: string): Promise<Record<string, string>> {
  try {
    const text = await readFile(path.join(root, "pyproject.toml"), "utf8");
    const dependencies: Record<string, string> = {};
    const dependencyArrays =
      text.match(/dependencies\s*=\s*\[(?:.|\r|\n)*?\]/g) ?? [];

    for (const arrayText of dependencyArrays) {
      for (const match of arrayText.matchAll(/["']([^"']+)["']/g)) {
        const spec = match[1];
        const name = /^([A-Za-z0-9_.-]+)/.exec(spec)?.[1];
        if (name)
          dependencies[normalizePythonPackageName(name)] =
            spec.slice(name.length) || "*";
      }
    }

    return dependencies;
  } catch {
    return {};
  }
}

function normalizePythonPackageName(name: string): string {
  return name.toLowerCase().replaceAll("_", "-");
}

async function readCargoDependencies(
  root: string,
): Promise<Record<string, string>> {
  try {
    const text = await readFile(path.join(root, "Cargo.toml"), "utf8");
    const dependencies: Record<string, string> = {};
    let inDependencySection = false;

    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const sectionMatch = /^\[([^\]]+)\]$/.exec(trimmed);
      if (sectionMatch) {
        inDependencySection = /(^dependencies$|\.dependencies$)/.test(
          sectionMatch[1],
        );
        continue;
      }

      if (!inDependencySection) continue;
      const match = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(trimmed);
      if (!match) continue;
      dependencies[match[1]] = match[2].trim();
      dependencies[normalizeRustCrateName(match[1])] = match[2].trim();
    }

    return dependencies;
  } catch {
    return {};
  }
}

function normalizeRustCrateName(name: string): string {
  return name.replaceAll("-", "_");
}
