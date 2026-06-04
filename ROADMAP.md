# Roadmap

This roadmap is organized as goal-sized build loops. Each item should leave the tool more useful in real repositories, not just more complete on paper.

## MVP2 Status

MVP2 adds configuration, rule codes, finding filters, GitHub annotation output, improved dependency-rule baselines, package-prep scripts, and documentation for CI/package use.

## Done In MVP2

- Config and ignores.
- Stable rule codes.
- Text, JSON, and GitHub reporter modes.
- Severity filtering, quiet mode, and configurable fail thresholds.
- Dependency-rule fixes for modified tracked files and package-name edge cases.
- Packaging prep with `prepack`, `npm pack --dry-run` verification, and trusted-publishing workflow scaffold.

## Agent-Ready MVP

- `scan --rules` infers evidence-backed repo conventions.
- `agents init` safely generates agent-readable rules and machine config.
- Inferred test framework, dependency preference, utility ownership, generated file, package manager, and conservative boundary rules are enforced by diff checks.
- `brief` creates a compact repair prompt for an AI coding agent.

## Next Frontier

## 1. Real Parser Upgrade

**Why:** Regex/lightweight parsing is fine for an MVP, but richer analysis needs reliable syntax trees across languages.

**Deliverables:**

- Evaluate Tree-sitter or language-native parser options.
- Replace or wrap lightweight Python/Rust parsing behind the existing analyzer interface.
- Preserve current fixture behavior.
- Add parser-error handling for partial/broken diffs.
- Benchmark scan time on a medium repo.

**Goal prompt:**

```text
/goal Upgrade driftcheck parsing quality without breaking the analyzer interface. Evaluate parser options for Python and Rust, implement the best pragmatic choice behind the current FileAnalysis model, preserve existing behavior, add parser-error handling, and benchmark scan time. Verify with npm run check and a medium-repo smoke test.
```

## 2. Architecture Rules

**Why:** This is the long-term promise: catch code that violates repo structure, not just local style.

**Deliverables:**

- Learn import boundaries from existing folders.
- Detect new imports crossing unusual boundaries.
- Read optional architecture docs such as `docs/adr`, `ARCHITECTURE.md`, or `CONTEXT.md`.
- Add findings for misplaced files and boundary violations.
- Keep docs-derived rules explainable, never mystical.

**Goal prompt:**

```text
/goal Add first architecture-drift rules. Learn existing import boundaries and folder placement patterns, detect unusual new cross-boundary imports and misplaced files, optionally read architecture docs/ADRs for hints, and produce explainable findings with tests and examples. Verify with npm run check and sample fixture repos.
```

## 3. Semantic Similarity Upgrade

**Why:** Token similarity is fast, but it misses intent and overweights shared syntax.

**Deliverables:**

- Add a symbol/signature similarity layer.
- Compare declaration names, parameters, return shapes, imports used, and body tokens separately.
- Make scoring explainable in JSON.
- Consider optional embeddings only after deterministic scoring improves.

**Goal prompt:**

```text
/goal Improve semantic similarity scoring. Replace the single Jaccard score with an explainable multi-factor score using declaration names, parameters, return shapes, imports used, and body tokens. Update findings and JSON output to show score reasons. Add tests for true positives and false positives. Verify with npm run check.
```

## Fast Build Order

1. Parser upgrade.
2. Architecture rules.
3. Semantic similarity upgrade.
4. Framework-aware conventions.
5. GitHub Checks API or PR comment integration.

MVP2 makes driftcheck usable by other people quickly. The next frontier makes it meaningfully smarter.
