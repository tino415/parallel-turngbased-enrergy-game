# Architecture: state, commands and rendering

The game is eight classic scripts loaded with `defer` into one global scope, in
this order: `engine.js`, `store.js`, `format.js`, `game.js`, `dialogs.js`,
`leaderboard.js`, `ux.js`, `tactical-ui.js`. Later scripts build on, and in
places replace, functions from earlier ones.

| Module           | Owns                                                                    | Touches the DOM |
| ---------------- | ----------------------------------------------------------------------- | --------------- |
| `engine.js`      | Rules: map generation, policy evaluation, forecast, AI, `resolveRound`  | no              |
| `store.js`       | All match and interface state, commands, selectors, subscriptions       | no              |
| `format.js`      | Energy number formatting                                                | no              |
| `game.js`        | The base renderer, map navigation, save and restore, the global mirrors | yes             |
| `dialogs.js`     | The Orders and Settings dialog buttons                                  | yes             |
| `leaderboard.js` | The Leaderboard tab: one row per player, sorted by the chosen column    | yes             |
| `ux.js`          | Layout, dialogs, side panel, dock, camera fitting                       | yes             |
| `tactical-ui.js` | Map selection and node groups, the inspector, pinch zoom, the ☰ menu   | yes             |

## State ownership

`GameStore.createStore()` holds one frozen snapshot `{ match, ui }`. Every
change goes through a store command, and a slice keeps its identity until a
command really changes it.

| Value                                                  | Slice                | Saved | Written by                          |
| ------------------------------------------------------ | -------------------- | ----- | ----------------------------------- |
| `state` (round, nodes, finished, rulesVersion)         | `match.state`        | yes   | `resolve`, `replaceMatch`           |
| manual orders per node                                 | `match.orders`       | yes   | allocation and order commands       |
| persistent policies per node                           | `match.policies`     | yes   | policy commands, `resolve`          |
| message history                                        | `match.history`      | yes   | `resolve`, `replaceMatch`           |
| map: `xy`, `edges`, `N`, `playerCount`, `mapSeed`      | `match.map`          | yes   | `replaceMatch`                      |
| conquest defaults (enabled, reserve, invest)           | `match.defaults`     | yes   | `setDefaults`                       |
| selected node                                          | `ui.selected`        | yes¹  | `select`, inspector commands        |
| view tab                                               | `ui.view`            | no    | `setView`                           |
| Leaderboard sort column and direction                  | `ui.leaderboardSort` | no    | `sortLeaderboard`                   |
| camera (`x`, `y`, `scale`)                             | `ui.camera`          | no    | `setCamera`                         |
| policy clipboard                                       | `ui.clipboard`       | no    | `copyPolicy`                        |
| node group selected on the map                         | `ui.bulkSelection`   | no    | group commands, `resolve`²          |
| group mode on the map                                  | `ui.groupMode`       | no    | `setGroupMode`, `leaveGroupMode`    |
| group editor open                                      | `ui.groupEditing`    | no    | `setGroupEditing`, `leaveGroupMode` |
| inspector target, editing, open sections, focused node | `ui.inspector`       | no    | inspector commands                  |

¹ `selected` stays in the save format so that old saves keep loading. ux.js
clears it on load.

² `resolve` drops the nodes Blue no longer owns, so the group survives rounds
but never holds a lost node.

Gesture and render bookkeeping stays local to the code that needs it, because
no other code reads it: drag and click suppression (`game.js`), pinch fingers
and the long-press timer (`tactical-ui.js`), the map key behind mobile
auto-focus (`ux.js`) and the round counter that closes the inspector after a
resolve (`tactical-ui.js`). Form drafts stay in their inputs and are read once
on submit: the new-game dialog and the group's invest-on-each amount.

## Contract

- **Commands** (`store.<command>(...)`) validate input, call the engine where
  rules apply, and commit at most one new snapshot. A command that changes
  nothing commits nothing. `setAllocation` returns the energy limit when it
  rejects an over-budget amount; the caller shows the hint.
- **Selectors** (`GameStore.selectors.<name>(match, ...)`) derive plans,
  budgets, policy orders, previews, projections and the edge source. They never
  draw random numbers and never resolve a round.
- **Subscriptions** (`store.subscribe((snapshot, previous) => ...)`) run
  synchronously after every commit. `game.js` uses one to refresh the global
  mirrors and to autosave when `match` changed; `tactical-ui.js` uses one to
  mirror `ui.inspector`.
- **Autosave** writes once per committed match change, plus on `pagehide` and
  `beforeunload`. Camera, view and inspector changes never write.
- **Globals** `state`, `orders`, `policies`, `history`, `xy`, `edges`, `N`,
  `playerCount`, `mapSeed`, `currentView`, `clipboard`, `selected` and
  `camera` are read-only mirrors of the snapshot, kept for the existing
  readers, the specs and the console. Never assign them: the next commit
  overwrites the assignment, and nothing saves it. Use a command, or
  `store.replaceMatch` in test setup.

## Rendering

Rendering is still the explicit `render()` call each interaction made before
the store existed, so no render runs that did not run before. `render` is
replaced in load order, and each layer calls the previous one:

1. `game.js` draws the SVG map, score, allocator, policy editor, order list,
   log and tab state.
2. `ux.js` adds the camera viewBox, side panel, dock, editor stats,
   budget bar and income labels.
3. `tactical-ui.js` adds edge hit areas, selection and group rings, the group
   bar and the inspector for one node, one edge or the node group, which it
   updates in place to keep drafts and focus.

`renderFlows`, `renderOrders`, `clickNode`,
`showNodeOnMobile` and `positionNodeDetails` are also replaced in load order.
The last definition wins and is the one in use.

`leaderboard.js` stays out of the chain: it subscribes to the store and redraws
the leaderboard when the match, the sort or the view changes while the tab is
shown. `game.js` still shows and hides `#leaderboardView` with the other views.

| DOM subtree                                                                                               | Rendered by      |
| --------------------------------------------------------------------------------------------------------- | ---------------- |
| `#map` content, `#score`, `#resolve`, `#log`, `#orders`, `#allocator`, `#policyEditor`                    | `game.js`        |
| `#map` viewBox and camera transform, `#uxSide*`, `#uxDock*`, `#uxEditorStats`, `#uxBalance`               | `ux.js`          |
| `#tacticalInspector`, `#tacticalGroupBar`, `#tacticalMenu`, `.tactical-edge-hit`, rings, flow edge colors | `tactical-ui.js` |
| `#leaderboardTable` rows and header sort marks                                                            | `leaderboard.js` |

`#allocator` and `#policyEditor` are built by `game.js`. `tactical-ui.js` moves
their sections into the inspector while it edits a node and parks them in the
hidden `#tacticalNodeControls` otherwise. The legacy `#nodeDialog` never shows,
because `tactical-ui.js` closes it whenever it opens, but `ux.js` still renders
the editor stats, budget bar and notes into it.

## Next steps

- Let renderers subscribe to the slices they draw instead of being called
  explicitly, one subtree each, and retire the `render = function` chain. The
  order of the three layers has to survive this; `docs/RENDER_AUTOSAVE_BASELINE.md` has the numbers to compare.
- Remove the legacy `#nodeDialog` and the `ux.js` editor stats, budget bar and
  notes that render into it unseen.
- Retire the read-only mirrors as their readers move to the snapshot.
