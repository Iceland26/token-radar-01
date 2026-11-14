// Token Radar model (radar-2): empirical category peer valuation, eligibility filtering, and concrete 6-step farm plans.
// Runs on Node 22 with standard library only; deterministic output (no Date.now, no randomness).

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

/** Model constants for radar-2. */
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

export const MODEL_VERSION = 'radar-2';

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

/** Structured representation of one farm step before rendering to a single string. */
export interface FarmStep {
  action: string;
  cost: string;
  time: string;
}

/** Per-category empirical multiple breakdown for categories represented on the board. */
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

/** Median of a numeric array, or null when empty. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
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

/** Whether a protocol is ranked on the pre-token radar board. */
export function isEligiblePreToken(p: SnapshotProtocol): boolean {
  return isPreToken(p) && setAsideReason(p) === null;
}

/** Live peers: protocols that are NOT pre-token and have mcap_usd > 0 and tvl_usd > 0. */
export function getLivePeers(protocols: readonly SnapshotProtocol[]): SnapshotProtocol[] {
  return protocols.filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
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

/** Compute the radar-2 valuation multipliers and implied launch value for a single protocol. */
export function scoreProtocol(
  protocol: SnapshotProtocol,
  asOf: string,
  catStats: { peerCount: number; rawMedian: number | null; multiple: number },
  model: ModelConstants = MODEL,
): {
  implied: number;
  categoryMultiple: number;
  peerCount: number;
  rawCategoryMedian: number | null;
  growthPct: number;
  growthMult: number;
  age: number | null;
  maturityMult: number;
  breadthMult: number;
} {
  const rawGrowth = typeof protocol.change_7d === 'number' && Number.isFinite(protocol.change_7d) ? protocol.change_7d : 0;
  const growthPct = clamp(rawGrowth, model.growth_floor, model.growth_cap);
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;

  const age = ageDays(asOf, protocol.listed_at);
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor + model.maturity_range * (Math.min(Math.max(0, ageForModel), model.maturity_days) / model.maturity_days);

  const effectiveChains = Math.max(1, protocol.chains.length);
  const breadthMult = 1 + model.breadth_step * Math.min(effectiveChains - 1, model.breadth_max_extra_chains);

  const categoryMultiple = catStats.multiple;
  const implied = Math.max(
    1,
    Math.round(protocol.tvl_usd * categoryMultiple * growthMult * maturityMult * breadthMult),
  );

  return {
    implied,
    categoryMultiple,
    peerCount: catStats.peerCount,
    rawCategoryMedian: catStats.rawMedian,
    growthPct,
    growthMult,
    age,
    maturityMult,
    breadthMult,
  };
}

/** Recommended farm capital in USD from a protocol's TVL tier. */
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

/** Build the 6 structured FarmStep objects for a protocol and its age in days. */
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

  return [
    {
      action: `Create a fresh self-custody wallet dedicated to ${protocol.name} and fund it with ${chain}'s native gas token.`,
      cost: gasStep1,
      time: '5 minutes',
    },
    {
      action: moveCapitalAction,
      cost: gasStep2,
      time: '10-15 minutes',
    },
    {
      action: coreAction,
      cost: gasStep3,
      time: '15 minutes',
    },
    {
      action: deepenAction,
      cost: gasStep4,
      time: '15 minutes',
    },
    {
      action: `Hold and tend the ${protocol.name} position on ${chain} for ${holdDays} days, claiming accrued rewards and re-checking eligibility weekly.`,
      cost: gasStep5,
      time: `${holdDays} days (10 minutes weekly)`,
    },
    {
      action: `Follow ${protocol.name}'s official announcements, keep ${chain} deposit records, and be ready to claim and stake or sell at the token generation event.`,
      cost: gasStep6,
      time: '15 minutes at TGE',
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

/** Build the full ranked board and dashboard radar dataset from a validated Snapshot. */
export function buildRadar(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): { board: BoardRow[]; radar: RadarData } {
  const watchlistSet = new Set(snapshot.watchlist);
  const livePeers = getLivePeers(snapshot.protocols);
  const peerRatios = livePeers.map((p) => (p.mcap_usd as number) / p.tvl_usd);
  const globalMultiple = median(peerRatios) ?? 0.25;

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

  // Precompute category stats for every category appearing among eligible protocols.
  const categoryStatsCache = new Map<string, { peerCount: number; rawMedian: number | null; multiple: number }>();
  const categoryBoardCounts = new Map<string, number>();

  for (const p of eligibleProtocols) {
    const key = p.category ?? 'Uncategorized';
    categoryBoardCounts.set(key, (categoryBoardCounts.get(key) ?? 0) + 1);
    if (!categoryStatsCache.has(key)) {
      categoryStatsCache.set(key, computeCategoryStats(p.category, livePeers, globalMultiple, model));
    }
  }

  const scored = eligibleProtocols.map((p) => {
    const key = p.category ?? 'Uncategorized';
    const catStats = categoryStatsCache.get(key)!;
    const s = scoreProtocol(p, snapshot.as_of, catStats, model);
    return { p, ...s };
  });

  // Sort by implied desc, then tvl_usd desc, then slug asc.
  scored.sort(
    (a, b) =>
      b.implied - a.implied ||
      b.p.tvl_usd - a.p.tvl_usd ||
      (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0),
  );

  const board: BoardRow[] = scored.map((s, idx) => {
    const catMult = round4(s.categoryMultiple);
    const rawMed = s.rawCategoryMedian === null ? null : round4(s.rawCategoryMedian);
    const growthPct = round4(s.growthPct);
    const growthMult = round4(s.growthMult);
    const maturityMult = round4(s.maturityMult);
    const breadthMult = round4(s.breadthMult);
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
      peer_count: s.peerCount,
      raw_category_median: rawMed,
      growth_pct: growthPct,
      growth_multiplier: growthMult,
      maturity_multiplier: maturityMult,
      breadth_multiplier: breadthMult,
      capital_usd: capitalForTvl(s.p.tvl_usd),
      hold_days: holdWindowDays(s.age),
      model: {
        category_multiple: catMult,
        peer_count: s.peerCount,
        raw_category_median: rawMed,
        growth_pct: growthPct,
        growth_multiplier: growthMult,
        maturity_multiplier: maturityMult,
        breadth_multiplier: breadthMult,
        age_days: s.age,
      },
      farm_steps: farmSteps(s.p, s.age),
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

  const watchlistCovered = board.filter((r) => r.watchlist).length;
  const earlyRows = board.length - watchlistCovered;
  const roundedGlobal = round4(globalMultiple);

  const counts: RadarCounts = {
    protocols_scanned: snapshot.protocols.length,
    pre_token_found: preTokenProtocols.length,
    set_aside: setAsideRows.length,
    board_rows: board.length,
    watchlist_size: snapshot.watchlist.length,
    watchlist_covered: watchlistCovered,
    early_rows: earlyRows,
    live_peers: livePeers.length,
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
      global_multiple: roundedGlobal,
    },
    category_multiples: categoryMultiples,
    categories: categoryMultiples,
    rows: board,
    set_aside: setAsideRows,
    live,
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
