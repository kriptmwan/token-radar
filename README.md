# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/kriptmwan/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/kriptmwan/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar ranks 250 DeFi protocols by what their token would be worth if they issued one — from a frozen DefiLlama snapshot (2026-11-14, 758 protocols). The implied value is derived only from the snapshot's own figures: TVL × 0.30 × 7-day growth × age since listing with no token × chain breadth. All 198 protocols that record no token and are not wrapped, staked or bridged products rank first (including all 40 watchlist protocols); 52 protocols whose token already trades sit in a separate band below them, ordered by market cap. Every row carries a concrete farm plan with amounts, costs and durations. The dashboard is a sortable, filterable board with a detail view per protocol, rendered fully offline.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=emz2619t&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
