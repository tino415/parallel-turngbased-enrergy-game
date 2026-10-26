# Parallel Energy Game

A static browser game: `index.html` plus plain scripts in `src/`, loaded with `defer`
in one global scope, no bundler and no runtime dependency. `src/engine.js` holds
the rules and round resolution. `server/` holds the Cloudflare Worker and the match
functions behind online matches (see `docs/ARCHITECTURE.md`). `src/store.js` owns the match (state, orders,
policies, history, map, conquest defaults, replay record) and the interface state in its `ui` slice, behind
commands, selectors and a subscription; it never touches the DOM. `src/game.js`,
`src/ux.js`, `src/tactical-ui.js` and `src/replay.js` are the interface: they change state
only through store commands and read the `state`, `orders`, `selected`, ... globals,
which game.js mirrors from the store and nothing else assigns. Ownership, the
command contract and the render subscriptions are in `docs/ARCHITECTURE.md`. Node is used
only for the development commands.

## Where commands run

The toolchain lives in the `app` service of `compose.yaml`, built from
`Dockerfile.dev` (the Playwright image: Node 24, the version CI uses, Chromium,
python3). `.devcontainer/devcontainer.json` attaches to that same service, so
VS Code, JetBrains and Codespaces open the repository inside it. Nothing is
installed on the host.

With the devcontainer CLI:

```sh
devcontainer up --workspace-folder .                 # builds the image, runs npm ci on first create
devcontainer exec --workspace-folder . <command>
```

Without it, plain Compose (`docker compose` works the same way):

```sh
podman compose up -d --build
podman compose exec app npm ci                       # node_modules lives in a volume, built for the image
podman compose exec app <command>
```

Run commands through the tool that started the stack. The devcontainer CLI
derives a different Compose project name from the directory than `podman compose`
does, so `podman compose exec` does not find a stack `devcontainer up` started.

The `Dockerfile.dev` base image tag must equal the `@playwright/test` version in
`package-lock.json`. Bump both together, then rebuild: `devcontainer up
--workspace-folder . --remove-existing-container`, or `podman compose up -d
--build`.

## Build, run, test

```sh
npm run check        # prettier check, syntax checks, unit tests
npm test             # unit tests only (node --test tests/*.test.mjs)
npm run test:ui      # Playwright suite in tests/e2e, four viewports
npm run build        # stamps version, commit and date into index.html, copies it, _headers, the PWA files, icons/ and src/ into dist/
npm run icons        # renders the PNG icons from icons/icon.svg
npm run format       # apply prettier
npm run format:check:md  # prettier check of the Markdown only
npm run simulate     # AI strategy simulations, see scripts/
```

`test:ui` runs for minutes. An agent starts it in the background with a deadline,
`mkdir -p reports && timeout 900 npm run test:ui > reports/test-ui.log 2>&1`, waits for the
completion notification and reads the log's `tail`. Never a foreground `sleep`,
and never `until grep … <task>.output; do sleep …; done`.

To play it locally:

```sh
npm run build
python3 -m http.server 4173 --directory dist --bind 0.0.0.0
```

and open http://127.0.0.1:4173. That serves the single-player game only. `test:ui` starts
`wrangler dev` on 4173, which serves `dist/` and the online API, or reuses one already
listening there; run `npx wrangler dev --ip 0.0.0.0 --port 4173` to play online locally.

`compose.yaml` publishes no host port, so stacks from several worktrees run side
by side. An editor attached through the devcontainer forwards 4173 to the host.
With plain Compose, publish it for one run:

```sh
podman compose run --rm -p 127.0.0.1:4173:4173 app \
  sh -c 'npm run build && python3 -m http.server 4173 --directory dist --bind 0.0.0.0'
```

The Playwright suite runs Chromium only. Tests named "simulated keyboard" shrink
the viewport to stand in for the on-screen keyboard; real Android Chrome stays
a manual check, not a CI gate. A known defect is pinned as `test.fail()` with
its outline card in the reason; remove the mark in the change that fixes it.

## Installable app

The game is a PWA: `manifest.webmanifest`, the icons in `icons/` and the
service worker `sw.js`, registered by `src/service-worker-registration.js`.

- `sw.js` answers every same-origin GET from the network first and falls back
  to its cache when offline or after four seconds without an answer, so a deploy
  reaches an installed app on its next online launch and no cache version needs
  bumping. A new file the page loads goes into its `APP_SHELL` list;
  `tests/app-shell.test.mjs` fails until it does.
- The icons are rendered from `icons/icon.svg` by `npm run icons`, which needs
  Chromium, so run it in the dev container and commit the PNGs. Keep the artwork
  inside the central 80% circle: the maskable icons are the SVG full-bleed.
- Playwright blocks service workers in every spec except `tests/e2e/pwa.spec.mjs`,
  so they never answer a request another spec expects from the server.

## CI and deploy

`.github/workflows/` runs the same `npm run check` and `npm run test:ui`, plus
the balance and economy simulations. The site deploys to Cloudflare from `dist/`
through `wrangler.toml`.

`npm run format:check:md` checks the Markdown alone, and the Markdown workflow
runs it on every PR. A PR that changes only `.md` files skips `browser-tests`:
the job shows as skipped, which a required check accepts as passing.

A PR merges only on top of the current main, with green CI on that head. A PR
behind main is rebased first and its CI waited for again.

An agent waits for a PR's CI with one Monitor,
`timeout 1800 gh pr checks <number> --watch --interval 300`, and reads the result
when it ends. Never `until gh pr checks …` in a loop.
