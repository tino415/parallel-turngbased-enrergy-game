# Soft-cap experiment — measured results (2026-10-18)

**Experimental only; no live gameplay changes.** This is a bounded study of rule candidates, not a gameplay approval.

## Provenance and validation

- GitHub Actions [paired simulation run #39143831572](https://github.com/tino415/parallel-turngbased-enrergy-game/actions/runs/39143831572): **4/4 seeded scenario jobs passed**, with 30 paired seeds and 300 rounds per scenario, full downloadable JSON and summaries.
- [Browser UI checks #39143831556](https://github.com/tino415/parallel-turngbased-enrergy-game/actions/runs/39143831556): passed.
- The baseline reproduces the existing equal-reinvestment research medians (20-node Default: Turtle 9.695 T and Expander 9.575 T; Aggressive: 9.991 T / 9.908 T; 40-node Default: 9.467 T / 9.356 T gross energy per round).
- Rules implemented only in `tests/support/soft-cap.mjs`; production engine and UI files unchanged. Seven targeted regression tests additionally cover timing, conservation, overflow on invested principal and unchanged baseline operation.

Full snapshots distinguish wins, survival, expansion, final controlled active/invested energy, gross income, income share, no-capture stalemates and transfers. All values below are medians across games unless explicitly presented as counts.

## Comparisons with the established baseline

For the provisional combination `C=100, d=25%, f=5%`:

| Scenario (30 seeds)  | P0 strategy                   | Survived | Expanded | Median P0 nodes | Median gross income/round |
| -------------------- | ----------------------------- | -------: | -------: | --------------: | ------------------------: |
| 20 nodes, Default    | Baseline Super Turtle         |       30 |        0 |               1 |            9.695 trillion |
| 20 nodes, Default    | Baseline Compounding Expander |       30 |       30 |               2 |            9.575 trillion |
| 20 nodes, Default    | Cap Super Turtle              |        6 |        0 |               0 |                         0 |
| 20 nodes, Default    | Cap Compounding Expander      |        6 |        0 |               0 |                         0 |
| 20 nodes, Default    | Cap Withdrawal Expander       |       10 |       30 |               0 |                         0 |
| 20 nodes, Aggressive | Cap Super Turtle              |       30 |        0 |               1 |                       5.5 |
| 20 nodes, Aggressive | Cap Withdrawal Expander       |       30 |       30 |            11.5 |                     140.1 |
| 40 nodes, 3 Default  | Baseline Super Turtle         |       30 |        0 |               1 |            9.467 trillion |
| 40 nodes, 3 Default  | Baseline Compounding Expander |       30 |       30 |               2 |            9.356 trillion |
| 40 nodes, 3 Default  | Cap Super Turtle              |       10 |        0 |               0 |                         0 |
| 40 nodes, 3 Default  | Cap Compounding Expander      |       10 |        0 |               0 |                         0 |
| 40 nodes, 3 Default  | Cap Withdrawal Expander       |       12 |       30 |               0 |                         0 |

A median of zero is due to elimination in more than half the matches; it does _not_ mean survivors had zero production. Expansion is counted if Blue ever controlled more than one node, even when eliminated later. Cumulative outcomes were generated under **different rule sets**, so the incomparable trillion-scale base income should not be understood as a net welfare measure.

### Capacity sensitivity at 25% overflow decay and 5% withdrawal fee

| Capacity | 20-node Default: Turtle survived | 20-node Default: Withdrawal Expander survived | 40-node Default: Turtle survived | 40-node Default: Withdrawal Expander survived |
| -------- | -------------------------------: | --------------------------------------------: | -------------------------------: | --------------------------------------------: |
| 50       |                             6/30 |                                         17/30 |                             6/30 |                                         22/30 |
| 100      |                             6/30 |                                         10/30 |                            10/30 |                                         12/30 |
| 250      |                             7/30 |                                         13/30 |                            21/30 |                                         13/30 |
| 500      |                            30/30 |                                         10/30 |                            29/30 |                                         17/30 |

The win count for player zero is **0/30 in every displayed treatment**, including the withdrawal-enabled variant. Thus even markedly higher income and territorial reach did not achieve enemy elimination. The full simulation report includes unresolved matches and 25-turn no-capture stalemate counts; neither outcome is eliminated reliably.

### Overflow and withdrawal sensitivities

At C100 with a 5% withdrawal fee, varying overflow loss among 15%, 25% and 35% did _not_ yield a monotonic survival improvement. For 40-node Default matches, Withdrawal Expander survived **10/30**, **12/30** and **15/30**, respectively; no version won by elimination. The 20-node Aggressive scenario remained 30/30 survival at all three levels.

At C100 and 25% overflow loss, varying withdrawal fees 0%, 5% and 10% also produced non-monotonic outcomes (40-node Default Withdrawal Expander survived **10/30**, **12/30** and **15/30**, respectively). Combat choices and RNG draw consumption diverge between variants, so these small-sample differences do **not** support a claim that paying higher fees improves strategy.

### Disadvantaged start: 20 nodes, Aggressive

With Blue starting at **half normal initial active and invested** under C100/25%/5%, Withdrawal Expander survived 30/30 and expanded 30/30, with median gross income 126.4/round and median 10.5 nodes. Its unhandicapped counterpart reached median 140.1/round and 11.5 nodes. All games had zero Blue elimination wins. This demonstrates territorial recovery from a defined handicap against that AI, **not** robust comeback balance.

## Interpretation and recommendation

**Recommend the mechanics as a design direction, but reject immediate production parameter approval.** In particular:

1. Use total `active + invested`, proportional overflow deduction from **both** pools **after** ordinary round income/decay, and a start-of-round withdrawal usable immediately from the source. Do not let incoming transfers fund outgoing orders in the same round. Keep zero floor and finite-value guards.
2. Keep `C=250, d=25%, f=5%` as the **next prototype center point**, with C100 and C500 as neighboring comparison bounds. This is not a proven optimal parameter: C100 destroys many baseline-style defenders, while C500 maintains high fortress survival and weak non-withdrawal expansion; C250 is only an intermediate candidate.
3. Add capacity/withdrawal-aware **defensive** AI before claiming balance. The existing Super Turtle and Compounding Expander cannot withdraw and frequently become helpless under a cap; the new Withdrawal Expander is offensive and not a competent defender. Comparing them alone confounds the rule effect with bot adaptation.
4. Run symmetric competent opponents (withdraw/transfer-aware on both sides), explicit front-line supply and holdout scenarios, and longer playtesting. Test 0/5/10% fees at fixed decision traces or substantially more seeds; the current sign of fee effects is not reliable.
5. Stalemates remain: extra income and node captures are **not** proof that the final enemy can be eliminated. A separately approved combat/siege or victory-rule design might still be required.

The branch is intentionally limited to the experiment and reproducible evidence. No production rule should be merged, deployed, or enabled from this PR until gameplay parameters and defense/withdrawal semantics are approved.
