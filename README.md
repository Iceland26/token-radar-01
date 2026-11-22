# Token Radar (`radar-3`)

**Proposed submission title:** Token Radar: every value term fitted on the traded peers and graded leave-one-out and walk-forward, token odds from the peers' record, a costed farm plan and verdict for every protocol — all 758 protocols accounted for

Token Radar reads a sealed DefiLlama protocol snapshot (`snapshot.json`), identifies every protocol that records no token yet, ranks eligible protocols by their implied launch value, and produces a concrete 6-step farm plan for each. Unlike a hand-tuned scoring rule, radar-3 **fits** both of its models on the snapshot's own traded peers and **grades every term out-of-sample** before the term is allowed into the model. The dashboard cover prints the grades, the range calibration, the full accounting of all protocols in the snapshot, and an integrity seal over `board.json`.

Deterministic Node 22 standard-library entry (`main.ts` + `lib/model.ts`, zero external npm dependencies, no network calls, no `Date.now`, no randomness — deterministic splits and folds use a fixed FNV-1a hash of the slug).

---

## Eligibility Rule

A protocol is treated as **pre-token** when `mcap_usd`, `gecko_id`, and `symbol` are all `null`.

Pre-token protocols that represent a derivative wrapper, bridge, liquid staking/restaking wrapper, versioned release, or exchange product are **set aside** rather than ranked on the board (and shown in the dashboard's **Set aside** view):

- **Excluded categories**: `Bridge`, `Canonical Bridge`, `Liquid Staking`, `Liquid Restaking`, `Restaked BTC`, `CEX`
- **Versioned releases**: names ending with a version marker (e.g., ` V2`, ` v3`, ` 2.0`)
- **Wrapped / staked markers**: names containing whole-word `wrapped`, `staked`, or `staking`
- **Exchange-prefixed products**: names starting with `Binance`, `Coinbase`, `Bybit`, `Kraken`, `Bitget`, `OKX`, `Bitfinex`, or `Gemini`

## Peer Sets (defined from the data, printed on the cover)

- **Value peers** — protocols that record a token with `mcap_usd > 0`, `tvl_usd > 0`, and a usable `listed_at` date (95 on the practice snapshot). The value model is fitted and graded on these.
- **Odds universe** — protocols with `tvl_usd > 0` and a usable `listed_at`; the outcome is whether the protocol records a token (645 on the practice snapshot, base rate ≈ 51%). The odds model is fitted and graded on these.
- **Live peers** — records a token with `mcap_usd > 0` and `tvl_usd > 0` regardless of date (128). Used by the fallback and the Trading-now view.

Fallbacks so a different grading snapshot can never crash the run: if value peers number under 30, the value model falls back to the shrunk-median category multiple (stated in the output); a board row with no `listed_at` uses the universe median age; an unknown category gets offset 0.

---

## Value Model — fitted, term by term

Target: `ln(mcap_usd)` on the value peers. Candidate terms are considered in a fixed order, and a term is **kept only if it lowers BOTH the leave-one-out miss AND the walk-forward miss** against the previously kept set; otherwise it is reported as *tested, not kept*:

1. **Flat multiple (baseline)** — `ln mcap = ln TVL + ln(median peer mcap/TVL)`. Always shown.
2. **Size curve** — free intercept + slope on `ln(TVL)` (OLS).
3. **Category effect** — per-category intercept offset = shrunk mean residual, shrink `n/(n+8)`; categories with no peers get 0.
4. **7-day growth** — coefficient on clamped `change_7d / 100` (clamp −50%…+150%).
5. **Age** — coefficient on `ln(1 + age in years)`.
6. **Breadth** — coefficient on `ln(chain count)`.
7. **Placebo control** — coefficient on `ln(1 + slug length)`, labelled *control — must not help*; it is fitted and printed in the term table but never admitted into the final model.

On the practice snapshot only the size curve survives (fitted slope ≈ 0.46 — value scales sub-linearly with TVL); category, growth, age, and breadth each fail at least one of the two tests and are shown, not used.

### Validation definitions

- **Miss multiple** = `exp(median |ln(pred) − ln(actual)|)` — the typical factor by which a prediction misses.
- **Leave-one-out (LOO)** — brute-force refits leaving one peer out, predicting that peer.
- **Walk-forward** — value peers sorted by `listed_at` ascending; train on the first 65%, test on the last 35% (split counts and the date boundary are printed).
- **Two extra holdouts** — deterministic splits with `FNV-1a(slug) mod 5 == 0` and `== 1` as test sets, final model vs flat baseline.

Practice-snapshot grades: LOO ×3.23 vs ×5.00 flat; walk-forward ×3.04 vs ×5.29 flat; holdouts ×3.37 vs ×3.52 and ×2.32 vs ×3.59.

### Prediction ranges and calibration

From the final model's LOO residuals, quantiles q10/q25/q75/q90 of `ln(actual/pred)` are taken globally and blended toward each category's own quantiles with weight `n/(n+8)` when that category has traded peers. Each board row's value-if-it-launches gets a P25–P75 and a P10–P90 range by multiplying by `exp(quantiles)`. Calibration is printed on the cover: the share of value peers whose actual market cap falls inside their own LOO P25–P75 and P10–P90, against the stated 50% / 80% — on the practice snapshot 51% and 81%, with a generated sentence that says plainly if the ranges run narrow or wide on a given snapshot. Each row also carries a **rank range**: the board re-sorted by P75-implied value (best) and by P25-implied value (worst).

## Odds Model — fitted on the peers' record

Logistic regression on the odds universe (deterministic full-batch gradient descent on standardized features, 300 fixed iterations, ridge 1e-3, probabilities clamped to [0.01, 0.99]). Candidate terms in fixed order — base rate (baseline) → age in years → `ln(TVL)` → category-group effect (shrunk log-odds offset per category, computed inside each training fold) → 7-day growth → `ln(chains)`. A term is kept only if it lowers BOTH the **10-fold Brier score** (folds: `FNV-1a(slug) mod 10`) AND the **walk-forward Brier score** (same 65/35 `listed_at` split). Called-right % at a 0.5 threshold is printed alongside.

Practice-snapshot grades: Brier 0.203 (10-fold) / 0.209 (walk-forward) vs base-rate 0.251 / 0.297; called right 70% vs 49%. Age, category group, and growth are kept; size and breadth are not.

## Board Rows

```text
implied_value_usd = round(value_if_launches × launch_odds), clamped to [1, 1e14]
```

Rows sort by implied value desc, TVL desc, slug asc. Each row carries the fitted value, the odds, both ranges, the rank range, and the farm economics below, in addition to the snapshot fields and the 6-step farm plan. The 6 steps keep their exact `"ACTION Cost: COST. Time: TIME."` format; each step object also carries numeric `gas_low_usd` / `gas_high_usd` and `hours` computed from the same template quantities that produce the strings, and `fees_usd` is the sum of the gas midpoints.

## Farm Economics (the "Standard:" scenario, printed on the cover)

- `deposit = clamp(0.02% of TVL, $100, $50,000)`
- `drop pool = 7% of value-if-launches` (stated scenario assumption)
- `your share = deposit / (deposit + farmer capital of 5× the drop pool)`, capped at 1 — competing farmer capital is a stated assumption: farmers together park five times the drop pool; `expected = odds × drop pool × share`
- time cost = `hours × $25`; opportunity cost = `deposit × 5% × (12/52)` (T-bill, 12-week horizon)
- `net = expected − fees − time cost − opportunity cost`; `net/hour = (expected − fees − opportunity cost) / hours`
- **Verdict**: `FARM` if net > 0 and net/hour ≥ $25; `MARGINAL` if net > 0; otherwise `SKIP`.

On the practice snapshot the answer under this standard is FARM 153 of 198 (0 marginal, 45 skip) — with the share measured against competing farmer capital of 5× the drop pool rather than against the protocol's whole TVL, most rows' expected drop covers their fees, time at $25/hour, and idle-cash cost; every row is printed with its net and net/hour so the margin is visible rather than hidden.

## Accounting & Integrity

Every protocol in the snapshot lands in exactly one group, and the groups sum to the snapshot total: ranked (board) · set aside — bridge / liquid staking & restaking / exchange / versioned-or-wrapped · records a token — priced comps (the value peers) / other usable (cap and TVL but no date) / no usable cap. The cover's integrity line reports: this table = `board.json` · N of N rows · ranks 1–N in order, values never rise · totals equal (the sum of implied values) · watchlist n/n ranked · seal = first 8 hex of the SHA-256 of the exact `board.json` bytes (computed in `main.ts` with `node:crypto`).

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
- `data.js` — `window.RADAR = ...;` static payload consumed by the dashboard (includes the validation tables, accounting groups, scenario constants, and seal)
- `dashboard/` — static HTML/CSS/JS dashboard bundle (`index.html`, `app.css`, `app.js`)
- `screenshots/` — copied PNG screenshots (at least 3 required to build `dossier.json`)
- `dossier.json` — packaged submission dossier built by `vendor/makefun-board.ts`

---

## Dashboard Views

Opening `dashboard/index.html` (with `../data.js` generated alongside it) provides:

1. **Cover (Board)** — KPI strip headlined by the out-of-sample grades (walk-forward and leave-one-out miss vs flat, range calibration vs stated coverage, odds Brier vs base rate, terms kept, farm verdict counts, watchlist coverage), the formula line, the accounting bar with the integrity line, and the **Out-of-sample evidence** panel (value term table, odds term table, range honesty + fitted coefficients in plain words). Below: the Standard scenario line, verdict filter chips (All / Farm / Marginal / Skip) alongside search, category, chain, watchlist, and sort controls, and the board itself — rank, rank range, protocol, TVL, 7D, age, token-odds bar, value-if-it-launches, implied value with its P25–P75 subline, net with deposit/fees note, and the verdict chip. Clicking a row opens the detail drawer (`#p=<slug>`) with the fitted value breakdown, the odds drivers, the range, the full farm-economics block, the 6 farm steps, and the category's trading peers. Category effects live in a collapsed section below the board.
2. **Set aside** (`#tab=aside`): Excluded pre-token protocols with category, TVL, and exclusion reason.
3. **Trading now** (`#tab=live`): Top 24 already-trading protocols by market cap — the record the models were fitted on.

---

## Repository Layout

```text
main.ts                  CLI entry point, validation, output writer, seal, dossier builder
lib/
  model.ts               Snapshot parser, eligibility, peer sets, fitted value + odds models,
                         validation, ranges, farm plans + economics, accounting, gate check
vendor/
  makefun-board.ts       Dossier packager (buildDossier)
dashboard/
  index.html             Static HTML shell loading ../data.js and app.js
  app.css                Dashboard styles
  app.js                 Vanilla DOM dashboard UI and hash router
screenshots/             Dashboard PNG screenshots (3 images)
tools/
  gate-check.mjs         Local gate & determinism self-check
  shoot.mjs              Headless Chromium (CDP) screenshot capture script
```
