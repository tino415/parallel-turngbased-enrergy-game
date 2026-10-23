# Rendering and autosave baseline

Measured in the dev container with headless Chromium and a seeded `Math.random`.
Each table compares `main` at c1c2f5a (left of the arrow) with the change that
narrowed rendering (right of the arrow). A cell without an arrow did not change.
Reproduce with:

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

- **render passes**: calls to the outermost `render()`.
- **map rebuilds**: `<g>` elements inserted into `#map`, one per full rebuild
  of the map SVG.
- **policy evaluations** and **forecasts**: calls the store makes to the
  engine's `planPolicy` and `forecast`. Round resolution inside the engine is
  not counted.
- **elements added / removed**: distinct Element nodes inserted into or
  detached from the document, counted by a `MutationObserver`.
- **render() ms**: time inside the outermost `render()`. Indicative only: it
  varies between runs and the container is not a phone.
- **storage writes**: calls to `localStorage.setItem`.

The function counters are installed after load, so the page-load row has no
render passes or times. Every other count is deterministic. Desktop and touch
counts match, so the tables show desktop. Ctrl+wheel zoom runs on desktop only.

### classic 14

| interaction                   | render passes | map rebuilds | policy evaluations | forecasts | elements added / removed | render() ms | storage writes |
| ----------------------------- | ------------: | -----------: | -----------------: | --------: | -----------------------: | ----------: | -------------: |
| page load (restore save)      |             0 |            3 |                  0 |     6 → 1 |    579 / 220 → 571 / 212 |           0 |              1 |
| camera: drag pan              |             0 |            0 |                  0 |         0 |                    0 / 0 |           0 |              0 |
| camera: zoom in button        |         1 → 0 |        1 → 0 |                  0 |     2 → 0 |        130 / 130 → 0 / 0 |     3.5 → 0 |              0 |
| camera: ctrl+wheel zoom       |         1 → 0 |        1 → 0 |                  0 |     2 → 0 |        130 / 130 → 0 / 0 |     3.3 → 0 |              0 |
| camera: fit button            |         1 → 0 |        1 → 0 |                  0 |     2 → 0 |        130 / 130 → 0 / 0 |     1.6 → 0 |              0 |
| view: messages tab            |             1 |        1 → 0 |                  0 |     2 → 0 |        110 / 130 → 0 / 0 |     3 → 3.2 |              0 |
| view: map tab                 |             1 |            1 |                  0 |     2 → 0 |    130 / 110 → 126 / 126 |         1.9 |              0 |
| select node (first tap)       |             1 |            1 |                  0 |     2 → 0 |    131 / 130 → 128 / 127 |     2 → 2.3 |              0 |
| open node editor (second tap) |             1 |            1 |                  0 |     3 → 0 |    206 / 131 → 202 / 127 |   5.7 → 5.9 |              0 |
| policy edit: invest %         |             1 |            1 |              6 → 1 |     3 → 1 |    135 / 131 → 132 / 128 |     4 → 4.2 |              1 |
| order edit: manual invest     |             1 |            1 |              6 → 1 |     3 → 1 |    135 / 135 → 132 / 132 |   7.4 → 2.9 |              1 |
| close editor (Escape)         |             1 |            1 |              5 → 0 |     2 → 0 |    134 / 135 → 131 / 132 |   2.2 → 1.8 |              0 |
| resolve round                 |             1 |            1 |              5 → 1 |     2 → 1 |                140 / 134 |     1.7 → 2 |              1 |

### generated 120

| interaction                   | render passes | map rebuilds | policy evaluations | forecasts |  elements added / removed | render() ms | storage writes |
| ----------------------------- | ------------: | -----------: | -----------------: | --------: | ------------------------: | ----------: | -------------: |
| page load (restore save)      |             0 |            3 |                  0 |     6 → 1 | 3198 / 1848 → 3188 / 1838 |           0 |              1 |
| camera: drag pan              |             0 |            0 |                  0 |         0 |                     0 / 0 |           0 |              0 |
| camera: zoom in button        |         1 → 0 |        1 → 0 |                  0 |     2 → 0 |       1121 / 1121 → 0 / 0 |    11.7 → 0 |              0 |
| camera: ctrl+wheel zoom       |         1 → 0 |        1 → 0 |                  0 |     2 → 0 |       1121 / 1121 → 0 / 0 |    12.2 → 0 |              0 |
| camera: fit button            |         1 → 0 |        1 → 0 |                  0 |     2 → 0 |       1121 / 1121 → 0 / 0 |     9.5 → 0 |              0 |
| view: messages tab            |             1 |        1 → 0 |                  0 |     2 → 0 |        924 / 1121 → 0 / 0 |   7.6 → 1.9 |              0 |
| view: map tab                 |             1 |            1 |                  0 |     2 → 0 |  1121 / 924 → 1116 / 1116 |  9.3 → 10.6 |              0 |
| select node (first tap)       |             1 |            1 |                  0 |     2 → 0 | 1122 / 1121 → 1118 / 1117 | 14.7 → 12.4 |              0 |
| open node editor (second tap) |             1 |            1 |                  0 |     3 → 0 | 1197 / 1122 → 1192 / 1117 |        15.1 |              0 |
| policy edit: invest %         |             1 |            1 |              6 → 1 |     3 → 1 | 1126 / 1122 → 1122 / 1118 | 13.9 → 13.2 |              1 |
| order edit: manual invest     |             1 |            1 |              6 → 1 |     3 → 1 | 1126 / 1126 → 1122 / 1122 | 15.9 → 12.6 |              1 |
| close editor (Escape)         |             1 |            1 |              5 → 0 |     2 → 0 | 1125 / 1126 → 1121 / 1122 |   8.9 → 9.4 |              0 |
| resolve round                 |             1 |            1 |              5 → 1 |     2 → 1 |               1135 / 1125 |  8.4 → 12.2 |              1 |

