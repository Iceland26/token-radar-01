// Token Radar model (radar-3): a FITTED value model and a FITTED token-launch odds model,
// both selected term-by-term against out-of-sample tests on the snapshot's own traded peers,
// plus prediction ranges with measured calibration and a costed farm verdict per protocol.
// Runs on Node 22 with standard library only; deterministic output (no Date.now, no randomness —
// deterministic splits use a fixed FNV-1a hash of the slug).

/** One protocol entry in snapshot.json: the ten sealed DefiLlama fields. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The sealed snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** Legacy radar-2 constants, kept only for the small-peer-set fallback multiple. */
export interface ModelConstants {
  version: string;
  prior_weight: number;
  multiple_floor: number;
  multiple_cap: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_step: number;
  breadth_max_extra_chains: number;
  global_multiple?: number;
}

export const MODEL_VERSION = 'radar-3';

export const MODEL: ModelConstants = {
  version: MODEL_VERSION,
  prior_weight: 4,
  multiple_floor: 0.02,
  multiple_cap: 3.0,
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 150,
  maturity_floor: 0.65,
  maturity_range: 0.35,
  maturity_days: 1460,
  unknown_age_days: 365,
  breadth_step: 0.04,
  breadth_max_extra_chains: 5,
};

export const LIVE_ROWS = 24;

/** Farm scenario constants (printed on the dashboard cover as the "Standard:" line). */
export const SCENARIO = {
  deposit_pct_of_tvl: 0.0002,
  deposit_min_usd: 100,
  deposit_max_usd: 50_000,
  drop_pool_pct_of_value: 0.07,
  hourly_rate_usd: 25,
  tbill_rate: 0.05,
  horizon_weeks: 12,
};

/** Structured representation of one farm step before rendering to a single string. */
export interface FarmStep {
  action: string;
  cost: string;
  time: string;
  /** Numeric gas/fee range behind the cost string (principal excluded). */
  gas_low_usd: number;
  gas_high_usd: number;
  /** Hands-on hours this step takes (holding time converted to weekly tending time). */
  hours: number;
}

/** Per-category empirical multiple breakdown (fallback model + collapsed dashboard section). */
export interface CategoryMultipleRow {
  category: string;
  board_count: number;
  live_peers: number;
  raw_median: number | null;
  multiple_used: number;
  multiple: number;
}

/** Breakdown of model components on a ranked board row. */
export interface RowModelBreakdown {
  category_multiple: number;
  peer_count: number;
  raw_category_median: number | null;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  age_days: number | null;
  /** Fitted value breakdown (radar-3): multiplicative effects of the kept terms. */
  base_value_usd: number;
  category_effect: number;
  growth_effect: number;
  age_effect: number;
  breadth_effect: number;
  odds_drivers: { label: string; contribution: number }[];
}

/** One ranked row on the board (and in window.RADAR.rows). */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  category_multiple: number;
  peer_count: number;
  raw_category_median: number | null;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  capital_usd: number;
  hold_days: number;
  model: RowModelBreakdown;
  farm_steps: string[];
  /* radar-3 additions */
  launch_odds: number;
  value_if_launches_usd: number;
  range_p25_usd: number;
  range_p75_usd: number;
  range_p10_usd: number;
  range_p90_usd: number;
  rank_best: number;
  rank_worst: number;
  deposit_usd: number;
  fees_usd: number;
  hours: number;
  expected_usd: number;
  net_usd: number;
  net_per_hour_usd: number;
  verdict: 'FARM' | 'MARGINAL' | 'SKIP';
}

export type RadarRow = BoardRow;

/** A pre-token protocol set aside by the wrapped/staked/bridged/versioned/exchange rules. */
export interface SetAsideRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  reason: string;
}

/** A live-token protocol benchmark row, ordered by mcap_usd descending. */
export interface LiveRow {
  slug: string;
  name: string;
  symbol: string | null;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  mcap_tvl_multiple: number;
  multiple: number;
}

/** Funnel and coverage counts for the snapshot. */
export interface RadarCounts {
  protocols_scanned: number;
  pre_token_found: number;
  set_aside: number;
  board_rows: number;
  watchlist_size: number;
  watchlist_covered: number;
  early_rows: number;
  live_peers: number;
  value_peers: number;
  odds_universe: number;
}

/** One row of a term-selection table (value or odds model). */
export interface TermRow {
  key: string;
  label: string;
  /** Value model: out-of-sample miss multiple. Odds model: Brier score. */
  test_a: number;
  test_b: number;
  called_right: number | null;
  status: string;
}

export interface ValidationData {
  peer_sets: {
    value_peers: number;
    odds_universe: number;
    live_peers: number;
    median_age_years: number;
  };
  value: {
    mode: 'fitted' | 'fallback-multiple';
    peer_count: number;
    terms: TermRow[];
    baseline: { loo: number; walk_forward: number };
    final: { loo: number; walk_forward: number };
    holdouts: { name: string; train_n: number; test_n: number; final: number; flat: number }[];
    walk_forward_split: { train_n: number; test_n: number; boundary: string | null };
    coefficients: {
      flat_multiple: number;
      intercept: number | null;
      tvl_slope: number | null;
      growth_coef: number | null;
      age_coef: number | null;
      breadth_coef: number | null;
      category_effects: { category: string; peers: number; effect: number }[];
    };
    calibration: {
      n: number;
      inside_p25_p75: number;
      inside_p10_p90: number;
      within_3x: number;
      sentence: string;
    };
    quantiles: { q10: number; q25: number; q75: number; q90: number };
  };
  odds: {
    universe_n: number;
    base_rate: number;
    terms: TermRow[];
    baseline: { brier_10fold: number; walk_forward_brier: number; called_right: number };
    final: { brier_10fold: number; walk_forward_brier: number; called_right: number };
    walk_forward_split: { train_n: number; test_n: number; boundary: string | null };
  };
}

export interface AccountingGroup {
  key: string;
  label: string;
  count: number;
}

/** Complete dataset serialized to window.RADAR in data.js. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  global_multiple: number;
  counts: RadarCounts;
  watchlist_size: number;
  watchlist_covered: number;
  board_size: number;
  early_size: number;
  set_aside_size: number;
  live_size: number;
  model: ModelConstants & { global_multiple: number };
  category_multiples: CategoryMultipleRow[];
  categories: CategoryMultipleRow[];
  rows: BoardRow[];
  set_aside: SetAsideRow[];
  live: LiveRow[];
  /* radar-3 additions */
  validation: ValidationData;
  accounting: AccountingGroup[];
  scenario: typeof SCENARIO;
  verdict_counts: { farm: number; marginal: number; skip: number };
  implied_total_usd: number;
  seal: string;
}

/** Error thrown when snapshot.json fails structural validation. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** Categories that represent bridges, liquid staking/restaking wrappers, or centralized exchanges. */
export const SET_ASIDE_CATEGORIES: ReadonlySet<string> = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** Version marker at the end of a protocol name (e.g. " V2", " v3", " 2.0", " V1.5"). */
export const VERSION_MARKER_RE = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whole-word wrapped, staked, or staking in any case. */
export const WRAPPED_OR_STAKED_WORD_RE = /\b(wrapped|staked|staking)\b/i;

/** Protocol name beginning with a major centralized exchange name. */
export const EXCHANGE_PREFIX_RE = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

export function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

export const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
export const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Median of a numeric array, or null when empty. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Quantile of a numeric array with linear interpolation, or 0 when empty. */
export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = clamp(q, 0, 1) * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(sorted.length - 1, lo + 1);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/** FNV-1a 32-bit hash of a string — the deterministic split/fold key. */
export function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Whole days from listedAt to asOf (clamped at 0), or null when listedAt is null or invalid. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** A protocol is pre-token when mcap_usd, gecko_id, and symbol are all null. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** A protocol records a token when it is not pre-token. */
export function recordsToken(p: SnapshotProtocol): boolean {
  return !isPreToken(p);
}

/**
 * Returns a short reason string if a pre-token protocol should be set aside (not ranked)
 * under the field guide's eligibility rules, or null if it is eligible to be ranked.
 */
export function setAsideReason(p: SnapshotProtocol): string | null {
  if (p.category !== null && SET_ASIDE_CATEGORIES.has(p.category)) {
    return `Excluded category: ${p.category}`;
  }
  if (VERSION_MARKER_RE.test(p.name)) {
    return 'Versioned release of an existing protocol';
  }
  if (WRAPPED_OR_STAKED_WORD_RE.test(p.name)) {
    return 'Name carries wrapped/staked/staking token marker';
  }
  if (EXCHANGE_PREFIX_RE.test(p.name)) {
    return 'Exchange-prefixed product or wrapper';
  }
  return null;
}

