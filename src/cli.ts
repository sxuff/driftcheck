#!/usr/bin/env node
import { analyzeChanges } from "./driftcheck.js";
import { loadConfig } from "./config.js";
import { filterFindings, formatOutput, shouldFail } from "./reporters.js";
import { scanRepo } from "./scan.js";
import type { OutputFormat, Severity } from "./types.js";

type Command = "diff" | "staged" | "scan";

interface ParsedArgs {
  command?: Command;
  format: OutputFormat;
  cwd: string;
  configPath?: string;
  noConfig: boolean;
  minSeverity?: Severity;
  quiet: boolean;
  failOn: Severity;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = [...argv];
  const parsed: ParsedArgs = {
    format: "text",
    cwd: process.cwd(),
    noConfig: false,
    quiet: false,
    failOn: "error",
  };

  while (args.length > 0) {
    const arg = args.shift();
    if (!arg) continue;

    if (arg === "--json") {
      parsed.format = "json";
      continue;
    }

    if (arg === "--format") {
      parsed.format = parseFormat(readValue(args, "--format"));
      continue;
    }

    if (arg === "--cwd") {
      parsed.cwd = readValue(args, "--cwd");
      continue;
    }

    if (arg === "--config") {
      parsed.configPath = readValue(args, "--config");
      continue;
    }

    if (arg === "--no-config") {
      parsed.noConfig = true;
      continue;
    }

    if (arg === "--severity") {
      parsed.minSeverity = parseSeverity(readValue(args, "--severity"));
      continue;
    }

    if (arg === "--quiet") {
      parsed.quiet = true;
      continue;
    }

    if (arg === "--fail-on") {
      parsed.failOn = parseSeverity(readValue(args, "--fail-on"));
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
    "  driftcheck diff [--format text|json|github] [--cwd <path>]",
    "  driftcheck staged [--format text|json|github] [--cwd <path>]",
    "  driftcheck scan [--format text|json] [--cwd <path>]",
    "",
    "Commands:",
    "  diff     Analyze unstaged working tree changes",
    "  staged   Analyze staged changes",
    "  scan     Build a lightweight map of repo patterns",
    "",
    "Options:",
    "  --json                  Alias for --format json",
    "  --config <path>         Read config from a custom path",
    "  --no-config             Ignore driftcheck.config.json",
    "  --severity <level>      Show findings at or above info, warning, or error",
    "  --quiet                 Hide info findings",
    "  --fail-on <level>       Exit non-zero for findings at or above level",
  ].join("\n");
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);

  if (!args.command) {
    console.log(help());
    return 0;
  }

  const config = await loadConfig({
    cwd: args.cwd,
    configPath: args.configPath,
    noConfig: args.noConfig,
  });

  if (args.command === "scan") {
    const repoMap = await scanRepo(args.cwd, config);
    console.log(
      formatOutput(
        { repoMap },
        args.format === "github" ? "text" : args.format,
      ),
    );
    return 0;
  }

  const result = await analyzeChanges({
    cwd: args.cwd,
    mode: args.command,
    config,
  });
  const filteredFindings = filterFindings(result.findings, {
    minSeverity: args.minSeverity,
    quiet: args.quiet,
  });
  const filteredResult = { findings: filteredFindings };

  console.log(formatOutput(filteredResult, args.format));
  return shouldFail(filteredFindings, args.failOn) ? 1 : 0;
}

function readValue(args: string[], flag: string): string {
  const value = args.shift();
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

function parseFormat(value: string): OutputFormat {
  if (value === "text" || value === "json" || value === "github") return value;
  throw new Error(`Invalid --format value: ${value}`);
}

function parseSeverity(value: string): Severity {
  if (value === "info" || value === "warning" || value === "error")
    return value;
  throw new Error(`Invalid severity value: ${value}`);
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
