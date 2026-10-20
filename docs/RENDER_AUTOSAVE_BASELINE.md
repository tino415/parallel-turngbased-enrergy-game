# Rendering and autosave baseline

Measured on `main` at 15eff2b (before the state separation), headless Chromium
in the dev container, seeded `Math.random`. Reproduce with:

```sh
npm run measure:render -- test-results/render-baseline.json
```

`scripts/measure-render.mjs` builds `dist/`, serves it on port 4175, and runs
the same interactions at a desktop viewport (1440×900) and a touch viewport
(360×780) for three maps:

- **classic 14**: the default start, where Blue owns one node.
- **generated 120**: seed `measure-120`, 2 players, Blue owns one node.
- **generated 120, Blue owns 40 with policies**: the same map after the
  script hands Blue 40 connected nodes, each with an enabled policy, to
  approximate a mid-game state.

What the columns count:

- **render passes**: calls to `saveGame()`. `game.js` `render()` calls it
  exactly once per pass, and it also counts the passes that skip the outer
  `render()` wrapper.
- **render() ms**: time inside the outermost `render()` wrapper (the
  tactical-ui one). Treat it as indicative only: it varies between runs and the
  container is not a phone.
- **policyOrders / projection**: calls during the interaction.
- **elements added / removed**: distinct Element nodes inserted into or
  detached from the document, counted by a `MutationObserver`.
- **largest regions**: the nearest ancestor `id` of those changes.
- **storage writes / bytes**: calls to `localStorage.setItem` and the
  characters written.

Every count is deterministic, and desktop and mobile counts match except at
page load. The tables show desktop counts with the render time for both
viewports. Ctrl+wheel zoom runs on desktop only.

¹ The counters that wrap functions are installed after load, so the
page-load row records storage and DOM changes only. Each write there is one
render pass. The bytes column is desktop; mobile writes 5,692, 56,416 and
63,376 bytes.
² `#overlay` and `#clearAll` are bound in `ux.js` to the `render` that existed
before `tactical-ui.js` wrapped it. They run a full pass but skip the outer
wrapper, so it records no time for them, and `drawSelection()` and
`showInspector()` do not run (see observation 6).

### classic 14

| interaction                   |        render passes | render() ms desktop / mobile | policyOrders | projection | elements added / removed | largest regions                                | storage writes | bytes written |
| ----------------------------- | -------------------: | ---------------------------: | -----------: | ---------: | -----------------------: | ---------------------------------------------- | -------------: | ------------: |
| page load (restore save)      | 3 desktop, 4 mobile¹ |                          n/a |            0 |          0 |                466 / 227 | map 480, document 143, gameSidebar 32          |              3 |          4269 |
| camera: drag pan              |                    0 |                        0 / 0 |            0 |          0 |                    0 / 0 |                                                |              0 |             0 |
| camera: zoom in button        |                    1 |                   10.9 / 2.8 |            0 |          1 |                120 / 120 | map 224, tacticalNodeControls 8, log 4         |              1 |          1423 |
| camera: ctrl+wheel zoom       |                    1 |                    3.4 / n/a |            0 |          1 |                120 / 120 | map 224, tacticalNodeControls 8, log 4         |              1 |          1423 |
| camera: fit button            |                    1 |                      5 / 5.3 |            0 |          1 |                120 / 120 | map 224, tacticalNodeControls 8, log 4         |              1 |          1423 |
| view: dashboard tab           |                    1 |                    3.9 / 3.9 |            0 |          4 |                161 / 120 | map 204, dashboard 61, tacticalNodeControls 8  |              1 |          1423 |
| view: messages tab            |                    1 |                    2.3 / 1.5 |            0 |          1 |                100 / 100 | map 184, tacticalNodeControls 8, log 4         |              1 |          1423 |
| view: map tab                 |                    1 |                      2 / 1.6 |            0 |          1 |                120 / 100 | map 204, tacticalNodeControls 8, log 4         |              1 |          1423 |
| view: flow filter             |                    1 |                         n/a² |            0 |          1 |                 96 / 116 | map 204, log 4, orders 2                       |              1 |          1423 |
| select node (first tap)       |                    1 |                    2.3 / 2.6 |            2 |          2 |                185 / 135 | map 205, tacticalNodeControls 43, allocator 19 |              1 |          1420 |
| open node editor (second tap) |                    1 |                   15.5 / 9.5 |            2 |          3 |                213 / 220 | map 226, tacticalNodeControls 43, allocator 38 |              1 |          1420 |
| policy edit: invest %         |                    1 |                    5.1 / 2.8 |            9 |          3 |                218 / 248 | map 226, tacticalInspector 56, document 39     |              1 |          1479 |
| order edit: manual invest     |                    1 |                    3.7 / 2.8 |            9 |          3 |                218 / 253 | map 226, tacticalInspector 56, document 39     |              1 |          1532 |
| close editor (Escape)         |                    1 |                    1.3 / 1.8 |            5 |          1 |                125 / 176 | map 225, allocator 19, policyEditor 16         |              1 |          1535 |
| resolve round                 |                    1 |                    1.5 / 1.6 |            5 |          1 |                127 / 125 | map 224, orders 10, tacticalNodeControls 8     |              1 |          1712 |