/** Accounting group key for a set-aside protocol, following the same rule precedence. */
export function setAsideGroup(p: SnapshotProtocol): 'bridge' | 'liquid-staking' | 'exchange' | 'versioned-wrapped' {
  if (p.category === 'Bridge' || p.category === 'Canonical Bridge') return 'bridge';
  if (p.category === 'Liquid Staking' || p.category === 'Liquid Restaking' || p.category === 'Restaked BTC') {
    return 'liquid-staking';
  }
  if (p.category === 'CEX') return 'exchange';
  if (VERSION_MARKER_RE.test(p.name) || WRAPPED_OR_STAKED_WORD_RE.test(p.name)) return 'versioned-wrapped';
  return 'exchange';
}

/** Whether a protocol is ranked on the pre-token radar board. */
export function isEligiblePreToken(p: SnapshotProtocol): boolean {
  return isPreToken(p) && setAsideReason(p) === null;
}

/** Live peers: protocols that are NOT pre-token and have mcap_usd > 0 and tvl_usd > 0. */
export function getLivePeers(protocols: readonly SnapshotProtocol[]): SnapshotProtocol[] {
  return protocols.filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
}

/** Value peers: records a token, mcap_usd > 0, tvl_usd > 0, and a usable listed_at date. */
export function getValuePeers(protocols: readonly SnapshotProtocol[], asOf: string): SnapshotProtocol[] {
  return protocols.filter(
    (p) =>
      recordsToken(p) &&
      p.mcap_usd !== null &&
      p.mcap_usd > 0 &&
      p.tvl_usd > 0 &&
      ageDays(asOf, p.listed_at) !== null,
  );
}

/** Odds universe: tvl_usd > 0 and a usable listed_at; the outcome is "records a token". */
export function getOddsUniverse(protocols: readonly SnapshotProtocol[], asOf: string): SnapshotProtocol[] {
  return protocols.filter((p) => p.tvl_usd > 0 && ageDays(asOf, p.listed_at) !== null);
}

/** Empirical category multiple statistics for a category given all live peers and globalMultiple. */
export function computeCategoryStats(
  category: string | null,
  livePeers: readonly SnapshotProtocol[],
  globalMultiple: number,
  model: ModelConstants = MODEL,
): { peerCount: number; rawMedian: number | null; multiple: number } {
  const peers = livePeers.filter((p) => (p.category ?? 'Uncategorized') === (category ?? 'Uncategorized'));
  const peerCount = peers.length;
  const ratios = peers.map((p) => (p.mcap_usd as number) / p.tvl_usd);
  const rawMedian = median(ratios);
  if (peerCount === 0 || rawMedian === null) {
    return { peerCount: 0, rawMedian: null, multiple: globalMultiple };
  }
  const shrunk = (peerCount * rawMedian + model.prior_weight * globalMultiple) / (peerCount + model.prior_weight);
  const multiple = clamp(shrunk, model.multiple_floor, model.multiple_cap);
  return { peerCount, rawMedian, multiple };
}

/** Recommended farm capital in USD from a protocol's TVL tier (used inside the farm step text). */
export function capitalForTvl(tvlUsd: number): number {
  if (tvlUsd >= 5_000_000_000) return 500;
  if (tvlUsd >= 1_000_000_000) return 250;
  if (tvlUsd >= 100_000_000) return 150;
  if (tvlUsd >= 25_000_000) return 100;
  return 50;
}

/** Recommended holding window in days from the protocol's age. */
export function holdWindowDays(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** Primary chain label for farm plan interpolation. */
export function mainChainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 && p.chains[0] ? p.chains[0] : 'its main chain';
}

/** Category-specific Step 3 (core action) and Step 4 (position-deepening action). */
function categoryActions(
  p: SnapshotProtocol,
  chain: string,
  capital: number,
): { coreAction: string; deepenAction: string } {
  const cat = p.category ?? '';
  const name = p.name;

  switch (cat) {
    case 'Lending':
    case 'CDP':
    case 'CDP Manager':
    case 'Uncollateralized Lending':
    case 'Collateral Markets':
      return {
        coreAction: `Supply $${capital} of USDC or ETH as collateral in ${name}'s main market on ${chain} and keep the collateral active.`,
        deepenAction: `Borrow a conservative 25-35% stablecoin or ETH line against your ${name} collateral on ${chain}, then complete one partial repay and re-borrow cycle.`,
      };

    case 'Dexs':
      return {
        coreAction: `Provide $${capital} of two-sided liquidity into ${name}'s deepest pool on ${chain} and hold the LP receipt in your wallet.`,
        deepenAction: `Add a second smaller range or pool position on ${name} (${chain}) and route 2-3 spot swaps through its router to register both LP and trade volume.`,
      };

    case 'Derivatives':
    case 'Interest Rate Derivatives':
    case 'Options Vault':
      return {
        coreAction: `Deposit $${capital} of USDC margin into ${name} on ${chain} and run one small delta-hedged position with conservative leverage.`,
        deepenAction: `Place a resting limit order or roll your hedged position weekly on ${name} (${chain}), and allocate a small slice to its liquidity vault if offered.`,
      };

    case 'Risk Curators':
    case 'Onchain Capital Allocator':
    case 'Yield':
    case 'Yield Aggregator':
    case 'Liquidity Manager':
    case 'Leveraged Farming':
    case 'Farm':
      return {
        coreAction: `Deposit $${capital} of USDC or native collateral into ${name}'s primary curated vault or strategy on ${chain} and retain the vault shares.`,
        deepenAction: `Split a second allocation into an additional ${name} strategy vault on ${chain} or post your vault receipt shares into an integrated DeFi market.`,
      };

    case 'RWA':
      return {
        coreAction: `Complete the onboarding ${name}'s app asks for on ${chain} and subscribe to or mint $${capital} of its yield asset.`,
        deepenAction: `Hold the minted ${name} yield token in self-custody on ${chain} and, where available, post a portion into a partner liquidity or lending market.`,
      };

    case 'Basis Trading':
      return {
        coreAction: `Deposit $${capital} of USDC into ${name}'s basis vault on ${chain} and mint the delta-neutral receipt asset.`,
        deepenAction: `Stake or lock the ${name} basis vault receipt token in its cooldown/reward module on ${chain} and compound one funding epoch distribution.`,
      };

    case 'Chain':
      return {
        coreAction: `Bridge $${capital} onto ${name} (${chain}) and use the chain itself by executing native swaps, lending, and holding a working balance.`,
        deepenAction: `Interact with at least two distinct native dApps on ${name} (${chain})—such as a liquidity pool, staking contract, or governance vote—across separate weeks.`,
      };

    case 'Staking Pool':
    case 'Restaking':
      return {
        coreAction: `Stake $${capital} of ${chain}'s native asset directly through ${name}'s staking or restaking pool on ${chain} (never a passive liquid staking wrapper).`,
        deepenAction: `Delegate your staked ${name} position to an active operator or vault on ${chain} and cast a vote on any open pool or governance proposal.`,
      };

    case 'Prediction Market':
      return {
        coreAction: `Fund your ${name} account on ${chain} with $${capital} of USDC and take sized positions across active event markets.`,
        deepenAction: `Post resting limit-order liquidity on two active ${name} orderbooks on ${chain} and redeem at least one settled market before rotating capital.`,
      };

    case 'Payments':
    case 'Crypto Card Issuer':
      return {
        coreAction: `Open a ${name} account on ${chain}, deposit $${capital} of USDC, and route real payment or card spend transactions through it.`,
        deepenAction: `Configure a recurring top-up or merchant payment flow on ${name} (${chain}) while maintaining a working USDC settlement balance.`,
      };

    case 'Insurance':
      return {
        coreAction: `Deposit $${capital} of USDC on ${chain} to buy smart-contract cover or underwrite an active ${name} coverage pool.`,
        deepenAction: `Extend your policy or stake ${name} underwriting shares in a secondary risk pool on ${chain} and participate in pool governance assessments.`,
      };

    case 'Stablecoin Wrapper':
    case 'Dual-Token Stablecoin':
      return {
        coreAction: `Mint or deposit $${capital} of the protocol's stable asset through ${name} on ${chain} and keep it in your farming wallet.`,
        deepenAction: `Stake the minted stable asset into ${name}'s yield/savings tranche on ${chain} or pair a portion in its primary stable liquidity pool.`,
      };

    case 'Indexes':
      return {
        coreAction: `Buy or mint $${capital} of ${name}'s index basket on ${chain} directly through the protocol's issuance router.`,
        deepenAction: `Supply the ${name} index basket token into an incentive gauge or secondary pool on ${chain} and hold through a rebalance epoch.`,
      };

    default:
      return {
        coreAction: `Deposit $${capital} of USDC into ${name}'s main product on ${chain} and keep the primary position active.`,
        deepenAction: `Complete a second on-chain activity on ${name} (${chain})—such as staking receipt tokens, joining a second pool, or voting in governance.`,
      };
  }
}

