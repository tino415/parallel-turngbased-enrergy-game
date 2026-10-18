# Economy redesign — experiment proposal (2026-10-18)

**Status: experimental, not approved for production.** Established research is the baseline, not repeated here. Production `src/engine.js` is unchanged.

## Alternatives evaluated

| Model | Expansion incentive | Complexity | Strategic trade-off and likely exploit |
| --- | --- | --- | --- |
| 1. Per-node investment capacity | Strong: conquest opens new productive capital slots | Low | Encourages cheap neutral captures and many small holdings; losing a node becomes painful; players might deliberately spread capital over unsafe frontiers |
| 2. Smooth diminishing investment returns (logarithmic per node) | Strong but continuous; new territory resets marginal returns | Medium | Less arbitrary than a hard cap, but encourages many tiny investments; could reinforce territorial runaway |
| 3. Tiered returns above a threshold | Moderate: second-tier savings remain viable if expansion is risky | Low | Softer than capacity, but 2% tail may still reward indefinite hoarding and make taking new territory optional |
| 4. Finite-life investments / principal upkeep | Indirect (more nodes help replace principal) | Medium | Discourages exponential compounding; risks making all investments ineffective, encourages cycling or timing exploits |
| 5. Territory-dependent base production | Very strong direct reward per capture | Low | Favors rushing neutral territory and amplifies early map advantage; an early leader can become uncatchable |
| 6. Territory-diversification multiplier | Strong as holdings spread across nodes | Medium-high | Creates an artificial threshold and potential capture/recapture farming; obscures local economy |
| 7. Siege attrition / collective breakthroughs | Rewards attacks and temporary pressure, not directly territory income | High | Breaks fortress stalemates but makes the economy heavily dependent on coordinated AI and changes combat rules |

**Candidates chosen for experiment:** 1, 2 and 3. They change only income generated from invested energy and therefore can be compared without redesigning combat and movement. Proposed coefficients are exploratory, not tuned.

## Experimental formulas

All models retain the +1/node natural production and 10% active-energy decay. Let `I` denote invested principal **on a single node** and `f(I)` its investment income per round.

- **Baseline:** `f(I) = 0.1 I`.
- **Smooth diminishing:** `f(I) = 10 ln(1 + I/100)`.
- **Per-node capacity:** `f(I) = 0.1 min(I,100)`.
- **Tiered:** `f(I) = 0.1 min(I,100) + 0.02 max(0,I-100)`.

The capacity model deliberately permits investments past capacity to reveal wasted-capital strategy exploits, rather than silently modifying bot policies. The coefficients need tuning, and diminishing/tiered cases should eventually measure optimum investment allocation.

## Hypotheses / selection gates

1. Compared with baseline, an expander should have a **positive** paired median earnings advantage against an equally prudent one-node turtle after 300 rounds, while avoiding a 100% automatic-win rush.
2. A single-node turtle should not monopolize effectively all income merely through exponential reinvestment.
3. Matches should exhibit actual changes in survival, wins and last-25-round stalemate rates, not only increased territory.
4. Evaluate income trajectory and cumulative income, active and invested totals, share of economy, and first conquest time, not final gross income alone.
5. Inspect treatment performance against **both** default and aggressive opponents, in 20-node duels and 40-node four-player fields. Use seed-matched maps/combat streams and run alternate strategies on the same seeds.
6. Comeback potential requires a separate defined test where P0 begins at a deficit. `recoveryProxy` in this harness is only the amount of recovered income share since the lowest observed share and **is not** proof of comeback fairness.

## Run

```sh
node scripts/economy-experiment.mjs --matches=30 --rounds=300 --nodes=20 --players=2 --opponent=default --seed=invest-vs-expand-duel
node scripts/economy-experiment.mjs --matches=30 --rounds=300 --nodes=20 --players=2 --opponent=aggressive --seed=invest-vs-expand-agg
node scripts/economy-experiment.mjs --matches=30 --rounds=300 --nodes=40 --players=4 --opponent=default --seed=invest-vs-expand-field --json=true > economy-raw.json
```

GitHub Action `Experimental economy comparisons` runs these configurations and retains raw per-seed JSON. Distinct rule outcomes can consume different numbers of combat RNG draws once decisions diverge; seeds identify **matched input streams**, not identical combat outcomes. No browser or deployment changes.

## Preliminary design preference (subject to actual simulation results)

Prefer **tiered returns** as the least brittle first candidate if it creates a measurable expansion advantage. Use **smooth diminishing returns** if capacity/tiered curves retain the original stalemate and the log curve is not excessively snowball-prone. The hard cap is a useful bounding experiment but likely an overly sharp production mechanic.

**Approval needed before any production rule edit:** desired match length/turn cap, whether 100 principal/node is a suitable economic scale, whether the player may invest beyond productive capacity, and whether eliminating fortified holdouts requires a separate siege/combat change. Do not treat this proposal as approval.
