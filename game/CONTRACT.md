# SILENT CONTRACT — build contract

A 2D noir sniper game for phones (landscape) and desktop browsers, inspired by mobile sniper games like LONEWOLF.
Plain HTML5 canvas + vanilla JS, no libraries, no build step. Every module attaches to the global `window.LW`.

## Files and owners

| File | Owner | Purpose |
|---|---|---|
| `game/js/shared.js` | lead (done, read-only) | constants, body geometry, ballistics, camera math, safe storage |
| `SCENARIO.md` (workspace root) | writer | the full story and mission design |
| `game/js/data.js` | writer | `LW.DATA`: weapons, gear, chapters, missions, story panels |
| `game/js/render.js` | renderer | `LW.Render`: draws the world, people, effects, scope |
| `game/js/core.js` | core | `LW.Core`: loop, input, camera, ballistics, AI, rules, results |
| `game/index.html` + `game/js/ui.js` | ui | page shell, CSS, menus, story panels, briefing, HUD, armory, saves, `LW.Audio` |

Script order in index.html: `js/shared.js`, `js/data.js`, `js/render.js`, `js/core.js`, `js/ui.js`. ui.js boots the game.
Only edit the files you own. Read `game/js/shared.js` before writing code: use its helpers instead of re-deriving formulas.
No Node.js on this machine; write careful ES5/ES2017 that runs in Chrome/Android WebView without transpiling. Use `'use strict'` inside an IIFE.

## Fixed story frame (writer expands; everyone uses these names)

- Game title: **SILENT CONTRACT**. Tagline: "One shot. One truth."
- City: **Port Varenne**, a rain-soaked harbor city run by the **Halvard Syndicate**.
- Player: **Elias Crane**, a former army marksman who never speaks. Codename "CRANE".
- **Mara Voss**: Crane's handler. She feeds him contracts by phone and earpiece. Her real loyalty is the big twist.
- **Augustin Halvard**, "The Banker": head of the syndicate. Final target.
- 3 chapters × 4 missions (`m1`…`m12`) plus a repeatable shooting range (`range`, chapter 0).

## Coordinates and scale

- World units: x from 0 to `mission.world.width` (2400–3600), y from 0 (top) to 1000 (bottom). y grows downward.
- The world is a flat panorama already in perspective. Things farther away are drawn smaller: a person at `dist` metres is `3600 / dist` world units tall (`LW.personHeight`). A building at 400 m should have small windows; one at 120 m large ones.
- An entity's `(x, y)` is the point between its feet. Its hitbox is `LW.bodyGeom(e)` / `LW.hitTest(e, px, py)`. The renderer MUST draw people so they match that geometry: head circle centre at `y - 0.9h` radius `0.085h`, torso `±0.15h` wide from `y - 0.8h` to `y - 0.45h`, legs below.
- `window: true` entities stand inside a lit window. The sill is at `y - 0.45h`: legs are hidden and cannot be hit. Renderer draws a lit window opening from about `y - 1.08h` to `y - 0.45h`, `±0.32h` wide, behind the person.
- Movement speed in data is metres per second (walk ≈ 1.3, run ≈ 3.5). Core converts: world units/s = `speed * 2000 / dist`.
- Ballistics (core uses `LW.impactAt`): bullet drop `6.5e-5 · dist² · dropMul` world units downward; wind drift `0.0034 · wind · dist` (wind m/s, positive blows to the right); flight time `dist / velocity` seconds. Targets move during flight, so moving targets need lead.
- Camera: `view = { x, y, zoom }` is the world point at the screen centre. Pixels per world unit = `(viewportHeight / 1000) * zoom` (`LW.cam`). Unscoped zoom is 1 (the full 1000-unit height fits the screen). Scoped zoom is between 2 and `loadout.zoom`. The crosshair is always at the screen centre, so the aim point equals `view.x, view.y`.
- Scope: when scoped, only a circle of radius `LW.cam.scopeRadius(vw, vh)` around the screen centre shows the world; the rest is black.

## LW.DATA (data.js)

