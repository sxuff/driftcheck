# Contributing

Thanks for helping improve driftcheck.

## Development

```bash
npm ci
npm run check
```

Use focused tests for behavior changes. For analyzer work, prefer fixture repos that exercise real git diffs through the public API.

## Pull Requests

- Keep changes scoped.
- Add or update tests for rule behavior.
- Run `npm run check` before opening a PR.
- Mention known false positives or false negatives when changing heuristics.
