# Silent Contract: notes for Claude

A 2D noir sniper game for Android phones (landscape) and desktop browsers, inspired by LONEWOLF. Vanilla JS + HTML5 canvas, no framework, no build step to play. Story and missions are in `SCENARIO.md`.

## Architecture

All modules attach to `window.LW` and load in this order from `game/index.html`:

1. `game/js/shared.js`: constants (`LW.CONST`), body hitbox geometry, ballistics, camera math, safe storage. Every other module uses these formulas; change them here only.
2. `game/js/data.js`: `LW.DATA` (weapons, gear, chapters, 13 missions incl. `range`, story panels).
3. `game/js/render.js`: `LW.Render.prepare(mission)` / `draw(ctx, state, vw, vh)`. Pure drawing from state.
4. `game/js/core.js`: `LW.Core` (loop, input, camera, ballistics, AI, alarms, win/fail, results). `LW.Core.debug.win()/fail()` for testing.
5. `game/js/ui.js`: menus, story panels, briefing, HUD, armory, saves (`localStorage` via `LW.store`), synthesized audio (`LW.Audio`), exports `LW.UI`.

`game/CONTRACT.md` is the binding interface between the modules (state fields, hooks, events, data shapes). Read it before changing any module, and update it when an interface changes.

## Rules

- **ES5 only** in `game/js/*.js`: `var`, `function`, IIFE with `'use strict'`. No `let`/`const`, arrow functions, template literals or classes. Android WebViews and the CI syntax check rely on this.
- **ASCII only** in `game/js/*.js`. Write non-ASCII characters as `\uXXXX` escapes. CI fails otherwise.
- `game/index.html` is a **page fragment**: no `<!doctype>`, `<html>`, `<head>` or `<body>`. It is also published as a claude.ai artifact, whose host adds the skeleton; `scripts/build.mjs` wraps it for static hosting.
- People must be drawn inside `LW.bodyGeom` (head circle at `y - 0.9h`, radius `0.085h`) so hits match what players see.
- Draw code must never throw; core catches render errors but keep `draw()` defensive.

## Commands

- Play locally: `python devserver.py 8771`, then open http://localhost:8771 (no-cache server for `game/`).
- `npm run check`: syntax, ASCII and mission-data validation.
- `npm run build`: builds `dist/` with a full `index.html`.
- `npm test`: headless Chromium smoke test (needs `npx playwright install chromium` once); plays every mission to a win and fails on any page or console error.

## CI/CD

`.github/workflows/ci.yml` runs check, build and smoke test on every push and PR. Pushes to `main` deploy `dist/` with rsync over SSH to an Oracle Cloud Ubuntu 24.04 instance (nginx, `/var/www/silent-contract`, public IP 140.238.231.41), then check the live page; if that fails, a "Diagnose the server" step prints nginx, firewall and port status. Secrets: `ORACLE_HOST`, `ORACLE_USER`, `ORACLE_SSH_KEY`, optional `ORACLE_KNOWN_HOSTS`, `ORACLE_PORT`. Server setup: `deploy/oracle-setup.sh`.

## Testing tips

- In a browser, `LW.Core.start(LW.DATA.missions[i], LW.UI.buildLoadout(), hooks, opts)` starts any mission directly; `LW.Core.input` exposes `pan`, `setScoped`, `zoomStep`, `fire`, `reload`, `setBreath`.
- If the page is in a hidden or background tab, `requestAnimationFrame` stops; shim it with `setTimeout` for automated runs.
