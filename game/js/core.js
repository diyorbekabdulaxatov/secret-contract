// Silent Contract: core engine. Game loop, input, camera, ballistics, AI, rules and results.
// Depends on shared.js (LW.impactAt, LW.hitTest, LW.bodyGeom, LW.flightTime, LW.cam, LW.clamp).
// Optional: LW.Render (draw), LW.Audio (sounds). Runs without either.
window.LW = window.LW || {};
(function (LW) {
  'use strict';

  var Core = {};
  LW.Core = Core;
  Core.state = null;

  // ---------------------------------------------------------------- tuning
  var RUN_SPEED = 3.5;        // m/s for panic / flee
  var ALERT_FILL = 4;         // seconds for an alerted guard to raise the alarm
  var CORPSE_R = 140;         // world units
  var CORPSE_DIST = 60;       // metres
  var NOISE_R = 600;          // world units around the impact (unsuppressed)
  var NOISE_R_SUP = 180;      // suppressed
  var NEAR_MISS = 40;         // world units
  var SPREAD = 6;             // unscoped random spread, world units
  var KILLCAM_REAL = 1.4;     // real seconds of slow motion before the win ends the mission
  var KILLCAM_SCALE = 0.25;
  var FAIL_DELAY = 0.8;       // real seconds between a fail and onEnd
  var WIN_DELAY = 0.4;        // win without killcam (debug, edge cases)
  var EFFECT_LIFE = 2;        // seconds
  var KEY_PAN = 600;          // CSS px per second
  var ZOOM_TAU = 0.04;        // zoom easing time constant (~0.15 s to settle)
  var SWAY_AMP = 2.2;         // world units, times loadout.swayMul
  var SCOPED_DRAG = 1.35;     // drag speed boost while scoped, so long pans need fewer swipes
  var TAP_MOVE = 10;          // CSS px: a pointer that moves less than this is a tap
  var TAP_TIME = 280;         // ms: and is released within this time
  var BREATH_DRAIN = 3.5;     // seconds of held breath
  var BREATH_FILL = 5;        // seconds to refill
  var SHAKY_TIME = 2;         // seconds
  var LOOK_TIME = 3;          // alerted target stops and looks around
  var ALERT_SPEED_MUL = 1.6;  // alerted target walks faster afterwards
  var DEFAULT_RANGE = 300;    // metres when nothing is under the crosshair
  var MAX_DPR = 3;

  var DEFAULT_FAIL = {
    escape: 'The target escaped.',
    attacker: 'They reached their objective.',
    alarm: 'The alarm was raised.',
    time: 'Time ran out.',
    civilian: 'A civilian was killed. The contract is void.',
    ally: 'You shot a friendly. The contract is void.'
  };

  // ---------------------------------------------------------------- module state
  var S = null;               // live state (Core.state)
  var hooks = {};
  var opts = {};
  var lo = null;              // normalised loadout
  var rules = {};
  var canvas = null, ctx = null;
  var raf = 0, lastTs = null, running = false;
  var vw = 800, vh = 450, dpr = 1, cssW = -1, cssH = -1;
  var cam = { x: 0, y: 500 }; // un-swayed camera centre
  var binds = [];
  var keys = {};
  var ptr = null;             // { id, x, y } first pointer only
  var wheelAcc = 0, wheelLast = 0;
  var breathReq = false, shakyT = 0;
  var swayAmp = 0, swayT = 0, swayPh = [0, 0, 0, 0];
  var windPh = [0, 0, 0];
  var structs = [];           // cached structure rects, nearest first
  var pendingSpawns = [];
  var pendingMsgs = [];
  var ending = null;          // { win, reason, delay }
  var endCalled = false;
  var tKills = 0, tHeads = 0, rewardHeads = 0;
  var lastLased = null;       // entity the rangefinder last measured (kept while holding over it)
  var idSeq = 0;
  var lastAlertSnd = -10;
  var boltSnd = false;
  var lastMoved = 0;
  var errOnce = {};

  // ---------------------------------------------------------------- helpers
  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function nowMs() { return (window.performance && performance.now) ? performance.now() : Date.now(); }

  function report(tag, err) {
    if (errOnce[tag]) return;
    errOnce[tag] = true;
    if (window.console && console.error) console.error('[LW.Core] ' + tag + ':', err);
  }

  function snd(name) {
    if (LW.Audio && typeof LW.Audio.play === 'function') {
      try { LW.Audio.play(name); } catch (err) { report('audio', err); }
    }
  }

  function emit(evt) {
    if (hooks && typeof hooks.onEvent === 'function') {
      try { hooks.onEvent(evt); } catch (err) { report('onEvent', err); }
    }
  }

  function failText(key) {
    var ft = (S && S.mission && S.mission.failText) || {};
    return (typeof ft[key] === 'string' && ft[key]) ? ft[key] : DEFAULT_FAIL[key];
  }

  function isDummy(e) { return !!(e.look && e.look.dummy); }
  function isGoal(role) { return role === 'target' || role === 'attacker'; }
  function active() { return !!S && running && S.status === 'playing' && !ending; }
  function worldW() { return S ? S.worldWidth : 2800; }

  function addEffect(type, x, y, dist) {
    S.effects.push({ type: type, x: x, y: y, dist: dist, t0: S.t });
  }

  // ---------------------------------------------------------------- setup
  function buildLoadout(l) {
    var d = {
      weaponId: 'rifle', name: 'Rifle', damage: 70, velocity: 800, dropMul: 1, swayMul: 1,
      zoom: 3, magazine: 5, reloadTime: 2.2, boltTime: 1, suppressed: false, computer: false
    };
    var o = {}, k;
    for (k in d) if (Object.prototype.hasOwnProperty.call(d, k)) o[k] = d[k];
    if (l) for (k in l) if (Object.prototype.hasOwnProperty.call(l, k) && l[k] != null) o[k] = l[k];
    o.damage = num(o.damage, 70);
    o.velocity = Math.max(50, num(o.velocity, 800));
    o.dropMul = num(o.dropMul, 1);
    o.swayMul = Math.max(0, num(o.swayMul, 1));
    o.zoom = Math.max(2, num(o.zoom, 3));
    o.magazine = Math.max(1, Math.round(num(o.magazine, 5)));
    o.reloadTime = Math.max(0.1, num(o.reloadTime, 2.2));
    o.boltTime = Math.max(0.05, num(o.boltTime, 1));
    o.suppressed = !!o.suppressed;
    o.computer = !!o.computer;
    return o;
  }

  function initEntity(def) {
    var e = clone(def) || {};
    if (e.id == null || e.id === '') e.id = 'ent' + (++idSeq);
    e.role = e.role || 'civilian';
    e.dist = num(e.dist, 200);
    if (e.dist < 1) e.dist = 1;
    e.x = num(e.x, 0);
    e.y = num(e.y, 800);
    e.look = e.look || {};
    e.window = !!e.window;
    e.alive = true;
    e.hp = num(e.hp, 0) > 0 ? e.hp : 100;
    e.speed = num(e.speed, 0) > 0 ? e.speed : 1.3;
    e.path = Array.isArray(e.path) ? e.path : [];
    e.loop = !!e.loop;
    e.escape = !!e.escape;
    e.fleePath = Array.isArray(e.fleePath) ? e.fleePath : null;
    e.facing = e.facing === -1 ? -1 : 1;
    e.state = e.path.length ? 'walk' : 'idle';
    e.walkPhase = 0;
    e.alertT = 0;
    e.dead = null;
    // private-ish movement bookkeeping
    e.pathIndex = 0;
    e.waitT = 0;
    e.pathDone = false;
    e.speedMul = 1;
    e.lookT = 0;
    e.lookFlipT = 0;
    e.fleeIndex = 0;
    e.fleeT = 0;
    e.fleeDir = 0;
    e.removed = false;
    e.escaped = false;
    return e;
  }

  function structRect(s) {
    if (!s || !s.type) return null;
    var dist = num(s.dist, 200);
    var k = 2000 / Math.max(1, dist);      // world units per metre
    var x = num(s.x, 0), y = num(s.y, 0), w = num(s.w, 0), h = num(s.h, 0);
    var L, H;
    switch (s.type) {
      case 'building': case 'wall': case 'billboard': case 'container':
        return { x0: x, y0: y, x1: x + w, y1: y + h };
      case 'ground': case 'water':
        return { x0: -1e9, y0: y, x1: 1e9, y1: 1e9 };
      case 'car':
        if (s.kind === 'truck') { L = 7.5; H = 3.2; }
        else if (s.kind === 'van') { L = 5.2; H = 2.3; }
        else { L = 4.6; H = 1.45; }
        return { x0: x - L * k / 2, y0: y - H * k, x1: x + L * k / 2, y1: y };
      case 'lamp':
        return { x0: x - 0.3 * k, y0: y - 5.5 * k, x1: x + 0.3 * k, y1: y };
      case 'boat':
        if (!w) w = 12 * k;
        return { x0: x - w / 2, y0: y - w * 0.3, x1: x + w, y1: y + w * 0.06 };
      default:
        return null;                         // cranes etc: open lattice, ignore
    }
  }

  function buildStructs(mission) {
    structs = [];
    var list = Array.isArray(mission.structures) ? mission.structures : [];
    for (var i = 0; i < list.length; i++) {
      var r = structRect(list[i]);
      if (!r) continue;
      var t = list[i].type;
      r.dist = num(list[i].dist, 200);
      r.metal = (t === 'car' || t === 'container' || t === 'boat' || t === 'lamp');
      structs.push(r);
    }
    structs.sort(function (a, b) { return a.dist - b.dist; });
  }

  function structureAt(x, y) {
    for (var i = 0; i < structs.length; i++) {
      var r = structs[i];
      if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) return r;
    }
    return null;
  }

  // ---------------------------------------------------------------- canvas / sizing
  function checkSize(force) {
    var d = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    if (!canvas) {
      vw = window.innerWidth || 800; vh = window.innerHeight || 450; dpr = d;
      return;
    }
    var cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (!force && cw === cssW && ch === cssH && d === dpr) return;
    cssW = cw; cssH = ch; dpr = d;
    if (cw > 0 && ch > 0) {
      var r = canvas.getBoundingClientRect();
      var w = r.width || cw, h = r.height || ch;
      vw = w; vh = h;
      var pw = Math.max(1, Math.round(w * d)), ph = Math.max(1, Math.round(h * d));
      if (canvas.width !== pw) canvas.width = pw;
      if (canvas.height !== ph) canvas.height = ph;
    } else {
      vw = window.innerWidth || 800; vh = window.innerHeight || 450;
    }
  }

  function onResize() {
    checkSize(true);
    if (S && running) {
      clampCam();
      S.view.x = cam.x + S.sway.x;
      S.view.y = cam.y + S.sway.y;
      S.aim.x = S.view.x;
      S.aim.y = S.view.y;
    }
  }

  function draw() {
    if (!ctx || !LW.Render || typeof LW.Render.draw !== 'function') return;
    if (!(cssW > 0 && cssH > 0)) return;
    ctx.save();
    try {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      LW.Render.draw(ctx, S, vw, vh);
    } catch (err) {
      report('render', err);
    } finally {
      ctx.restore();
    }
  }

  // ---------------------------------------------------------------- camera
  function clampCam() {
    var W = worldW();
    var s = (vh / LW.CONST.WORLD_H) * S.view.zoom;
    if (!(s > 0)) s = 1;
    var halfW = vw / 2 / s, halfH = vh / 2 / s;
    if (S.scoped) {
      // the aim point (screen centre) stays inside the world
      cam.x = LW.clamp(cam.x, 0, W);
      cam.y = LW.clamp(cam.y, 0, LW.CONST.WORLD_H);
    } else {
      cam.x = (W <= 2 * halfW) ? W / 2 : LW.clamp(cam.x, halfW, W - halfW);
      cam.y = (LW.CONST.WORLD_H <= 2 * halfH + 1e-6) ? LW.CONST.WORLD_H / 2
        : LW.clamp(cam.y, halfH, LW.CONST.WORLD_H - halfH);
    }
  }

  function panPx(dx, dy, sens) {
    var s = LW.cam.scale(S.view, vh || 1);
    if (!(s > 0)) return;
    cam.x -= dx / s * sens;
    if (S.scoped) cam.y -= dy / s * sens;
    clampCam();
  }

  function updateCamera(rdt) {
    var zt = S.scoped ? S.zoomTarget : 1;
    var z = S.view.zoom;
    if (z !== zt) {
      var k = 1 - Math.exp(-rdt / ZOOM_TAU);
      z = Math.exp(Math.log(z) + (Math.log(zt) - Math.log(z)) * k);
      if (Math.abs(z - zt) < 0.003) z = zt;
      S.view.zoom = z;
    }
    if (active()) {
      var kx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
      var ky = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
      // keys move the view (look right = world moves left), i.e. the opposite of a finger drag
      if (kx || ky) panPx(-kx * KEY_PAN * rdt, -ky * KEY_PAN * rdt, 1);
    }
    clampCam();

    // sway (scoped only), eased amplitude so holding breath settles smoothly
    var target = S.scoped ? SWAY_AMP * lo.swayMul * (S.holding ? 0.15 : 1) * (S.shaky ? 1.6 : 1) : 0;
    swayAmp += (target - swayAmp) * (1 - Math.exp(-rdt / 0.2));
    swayT += rdt * (S.shaky ? 1.6 : 1);
    if (S.scoped) {
      S.sway.x = swayAmp * (0.65 * Math.sin(swayT * 1.13 + swayPh[0]) + 0.35 * Math.sin(swayT * 2.71 + swayPh[1]));
      S.sway.y = swayAmp * (0.65 * Math.sin(swayT * 0.87 + swayPh[2]) + 0.35 * Math.sin(swayT * 2.19 + swayPh[3]));
    } else {
      S.sway.x = 0; S.sway.y = 0;
    }
    S.view.x = cam.x + S.sway.x;
    S.view.y = cam.y + S.sway.y;
    S.aim.x = S.view.x;
    S.aim.y = S.view.y;
  }

  function updateBreath(rdt) {
    var want = breathReq && S.scoped && !S.shaky && S.breath > 0 && !ending;
    if (want && !S.holding) snd('breath');
    S.holding = want;
    if (S.holding) {
      S.breath -= rdt / BREATH_DRAIN;
      if (S.breath <= 0) {
        S.breath = 0;
        S.holding = false;
        S.shaky = true;
        shakyT = SHAKY_TIME;
        breathReq = false;          // must press again after recovering
        snd('breath');
      }
    } else {
      S.breath = Math.min(1, S.breath + rdt / BREATH_FILL);
    }
    if (S.shaky) {
      shakyT -= rdt;
      if (shakyT <= 0) { shakyT = 0; S.shaky = false; }
    }
  }

  function updateWind() {
    var w = (S.mission && S.mission.wind) || {};
    var base = num(w.base, 0), gust = num(w.gust, 0), t = S.t;
    var n = 0.5 * Math.sin(t * 0.21 + windPh[0]) + 0.3 * Math.sin(t * 0.53 + windPh[1]) + 0.2 * Math.sin(t * 1.17 + windPh[2]);
    S.wind = base + gust * n;
  }

  // ---------------------------------------------------------------- range finder
  function updateRange() {
    var ax = S.aim.x, ay = S.aim.y, best = null, i, e, h, hw, y0, y1;
    for (i = 0; i < S.entities.length; i++) {
      e = S.entities[i];
      if (!e.alive || e.removed) continue;
      h = LW.personHeight(e);
      hw = Math.max(h * 0.3, 2);
      y0 = e.y - h * 1.05;
      y1 = e.window ? e.y - h * 0.4 : e.y;
      if (ax >= e.x - hw && ax <= e.x + hw && ay >= y0 && ay <= y1) {
        if (!best || e.dist < best.dist) best = e;
      }
    }
    var r = best ? best.dist : null;
    if (best) {
      lastLased = best;
    } else if (lastLased && lastLased.alive && !lastLased.removed) {
      // Holding over or beside a target moves the crosshair off the body; keep its distance
      // while the crosshair stays in the hold-over zone around the person last measured.
      h = LW.personHeight(lastLased);
      if (Math.abs(ax - lastLased.x) <= h * 2.5 && ay >= lastLased.y - h * 4 && ay <= lastLased.y + h) r = lastLased.dist;
    }
    if (r == null) {
      var s = structureAt(ax, ay);
      if (s) r = s.dist;
    }
    S.range = r;
    S.predicted = (lo.computer && r != null) ? LW.impactAt(ax, ay, r, S.wind, lo) : null;
  }

  // ---------------------------------------------------------------- weapon
  function startReload() {
    if (S.reloading > 0) return;
    if (S.ammo >= lo.magazine) return;
    S.bolt = 0;
    S.reloading = 1e-4;
    snd('reload');
    emit({ type: 'reloadStart' });
  }

  function fire() {
    if (!active()) return;
    if (S.reloading > 0 || S.bolt > 0) return;
    if (S.ammo <= 0) { startReload(); return; }
    S.ammo--;
    S.stats.shots++;
    var ax = S.aim.x, ay = S.aim.y;
    if (!S.scoped) {
      ax += (Math.random() * 2 - 1) * SPREAD;
      ay += (Math.random() * 2 - 1) * SPREAD;
    }
    var dist = S.range != null ? S.range : DEFAULT_RANGE;
    var p = LW.impactAt(ax, ay, dist, S.wind, lo);
    // The bullet flies until it has passed every person (or reached what the crosshair is on);
    // updateBullets checks each person at the moment the bullet reaches their distance.
    var end = dist, i;
    for (i = 0; i < S.entities.length; i++) {
      if (S.entities[i].alive && !S.entities[i].removed && S.entities[i].dist > end) end = S.entities[i].dist;
    }
    S.bullets.push({
      fromT: S.t, hitT: S.t + LW.flightTime(end, lo), x: p.x, y: p.y, dist: dist,
      ax: ax, ay: ay, wind: S.wind, suppressed: lo.suppressed, passed: {}
    });
    addEffect('muzzle', ax, ay, 0);
    snd(lo.suppressed ? 'shotSuppressed' : 'shot');
    emit({ type: 'shot' });
    if (S.ammo > 0) {
      S.bolt = 1e-4;
      boltSnd = false;
    } else {
      startReload();                // empty magazine auto-reloads
    }
  }

  function updateWeapon(dt) {
    if (S.bolt > 0) {
      S.bolt += dt / lo.boltTime;
      if (!boltSnd && S.bolt >= 0.15) { boltSnd = true; snd('bolt'); }
      if (S.bolt >= 1) S.bolt = 0;
    }
    if (S.reloading > 0) {
      S.reloading += dt / lo.reloadTime;
      if (S.reloading >= 1) {
        S.reloading = 0;
        S.ammo = lo.magazine;
        emit({ type: 'reloadEnd' });
      }
    }
  }

  // ---------------------------------------------------------------- bullets / hits
  function distToBody(e, q) {
    var g = LW.bodyGeom(e);
    var x0 = g.torso.x0, x1 = g.torso.x1;
    var y0 = g.head.y - g.head.r, y1 = e.window ? g.sillY : e.y;
    var dx = Math.max(x0 - q.x, 0, q.x - x1);
    var dy = Math.max(y0 - q.y, 0, q.y - y1);
    return Math.sqrt(dx * dx + dy * dy);
  }

  // Bullets sweep outward: each frame, every person whose distance the bullet has just reached is
  // tested against where they stand at that moment, so moving targets need lead for their own
  // distance no matter what the crosshair rests on. The nearest person hit stops the bullet.
  function updateBullets() {
    var i = 0, b, travelled, j, e, p, part, best;
    while (i < S.bullets.length) {
      b = S.bullets[i];
      travelled = (S.t - b.fromT) * lo.velocity;
      best = null;
      for (j = 0; j < S.entities.length; j++) {
        e = S.entities[j];
        if (!e.alive || e.removed || b.passed[e.id] || e.dist > travelled) continue;
        b.passed[e.id] = true;
        p = LW.impactAt(b.ax, b.ay, e.dist, b.wind, lo);
        part = LW.hitTest(e, p.x, p.y);
        if (part && (!best || e.dist < best.e.dist)) best = { e: e, part: part, p: p };
      }
      if (best || S.t >= b.hitT) {
        S.bullets.splice(i, 1);
        resolveBullet(b, best);
        if (!S || S.status === 'ended') return;
      } else {
        i++;
      }
    }
  }

  function resolveBullet(b, best) {
    var i, e;
    var ix, iy;
    if (best) {
      S.stats.hits++;
      ix = best.p.x; iy = best.p.y;
      hitEntity(best.e, best.part, best.p);
    } else {
      ix = b.x; iy = b.y;
      var s = structureAt(ix, iy);
      addEffect(s && s.metal ? 'spark' : 'impact', ix, iy, b.dist);
      snd('impact');
      emit({ type: 'miss' });
    }
    S.lastShot = { t: S.t, x: ix, y: iy, dist: best ? best.e.dist : b.dist, hit: best ? best.part : null };
    if (ending) return;             // final kill or failure: no further alerts

    var R = b.suppressed ? NOISE_R_SUP : NOISE_R;
    for (i = 0; i < S.entities.length; i++) {
      e = S.entities[i];
      if (!e.alive || e.removed) continue;
      var h = LW.personHeight(e);
      var dx = e.x - ix, dy = (e.y - h * 0.55) - iy;
      if (dx * dx + dy * dy <= R * R) {
        alertEntity(e);
      } else if (!best) {
        var q = LW.impactAt(b.ax, b.ay, e.dist, b.wind, lo);
        if (distToBody(e, q) <= NEAR_MISS) alertEntity(e);
      }
    }
  }

  function hitEntity(e, part, p) {
    var head = part === 'head';
    addEffect(isDummy(e) ? 'impact' : 'blood', p.x, p.y, e.dist);
    if (head) {
      S.stats.headshots++;
      snd('hitHead');
      emit({ type: 'headshot', id: e.id, text: e.name || '' });
      killEntity(e, true, p);
    } else {
      e.hp -= lo.damage;
      snd('hitBody');
      emit({ type: 'hit', id: e.id, text: e.name || '' });
      if (e.hp <= 0) killEntity(e, false, p);
      else alertEntity(e);
    }
  }

  function killEntity(e, head, p) {
    e.alive = false;
    e.hp = 0;
    e.dead = { t: S.t, head: !!head, dir: -e.facing || 1 };
    e.state = 'idle';
    S.stats.kills++;
    emit({ type: 'kill', id: e.id, text: e.name || '' });
    if (e.role === 'civilian') {
      S.stats.civilians++;
      emit({ type: 'civilian', id: e.id, text: e.name || '' });
      if (rules.noCivilianKills) fail(failText('civilian'));
    } else if (e.role === 'ally') {
      fail(failText('ally'));
    } else {
      if (head) rewardHeads++;
      if (isGoal(e.role)) { tKills++; if (head) tHeads++; }
    }
    countTargets();
    if (!ending && isGoal(e.role) && S.targetsLeft === 0) beginWin(e, p);
  }

  // ---------------------------------------------------------------- alerts
  function alertNotice(e) {
    emit({ type: 'alert', id: e.id, text: e.name || '' });
    if (S.t - lastAlertSnd > 0.4) { lastAlertSnd = S.t; snd('alert'); }
  }

  function startPanic(e) {
    if (e.state === 'panic') return;
    e.state = 'panic';
    e.fleeT = 0;
    e.fleeDir = 0;
  }

  function startFlee(e) {
    if (e.state === 'flee') return;
    e.state = 'flee';
    e.fleeIndex = 0;
    e.fleeT = 0;
    e.fleeDir = 0;
  }

  function alertEntity(e) {
    if (!e.alive || e.removed || isDummy(e)) return;
    if (e.role === 'guard') {
      if (e.state === 'alert') return;
      e.state = 'alert';
      e.lookFlipT = 1.2;
      alertNotice(e);
    } else if (e.role === 'civilian') {
      startPanic(e);
    } else if (e.role === 'target') {
      if (e.state === 'flee' || e.state === 'alert') return;
      if (S.alarmRaised) { startFlee(e); return; }
      e.state = 'alert';
      e.lookT = LOOK_TIME;
      e.lookFlipT = 0.6;
      alertNotice(e);
    }
    // attackers and allies ignore alerts
  }

  function raiseAlarm() {
    if (S.alarmRaised) return;
    S.alarmRaised = true;
    S.alarm = 1;
    emit({ type: 'alarm', text: failText('alarm') });
    snd('alarm');
    for (var i = 0; i < S.entities.length; i++) {
      var e = S.entities[i];
      if (!e.alive || e.removed || isDummy(e)) continue;
      if (e.role === 'target') startFlee(e);
      else if (e.role === 'civilian') startPanic(e);
    }
    if (rules.noAlarm) fail(failText('alarm'));
  }

  function updateCorpses() {
    var dead = [], i, j, e, d, dx, dy;
    for (i = 0; i < S.entities.length; i++) {
      e = S.entities[i];
      if (!e.alive && e.dead && !e.removed && !isDummy(e)) dead.push(e);
    }
    if (!dead.length) return;
    for (i = 0; i < S.entities.length; i++) {
      e = S.entities[i];
      if (!e.alive || e.removed || isDummy(e)) continue;
      if (!((e.role === 'guard' && e.state !== 'alert') || (e.role === 'civilian' && e.state !== 'panic'))) continue;
      for (j = 0; j < dead.length; j++) {
        d = dead[j];
        if (Math.abs(d.dist - e.dist) >= CORPSE_DIST) continue;
        dx = d.x - e.x; dy = d.y - e.y;
        if (dx * dx + dy * dy <= CORPSE_R * CORPSE_R) { alertEntity(e); break; }
      }
    }
  }

  // ---------------------------------------------------------------- movement / AI
  // Moves e toward (tx, ty) at speed m/s. Returns true on arrival. Sets lastMoved.
  function moveToward(e, tx, ty, speed, dt) {
    var ups = speed * 2000 / e.dist;
    var dx = tx - e.x, dy = ty - e.y;
    var d = Math.sqrt(dx * dx + dy * dy);
    var step = ups * dt;
    var arrived = false, moved;
    if (d <= step || d < 1e-6) {
      e.x = tx; e.y = ty; moved = d; arrived = true;
    } else {
      e.x += dx / d * step; e.y += dy / d * step; moved = step;
    }
    if (Math.abs(dx) > 1e-3 && moved > 0) e.facing = dx > 0 ? 1 : -1;
    var h = LW.personHeight(e);
    if (h > 0) e.walkPhase += moved / h * 8;    // radians; ~0.9 strides/s at walking speed
    lastMoved = moved;
    return arrived;
  }

  function nextWaypoint(e) {
    e.pathIndex++;
    if (e.pathIndex >= e.path.length) {
      if (e.loop) {
        e.pathIndex = 0;
      } else {
        e.pathIndex = e.path.length - 1;
        e.pathDone = true;
        e.state = 'idle';
      }
    }
  }

  function followPath(e, dt) {
    var path = e.path;
    if (!path.length || e.pathDone) { e.state = 'idle'; return; }
    if (e.waitT > 0) {
      e.state = 'idle';
      e.waitT -= dt;
      if (e.waitT > 0) return;
      e.waitT = 0;
      nextWaypoint(e);
      if (e.pathDone) return;
    }
    var wp = path[e.pathIndex] || {};
    var arrived = moveToward(e, num(wp.x, e.x), num(wp.y, e.y), e.speed * e.speedMul, dt);
    e.state = lastMoved > 1e-4 ? 'walk' : 'idle';
    if (!arrived) return;
    var last = e.pathIndex === path.length - 1;
    if (last && e.role === 'attacker') fail(failText('attacker'));
    else if (last && e.role === 'target' && e.escape) fail(failText('escape'));
    if (wp.facing === 1 || wp.facing === -1) e.facing = wp.facing;
    var w = num(wp.wait, 0);
    if (w > 0) { e.waitT = w; e.state = 'idle'; }
    else nextWaypoint(e);
  }

  function runOffEdge(e, dt) {
    var W = worldW();
    var h = LW.personHeight(e);
    if (!e.fleeDir) e.fleeDir = e.x < W / 2 ? -1 : 1;
    moveToward(e, e.fleeDir < 0 ? -h * 4 : W + h * 4, e.y, RUN_SPEED, dt);
    return e.x < -h || e.x > W + h;
  }

  function updatePanic(e, dt) {
    e.fleeT += dt;
    if (e.window) {                  // ducks away from the window
      if (e.fleeT > 1.2) e.removed = true;
      return;
    }
    if (runOffEdge(e, dt)) e.removed = true;   // gone, not counted as killed
  }

  function escapeTarget(e) {
    e.removed = true;
    e.escaped = true;
    fail(failText('escape'));
  }

  function updateFlee(e, dt) {
    e.fleeT += dt;
    var fp = e.fleePath;
    if (fp && fp.length) {
      var wp = fp[Math.min(e.fleeIndex, fp.length - 1)] || {};
      if (moveToward(e, num(wp.x, e.x), num(wp.y, e.y), RUN_SPEED, dt)) {
        e.fleeIndex++;
        if (e.fleeIndex >= fp.length) escapeTarget(e);
      }
    } else if (e.window) {
      if (e.fleeT > 2) escapeTarget(e);
    } else if (runOffEdge(e, dt)) {
      escapeTarget(e);
    }
  }

  function updateLook(e, dt) {
    e.lookT -= dt;
    e.lookFlipT -= dt;
    if (e.lookFlipT <= 0) { e.facing = -e.facing; e.lookFlipT = 0.7 + Math.random() * 0.5; }
    if (e.lookT <= 0) {
      e.lookT = 0;
      e.speedMul = ALERT_SPEED_MUL;
      e.state = (e.path.length && !e.pathDone) ? 'walk' : 'idle';
    }
  }

  function updateGuardAlert(e, dt) {
    e.lookFlipT -= dt;
    if (e.lookFlipT <= 0) { e.facing = -e.facing; e.lookFlipT = 1.0 + Math.random() * 0.8; }
    if (ending || S.alarmRaised) return;
    e.alertT = Math.min(1, e.alertT + dt / ALERT_FILL);
    if (e.alertT >= 1) raiseAlarm();
  }

  function updateAI(dt) {
    var i, e, anyRemoved = false;
    for (i = 0; i < S.entities.length; i++) {
      e = S.entities[i];
      if (!e.alive || e.removed) continue;
      switch (e.state) {
        case 'panic': updatePanic(e, dt); break;
        case 'flee': updateFlee(e, dt); break;
        case 'alert':
          if (e.role === 'guard') updateGuardAlert(e, dt);
          else if (e.role === 'target') updateLook(e, dt);
          else followPath(e, dt);
          break;
        default: followPath(e, dt);
      }
      if (e.removed) anyRemoved = true;
      if (!S || S.status === 'ended') return;
    }
    if (anyRemoved) {
      S.entities = S.entities.filter(function (x) { return !x.removed; });
    }
    if (!S.alarmRaised) {
      var a = 0;
      for (i = 0; i < S.entities.length; i++) {
        e = S.entities[i];
        if (e.alive && e.role === 'guard' && e.alertT > a) a = e.alertT;
      }
      S.alarm = a;
    } else {
      S.alarm = 1;
    }
  }

  // ---------------------------------------------------------------- timeline
  function updateTimeline() {
    var ev;
    while (pendingMsgs.length && S.t >= pendingMsgs[0].t) {
      ev = pendingMsgs.shift();
      emit({ type: 'message', text: ev.text || '' });
    }
    while (pendingSpawns.length && S.t >= pendingSpawns[0].t) {
      ev = pendingSpawns.shift();
      if (!ev.entity) continue;
      var e = initEntity(ev.entity);
      S.entities.push(e);
      if (S.alarmRaised && !isDummy(e)) {
        if (e.role === 'target') startFlee(e);
        else if (e.role === 'civilian') startPanic(e);
      }
      emit({ type: 'spawn', id: e.id, text: e.name || '' });
    }
  }

  function countTargets() {
    var n = 0, i, e;
    for (i = 0; i < S.entities.length; i++) {
      e = S.entities[i];
      if (e.alive && !e.removed && isGoal(e.role)) n++;
    }
    for (i = 0; i < pendingSpawns.length; i++) {
      if (pendingSpawns[i].entity && isGoal(pendingSpawns[i].entity.role)) n++;
    }
    S.targetsLeft = n;
  }

  function updateTimer() {
    var tl = num(S.mission.timeLimit, 0);
    if (tl > 0) {
      S.timeLeft = Math.max(0, tl - S.t);
      if (S.timeLeft <= 0 && !ending) fail(failText('time'));
    } else {
      S.timeLeft = null;
    }
  }

  function pruneEffects() {
    while (S.effects.length && S.t - S.effects[0].t0 > EFFECT_LIFE) S.effects.shift();
  }

  // ---------------------------------------------------------------- ending
  function fail(reason) {
    if (!S || S.status === 'ended' || ending) return;
    ending = { win: false, reason: reason || 'Mission failed.', delay: FAIL_DELAY };
    S.outcome = { win: false, reason: ending.reason };
    S.timeScale = 1;
    breathReq = false;
  }

  function beginWin(e, p) {
    if (!S || S.status === 'ended' || ending) return;
    var h = LW.personHeight(e);
    var x = p ? p.x : e.x, y = p ? p.y : e.y - h * 0.9;
    S.killcam = { id: e.id, t0: S.t, x: x, y: y, dist: e.dist };
    S.timeScale = KILLCAM_SCALE;
    ending = { win: true, reason: '', delay: KILLCAM_REAL };
    S.outcome = { win: true, reason: '' };
    breathReq = false;
  }

  function buildResult(win, reason) {
    var st = S.stats;
    var accuracy = st.shots > 0 ? st.hits / st.shots : 0;
    var allHeads = tKills > 0 && tHeads === tKills;
    var stars = win ? 1 + (accuracy >= 0.75 ? 1 : 0) + (allHeads ? 1 : 0) : 0;
    var bonuses = [], reward = 0, i;
    if (win) {
      bonuses.push({ label: 'Contract', amount: num(S.mission.reward, 0) });
      // Practice missions (the repeatable range) pay small bonuses so they cannot outearn contracts.
      var practice = !!S.mission.practice;
      if (rewardHeads > 0) bonuses.push({ label: 'Headshots \u00d7' + rewardHeads, amount: (practice ? 10 : 50) * rewardHeads });
      if (st.shots > 0 && st.hits >= st.shots) bonuses.push({ label: 'No wasted rounds', amount: practice ? 30 : 100 });
      if (st.civilians > 0) bonuses.push({ label: 'Civilian casualties', amount: -150 * st.civilians });
      for (i = 0; i < bonuses.length; i++) reward += bonuses[i].amount;
      reward = Math.max(0, reward);
    }
    return {
      win: !!win,
      reason: reason || '',
      stats: { shots: st.shots, hits: st.hits, headshots: st.headshots, kills: st.kills, civilians: st.civilians },
      accuracy: accuracy,
      stars: stars,
      reward: reward,
      bonuses: bonuses
    };
  }

  function finish() {
    if (endCalled || !ending) return;
    endCalled = true;
    var win = ending.win, reason = ending.reason;
    S.status = 'ended';
    S.timeScale = 1;
    S.holding = false;
    breathReq = false;
    ptr = null;
    keys = {};
    var res = buildResult(win, reason);
    S.result = res;
    if (hooks && typeof hooks.onEnd === 'function') {
      try { hooks.onEnd(res); } catch (err) { report('onEnd', err); }
    }
  }

  function updateEnding(rdt) {
    if (!ending) {
      // safety net: goal entities gone some other way
      if (S.targetsLeft === 0 && S.hadGoals) { ending = { win: true, reason: '', delay: WIN_DELAY }; S.outcome = { win: true, reason: '' }; }
      return;
    }
    ending.delay -= rdt;
    if (ending.delay <= 0) finish();
  }

  // ---------------------------------------------------------------- main update
  function update(rdt) {
    var st = S;
    var dt = rdt * S.timeScale;
    S.t += dt;
    updateCamera(rdt);
    updateBreath(rdt);
    updateWind();
    updateWeapon(dt);
    updateTimeline();
    updateBullets();
    if (S !== st || S.status === 'ended') return;
    updateAI(dt);
    if (S !== st || S.status === 'ended') return;
    if (!ending) updateCorpses();
    updateRange();
    updateTimer();
    pruneEffects();
    countTargets();
    updateEnding(rdt);
  }

  function frame(ts) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    var st = S;
    var dt = lastTs == null ? 1 / 60 : (ts - lastTs) / 1000;
    lastTs = ts;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.05) dt = 0.05;
    checkSize(false);
    if (S.status === 'playing') {
      try { update(dt); } catch (err) { report('update', err); }
      if (!running || S !== st) return;   // onEnd stopped or restarted the game
    }
    draw();
    if (hooks && typeof hooks.onFrame === 'function') {
      try { hooks.onFrame(S); } catch (err) { report('onFrame', err); }
    }
  }

  // ---------------------------------------------------------------- input
  var input = {
    pan: function (dx, dy) {
      if (!active()) return;
      panPx(num(dx, 0), num(dy, 0), num(opts.sensitivity, 1));
    },
    setScoped: function (b) {
      if (!active()) return;
      b = !!b;
      if (b === S.scoped) return;
      S.scoped = b;
      if (b) {
        snd('scopeIn');
      } else {
        snd('scopeOut');
        breathReq = false;
        S.holding = false;
      }
      clampCam();
    },
    toggleScope: function () {
      if (!S) return;
      input.setScoped(!S.scoped);
    },
    zoomStep: function (d) {
      if (!active()) return;
      d = d > 0 ? 1 : (d < 0 ? -1 : 0);
      var op = LW.CONST.OPTIC;
      S.zoomTarget = LW.clamp(S.zoomTarget + d * 0.5 * op, 1.5 * op, lo.zoom * op);
    },
    fire: function () { fire(); },
    reload: function () {
      if (!active()) return;
      startReload();
    },
    setBreath: function (b) {
      if (!S) return;
      if (!b) { breathReq = false; return; }
      if (!active()) return;
      breathReq = true;
    }
  };
  Core.input = input;

  function panDir(code, key) {
    if (code === 'KeyA' || code === 'ArrowLeft' || key === 'ArrowLeft' || key === 'a' || key === 'A') return 'left';
    if (code === 'KeyD' || code === 'ArrowRight' || key === 'ArrowRight' || key === 'd' || key === 'D') return 'right';
    if (code === 'KeyW' || code === 'ArrowUp' || key === 'ArrowUp' || key === 'w' || key === 'W') return 'up';
    if (code === 'KeyS' || code === 'ArrowDown' || key === 'ArrowDown' || key === 's' || key === 'S') return 'down';
    return null;
  }

  function isTextField(t) {
    var tag = t && t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!(t && t.isContentEditable);
  }

  function onKeyDown(ev) {
    if (!S || !running) return;
    var code = ev.code || '', key = ev.key || '';
    if (key === 'Escape' || code === 'Escape' || key === 'Esc') {
      if (S.status === 'playing' && !ending && hooks && typeof hooks.onPause === 'function') {
        try { hooks.onPause(); } catch (err) { report('onPause', err); }
      }
      return;
    }
    if (S.status !== 'playing') return;
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (isTextField(ev.target)) return;
    var dir = panDir(code, key);
    if (dir) { keys[dir] = true; ev.preventDefault(); return; }
    if (code === 'Space' || key === ' ' || key === 'Spacebar') {
      ev.preventDefault();
      if (!ev.repeat) input.fire();
      return;
    }
    if (key === 'Shift' || code === 'ShiftLeft' || code === 'ShiftRight') { input.setBreath(true); return; }
    if (code === 'KeyE' || key === 'e' || key === 'E') { if (!ev.repeat) input.toggleScope(); return; }
    if (code === 'KeyR' || key === 'r' || key === 'R') { if (!ev.repeat) input.reload(); return; }
    if (key === '+' || key === '=' || code === 'NumpadAdd' || code === 'Equal') { ev.preventDefault(); input.zoomStep(1); return; }
    if (key === '-' || key === '_' || code === 'NumpadSubtract' || code === 'Minus') { ev.preventDefault(); input.zoomStep(-1); return; }
  }

  function onKeyUp(ev) {
    if (!S || !running) return;
    var code = ev.code || '', key = ev.key || '';
    var dir = panDir(code, key);
    if (dir) { keys[dir] = false; return; }
    if (key === 'Shift' || code === 'ShiftLeft' || code === 'ShiftRight') { input.setBreath(false); return; }
    if ((code === 'Space' || key === ' ') && S.status === 'playing' && !isTextField(ev.target)) ev.preventDefault();
  }

  function onBlur() {
    keys = {};
    breathReq = false;
  }

  function onVisibility() {
    keys = {};
    breathReq = false;
    if (document.hidden && S && S.status === 'playing' && !ending && hooks && typeof hooks.onPause === 'function') {
      try { hooks.onPause(); } catch (err) { report('onPause', err); }
    }
  }

  function onPointerDown(ev) {
    if (!S || !running) return;
    if (ev.button === 2) {           // right mouse toggles scope
      ev.preventDefault();
      if (active()) input.toggleScope();
      return;
    }
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    // The newest finger on the canvas always takes over aiming. A finger that was lifted
    // without a pointerup (WebViews sometimes drop it) can never lock aiming this way.
    ptr = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, x0: ev.clientX, y0: ev.clientY, t0: nowMs(), moved: 0 };
    try { canvas.setPointerCapture(ev.pointerId); } catch (err) { /* capture unsupported */ }
    if (ev.cancelable) ev.preventDefault();
  }

  function onPointerMove(ev) {
    if (!ptr || ev.pointerId !== ptr.id) return;
    var dx = ev.clientX - ptr.x, dy = ev.clientY - ptr.y;
    ptr.x = ev.clientX;
    ptr.y = ev.clientY;
    ptr.moved = Math.max(ptr.moved, Math.abs(ev.clientX - ptr.x0) + Math.abs(ev.clientY - ptr.y0));
    if (dx || dy) dragPan(dx, dy);
    if (ev.cancelable) ev.preventDefault();
  }

  function onPointerUp(ev) {
    if (!ptr || ev.pointerId !== ptr.id) return;
    var p = ptr;
    ptr = null;
    try { if (canvas.hasPointerCapture && canvas.hasPointerCapture(ev.pointerId)) canvas.releasePointerCapture(ev.pointerId); } catch (err) { /* ignore */ }
    if (ev.type === 'pointerup' && p.moved < TAP_MOVE && nowMs() - p.t0 < TAP_TIME) onTap(ev.clientX, ev.clientY);
  }

  // Finger drag. By default the crosshair follows the finger (like LONEWOLF): dragging right
  // looks right. invertDrag restores "grab the city" panning.
  function dragPan(dx, dy) {
    if (!active()) return;
    var k = (opts.invertDrag ? 1 : -1) * (S.scoped ? SCOPED_DRAG : 1);
    panPx(dx * k, dy * k, num(opts.sensitivity, 1));
  }

  // A quick tap on the city while unscoped zooms the scope in on that spot.
  function onTap(cx, cy) {
    if (!active() || S.scoped || opts.tapToScope === false || !canvas) return;
    var r = canvas.getBoundingClientRect();
    var w = LW.cam.screenToWorld(S.view, vw, vh, cx - r.left, cy - r.top);
    cam.x = w.x;
    cam.y = w.y;
    input.setScoped(true);
  }

  function onContextMenu(ev) { ev.preventDefault(); }

  function onWheel(ev) {
    if (ev.cancelable) ev.preventDefault();
    if (!active()) return;
    var t = nowMs();
    if (t - wheelLast > 250) wheelAcc = 0;
    wheelLast = t;
    var mul = ev.deltaMode === 1 ? 33 : (ev.deltaMode === 2 ? 400 : 1);
    wheelAcc += ev.deltaY * mul;
    if (Math.abs(wheelAcc) < 60) return;
    var step = wheelAcc < 0 ? 1 : -1;
    wheelAcc = 0;
    if (step > 0 && !S.scoped) { input.setScoped(true); return; }   // wheel up unscoped enters the scope
    input.zoomStep(step);
  }

  function bind(target, type, fn, o) {
    if (!target || !target.addEventListener) return;
    target.addEventListener(type, fn, o);
    binds.push([target, type, fn, o]);
  }

  function unbindAll() {
    for (var i = 0; i < binds.length; i++) {
      var b = binds[i];
      try { b[0].removeEventListener(b[1], b[2], b[3]); } catch (err) { /* ignore */ }
    }
    binds = [];
  }

  function bindInput() {
    bind(window, 'keydown', onKeyDown, false);
    bind(window, 'keyup', onKeyUp, false);
    bind(window, 'blur', onBlur, false);
    bind(window, 'resize', onResize, false);
    bind(window, 'orientationchange', onResize, false);
    bind(document, 'visibilitychange', onVisibility, false);
    if (canvas) {
      bind(canvas, 'pointerdown', onPointerDown, false);
      bind(canvas, 'pointermove', onPointerMove, false);
      bind(canvas, 'pointerup', onPointerUp, false);
      bind(canvas, 'pointercancel', onPointerUp, false);
      bind(canvas, 'lostpointercapture', onPointerUp, false);
      bind(canvas, 'contextmenu', onContextMenu, false);
      bind(canvas, 'wheel', onWheel, { passive: false });
      bind(canvas, 'touchstart', onTouchMove, { passive: false });
      bind(canvas, 'touchmove', onTouchMove, { passive: false });
    }
  }

  // ---------------------------------------------------------------- public API
  Core.start = function (mission, loadout, hk, options) {
    if (running) Core.stop();
    mission = mission || {};
    hooks = hk || {};
    opts = options || {};
    if (opts.sensitivity == null) opts.sensitivity = 1;
    lo = buildLoadout(loadout);
    rules = mission.rules || {};
    errOnce = {};
    idSeq = 0;
    keys = {};
    ptr = null;
    wheelAcc = 0;
    breathReq = false;
    shakyT = 0;
    swayAmp = 0;
    swayT = 0;
    lastAlertSnd = -10;
    boltSnd = false;
    ending = null;
    endCalled = false;
    tKills = 0; tHeads = 0; rewardHeads = 0;
    lastLased = null;
    lastTs = null;
    var i;
    for (i = 0; i < 4; i++) swayPh[i] = Math.random() * Math.PI * 2;
    for (i = 0; i < 3; i++) windPh[i] = Math.random() * Math.PI * 2;

    var W = num(mission.world && mission.world.width, 2800);
    if (W <= 0) W = 2800;
    var tl = num(mission.timeLimit, 0);

    S = {
      mission: mission,
      loadout: lo,
      status: 'playing',
      t: 0,
      timeScale: 1,
      view: { x: W / 2, y: 500, zoom: 1 },
      scoped: false,
      zoomTarget: lo.zoom * LW.CONST.OPTIC,
      aim: { x: W / 2, y: 500 },
      sway: { x: 0, y: 0 },
      breath: 1,
      holding: false,
      shaky: false,
      wind: 0,
      range: null,
      predicted: null,
      ammo: lo.magazine,
      reloading: 0,
      bolt: 0,
      alarm: 0,
      alarmRaised: false,
      timeLeft: tl > 0 ? tl : null,
      targetsLeft: 0,
      entities: [],
      bullets: [],
      effects: [],
      killcam: null,
      stats: { shots: 0, hits: 0, headshots: 0, kills: 0, civilians: 0 },
      // extras (not in the contract, safe to ignore)
      worldWidth: W,
      outcome: null,     // { win, reason } once the mission is decided (before onEnd)
      result: null,      // the result object passed to onEnd
      hadGoals: false
    };
    Core.state = S;

    var ents = Array.isArray(mission.entities) ? mission.entities : [];
    for (i = 0; i < ents.length; i++) if (ents[i]) S.entities.push(initEntity(ents[i]));
    pendingSpawns = [];
    var sp = Array.isArray(mission.spawns) ? mission.spawns : [];
    for (i = 0; i < sp.length; i++) {
      if (sp[i] && sp[i].entity) pendingSpawns.push({ t: num(sp[i].t, 0), entity: sp[i].entity });
    }
    pendingSpawns.sort(function (a, b) { return a.t - b.t; });
    pendingMsgs = [];
    var ms = Array.isArray(mission.messages) ? mission.messages : [];
    for (i = 0; i < ms.length; i++) {
      if (ms[i]) pendingMsgs.push({ t: num(ms[i].t, 0), text: ms[i].text || '' });
    }
    pendingMsgs.sort(function (a, b) { return a.t - b.t; });
    buildStructs(mission);
    countTargets();
    S.hadGoals = S.targetsLeft > 0;
    updateWind();

    if (LW.Render && typeof LW.Render.prepare === 'function') {
      try { LW.Render.prepare(mission); } catch (err) { report('prepare', err); }
    }

    canvas = document.getElementById('game-canvas');
    ctx = null;
    if (canvas && canvas.getContext) {
      ctx = canvas.getContext('2d');
      try { canvas.style.touchAction = 'none'; } catch (err) { /* ignore */ }
    }
    cssW = -1; cssH = -1;
    checkSize(true);

    var st = mission.start || {};
    cam.x = num(st.x, W / 2);
    cam.y = num(st.y, 500);
    clampCam();
    S.view.x = cam.x; S.view.y = cam.y;
    S.aim.x = cam.x; S.aim.y = cam.y;
    updateRange();

    bindInput();
    lockPageGestures(true);
    running = true;
    raf = requestAnimationFrame(frame);
    return S;
  };

  // Live option changes from the pause menu: { sensitivity, invertDrag, tapToScope }.
  Core.setOptions = function (o) {
    if (!o) return;
    for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) opts[k] = o[k];
    if (opts.sensitivity == null) opts.sensitivity = 1;
  };

  // While a mission runs, stop the browser from turning aim drags into page scroll,
  // pull-to-refresh or pinch zoom (common on Android Chrome and in-app WebViews).
  var savedGesture = null;
  function lockPageGestures(on) {
    try {
      var de = document.documentElement, b = document.body;
      if (on && !savedGesture) {
        savedGesture = [de.style.overscrollBehavior, de.style.touchAction, b.style.overscrollBehavior, b.style.touchAction];
        de.style.overscrollBehavior = 'none'; de.style.touchAction = 'none';
        b.style.overscrollBehavior = 'none'; b.style.touchAction = 'none';
      } else if (!on && savedGesture) {
        de.style.overscrollBehavior = savedGesture[0]; de.style.touchAction = savedGesture[1];
        b.style.overscrollBehavior = savedGesture[2]; b.style.touchAction = savedGesture[3];
        savedGesture = null;
      }
    } catch (err) { /* ignore */ }
  }

  // Older WebViews ignore touch-action: cancel touch scrolling on the canvas directly.
  function onTouchMove(ev) { if (ev.cancelable) ev.preventDefault(); }

  Core.stop = function () {
    lockPageGestures(false);
    running = false;
    if (raf) { try { cancelAnimationFrame(raf); } catch (err) { /* ignore */ } }
    raf = 0;
    if (ptr && canvas) {
      try { if (canvas.hasPointerCapture && canvas.hasPointerCapture(ptr.id)) canvas.releasePointerCapture(ptr.id); } catch (err) { /* ignore */ }
    }
    unbindAll();
    ptr = null;
    keys = {};
    breathReq = false;
    lastTs = null;
  };

  Core.pause = function () {
    if (!S || S.status !== 'playing') return;
    S.status = 'paused';
    keys = {};
    ptr = null;
    breathReq = false;
    S.holding = false;
  };

  Core.resume = function () {
    if (!S || S.status !== 'paused') return;
    S.status = 'playing';
    lastTs = null;
  };

  Core.debug = {
    // Kill every remaining target/attacker with a headshot (counts as perfect shots) and win.
    win: function () {
      if (!S || S.status === 'ended' || ending) return;
      pendingSpawns = pendingSpawns.filter(function (p) { return !(p.entity && isGoal(p.entity.role)); });
      var list = S.entities.filter(function (e) { return e.alive && !e.removed && isGoal(e.role); });
      if (!list.length) {
        countTargets();
        ending = { win: true, reason: '', delay: WIN_DELAY };
        S.outcome = { win: true, reason: '' };
        return;
      }
      for (var i = 0; i < list.length; i++) {
        S.stats.shots++;
        S.stats.hits++;
        S.stats.headshots++;
        killEntity(list[i], true, null);
      }
    },
    fail: function (reason) {
      if (!S) return;
      fail(reason || 'Mission failed (debug).');
    }
  };
})(window.LW);