/** Render a FarmStep object as one string "ACTION Cost: COST. Time: TIME." clamped to 20..600 chars. */
export function stepText(step: FarmStep): string {
  const action = step.action.trim().endsWith('.') ? step.action.trim() : `${step.action.trim()}.`;
  const cost = step.cost.trim().replace(/\.$/, '');
  const time = step.time.trim().replace(/\.$/, '');
  let rendered = `${action} Cost: ${cost}. Time: ${time}.`;
  if (rendered.length > 600) {
    rendered = `${rendered.slice(0, 596)}...`;
  }
  if (rendered.length < 20) {
    rendered = `${rendered} Hold position on-chain.`;
  }
  return rendered;
}

/**
 * Build the 6 structured FarmStep objects for a protocol and its age in days.
 * Each step also carries the numeric gas range and hands-on hours behind its text,
 * so farm economics are computed from the same quantities — never parsed back from strings.
 */
export function farmStepObjects(protocol: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = mainChainOf(protocol);
  const isEth = protocol.chains[0] === 'Ethereum';
  const capital = capitalForTvl(protocol.tvl_usd);
  const holdDays = holdWindowDays(age);
  const { coreAction, deepenAction } = categoryActions(protocol, chain, capital);

  const gasStep1 = isEth ? '$10-$15 in ETH gas reserve ($8-$10 funding fee)' : `$2-$3 in ${chain} gas token ($1-$2 funding fee)`;
  const gasStep2 = isEth ? '$8-$12 in Ethereum withdrawal or L1 transfer gas' : `$1-$3 in bridge and ${chain} network gas`;
  const gasStep3 = isEth ? `$${capital} principal + $10-$15 Ethereum gas` : `$${capital} principal + $1-$3 ${chain} gas`;
  const gasStep4 = isEth ? '$8-$14 in Ethereum contract execution gas' : `$1-$3 in ${chain} contract execution gas`;
  const gasStep5 = isEth ? `$${capital} stays deployed + $8-$12 Ethereum gas per claim` : `$${capital} stays deployed + $1-$2 ${chain} gas per claim`;
  const gasStep6 = isEth ? '$8-$15 in Ethereum gas reserved for TGE claim' : `$1-$3 in ${chain} gas reserved for TGE claim`;

  const moveCapitalAction = isEth
    ? `Withdraw or transfer $${capital} of USDC or ETH directly onto Ethereum into your dedicated wallet for ${protocol.name}.`
    : `Bridge $${capital} of USDC (or native collateral) onto ${chain} using a canonical or low-fee bridge to fund your ${protocol.name} position.`;

  const tendHours = (holdDays / 7) * (10 / 60);

  return [
    {
      action: `Create a fresh self-custody wallet dedicated to ${protocol.name} and fund it with ${chain}'s native gas token.`,
      cost: gasStep1,
      time: '5 minutes',
      gas_low_usd: isEth ? 10 : 2,
      gas_high_usd: isEth ? 15 : 3,
      hours: 5 / 60,
    },
    {
      action: moveCapitalAction,
      cost: gasStep2,
      time: '10-15 minutes',
      gas_low_usd: isEth ? 8 : 1,
      gas_high_usd: isEth ? 12 : 3,
      hours: 12.5 / 60,
    },
    {
      action: coreAction,
      cost: gasStep3,
      time: '15 minutes',
      gas_low_usd: isEth ? 10 : 1,
      gas_high_usd: isEth ? 15 : 3,
      hours: 15 / 60,
    },
    {
      action: deepenAction,
      cost: gasStep4,
      time: '15 minutes',
      gas_low_usd: isEth ? 8 : 1,
      gas_high_usd: isEth ? 14 : 3,
      hours: 15 / 60,
    },
    {
      action: `Hold and tend the ${protocol.name} position on ${chain} for ${holdDays} days, claiming accrued rewards and re-checking eligibility weekly.`,
      cost: gasStep5,
      time: `${holdDays} days (10 minutes weekly)`,
      gas_low_usd: isEth ? 8 : 1,
      gas_high_usd: isEth ? 12 : 2,
      hours: tendHours,
    },
    {
      action: `Follow ${protocol.name}'s official announcements, keep ${chain} deposit records, and be ready to claim and stake or sell at the token generation event.`,
      cost: gasStep6,
      time: '15 minutes at TGE',
      gas_low_usd: isEth ? 8 : 1,
      gas_high_usd: isEth ? 15 : 3,
      hours: 15 / 60,
    },
  ];
}

/**
 * Returns 6 concrete farm steps for `protocol`, each rendered as
 * "ACTION Cost: COST. Time: TIME." between 20 and 600 characters.
 */
export function farmSteps(protocol: SnapshotProtocol, age: number | null): string[] {
  return farmStepObjects(protocol, age).map(stepText);
}

/* ==========================================================================
   Feature extraction shared by the value model, the odds model and the board
   ========================================================================== */

/** Model features for one protocol, computed against the snapshot date. */
export interface ProtocolFeatures {
  lnTvl: number;
  /** 7-day TVL change clamped to [-50, +150], as a fraction. */
  growth: number;
  ageYears: number;
  ageLn: number;
  breadthLn: number;
  placebo: number;
  category: string;
}

export function protocolFeatures(p: SnapshotProtocol, asOf: string, medianAgeYears: number): ProtocolFeatures {
  const rawGrowth = typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : 0;
  const days = ageDays(asOf, p.listed_at);
  const ageYears = days === null ? medianAgeYears : days / 365.25;
  return {
    lnTvl: Math.log(Math.max(1, p.tvl_usd)),
    growth: clamp(rawGrowth, -50, 150) / 100,
    ageYears,
    ageLn: Math.log(1 + ageYears),
    breadthLn: Math.log(Math.max(1, p.chains.length)),
    placebo: Math.log(1 + p.slug.length),
    category: p.category ?? 'Uncategorized',
  };
}

/** Median age in years across protocols that carry a listed_at date (fallback age). */
export function medianAgeYearsOf(protocols: readonly SnapshotProtocol[], asOf: string): number {
  const years: number[] = [];
  for (const p of protocols) {
    const d = ageDays(asOf, p.listed_at);
    if (d !== null) years.push(d / 365.25);
  }
  return median(years) ?? 1;
}

/** Sort by listed_at ascending (slug tiebreak) and split 65% train / 35% test. */
export function walkForwardSplit<T extends { listed_at: string | null; slug: string }>(
  items: readonly T[],
): { train: T[]; test: T[]; boundary: string | null } {
  const sorted = [...items].sort((a, b) => {
    const da = a.listed_at ?? '';
    const db = b.listed_at ?? '';
    if (da !== db) return da < db ? -1 : 1;
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });
  const cut = Math.max(1, Math.floor(sorted.length * 0.65));
  const train = sorted.slice(0, cut);
  const test = sorted.slice(cut);
  return { train, test, boundary: test.length > 0 ? (test[0]!.listed_at ?? null) : null };
}

/* ==========================================================================
   Value model — fitted ln(mcap) with term-by-term out-of-sample selection
   ========================================================================== */

interface ValuePeer {
  p: SnapshotProtocol;
  f: ProtocolFeatures;
  y: number; // ln(mcap_usd)
}

type ValueTermKey = 'size' | 'category' | 'growth' | 'age' | 'breadth' | 'placebo';

const VALUE_TERM_ORDER: { key: ValueTermKey; label: string }[] = [
  { key: 'size', label: 'Size curve — slope on ln(TVL)' },
  { key: 'category', label: 'Category effect — shrunk offset' },
  { key: 'growth', label: '7-day growth — clamped' },
  { key: 'age', label: 'Age — ln(1 + age years)' },
  { key: 'breadth', label: 'Breadth — ln(chain count)' },
];

interface FittedValueModel {
  terms: ReadonlySet<ValueTermKey>;
  /** When the size curve is not kept: ln of the flat mcap/TVL multiple. Otherwise the OLS intercept. */
  intercept: number;
  /** OLS slope on ln(TVL); null when the size curve is not kept (slope is then exactly 1). */
  slope: number | null;
  catOffsets: Map<string, number>;
  growthCoef: number;
  ageCoef: number;
  breadthCoef: number;
  placeboCoef: number;
}