### generated 120

| interaction                   |        render passes | render() ms desktop / mobile | policyOrders | projection | elements added / removed | largest regions                                 | storage writes | bytes written |
| ----------------------------- | -------------------: | ---------------------------: | -----------: | ---------: | -----------------------: | ----------------------------------------------- | -------------: | ------------: |
| page load (restore save)      | 3 desktop, 4 mobile¹ |                          n/a |            0 |          0 |              2764 / 1641 | map 4192, document 143, gameSidebar 32          |              3 |         42312 |
| camera: drag pan              |                    0 |                        0 / 0 |            0 |          0 |                    0 / 0 |                                                 |              0 |             0 |
| camera: zoom in button        |                    1 |                  13.3 / 10.2 |            0 |          1 |              1004 / 1004 | map 1992, tacticalNodeControls 8, log 4         |              1 |         14104 |
| camera: ctrl+wheel zoom       |                    1 |                   12.9 / n/a |            0 |          1 |              1004 / 1004 | map 1992, tacticalNodeControls 8, log 4         |              1 |         14104 |
| camera: fit button            |                    1 |                    11 / 10.4 |            0 |          1 |              1004 / 1004 | map 1992, tacticalNodeControls 8, log 4         |              1 |         14104 |
| view: dashboard tab           |                    1 |                    7.3 / 6.2 |            0 |          4 |               868 / 1004 | map 1795, dashboard 61, tacticalNodeControls 8  |              1 |         14104 |
| view: messages tab            |                    1 |                   10.5 / 3.6 |            0 |          1 |                807 / 807 | map 1598, tacticalNodeControls 8, log 4         |              1 |         14104 |
| view: map tab                 |                    1 |                    7.7 / 8.6 |            0 |          1 |               1004 / 807 | map 1795, tacticalNodeControls 8, log 4         |              1 |         14104 |
| view: flow filter             |                    1 |                         n/a² |            0 |          1 |               803 / 1000 | map 1795, log 4, orders 2                       |              1 |         14104 |
| select node (first tap)       |                    1 |                   13.9 / 7.7 |            2 |          2 |               1069 / 842 | map 1796, tacticalNodeControls 43, allocator 19 |              1 |         14102 |
| open node editor (second tap) |                    1 |                    29 / 18.2 |            2 |          3 |              1097 / 1104 | map 1994, tacticalNodeControls 43, allocator 38 |              1 |         14102 |
| policy edit: invest %         |                    1 |                   13.7 / 8.9 |            9 |          3 |              1102 / 1132 | map 1994, tacticalInspector 56, document 39     |              1 |         14162 |
| order edit: manual invest     |                    1 |                   14.9 / 8.7 |            9 |          3 |              1102 / 1137 | map 1994, tacticalInspector 56, document 39     |              1 |         14216 |
| close editor (Escape)         |                    1 |                    7.3 / 7.8 |            5 |          1 |              1009 / 1060 | map 1993, allocator 19, policyEditor 16         |              1 |         14218 |
| resolve round                 |                    1 |                    8.5 / 6.5 |            5 |          1 |              1012 / 1009 | map 1992, orders 10, tacticalNodeControls 8     |              1 |         14543 |

