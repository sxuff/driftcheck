#!/usr/bin/env node
import { analyzeChanges } from "./driftcheck.js";
import { formatJson, formatText } from "./reporters.js";
import { scanRepo } from "./scan.js";

type Command = "diff" | "staged" | "scan";

interface ParsedArgs {
  command?: Command;
  json: boolean;
  cwd: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = [...argv];
  const parsed: ParsedArgs = {
    json: false,
    cwd: process.cwd(),
  };

  while (args.length > 0) {
    const arg = args.shift();
    if (!arg) continue;

    if (arg === "--json") {
      parsed.json = true;
      continue;
    }

    if (arg === "--cwd") {
      const value = args.shift();
      if (!value) throw new Error("--cwd requires a path");
      parsed.cwd = value;
      continue;
    }

    if (arg === "diff" || arg === "staged" || arg === "scan") {
      parsed.command = arg;
      continue;
    }

    if (arg === "-h" || arg === "--help") {
      parsed.command = undefined;
      return parsed;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function help(): string {
  return [
    "driftcheck - semantic linting for AI-generated code drift",
    "",
    "Usage:",
    "  driftcheck diff [--json] [--cwd <path>]",
    "  driftcheck staged [--json] [--cwd <path>]",
    "  driftcheck scan [--json] [--cwd <path>]",
    "",
    "Commands:",
    "  diff     Analyze unstaged working tree changes",
    "  staged   Analyze staged changes",
    "  scan     Build a lightweight map of repo patterns",
  ].join("\n");
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);

  if (!args.command) {
    console.log(help());
    return 0;
  }

  if (args.command === "scan") {
    const repoMap = await scanRepo(args.cwd);
    console.log(args.json ? formatJson(repoMap) : formatText({ repoMap }));
    return 0;
  }

  const result = await analyzeChanges({
    cwd: args.cwd,
    mode: args.command,
  });

  console.log(args.json ? formatJson(result) : formatText(result));
  return result.findings.some((finding) => finding.severity === "error")
    ? 1
    : 0;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  },
);
