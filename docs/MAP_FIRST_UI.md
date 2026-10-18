# Map-first contextual orders

**Status:** UI-only implementation proposed in [PR #14](https://github.com/tino415/parallel-turngbased-enrergy-game/pull/14). This document records the agreed interaction model, not a production deployment announcement.

## Interaction decisions

- The tactical map occupies the available page width. The permanent sidebar is removed and the header is condensed to round status, Resolve, and an overflow menu for Orders, Settings, and New game.
- Nodes represent energy and persistent policies. Edges represent attacks and friendly support transfers.
- The first selection highlights a node or edge and shows a compact preview. A second selection of the same item, or the Edit button, expands its contextual editor.
- Desktop uses a floating inspector near the selected map item. Mobile uses a single bottom preview bar that expands into a scrollable drawer without hiding the map. While selected, this replaces the general bottom Orders/Resolve dock; the inspector itself contains these actions. The superseded full-screen node modal never opens over the inspector.
- A node editor prioritizes **investment percentage of policy surplus**, because this is the most frequent policy adjustment. Changes are applied as the input commits, with no Save button. A node without a saved policy shows default values in the editor (reserve 5, invest 50%) without an extra Create policy button or unsolicited automatic spending; editing/enabling creates the saved policy. Reserve, automatic transfers, policy copy/paste, pause, manual investment, and withdrawal remain reachable in secondary sections.
- An edge editor edits an outgoing manual attack or support amount. Friendly-to-friendly edges permit either direction, with independent orders stored for each direction, and can configure a persistent surplus-transfer policy on the chosen source node directly. The destination may be changed without overwriting the source's reserve or investment percentage. Connections without an owned endpoint remain inspect-only.
- A tap on empty map space dismisses selection; dragging pans without selecting. Mobile directly supports one-finger panning and two-finger zoom without a Pan/Scroll switch. Fit, Focus, and zoom buttons remain available.
- Orders still execute only after Resolve round. UI display changes must never change order validation, forecast arithmetic, combat, AI, persistence, or game engine mechanics.

## Rules compatibility

The interface must preserve the economy merged in PR #13: new-game soft energy capacity, projected overflow loss, and investment withdrawal with its fee and start-of-round spending semantics. Legacy autosaves keep the old rules version. Editing one node or connection must not delete other allocations or policies.

## Review checks

Validate keyboard focus on mobile after viewport resize, pointer/touch drag versus selection, two-tap edits, edge directions, access to the withdrawal allocator, and responsive placement of the inspector. Test Orders, Settings, Dashboard, and Messages after removing the permanent sidebar. Verify four viewport projects in Playwright and review screenshots before merge.
