// Token Radar — main.ts
// Builds the ranked board for make.fun token-radar-01 from a frozen
// DefiLlama snapshot (input/snapshot.json). Node 22, standard library only.
// Deterministic: no clock, no randomness, no network. Two runs on the same
// input write byte-identical outputs.
//
// Value model (derived only from the snapshot's own figures):
//   implied_value = tvl_usd * 0.30 * growth * age * breadth
//   growth  = 1 + clamp(change_7d, -50, +100) / 200        (0.75 .. 1.50)
//   age     = 1 + min(days_since_listed, 1460) / 1460 * 0.6 (1.00 .. 1.60)
//             days run with no token: the longer a protocol has run at
//             size without issuing a token, the more overdue its launch.
//   breadth = 1 + min(chain_count, 10) * 0.02              (1.00 .. 1.20)
// Protocols that record no token rank first, ordered by that value.
// Protocols whose token already trades rank in a separate band below
// every pre-token protocol: their band values are their market caps
// (or tvl * 0.15 when no market cap is recorded), rescaled so the
// largest band value sits just under the smallest pre-token value,
// preserving market-cap order inside the band.

import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildDossier } from "./vendor/makefun-board.ts";

type Protocol = {
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
};

type Snapshot = {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
};

type Row = {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
};

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DAY_MS = 24 * 60 * 60 * 1000;

// Categories / name shapes the watchlist rule itself excludes: a wrapped,
// staked or bridged product of a token that already trades is not a
// protocol still waiting on a launch of its own.
const EXCLUDED_CATEGORIES = new Set([
  "Bridge",
  "Canonical Bridge",
  "Liquid Staking",
  "Liquid Restaking",
  "Restaked BTC",
  "CEX",
]);
const EXCHANGE_PREFIXES = [
  "Binance",
  "Coinbase",
  "Bybit",
  "Kraken",
  "Bitget",
  "OKX",
  "Bitfinex",
  "Gemini",
];
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

