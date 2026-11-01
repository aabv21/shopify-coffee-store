# Theme overlay

This directory holds everything this repo adds on top of Shopify's Horizon theme. It is never
pushed to a store on its own: `npm run theme:assemble` downloads the pinned Horizon commit,
copies this overlay onto it, and applies a short list of anchored insertions into Horizon's own
files, producing a complete, pushable theme at `.theme-build/theme/`.

## How assembly works

1. **Base.** `scripts/lib/horizon.ts` downloads Horizon at the exact commit pinned in `HORIZON`
   (`codeload.github.com/Shopify/horizon/tar.gz/<commit>`) and extracts it into
   `.theme-build/horizon-<commit>/`, reused on later runs instead of downloading again.
2. **Overlay.** `scripts/assemble-theme.ts` copies the base into a fresh `.theme-build/theme/`,
   then copies every file under this directory (`theme/**`) on top of it, except this README. A
   copied file that didn't already exist in Horizon is new (`added`); one that did is a deliberate
   override (`modified`).
3. **Insertions.** `scripts/lib/theme-insertions.ts`'s `INSERTIONS` list makes small, surgical
   edits to Horizon's own files that a whole-file overlay can't express: a line inserted before an
   exact anchor, a settings group appended once, or a section added once to a JSON template. Each
   insertion names the file and either an anchor string (which must appear in it exactly once) or
   a key that must not already exist; a mismatch fails assembly immediately and names the file and
   anchor, rather than silently applying to the wrong spot or duplicating. Every touched file
   counts as `modified`.

This task ships both lists empty — there is no overlay content or insertion yet. Later tasks add
new theme files directly under this directory (for example `sections/coffee-finder.liquid`) and
list their insertions in `INSERTIONS`, each with the exact file, anchor, and content being
inserted.

## TypeScript assets

Browser-facing TypeScript lives in `src/theme/`. `scripts/build-theme.ts`'s `THEME_ENTRIES` list
maps each entry point to the asset name it bundles into; `npm run build:theme` runs esbuild
(bundled, ESM, not minified — Shopify serves theme assets minified at request time, so shipping
already-minified code would just double-minify it) and writes `theme/assets/<asset>`, with a
generated-file banner naming the source to edit instead. `npm run build:theme -- --check` reports
drift and exits 1 without writing; that's what CI runs. This task ships `THEME_ENTRIES` empty.

## Theme check

`npm run theme:check` assembles the theme and runs Shopify's theme check
(`@shopify/theme-check-node`) against it. An error (severity 0) anywhere is always a release
blocker. So is any offense — any severity — in a file this repo added or modified, since those are
ours to fix. Everything else is Horizon's own baseline: unmodified Horizon warnings that
`theme-check-node` can report differently between runs with no change in this repo, because it
loads the Liquid docs it checks against from `Shopify/theme-liquid-docs@main` at run time (with a
bundled fallback). The gate is `failing: 0`; the baseline count is printed and recorded here as
informational, not asserted.

At the time of writing, an unmodified pinned Horizon reports 0 errors and a baseline of 6
warnings, all in `sections/header.liquid` and `snippets/divider.liquid`.

## Commands

- `npm run theme:assemble` — assembles the theme into `.theme-build/theme/` and prints the added
  and modified file lists.
- `npm run build:theme [-- --check]` — bundles `THEME_ENTRIES` into `theme/assets/`; `--check`
  reports drift and exits 1 instead of writing.
- `npm run theme:check` — assembles, then runs theme check; prints any failing offenses and the
  baseline count, and exits 1 on any failure.

## Pushing to a store (deferred live check)

These need a real dev store and are not run by this task:

```sh
npx @shopify/cli@5.0.0 theme dev --store <store>.myshopify.com --path .theme-build/theme
npx @shopify/cli@5.0.0 theme push --unpublished --theme "Nubandina demo" --path .theme-build/theme
```

`--theme` on `theme push --unpublished` names the new theme — without `--development`, the CLI's
own help says to use `--theme` to provide the new theme's name, and `--unpublished` alone creates
an unnamed one. On a password-protected dev store, `theme dev` also needs
`--store-password <value>`.

Confirmed against `npx @shopify/cli@5.0.0 theme push --help` and `theme dev --help`:

```
-t, --theme=<value>
    Theme ID or name of the remote theme. Use --development, --live, --theme, or
    --unpublished in non-interactive environments. When using --unpublished
    without --development, use --theme to provide the new theme name.
    [env: SHOPIFY_FLAG_THEME_ID]
```

```
--store-password=<value>
    The password for storefronts with password protection.
    [env: SHOPIFY_FLAG_STORE_PASSWORD]
```
