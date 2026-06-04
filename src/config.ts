import { readFile } from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "./git.js";
import type {
  DriftcheckConfig,
  DriftcheckConfigInput,
  Language,
  RuleCode,
  Severity,
} from "./types.js";

export const ruleDocs: Record<RuleCode, string> = {
  DC001: "https://github.com/sxuff/driftcheck#dc001-similar-declaration",
  DC002: "https://github.com/sxuff/driftcheck#dc002-new-dependency",
  DC003: "https://github.com/sxuff/driftcheck#dc003-convention-drift",
  DC004: "https://github.com/sxuff/driftcheck#dc004-dependency-preference",
  DC005: "https://github.com/sxuff/driftcheck#dc005-existing-utility",
  DC006: "https://github.com/sxuff/driftcheck#dc006-test-framework",
  DC007: "https://github.com/sxuff/driftcheck#dc007-architecture-boundary",
};

const defaultLanguages: Language[] = [
  "javascript",
  "typescript",
  "python",
  "rust",
];

const validLanguages = new Set(defaultLanguages);
const validSeverities = new Set<Severity>(["info", "warning", "error"]);
const validRuleCodes = new Set<RuleCode>([
  "DC001",
  "DC002",
  "DC003",
  "DC004",
  "DC005",
  "DC006",
  "DC007",
]);

export const defaultConfig: DriftcheckConfig = {
  ignorePaths: ["dist/**", "node_modules/**", "coverage/**"],
  languages: defaultLanguages,
  rules: {
    DC001: { enabled: true, severity: undefined, threshold: 0.5 },
    DC002: { enabled: true, severity: "warning" },
    DC003: { enabled: true, severity: "info" },
    DC004: { enabled: true, severity: "warning" },
    DC005: { enabled: true, severity: "warning" },
    DC006: { enabled: true, severity: "warning" },
    DC007: { enabled: true, severity: "warning" },
  },
  inferredRules: [],
  baselinePath: "driftcheck-baseline.json",
};

export async function loadConfig(options: {
  cwd: string;
  configPath?: string;
  noConfig?: boolean;
  overrides?: DriftcheckConfigInput;
}): Promise<DriftcheckConfig> {
  const root = await repoRoot(options.cwd);
  const loaded = options.noConfig
    ? {}
    : await readConfigFile(root, options.configPath);

  return mergeConfig(
    defaultConfig,
    mergeConfig(loaded, options.overrides ?? {}),
  );
}

export function mergeConfig(
  base: DriftcheckConfig,
  input: DriftcheckConfigInput,
): DriftcheckConfig;
export function mergeConfig(
  base: DriftcheckConfigInput,
  input: DriftcheckConfigInput,
): DriftcheckConfigInput;
export function mergeConfig(
  base: DriftcheckConfig | DriftcheckConfigInput,
  input: DriftcheckConfigInput,
): DriftcheckConfig | DriftcheckConfigInput {
  const rules = { ...(base.rules ?? {}) };
  for (const [code, rule] of Object.entries(input.rules ?? {})) {
    if (!validRuleCodes.has(code as RuleCode)) {
      throw new Error(`Unknown rule code in config: ${code}`);
    }
    rules[code as RuleCode] = {
      ...(rules[code as RuleCode] ?? {}),
      ...normalizeRuleConfig(code as RuleCode, rule ?? {}),
    };
  }

  return {
    ...base,
    ...input,
    languages: normalizeLanguages(input.languages ?? base.languages),
    ignorePaths: input.ignorePaths ?? base.ignorePaths ?? [],
    rules,
    inferredRules: input.inferredRules ?? base.inferredRules ?? [],
    baselinePath: input.baselinePath ?? base.baselinePath,
  };
}

export function shouldIgnorePath(
  filePath: string,
  patterns: string[],
): boolean {
  const normalized = filePath.replaceAll("\\", "/");
  return patterns.some((pattern) => matchGlob(normalized, pattern));
}

async function readConfigFile(
  root: string,
  configPath?: string,
): Promise<DriftcheckConfigInput> {
  const fullPath = configPath
    ? path.resolve(root, configPath)
    : path.join(root, "driftcheck.config.json");

  try {
    return parseConfig(await readFile(fullPath, "utf8"), fullPath);
  } catch (error) {
    if (
      !configPath &&
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return {};
    }
    throw error;
  }
}

function parseConfig(text: string, configPath: string): DriftcheckConfigInput {
  try {
    const parsed = JSON.parse(text) as DriftcheckConfigInput;
    return mergeConfig({}, parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse ${configPath}: ${message}`);
  }
}

function normalizeLanguages(languages?: Language[]): Language[] | undefined {
  if (!languages) return undefined;
  for (const language of languages) {
    if (!validLanguages.has(language)) {
      throw new Error(`Unknown language in config: ${language}`);
    }
  }
  return languages;
}

function normalizeRuleConfig(
  code: RuleCode,
  rule: NonNullable<DriftcheckConfigInput["rules"]>[RuleCode],
): NonNullable<DriftcheckConfigInput["rules"]>[RuleCode] {
  if (rule?.severity !== undefined && !validSeverities.has(rule.severity)) {
    throw new Error(`Invalid severity for ${code}: ${rule.severity}`);
  }
  if (
    rule?.threshold !== undefined &&
    (typeof rule.threshold !== "number" ||
      rule.threshold < 0 ||
      rule.threshold > 1)
  ) {
    throw new Error(`Invalid threshold for ${code}: ${rule.threshold}`);
  }
  return rule;
}

function matchGlob(filePath: string, pattern: string): boolean {
  const normalized = pattern.replaceAll("\\", "/");
  const escaped = normalized
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("**", "\0")
    .replaceAll("*", "[^/]*")
    .replaceAll("\0", ".*");
  return new RegExp(`^${escaped}$`).test(filePath);
}
