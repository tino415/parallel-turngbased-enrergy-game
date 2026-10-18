# Map-first contextual orders

**Status:** UI-only implementation proposed in [PR #14](https://github.com/tino415/parallel-turngbased-enrergy-game/pull/14). This document records the agreed interaction model, not a production deployment announcement.

## Interaction decisions

- The tactical map occupies the available page width. The permanent sidebar is removed and the header is condensed to round status, Resolve, and an overflow menu for Orders, Settings, and New game.
- Nodes represent energy and persistent policies. Edges represent attacks and friendly support transfers.
- The first tap/click highlights the node or edge **without opening any panel**; the second tap/click opens the editor. Collapse returns to highlight-only mode while preserving the selection.
- Desktop uses a compact floating editor only after the second click. Mobile opens the editor **above** the existing, always-visible Orders/Resolve dock on the second tap; the editor does not create additional Orders/Resolve buttons. Only the editor's contents scroll. Tapping outside the editor dismisses it, as does its small close button; tapping another map item changes selection. The superseded full-screen node modal never opens over the new editor.
- A node editor prioritizes **investment percentage of policy surplus**, because this is the most frequent policy adjustment. Changes are applied as the input commits, with no Save button. A node without a saved policy shows default values in the editor (reserve 5, invest 50%) without an extra Create policy button or unsolicited automatic spending; editing/enabling creates the saved policy. Reserve, automatic transfers, policy copy/paste, pause, manual investment, and withdrawal remain reachable in secondary sections.
- An edge editor edits an outgoing manual attack or support amount. Friendly-to-friendly edges permit either direction, with independent orders stored for each direction, and can configure a persistent surplus-transfer policy on the chosen source node directly. The connection controls only the destination; investment percentage and defense reserve remain exclusively in the node policy editor. Enabling support preserves existing investment and reserve settings. Connections without an owned endpoint remain inspect-only.
- A tap on empty map space dismisses selection; dragging pans without selecting. Mobile directly supports one-finger panning and two-finger zoom without a Pan/Scroll switch. Fit, Focus, and zoom buttons remain available.
- Orders still execute only after Resolve round. UI display changes must never change order validation, forecast arithmetic, combat, AI, persistence, or game engine mechanics.

## Flow visualization

Planned attack and transfer flows recolor the **existing connection stroke**, rather than drawing a second coincident line. Direction arrowheads, flow amounts, manual-vs-policy dash styling and optional overlay filtering remain visible. When multiple flows share a connection, the stroke uses a mixed-flow color while directional arrows retain their order-specific colors. Node income/investment previews are independent of the flow filter.

## Rules compatibility

The interface must preserve the economy merged in PR #13: new-game soft energy capacity, projected overflow loss, and investment withdrawal with its fee and start-of-round spending semantics. Legacy autosaves keep the old rules version. Editing one node or connection must not delete other allocations or policies.

## Review checks

Validate keyboard focus on mobile after viewport resize, pointer/touch drag versus selection, two-tap edits, edge directions, access to the withdrawal allocator, and responsive placement of the inspector. Test Orders, Settings, Dashboard, and Messages after removing the permanent sidebar. Verify four viewport projects in Playwright and review screenshots before merge.
