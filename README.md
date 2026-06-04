# driftcheck

[![CI](https://github.com/sxuff/driftcheck/actions/workflows/ci.yml/badge.svg)](https://github.com/sxuff/driftcheck/actions/workflows/ci.yml)
[![MIT License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node.js >=18.18](https://img.shields.io/badge/node-%3E%3D18.18-339933.svg)](package.json)
[![TypeScript](https://img.shields.io/badge/built%20with-TypeScript-3178C6.svg)](https://www.typescriptlang.org/)

`driftcheck` is a local-first semantic linter for AI-generated code. It analyzes staged changes or a git diff and flags when new code drifts away from the existing codebase.

Today it detects duplicated abstractions, undeclared dependency drift, and nearby convention drift. Longer term, it aims to catch architecture violations from repo docs, ADRs, and import boundaries.

The MVP is local-first and focused on TypeScript/JavaScript, Python, and Rust repositories.

![driftcheck CLI demo](docs/demo.svg)

## Why

AI agents are fast at producing code, but they often miss the quiet social contract of a codebase: existing utilities, naming habits, dependency choices, test style, and folder conventions.

`driftcheck` looks at the code that is already there, then reviews your changed files for drift before those changes become permanent.

It can also make a repository agent-ready by generating evidence-backed instructions for coding agents:

```bash
npx driftcheck scan --rules
npx driftcheck agents init
npx driftcheck diff
npx driftcheck brief
```

## Features

- Detects new functions/classes/types that resemble existing abstractions.
- Flags undeclared external dependencies introduced by changed files.
- Learns nearby conventions for quotes, semicolons, exports, function style, error handling, and test/source placement.
- Works locally on real git diffs and staged changes.
- Supports text output for humans and JSON output for CI.
- Starts with JavaScript/TypeScript, Python, and Rust.
- Infers concrete repo conventions and generates `AGENTS.md`.
- Produces compact repair briefs for AI coding agents.

## Quick Start

```bash
npm install
npm run build
```

During development:

```bash
npm run dev -- diff
```

Run from npm once published:

```bash
npx driftcheck diff
```

To use the `driftcheck` binary name locally before publishing:

```bash
npm run build
npm link
driftcheck diff
```

You can also run the compiled CLI directly:

```bash
node dist/cli.js diff
```

## Usage

Analyze unstaged working tree changes:

```bash
driftcheck diff
```

Analyze staged changes:

```bash
driftcheck staged
```

Build a lightweight map of existing repo patterns:

```bash
driftcheck scan
```

Emit JSON for CI experiments:

```bash
driftcheck staged --format json
```

Emit GitHub Actions annotations:

```bash
driftcheck staged --format github --fail-on warning
```

Filter low-severity findings:

```bash
driftcheck diff --quiet
driftcheck diff --severity warning
```

Use a custom config file:

```bash
driftcheck diff --config examples/driftcheck.config.json
driftcheck diff --no-config
```

Infer repo conventions with evidence:

```bash
driftcheck scan --rules
```

Generate agent-readable instructions and machine-readable inferred rules:

```bash
driftcheck agents init
driftcheck agents init --cursor
```

Generate a compact repair prompt for the current diff:

```bash
driftcheck brief
```

## Agent-Ready Workflow

`driftcheck scan --rules` detects deterministic, local conventions including:

- Package manager lockfiles.
- Test frameworks.
- Existing dependency choices for dates, HTTP, validation, tests, and logging.
- Likely shared utility homes.
- Conservative client/server folder boundaries.
- Generated output and repository validation commands.

Every inferred rule includes evidence and a confidence level. `agents init` writes only high- and medium-confidence rules by default.

Generated files:

- `AGENTS.md`
- `driftcheck.config.json`
- `.cursor/rules/driftcheck.mdc` when `.cursor/` exists or `--cursor` is passed
- A marked driftcheck section in an existing `CLAUDE.md`

Existing files are backed up before driftcheck updates them.

## What It Checks

- **Similar declarations**: newly added functions/classes are compared with existing declarations using AST-style extraction and token similarity.
- **New dependencies**: new external imports are compared with existing imports, `package.json`, `pyproject.toml`, `requirements.txt`, `Cargo.toml`, and local naming signals. By default, driftcheck reports undeclared external packages rather than every new use of an already-declared dependency.
- **Convention drift**: changed files are compared with nearby files for quote style, semicolons, export style, function style, error handling, and basic source/test placement.

Findings include severity, path, line number when possible, explanation, and a suggested fix.

## Configuration

driftcheck looks for `driftcheck.config.json` at the repo root. Use `--config <path>` for a custom path, or `--no-config` to use defaults only.

```json
{
  "ignorePaths": ["dist/**", "coverage/**"],
  "languages": ["javascript", "typescript", "python", "rust"],
  "rules": {
    "DC001": {
      "enabled": true,
      "threshold": 0.62,
      "severity": "warning"
    },
    "DC002": {
      "enabled": true,
      "severity": "warning"
    },
    "DC003": {
      "enabled": true,
      "severity": "info"
    }
  }
}
```

Config fields:

- `ignorePaths`: glob-style paths to skip.
- `languages`: enabled analyzers.
- `rules.<code>.enabled`: turn a rule on or off.
- `rules.<code>.severity`: override emitted severity.
- `rules.DC001.threshold`: similarity threshold from `0` to `1`.

## Rules

### DC001 Similar Declaration

Flags new functions/classes/types that look similar to existing declarations.

### DC002 New Dependency

Flags new external imports that are not already used and not declared in a dependency manifest.

### DC003 Convention Drift

Flags changed files that differ from nearby quote, semicolon, export, function, error-handling, or source/test placement patterns.

### DC004 Dependency Preference

Flags a new package when inferred repo rules show an established library for the same concern.

### DC005 Existing Utility

Flags a new helper when an evidence-backed shared utility appears to own that concern.

### DC006 Test Framework

Flags changed tests that use a framework style conflicting with the inferred repo test framework.

### DC007 Repository Boundary

Flags conservative architecture-boundary, generated-file, and package-manager drift.

## Example

```text
driftcheck found 1 finding:

[warning] New function resembles formatDateForDisplay
  src/features/invoice.ts:1
  formatDateForInvoice looks semantically similar to formatDateForDisplay in src/utils/date.ts:1. Similarity score: 0.63.
  Suggestion: Reuse or extend the existing abstraction if it owns this behavior; otherwise rename or narrow the new code so the distinction is obvious.
```

## Architecture

The CLI is split into small modules:

- `src/git.ts`: git diff, staged diff, tracked file discovery.
- `src/scan.ts`: repository pattern map.
- `src/analyzers/typescript.ts`: TypeScript/JavaScript AST extraction.
- `src/analyzers/python.ts`: lightweight Python declaration/import extraction.
- `src/analyzers/rust.ts`: lightweight Rust declaration/import extraction.
- `src/driftcheck.ts`: MVP drift rules.
- `src/reporters.ts`: text and JSON output.

Language support is intentionally isolated so Python and Rust analyzers can be added later without changing the command surface.

## Roadmap

See [ROADMAP.md](ROADMAP.md) for goal-sized build loops and copyable `/goal` prompts.

- Better semantic similarity using embeddings or local symbol graphs.
- Framework-aware conventions for React, Next.js, Node services, and test runners.
- Tree-sitter-backed analyzers for richer multi-language parsing.
- Architecture rules from project docs, ADRs, and import boundaries.
- npm publishing with GitHub Actions trusted publishing.

## GitHub Actions

```yaml
name: Driftcheck

on:
  pull_request:

jobs:
  driftcheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx driftcheck staged --format github --fail-on warning
```

## Development

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run check
```
