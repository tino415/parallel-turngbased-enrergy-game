# Equilibrium mode: design proposal

**Status:** simulation and proposal only. The live rules, AI and interface are unchanged.
If accepted, Equilibrium ships as a second game mode next to the current rules, chosen
when a match starts.

**Todoist:** [New game mode "Equilibrium"](https://app.todoist.com/app/task/6hpf6vp8vF4H94VW).

## The idea

Every node holds a **reserve** of natural energy. Each round every node, neutral ones too, extracts its income from it, and
nothing on the map is ever destroyed: decay, overflow, the withdrawal fee, both sides'
combat losses and the principal lost on conquest all go back into a reserve. The total
energy on the map stays the same for the whole match.

## Proposed rules

| Rule                      | Live rules (today)                  | Equilibrium                                                              |
| ------------------------- | ----------------------------------- | ------------------------------------------------------------------------ |
| Income per node           | `1 + 10% of invested`, from nowhere | the same amount, taken from the node's reserve, never more than it holds |
| Starting reserve          | none                                | 100 on every node, neutral and home alike                                |
| Active decay (10%)        | destroyed                           | added to the reserve of the node it sat on at round end                  |
| Overflow above 250        | destroyed                           | added to the overflowing node's reserve                                  |
| Withdrawal fee (5%)       | destroyed                           | added to that node's reserve                                             |
| Combat losses             | destroyed                           | both sides' losses added to the reserve of the node fought over          |
| Principal lost on capture | destroyed                           | added to the captured node's reserve                                     |
| Total energy              | grows without bound                 | fixed: 20 nodes start with about 2,170, 40 nodes with about 4,330        |

Everything else stays: orders, combat rolls, investment, withdrawal, the soft cap, the AI's
order planning.

## How it changes play

These follow from the rules before any simulation.

- **Decay stops being a loss and becomes a delay.** While a node's reserve lasts, its active
  energy settles at `10 + invested`, exactly as today, because what decays returns to the
  reserve and is extracted again. Energy above that level drains into the reserve and comes
  back at the node's extraction rate.
- **Investment becomes the extraction rate.** Principal no longer creates energy; it sets how
  fast a node turns its reserve into spendable energy. A node holding `S` in total keeps the
  most energy spendable with about `(S − 10) / 2` invested. Investing more only parks energy in
  principal, which a withdrawal frees at 5%.
- **A node's holdings stay on the node.** Active, invested and reserve on a node only change
  through transfers and battles. A big stockpile on the front line seeps into that node's
  reserve, and whoever owns the node later owns that reserve.
- **A battle hands the whole node to the winner.** A successful defence keeps the node and adds
  the attacker's losses to its reserve; a failed attack is a gift. A capture takes the
  survivors, the kept principal and a reserve holding both sides' losses and the destroyed
  principal.
- **Growth ends when the reserves are drained.** No economy can outgrow a rival by compounding,
  so after the first rounds the only way to gain is to take nodes.

## Simulations

`scripts/equilibrium-experiment.mjs` plays bot-against-bot matches through the unmodified
engine and adds the reserve bookkeeping around each round (`tests/support/equilibrium.mjs`).
Run through the adapter with the live economy, it reproduces the live engine round for round;
a test pins that, and another that a closed map keeps its total to 1e-9 over whole matches.

Every configuration replays the same 30 map and combat seeds for up to 300 rounds, on a
20-node duel and a 40-node four-player map. All players use a research copy of the live
economic AI, which plans exactly what the live AI plans (pinned by a test). An **outcome** is
the eliminating winner, or the player controlling the most energy (active, invested and
reserve on owned nodes) when the round cap ends the match. A **stalemate** is a capped match
with no capture in its last 25 rounds.

### The headline: stalemates disappear

| 30 seeds × 300 rounds     | Eliminations | Stalemates | Median finish round | Early leader keeps the lead |
| ------------------------- | -----------: | ---------: | ------------------: | --------------------------: |
| Duel, live rules          |      8 of 30 |   21 of 30 |                 101 |                         52% |
| Duel, Equilibrium         |     23 of 30 |    0 of 30 |                 118 |                         79% |
| Four players, live rules  |      7 of 30 |   18 of 30 |                 117 |                         50% |
| Four players, Equilibrium |     17 of 30 |    0 of 30 |                 224 |                         73% |

"Early leader" is the player controlling the most energy at round 50. Under the live rules
two thirds of these bot matches freeze on a front line, and the round-300 leader of a frozen
match is close to a coin toss. Under Equilibrium every match keeps capturing until someone is
eliminated or the cap arrives. The price is a stronger early lead: the round-50 leader goes on
to win about three matches in four.

The bots also show where the energy sits. In a live duel at round 300 the map holds a median
1,385 active and 3,301 invested, and both keep growing. In Equilibrium the 2,166 on the map
splits into 75 active, 1,200 invested and 41% still in reserves. Armies are small next to what
the nodes hold, which is why every capture matters.

### Open question 1: which node a loss goes back to

The current rules have no transfer loss, so only three cases exist: decay lands on the node
the energy sits on at round end (after transfers arrive, so on the target), overflow on the
overflowing node, combat on the node fought over. Three destinations were tested:

| Destination                                 | Duel: eliminations / stalemates | Four players: eliminations / stalemates | Reserve left at end (duel) |
| ------------------------------------------- | ------------------------------: | --------------------------------------: | -------------------------: |
| **Local**: the node where it was lost       |                          23 / 0 |                                  17 / 0 |                        41% |
| Neighbourhood: that node and its neighbours |                          18 / 0 |                                   5 / 0 |                        38% |
| Global: spread evenly over the map          |                         11 / 16 |                                   2 / 7 |                         0% |

**Recommendation: local, for every kind of loss.** Global brings the stalemates back: losses
seep into every reserve, every node extracts them, the energy ends in principal and the map
freezes with nothing left to extract. Neighbourhood avoids stalemates but ends far fewer four-player matches (5 of 30)
and is harder to explain. If a transfer loss is ever added, it should stay on the source node,
since that energy never left.

### Open question 2: how fast a reserve can be extracted, and whether investment speeds it up

| Extraction per round, capped by the reserve | Duel: eliminations / median finish | Four players: eliminations / median finish | Early leader keeps the lead (duel) |
| ------------------------------------------- | ---------------------------------: | -----------------------------------------: | ---------------------------------: |
| Slow: `0.5 + 5%` of invested                |                          6 / 225.5 |                                      0 / – |                                77% |
| **Live: `1 + 10%` of invested**             |                           23 / 118 |                                   17 / 224 |                                79% |
| Fast: `2 + 20%` of invested                 |                          30 / 63.5 |                                 28 / 119.5 |                                90% |
| Flat: 2, investment has no effect           |                            28 / 93 |                                   20 / 159 |                                81% |

**Recommendation: keep today's income formula, `1 + 10%` of invested, as the extraction rate.**
Slow never finishes a four-player match in 300 rounds. Fast settles duels in about 60 rounds
and lets the round-50 leader win nine times in ten. Flat finishes matches but removes the
investment decision and leaves 64% of the map's energy unextracted. Keeping the current
formula also keeps the numbers players already know.

### Open question 3: starting reserve and a fixed total

| Starting reserve per node | Map total (duel) | Duel: eliminations / median finish | Four players: eliminations / median finish |
| ------------------------: | ---------------: | ---------------------------------: | -----------------------------------------: |
|                        25 |              666 |                           27 / 126 |                                   17 / 185 |
|                        50 |            1,166 |                           25 / 127 |                                   17 / 203 |
|                   **100** |        **2,166** |                       **23 / 118** |                               **17 / 224** |
|                       200 |            4,166 |                           25 / 121 |                                   21 / 217 |
|                       400 |            8,166 |                           29 / 109 |                                 30 / 165.5 |

None of them stalls. The size of the reserve mostly sets the scale of the numbers, not the
course of the match. **Recommendation: 100 per node**, the same on every node. It gives
neutral nodes ten times their standing garrison, makes the opening expansion worth something,
and keeps reserves in the range of today's per-node capacity of 250. Seeded variation per node
can come later; it raises fairness questions about start positions that this proposal avoids.

**Keep the total fixed.** A trickle of 0.2 new energy per node per round changed little (duel
22 eliminations, median finish 136; four players 17, median 246) and breaks the rule that
energy is only ever transformed.

### Open question 4: do battlefields become rich nodes, and does that snowball?

Only mildly. At the moment of capture a node holds a median 1.1–1.3 times what the median
node holds; the richest node on the map ends at 3.5 times the median in duels. Fighting spreads
out rather than piling onto one node: the busiest fifth of nodes takes 65% of combat losses in
an Equilibrium duel against 96% under the live rules, where the bots grind one front line.
That stays at 63% when every bot actively hunts rich nodes.

The snowball is real but comes from the fixed total, not from rich battlefields: the round-50
leader wins 79% of duels and 73% of four-player matches, against about 50% under the live
rules. Trailing players still come back in 6 of 29 duels and 8 of 30 four-player matches. For a
mode whose point is that matches end, that looks acceptable; human playtests should judge it.

### Open question 5: how the AI should value reserves

One player at a time ran a reserve-aware AI against the live AI, in every seat.

| AI for one seat, others on the live AI       | Duel wins, seat 0 / seat 1 | Four-player wins, seats 0 / 1 / 2 / 3 |
| -------------------------------------------- | -------------------------: | ------------------------------------: |
| Live AI everywhere (baseline)                |                    16 / 14 |                        11 / 7 / 5 / 7 |
| Investment capped at `(S − 10) / 2`          |                    22 / 18 |                     21 / 16 / 18 / 11 |
| Targets ranked by holdings per capture force |                    18 / 14 |                        10 / 7 / 7 / 7 |
| Both                                         |                    23 / 19 |                     21 / 17 / 17 / 12 |
| Both, under the live rules                   |                      0 / 0 |                         0 / 0 / 0 / 0 |

**Recommendation: the AI needs one Equilibrium-specific change, its investment target.** The
live AI invests up to the node capacity, which under Equilibrium locks most of its energy in
principal. Capping investment at about half of what the node holds above 10 roughly doubles a seat's
wins in four-player matches. Ranking targets by what they hold adds nothing measurable, so target choice can stay as
it is. The last row is a control: the same valuation loses every match under the live rules,
so the AI must pick its investment target by mode.

## Implementation outline, for when the mode is approved

1. **Engine.** A match-level `mode: 'equilibrium'` beside `rulesVersion`. Nodes gain a
   `reserve` field. `resolveRound` caps income at the reserve and adds each node's losses to its
   reserve; `forecast` shows the extraction and the reserve. The research adapter's
   conservation bookkeeping becomes engine code, and the conservation test moves with it.
2. **AI.** `economicAI` takes the mode and invests toward `(S − 10) / 2` in Equilibrium.
3. **Store, saves, replays, online.** The mode is chosen in New-game settings
   ([6hpHpVRjxRWr9r34](https://app.todoist.com/app/task/6hpHpVRjxRWr9r34)), saved with the
   match, carried by replay snapshots and by `server/match.mjs`. Saved matches without a mode
   stay on the live rules.
4. **Interface.** The node inspector shows the reserve and this round's extraction; the round
   log says where battle losses settled ("Node 7's reserve +18.4"); the leaderboard counts
   reserves on owned nodes.

## Caveats

- Bots, not people. The live AI was tuned for compounding growth; human players will find
  their own uses for reserves, for instance parking energy on a node they mean to hold.
- Seeds fix the map and the combat seed, but rolls diverge once the economies diverge.
- The bots favour the first seat a little under every rule set.
- Decay as a delay rather than a loss is the least intuitive part of the mode; the interface has
  to show the reserve filling and draining.

## Reproduce

```sh
podman compose exec app node scripts/equilibrium-experiment.mjs --suite=rules --nodes=20 --players=2 --seed=equilibrium-duel > reports/eq-rules-duel.json
podman compose exec app node scripts/equilibrium-experiment.mjs --suite=rules --nodes=40 --players=4 --seed=equilibrium-field > reports/eq-rules-field.json
podman compose exec app node scripts/equilibrium-experiment.mjs --suite=valuation --nodes=20 --players=2 --seed=equilibrium-duel > reports/eq-valuation-duel.json
podman compose exec app node scripts/equilibrium-experiment.mjs --suite=valuation --nodes=40 --players=4 --seed=equilibrium-field > reports/eq-valuation-field.json
podman compose exec app node scripts/summarize-equilibrium.mjs reports/eq-*.json
```

Each run takes under a minute.
