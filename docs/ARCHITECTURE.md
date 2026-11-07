# Architecture: state, commands and rendering

The game is fourteen classic scripts loaded with `defer` into one global scope, in
this order: `engine.js`, `custom-map.js`, `store.js`, `format.js`, `game.js`, `dialogs.js`,
`leaderboard.js`, `ux.js`, `tactical-ui.js`, `replay.js`, `rules.js`, `map-editor.js`,
`map-library.js`, `online.js`. Later scripts call functions from earlier ones and
never replace them.

| Module           | Owns                                                                                              | Touches the DOM |
| ---------------- | ------------------------------------------------------------------------------------------------- | --------------- |
| `engine.js`      | Rules: map generation, policy evaluation, forecast, AI, `resolveRound`                            | no              |
| `custom-map.js`  | A hand-made map: its file format, edits, validation and the generator-shaped map it plays as      | no              |
| `store.js`       | All match and interface state, commands, selectors, subscriptions                                 | no              |
| `format.js`      | Energy number formatting                                                                          | no              |
| `game.js`        | The base renderer, map navigation, save and restore, the global mirrors                           | yes             |
| `dialogs.js`     | Orders, Settings and Rules dialog buttons; opening a dialog or the menu closes the other overlays | yes             |
| `leaderboard.js` | The Leaderboard tab: one row per player, sorted by the chosen column, and the round chart         | yes             |
| `ux.js`          | Layout, dialogs, side panel, dock, camera fitting                                                 | yes             |
| `tactical-ui.js` | Map selection, node and connection groups, the inspector, pinch zoom, the ☰ menu                 | yes             |
| `replay.js`      | The replay screen, the game-over notice and the Replay menu item                                  | yes             |
| `rules.js`       | The Rules dialog and its ☰ menu item: the running match's rules                                  | yes             |
| `map-editor.js`  | The map editor mode: its tools, the node panel, the drawn map and its entry points                | yes             |
| `map-library.js` | My maps: the saved maps in the New game dialog, their files, and Save in the editor               | yes             |
| `online.js`      | The online lobby, the status bar, End turn, polling the server                                    | yes             |

## State ownership

`GameStore.createStore()` holds one frozen snapshot `{ match, ui }`. Every
change goes through a store command, and a slice keeps its identity until a
command really changes it.

| Value                                                 | Slice                 | Saved | Written by                          |
| ----------------------------------------------------- | --------------------- | ----- | ----------------------------------- |
| `state` (round, nodes, finished, rulesVersion, rules) | `match.state`         | yes   | `resolve`, `replaceMatch`           |
| manual orders per node                                | `match.orders`        | yes   | allocation and order commands       |
| persistent policies per node                          | `match.policies`      | yes   | policy commands, `resolve`          |
| policies of nodes lost, per colour                    | `match.keptPolicies`  | yes   | `resolve`                           |
| message history                                       | `match.history`       | yes   | `resolve`, `replaceMatch`           |
| map: `xy`, `edges`, `N`, `playerCount`, `mapSeed`     | `match.map`           | yes   | `replaceMatch`                      |
| conquest defaults (enabled, reserve, invest)          | `match.defaults`      | yes   | `setDefaults`                       |
| seat: the owner this browser plays                    | `match.seat`          | yes   | `classicMatch`, `generatedMatch`    |
| replay record: dice seed, start state, round inputs   | `match.replay`        | yes   | `resolve`, `replaceMatch`           |
| selected node                                         | `ui.selected`         | yes¹  | `select`, inspector commands        |
| view tab                                              | `ui.view`             | no    | `setView`                           |
| Leaderboard sort column and direction                 | `ui.leaderboardSort`  | no    | `sortLeaderboard`                   |
| Leaderboard chart: series, running total, focus       | `ui.leaderboardChart` | no    | `setLeaderboardChart`               |
| camera (`x`, `y`, `scale`)                            | `ui.camera`           | no    | `setCamera`                         |
| policy clipboard                                      | `ui.clipboard`        | no    | `copyPolicy`                        |
| node group selected on the map                        | `ui.bulkSelection`    | no    | group commands, `resolve`²          |
| connection group, each as `[source, destination]`     | `ui.bulkEdges`        | no    | group commands, `resolve`²          |
| group mode on the map                                 | `ui.groupMode`        | no    | `setGroupMode`, `leaveGroupMode`    |
| group editor open                                     | `ui.groupEditing`     | no    | `setGroupEditing`, `leaveGroupMode` |
| inspector target, editing, focused node               | `ui.inspector`        | no    | inspector commands                  |
| AI debug view (AI plans on the map and inspector)     | `ui.aiDebug`          | no    | `setAiDebug`, `?aidebug` in the URL |
| map values: amounts or standing policies              | `ui.mapValues`        | no    | `setMapValues`                      |
| replay frame and play state                           | `ui.replay`           | no    | replay commands                     |
| map editor: map, tool, selection, link start, undo    | `editor`              | no    | map editor commands                 |

