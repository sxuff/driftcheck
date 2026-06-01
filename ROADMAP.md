# Roadmap

This roadmap is organized as goal-sized build loops. Each item should leave the tool more useful in real repositories, not just more complete on paper.

## 1. Config And Ignores

**Why:** Users need to tune driftcheck before it can be trusted in a real repo.

**Deliverables:**

- Add config discovery for `driftcheck.config.json`.
- Support `ignorePaths`, `rules`, `languages`, and similarity thresholds.
- Add `--config <path>` and `--no-config`.
- Document config examples.
- Add tests for default config, custom config, disabled rules, and ignored paths.

**Goal prompt:**

```text
/goal Add first-class driftcheck configuration. Implement driftcheck.config.json discovery plus --config and --no-config. Support ignorePaths, enabled languages, per-rule enable/disable, and similarity thresholds. Update tests, README, and examples. Verify with npm run check and a sample fixture repo.
```

## 2. Better Finding Quality

**Why:** The MVP catches useful things, but it can be noisy. The next win is making findings feel trustworthy.

**Deliverables:**

- Add stable finding codes such as `DC001`.
- Deduplicate reciprocal or repeated findings.
- Group findings by file in text output.
- Add `--severity <info|warning|error>` filtering.
- Improve suggestions with rule-specific wording.
- Add regression tests for noisy cases found by dogfooding.

**Goal prompt:**

```text
/goal Improve driftcheck finding quality. Add stable rule codes, deduplicate repeated/reciprocal findings, group text output by file, support --severity filtering, and improve rule-specific suggestions. Add regression tests from current dogfooding noise and verify with npm run check plus npm run dev -- diff.
```

## 3. GitHub Actions Reporter

**Why:** The CLI becomes much more useful when it can comment directly on PR lines.

**Deliverables:**

- Add `--format text|json|github`.
- Emit GitHub workflow command annotations for findings with paths and lines.
- Ensure CI mode exits non-zero for warning/error findings only when configured.
- Add README docs for using driftcheck in a workflow.
- Add tests for reporter output.

**Goal prompt:**

```text
/goal Add a GitHub Actions reporter for driftcheck. Implement --format text|json|github, emit workflow annotations with file and line metadata, document a CI workflow example, and add tests for reporter output and exit behavior. Verify with npm run check.
```

## 4. Package For npm

**Why:** Users should be able to run `npx driftcheck` without cloning the repo.

**Deliverables:**

- Add `prepack` validation.
- Verify package contents with `npm pack --dry-run`.
- Add publish documentation.
- Add GitHub Actions trusted publishing workflow, but keep actual publish manual until ready.
- Confirm executable shebang and package exports.

**Goal prompt:**

```text
/goal Prepare driftcheck for npm distribution. Add prepack checks, verify npm pack contents, document npx usage, and add a draft trusted-publishing workflow without publishing. Confirm the CLI binary works from the packed artifact. Verify with npm run check and npm pack --dry-run.
```

## 5. Real Parser Upgrade

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

## 6. Architecture Rules

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

## 7. Semantic Similarity Upgrade

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

1. Config and ignores.
2. Better finding quality.
3. GitHub Actions reporter.
4. npm packaging.
5. Parser upgrade.
6. Architecture rules.
7. Semantic similarity upgrade.

The first four make driftcheck usable by other people quickly. The last three make it meaningfully smarter.