```js
LW.DATA = {
  title: 'SILENT CONTRACT',
  intro: [Panel, ...],          // shown when a new campaign starts
  ending: [Panel, ...],         // shown after m12
  chapters: [{ id: 1, title: 'Rain Ledger', subtitle: '...' }, ...],   // ids 1..3 (titles are the writer's)
  weapons: [Weapon, ...],       // first weapon has price 0 and is owned at start
  gear: [Gear, ...],            // exactly ids: scope, stock, mag, suppressor, computer
  missions: [Mission, ...]      // 'range' first, then m1..m12 in play order
};
```

**Panel** (story comic panel, rendered by ui):
```js
{ bg: 'rain-street'|'bar'|'office'|'rooftop'|'car'|'phone'|'harbor'|'warehouse'|'apartment'|'church'|'penthouse'|'black',
  figure: 'crane'|'mara'|'halvard'|'thug'|'detective'|'none',
  speaker: 'MARA' | '' ,       // '' = narration caption
  text: 'One or two short sentences.' }
```

**Weapon**:
```js
{ id: 'kestrel', name: 'Kestrel .308', desc: '...', price: 0,
  damage: 70,          // body-shot damage; entities have hp 100 unless set; headshots always kill
  velocity: 780,       // m/s
  dropMul: 1.0,        // 1 = baseline drop, lower = flatter
  swayMul: 1.0,        // scope sway multiplier
  magazine: 5, reloadTime: 2.2, boltTime: 1.0,   // seconds
  suppressed: false }
```
Make 4 rifles with a clear progression (last one ≈ damage 200, velocity 950, dropMul 0.6).

**Gear** (`levels[0]` is the free base level; `value` is what the loadout uses):
```js
{ id: 'scope',      name, desc, levels: [{ price: 0, value: 3, label: '3×' }, { price: 400, value: 4.5, label: '4.5×' }, ...] }  // zoom, max 8
{ id: 'stock',      ... value = sway multiplier, 1 → 0.5 }
{ id: 'mag',        ... value = extra rounds, 0 → 2 }
{ id: 'suppressor', ... levels: [{price:0, value:false, label:'None'}, {price:..., value:true, label:'Fitted'}] }
{ id: 'computer',   ... same boolean shape; shows the predicted impact dot in the scope }
```

**Mission**:
```js
{ id: 'm1', chapter: 1, title: 'Wet Paint', location: 'Corso Street, 23:40',
  briefing: 'Dossier text, 2–4 sentences.',
  objectives: ['Eliminate Pietro Sanna', 'Do not harm civilians'],   // display text
  intel: [{ name: 'Pietro Sanna', text: 'Grey coat, red tie. Smokes by the bar window.' }],
  storyBefore: [Panel...], storyAfter: [Panel...],
  reward: 400,
  time: 'night'|'rain'|'dusk'|'dawn'|'fog',
  world: { width: 2800 },
  start: { x: 1400, y: 500 },          // initial view centre
  wind: { base: 0, gust: 0 },          // m/s; core varies wind = base + gust * slow noise
  timeLimit: 0,                        // seconds, 0 = none
  rules: { noAlarm: false, noCivilianKills: true, markTargets: true },
     // noAlarm: the alarm fails the mission. noCivilianKills: killing a civilian fails it (else −150 money).
     // markTargets: unscoped view shows a chevron over living targets (turn off for "identify the target" missions).
  failText: { escape: 'Sanna escaped.', attacker: 'They reached Mara.', alarm: 'The alarm was raised.', time: 'Time ran out.' },
  messages: [{ t: 2, text: 'MARA: ...' }],   // earpiece lines shown as subtitles at mission time t
  structures: [Structure...],
  entities: [Entity...],
  spawns: [{ t: 12, entity: Entity }]  // entities that appear later (defend waves, late arrivals)
}
```

