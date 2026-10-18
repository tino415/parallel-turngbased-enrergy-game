# Experimental soft capacity and withdrawals — review proposal

**Status:** simulation-only. No production gameplay, UI or AI changes. Do not merge or deploy gameplay rules without separate approval.

**Todoist:** [Implement soft per-node energy capacity, overflow decay, and investment withdrawal](https://app.todoist.com/app/task/6hp6Xpf5RJHf7vV4).

## Decision under test

Let each owned node have active energy `A`, invested principal `I`, capacity `C`, and overflow decay `d`. The existing natural yield (+1), invested yield (+10% of `I`), active decay (10%), and conquest loss (25–75% investment retained) remain unchanged.

- Sustainable capacity counts **A + I**, including units just transferred in.
- Soft excess `E = max(0, A + I - C)`, not a hard clamp.
- At the **end of every resolved round, after normal natural/investment income and 10% active decay**, burn `d × E` total energy proportionately from active and invested, using that round's final owner.
- Neutral nodes are exempt until acquired. Their existing baseline passive energy growth is unaffected.
- A start-of-round withdrawal of `W ≤ I` burns fee `f × W` and immediately adds `(1-f) × W` to active; invested falls by `W`. Multiple sources cannot share a budget.
- All orders are planned simultaneously on start-of-round holdings. Withdrawal can fund the same source's attack/transfer/investment this round. Incoming transfers are added **after** order budgets validate and **cannot fund same-round attacks or second-hop transfers**.
- Transfers to initially friendly neighbors resolve before combat, as in the current engine. A node captured on the same round does not get retrospective outgoing orders; existing conquest principal attrition still applies.
- No implicit rounding; all state values remain finite nonnegative JavaScript numbers. Input validation rejects invalid/negative/nonfinite withdrawals. Zero fee creates no energy; positive fee destroys energy.

The adapter calls the **unmodified production `GameEngine.resolveRound`** after adjusting a cloned start state for withdrawals, then applies proportional overflow to the returned state. Neither `src/engine.js` nor `src/game.js` imports it.

## Parameters and justification

| Parameter | Sweep | Provisional recommendation |
| --- | --- | --- |
| Total capacity/node `C` | 50, 100, 250, 500 | 100, subject to 300-round outcomes |
| Loss fraction of above-cap excess `d` | 15%, 25%, 35% | 25%, subject to measured pace |
| Withdrawal loss fraction `f` | 0%, 5%, 10% | 5%, subject to attack/defense utility |

The current investment interest is 10%/round. With indefinite investment and no new nodes, any overflow rate **at or below 10% is too weak** to reliably bound compounding. A crude upper-bound equilibrium when all new yield is invested and active decay is ignored is `I* ≈ (d C + 1)/(d − 0.1)` for `d > 0.1`. Thus `C=100, d=0.25` roughly bounds a purely invested single-node stock near **173** under that simplified model. Real simulations must confirm outcomes with defense reserves, combat, and transfers. This is *not* a formula for the guaranteed maximum instantaneous energy: temporary concentrations above capacity are allowed.

Capacity intentionally makes territorial breadth productive; it must not create an unanswerable early expansion lead. Smaller `C` amplifies the incentive to conquer and the risk of snowballing; larger `C` retains more fortification. Higher `d` penalizes short-lived front-line concentrations; 5% withdrawal is a tentative liquidity price, not an approved charge.

## Evaluation and controls

`scripts/soft-cap-experiment.mjs` runs the established **Super Turtle** and **Compounding Expander** with their original 5%-attack and reinvestment policy on both the baseline and each candidate. An extra experimental **Withdrawal Expander** shares the Expander's normal reserve/reinvestment algorithm but, when a suitable attack cannot be funded from active alone, withdraws only enough principal to finance a neighboring conquest and retains its starting active reserve. It withdraws at most 25% of invested principal per node per turn. This is an explicit *bot approximation*, not a proof of optimal withdrawal strategy.

The experiment compares 30 identical map and combat seed inputs over 300 rounds for: 20 nodes / 2 players versus Default, 20 / 2 versus Aggressive, 40 / 4 versus Default; and 20 / 2 versus Aggressive when Blue starts with **half** of its normal initial active and invested energy. The handicap suite tests a declared starting disadvantage, rather than falsely treating ordinary games' income-share fluctuations as comeback evidence.

Raw per-match JSON includes winner, survival, territory, expansion, captures, rounds, 25-turn no-capture stalemate, final active, invested, controlled energy, final gross income, gross-income share, cumulative gross production, overflow losses, withdrawn principal, fees, and deterministic checksums. The Markdown report shows medians and paired Expander/Turtle ratios only for equal-length games. Income is **gross**, not net after active decay. Seeds identify matched inputs, not identical combat RNG consumption after different strategic choices.

## Logistics and exploit checks

1. **Withdrawal/reinvestment loop:** withdrawal reduces principal dollar-for-dollar and pays `fW`; reinvesting the proceeds cannot increase total energy. With `f=0` it is neutral, not a free capacity reset, because both pools count.
2. **Transfer cycling:** transfer carries no fee but does not change global holdings; shifting capital to a node below capacity can avoid overflow. This is the **intended** benefit of distributing holdings and supporting forward nodes. Transferring back to a congested node exposes it to overflow again.
3. **Multihop same-round amplification:** impossible in this adapter because all spend budgets are validated before any transfers land. Any passed-along energy waits until next round.
4. **Fortress banking:** all over-cap holdings, including invested principal, decay; turtles cannot shield infinite invested reserves. A cap alone does *not* solve entrenched defender combat or elimination stalemate.
5. **Front-line gathering:** excess energy can arrive and defend against same-round attacks because transfer resolves before combat. If it remains over capacity it pays overflow at the round end, an intentional logistics cost.
6. **Conquest:** lost invested principal is processed by the unchanged engine prior to overflow; no retroactive fee adjustment. The new owner takes the excess decay on the captured node.

## Approval gates

Do not edit production rules until the seed-matched sweeps, tests and CI artifacts have been reviewed. Review tactical playability, whether 100 energy per node is appropriate, whether simultaneous withdrawal should be available for full principal or be rate-limited, whether transferred defending units should protect on the same turn, whether temporary overflow is too costly, and whether a separate siege/endgame condition is necessary. Inspect edge cases involving neutral nodes and long multi-hop supply routes in a human-play prototype.

**Reproduce locally after checkout:**

```sh
npm ci
npm run check
node scripts/soft-cap-experiment.mjs --matches=30 --rounds=300 --nodes=20 --players=2 --opponent=default --seed=invest-vs-expand-duel --json=true > experiment.json
node scripts/summarize-soft-cap.mjs experiment.json
```

The GitHub Actions workflow executes the above plus the other seeded scenarios, saving full JSON and summaries for review. **Production remains the baseline until explicit gameplay approval.**