### generated 120, Blue owns 40 with policies

| interaction                   | render passes | map rebuilds | policy evaluations | forecasts |  elements added / removed | render() ms | storage writes |
| ----------------------------- | ------------: | -----------: | -----------------: | --------: | ------------------------: | ----------: | -------------: |
| page load (restore save)      |             0 |            3 |          9880 → 40 |  240 → 40 | 3912 / 2324 → 3504 / 1916 |           0 |              1 |
| camera: drag pan              |             0 |            0 |                  0 |         0 |                     0 / 0 |           0 |              0 |
| camera: zoom in button        |         1 → 0 |        1 → 0 |           3320 → 0 |    80 → 0 |       1359 / 1359 → 0 / 0 |    25.5 → 0 |              0 |
| camera: ctrl+wheel zoom       |         1 → 0 |        1 → 0 |           3320 → 0 |    80 → 0 |       1359 / 1359 → 0 / 0 |    25.7 → 0 |              0 |
| camera: fit button            |         1 → 0 |        1 → 0 |           3320 → 0 |    80 → 0 |       1359 / 1359 → 0 / 0 |    24.1 → 0 |              0 |
| view: messages tab            |             1 |        1 → 0 |           3320 → 0 |    80 → 0 |       1162 / 1359 → 0 / 0 |  23.5 → 1.7 |              0 |
| view: map tab                 |             1 |            1 |           3320 → 0 |    80 → 0 | 1359 / 1162 → 1155 / 1155 |   20.6 → 13 |              0 |
| select node (first tap)       |             1 |            1 |           3320 → 0 |    80 → 0 | 1360 / 1359 → 1356 / 1355 | 23.3 → 14.5 |              0 |
| open node editor (second tap) |             1 |            1 |           3360 → 0 |    81 → 0 | 1435 / 1360 → 1231 / 1156 | 26.9 → 18.2 |              0 |
| policy edit: invest %         |             1 |            1 |          3360 → 40 |   81 → 40 | 1360 / 1360 → 1356 / 1356 | 27.7 → 16.5 |              1 |
| order edit: manual invest     |             1 |            1 |          3360 → 40 |   81 → 40 | 1360 / 1360 → 1356 / 1356 | 28.9 → 14.3 |              1 |
| close editor (Escape)         |             1 |            1 |           3320 → 0 |    80 → 0 | 1359 / 1360 → 1355 / 1356 | 22.2 → 12.1 |              0 |
| resolve round                 |             1 |            1 |          3320 → 40 |   80 → 40 |               1369 / 1359 | 22.3 → 12.1 |              1 |

## What changed

1. **Camera moves draw nothing.** Zoom, Ctrl+wheel, Fit, Focus, pinch and drag
   commit `setCamera` only. A `game.js` subscriber moves the map's `<g>`
   transform and a `tactical-ui.js` subscriber repositions the inspector. No
   render pass, no element, no write.
2. **Derived previews are computed once per match.** The store memoizes
   `previewOrders`, `policyPlan` (and so `policyOrders`) and `projection` per
   match object, which every commit replaces. With 40 policies a pass costs 40
   policy evaluations after an edit and none otherwise, instead of 3,320.
   Code that changes the match in place, instead of committing a new one, now
   sees stale previews; the specs that did so now use `store.replaceMatch`.
3. **Hidden and unchanged views are skipped.** The map SVG is not rebuilt while
   the Messages or Leaderboard tab is shown, and is rebuilt when the map is
   shown again. The order list is rebuilt only when the match or the selected
   node changes, and the log only when the history changes.
4. **No flow line is drawn to be deleted.** `ux.js` no longer draws the
   overlay line that `tactical-ui.js` used to remove in the same pass.

Autosave already wrote only on committed match changes: one write per policy
edit, order edit and resolve, none for camera, view or inspector changes, one
at page load. That is unchanged, and `tests/e2e/autosave.spec.mjs` pins it.

## What is left

- Selecting a node, opening or closing the editor and every edit still rebuild
  the whole map SVG, about 2,200 elements on 120 nodes. Selecting a node also
  rebuilds the order list, about 400 elements with 40 policies, because the
  list highlights the selected node.
- `render()` is still the explicit chain of three layers. Letting each layer
  subscribe to the slices it draws would let a selection redraw only the
  rings and the inspector. That is the next step in `docs/ARCHITECTURE.md`.
- Splitting the map into a static layer (edges, node groups) and a dynamic one
  (fills, labels, flows) remains the largest step, worth taking only if render
  time on 120 nodes still shows after the subscription.
