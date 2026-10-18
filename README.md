# Parallel Energy Game

A browser-based, simultaneous-turn, graph strategy game. The final game name is not settled.

**Play:** https://pteg.otin.dev  
**Current version:** v0.8.4 (UI redesign in review on feature branch)

## Play and rules

You control the blue nodes. Other player colors are AI opponents; gray nodes are neutral. Each node has its own **active energy** and **invested energy**—there is no shared resource pool.

- Each round, you may allocate a node's current active energy among **investment**, **transfers to adjacent friendly nodes**, and **attacks on adjacent nonfriendly nodes**. Any unallocated active energy defends the node.
- All allocations from a node must fit within the active energy available **at the start of the round**. Incoming transfers cannot fund outgoing orders in the same round.
- Invested principal is locked. Each round, invested energy earns **10%** as active energy; active energy decays **10%**; every node also produces **+1 active energy**.
- Rounds resolve simultaneously. Attack orders from the same player targeting the same node combine; competing attack groups are shuffled. Attack and defense receive independent random strength modifiers between **0.8× and 1.2×**. The surviving side retains energy based on the resulting effective strengths.
- When a node changes owner, its investment is reduced by a random **25–75%**. A player wins by eliminating all other players' owned nodes; neutral nodes need not be captured.
- An AI player chooses attacks, transfers, or investments automatically each round. AI behavior is intentionally simple; the game is not balance-tested.

## Interface

The main content has three tabs:

| View          | What it does                                                                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Map**       | Select blue nodes, inspect connections and order-flow overlays, pan and zoom.                                                                                                        |
| **Dashboard** | Review your nodes' energy, defense and production; apply bulk policies or manual investments; edit each node's policy investment %, reserve and enabled state directly in the table. |
| **Messages**  | See combat events and round summaries (the most recent 70 entries).                                                                                                                  |

Selecting a node opens an editable details dialog on both desktop and mobile. On mobile the editor fills the screen, with active/invested/defending energy, a live manual/policy energy budget, combat-strength ranges, manual allocations, and persistent policy controls. The desktop sidebar instead provides a compact selection and next-round overview. Planned orders and conquest defaults live in separate Orders and Settings dialogs; mobile keeps Orders and Resolve round in a bottom action bar.

**Persistent policies:** For each blue node, reserve some active energy, invest a specified percentage of the remaining surplus, and optionally transfer the rest to **one adjacent friendly node**. Policies do not initiate attacks. Manual orders take priority; a policy can be disabled, removed, copied, pasted, or paused for one round. The dashboard can apply reserve/invest percentages to multiple selected nodes at once; existing transfer destinations are preserved when applying these bulk changes.

**Map navigation:** Drag empty map space to pan. Use the **+ / −** controls overlaid on the map or **Ctrl/Cmd + scroll** to zoom; ordinary scrolling scrolls the page. On mobile, vertical swipes over the map scroll the page too. **Fit map** shows the full graph; **Focus** centers the last inspected node (or your first node if none has been inspected). Mobile opens focused on your starting node so labels remain legible. The overlay selector defaults to all planned attacks and transfers, with optional manual/policy/hidden filters. Every owned node always displays its projected next-round income and investment, regardless of map selection or flow filter.

**New game:** The New game dialog offers a live graph preview and a reproducible seed, with 10–120 nodes, 2–6 players, and sparse/normal/dense connection density. Generated maps use a jittered grid for spacing. Canceling the dialog leaves the current match intact. Confirming a new game after round 1 replaces the current match.

## Saving and recovery

- The game **automatically saves** its current match to the browser's `localStorage`, including topology, round state, pending orders, policies, recent messages and default conquest-policy settings.
- Reloading or returning in the **same browser profile and origin** automatically restores the saved match. There is currently **one save slot**: starting another match overwrites it.
- For an active match, the game asks the browser to confirm navigation away or refresh using `beforeunload`. **Browsers may skip the prompt**, especially on mobile; autosave is the main recovery mechanism.
- Saves are **not synchronized across devices or browsers**, and deleting site data/private browsing cleanup can erase them. No account, server-side persistence, or save export/import is implemented.

## Run and test locally

This is a static site; **no game server or runtime dependency** is required. Serve the repository with a simple local static web server and open `index.html`. (Directly opening `file://` may have browser-dependent storage behavior.)

Node.js is used only for the development commands:

```sh
npm test        # Node's built-in test runner
npm run check   # Syntax checks for both scripts, then tests
npm run build   # Copy deployable static assets to dist/
npm run format # Apply Prettier to source, styles, markup, tests and docs
npm run format:check # Verify formatting without changing files
```

The build copies `index.html`, `_headers`, and `src/` into `dist/`. No bundling is performed.

## Source layout