### generated 120, Blue owns 40 with policies

| interaction                   |        render passes | render() ms desktop / mobile | policyOrders | projection | elements added / removed | largest regions                               | storage writes | bytes written |
| ----------------------------- | -------------------: | ---------------------------: | -----------: | ---------: | -----------------------: | --------------------------------------------- | -------------: | ------------: |
| page load (restore save)      | 3 desktop, 4 mobile¹ |                          n/a |            0 |          0 |              3488 / 2122 | map 4387, orders 600, document 342            |              3 |         47532 |
| camera: drag pan              |                    0 |                        0 / 0 |            0 |          0 |                    0 / 0 |                                               |              0 |             0 |
| camera: zoom in button        |                    1 |                  19.6 / 21.3 |         1725 |         40 |              1247 / 1247 | map 2070, orders 400, uxSideOrders 10         |              1 |         15844 |
| camera: ctrl+wheel zoom       |                    1 |                   29.6 / n/a |         1725 |         40 |              1247 / 1247 | map 2070, orders 400, uxSideOrders 10         |              1 |         15844 |
| camera: fit button            |                    1 |                  15.5 / 17.9 |         1725 |         40 |              1247 / 1247 | map 2070, orders 400, uxSideOrders 10         |              1 |         15844 |
| view: dashboard tab           |                    1 |                    40.8 / 40 |         6525 |        160 |              2008 / 1247 | map 1873, dashboard 958, orders 400           |              1 |         15844 |
| view: messages tab            |                    1 |                  11.3 / 20.7 |         1725 |         40 |              1050 / 1050 | map 1676, orders 400, uxSideOrders 10         |              1 |         15844 |
| view: map tab                 |                    1 |                  13.7 / 15.1 |         1725 |         40 |              1247 / 1050 | map 1873, orders 400, uxSideOrders 10         |              1 |         15844 |
| view: flow filter             |                    1 |                         n/a² |         1725 |         40 |              1046 / 1243 | map 1873, orders 400, uxSideOrders 10         |              1 |         15844 |
| select node (first tap)       |                    1 |                    12.4 / 16 |         1767 |         41 |              1316 / 1089 | map 1874, orders 400, tacticalNodeControls 47 |              1 |         15841 |
| open node editor (second tap) |                    1 |                  22.6 / 25.3 |         1807 |         42 |              1344 / 1355 | map 2072, orders 400, tacticalNodeControls 47 |              1 |         15841 |
| policy edit: invest %         |                    1 |                  14.2 / 18.4 |         1807 |         42 |              1344 / 1383 | map 2072, orders 400, tacticalInspector 56    |              1 |         15841 |
| order edit: manual invest     |                    1 |                  17.6 / 19.5 |         1807 |         42 |              1344 / 1383 | map 2072, orders 400, tacticalInspector 56    |              1 |         15894 |
| close editor (Escape)         |                    1 |                  11.9 / 19.3 |         1725 |         40 |              1247 / 1302 | map 2071, orders 400, allocator 20            |              1 |         15897 |
| resolve round                 |                    1 |                  14.4 / 17.8 |         1725 |         40 |              1250 / 1247 | map 2070, orders 400, uxSideOrders 10         |              1 |         16365 |

## What the numbers show

1. **Each interaction except drag pan does a full render pass and a full
   autosave.** Zoom buttons, Ctrl+wheel, Fit, tab switches, the flow filter,
   selecting a node, and opening or closing the editor all call `render()`.
   That rebuilds the whole map SVG (about 1,000 elements removed and 1,000
   added on 120 nodes), the orders list, the
   log, the side panel and the inspector. It then serializes the whole match
   into `localStorage`, about 14 KB per write on 120 nodes and 16 KB in the
   mid-game state, even though no match state changed. Drag pan is already
   narrow: it sets the `<g>` transform directly, with no render and no write.
2. **The preview projection is quadratic in the number of policies.** Each
   `projection(id)` calls `previewOrders()`, and each call evaluates every
   policy again. With 40 Blue policies, one render pass costs 42
   `previewOrders` and 1,725 `policyOrders` calls. The dashboard costs 162 and
   6,525 calls, because it projects every owned node a few more times. Only
   one set of 40 evaluations per state revision is needed.
