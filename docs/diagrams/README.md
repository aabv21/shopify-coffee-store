# Diagrams

Each diagram is a typed JSON source that [archify](https://github.com/tt-a1i/archify) (Node.js, no install, last checked against v3.2.0) renders as an interactive HTML page and an exported SVG.

| Source | Type | Where it's embedded |
|---|---|---|
| `architecture.json` | `architecture` | `README.md` and `docs/architecture.md` |
| `order-sequence.json` | `sequence` | `docs/architecture.md` |
| `order-lifecycle.json` | `lifecycle` | `docs/architecture.md`, at the top of "Failure modes" |
| `data-flow.json` | `dataflow` | `docs/architecture.md`, at the top of "What the system stores" |

Each source has its `.html` page and `.svg` image beside it. Open the page in a browser to read the diagram full-size, pan, and inspect each node. The SVG is exported as **SVG · Auto**, so it follows the reader's light or dark theme.

`docs/diagrams/*.delivery.json` receipts (one per diagram, written by `archify deliver`) hold local absolute paths and are gitignored. Never force-add one.

## Regenerating a diagram

Regenerate a diagram after editing its source.

Clone archify outside this repo, so `pnpm run lint` never scans it: `git clone --depth 1 --branch v3.2.0 https://github.com/tt-a1i/archify ../archify`. Run every command from the repo root, since each source's `meta.output` is relative to it. The steps below use the architecture diagram; for another one, use its type (`sequence`, `lifecycle`, or `dataflow`) and its files.

1. `node ../archify/archify/bin/archify.mjs validate architecture docs/diagrams/architecture.json --quality showcase --json`, after every edit, until all 9 artifact checks pass with 0 composition errors and 0 warnings.
2. `node ../archify/archify/bin/archify.mjs deliver architecture docs/diagrams/architecture.json docs/diagrams/architecture.html --quality showcase --json` writes the page, plus a gitignored `architecture.delivery.json` receipt.
3. Open the page, choose **Export**, then **SVG · Auto**, and save over `docs/diagrams/architecture.svg`.
4. Optionally, `node ../archify/archify/bin/archify.mjs visual-check docs/diagrams/architecture.html --json --out-dir ../archify-evidence` checks the page at four desktop sizes, with screenshots outside the repo.

`tests/diagrams.test.ts` ties the diagrams to `scripts/lib/manifest.ts`, so adding or renaming a workflow fails it until the diagram follows.