| Path                | Responsibility                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.html`        | Page, tabs, map area, dashboard container and New game dialog                                                                               |
| `src/styles.css`    | Responsive layout and styling                                                                                                               |
| `src/ux.js`         | Responsive full-screen editor, contextual dialogs, map overlays and mobile dashboard cards                                                  |
| `src/game.js`       | Browser UI, order entry, map rendering, autosave and view navigation                                                                        |
| `src/engine.js`     | Browser-independent map generation, policy evaluation, forecasts, AI and full round resolution; accepts injected RNG for reproducible tests |
| `tests/*.test.mjs`  | Syntax/structure, graph generation, economy/policy and round-resolution regression tests                                                    |
| `scripts/build.mjs` | Prepare `dist/`                                                                                                                             |
| `wrangler.toml`     | Cloudflare Worker name and static assets directory                                                                                          |

The game engine is extracted from the DOM. However, the application is still a prototype: UI state is managed in `game.js`, combat randomness during normal play is not seeded for replays, and there is no online multiplayer.

## Deployment: Cloudflare Workers Builds

This repository deploys to **Cloudflare Workers**, not Pages. Wrangler is configured with the existing Worker name `parallel-turngbased-enrergy-game` and `[assets] directory = "./dist"`.

Use these Workers Builds settings:

- **Build command:** `npm run build`
- **Deploy command:** `npx wrangler deploy`
- **Root directory:** repository root

The deployed content comes from `dist/`; the Workers configuration is in `wrangler.toml`. The live domain is https://pteg.otin.dev.

## Development history

- **v0.5.x:** Manual and automated order overlays, dashboard, procedural maps and initial build configuration.
- **v0.6.0:** Non-overlapping generated node layouts and New game preview dialog.
- **v0.6.1:** Independent map and economy calculations with tests.
- **v0.7.0:** AI and round resolution moved to the testable engine; explicit zoom controls.
- **v0.8.0:** Map/Dashboard/Messages tabs, per-node dashboard policy settings, local autosave and reload recovery.
- **v0.8.1:** Fixed a startup JavaScript global-name collision that left the map blank, added a mobile node-details modal, and restored vertical touch scrolling over the map.

- **v0.8.2:** On-map zoom buttons sized for touch and touch gesture handling to preserve vertical scrolling without pinch-zooming the browser page over the map.

- **v0.8.3:** Mobile map has a **Pan / Scroll** toggle. Scroll mode allows normal browser page gestures; Pan mode allows one-finger dragging horizontally or vertically across the map. On-map zoom and Fit buttons still work.

- **v0.8.4:** Compact mobile header, full-height map area and an explicit Settings panel for orders and conquest defaults.

## Repeatable simulations and regression testing

The game engine accepts an injected combat RNG. The development-only simulation harness uses an **independent combat seed** as well as the map seed to replay an entire match deterministically. Normal browser matches continue to use their existing randomness and **blue remains human-controlled** in the actual game.

Run AI-versus-AI simulations (all players, including blue, use the existing AI strategy):

```sh
npm run simulate -- --matches=50 --rounds=200 --nodes=30 --players=3 --seed=balance-v1
npm run simulate -- --matches=5 --nodes=60 --players=4 --density=dense --json
npm run check                  # Includes deterministic simulation regression tests
```

- Repeating the same command with the same seeds and engine revision yields the same outcomes and SHA-256 round-state checksums.
- Each match uses derived seeds of the form `<seed>:map:<index>` and `<seed>:combat:<index>`. The map seed controls the topology and starting positions; the combat seed controls attack and defense randomness.
- Reports include wins by player, games not decided within the round limit, game length, node ownership, energy totals and per-match checksums. A match reaching the cap is **unresolved**, not counted as a draw or a victory.
- The tests exercise multiple densities and player counts, graph connectivity, valid node IDs and edges, finite nonnegative energy, legitimate ownership, no eliminated player returning, and repeatability.
- This is **not** a gameplay rebalance or a browser-save replay feature. It runs headlessly for testing and diagnosis.

### Configurable AI strategies and GitHub Actions

Simulation-only strategies are **default**, **aggressive**, **balanced**, **turtle**, and **superturtle**. Each player may use a different strategy, in player-index order (P0 is Blue). These affect only the harness, **not the live AI or game balance**.

- **Default:** The current production AI.
- **Aggressive:** Favors attacking and early expansion.
- **Balanced:** Reserves energy against immediate threats, then attacks or invests.
- **Turtle:** Heavy investment and defense, with occasional neutral-only expansion; never attacks an opposing player's node.
- **Super Turtle:** Single starting node, no transfers and no attacks. It invests all energy above a dynamic defensive reserve (minimum 3 active, or approximately 1.5 times adjacent enemy active energy plus 2). The reserve is a heuristic, not a guarantee of survival.
- **Compounding Expander (`compoundexpand`):** Uses **exactly the same reserve and reinvestment rule on every owned node** as Super Turtle. When a neighboring neutral or enemy node is affordable, diverts up to `--attack-pct` (default 5%) of that node's **start-of-round active energy** to a single conservative attack, prioritizing affordable neutral nodes and committing only enough to beat the current defense even with unfavorable combat multipliers. Reinvests all surplus after reserving and attacking; captured nodes follow the same compound-and-expand logic. Does not withdraw invested principal or transfer energy. The strategy starts expanding from round 1 (no 150-round wait).
- **Turtle Counterattack:** Copies Super Turtle for the first 150 resolved turns. Starting in round 151, its original node can use up to 5% of its **start-of-round active energy** to attack a neighboring node when that budget is enough to overcome the target's current defense even with unfavorable combat rolls, while continuing to reserve defensive energy and reinvest surplus. Newly conquered nodes use the **Default AI** starting the next turn instead of turtling. Investment principal remains locked. The 150-round delay and 5% active-energy budget are configurable in simulations only.

A smaller 1-vs-1 comparison with 20 nodes is available in the existing GitHub workflow by setting **Players=2**, **Nodes=20**, **P0=Turtle Counterattack**, **Opponents=Default**, **Rounds=250**, **Turtle rounds=150**, and **Attack %=5**. Repeat with **P0=Super Turtle** and the **same seed** to compare survival and victories fairly:

```sh
npm run simulate -- --matches=100 --nodes=20 --players=2 --rounds=250 \
  --strategies=turtlecounter,default --turtle-rounds=150 --attack-pct=5 --seed=duel-v1
npm run simulate -- --matches=100 --nodes=20 --players=2 --rounds=250 \
  --strategies=superturtle,default --seed=duel-v1
```

In the full JSON, `playerStats[0].firstAttackRound` and `firstConquestRound` show when the counterattack actually begins and when the first conquest occurs. The report's `expansionCounts` counts matches in which a player grew beyond their home node. These are measured outcomes, not assumptions of success.

Reproduce the reported four-player turtle exploit with the following baseline scenario:

```sh
npm run simulate -- --matches=100 --nodes=40 --players=4 --rounds=200 \
  --strategies=superturtle,default,default,default --seed=turtle-v1
```

After each simulated match, the final standings also include **active energy**, **locked invested energy**, their sum (total controlled), **base income** (+1 per owned node), **investment income** (10% of invested energy), **gross income per round**, and each player's share of all owned-node gross income. GitHub summaries show per-player **medians** across matches (not sums); full JSON provides exact per-match final snapshots. Income is measured at the final resolved round, and does not subtract future active-energy decay or attack losses.

For the 300-round income-dominance comparison, keep the same seeds in all runs and use 20 nodes / 2 players. Repeat on 40 nodes / 4 players to measure the impact of expansion on +1 production. Set the **Rounds** input to 300 (now the default in the manual workflow).

The `--strategies` CSV must contain exactly one strategy per player. Add `--json` for machine-readable per-match details. Results include victory rates, survival rates, node count and peak investment per player, and matches unresolved by the round cap. A "stalled" match is unresolved with no captures in the last 25 rounds; it does **not** imply that the game has formally ended. Survival alone is not a win.

To run simulations from GitHub, open **Actions → Run balance simulations → Run workflow**, select the number of games, map size, player count, round cap, P0 strategy and opponent strategy. GitHub provides a summary table and downloadable JSON/Markdown artifacts retained for 30 days. This workflow starts only when manually dispatched; it is not part of the game deployment. The GitHub UI offers P0 vs all other players; use the CLI for arbitrary per-player combinations.

### Investment policy versus territorial expansion

Use **paired identical seeds** and compare `superturtle` against `compoundexpand`, with all other players using identical strategies. Unlike the Default AI (which invests only 60% of a node's active energy in some situations), both strategies invest **100% of their surplus after the same defensive reserve**. The Compounding Expander alone spends a bounded amount of that surplus on conquest. Additional captured nodes use that exact same compounding rule, not Default AI.

```sh
npm run simulate -- --matches=30 --nodes=20 --players=2 --rounds=300 --seed=invest-vs-expand-duel \
  --strategies=superturtle,default
npm run simulate -- --matches=30 --nodes=20 --players=2 --rounds=300 --seed=invest-vs-expand-duel \
  --strategies=compoundexpand,default --attack-pct=5
npm run simulate -- --matches=30 --nodes=40 --players=4 --rounds=300 --seed=invest-vs-expand-field \
  --strategies=compoundexpand,default,default,default --attack-pct=5
```

Inspect final **total controlled energy**, gross income, investment income and production share, alongside wins, survival, expanded games and total energy allocated to investment/attack (reported in each match's `playerStats`). The economic policy is matched, but the resulting investments will differ as expansion spends energy, adds +1-per-node base income and exposes captured capital to risk. For a fuller experiment, compare multiple attack budgets, maps and opponents.

## Known limitations

- Simple AI and experimental balance.
- Browser-local **single-slot** saves; no cross-device sync, backup/export or server persistence.
- No deterministic full-game replay from the map seed alone: only procedural generation uses the seed, while live combat uses unseeded randomness.
- Navigation prompts are browser-dependent; game preservation relies on `localStorage`.
- Tests cover important engine scenarios, but this does not replace interactive browser testing.