function fitValueModel(train: readonly ValuePeer[], terms: ReadonlySet<ValueTermKey>): FittedValueModel {
  const model: FittedValueModel = {
    terms,
    intercept: 0,
    slope: null,
    catOffsets: new Map(),
    growthCoef: 0,
    ageCoef: 0,
    breadthCoef: 0,
    placeboCoef: 0,
  };
  if (train.length === 0) return model;

  // Base: flat multiple, or the OLS size curve when kept.
  if (terms.has('size')) {
    const n = train.length;
    const mx = train.reduce((s, v) => s + v.f.lnTvl, 0) / n;
    const my = train.reduce((s, v) => s + v.y, 0) / n;
    let sxx = 0;
    let sxy = 0;
    for (const v of train) {
      sxx += (v.f.lnTvl - mx) * (v.f.lnTvl - mx);
      sxy += (v.f.lnTvl - mx) * (v.y - my);
    }
    const slope = sxx > 1e-12 ? sxy / sxx : 0;
    model.slope = slope;
    model.intercept = my - slope * mx;
  } else {
    model.intercept = median(train.map((v) => v.y - v.f.lnTvl)) ?? 0;
  }

  const basePred = (v: ValuePeer): number =>
    model.slope === null ? v.f.lnTvl + model.intercept : model.intercept + model.slope * v.f.lnTvl;
  const residuals = train.map((v) => v.y - basePred(v));

  // Category effect: shrunk mean residual per category, shrink n/(n+8).
  if (terms.has('category')) {
    const sums = new Map<string, { sum: number; n: number }>();
    train.forEach((v, i) => {
      const e = sums.get(v.f.category) ?? { sum: 0, n: 0 };
      e.sum += residuals[i]!;
      e.n += 1;
      sums.set(v.f.category, e);
    });
    for (const [cat, e] of sums) {
      model.catOffsets.set(cat, e.sum / (e.n + 8));
    }
    train.forEach((v, i) => {
      residuals[i] = residuals[i]! - (model.catOffsets.get(v.f.category) ?? 0);
    });
  }

  // Single-coefficient terms fitted on the remaining residuals, in fixed order.
  const fitCoef = (pick: (f: ProtocolFeatures) => number): number => {
    let num = 0;
    let den = 0;
    train.forEach((v, i) => {
      const x = pick(v.f);
      num += residuals[i]! * x;
      den += x * x;
    });
    const coef = den > 1e-12 ? num / den : 0;
    train.forEach((v, i) => {
      residuals[i] = residuals[i]! - coef * pick(v.f);
    });
    return coef;
  };
  if (terms.has('growth')) model.growthCoef = fitCoef((f) => f.growth);
  if (terms.has('age')) model.ageCoef = fitCoef((f) => f.ageLn);
  if (terms.has('breadth')) model.breadthCoef = fitCoef((f) => f.breadthLn);
  if (terms.has('placebo')) model.placeboCoef = fitCoef((f) => f.placebo);
  return model;
}

function predictValue(model: FittedValueModel, f: ProtocolFeatures): number {
  let pred = model.slope === null ? f.lnTvl + model.intercept : model.intercept + model.slope * f.lnTvl;
  if (model.terms.has('category')) pred += model.catOffsets.get(f.category) ?? 0;
  if (model.terms.has('growth')) pred += model.growthCoef * f.growth;
  if (model.terms.has('age')) pred += model.ageCoef * f.ageLn;
  if (model.terms.has('breadth')) pred += model.breadthCoef * f.breadthLn;
  if (model.terms.has('placebo')) pred += model.placeboCoef * f.placebo;
  return pred;
}

/** Out-of-sample miss multiple: exp(median |ln(pred) − ln(actual)|). */
function missMultiple(errors: readonly number[]): number {
  if (errors.length === 0) return Number.POSITIVE_INFINITY;
  return Math.exp(median(errors.map((e) => Math.abs(e))) ?? 0);
}

/** Leave-one-out errors for a term set over the value peers (brute-force refits). */
function valueLooErrors(peers: readonly ValuePeer[], terms: ReadonlySet<ValueTermKey>): number[] {
  const errors: number[] = [];
  for (let i = 0; i < peers.length; i++) {
    const train = peers.filter((_, j) => j !== i);
    const model = fitValueModel(train, terms);
    errors.push(predictValue(model, peers[i]!.f) - peers[i]!.y);
  }
  return errors;
}

function valueWalkForward(
  peers: readonly ValuePeer[],
  terms: ReadonlySet<ValueTermKey>,
): { miss: number; train_n: number; test_n: number; boundary: string | null } {
  const split = walkForwardSplit(peers.map((v) => v.p));
  const trainSet = new Set(split.train.map((p) => p.slug));
  const train = peers.filter((v) => trainSet.has(v.p.slug));
  const test = peers.filter((v) => !trainSet.has(v.p.slug));
  const model = fitValueModel(train, terms);
  const miss = missMultiple(test.map((v) => predictValue(model, v.f) - v.y));
  return { miss, train_n: train.length, test_n: test.length, boundary: split.boundary };
}

interface ValueFitResult {
  model: FittedValueModel;
  terms: TermRow[];
  baseline: { loo: number; walk_forward: number };
  final: { loo: number; walk_forward: number };
  holdouts: { name: string; train_n: number; test_n: number; final: number; flat: number }[];
  wfSplit: { train_n: number; test_n: number; boundary: string | null };
  looErrors: number[];
}

function selectValueTerms(peers: readonly ValuePeer[]): ValueFitResult {
  const empty: ReadonlySet<ValueTermKey> = new Set();
  const baseLoo = missMultiple(valueLooErrors(peers, empty));
  const baseWf = valueWalkForward(peers, empty);
  const terms: TermRow[] = [
    {
      key: 'flat',
      label: 'Flat multiple (baseline)',
      test_a: round4(baseLoo),
      test_b: round4(baseWf.miss),
      called_right: null,
      status: 'baseline',
    },
  ];

  const kept = new Set<ValueTermKey>();
  let curLoo = baseLoo;
  let curWf = baseWf.miss;
  for (const { key, label } of VALUE_TERM_ORDER) {
    const trial = new Set<ValueTermKey>([...kept, key]);
    const loo = missMultiple(valueLooErrors(peers, trial));
    const wf = valueWalkForward(peers, trial).miss;
    const keep = loo < curLoo - 1e-12 && wf < curWf - 1e-12;
    terms.push({
      key,
      label,
      test_a: round4(loo),
      test_b: round4(wf),
      called_right: null,
      status: keep ? 'kept' : 'tested, not kept',
    });
    if (keep) {
      kept.add(key);
      curLoo = loo;
      curWf = wf;
    }
  }

  // Placebo control: fitted and reported, never admitted into the final model.
  const placeboTrial = new Set<ValueTermKey>([...kept, 'placebo']);
  const pLoo = missMultiple(valueLooErrors(peers, placeboTrial));
  const pWf = valueWalkForward(peers, placeboTrial).miss;
  terms.push({
    key: 'placebo',
    label: 'Placebo — ln(1 + slug length)',
    test_a: round4(pLoo),
    test_b: round4(pWf),
    called_right: null,
    status: 'control — not used',
  });

  const holdouts = [0, 1].map((mod) => {
    const test = peers.filter((v) => fnv1a(v.p.slug) % 5 === mod);
    const train = peers.filter((v) => fnv1a(v.p.slug) % 5 !== mod);
    const finalModel = fitValueModel(train, kept);
    const flatModel = fitValueModel(train, empty);
    return {
      name: `holdout fnv%5==${mod}`,
      train_n: train.length,
      test_n: test.length,
      final: round4(missMultiple(test.map((v) => predictValue(finalModel, v.f) - v.y))),
      flat: round4(missMultiple(test.map((v) => predictValue(flatModel, v.f) - v.y))),
    };
  });

  return {
    model: fitValueModel(peers, kept),
    terms,
    baseline: { loo: round4(baseLoo), walk_forward: round4(baseWf.miss) },
    final: { loo: round4(curLoo), walk_forward: round4(curWf) },
    holdouts,
    wfSplit: { train_n: baseWf.train_n, test_n: baseWf.test_n, boundary: baseWf.boundary },
    looErrors: valueLooErrors(peers, kept),
  };
}

/* ==========================================================================
   Odds model — fitted logistic regression on the peers' own record
   ========================================================================== */

interface OddsItem {
  p: SnapshotProtocol;
  f: ProtocolFeatures;
  y: 0 | 1;
}

type OddsTermKey = 'age' | 'lntvl' | 'category' | 'growth' | 'lnchains';

const ODDS_TERM_ORDER: { key: OddsTermKey; label: string }[] = [
  { key: 'age', label: 'Age — years listed' },
  { key: 'lntvl', label: 'Size — ln(TVL)' },
  { key: 'category', label: 'Category group — shrunk offset' },
  { key: 'growth', label: '7-day growth — clamped' },
  { key: 'lnchains', label: 'Breadth — ln(chain count)' },
];

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-clamp(x, -30, 30)));
const logit = (p: number): number => Math.log(p / (1 - p));

interface FittedOddsModel {
  keys: OddsTermKey[];
  intercept: number;
  weights: Map<OddsTermKey, number>;
  means: Map<OddsTermKey, number>;
  stds: Map<OddsTermKey, number>;
  catOffsets: Map<string, number>;
  baseRate: number;
}

/** Shrunk log-odds offset per category, computed from a training set only. */
function categoryOddsOffsets(train: readonly OddsItem[], baseRate: number): Map<string, number> {
  const counts = new Map<string, { n: number; k: number }>();
  for (const it of train) {
    const e = counts.get(it.f.category) ?? { n: 0, k: 0 };
    e.n += 1;
    e.k += it.y;
    counts.set(it.f.category, e);
  }
  const base = clamp(baseRate, 0.01, 0.99);
  const offsets = new Map<string, number>();
  for (const [cat, e] of counts) {
    const shrunkRate = (e.k + 8 * base) / (e.n + 8);
    offsets.set(cat, logit(clamp(shrunkRate, 0.001, 0.999)) - logit(base));
  }
  return offsets;
}

