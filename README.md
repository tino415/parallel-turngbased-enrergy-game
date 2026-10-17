# Parallel Energy Game

A browser-based, simultaneous-turn, graph strategy game. The final game name is not settled.

**Play:** https://pteg.otin.dev  
**Current version:** v0.8.1

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

| View | What it does |
| --- | --- |
| **Map** | Select blue nodes, inspect connections and order-flow overlays, pan and zoom. |
| **Dashboard** | Review your nodes' energy, defense and production; apply bulk policies or manual investments; edit each node's policy investment %, reserve and enabled state directly in the table. |
| **Messages** | See combat events and round summaries (the most recent 70 entries). |

On desktop, the sidebar contains the selected node's manual allocations and persistent policy editor. On narrow screens, tapping a blue node opens those details in a modal instead of requiring scrolling below the map. Default conquest settings and planned orders remain in the sidebar area.

**Persistent policies:** For each blue node, reserve some active energy, invest a specified percentage of the remaining surplus, and optionally transfer the rest to **one adjacent friendly node**. Policies do not initiate attacks. Manual orders take priority; a policy can be disabled, removed, copied, pasted, or paused for one round. The dashboard can apply reserve/invest percentages to multiple selected nodes at once; doing so clears their transfer destinations.

**Map navigation:** Drag empty map space to pan. Use the **+ / −** controls overlaid on the map or **Ctrl/Cmd + scroll** to zoom; ordinary scrolling scrolls the page. On mobile, vertical swipes over the map scroll the page too. **Fit map** resets the camera. The overlay selector controls displayed manual and policy flows.

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
```

The build copies `index.html`, `_headers`, and `src/` into `dist/`. No bundling is performed.

## Source layout

| Path | Responsibility |
| --- | --- |
| `index.html` | Page, tabs, map area, dashboard container and New game dialog |
| `src/styles.css` | Responsive layout and styling |
| `src/game.js` | Browser UI, order entry, map rendering, autosave and view navigation |
| `src/engine.js` | Browser-independent map generation, policy evaluation, forecasts, AI and full round resolution; accepts injected RNG for reproducible tests |
| `tests/*.test.mjs` | Syntax/structure, graph generation, economy/policy and round-resolution regression tests |
| `scripts/build.mjs` | Prepare `dist/` |
| `wrangler.toml` | Cloudflare Worker name and static assets directory |

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

## Known limitations

- Simple AI and experimental balance.
- Browser-local **single-slot** saves; no cross-device sync, backup/export or server persistence.
- No deterministic full-game replay from the map seed alone: only procedural generation uses the seed, while live combat uses unseeded randomness.
- Navigation prompts are browser-dependent; game preservation relies on `localStorage`.
- Tests cover important engine scenarios, but this does not replace interactive browser testing.
