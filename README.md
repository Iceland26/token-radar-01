# Token Radar (`radar-2`)

Token Radar reads a sealed DefiLlama protocol snapshot (`snapshot.json`), identifies every protocol that records no token yet, ranks eligible protocols by their implied launch value, and produces a concrete 6-step farm plan for each.

Deterministic Node 22 standard-library entry (`main.ts` + `lib/model.ts`, zero external npm dependencies, no network calls).

---

## Eligibility Rule

A protocol is treated as **pre-token** when `mcap_usd`, `gecko_id`, and `symbol` are all `null`.

Pre-token protocols that represent a derivative wrapper, bridge, liquid staking/restaking wrapper, versioned release, or exchange product are **set aside** rather than ranked on the board (and shown in the dashboard's **Set aside** view):

- **Excluded categories**: `Bridge`, `Canonical Bridge`, `Liquid Staking`, `Liquid Restaking`, `Restaked BTC`, `CEX`
- **Versioned releases**: names ending with a version marker (e.g., ` V2`, ` v3`, ` 2.0`)
- **Wrapped / staked markers**: names containing whole-word `wrapped`, `staked`, or `staking`
- **Exchange-prefixed products**: names starting with `Binance`, `Coinbase`, `Bybit`, `Kraken`, `Bitget`, `OKX`, `Bitfinex`, or `Gemini`

---

## Value Model (`radar-2`)

One scoring function (`scoreProtocol` in `lib/model.ts`) scores every eligible row from the snapshot's own figures — no protocol name is special-cased:

```text
implied = TVL × category_multiple × growth × maturity × breadth
```

- **Category multiple**: median `mcap_usd / tvl_usd` of live trading peers in the same category, pulled toward the market-wide median (`global_multiple`) with prior weight `4`, clamped to `[0.02, 3.0]`.
- **Growth**: `1 + (clamp(change_7d, -50, +150) / 100) × 0.6`.
- **Maturity**: `0.65 + 0.35 × min(age_days, 1460) / 1460` (unknown listing date defaults to `365` days).
- **Breadth**: `1 + 0.04 × min(max(1, chains.length) - 1, 5)` (+4% per extra chain up to 5).

Each ranked protocol also receives a 6-step farm plan (`farmSteps` in `lib/model.ts`) tailored to its category, primary chain, TVL-tiered capital (`$50`–`$500`), and age-tiered holding window (`30`–`60` days).

---

## How to Run

```bash
# Run with default paths (--input /input, output to $MAKEFUN_OUTPUT_DIR or /output)
node main.ts

# Run against an explicit snapshot and output directory
MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

Useful helper scripts in `tools/`:

```bash
# Capture dashboard screenshots into screenshots/
node tools/shoot.mjs --input /path/to/snapshot.json

# Run local gate validation + determinism check
node tools/gate-check.mjs --input /path/to/snapshot.json
```

---

## Outputs Written

`main.ts` validates the snapshot and generated board, then writes into the output directory:

- `board.json` — `{ rows }` ranked by `implied_value_usd` descending (`1..N`)
- `data.js` — `window.RADAR = ...;` static payload consumed by the dashboard
- `dashboard/` — static HTML/CSS/JS dashboard bundle (`index.html`, `app.css`, `app.js`)
- `screenshots/` — copied PNG screenshots (at least 3 required to build `dossier.json`)
- `dossier.json` — packaged submission dossier built by `vendor/makefun-board.ts`

---

## Dashboard Views

Opening `dashboard/index.html` (with `../data.js` generated alongside it) provides three views:

1. **Board** (default): Search by name or slug, filter by category, chain, or `Watchlist only`, sort by implied value / TVL / 7d growth / age / category multiple, and click (or press `Enter` on) any row to open the right-hand detail drawer (`#p=<slug>`) with the multiplier breakdown, 6-step farm plan, and up to 3 live trading peers in the category.
2. **Set aside** (`#tab=aside`): Excluded pre-token protocols with category, TVL, and exclusion reason.
3. **Trading now** (`#tab=live`): Top 24 already-trading protocols by market cap whose `mcap/TVL` ratios anchor the model.

---

## Repository Layout

```text
main.ts                  CLI entry point, validation, output writer, and dossier builder
lib/
  model.ts               Snapshot parser, eligibility rules, radar-2 model, farm plans, gate check
vendor/
  makefun-board.ts       Dossier packager (buildDossier)
dashboard/
  index.html             Static HTML shell loading ../data.js and app.js
  app.css                Dashboard styles
  app.js                 Vanilla DOM dashboard UI and hash router
screenshots/             Dashboard PNG screenshots (3–4 images)
tools/
  gate-check.mjs         Local gate & determinism self-check
  shoot.mjs              Headless Chromium screenshot capture script
```