function oddsRawFeature(
  key: OddsTermKey,
  item: OddsItem,
  catOffsets: Map<string, number>,
): number {
  switch (key) {
    case 'age':
      return item.f.ageYears;
    case 'lntvl':
      return item.f.lnTvl;
    case 'category':
      return catOffsets.get(item.f.category) ?? 0;
    case 'growth':
      return item.f.growth;
    case 'lnchains':
      return item.f.breadthLn;
  }
}

/**
 * Fit the logistic odds model by deterministic full-batch gradient descent
 * (300 fixed iterations, learning rate 0.5, ridge 1e-3 on the weights,
 * features standardized on the training set, probabilities clamped to [0.01, 0.99]).
 */
function fitOddsModel(train: readonly OddsItem[], keys: readonly OddsTermKey[]): FittedOddsModel {
  const baseRate = train.length > 0 ? train.reduce((s, it) => s + it.y, 0) / train.length : 0.5;
  const catOffsets = categoryOddsOffsets(train, baseRate);
  const means = new Map<OddsTermKey, number>();
  const stds = new Map<OddsTermKey, number>();
  for (const key of keys) {
    const vals = train.map((it) => oddsRawFeature(key, it, catOffsets));
    const mean = vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
    const variance = vals.length > 0 ? vals.reduce((s, v) => s + (v - mean) * (v - mean), 0) / vals.length : 0;
    const std = Math.sqrt(variance);
    means.set(key, mean);
    stds.set(key, std > 1e-9 ? std : 1);
  }

  const z = train.map((it) => keys.map((key) => (oddsRawFeature(key, it, catOffsets) - means.get(key)!) / stds.get(key)!));
  const weights = new Map<OddsTermKey, number>(keys.map((key) => [key, 0]));
  let intercept = logit(clamp(baseRate, 0.01, 0.99));
  const n = Math.max(1, train.length);
  const ridge = 1e-3;
  const lr = 0.5;
  for (let iter = 0; iter < 300; iter++) {
    const gradW = keys.map(() => 0);
    let gradB = 0;
    for (let i = 0; i < train.length; i++) {
      let eta = intercept;
      for (let j = 0; j < keys.length; j++) eta += weights.get(keys[j]!)! * z[i]![j]!;
      const err = sigmoid(eta) - train[i]!.y;
      gradB += err;
      for (let j = 0; j < keys.length; j++) gradW[j] += err * z[i]![j]!;
    }
    intercept -= lr * (gradB / n);
    keys.forEach((key, j) => {
      const w = weights.get(key)!;
      weights.set(key, w - lr * (gradW[j]! / n + ridge * w));
    });
  }

  return { keys: [...keys], intercept, weights, means, stds, catOffsets, baseRate };
}

function predictOdds(model: FittedOddsModel, item: OddsItem): number {
  let eta = model.intercept;
  for (const key of model.keys) {
    const z = (oddsRawFeature(key, item, model.catOffsets) - model.means.get(key)!) / model.stds.get(key)!;
    eta += model.weights.get(key)! * z;
  }
  return clamp(sigmoid(eta), 0.01, 0.99);
}

/** Per-feature log-odds contributions for one protocol under a fitted odds model. */
function oddsDrivers(model: FittedOddsModel, item: OddsItem): { label: string; contribution: number }[] {
  const labels: Record<OddsTermKey, string> = {
    age: 'Age',
    lntvl: 'TVL size',
    category: 'Category record',
    growth: '7-day growth',
    lnchains: 'Chain breadth',
  };
  return model.keys
    .map((key) => {
      const z = (oddsRawFeature(key, item, model.catOffsets) - model.means.get(key)!) / model.stds.get(key)!;
      return { label: labels[key], contribution: round4(model.weights.get(key)! * z) };
    })
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
}

interface OddsEval {
  brier: number;
  calledRight: number;
}

/** 10-fold cross-validated Brier + called-right (folds: FNV-1a(slug) mod 10). */
function oddsTenFold(items: readonly OddsItem[], keys: readonly OddsTermKey[]): OddsEval {
  let brierSum = 0;
  let right = 0;
  for (let fold = 0; fold < 10; fold++) {
    const test = items.filter((it) => fnv1a(it.p.slug) % 10 === fold);
    if (test.length === 0) continue;
    const train = items.filter((it) => fnv1a(it.p.slug) % 10 !== fold);
    const model = fitOddsModel(train, keys);
    for (const it of test) {
      const p = predictOdds(model, it);
      brierSum += (p - it.y) * (p - it.y);
      if ((p >= 0.5) === (it.y === 1)) right++;
    }
  }
  const n = Math.max(1, items.length);
  return { brier: brierSum / n, calledRight: right / n };
}

/** Walk-forward Brier + called-right on the last 35% by listed_at. */
function oddsWalkForward(
  items: readonly OddsItem[],
  keys: readonly OddsTermKey[],
): OddsEval & { train_n: number; test_n: number; boundary: string | null } {
  const split = walkForwardSplit(items.map((it) => it.p));
  const trainSet = new Set(split.train.map((p) => p.slug));
  const train = items.filter((it) => trainSet.has(it.p.slug));
  const test = items.filter((it) => !trainSet.has(it.p.slug));
  const model = fitOddsModel(train, keys);
  let brierSum = 0;
  let right = 0;
  for (const it of test) {
    const p = predictOdds(model, it);
    brierSum += (p - it.y) * (p - it.y);
    if ((p >= 0.5) === (it.y === 1)) right++;
  }
  const n = Math.max(1, test.length);
  return { brier: brierSum / n, calledRight: right / n, train_n: train.length, test_n: test.length, boundary: split.boundary };
}

/** Constant base-rate predictions evaluated the same two ways (the odds baseline). */
function oddsBaselineEval(items: readonly OddsItem[]): { tenFold: OddsEval; wf: OddsEval } {
  let brierSum = 0;
  let right = 0;
  for (let fold = 0; fold < 10; fold++) {
    const test = items.filter((it) => fnv1a(it.p.slug) % 10 === fold);
    if (test.length === 0) continue;
    const train = items.filter((it) => fnv1a(it.p.slug) % 10 !== fold);
    const base = train.length > 0 ? train.reduce((s, it) => s + it.y, 0) / train.length : 0.5;
    for (const it of test) {
      brierSum += (base - it.y) * (base - it.y);
      if ((base >= 0.5) === (it.y === 1)) right++;
    }
  }
  const n = Math.max(1, items.length);
  const split = walkForwardSplit(items.map((it) => it.p));
  const trainSet = new Set(split.train.map((p) => p.slug));
  const train = items.filter((it) => trainSet.has(it.p.slug));
  const test = items.filter((it) => !trainSet.has(it.p.slug));
  const wfBase = train.length > 0 ? train.reduce((s, it) => s + it.y, 0) / train.length : 0.5;
  let wfBrier = 0;
  let wfRight = 0;
  for (const it of test) {
    wfBrier += (wfBase - it.y) * (wfBase - it.y);
    if ((wfBase >= 0.5) === (it.y === 1)) wfRight++;
  }
  const tn = Math.max(1, test.length);
  return {
    tenFold: { brier: brierSum / n, calledRight: right / n },
    wf: { brier: wfBrier / tn, calledRight: wfRight / tn },
  };
}

interface OddsFitResult {
  model: FittedOddsModel;
  terms: TermRow[];
  baseline: { brier_10fold: number; walk_forward_brier: number; called_right: number };
  final: { brier_10fold: number; walk_forward_brier: number; called_right: number };
  wfSplit: { train_n: number; test_n: number; boundary: string | null };
  baseRate: number;
}

function selectOddsTerms(items: readonly OddsItem[]): OddsFitResult {
  const baseRate = items.length > 0 ? items.reduce((s, it) => s + it.y, 0) / items.length : 0.5;
  const base = oddsBaselineEval(items);
  const wfInfo = oddsWalkForward(items, []);
  const terms: TermRow[] = [
    {
      key: 'base',
      label: 'Base rate for all',
      test_a: round4(base.tenFold.brier),
      test_b: round4(base.wf.brier),
      called_right: round4(base.tenFold.calledRight),
      status: 'baseline',
    },
  ];

  const kept: OddsTermKey[] = [];
  let curBrier = base.tenFold.brier;
  let curWf = base.wf.brier;
  for (const { key, label } of ODDS_TERM_ORDER) {
    const trial = [...kept, key];
    const tf = oddsTenFold(items, trial);
    const wf = oddsWalkForward(items, trial);
    const keep = tf.brier < curBrier - 1e-12 && wf.brier < curWf - 1e-12;
    terms.push({
      key,
      label,
      test_a: round4(tf.brier),
      test_b: round4(wf.brier),
      called_right: round4(tf.calledRight),
      status: keep ? 'kept' : 'tested, not kept',
    });
    if (keep) {
      kept.push(key);
      curBrier = tf.brier;
      curWf = wf.brier;
    }
  }

  const finalTf = oddsTenFold(items, kept);
  const finalWf = oddsWalkForward(items, kept);
  return {
    model: fitOddsModel(items, kept),
    terms,
    baseline: {
      brier_10fold: round4(base.tenFold.brier),
      walk_forward_brier: round4(base.wf.brier),
      called_right: round4(base.tenFold.calledRight),
    },
    final: {
      brier_10fold: round4(finalTf.brier),
      walk_forward_brier: round4(finalWf.brier),
      called_right: round4(finalTf.calledRight),
    },
    wfSplit: { train_n: wfInfo.train_n, test_n: wfInfo.test_n, boundary: wfInfo.boundary },
    baseRate,
  };
}