**Structure** (all in world units; `dist` in metres; drawn farthest first):
```js
{ type: 'building', x, y, w, h, dist, style: 'brick'|'concrete'|'glass'|'deco', lights: 0.4, sign: 'HOTEL', roof: 'flat'|'water-tower'|'antenna'|'neon' }  // x,y = top-left
{ type: 'wall', x, y, w, h, dist }                 // parapet, fence or plain slab
{ type: 'ground', y, dist, kind: 'street'|'dock'|'rooftop'|'park' }   // full-width band from y to 1000
{ type: 'water', y, dist }                         // full-width band from y to 1000
{ type: 'car', x, y, dist, color: '#3a4a5a', kind: 'sedan'|'van'|'truck' }   // x = centre, y = wheel bottom
{ type: 'lamp', x, y, dist }                       // street lamp, y = base
{ type: 'crane', x, y, dist }                      // harbor crane, y = base
{ type: 'billboard', x, y, w, h, dist, text }
{ type: 'container', x, y, w, h, dist, color }
{ type: 'boat', x, y, w, dist }                    // y = waterline
```

**Entity**:
```js
{ id: 'sanna', role: 'target'|'guard'|'civilian'|'attacker'|'ally', name: 'Pietro Sanna',
  x, y, dist,
  look: { coat: '#5b5f66', skin: '#c8a27c', hair: '#2a2420', hat: 'fedora'|'cap'|'hood'|'none',
          tie: '#a3242b' | null, build: 'normal'|'heavy'|'slim', item: 'none'|'briefcase'|'rifle'|'phone'|'umbrella'|'cigarette',
          dummy: false },        // dummy: true = paper range target
  window: false,
  hp: 100,                       // optional, default 100 (armoured guards 150)
  path: [{ x, y, wait: 2 }],     // optional waypoints; walks them in order
  speed: 1.3, loop: true,        // loop the path, otherwise stop at the end
  escape: false,                 // target: reaching the last waypoint = mission failed (failText.escape)
  fleePath: [{ x, y }],          // target: where it runs once the alarm sounds (default: nearest world edge)
  facing: 1 }                    // 1 right, -1 left
```
Roles: `target` must die to win. `attacker` must die to win; if it reaches its last waypoint the mission fails (failText.attacker). `ally` must survive (if the player kills one, fail). `guard` raises the alarm. `civilian` panics and runs.
Placement rules for the writer: people stand on something (a roof top edge, a street band, a balcony wall, or a window); an entity's `dist` equals the dist of what it stands on; never put a person behind a nearer structure; keep x inside 40…width-40.

## LW.Core (core.js)

```js
LW.Core.start(mission, loadout, hooks, options)   // options: { sensitivity: 1 }
LW.Core.stop()          // ends loop, removes listeners
LW.Core.pause(); LW.Core.resume();
LW.Core.input = { pan(dxPx, dyPx), setScoped(bool), toggleScope(), zoomStep(+1|-1), fire(), reload(), setBreath(bool) };
LW.Core.state           // live state, read by render and ui
```
hooks: `{ onFrame(state), onEvent(evt), onEnd(result), onPause() }`.

**loadout** (built by ui from the save):
```js
{ weaponId, name, damage, velocity, dropMul, swayMul, zoom, magazine, reloadTime, boltTime, suppressed, computer }
```

Core owns the canvas `#game-canvas`: sizes it to its CSS box × devicePixelRatio (on resize too), runs requestAnimationFrame (dt clamped to 0.05 s), updates, then calls `LW.Render.draw(ctx, state, vw, vh)` with ctx transformed to CSS pixels, then `hooks.onFrame(state)`.
Core binds: pointer drag on the canvas → pan (first pointer only; pan sensitivity / scale so the world follows the finger); mouse wheel → zoomStep; right mouse → toggleScope; keyboard: WASD/arrows pan, Space fire, E toggle scope, Shift hold breath, R reload, +/- zoom, Esc → hooks.onPause(). UI buttons call `LW.Core.input`.