¹ `selected` stays in the save format so that old saves keep loading. ux.js
clears it on load.

² `resolve` drops the nodes the player no longer owns and the connections that no
longer touch the player's nodes, so a group survives rounds but never holds a lost
node. A group holds nodes or connections, never both.

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
  call `Math.random` and never change the match. `previewOrders`, `policyPlan` and
  `projection` are computed once per match object, so a match is never changed
  in place. `replayFrames` and `playerHistory` are the ones that
  resolves rounds: it re-runs the recorded ones with their recorded dice.
- **Subscriptions** (`store.subscribe((snapshot, previous) => ...)`) run
  synchronously after every commit, in the order they subscribed. A command a
  listener issues is queued and reaches every listener after the current change.
  `store.batch(run)` commits the commands inside `run` as one change, notified
  once. `store.refresh()` notifies every listener with `previous === null`, so
  a listener tests a slice with `GameStore.changed(snapshot, previous, read)`.
  `game.js` uses one to refresh the global mirrors and to autosave when `match`
  changed.
- **Autosave** writes once per committed match change, plus on `pagehide` and
  `beforeunload`. Camera, view and inspector changes never write.
- **Globals** `state`, `orders`, `policies`, `history`, `xy`, `edges`, `N`,
  `playerCount`, `mapSeed`, `currentView`, `clipboard`, `selected` and
  `camera` are read-only mirrors of the snapshot, kept for the existing
  readers, the specs and the console. Never assign them: the next commit
  overwrites the assignment, and nothing saves it. Use a command, or
  `store.replaceMatch` in test setup.

## Rendering

Every renderer subscribes to the store and redraws what the slices it reads
changed; an interaction only calls commands. The subscriptions run in script
order, so the three map layers keep their order:

1. `game.js` moves the camera transform, and draws the score, the SVG map (only
   while the map tab is shown), the order list, the log and the tab state.
2. `ux.js` sets the camera viewBox, the wide layout of the other tabs and the
   starting camera of a new map.
3. `tactical-ui.js` repositions the inspector on a camera change. When the match,
   the view, the AI debug switch, the selection, the inspector, the clipboard or
   the group changes, it draws edge hit areas, selection and group rings into one
   `.tactical-selection` layer, the group bar and the inspector for one node,
   one edge, the node group or the connection group, which it updates in place
   to keep drafts and focus. A rejected command commits nothing, so the
   inspector redraws itself to show the stored value again.

`render()` is `store.refresh()`, for the specs and the console. `renderMap`
records the focused map item before clearing the map, and `tactical-ui.js`
focuses it again after drawing its layer.

`leaderboard.js`, `replay.js`, `rules.js`, `map-editor.js`, `map-library.js` and
`online.js` subscribe the same way. `game.js` shows and hides `#leaderboardView`
with the other views.

| DOM subtree                                                                             | Rendered by      |
| --------------------------------------------------------------------------------------- | ---------------- |
| `#map` content and flow colors, `#score`, `#resolve`, `#log`, `#orders`                 | `game.js`        |
| `#map` viewBox and camera transform, `#uxSide*`, `#uxDock*`                             | `ux.js`          |
| `#tacticalInspector`, `#tacticalGroupBar`, `#tacticalMenu`, `.tactical-edge-hit`, rings | `tactical-ui.js` |
| `#leaderboardTable` rows and header sort marks, `#leaderboardCharts`                    | `leaderboard.js` |
| `#replayDialog`, `#gameOverNotice`, the Replay item in `#tacticalMenu`                  | `replay.js`      |
| `#currentRules`, the Rules item in `#tacticalMenu`                                      | `rules.js`       |
| `#map` content while editing, `#mapEditorBar`, `#mapEditorInspector`, `#mapEditorHead`  | `map-editor.js`  |
| `.map-source`, `#mapLibrary`, `#mapEditorSave`                                          | `map-library.js` |

`tactical-ui.js` builds the node and connection editors inside the inspector
from store selectors and commands.

## Map editor

A hand-made map is `{ name, positions, links, owners }`: integer node positions
on the generator's 1800×1050 canvas, connections as `[lower, higher]` pairs and
the colour that starts on each node, `null` for a neutral one. `custom-map.js`
owns that shape: every edit is a pure function returning a new map, or the same
map when nothing changes; `problems` lists what stops the map from being played
(fewer than two nodes, fewer than two colours, a colour skipped in order, nodes
nobody can reach, nodes closer than `MIN_DISTANCE` or outside the canvas);
`toGeneratorMap` turns a playable map into what `buildMap` would have produced,
every start node with 24 active and 14 invested and every neutral node with a
random 3 to 7, so `generatedMatch` starts it like any other map. `serialize` and
`parse` are the `peg-map/1` file format, and `parse` throws a message meant for
the player.