/* ==========================================================================
   Board assembly
   ========================================================================== */

/** Build the full ranked board and dashboard radar dataset from a validated Snapshot. */
export function buildRadar(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): { board: BoardRow[]; radar: RadarData } {
  const watchlistSet = new Set(snapshot.watchlist);
  const livePeers = getLivePeers(snapshot.protocols);
  const peerRatios = livePeers.map((p) => (p.mcap_usd as number) / p.tvl_usd);
  const globalMultiple = median(peerRatios) ?? 0.25;

  const valuePeerProtocols = getValuePeers(snapshot.protocols, snapshot.as_of);
  const oddsUniverseProtocols = getOddsUniverse(snapshot.protocols, snapshot.as_of);
  const medianAge = medianAgeYearsOf(snapshot.protocols, snapshot.as_of);

  const toValuePeer = (p: SnapshotProtocol): ValuePeer => ({
    p,
    f: protocolFeatures(p, snapshot.as_of, medianAge),
    y: Math.log(p.mcap_usd as number),
  });
  const toOddsItem = (p: SnapshotProtocol): OddsItem => ({
    p,
    f: protocolFeatures(p, snapshot.as_of, medianAge),
    y: recordsToken(p) ? 1 : 0,
  });

  /* --- Value model: fitted when enough peers, shrunk-median fallback otherwise --- */
  const valuePeers = valuePeerProtocols.map(toValuePeer);
  const fitted = valuePeers.length >= 30 ? selectValueTerms(valuePeers) : null;

  let valueQuantiles = { q10: 0, q25: 0, q75: 0, q90: 0 };
  // Per-category range quantiles: the global LOO quantiles blended toward the category's own
  // LOO quantiles with weight n/(n+8) when the category has traded peers. Rows whose category
  // has no value peers use the global quantiles unchanged.
  let rowQuantiles: (category: string) => { q10: number; q25: number; q75: number; q90: number } = () => valueQuantiles;
  let calibration: ValidationData['value']['calibration'];
  let valueValidation: ValidationData['value'];

  // Category stats are needed for the fallback and for the legacy row fields either way.
  const categoryStatsCache = new Map<string, { peerCount: number; rawMedian: number | null; multiple: number }>();
  const catStatsFor = (category: string | null) => {
    const key = category ?? 'Uncategorized';
    if (!categoryStatsCache.has(key)) {
      categoryStatsCache.set(key, computeCategoryStats(category, livePeers, globalMultiple, model));
    }
    return categoryStatsCache.get(key)!;
  };

  if (fitted !== null) {
    const errs = fitted.looErrors.map((e) => -e); // ln(actual / predicted)
    valueQuantiles = {
      q10: quantile(errs, 0.1),
      q25: quantile(errs, 0.25),
      q75: quantile(errs, 0.75),
      q90: quantile(errs, 0.9),
    };
    const errsByCat = new Map<string, number[]>();
    valuePeers.forEach((v, i) => {
      const arr = errsByCat.get(v.f.category) ?? [];
      arr.push(errs[i]!);
      errsByCat.set(v.f.category, arr);
    });
    const blendedQuantiles = (category: string) => {
      const own = errsByCat.get(category);
      if (!own || own.length === 0) return valueQuantiles;
      const w = own.length / (own.length + 8);
      const blend = (global: number, q: number) => global + w * (quantile(own, q) - global);
      return {
        q10: blend(valueQuantiles.q10, 0.1),
        q25: blend(valueQuantiles.q25, 0.25),
        q75: blend(valueQuantiles.q75, 0.75),
        q90: blend(valueQuantiles.q90, 0.9),
      };
    };
    rowQuantiles = blendedQuantiles;
    const n = Math.max(1, errs.length);
    const inInner =
      errs.filter((e, i) => {
        const q = blendedQuantiles(valuePeers[i]!.f.category);
        return e >= q.q25 && e <= q.q75;
      }).length / n;
    const inOuter =
      errs.filter((e, i) => {
        const q = blendedQuantiles(valuePeers[i]!.f.category);
        return e >= q.q10 && e <= q.q90;
      }).length / n;
    const within3 = errs.filter((e) => Math.abs(e) <= Math.log(3)).length / n;
    const dIn = inInner - 0.5;
    const dOut = inOuter - 0.8;
    const phrase =
      Math.abs(dIn) <= 0.07 && Math.abs(dOut) <= 0.07
        ? 'run close to their stated coverage'
        : dIn < 0 && dOut < 0
          ? 'run narrow — held-out values escape them more often than stated'
          : dIn > 0 && dOut > 0
            ? 'run wide — held-out values land inside more often than stated'
            : 'run mixed — the inner and outer ranges miss their stated coverage in opposite directions';
    calibration = {
      n: errs.length,
      inside_p25_p75: round4(inInner),
      inside_p10_p90: round4(inOuter),
      within_3x: round4(within3),
      sentence:
        `On leave-one-out peers the printed ranges ${phrase}: ` +
        `${Math.round(inInner * 100)}% land inside their P25–P75 (stated 50%) and ` +
        `${Math.round(inOuter * 100)}% inside their P10–P90 (stated 80%).`,
    };
    const fm = fitted.model;
    const catEffects = [...fm.catOffsets.entries()]
      .map(([category, offset]) => ({
        category,
        peers: valuePeers.filter((v) => v.f.category === category).length,
        effect: round4(Math.exp(offset)),
      }))
      .sort((a, b) => b.peers - a.peers || (a.category < b.category ? -1 : 1))
      .slice(0, 24);
    valueValidation = {
      mode: 'fitted',
      peer_count: valuePeers.length,
      terms: fitted.terms,
      baseline: fitted.baseline,
      final: fitted.final,
      holdouts: fitted.holdouts,
      walk_forward_split: fitted.wfSplit,
      coefficients: {
        flat_multiple: round4(Math.exp(fitValueModel(valuePeers, new Set()).intercept)),
        intercept: fm.slope === null ? null : round4(fm.intercept),
        tvl_slope: fm.slope === null ? null : round4(fm.slope),
        growth_coef: fm.terms.has('growth') ? round4(fm.growthCoef) : null,
        age_coef: fm.terms.has('age') ? round4(fm.ageCoef) : null,
        breadth_coef: fm.terms.has('breadth') ? round4(fm.breadthCoef) : null,
        category_effects: catEffects,
      },
      calibration,
      quantiles: {
        q10: round4(valueQuantiles.q10),
        q25: round4(valueQuantiles.q25),
        q75: round4(valueQuantiles.q75),
        q90: round4(valueQuantiles.q90),
      },
    };
  } else {
    // Fallback: too few dated peers to fit — use the shrunk category multiple and
    // measure the ranges on every live peer's own multiple residual instead.
    const errs = livePeers.map((p) => {
      const mult = catStatsFor(p.category).multiple;
      return Math.log((p.mcap_usd as number) / (p.tvl_usd * mult));
    });
    valueQuantiles = {
      q10: quantile(errs, 0.1),
      q25: quantile(errs, 0.25),
      q75: quantile(errs, 0.75),
      q90: quantile(errs, 0.9),
    };
    const n = Math.max(1, errs.length);
    const inInner = errs.filter((e) => e >= valueQuantiles.q25 && e <= valueQuantiles.q75).length / n;
    const inOuter = errs.filter((e) => e >= valueQuantiles.q10 && e <= valueQuantiles.q90).length / n;
    const within3 = errs.filter((e) => Math.abs(e) <= Math.log(3)).length / n;
    calibration = {
      n: errs.length,
      inside_p25_p75: round4(inInner),
      inside_p10_p90: round4(inOuter),
      within_3x: round4(within3),
      sentence:
        `Only ${valuePeers.length} dated value peers were available, so the entry fell back to the shrunk ` +
        `category multiple; range coverage measured on all live peers: ${Math.round(inInner * 100)}% inside ` +
        `P25–P75 (stated 50%), ${Math.round(inOuter * 100)}% inside P10–P90 (stated 80%).`,
    };
    valueValidation = {
      mode: 'fallback-multiple',
      peer_count: valuePeers.length,
      terms: [],
      baseline: { loo: 0, walk_forward: 0 },
      final: { loo: 0, walk_forward: 0 },
      holdouts: [],
      walk_forward_split: { train_n: 0, test_n: 0, boundary: null },
      coefficients: {
        flat_multiple: round4(globalMultiple),
        intercept: null,
        tvl_slope: null,
        growth_coef: null,
        age_coef: null,
        breadth_coef: null,
        category_effects: [],
      },
      calibration,
      quantiles: {
        q10: round4(valueQuantiles.q10),
        q25: round4(valueQuantiles.q25),
        q75: round4(valueQuantiles.q75),
        q90: round4(valueQuantiles.q90),
      },
    };
  }

  /* --- Odds model --- */
  const oddsItems = oddsUniverseProtocols.map(toOddsItem);
  const oddsFit: OddsFitResult =
    oddsItems.length >= 30
      ? selectOddsTerms(oddsItems)
      : {
          model: fitOddsModel(oddsItems, []),
          terms: [
            {
              key: 'base',
              label: 'Base rate — every protocol gets the universe token rate',
              test_a: 0,
              test_b: 0,
              called_right: null,
              status: 'baseline (universe too small to fit)',
            },
          ],
          baseline: { brier_10fold: 0, walk_forward_brier: 0, called_right: 0 },
          final: { brier_10fold: 0, walk_forward_brier: 0, called_right: 0 },
          wfSplit: { train_n: 0, test_n: 0, boundary: null },
          baseRate: oddsItems.length > 0 ? oddsItems.reduce((s, it) => s + it.y, 0) / oddsItems.length : 0.5,
        };

  /* --- Eligibility split --- */
  const preTokenProtocols: SnapshotProtocol[] = [];
  const eligibleProtocols: SnapshotProtocol[] = [];
  const setAsideRows: SetAsideRow[] = [];

  for (const p of snapshot.protocols) {
    if (!isPreToken(p)) continue;
    preTokenProtocols.push(p);
    const reason = setAsideReason(p);
    if (reason !== null) {
      setAsideRows.push({
        slug: p.slug,
        name: p.name,
        category: p.category,
        chains: p.chains,
        tvl_usd: p.tvl_usd,
        change_7d: p.change_7d,
        reason,
      });
    } else {
      eligibleProtocols.push(p);
    }
  }

  setAsideRows.sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));

  const categoryBoardCounts = new Map<string, number>();
  for (const p of eligibleProtocols) {
    const key = p.category ?? 'Uncategorized';
    categoryBoardCounts.set(key, (categoryBoardCounts.get(key) ?? 0) + 1);
    catStatsFor(p.category);
  }

  /* --- Score every eligible protocol --- */
  interface ScoredRow {
    p: SnapshotProtocol;
    f: ProtocolFeatures;
    age: number | null;
    valueIf: number;
    odds: number;
    implied: number;
    rangeP25: number;
    rangeP75: number;
    rangeP10: number;
    rangeP90: number;
    baseValue: number;
    catEffect: number;
    growthEffect: number;
    ageEffect: number;
    breadthEffect: number;
    drivers: { label: string; contribution: number }[];
    steps: FarmStep[];
    fees: number;
    hours: number;
    deposit: number;
    expected: number;
    net: number;
    netPerHour: number;
    verdict: 'FARM' | 'MARGINAL' | 'SKIP';
  }

  const scored: ScoredRow[] = eligibleProtocols.map((p) => {
    const f = protocolFeatures(p, snapshot.as_of, medianAge);
    const age = ageDays(snapshot.as_of, p.listed_at);
    const catStats = catStatsFor(p.category);

    let valueIf: number;
    let baseValue: number;
    let catEffect = 1;
    let growthEffect = 1;
    let ageEffect = 1;
    let breadthEffect = 1;
    if (fitted !== null) {
      const fm = fitted.model;
      const baseLog = fm.slope === null ? f.lnTvl + fm.intercept : fm.intercept + fm.slope * f.lnTvl;
      baseValue = Math.exp(baseLog);
      if (fm.terms.has('category')) catEffect = Math.exp(fm.catOffsets.get(f.category) ?? 0);
      if (fm.terms.has('growth')) growthEffect = Math.exp(fm.growthCoef * f.growth);
      if (fm.terms.has('age')) ageEffect = Math.exp(fm.ageCoef * f.ageLn);
      if (fm.terms.has('breadth')) breadthEffect = Math.exp(fm.breadthCoef * f.breadthLn);
      valueIf = baseValue * catEffect * growthEffect * ageEffect * breadthEffect;
    } else {
      baseValue = p.tvl_usd * catStats.multiple;
      valueIf = baseValue;
    }
    valueIf = Math.max(1, valueIf);

    const oddsItem: OddsItem = { p, f, y: 0 };
    const odds = predictOdds(oddsFit.model, oddsItem);
    const drivers = oddsDrivers(oddsFit.model, oddsItem);

    const impliedRaw = valueIf * odds;
    const implied = clamp(Math.round(impliedRaw), 1, 1e14);
    const rq = rowQuantiles(f.category);
    const rangeOf = (q: number): number => clamp(Math.round(valueIf * Math.exp(q) * odds), 1, 1e14);

    const steps = farmStepObjects(p, age);
    const fees = steps.reduce((s, st) => s + (st.gas_low_usd + st.gas_high_usd) / 2, 0);
    const hours = steps.reduce((s, st) => s + st.hours, 0);

    const deposit = clamp(SCENARIO.deposit_pct_of_tvl * p.tvl_usd, SCENARIO.deposit_min_usd, SCENARIO.deposit_max_usd);
    const dropPool = SCENARIO.drop_pool_pct_of_value * valueIf;
    // Share model: competing farmer capital is a stated assumption of 5x the drop pool
    // (farmers together park five times the pool), so your share is
    // deposit / (deposit + farmer capital of 5x the drop pool), capped at 1.
    const competingFarmerCapital = 5 * dropPool;
    const share = Math.min(1, deposit / (deposit + competingFarmerCapital));
    const expected = odds * dropPool * share;
    const timeCost = hours * SCENARIO.hourly_rate_usd;
    const oppCost = deposit * SCENARIO.tbill_rate * (SCENARIO.horizon_weeks / 52);
    const net = expected - fees - timeCost - oppCost;
    const netPerHour = hours > 0 ? (expected - fees - oppCost) / hours : 0;
    const verdict: ScoredRow['verdict'] =
      net > 0 && netPerHour >= SCENARIO.hourly_rate_usd ? 'FARM' : net > 0 ? 'MARGINAL' : 'SKIP';

    return {
      p,
      f,
      age,
      valueIf,
      odds,
      implied,
      rangeP25: rangeOf(rq.q25),
      rangeP75: rangeOf(rq.q75),
      rangeP10: rangeOf(rq.q10),
      rangeP90: rangeOf(rq.q90),
      baseValue,
      catEffect,
      growthEffect,
      ageEffect,
      breadthEffect,
      drivers,
      steps,
      fees,
      hours,
      deposit,
      expected,
      net,
      netPerHour,
      verdict,
    };
  });

  // Sort by implied desc, then tvl_usd desc, then slug asc.
  scored.sort(
    (a, b) =>
      b.implied - a.implied ||
      b.p.tvl_usd - a.p.tvl_usd ||
      (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0),
  );

  // Rank range: re-sort by P75-implied (best) and by P25-implied (worst).
  const rankBest = new Map<string, number>();
  const rankWorst = new Map<string, number>();
  [...scored]
    .sort((a, b) => b.rangeP75 - a.rangeP75 || b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : 1))
    .forEach((s, i) => rankBest.set(s.p.slug, i + 1));
  [...scored]
    .sort((a, b) => b.rangeP25 - a.rangeP25 || b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : 1))
    .forEach((s, i) => rankWorst.set(s.p.slug, i + 1));

  const board: BoardRow[] = scored.map((s, idx) => {
    const catStats = catStatsFor(s.p.category);
    const catMult = round4(catStats.multiple);
    const rawMed = catStats.rawMedian === null ? null : round4(catStats.rawMedian);
    const growthPct = round4(s.f.growth * 100);
    const growthMult = round4(1 + (growthPct / 100) * model.growth_weight);
    const ageForLegacy = s.age ?? model.unknown_age_days;
    const maturityMult = round4(
      model.maturity_floor +
        model.maturity_range * (Math.min(Math.max(0, ageForLegacy), model.maturity_days) / model.maturity_days),
    );
    const breadthMult = round4(1 + model.breadth_step * Math.min(Math.max(1, s.p.chains.length) - 1, model.breadth_max_extra_chains));
    const onWatchlist = watchlistSet.has(s.p.slug);

    return {
      rank: idx + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token',
      age_days: s.age,
      watchlist: onWatchlist,
      implied_value_usd: s.implied,
      category_multiple: catMult,
      peer_count: catStats.peerCount,
      raw_category_median: rawMed,
      growth_pct: growthPct,
      growth_multiplier: growthMult,
      maturity_multiplier: maturityMult,
      breadth_multiplier: breadthMult,
      capital_usd: capitalForTvl(s.p.tvl_usd),
      hold_days: holdWindowDays(s.age),
      model: {
        category_multiple: catMult,
        peer_count: catStats.peerCount,
        raw_category_median: rawMed,
        growth_pct: growthPct,
        growth_multiplier: growthMult,
        maturity_multiplier: maturityMult,
        breadth_multiplier: breadthMult,
        age_days: s.age,
        base_value_usd: Math.round(s.baseValue),
        category_effect: round4(s.catEffect),
        growth_effect: round4(s.growthEffect),
        age_effect: round4(s.ageEffect),
        breadth_effect: round4(s.breadthEffect),
        odds_drivers: s.drivers,
      },
      farm_steps: s.steps.map(stepText),
      launch_odds: round4(s.odds),
      value_if_launches_usd: Math.round(s.valueIf),
      range_p25_usd: s.rangeP25,
      range_p75_usd: s.rangeP75,
      range_p10_usd: s.rangeP10,
      range_p90_usd: s.rangeP90,
      rank_best: Math.min(rankBest.get(s.p.slug) ?? idx + 1, rankWorst.get(s.p.slug) ?? idx + 1),
      rank_worst: Math.max(rankBest.get(s.p.slug) ?? idx + 1, rankWorst.get(s.p.slug) ?? idx + 1),
      deposit_usd: Math.round(s.deposit),
      fees_usd: round2(s.fees),
      hours: round4(s.hours),
      expected_usd: round2(s.expected),
      net_usd: round2(s.net),
      net_per_hour_usd: round2(s.netPerHour),
      verdict: s.verdict,
    };
  });

  const categoryMultiples: CategoryMultipleRow[] = [...categoryStatsCache.entries()]
    .map(([category, stats]) => {
      const used = round4(stats.multiple);
      return {
        category,
        board_count: categoryBoardCounts.get(category) ?? 0,
        live_peers: stats.peerCount,
        raw_median: stats.rawMedian === null ? null : round4(stats.rawMedian),
        multiple_used: used,
        multiple: used,
      };
    })
    .sort((a, b) => b.multiple_used - a.multiple_used || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));

  const live: LiveRow[] = [...livePeers]
    .sort(
      (a, b) =>
        (b.mcap_usd as number) - (a.mcap_usd as number) ||
        b.tvl_usd - a.tvl_usd ||
        (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0),
    )
    .slice(0, LIVE_ROWS)
    .map((p) => {
      const mcap = p.mcap_usd as number;
      const mult = round4(mcap / p.tvl_usd);
      return {
        slug: p.slug,
        name: p.name,
        symbol: p.symbol,
        category: p.category,
        chains: p.chains,
        tvl_usd: p.tvl_usd,
        mcap_usd: mcap,
        change_7d: p.change_7d,
        mcap_tvl_multiple: mult,
        multiple: mult,
      };
    });

  /* --- Accounting: every protocol in exactly one group --- */
  const groupCounts = new Map<string, number>();
  const bump = (key: string) => groupCounts.set(key, (groupCounts.get(key) ?? 0) + 1);
  const valuePeerSlugs = new Set(valuePeerProtocols.map((p) => p.slug));
  for (const p of snapshot.protocols) {
    if (recordsToken(p)) {
      if (valuePeerSlugs.has(p.slug)) bump('priced-comps');
      else if (p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0) bump('token-other-usable');
      else bump('token-no-cap');
    } else if (setAsideReason(p) !== null) {
      bump(setAsideGroup(p));
    } else {
      bump('ranked');
    }
  }
  const accounting: AccountingGroup[] = [
    { key: 'ranked', label: 'Ranked on the board' },
    { key: 'bridge', label: 'Set aside — bridge' },
    { key: 'liquid-staking', label: 'Set aside — liquid staking & restaking' },
    { key: 'exchange', label: 'Set aside — exchange' },
    { key: 'versioned-wrapped', label: 'Set aside — versioned or wrapped' },
    { key: 'priced-comps', label: 'Records a token — priced comps (value peers)' },
    { key: 'token-other-usable', label: 'Records a token — other usable' },
    { key: 'token-no-cap', label: 'Records a token — no usable cap' },
  ].map((g) => ({ ...g, count: groupCounts.get(g.key) ?? 0 }));

  const watchlistCovered = board.filter((r) => r.watchlist).length;
  const earlyRows = board.length - watchlistCovered;
  const roundedGlobal = round4(globalMultiple);
  const verdictCounts = {
    farm: board.filter((r) => r.verdict === 'FARM').length,
    marginal: board.filter((r) => r.verdict === 'MARGINAL').length,
    skip: board.filter((r) => r.verdict === 'SKIP').length,
  };
  const impliedTotal = board.reduce((s, r) => s + r.implied_value_usd, 0);

  const counts: RadarCounts = {
    protocols_scanned: snapshot.protocols.length,
    pre_token_found: preTokenProtocols.length,
    set_aside: setAsideRows.length,
    board_rows: board.length,
    watchlist_size: snapshot.watchlist.length,
    watchlist_covered: watchlistCovered,
    early_rows: earlyRows,
    live_peers: livePeers.length,
    value_peers: valuePeers.length,
    odds_universe: oddsItems.length,
  };

  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    global_multiple: roundedGlobal,
    counts,
    watchlist_size: snapshot.watchlist.length,
    watchlist_covered: watchlistCovered,
    board_size: board.length,
    early_size: earlyRows,
    set_aside_size: setAsideRows.length,
    live_size: live.length,
    model: {
      ...model,
      version: MODEL_VERSION,
      global_multiple: roundedGlobal,
    },
    category_multiples: categoryMultiples,
    categories: categoryMultiples,
    rows: board,
    set_aside: setAsideRows,
    live,
    validation: {
      peer_sets: {
        value_peers: valuePeers.length,
        odds_universe: oddsItems.length,
        live_peers: livePeers.length,
        median_age_years: round4(medianAge),
      },
      value: valueValidation,
      odds: {
        universe_n: oddsItems.length,
        base_rate: round4(oddsFit.baseRate),
        terms: oddsFit.terms,
        baseline: oddsFit.baseline,
        final: oddsFit.final,
        walk_forward_split: oddsFit.wfSplit,
      },
    },
    accounting,
    scenario: SCENARIO,
    verdict_counts: verdictCounts,
    implied_total_usd: impliedTotal,
    seal: '',
  };

  return { board, radar };
}

