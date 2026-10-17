# Parallel turn-based energy game

A small, experimental graph-based strategy game. **The game's final name is undecided.**

[Play locally](index.html) by opening `index.html` in a browser. No build tools or dependencies required.

## Current prototype rules

- Two players (human blue, basic AI red), 14 nodes, 20 simultaneous rounds.
- Every node stores **active** and **invested** energy.
- Invested energy earns 10% per round, paid as active energy; principal is locked.
- Active energy decays 10% per round; natural +1 active energy appears per node per round.
- Allocate active energy between one investment allocation and any number of adjacent transfers or attacks in a single round; unallocated energy stays for defense. All allocations from a node must fit within its starting active-energy balance.
- Attacks from the same player against the same target are grouped. Attack groups are randomized within each target.
- Combat uses ±20% independent random effective-strength modifiers; casualties are based on effective strengths.
- A changed final owner triggers random destruction of 25–75% of invested energy.
- Most nodes at the end of round 20 wins.

## Status and limitations

This is a gameplay experiment, not finalized balancing. The AI is deliberately simple. Persistent automation policies are not implemented yet. There is no save game, multiplayer, seeded replay, or independent engine test suite yet. The rules can change based on playtests.

## Hosting

Static site: deploy repository root with no build command using Cloudflare Pages.
