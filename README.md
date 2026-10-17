# Parallel turn-based energy game

A small, experimental graph-based strategy game. **The game's final name is undecided.**

[Play locally](index.html) by opening `index.html` in a browser. No build tools or dependencies required.

## Current prototype rules

- Configurable map of 10–120 nodes and 2–6 players (one human and AI opponents). Rounds continue until only one player owns nodes.
- Every node stores **active** and **invested** energy.
- Invested energy earns 10% per round, paid as active energy; principal is locked.
- Active energy decays 10% per round; natural +1 active energy appears per node per round.
- Allocate active energy between one investment allocation and any number of adjacent transfers or attacks in a single round; unallocated energy stays for defense. All allocations from a node must fit within its starting active-energy balance.
- Attacks from the same player against the same target are grouped. Attack groups are randomized within each target.
- Combat uses ±20% independent random effective-strength modifiers; casualties are based on effective strengths.
- A changed final owner triggers random destruction of 25–75% of invested energy.
- Eliminate all opponents by capturing all their owned nodes to win. Combat log reports each side's energy losses.

## Status and limitations

This is a gameplay experiment, not finalized balancing. The AI is deliberately simple. Persistent node policies are supported: defense reserve, surplus reinvestment percentage, and optional one-edge friendly transfer. Policies can be copied, disabled, removed, or paused for one round. Manual allocations take priority over policies. Procedural graph maps use a configurable seed for reproducible map topology and initial positions, but combat randomness is not seeded. There is no save game, online multiplayer, seeded replay, or independent engine test suite yet. The rules can change based on playtests.

## Hosting

Cloudflare Pages: set build command to `npm run build`, build output directory to `dist`, and root directory to repository root. The build copies only `index.html`, `_headers`, and `src/` into `dist/`, avoiding development assets and `node_modules`. If using Cloudflare Workers Builds instead, set its deploy command/assets directory appropriately (for example, Workers static assets `directory = "./dist"` in Wrangler configuration).

## v0.5.0: Visualization and map management

- Map arrows show planned transfer/attack energy. Solid lines represent manual orders; dashed lines are automatic policy transfers. Filter manual/policy/all/none using the overlay selector.
- Selected-node planning previews reflect manual allocations plus policy-generated investment/transfer; dashboard includes interest-based gross income, retained defense and an approximate next-round active balance (ignoring combat and enemy orders).
- Node Dashboard shows owned nodes in a table and can bulk-apply reserve and reinvestment settings. Existing transfer destinations are cleared by the bulk operation.
- Generate maps with 10–120 nodes, 2–6 players, density and a string seed. Use mouse-wheel zoom, drag-to-pan, and Fit map.
- Optionally apply a default reserve/reinvestment policy to newly conquered nodes. This template does not automatically select a supply route.

This remains a single-file zero-dependency prototype. A modular engine and automated test suite are planned, not yet implemented.

## Development architecture (v0.5.1)

- `index.html` — HTML shell, which loads the CSS and game script.
- `src/styles.css` — presentation styles.
- `src/game.js` — current game, round resolution, policies, AI, generator and UI logic. Further engine/UI separation remains future work.
- `tests/smoke.test.mjs` — dependency-free structural and parsing checks.
- Run `npm test` (requires Node.js) or `npm run check` locally. Use `npm run build` and deploy `dist/` to Cloudflare Pages.

This refactor is intended to preserve v0.5.0 gameplay behavior; the larger domain/UI split is not yet complete.

## v0.6.0: New-game modal and map placement

- `New game` opens a modal with node count, player count, density, seed, and a live, deterministic graph preview.
- The current match is preserved when the dialog is closed or cancelled; choosing `Start game` replaces it.
- Generated node positions use a jittered grid that keeps nodes from overlapping, even with 120 nodes. Regression tests check spacing, connectivity, and reproducibility.
- Map-generation controls no longer take up permanent toolbar space.

## v0.6.1: Engine extraction (first phase)

- `src/engine.js` exposes pure deterministic map generation, persistent policy evaluation and next-round economic forecasts, with no browser dependencies.
- `src/game.js` consumes these functions and continues to own UI, combat resolution, and AI. Full combat/UI isolation remains an open task.
- `tests/engine.test.mjs` verifies policy priorities, pause behavior, friendly routing, and production forecasts.
- `tests/map-generation.test.mjs` runs against the extracted engine. Use `npm run check` locally.
- `scripts/build.mjs` already copies the entire `src/` folder, so the deployment command is unchanged.

## v0.7.0: Browser-independent round resolution

- `src/engine.js` now contains AI order selection and the full round resolver, including investment, simultaneous transfers, random combat, captured-capital damage, default conquest policies, energy income and multiplayer elimination.
- The resolver accepts an injectable random function, and returns updated state, updated policies and event-log entries without modifying the input state or using browser APIs.
- `src/game.js` only supplies player inputs, configures conquest defaults, updates application state and renders the result.
- `tests/round.test.mjs` covers multi-orders, automatic AI response, one-hop transfers, conquest defaults, multiplayer termination and repeatability.
- Page scrolling over the map no longer zooms it unintentionally; use Ctrl/Cmd + scroll or the new ± buttons. Dragging still pans.
