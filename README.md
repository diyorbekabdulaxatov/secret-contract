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
4. On pushes to `main`, `dist/` is copied with rsync over SSH to an Oracle Cloud instance, where nginx serves it from `/var/www/silent-contract`, and the live page is checked.

### One-time Oracle Cloud setup

1. **Prepare the instance.** SSH in as the user CI will deploy with (`opc` on Oracle Linux, `ubuntu` on Ubuntu) and run:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/diyorbekabdulaxatov/secret-contract/main/deploy/oracle-setup.sh | bash
   ```

   It installs nginx and rsync, creates `/var/www/silent-contract` owned by that user, and opens port 80 in the instance firewall.
2. **Open port 80 in Oracle Cloud.** In the console, add an ingress rule for TCP port 80 from `0.0.0.0/0` to the security list (or network security group) of the instance's subnet.
3. **Create a deploy key** on your computer and authorize it on the instance:

   ```bash
   ssh-keygen -t ed25519 -N "" -C "github-actions-deploy" -f silent-contract-deploy
   ```

   Append `silent-contract-deploy.pub` to `~/.ssh/authorized_keys` on the instance.
4. **Add repository secrets** under **Settings → Secrets and variables → Actions**:

   | Secret | Value |
   |---|---|
   | `ORACLE_HOST` | The instance's public IP or domain |
   | `ORACLE_USER` | `opc` or `ubuntu` |
   | `ORACLE_SSH_KEY` | The full contents of the private key file `silent-contract-deploy` |
   | `ORACLE_KNOWN_HOSTS` | Recommended: output of `ssh-keyscan -H <host>` run from your computer |
   | `ORACLE_PORT` | Optional, if SSH is not on port 22 |

The next push to `main` deploys the game to `http://<ORACLE_HOST>/`.
