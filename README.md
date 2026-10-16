# Silent Contract

A 2D noir sniper game for phones and browsers, inspired by LONEWOLF. Rain-soaked Port Varenne, a silent marksman named Elias Crane, a handler with her own agenda, and twelve contracts that lead to the man at the top.

One shot. One truth.

## Play

- **Phone (landscape):** drag to move the crosshair, tap the city to zoom in there, hold **STEADY**, then **FIRE**.
- **Desktop:** drag with the mouse, `Space` fire, `E` scope, `Shift` steady, `R` reload, mouse wheel zoom, `Esc` pause.

Bullets drop over distance and drift with the wind. Moving targets need a lead. Guards who spot a body or hear a shot raise the alarm.

## Run locally

No build step is needed to play. Serve the `game/` folder with caching disabled:

```bash
python devserver.py 8771
```

Then open http://localhost:8771.

## Project layout

| Path | What it is |
|---|---|
| `game/index.html` | Page shell, styles and screens (a fragment; `npm run build` wraps it into a full page) |
| `game/js/shared.js` | Constants, body geometry, ballistics and camera math shared by every module |
| `game/js/data.js` | Weapons, gear, chapters, missions and story panels |
| `game/js/core.js` | Game loop, input, camera, ballistics, AI, rules and results |
| `game/js/render.js` | Canvas renderer: city, people, effects and scope |
| `game/js/ui.js` | Menus, story panels, briefing, HUD, armory, saves and synthesized audio |
| `game/CONTRACT.md` | The interface contract between the modules |
| `SCENARIO.md` | Story, characters and mission design |

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs on every push and pull request:

1. `npm run check`: every script parses, is ASCII-only, and the mission data follows the contract.
2. `npm run build`: produces `dist/` with a complete `index.html`.
3. `npm test`: opens `dist/` in headless Chromium at phone-landscape size and plays every mission through to a win. Any page or console error fails the run. Screenshots are uploaded as the `screenshots` artifact.
4. On pushes to `main`, `dist/` is deployed to GitHub Pages.

To turn on deployment, open the repository's **Settings → Pages** and set **Source** to **GitHub Actions** (one time).
