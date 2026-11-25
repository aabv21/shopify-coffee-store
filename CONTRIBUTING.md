# Contributing

[`AGENTS.md`](AGENTS.md) is the working guide for humans and AI agents alike: the repo map, the commands, the rules, and the Definition of done.

1. Branch from `develop` (`feat/…`, `fix/…`, `docs/…`, `chore/…`).
2. Make the change with its tests, and run the Definition of done locally.
3. Open a pull request into `develop`, titled in [Conventional Commits](https://www.conventionalcommits.org/) form. It's squash-merged once CI is green.

Releases are pull requests from `develop` into `main` titled `release: vX.Y.Z` and merged with a merge commit; `.github/workflows/release.yml` then tags that commit and publishes the GitHub release. The release workflow only tags a PR whose head branch is `develop` or `release/…`. Report security issues privately, as [`SECURITY.md`](SECURITY.md) describes.

## Supply chain

pnpm is pinned in `package.json`'s `packageManager` to an exact `11.x`; never move to pnpm 12, whose default lockfile Dependabot can't parse yet. `pnpm-workspace.yaml` holds the settings pnpm 11 no longer reads from `.npmrc`:

- `minimumReleaseAge: 4320`: no package version (transitive included) younger than 3 days, so a compromised release can be pulled first.
- `minimumReleaseAgeExclude: []`: replaces pnpm 11's default `n8n`/`n8n-*`/`@n8n/*` exemption, so nothing is exempt.
- `trustPolicy: no-downgrade`: an install fails if a package's provenance or trusted publishing regresses, or if the pinned pnpm itself would downgrade it.
- `blockExoticSubdeps: true`: only a direct dependency may come from a git or tarball URL.
- `strictDepBuilds: true`, `dangerouslyAllowAllBuilds: false`: an install script fails the install unless `allowBuilds` approves it.
- `engineStrict: true`: a dependency whose `engines` excludes this Node fails the install.
- `allowBuilds`: only packages a real `pnpm install --frozen-lockfile` proved need a build script, each with a one-line reason. Today that's only `esbuild`, whose postinstall links its platform binary; the theme toolchain needs none.

`tests/supply-chain.test.ts` checks these through `pnpm config list --json`, pnpm's effective config, plus the exact pnpm 11 pin, no `package-lock.json`, no tracked file teaching an `npm` command, and a `@sha256:` digest on every image.

**Updating a dependency:** edit `package.json`, run `pnpm install` (not `--frozen-lockfile`), run the gate, and commit both files. If `minimumReleaseAge` refuses a version, wait it out or pin an older one; don't work around it.

**Landing a security fix younger than 3 days:**
1. Add a temporary `minimumReleaseAgeExclude` entry for that exact version (`"esbuild@0.28.3"`, never the bare name, which exempts every future version), with a `#` comment naming the advisory ID and today's date.
2. Run `pnpm install` and merge as usual.
3. Remove the entry once the version is older than 3 days.

The supply-chain test goes red at step 1 on purpose, as the reminder for step 3; let it stay red for that PR rather than weakening it. If that makes CI unmergeable, wait out the 3 days instead.

**Images** in `compose.yaml` and `compose.queue.yaml` are pinned `name:tag@sha256:<digest>`, the multi-arch index digest from `docker buildx imagetools inspect name:tag`, so one reference works on arm64 (local) and amd64 (CI). Dependabot refreshes an existing digest but won't add one, so a tag bump needs the digest re-resolved and the tag reviewed by hand.

Prose names the n8n line, not the patch, so a Dependabot patch bump needs no docs change; `tests/docs.test.ts` enforces it.

**CI** installs with `pnpm/setup` (pinned by SHA), `actions/setup-node` with `cache: pnpm`, `pnpm install --frozen-lockfile`, then `pnpm audit --audit-level=high`. Its own `docker run` images (`koalaman/shellcheck`, `zricethezav/gitleaks`, `rhysd/actionlint`) are digest-pinned too, and zizmor installs from `.github/zizmor-requirements.txt` with `--require-hashes`. Dependabot doesn't track `run:` lines, so bump these by hand, re-resolving the digest or hashes in the same PR. `docs/testing.md` "What CI runs" covers each job, including the `n8n` job that boots the stack.

**Dependabot** adds a 7-day cooldown to every ecosystem: `npm` (which covers the pnpm lockfile) gets 14 days for major and 7 for minor and patch; `docker-compose` and `github-actions`, with no semver convention, get a flat 7. Every version PR is therefore already past pnpm's 3-day gate. Security updates skip the cooldown.