function isExcludedProduct(p: Protocol): boolean {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return true;
  if (VERSION_SUFFIX.test(p.name)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  for (const prefix of EXCHANGE_PREFIXES) {
    if (p.name.startsWith(prefix)) return true;
  }
  return false;
}

function hasNoToken(p: Protocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function daysBetween(fromYmd: string, toYmd: string): number {
  const from = Date.parse(fromYmd + "T00:00:00Z");
  const to = Date.parse(toYmd + "T00:00:00Z");
  return Math.max(0, Math.round((to - from) / DAY_MS));
}

function money(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

function fmtUsd(n: number): string {
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
  return money(n);
}

// Typical transaction cost on a chain, in USD, used only to make farm
// steps concrete. Keyed by chain name, never by protocol name.
const CHAIN_GAS_USD: Record<string, number> = {
  Ethereum: 6,
  Solana: 0.05,
  Base: 0.1,
  Arbitrum: 0.3,
  "BNB Chain": 0.2,
  Binance: 0.2,
  Polygon: 0.05,
  Avalanche: 0.5,
  Optimism: 0.15,
  zkSync: 0.3,
  Linea: 0.2,
  Scroll: 0.2,
  Sui: 0.05,
  Aptos: 0.05,
  Tron: 1,
  Bitcoin: 2,
};

function gasUsd(chain: string): number {
  return CHAIN_GAS_USD[chain] ?? 1;
}

function fmtGas(n: number): string {
  return n < 1 ? "$" + n.toFixed(2) : "$" + n.toFixed(0);
}

// Suggested position size: 0.001% of TVL, floored at $100, capped at $5,000.
function positionSize(tvl: number): number {
  const raw = Math.round((tvl * 0.00001) / 10) * 10;
  return clamp(raw, 100, 5000);
}

type Scored = {
  p: Protocol;
  value: number;
  ageDays: number;
  growthFactor: number;
  ageFactor: number;
  chainFactor: number;
  preToken: boolean;
  rawBand: number;
};

function scorePreToken(p: Protocol, asOf: string): Scored {
  const change = p.change_7d === null ? 0 : p.change_7d;
  const growthFactor = 1 + clamp(change, -50, 100) / 200;
  const ageDays = p.listed_at === null ? 365 : daysBetween(p.listed_at, asOf);
  const ageFactor = 1 + (Math.min(ageDays, 1460) / 1460) * 0.6;
  const chainFactor = 1 + Math.min(p.chains.length, 10) * 0.02;
  const value = Math.max(
    1,
    Math.round(p.tvl_usd * 0.3 * growthFactor * ageFactor * chainFactor),
  );
  return {
    p,
    value,
    ageDays,
    growthFactor,
    ageFactor,
    chainFactor,
    preToken: true,
    rawBand: 0,
  };
}

// ---------------------------------------------------------------------------
// Farm steps. Every step is concrete: an amount, a cost and a duration,
// built from the protocol's own snapshot figures (TVL, chains, category,
// age). Nothing is a slogan; nothing names a protocol the snapshot does
// not list.
// ---------------------------------------------------------------------------

function categoryAction(
  p: Protocol,
  size: number,
  gas: string,
  weeks: number,
): string {
  const chain = p.chains[0] ?? "Ethereum";
  const cat = p.category ?? "DeFi";
  const amt = money(size);
  switch (cat) {
    case "Dexs":
      return (
        `Swap ${amt} through ${p.name} on ${chain} twice a week (about ${gas} per swap, ` +
        `5 minutes each) for ${weeks} weeks, varying the pair each time, so the wallet builds a repeat-swap history.`
      );
    case "Lending":
      return (
        `Supply ${amt} as collateral on ${p.name} (${chain}), borrow 30% of it, and repay within 7 days ` +
        `(about ${gas} per transaction, 20 minutes); repeat the borrow-repay cycle once a month for ${weeks} weeks.`
      );
    case "Yield":
    case "Yield Aggregator":
      return (
        `Deposit ${amt} into the largest vault on ${p.name} (${chain}) and leave it compounding for ${weeks} weeks ` +
        `(about ${gas} to enter, 10 minutes); claim or restake the yield once a week.`
      );
    case "Derivatives":
      return (
        `Open a ${amt} hedged position on ${p.name} (${chain}) with 2x leverage at most, hold it 7 days, then close it ` +
        `(about ${gas} per trade, 15 minutes); repeat the cycle for ${weeks} weeks.`
      );
    case "CDP":
      return (
        `Lock ${amt} of collateral in ${p.name} (${chain}) and mint stablecoins worth at most 40% of it ` +
        `(about ${gas} to open, 20 minutes); keep the position healthy and top it up if collateral falls 10%.`
      );
    case "RWA":
      return (
        `Buy ${amt} of the tokenised asset on ${p.name} (${chain}) and hold it for ${weeks} weeks ` +
        `(about ${gas} to buy, 15 minutes); collect each weekly payout instead of selling it on.`
      );
    case "Liquid Staking":
    case "Liquid Restaking":
      return (
        `Stake ${amt} through ${p.name} on ${chain} and hold the receipt token for ${weeks} weeks ` +
        `(about ${gas} to stake, 10 minutes); use the receipt token once in a lending pool as well.`
      );
    case "Bridge":
    case "Canonical Bridge":
      return (
        `Bridge ${amt} through ${p.name} to ${chain} and back once a week for ${weeks} weeks ` +
        `(about ${gas} per crossing, 20 minutes each way); keep the same wallet on both sides.`
      );
    case "Prediction Market":
      return (
        `Place ${amt} in total across 3 live markets on ${p.name} (${chain}), one bet per week for ${weeks} weeks ` +
        `(about ${gas} per bet, 10 minutes); settle each market instead of leaving positions open.`
      );
    case "Risk Curators":
    case "Onchain Capital Allocator":
      return (
        `Allocate ${amt} to a curated vault on ${p.name} (${chain}) and leave it deployed for ${weeks} weeks ` +
        `(about ${gas} to allocate, 15 minutes); review the vault's allocation report once a week.`
      );
    default:
      return (
        `Use ${p.name}'s main ${cat} feature on ${chain} with ${amt} (about ${gas} per transaction, 15 minutes) ` +
        `and repeat the action once a week for ${weeks} weeks so the wallet shows sustained use.`
      );
  }
}

function preTokenSteps(s: Scored): string[] {
  const p = s.p;
  const chain = p.chains[0] ?? "Ethereum";
  const size = positionSize(p.tvl_usd);
  const gas = fmtGas(gasUsd(chain));
  const weeks = s.ageDays > 365 ? 12 : 8;
  const otherChain = p.chains.length > 1 ? p.chains[1] : chain;
  const steps: string[] = [
    `Fund a fresh wallet with ${money(size)} in stablecoins on ${chain} (about ${gas} in gas, 15 minutes); ` +
      `use this wallet only for ${p.name} so every action stays traceable in one history.`,
    categoryAction(p, size, gas, weeks),
    `Repeat one on-chain action on ${p.name} every week for ${weeks} weeks (about ${gas} each, 10 minutes), ` +
      `and do at least one action on ${otherChain} too if the protocol runs there.`,
    `Hold the position for the full ${weeks} weeks without withdrawing: ${p.name} has run ${s.ageDays} days ` +
      `since listing with no token recorded, so a short in-and-out leaves no history worth rewarding.`,
    `Check ${p.name}'s official announcements once a week (5 minutes) and save every transaction hash plus a ` +
      `screenshot of the position; if a points page appears, confirm the wallet shows up on it within 7 days.`,
    `Plan the exit now: if a token launches, claim within the first 48 hours (about ${gas} in gas, 20 minutes) ` +
      `and sell at most half at once, keeping the rest staked for 30 days.`,
  ];
  return steps;
}

function launchedSteps(s: Scored): string[] {
  const p = s.p;
  const chain = p.chains[0] ?? "Ethereum";
  const size = positionSize(p.tvl_usd);
  const gas = fmtGas(gasUsd(chain));
  const token = p.symbol ?? p.name;
  const mcap = p.mcap_usd === null ? null : fmtUsd(p.mcap_usd);
  const steps: string[] = [
    `${p.name}'s token already trades${mcap === null ? "" : ` (market cap ${mcap})`}, so there is no launch left to farm: ` +
      `buy ${money(size)} of ${token} on ${chain} only if you want exposure, never to chase a launch (about ${gas} in gas, 10 minutes).`,
    `Stake half the ${token} position for 30 days (about ${gas} to stake, 10 minutes) and keep the other half liquid; ` +
      `unstaking early usually costs more in fees than a week of rewards pays.`,
    `Use ${p.name} on ${chain} once a week for 4 weeks (about ${gas} per use, 15 minutes) so the position earns ` +
      `real yield instead of sitting idle in the wallet.`,
    `Re-check ${p.name}'s market cap and TVL every Sunday (5 minutes); if TVL falls 20% in a week, ` +
      `cut the position in half within 24 hours rather than waiting for a recovery.`,
    `Set a written exit: sell the full position if it doubles, or after 90 days, whichever comes first ` +
      `(about ${gas} to sell, 10 minutes), and record the entry and exit prices.`,
  ];
  return steps;
}

// ---------------------------------------------------------------------------
// Board assembly
// ---------------------------------------------------------------------------

function buildRows(snap: Snapshot): { rows: Row[]; dashboardRows: unknown[] } {
  const asOf = snap.as_of;
  const preToken: Scored[] = [];
  const launched: Scored[] = [];
  for (const p of snap.protocols) {
    if (hasNoToken(p) && !isExcludedProduct(p)) {
      preToken.push(scorePreToken(p, asOf));
    } else if (!hasNoToken(p)) {
      const raw = p.mcap_usd !== null ? p.mcap_usd : Math.round(p.tvl_usd * 0.15);
      const s = scorePreToken(p, asOf);
      s.preToken = false;
      s.rawBand = raw;
      launched.push(s);
    }
    // No-token protocols that are wrapped / staked / bridged products of a
    // token that already trades are left off the board entirely: they are
    // not launches waiting to happen.
  }
  preToken.sort((a, b) => b.value - a.value || (a.p.slug < b.p.slug ? -1 : 1));
  launched.sort((a, b) => b.rawBand - a.rawBand || (a.p.slug < b.p.slug ? -1 : 1));
  const launchedTop = launched.slice(0, 52);

  // Rescale the launched band so its largest value sits just under the
  // smallest pre-token value, preserving market-cap order inside the band.
  const minPre = preToken.length > 0 ? preToken[preToken.length - 1].value : 1;
  const maxRaw = launchedTop.length > 0 ? launchedTop[0].rawBand : 0;
  const scale = maxRaw > 0 ? (minPre * 0.95) / maxRaw : 0;
  for (const s of launchedTop) {
    s.value = Math.max(1, Math.floor(s.rawBand * scale));
  }

  const ordered = [...preToken, ...launchedTop];
  const rows: Row[] = [];
  const dashboardRows: unknown[] = [];
  let prev = Number.POSITIVE_INFINITY;
  ordered.forEach((s, i) => {
    const value = Math.min(s.value, prev);
    prev = value;
    const steps = s.preToken ? preTokenSteps(s) : launchedSteps(s);
    rows.push({
      slug: s.p.slug,
      name: s.p.name,
      rank: i + 1,
      implied_value_usd: value,
      farm_steps: steps,
    });
    dashboardRows.push({
      slug: s.p.slug,
      name: s.p.name,
      rank: i + 1,
      value,
      tvl: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      listed_at: s.p.listed_at,
      age_days: s.ageDays,
      category: s.p.category,
      chains: s.p.chains.slice(0, 4),
      status: s.preToken ? "pre-token" : "launched",
      symbol: s.p.symbol,
      mcap: s.p.mcap_usd,
      growth: Number(s.growthFactor.toFixed(4)),
      age_factor: Number(s.ageFactor.toFixed(4)),
      chain_factor: Number(s.chainFactor.toFixed(4)),
      farm_steps: steps,
    });
  });
  return { rows, dashboardRows };
}

function parseArgs(argv: string[]): { input: string } {
  let input = "/input/snapshot.json";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--input" && i + 1 < argv.length) input = argv[i + 1];
  }
  return { input };
}

async function main(): Promise<void> {
  const { input } = parseArgs(process.argv.slice(2));
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  const snap: Snapshot = JSON.parse(readFileSync(input, "utf8"));
  const { rows, dashboardRows } = buildRows(snap);

  mkdirSync(outDir, { recursive: true });
  mkdirSync(join(outDir, "dashboard"), { recursive: true });
  mkdirSync(join(outDir, "screenshots"), { recursive: true });

  // Dashboard and screenshots ship from the repository; the dashboard's
  // data file is generated here, beside the page.
  cpSync(join(SCRIPT_DIR, "dashboard"), join(outDir, "dashboard"), {
    recursive: true,
  });
  cpSync(join(SCRIPT_DIR, "screenshots"), join(outDir, "screenshots"), {
    recursive: true,
  });

  const board = {
    as_of: snap.as_of,
    model:
      "implied_value_usd = tvl_usd * 0.30 * (1 + clamp(change_7d,-50,100)/200) * " +
      "(1 + min(days_since_listed,1460)/1460*0.6) * (1 + min(chains,10)*0.02) for protocols " +
      "that record no token; protocols whose token already trades rank below in a separate " +
      "band, their market caps rescaled under the smallest pre-token value.",
    rows,
  };
  writeFileSync(join(outDir, "board.json"), JSON.stringify(board, null, 2) + "\n", "utf8");

  const data = {
    as_of: snap.as_of,
    floor_usd: snap.floor_usd,
    watchlist: snap.watchlist,
    rows: dashboardRows,
  };
  writeFileSync(
    join(outDir, "dashboard", "zz-data.js"),
    "window.TOKEN_RADAR = " + JSON.stringify(data) + ";\n",
    "utf8",
  );

  const dossierPath = join(outDir, "dossier.json");
  // buildDossier returns the dossier's bytes (a Uint8Array); it does not
  // write the file itself. Write those exact bytes, unmodified.
  const result: unknown = await buildDossier(outDir, { text_max_bytes: 65536 });
  if (existsSync(dossierPath)) {
    // Already written by the library; leave its bytes untouched.
  } else if (result instanceof Uint8Array) {
    writeFileSync(dossierPath, result);
  } else if (typeof result === "string") {
    writeFileSync(dossierPath, result, "utf8");
  } else if (result !== null && typeof result === "object") {
    throw new Error("buildDossier returned an unexpected object; dossier not written");
  } else {
    throw new Error("buildDossier wrote no dossier.json and returned nothing");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
