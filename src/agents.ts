import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config.js";
import { repoRoot } from "./git.js";
import { enforceableRules, inferRepoRules } from "./inferred-rules.js";
import type { InferredRule } from "./types.js";

export interface AgentsInitResult {
  generated: string[];
  skipped: string[];
  backups: string[];
  rules: InferredRule[];
}

export async function initializeAgents(options: {
  cwd: string;
  cursor?: boolean;
}): Promise<AgentsInitResult> {
  const root = await repoRoot(options.cwd);
  const rules = await inferRepoRules(root);
  const enforceable = enforceableRules(rules);
  const config = await loadConfig({ cwd: root });
  const generated: string[] = [];
  const skipped: string[] = [];
  const backups: string[] = [];

  await writeWithBackup(
    root,
    "AGENTS.md",
    renderAgentsMarkdown(enforceable),
    generated,
    backups,
  );
  await writeWithBackup(
    root,
    "driftcheck.config.json",
    `${JSON.stringify({ ...config, inferredRules: enforceable }, null, 2)}\n`,
    generated,
    backups,
  );

  const cursorExists = await exists(path.join(root, ".cursor"));
  if (cursorExists || options.cursor) {
    await mkdir(path.join(root, ".cursor", "rules"), { recursive: true });
    await writeWithBackup(
      root,
      ".cursor/rules/driftcheck.mdc",
      renderCursorRules(enforceable),
      generated,
      backups,
    );
  } else {
    skipped.push(".cursor/rules/driftcheck.mdc because .cursor/ was not found");
  }

  const claudePath = path.join(root, "CLAUDE.md");
  if (await exists(claudePath)) {
    const current = await readFile(claudePath, "utf8");
    if (current.includes("<!-- driftcheck:start -->")) {
      skipped.push("CLAUDE.md because a driftcheck section already exists");
    } else {
      await writeWithBackup(
        root,
        "CLAUDE.md",
        `${current.trimEnd()}\n\n${renderClaudeSection(enforceable)}`,
        generated,
        backups,
      );
    }
  } else {
    skipped.push("CLAUDE.md because no existing CLAUDE.md was found");
  }

  return { generated, skipped, backups, rules };
}

export function renderAgentsMarkdown(rules: InferredRule[]): string {
  const sections = groupRules(rules);
  return [
    "# AGENTS.md",
    "",
    "This repository uses driftcheck to keep AI-generated changes aligned with existing codebase conventions.",
    "",
    ...sections.flatMap(([title, items]) => [
      `## ${title}`,
      "",
      ...items.flatMap((item) => [
        `- ${item.description}`,
        `  Evidence: ${item.evidence.map((evidence) => `${evidence.path} (${evidence.reason})`).join("; ")}`,
      ]),
      "",
    ]),
    "## Before finishing",
    "",
    ...commandRules(rules).map((command) => `- ${command}`),
    "- npx driftcheck diff",
    "",
  ].join("\n");
}

export function renderRules(rules: InferredRule[]): string {
  if (rules.length === 0) {
    return "No concrete repo conventions were detected.";
  }
  return [
    `Detected ${rules.length} repo convention${rules.length === 1 ? "" : "s"}:`,
    "",
    ...rules.flatMap((item) => [
      `[${item.confidence}] ${item.title}`,
      item.description,
      `Evidence: ${item.evidence.map((evidence) => `${evidence.path} (${evidence.reason})`).join(", ")}`,
      "",
    ]),
    "Next step:",
    "  npx driftcheck agents init",
  ].join("\n");
}

export function renderAgentsInitResult(result: AgentsInitResult): string {
  return [
    "Generated:",
    ...result.generated.map((file) => `- ${file}`),
    ...(result.backups.length > 0
      ? ["", "Backups:", ...result.backups.map((file) => `- ${file}`)]
      : []),
    ...(result.skipped.length > 0
      ? ["", "Skipped:", ...result.skipped.map((reason) => `- ${reason}`)]
      : []),
    "",
    "Next step:",
    "  npx driftcheck diff",
  ].join("\n");
}

function renderCursorRules(rules: InferredRule[]): string {
  return [
    "---",
    "description: Repository conventions inferred by driftcheck",
    "alwaysApply: true",
    "---",
    "",
    renderAgentsMarkdown(rules),
  ].join("\n");
}

function renderClaudeSection(rules: InferredRule[]): string {
  return [
    "<!-- driftcheck:start -->",
    "## Driftcheck repository conventions",
    "",
    ...rules.map(
      (item) =>
        `- ${item.description} Evidence: ${item.evidence.map((evidence) => evidence.path).join(", ")}.`,
    ),
    "",
    "Before finishing, run `npx driftcheck diff`.",
    "<!-- driftcheck:end -->",
    "",
  ].join("\n");
}

function groupRules(rules: InferredRule[]): Array<[string, InferredRule[]]> {
  const groups: Array<[string, InferredRule["kind"][]]> = [
    ["Package manager", ["package-manager"]],
    ["Testing", ["test-framework"]],
    ["Dependency preferences", ["dependency-preference"]],
    ["Existing utilities", ["common-utility"]],
    ["Architecture", ["architecture-boundary", "generated-files"]],
  ];
  return groups
    .map(
      ([title, kinds]) =>
        [title, rules.filter((item) => kinds.includes(item.kind))] as [
          string,
          InferredRule[],
        ],
    )
    .filter(([, items]) => items.length > 0);
}

function commandRules(rules: InferredRule[]): string[] {
  return rules
    .filter((item) => item.kind === "command")
    .map((item) => String(item.data?.command))
    .filter(Boolean);
}

async function writeWithBackup(
  cwd: string,
  relativePath: string,
  contents: string,
  generated: string[],
  backups: string[],
): Promise<void> {
  const fullPath = path.join(cwd, relativePath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  if (await exists(fullPath)) {
    const backupPath = await availableBackupPath(fullPath);
    await copyFile(fullPath, backupPath);
    backups.push(path.relative(cwd, backupPath).replaceAll("\\", "/"));
  }
  await writeFile(fullPath, contents, "utf8");
  generated.push(relativePath.replaceAll("\\", "/"));
}

async function availableBackupPath(fullPath: string): Promise<string> {
  const base = `${fullPath}.driftcheck.bak`;
  if (!(await exists(base))) return base;
  let index = 2;
  while (await exists(`${base}.${index}`)) index += 1;
  return `${base}.${index}`;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}
