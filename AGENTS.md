# Parallel Energy Game

A static browser game: `index.html` plus plain ES modules in `src/`, no bundler and
no runtime dependency. `src/engine.js` holds the rules and round resolution,
`src/game.js` and `src/ux.js` the interface. Node is used only for the
development commands.

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
npm run build        # copies index.html, _headers and src/ into dist/
npm run format       # apply prettier
npm run simulate     # AI strategy simulations, see scripts/
```

To play it locally:

```sh
npm run build
python3 -m http.server 4173 --directory dist --bind 0.0.0.0
```

and open http://127.0.0.1:4173. `test:ui` starts that server itself, or reuses
one already listening on 4173.

The Playwright suite runs Chromium only. Tests named "simulated keyboard" shrink
the viewport to stand in for the on-screen keyboard; real Android Chrome stays
a manual check, not a CI gate. A known defect is pinned as `test.fail()` with
its Todoist task in the reason; remove the mark in the change that fixes it.

## CI and deploy

`.github/workflows/` runs the same `npm run check` and `npm run test:ui`, plus
the balance and economy simulations. The site deploys to Cloudflare from `dist/`
through `wrangler.toml`.
