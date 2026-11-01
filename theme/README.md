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

The toolchain itself shipped both lists empty. The free-shipping bar (below) is the first feature
to use them; later tasks add more theme files and insertions the same way, each with the exact
file, anchor, and content being inserted documented here.

## TypeScript assets

Browser-facing TypeScript lives in `src/theme/`. `scripts/build-theme.ts`'s `THEME_ENTRIES` list
maps each entry point to the asset name it bundles into; `npm run build:theme` runs esbuild
(bundled, ESM, not minified — Shopify serves theme assets minified at request time, so shipping
already-minified code would just double-minify it) and writes `theme/assets/<asset>`, with a
generated-file banner naming the source to edit instead. `npm run build:theme -- --check` reports
drift and exits 1 without writing; that's what CI runs.

## Free shipping bar

A progress bar in the cart drawer and on `/cart` showing how far the cart is from the free
shipping threshold, updating live as the cart changes.

**Files:**

- `src/theme/money.ts` — `formatMoney(cents, format)`, a small formatter for Shopify's
  `shop.money_format` placeholders (`amount`, `amount_no_decimals`, and their comma/space/period/
  apostrophe-separator variants). Pure, unit-tested (`tests/theme/money.test.ts`).
- `src/theme/free-shipping.ts` — `freeShippingProgress(totalCents, thresholdCents)` and
  `barMessage(state, messages, moneyFormat)`: the bar's own math and copy, with no DOM. Pure,
  unit-tested (`tests/theme/free-shipping.test.ts`).
- `src/theme/free-shipping-bar.ts` — the `<free-shipping-bar>` custom element. Bundled by
  `THEME_ENTRIES` into `theme/assets/free-shipping-bar.js` (generated; never hand-edited).
- `theme/snippets/free-shipping-bar.liquid` — renders the `<free-shipping-bar>` markup from the
  Theme contracts' DOM contract, reads the settings below, and loads the bundled script.

**Insertions** (`scripts/lib/theme-insertions.ts`'s `INSERTIONS`):

1. `snippets/cart-summary.liquid`: a `before-line` insertion of `{% render 'free-shipping-bar' %}`
   on its own line, anchored immediately before `<div class="cart-totals">` (that line appears
   exactly once in Horizon's file).
2. `config/settings_schema.json`: an `append-settings-group` insertion adding the group "Free
   shipping bar" with five settings: `free_shipping_bar_enabled` (checkbox, default on),
   `free_shipping_threshold` (number, default 120000), `free_shipping_message_remaining` (text,
   `[amount]` placeholder), `free_shipping_message_reached` (text), and
   `free_shipping_progress_label` (text, the progress bar's accessible label).

**Staying live.** The bar updates two ways: it listens on `document` for
`shopify:cart:lines-update` and re-reads `/cart.js` once the event's own promise settles, and it
also re-renders from `data-total-cents` whenever that attribute changes — which Horizon's section
morph sets on every cart update regardless of the event, since the morph copies an element's
attributes even where `data-skip-subtree-update` keeps it from touching that element's children.

**Limitations:**

- The bar reads `cart.total_price`, which reflects cart-level discounts but not anything applied
  at checkout. A discount code entered at checkout can still take the order below the free
  shipping rate after the bar has already shown "You've got free shipping!".

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

### Free shipping bar (deferred live checks)

These need `npx @shopify/cli@5.0.0 theme dev` against `.theme-build/theme` and are not run by this
task:

- **Drawer.** With Sierra Nevada 250 g in the cart, it shows "You're $82.000 away from free
  shipping" at 31%.
- **Live updates.** Raising the quantity to 4 (152,000 COP) switches it to "You've got free
  shipping!" without a reload, in the drawer and on `/cart`. Lowering it again restores the
  remaining message.
- **Boundary.** Huila 250 g plus Huila 500 g (exactly 120,000 COP) shows the reached message, and
  checkout charges 0 shipping.
- **Disabled.** A blank threshold, or unticking "Show the free shipping bar", hides the bar with no
  console errors.
