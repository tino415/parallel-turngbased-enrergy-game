# Rendering and autosave baseline

Measured in the dev container with headless Chromium and a seeded `Math.random`.
Each table compares the change that narrowed rendering (#69, left of the arrow)
with renderers that subscribe to the store (right of the arrow). A cell without
an arrow did not change. The numbers from before #69 are in that version of this
file. Reproduce with:

```sh
npm run measure:render -- reports/render.json
```

`scripts/measure-render.mjs` builds `dist/`, serves it on port 4175, and runs
the same interactions at a desktop viewport (1440×900) and a touch viewport
(360×780) for three maps:

- **classic 14**: the default start, where Blue owns one node.
- **generated 120**: seed `measure-120`, 2 players, Blue owns one node.
- **generated 120, Blue owns 40 with policies**: the same map after the
  script hands Blue 40 connected nodes, each with an enabled policy, through
  `store.replaceMatch`, to approximate a mid-game state.

What the columns count:

- **map rebuilds**: `<g>` elements inserted into `#map`, one per full rebuild
  of the map SVG.
- **elements added / removed**: distinct Element nodes inserted into or
  detached from the document, counted by a `MutationObserver`.
- **commands + drawing ms**: time inside the outermost store command or
  `render()` call, which includes every subscriber it notifies. Indicative only:
  it varies by a few milliseconds between runs and the container is not a phone.
- **store notifications**: calls to a listener subscribed after load.
- **policy evaluations** and **forecasts**: calls the store makes to the
  engine's `planPolicy` and `forecast`. Round resolution inside the engine is
  not counted.
- **storage writes**: calls to `localStorage.setItem`.

The function counters are installed after load, so the page-load row has no
notifications or times. Every other count is deterministic. Desktop and touch
counts match, so the tables show desktop. Ctrl+wheel zoom runs on desktop only.

### classic 14

| interaction                   | map rebuilds | elements added / removed | commands + drawing ms | store notifications | policy evaluations | forecasts | storage writes |
| ----------------------------- | -----------: | -----------------------: | --------------------: | ------------------: | -----------------: | --------: | -------------: |
| page load (restore save)      |        3 → 2 |    571 / 212 → 470 / 110 |                     0 |                   0 |                  0 |         1 |              1 |
| camera: drag pan              |            0 |                    0 / 0 |             0.2 → 0.5 |                   8 |                  0 |         0 |              0 |
| camera: zoom in button        |            0 |                    0 / 0 |                     0 |                   1 |                  0 |         0 |              0 |
| camera: ctrl+wheel zoom       |            0 |                    0 / 0 |             0.1 → 0.2 |                   1 |                  0 |         0 |              0 |
| camera: fit button            |            0 |                    0 / 0 |               0.1 → 0 |                   1 |                  0 |         0 |              0 |
| view: messages tab            |            0 |           0 / 0 → 0 / 21 |             2.6 → 2.4 |                   1 |                  0 |         0 |              0 |
| view: map tab                 |            1 |    126 / 126 → 127 / 106 |               2 → 2.2 |                   1 |                  0 |         0 |              0 |
| select node (first tap)       |        1 → 0 |      128 / 127 → 23 / 22 |             2.3 → 0.5 |                   1 |                  0 |         0 |              0 |
| open node editor (second tap) |        1 → 0 |      202 / 127 → 97 / 22 |             5.6 → 4.4 |                   1 |                  0 |         0 |              0 |
| policy edit: invest %         |            1 |    132 / 128 → 133 / 129 |             4.2 → 4.3 |                   1 |                  1 |         1 |              1 |
| order edit: manual invest     |            1 |    132 / 132 → 133 / 133 |             3.2 → 3.4 |                   1 |                  1 |         1 |              1 |
| close editor (Escape)         |        1 → 0 |      131 / 132 → 26 / 27 |             1.8 → 0.5 |                   1 |                  0 |         0 |              0 |
| resolve round                 |            1 |    140 / 134 → 141 / 135 |                   3.4 |                   1 |                  1 |         1 |              1 |

### generated 120

| interaction                   | map rebuilds |  elements added / removed | commands + drawing ms | store notifications | policy evaluations | forecasts | storage writes |
| ----------------------------- | -----------: | ------------------------: | --------------------: | ------------------: | -----------------: | --------: | -------------: |
| page load (restore save)      |        3 → 2 |  3188 / 1838 → 2275 / 924 |                     0 |                   0 |                  0 |         1 |              1 |
| camera: drag pan              |            0 |                     0 / 0 |             0.5 → 0.4 |                   8 |                  0 |         0 |              0 |
| camera: zoom in button        |            0 |                     0 / 0 |                     0 |                   1 |                  0 |         0 |              0 |
| camera: ctrl+wheel zoom       |            0 |                     0 / 0 |                     0 |                   1 |                  0 |         0 |              0 |
| camera: fit button            |            0 |                     0 / 0 |                     0 |                   1 |                  0 |         0 |              0 |
| view: messages tab            |            0 |           0 / 0 → 0 / 198 |             6.9 → 2.6 |                   1 |                  0 |         0 |              0 |
| view: map tab                 |            1 |  1116 / 1116 → 1117 / 919 |            10.3 → 9.9 |                   1 |                  0 |         0 |              0 |
| select node (first tap)       |        1 → 0 |   1118 / 1117 → 200 / 199 |            12.5 → 1.3 |                   1 |                  0 |         0 |              0 |
| open node editor (second tap) |        1 → 0 |   1192 / 1117 → 274 / 199 |            15.6 → 6.5 |                   1 |                  0 |         0 |              0 |
| policy edit: invest %         |            1 | 1122 / 1118 → 1123 / 1119 |           14.8 → 14.2 |                   1 |                  1 |         1 |              1 |
| order edit: manual invest     |            1 | 1122 / 1122 → 1123 / 1123 |             14 → 12.1 |                   1 |                  1 |         1 |              1 |
| close editor (Escape)         |        1 → 0 |   1121 / 1122 → 203 / 204 |             9.3 → 1.2 |                   1 |                  0 |         0 |              0 |
| resolve round                 |            1 | 1135 / 1125 → 1136 / 1126 |           11.1 → 11.9 |                   1 |                  1 |         1 |              1 |

### generated 120, Blue owns 40 with policies

| interaction                   | map rebuilds |  elements added / removed | commands + drawing ms | store notifications | policy evaluations | forecasts | storage writes |
| ----------------------------- | -----------: | ------------------------: | --------------------: | ------------------: | -----------------: | --------: | -------------: |
| page load (restore save)      |        3 → 2 | 3504 / 1916 → 2751 / 1162 |                     0 |                   0 |                 40 |        40 |              1 |
| camera: drag pan              |            0 |                     0 / 0 |                   0.5 |                   8 |                  0 |         0 |              0 |
| camera: zoom in button        |            0 |                     0 / 0 |                     0 |                   1 |                  0 |         0 |              0 |
| camera: ctrl+wheel zoom       |            0 |                     0 / 0 |                   0.1 |                   1 |                  0 |         0 |              0 |
| camera: fit button            |            0 |                     0 / 0 |                     0 |                   1 |                  0 |         0 |              0 |
| view: messages tab            |            0 |           0 / 0 → 0 / 198 |                   2.2 |                   1 |                  0 |         0 |              0 |
| view: map tab                 |            1 |  1155 / 1155 → 1156 / 958 |           10.8 → 11.2 |                   1 |                  0 |         0 |              0 |
| select node (first tap)       |        1 → 0 |   1356 / 1355 → 399 / 398 |            14.7 → 2.4 |                   1 |                  0 |         0 |              0 |
| open node editor (second tap) |        1 → 0 |   1231 / 1156 → 274 / 199 |              19 → 6.8 |                   1 |                  0 |         0 |              0 |
| policy edit: invest %         |            1 | 1356 / 1356 → 1357 / 1357 |                  17.6 |                   1 |                 40 |        40 |              1 |
| order edit: manual invest     |            1 | 1356 / 1356 → 1357 / 1357 |           14.5 → 17.2 |                   1 |                 40 |        40 |              1 |
| close editor (Escape)         |        1 → 0 |   1355 / 1356 → 398 / 399 |            12.7 → 2.6 |                   1 |                  0 |         0 |              0 |
| resolve round                 |            1 | 1369 / 1359 → 1370 / 1360 |           14.7 → 15.3 |                   1 |                 40 |        40 |              1 |

## What changed

1. **Selection redraws only the selection.** Selecting a node, opening its
   editor and closing it no longer rebuild the map SVG or the score: on 120
   nodes that is about 200 elements instead of 1,100, and 2 to 7 ms instead of
   13 to 19. `tactical-ui.js` draws edge hit areas, rings and the swap button
   into one `.tactical-selection` layer it replaces, and the inspector in place.
2. **Every renderer subscribes.** `game.js`, `ux.js`, `tactical-ui.js`,
   `online.js`, `replay.js` and `leaderboard.js` redraw from the slices that
   changed; an interaction only calls commands. `render()` is `store.refresh()`.
3. **One notification per interaction.** `store.batch` groups the commands of a
   new game, a restore, an online update and the group editor, so each is drawn
   once. Page load rebuilds the map twice instead of three times.

Autosave is unchanged: one write per policy edit, order edit and resolve, none
for camera, view or inspector changes, one at page load.

## What is left

- Every match change still rebuilds the whole map SVG, about 1,350 elements and
  15 ms with 40 policies. Splitting it into a static layer (edges, node groups)
  and a dynamic one (fills, labels, flows) is the next step, worth taking if that
  time shows on a phone.
- Selecting a node still rebuilds the order list, about 400 elements with 40
  policies, because the list highlights the selected node.