**state**:
```js
{ mission, loadout, status: 'playing'|'paused'|'ended', t, timeScale,
  view: { x, y, zoom }, scoped, zoomTarget,
  aim: { x, y },                 // = view centre while scoped (sway already applied to view)
  sway: { x, y }, breath: 0..1, holding: bool, shaky: bool,
  wind,                          // current m/s
  range,                         // metres to whatever is under the crosshair, or null
  predicted: { x, y } | null,    // loadout.computer only: impact point at `range`
  ammo, reloading: 0..1 | 0,     // reload progress, 0 when not reloading
  bolt: 0..1,                    // cycling progress after a shot, 0 when ready
  alarm: 0..1,                   // highest alert progress among guards; 1 = alarm raised
  alarmRaised: bool,
  timeLeft: seconds | null,
  targetsLeft,                   // living targets + attackers, including pending spawns
  entities: [ { ...definition, alive, hp, state: 'idle'|'walk'|'alert'|'panic'|'flee', facing, walkPhase, alertT, dead: null | { t, head, dir } } ],
  bullets: [ { fromT, hitT, x, y, dist } ],      // in flight, x/y = impact world point
  effects: [ { type: 'muzzle'|'impact'|'blood'|'spark', x, y, dist, t0 } ],
  killcam: null | { id, t0 },    // final kill: timeScale 0.25 for ~1.4 real seconds
  stats: { shots, hits, headshots, kills, civilians } }
```
Sway (scoped): smooth two-frequency wander, amplitude `3.0 * loadout.swayMul` world units; holding breath cuts it to 15% and drains `breath` over 3.5 s (refills over 5 s); running out sets `shaky` (sway ×1.6) for 2 s. Unscoped shots get ±6 units random spread.
Fire: needs ammo, not reloading, bolt ready. Bullet impact at each entity's dist is `LW.impactAt(aim.x, aim.y, e.dist, wind, loadout)` evaluated against the entity's position at `hitT`; nearest hit wins. Headshot kills; body shot subtracts `damage`. Empty magazine auto-reloads.
Alerts: an unsuppressed shot alerts living people within 600 world units of the impact (suppressed: 180). Any miss landing within 40 units of a person alerts them. A living guard within 140 units of a corpse (dist within 60 m) becomes alert. Alerted guards fill their own alert meter over 4 s; at 1 the alarm is raised (fail if `rules.noAlarm`), and all targets flee along `fleePath`. A fleeing target that reaches the end of its flee path or the world edge escapes → fail. Civilians who are alerted panic and run off the nearest edge.
Win when no living targets/attackers remain and all spawns are done. Fail reasons from `failText`.
Events (`hooks.onEvent`): `{type: 'shot'|'hit'|'headshot'|'kill'|'civilian'|'miss'|'alert'|'alarm'|'reloadStart'|'reloadEnd'|'spawn'|'message', text?, id?}`. `message` fires for `mission.messages` at their time.
Sounds: core calls `LW.Audio && LW.Audio.play(name)` for shot, shotSuppressed, bolt, reload, hitBody, hitHead, impact, alert, alarm, scopeIn, scopeOut, breath.
**result** for onEnd: `{ win, reason, stats, accuracy, stars (0 on fail, else 1 + (accuracy >= 0.75) + (every target/attacker kill was a headshot)), reward (on win: mission.reward + 50 per headshot + 100 if no misses − 150 per civilian), bonuses: [{ label, amount }] }`.

## LW.Render (render.js)

```js
LW.Render.prepare(mission)            // called by core at start: seed RNG, cache per-structure detail
LW.Render.draw(ctx, state, vw, vh)    // draw one frame in CSS pixels
```
Draw order: sky by `mission.time` (night, rain, dusk, dawn, fog), moon or haze, a procedural distant skyline (decor, beyond 600 m), then structures and entities sorted by dist descending (structures before entities at equal dist; a window entity draws right after a lit window opening), then effects, then weather overlay (rain streaks, fog), then the scope mask and reticle when scoped, or a small crosshair when unscoped.
Use a seeded RNG per structure so windows and details are stable between frames. Cull everything outside the visible rect. Keep it fast on phones (scoped view at 8× zoom should still be cheap).
People: silhouettes in noir style lit by street light; colours from `look`; walking cycle from `walkPhase`; facing; hat; tie; item; `dummy` draws a paper target on a stand. `state: 'alert'` shows a small amber "!" above the head; `panic`/`flee` run with arms up. Dead people fall over ~0.6 s from `dead.t` (window people slump below the sill). When unscoped and `mission.rules.markTargets !== false`, draw an amber chevron above each living target and attacker.
Scope: zoomed world inside the circle, black outside, faint lens vignette and edge ring; reticle with thin lines, a centre dot and hash marks every `LW.CONST.MARK` world units along both axes (longer every 4th); if `state.predicted` draw a small hollow amber ring there. Muzzle flash: brief screen-wide warm flash. Effects: impact dust puff on misses, dark-red mist on hits, killcam: a fading tracer from the bottom centre of the screen to the hit point.

