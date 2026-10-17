# Parallel turn-based energy game

A small, experimental graph-based strategy game. **The game's final name is undecided.**

[Play locally](index.html) by opening `index.html` in a browser. No build tools or dependencies required.

## Current prototype rules

- Two players (human blue, basic AI red), 14 nodes, 20 simultaneous rounds.
- Every node stores **active** and **invested** energy.
- Invested energy earns 10% per round, paid as active energy; principal is locked.
- Active energy decays 10% per round; natural +1 active energy appears per node per round.
- Transfer and attack one edge per round. One order per node in this first UI.
- Attacks from the same player against the same target are grouped. Attack groups are randomized within each target.
- Combat uses ±20% independent random effective-strength modifiers; casualties are based on effective strengths.
- A changed final owner triggers random destruction of 25–75% of invested energy.
- Most nodes at the end of round 20 wins.

## Status and limitations

This is a gameplay experiment, not finalized balancing. The AI is deliberately simple. There is no save game, multiplayer, seeded replay, or independent engine test suite yet. The rules can change based on playtests.

## Hosting

Static site: deploy repository root with no build command using Cloudflare Pages.