The store keeps the open editor in its third slice, `editor`: the map, the tool
(`select`, `link`, `erase`), the selected node, the node a link starts from, and
the `past` and `future` maps for undo. `openMapEditor` switches `ui.view` to
`editor` and `closeMapEditor` drops the slice and returns to the map view unless
the player switched view meanwhile. A command that changes the map remembers the
one before it; `beginMapMove` remembers once at the start of a drag, so the
`moveMapNode` calls that follow are one undo step. `markMapSaved` records the
saved map, and `mapEditorDirty` compares against it.

`map-editor.js` is the editor's interface, a mode of the tactical map. The ☰
menu opens the running match's map in it and the New game dialog opens the map
its settings would generate. While `ui.view` is `editor`, `game.js` keeps
`#mapViewport` and the zoom buttons shown but draws nothing into `#map`, `ux.js`
fits the camera to the editor canvas below the editor bar, `body.map-editing`
hides the game's own controls, and `map-editor.js` draws the canvas, the
connections and the nodes from the `editor` slice on every change, keeping the
focused node. A press on a node stops before the map's pan gesture: a move
beyond a few pixels drags it in the select tool, a release without one is a tap
that the tool decides on. The bar holds the name, the tools, Undo and Redo,
Play, which starts a match from `toGeneratorMap`, and the list of `problems`.
The node panel edits the selected node's colour and connections.

`map-library.js` keeps the saved maps, My maps, in this browser's
`localStorage` under `parallel-energy-game-maps-v1`, each as its `peg-map/1`
file with an id, re-read whenever the New game dialog opens and parsed with
`parse`, so a broken entry is dropped rather than shown. The dialog's map
source switch swaps the generator fields and preview for the gallery; a chosen
map fills the colour choice from its start nodes, and Start game plays it
through `toGeneratorMap` with the dialog's rules. Edit opens it in the editor
and remembers its id, so Save in the editor overwrites that entry; a map opened
from the match or the generator is added on its first Save. Export writes the
file through a download and Import reads one through a file input.

A saved map also hosts an online match: `map-library.js` exposes `MapLibrary`,
whose `newGameChoice` is the playable map chosen in the dialog, which New online
match sends instead of generator options, and whose `playable` lists the saved
maps the lobby's Map choice offers next to Generated. A match on a map this
browser does not hold shows it as its own entry under the map's name; choosing
a map hides the generator fields and leaves the turn time.

## Replay

A round is a pure function of the state, the orders, the policies, the kept
policies, the conquest defaults and the dice; the AI is computed inside it. A node
lost keeps its policy for the rest of the match, per colour, and the colour gets it
back, pressure included, when it retakes the node; the conquest default applies
only when nothing was kept. `replay.keptPoliciesFrom` is the round from which that
rule applies: 1 for a new match, the round of the first resolve for a match or save
recorded before it, whose earlier rounds rebuild without it; a replay without it
never applied the rule. A new match draws a `diceSeed`, round _r_ resolves with
`seeded(diceSeed + ':' + r)`, and `resolve` appends the round's inputs to
`match.replay.rounds`: the orders, the defaults and the policies that differ from
what the previous round left behind (`policiesAfterLastRound`). `replayFrames`
rebuilds every round from `match.replay.start`, with its state, its log and the
moves carried out. A match loaded from a save without `replay` keeps
`replay: null`, resolves with `Math.random` and offers no replay. When the replay
does not fit in localStorage, `game.js` saves the match without it.

`replay.js` caches the frames per `match.replay` and keeps the play timer, the
inspected node and the dismissed game-over notice to itself.
It draws each move with `drawPlayerMove` from `game.js`, the arrow the AI debug
view draws: the mover's colour, solid with ⚔ for an attack, dotted with → for
a transfer, and an `I` label over a node that invests.

## Seat

`match.seat` is the owner this browser plays, chosen in the New game dialog from all six colours
(default 0, Blue). A save without the field loads as seat 0, and so does a
replay without `replay.seat`. The store's `isOwn` compares with it, the
interface reads it through `isMine(id)` and `mySeat()` in `game.js`, and
`resolveRound`, `aiPlan`, `economicAI` and `aiOrders` take it as `seat`: the AI
plans for every other owner, and a friendly target means a node with the same
owner as the source. When the seat is outside the first N colours, the map lists
its colours in `map.owners` (absent means the first N) and the last slot takes the
seat's colour; standings and the leaderboard walk that list. `replayFrames` re-runs the rounds with `replay.seat`.

## Online matches