## UI (index.html + ui.js)

index.html is a page fragment: NO `<!doctype>`, `<html>`, `<head>` or `<body>` tags (the host wraps it). It starts with `<title>Silent Contract</title>`, Google Fonts `<link>`, one `<style>`, the markup, then the five `<script src>` tags. One deliberate dark noir look (single theme): set `color-scheme: dark` and an explicit body background. Use `height: 100%` on html/body, not 100vh. No `alert/confirm/prompt`.
Screens: title, chapter + mission select (locks, stars), story panels (comic panels drawn procedurally per `bg` and `figure`, tap to advance, Skip), briefing dossier (intel, objectives, wind, reward, Accept), HUD during play, pause, results (stars, stats, money breakdown, Retry/Next), armory (buy/equip rifles, upgrade gear), settings (sound, music, sensitivity), portrait "rotate your phone" hint (non-blocking).
HUD (updated in `onFrame`): ammo pips, reload/bolt progress, wind arrow + m/s, range in metres, timer, alarm meter, breath meter, targets left, earpiece subtitles from `message` events, toasts for headshot/kill/alert. Touch controls: big FIRE button (right), SCOPE toggle, press-and-hold HOLD BREATH, RELOAD, zoom +/−, pause. Buttons must use pointer events and not steal canvas drags.
Save via `LW.store` under key `silentContract.save.v1`: `{ money, weapons: [ids], equipped, gear: { scope: 0, ... }, missions: { m1: { stars } }, settings: { sound: true, music: true, sensitivity: 1 }, seenIntro }`. Missions unlock in order.
`LW.Audio`: WebAudio synthesized sounds (no files) for the names listed in Core plus `click`, `win`, `fail`, `cash`, `type`; `LW.Audio.ambience(time)` loops rain/city hum, `LW.Audio.stopAmbience()`; a quiet procedural noir music bed on menus. Start the AudioContext on the first user gesture.

## Changes since the first version

- **Scope zoom:** `LW.CONST.OPTIC = 5`. Scoped `view.zoom` = scope magnification x OPTIC (a 3x scope shows the world at zoom 15, max 8x = 40). The HUD shows `view.zoom / OPTIC`. Zoom steps are 0.5 x OPTIC, minimum 1.5 x OPTIC.
- **Ballistics:** `DROP_K` is 5.0e-5. Core sway amplitude is 2.2 world units x `swayMul`.
- **Core options:** `LW.Core.start(mission, loadout, hooks, { sensitivity, invertDrag, tapToScope })` and `LW.Core.setOptions(sameShape)` for live changes from the pause menu. By default the crosshair follows the finger (LONEWOLF style); `invertDrag: true` drags the world. `tapToScope` (default on): a quick tap on the city while unscoped scopes in on that spot. The newest finger on the canvas always takes over aiming.
- **State:** `state.lastShot = { t, x, y, dist, hit: 'head'|'body'|null }` after each bullet lands; render draws a tracer for `state.bullets` and a hit/miss ring at `lastShot`.
- **Page gestures:** while a mission runs, core sets `touch-action: none` and `overscroll-behavior: none` on html/body and cancels canvas touchmove, so drags never scroll the page.
- **Audio (ui.js):** `LW.Audio.setVolumes(sfx, music)`, `setMuted`, `isMuted`, `getState()`. Saves gain `sfxVolume`, `musicVolume`, `muted`, `aimInvert`, `tapToScope`.
- **Building windows:** bay size is 5000/dist by 6000/dist world units (about 2.5 m by 3 m).