3. **Hidden views are still rebuilt.** On the Messages tab the map SVG is
   still rebuilt in full (1,598 elements on 120 nodes). The orders list (400
   elements with 40 policies) and the log are rebuilt on every pass, whether
   or not they are visible or have changed.
4. **Flow overlays are drawn and then deleted.** The `renderFlows` wrapper in
   `ux.js` appends `line.ux-flow-overlay` elements, and the wrapper in
   `tactical-ui.js` removes them again in the same pass. It also calls
   `previewOrders()` a second time.
5. **Page load writes three times on desktop and four on mobile.** Restoring a
   save renders once from `restoreGame()`, once from `ux.js`, once from
   `tactical-ui.js`, and once more from the mobile camera focus. Each of those
   passes serializes the match it has just read.
6. **Two controls bypass the outer render wrapper** (footnote ² above). That
   is also why the existing test "policy draft and focus survive a flow filter
   change" passes: the inspector is never rebuilt on that path. It is not
   listed here as a defect, but the narrowing below must not reintroduce a
   rebuild on that path.

Committed edits (policy %, manual invest, resolve) write once each and change
the bytes as expected, so the current save path is reliable. It is just too
broad.

## Proposed narrowing steps

Each step is a small PR of its own, measured against this baseline with the
same script. Steps 1–2 depend on the command and subscriber split from
"Separate game state, UI state and rendering behind explicit commands". Step 6
belongs to "Keep editor inputs, drafts and focus stable during UI updates".

1. **Persistence leaves render.** Call `saveGame()` from the committed-change
   path (the state-separation subscriber) instead of `render()`. Keep the
   `pagehide` and `beforeunload` flush, because `selected` and the Settings
   defaults are part of the unchanged save schema. A change to the defaults
   counts as a commit. Write synchronously, once per commit, with no
   coalescing at first. Target: camera, view, filter and inspector rows at
   0 writes, page load at 0 writes, and committed rows still at exactly 1.
   Regressions: a Chromium test that counts `setItem` for UI-only
   interactions (0) and for each committed edit (1), then reloads and checks
   that the edit survived.
2. **A camera-only path.** Zoom, Ctrl+wheel, Fit and Focus update the viewBox
   and transform the way drag pan and `redrawCamera()` in `ux.js` already do,
   and reposition the inspector. They make no `render()` call. Target: every
   camera row at 0 render passes, 0 writes and 0 elements.
3. **One projection per state revision.** Compute `previewOrders()` once per
   revision, index it by source and destination, and let `projection(id)`,
   both `renderFlows` wrappers and the dashboard read from that index. The
   memo is cleared by the revision counter that state separation introduces,
   or by each render pass until that lands. Target: 40 `policyOrders` calls
   per pass in the 40-policy state (now 1,725), and 40 on the dashboard (now
   6,525). Engine and order semantics do not change. A unit test pins
   projection results against the current implementation.
4. **Only the affected views update.** Skip the map SVG when
   `currentView !== 'map'`, rebuild the orders list only when orders or
   policies change or when its dialog is open, and append to the log instead
   of rebuilding it. Remove the ux overlay lines that `tactical-ui.js` deletes
   (observation 4). Target: the Messages and Dashboard rows without the map's
   ~1,600–1,900 elements, and the "orders 400" region only on order and
   policy edits.
5. **Split the map into a static layer and a dynamic layer.** Build the edges
   and node groups once per map, then update fills, labels, flows and the
   selection by attribute. This is the largest step. It goes last, and only
   if steps 1–4 leave render time noticeable on 120 nodes.
6. **The inspector is not rebuilt on every pass.** This belongs to the
   stable-editor task. List it here only to keep the measurements together;
   nothing in this plan duplicates that work.

Coalescing writes is not part of the plan. If measurements after step 1 still
show a need for it, it needs its own change. That change must flush on
`pagehide`, `visibilitychange` to hidden, round resolution and new game, and
must have tests for pending-write flushing and for a `setItem` that throws.