An online match runs on a Cloudflare Worker (`server/worker.mjs`) with one Durable
Object per match; `wrangler.toml` binds it as `MATCHES` and routes only `/api/*`
to the Worker, the rest is static assets. The Durable Object is a thin shell:
it hashes the bearer token, loads the record, calls one function of
`server/match.mjs` and stores the result. Those functions are plain and
tested with `node --test`; they load `engine.js` and `store.js` as side-effect
imports and resolve rounds with the store's own `resolve`.

- The record holds the store's match (map, state, policies, kept policies, history, replay) plus the
  seats, each seat's token hash, conquest defaults and the turn submitted for the
  round. The dice seed is the replay's `diceSeed`, generated on the server.
- A match is created from generator options or from a hand-made map: `options.map` is a
  `peg-map/1` file, which `custom-map.js`, loaded by the server as well, parses and checks
  for `problems` before `toGeneratorMap` starts it; a broken or unplayable map is refused
  with 400 and the reason. The record's `options` are then `{ map, turnTime }`, and the
  client sends the map again with a turn time change.
- In the lobby the host can rebuild the map from new options or send another map; seats
  the new map still has keep their player. The host's cancel replaces the record with
  `{ id, cancelled: true }`, answered with 410. Every write moves the Durable Object's
  alarm seven days ahead, and the alarm deletes the match.
- `match.humanSeats` lists the colours people play; the engine plans the AI for
  every other owner, and a policy leaves with its node but is kept per colour and
  restored when that colour retakes the node. `match.seat` is still the colour this
  browser plays, `isMine` still reads it.
- A player other than the host can leave: in the lobby the colour is free again, during
  play it leaves `humanSeats` with its policies and the AI plays it from the next round.
  Each recorded round carries the `humanSeats` it was resolved with, so the replay plans
  the AI for the same colours. The host has no Leave until the match is over; cancelling
  is the host's exit.
- The host can free another player's colour (`POST /seats/<owner>/free`) or hand it to the AI
  (`.../ai`), in the lobby and during play, but never their own. Freeing drops the seat's token
  hash, so the old device becomes a spectator, and during play it leaves `humanSeats` like a
  leave. A freed seat is `open`: anyone without a colour can take it, also mid-match, which adds
  it to `humanSeats` and makes the round wait for them. A seat handed to the AI is `ai` and
  cannot be taken until the host frees it.
- The host can make another player the host (`POST /seats/<owner>/host`), in the lobby or during
  play: `hostTokenHash` moves to that seat's token hash, so only a seat a present player holds can
  take it. The old host is a guest from then on and can leave like one.
- The host picks a turn time in the lobby (`options.turnTime`: 2 min, 10 min, 1 h or 24 h, default
  24 h; a match stored without one has no timer). When a round starts with a human to wait for,
  the record gets a `deadline` and the Durable Object's alarm is set to the earlier of that and the
  seven-day idle expiry (kept separately as `expiresAt`, which only player actions renew). At the
  deadline `expireTurn` counts a miss for each colour that has not ended its turn and resolves the
  round without their manual orders; their standing policies still run. The third miss in a row
  hands the colour to the AI like a leave but keeps the token: the seat is `away`, outside
  `humanSeats`, and ending a turn again (or taking the seat) brings it back. A view carries
  `secondsLeft`, which the client turns into a countdown in the status button and the panel. With
  `ALLOW_SHORT_TURNS` set, as `wrangler dev` does in the Playwright config, a match may ask for a
  turn time under two minutes.
- The server keeps only the orders of nodes the sender owns, cleans every number,
  and shows a seat only its own policies and submitted turn. The replay (orders and
  dice seed) is sent when the match is finished, which is also when the Leaderboard
  charts and the Replay become available online.
- `online.js` keeps the seat token in localStorage under `parallel-energy-online:<id>`,
  polls `GET /api/matches/<id>` every four seconds while the tab is visible, and puts
  the result into the store with `replaceMatch`, marked `match.online`. An online match
  is never autosaved, `store.resolve` does nothing in it, and the AI debug view is off,
  because it would show hidden orders. `sw.js` leaves `/api/` to the network.
- ☰ › "My seat link" shows `?match=<id>#seat=<token>`. A browser that opens it stores the token
  from the fragment, which never reaches a server log, and removes it from the address bar,
  so the same colour plays on a second device. Whoever holds the link plays that colour.
- Nothing of an online match floats over the map during play. A button beside End turn
  (in the phone dock and the desktop header) shows a green dot and how many of the
  playing humans ended their turn, and opens `#onlinePanel`, which is also the lobby.
  End turn reads "Turn ended ✓" while the server holds exactly this browser's orders,
  policies and conquest defaults, and "Update turn" once any of them changes.

## Next steps

- Retire the read-only mirrors as their readers move to the snapshot.