/** Parse and validate snapshot.json text into a typed Snapshot. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SnapshotError('snapshot.json must be a JSON object');
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) {
    throw new SnapshotError('snapshot.json is missing a valid YYYY-MM-DD as_of date');
  }
  if (typeof o.source !== 'string') {
    throw new SnapshotError('snapshot.json is missing source');
  }
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) {
    throw new SnapshotError('snapshot.json is missing a positive integer floor_usd');
  }
  if (!Array.isArray(o.protocols)) {
    throw new SnapshotError('snapshot.json is missing protocols array');
  }
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotError('snapshot.json is missing watchlist string array');
  }

  const protocols: SnapshotProtocol[] = o.protocols.map((entry, idx) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new SnapshotError(`snapshot.json protocol[${idx}] is not an object`);
    }
    const p = entry as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json protocol[${idx}] lacks slug, name, or finite tvl_usd`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });

  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/**
 * Validate a generated board against the competition gate:
 * - row count in 100..4000
 * - every watchlist slug present
 * - ranks are 1..N
 * - implied_value_usd is non-increasing with rank (and not identical across the board)
 * - implied_value_usd in 1..1e14
 * - farm_steps count in 3..12, each step 20..600 chars
 * Returns a descriptive string for the first issue found, or null if valid.
 */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) {
    return `board row count ${board.length} is outside 100..4000`;
  }
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) {
    return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  }
  for (let i = 0; i < board.length; i++) {
    if (board[i]!.rank !== i + 1) {
      return `row ${i + 1} has rank ${board[i]!.rank} instead of ${i + 1}`;
    }
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `row ${i + 1} (${board[i]!.slug}) has implied value ${board[i]!.implied_value_usd} above row ${i} (${board[i - 1]!.slug}) at ${board[i - 1]!.implied_value_usd}`;
    }
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}`;
  }
  for (const r of board) {
    if (
      typeof r.implied_value_usd !== 'number' ||
      !Number.isSafeInteger(r.implied_value_usd) ||
      r.implied_value_usd < 1 ||
      r.implied_value_usd > 1e14
    ) {
      return `${r.slug} has implied_value_usd ${r.implied_value_usd} outside 1..1e14`;
    }
    if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12) {
      return `${r.slug} has ${Array.isArray(r.farm_steps) ? r.farm_steps.length : 0} farm steps (expected 3..12)`;
    }
    for (let j = 0; j < r.farm_steps.length; j++) {
      const s = r.farm_steps[j]!;
      if (typeof s !== 'string' || s.length < 20 || s.length > 600) {
        return `${r.slug} farm step ${j + 1} has length ${typeof s === 'string' ? s.length : 0} outside 20..600 characters`;
      }
    }
  }
  return null;
}

/** Serialize the radar object as the static data.js script. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}
