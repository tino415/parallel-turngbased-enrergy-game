# UI design and acceptance criteria

This is a **testing baseline**, not a claim that the current UI passes all requirements. Review failures and screenshots before changing the design.

## Mobile-first interaction contract
- At 360–430px widths, map, round status, and primary action are immediately accessible without excessive scrolling.
- The active map consumes most of the usable viewport; controls may not obstruct the selected node.
- Selecting a friendly node opens a dismissible, scrollable details dialog; desktop shows the editor in its sidebar.
- Normal page scrolling does not unexpectedly zoom the graph. Explicit Pan mode allows map movement with one finger; Scroll mode returns control to the browser.
- Zoom in, zoom out and Fit actions are accessible and reversible.
- Dashboard and Messages are independently navigable and should not discard orders or round state.
- A refresh restores the saved match in the same browser profile.
- Forms and menus do not cause horizontal page overflow.

## Review matrix
- 360 × 780: constrained Android-sized viewport.
- Pixel 7: Android Chrome touch emulation.
- iPad Mini: tablet layout boundary.
- 1440 × 900: desktop.

## Review process
1. Run `npm run check` and `npm run test:ui` on the branch.
2. Inspect screenshots in `test-results/` and the Playwright HTML report.
3. Fix failed interactions and visual defects; do not simply weaken assertions.
4. Confirm behavior on an actual Android Chrome device for scrolling and map gestures before approving touch changes.
5. Review the branch preview before merging to main.

Visual screenshots are initially **artifacts**, not golden snapshots. Add screenshot assertions once a stable approved design baseline exists.
