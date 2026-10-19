# Handoff: continue Silent Contract on another machine

## Setup on the laptop

```bash
git clone https://github.com/diyorbekabdulaxatov/secret-contract.git
```
```bash
cd secret-contract
```
```bash
claude
```

Then paste the prompt below into Claude Code.

## Prompt

```
I'm continuing work on Silent Contract, a 2D noir sniper game (vanilla JS + canvas) inspired by LONEWOLF, built for Android phones in landscape and desktop browsers. Read CLAUDE.md, game/CONTRACT.md and SCENARIO.md first; CLAUDE.md has the architecture, rules (ES5 only, ASCII only, index.html is a fragment) and commands.

Current state (as of 2026-10-19):
- The game is complete and playable: 12 story missions + a shooting range, armory, story panels, synthesized audio, touch and keyboard controls.
- Recent work: LONEWOLF-style aiming (the crosshair follows the finger, tap the city to zoom there), volume sliders and a mute button in Settings, the pause menu and the HUD, a big graphics polish (comic-noir people, wet streets, neon, a real optic scope, bullet tracers, hit markers), scope magnification raised to OPTIC 5 so targets are readable on phones.
- CI (GitHub Actions) passes check, build and a headless smoke test of all missions. Pushes to main deploy over SSH/rsync to my Oracle Cloud Ubuntu 24.04 instance at 140.238.231.41 (nginx serving /var/www/silent-contract).
- Deploy status: rsync works and nginx returns 200 locally on the server. Port 80 was opened in the Oracle security list and with iptables (`sudo iptables -I INPUT 6 -p tcp --dport 80 -m state --state NEW -j ACCEPT`). The CI "Check the live site" step was still failing when I left; my office network blocks the server, so it was never confirmed from outside.

Open tasks, in order:
1. Confirm the deploy: curl -I http://140.238.231.41/ from this laptop. If it fails, help me check `sudo iptables -L INPUT -n --line-numbers` on the server (the port 80 ACCEPT must come before the REJECT rule), save with `sudo netfilter-persistent save`, then re-run the latest GitHub Actions run until the deploy job is green.
2. Play-test the later missions (m6 to m12) by hand and tune difficulty: wind, sway, guard alert timing, rewards. The shooting range pays a lot for perfect headshot runs; consider capping it.
3. Check performance on a real Android phone, especially busy rain scenes (render.js film grain and neon shadowBlur are the first things to turn down).
4. Optional: package it as an installable Android app (.apk) with Capacitor, and add an APK build job to CI.
5. Optional: add HTTPS with a domain (nginx + certbot) and open port 443 in the Oracle security list and iptables.

Before pushing, run npm run check, npm run build and npm test locally, and test the game in a browser with python devserver.py 8771.
```
