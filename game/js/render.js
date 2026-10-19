// Silent Contract: renderer. Draws the sky, skyline, structures, people, effects, weather and the scope.
// LW.Render = { prepare(mission), draw(ctx, state, vw, vh) }. See CONTRACT.md. ES5 only, ASCII only.
// Look: graphic noir. Ink outlines, sodium-amber rim light, wet streets with light streaks, neon halos.
// Speed: per-structure geometry is recorded once (Batch / Path2D), gradients are cached, and fine
// detail is drawn only when its on-screen size is large enough (SC = screen pixels per world unit).
window.LW = window.LW || {};
(function (LW) {
  'use strict';

  var C = LW.CONST || { WORLD_H: 1000, MARK: 5, MIN_DIST: 60, MAX_DIST: 600, OPTIC: 3 };
  var TAU = Math.PI * 2, PI = Math.PI, HALF_PI = Math.PI / 2;
  var HAS_P2D = typeof Path2D !== 'undefined';
  var FONT = '"Bebas Neue", Oswald, Impact, "Arial Narrow", sans-serif';
  var NEON = ['#ff4f5e', '#e8a33d', '#ff4f5e', '#5fd6e6', '#f0b95a', '#e86cff'];
  var AMBER = [232, 163, 61];

  // ---------- small helpers ----------

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
  function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  var imul = Math.imul || function (a, b) {
    var ah = (a >>> 16) & 0xffff, al = a & 0xffff, bh = (b >>> 16) & 0xffff, bl = b & 0xffff;
    return ((al * bl) + (((ah * bl + al * bh) << 16) >>> 0)) | 0;
  };
  function mulberry32(a) {
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = imul(a ^ (a >>> 15), 1 | a);
      t = (t + imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash1(n) { var x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
  function hash2(a, b) { return hash1(a * 12.9898 + b * 78.233); }
  function strHash(s) {
    var h = 2166136261, i;
    s = String(s || '');
    for (i = 0; i < s.length; i++) { h = imul(h ^ s.charCodeAt(i), 16777619); }
    return h >>> 0;
  }

  var colorMemo = {};
  function rgb(c) {
    if (c && typeof c === 'object' && c.length === 3) { return c; }
    if (typeof c !== 'string') { return [90, 90, 90]; }
    var m = colorMemo[c];
    if (m) { return m; }
    var s = c.replace(/\s/g, ''), r = 90, g = 90, b = 90, k;
    if (s.charAt(0) === '#') {
      if (s.length === 4) {
        r = parseInt(s.charAt(1) + s.charAt(1), 16); g = parseInt(s.charAt(2) + s.charAt(2), 16); b = parseInt(s.charAt(3) + s.charAt(3), 16);
      } else if (s.length >= 7) {
        r = parseInt(s.substr(1, 2), 16); g = parseInt(s.substr(3, 2), 16); b = parseInt(s.substr(5, 2), 16);
      }
    } else {
      k = s.match(/\d+(\.\d+)?/g);
      if (k && k.length >= 3) { r = +k[0]; g = +k[1]; b = +k[2]; }
    }
    if (isNaN(r) || isNaN(g) || isNaN(b)) { r = 90; g = 90; b = 90; }
    m = [r, g, b];
    colorMemo[c] = m;
    return m;
  }
  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function mul(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }
  function css(a, al) {
    var r = clamp(Math.round(a[0]), 0, 255), g = clamp(Math.round(a[1]), 0, 255), b = clamp(Math.round(a[2]), 0, 255);
    if (al === undefined || al >= 1) { return 'rgb(' + r + ',' + g + ',' + b + ')'; }
    return 'rgba(' + r + ',' + g + ',' + b + ',' + (Math.round(clamp(al, 0, 1) * 1000) / 1000) + ')';
  }

  // Batched geometry: recorded once in prepare(), filled or stroked with one call per frame (Path2D when available).
  // Ops: 0 rect(x,y,w,h) 1 circ(x,y,r) 2 line(x0,y0,x1,y1) 3 ell(x,y,rx,ry) 4 quad(8 numbers) 5 tri(6 numbers)
  function Batch() { this.ops = []; this.p = null; this.n = 0; }
  Batch.prototype.rect = function (x, y, w, h) { this.ops.push(0, x, y, w, h); this.n++; };
  Batch.prototype.circ = function (x, y, r) { this.ops.push(1, x, y, r); this.n++; };
  Batch.prototype.line = function (x0, y0, x1, y1) { this.ops.push(2, x0, y0, x1, y1); this.n++; };
  Batch.prototype.ell = function (x, y, rx, ry) { this.ops.push(3, x, y, rx, ry); this.n++; };
  Batch.prototype.quad = function (a, b, c, d, e, f, g, h) { this.ops.push(4, a, b, c, d, e, f, g, h); this.n++; };
  Batch.prototype.tri = function (a, b, c, d, e, f) { this.ops.push(5, a, b, c, d, e, f); this.n++; };
  Batch.prototype.trace = function (c) {
    var o = this.ops, i = 0, L = o.length, k;
    while (i < L) {
      k = o[i];
      if (k === 0) { c.rect(o[i + 1], o[i + 2], o[i + 3], o[i + 4]); i += 5; }
      else if (k === 1) { c.moveTo(o[i + 1] + o[i + 3], o[i + 2]); c.arc(o[i + 1], o[i + 2], o[i + 3], 0, TAU); i += 4; }
      else if (k === 2) { c.moveTo(o[i + 1], o[i + 2]); c.lineTo(o[i + 3], o[i + 4]); i += 5; }
      else if (k === 3) { c.moveTo(o[i + 1] + o[i + 3], o[i + 2]); c.ellipse(o[i + 1], o[i + 2], o[i + 3], o[i + 4], 0, 0, TAU); i += 5; }
      else if (k === 4) {
        c.moveTo(o[i + 1], o[i + 2]); c.lineTo(o[i + 3], o[i + 4]); c.lineTo(o[i + 5], o[i + 6]); c.lineTo(o[i + 7], o[i + 8]); c.closePath();
        i += 9;
      } else {
        c.moveTo(o[i + 1], o[i + 2]); c.lineTo(o[i + 3], o[i + 4]); c.lineTo(o[i + 5], o[i + 6]); c.closePath();
        i += 7;
      }
    }
  };
  Batch.prototype.path = function () {
    if (!this.p && HAS_P2D) { this.p = new Path2D(); this.trace(this.p); }
    return this.p;
  };
  Batch.prototype.fill = function (ctx) {
    if (!this.n) { return; }
    var p = this.path();
    if (p) { ctx.fill(p); } else { ctx.beginPath(); this.trace(ctx); ctx.fill(); }
  };
  Batch.prototype.stroke = function (ctx) {
    if (!this.n) { return; }
    var p = this.path();
    if (p) { ctx.stroke(p); } else { ctx.beginPath(); this.trace(ctx); ctx.stroke(); }
  };

  function poly(ctx, pts) {
    ctx.beginPath(); ctx.moveTo(pts[0], pts[1]);
    for (var i = 2; i < pts.length; i += 2) { ctx.lineTo(pts[i], pts[i + 1]); }
    ctx.closePath(); ctx.fill();
  }
  function dot(ctx, x, y, r, col) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); }
  function seg(ctx, x0, y0, x1, y1, w, col) {
    ctx.strokeStyle = col; ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  }

  // ---------- palettes per mission time ----------
  // glow: city light pollution at the horizon. veil: strength of the depth fog layers. keyX: where the
  // moon / sun sits (fraction of the world width), used for rim light when no street lamp is near.

  var TIMES = {
    night: { sky: [[0, '#02060d'], [0.4, '#081424'], [0.66, '#132638'], [0.8, '#1d3346'], [1, '#22394c']],
      haze: '#1d2e40', hazeMax: 0.55, silo: '#070d15', cloud: '#2a3a4c', cloudA: 0.35, rim: '#e8a33d',
      dark: 0.6, wallK: 1, lightA: 1, lampK: 1, wet: 0.6, beams: true, rain: 0.25, fog: 0, sky2: 'moon',
      glow: '#5a4128', glowA: 0.32, veil: 0.07, keyX: 0.68, stars: 0.7, storm: false },
    rain: { sky: [[0, '#04070b'], [0.4, '#0d151e'], [0.66, '#1a2530'], [0.8, '#24303b'], [1, '#2a3642']],
      haze: '#27323d', hazeMax: 0.7, silo: '#0a1017', cloud: '#1e2833', cloudA: 0.6, rim: '#e8a33d',
      dark: 0.55, wallK: 0.9, lightA: 1, lampK: 1, wet: 1, beams: true, rain: 1, fog: 0.12, sky2: 'glow',
      glow: '#4a4236', glowA: 0.3, veil: 0.12, keyX: 0.6, stars: 0, storm: true },
    dusk: { sky: [[0, '#130e24'], [0.32, '#33203f'], [0.55, '#6c3346'], [0.7, '#b65638'], [0.8, '#d5823f'], [1, '#c9763e']],
      haze: '#6a4656', hazeMax: 0.6, silo: '#140e18', cloud: '#5a2c3e', cloudA: 0.5, rim: '#f0a35a',
      dark: 0.62, wallK: 1.05, lightA: 0.85, lampK: 0.8, wet: 0.3, beams: true, rain: 0, fog: 0.05, sky2: 'sun',
      glow: '#e0874a', glowA: 0.28, veil: 0.1, keyX: 0.3, stars: 0, storm: false },
    dawn: { sky: [[0, '#28303f'], [0.4, '#55566a'], [0.64, '#9a7f8c'], [0.76, '#c49c9c'], [0.86, '#cdb0aa'], [1, '#b7a6a8']],
      haze: '#988f98', hazeMax: 0.62, silo: '#2a2a34', cloud: '#8a7a88', cloudA: 0.35, rim: '#d5dde4',
      dark: 0.72, wallK: 1.25, lightA: 0.55, lampK: 0.45, wet: 0.35, beams: false, rain: 0, fog: 0.15, sky2: 'dawn',
      glow: '#d9b2a4', glowA: 0.3, veil: 0.16, keyX: 0.78, stars: 0, storm: false },
    fog: { sky: [[0, '#535d63'], [0.45, '#78838a'], [0.72, '#949ea2'], [1, '#a2aaac']],
      haze: '#959fa3', hazeMax: 0.9, silo: '#3a4248', cloud: '#a0a8aa', cloudA: 0.2, rim: '#dfe3e0',
      dark: 0.72, wallK: 1.1, lightA: 0.75, lampK: 0.9, wet: 0.4, beams: true, rain: 0, fog: 1, sky2: 'diffuse',
      glow: '#c3cac9', glowA: 0.25, veil: 0.3, keyX: 0.5, stars: 0, storm: false }
  };

  var STYLE = {
    brick: { wall: '#3d2b26', trim: '#2a1d1a', win: '#110e0f', ledge: '#5a463c' },
    concrete: { wall: '#353b41', trim: '#43494f', win: '#101418', ledge: '#555c63' },
    glass: { wall: '#18262f', trim: '#2d404b', win: '#0b151b', ledge: '#3a505c' },
    deco: { wall: '#3a3532', trim: '#4b4541', win: '#121112', ledge: '#5e5650' }
  };

  var K = null;   // per-mission cache, built by prepare()
  var PX = 1;     // one screen pixel in world units for the current pass
  var SC = 1;     // screen pixels per world unit for the current pass (LOD decisions)
  var VR = { x0: 0, x1: 0, y0: 0, y1: 0 };   // visible world rect for the current pass

  function hazeF(d) { return K.P.hazeMax * Math.pow(clamp((d - 60) / 540, 0, 1), 0.8); }
  function hzA(c, d, k) { var a = rgb(c); if (k !== undefined) { a = mul(a, k); } return mix(a, K.haze, hazeF(d)); }
  function hz(c, d, k, al) { return css(hzA(c, d, k), al); }
  function hzLight(c, d) { return css(mix(rgb(c), K.haze, hazeF(d) * (K.P.fog ? 0.75 : 0.4))); }
  function rimCol(d, al) { return css(mix(rgb(K.P.rim), K.haze, hazeF(d)), al * (1 - hazeF(d) * 0.7)); }

  // ---------- prepare ----------

  var BUILD = {};

  function prepare(mission) {
    mission = mission || {};
    var P = TIMES[mission.time] || TIMES.night;
    var W = num(mission.world && mission.world.width, 3000);
    K = { mission: mission, P: P, time: TIMES[mission.time] ? mission.time : 'night', W: W, haze: rgb(P.haze),
      items: [], ents: {}, gctx: null, g: {}, sg: {}, drops: [], dropsNear: [], seed: strHash(mission.id),
      lamps: [], grounds: [], walls: [], keyX: W * P.keyX, hold: 0, lastT: -1, grainPat: null, vw: 0, vh: 0, cand: [] };
    var list = mission.structures || [], i, s, it, d;
    for (i = 0; i < list.length; i++) {
      s = list[i];
      if (!s || !BUILD[s.type]) { continue; }
      d = num(s.dist, 0) > 0 ? s.dist : 200;
      it = { s: s, type: s.type, i: i, d: d, u: 2000 / d, x0: -1e9, x1: 1e9, y0: -1e9, y1: 1e9, fn: null };
      BUILD[s.type](it, s, mulberry32(i * 7919 + 1013 + K.seed));
      if (!it.fn) { continue; }
      K.items.push(it);
      if (it.type === 'lamp') { K.lamps.push(it); }
      else if (it.type === 'ground' || it.type === 'water') { K.grounds.push(it); }
      else if (it.type === 'wall') { K.walls.push(it); }
    }
    K.items.sort(function (a, b) { return (b.d - a.d) || (a.i - b.i); });
    for (i = 0; i < K.grounds.length; i++) { finishGround(K.grounds[i], mulberry32(i * 131 + 7 + K.seed)); }
    buildSky();
    buildDrops();
  }

  // Ground bands learn where nearer bands or long walls cover them (for rain splashes) and collect
  // the lit windows, neon and lamps above them as vertical reflection streaks on the wet surface.
  function finishGround(g, rnd) {
    var i, o, end = 1000;
    for (i = 0; i < K.items.length; i++) {
      o = K.items[i];
      if (o.d >= g.d) { continue; }
      if (o.type === 'ground' || o.type === 'water') { end = Math.min(end, o.gy); }
      else if (o.type === 'wall' && o.bw >= K.W * 0.6) { end = Math.min(end, o.by); }
    }
    g.yEnd = Math.max(g.gy + 1, end);
    buildReflections(g, rnd);
  }

  function reflAdd(g, map, col, x, w, y, len, rnd) {
    var e = map[col], k, segL, yy = y, l, piece, ww;
    if (!e) { e = { c: col, b: [new Batch(), new Batch(), new Batch()] }; map[col] = e; g.refl.push(e); }
    for (k = 0; k < 3; k++) {
      segL = len * (k === 0 ? 0.28 : k === 1 ? 0.33 : 0.39);
      l = 0;
      while (l < segL) {
        piece = Math.max(g.u * 0.12, segL * (0.18 + rnd() * 0.35));
        ww = w * (0.65 + rnd() * 0.6) * (1 + k * 0.3);
        e.b[k].rect(x - ww / 2 + (rnd() - 0.5) * w * 0.5, yy + l, ww, Math.min(piece, segL - l));
        l += piece + g.u * (0.04 + rnd() * 0.2) * (1 + k);
      }
      yy += segL;
    }
  }

  function buildReflections(g, rnd) {
    g.refl = [];
    if (g.kind === 'park') { return; }
    var u = g.u, map = {}, n = 0, i, b, G, c, r, v, top, len, maxLen, x, lc, l;
    top = g.type === 'water' ? g.gy + u * 0.25 : (g.kind === 'street' ? g.roadY + u * 0.15 : g.gy + u * 0.3);
    maxLen = Math.max(u, Math.min(g.yEnd - top, u * (g.type === 'water' ? 26 : 13)));
    for (i = 0; i < K.items.length && n < 260; i++) {
      b = K.items[i];
      if (b.type !== 'building' || b.d < g.d - 1 || b.d > g.d + 170) { continue; }
      if (b.by + b.bh < g.gy - b.u * 8) { continue; }
      G = b.gw;
      for (c = 0; c < G.cols && n < 260; c++) {
        for (r = G.rows - 1; r >= Math.max(0, G.rows - 4); r--) {
          v = b.cells[r * G.cols + c];
          if (v >= 1 && v <= 4) {
            x = G.ox + c * G.cw + G.ww / 2;
            len = maxLen * (0.45 + rnd() * 0.55);
            reflAdd(g, map, b.litCol[v - 1], x, Math.max(u * 0.2, G.ww * 0.5), top, len, rnd);
            n++;
            break;
          }
        }
      }
      if (b.sign) {
        if (b.roof === 'neon') { x = b.bx + b.bw / 2; l = b.bw * 0.35; }
        else { x = b.signX + b.u; l = b.u * 1.2; }
        for (c = 0; c < 3; c++) { reflAdd(g, map, b.neonC, x + (c - 1) * l * 0.4, l * 0.35, top, maxLen * (0.8 + rnd() * 0.2), rnd); }
        n += 3;
      }
    }
    for (i = 0; i < K.lamps.length; i++) {
      lc = K.lamps[i];
      if (Math.abs(lc.d - g.d) > 30) { continue; }
      reflAdd(g, map, '#f0b45a', lc.lx + lc.dir * 1.25 * lc.u, lc.u * 0.45, top, maxLen, rnd);
    }
  }

  function buildSky() {
    var P = K.P, W = K.W, rnd = mulberry32(4242 + K.seed), x, w, top, a, b, ah, nw, nh;
    var silo = rgb(P.silo);
    K.cFar = css(mix(silo, K.haze, Math.min(0.95, P.hazeMax + 0.28)));
    K.cNear = css(mix(silo, K.haze, Math.min(0.9, P.hazeMax + 0.1)));
    K.cSkyWin = css(mix(rgb('#e8a33d'), K.haze, Math.min(0.9, P.hazeMax + 0.1)), P.lightA * 0.8);
    K.cSkyWin2 = css(mix(rgb('#a9cbd9'), K.haze, Math.min(0.9, P.hazeMax + 0.1)), P.lightA * 0.6);
    K.cNearRim = css(mix(rgb(P.rim), K.haze, 0.75), 0.35);
    K.far = new Batch(); K.near = new Batch(); K.skyWin = new Batch(); K.skyWin2 = new Batch(); K.nearRim = new Batch(); K.aviation = [];
    x = -400;
    while (x < W + 400) {
      w = 18 + rnd() * 60; top = 520 + rnd() * 150;
      K.far.rect(x, top, w + 1, 950 - top);
      if (rnd() < 0.12) { K.far.rect(x + w * 0.5 - 0.6, top - 20 - rnd() * 30, 1.2, 60); }
      if (rnd() < 0.08) { K.far.tri(x, top + 1, x + w + 1, top + 1, x + w * 0.5, top - w * 0.7); }
      x += w;
    }
    x = -400;
    while (x < W + 400) {
      w = 26 + rnd() * 90; top = 570 + rnd() * 140;
      K.near.rect(x, top, w + 1, 950 - top);
      if (rnd() < 0.5) { K.nearRim.rect(x, top, 1.2, 950 - top); }
      if (rnd() < 0.3) { K.near.rect(x + w * 0.2, top - 10 - rnd() * 22, w * 0.6, 40); }
      if (rnd() < 0.15) { K.near.rect(x + w * 0.1 + rnd() * w * 0.6, top - 9, 6, 10); }
      if (rnd() < 0.12) {
        ah = 25 + rnd() * 40;
        K.near.rect(x + w * 0.5 - 0.7, top - ah, 1.4, ah + 2);
        K.aviation.push(x + w * 0.5, top - ah - 1, rnd() * 3);
      }
      nw = Math.floor(w / 6); nh = Math.floor((780 - top) / 8);
      for (a = 0; a < nw; a++) {
        for (b = 0; b < nh; b++) {
          if (rnd() < 0.05) { (rnd() < 0.8 ? K.skyWin : K.skyWin2).rect(x + 2 + a * 6, top + 4 + b * 8, 2, 3); }
        }
      }
      x += w + (rnd() < 0.2 ? rnd() * 24 : 0);
    }
    K.cloudSpan = W + 1400;
    K.clouds = new Batch(); K.clouds2 = new Batch();
    for (a = 0; a < 22; a++) { K.clouds.ell(-700 + rnd() * K.cloudSpan, 40 + rnd() * 300, 140 + rnd() * 300, 10 + rnd() * 26); }
    for (a = 0; a < 14; a++) { K.clouds2.ell(-700 + rnd() * K.cloudSpan, 180 + rnd() * 300, 200 + rnd() * 340, 16 + rnd() * 30); }
    K.cCloud = css(rgb(P.cloud), P.cloudA);
    K.cCloud2 = css(mix(rgb(P.cloud), K.haze, 0.4), P.cloudA * 0.8);
    K.stars = new Batch(); K.stars2 = new Batch();
    if (P.stars > 0) {
      for (a = 0; a < 110; a++) { (a % 2 ? K.stars : K.stars2).rect(-300 + rnd() * (W + 600), rnd() * 420 * rnd(), 1.1, 1.1); }
    }
  }

  function buildDrops() {
    var rnd = mulberry32(99 + K.seed), i;
    for (i = 0; i < 180; i++) { K.drops.push({ x: rnd(), y: rnd(), l: rnd(), sp: rnd() }); }
    for (i = 0; i < 34; i++) { K.dropsNear.push({ x: rnd(), y: rnd(), l: rnd(), sp: rnd() }); }
  }

  // ---------- buildings ----------

  BUILD.building = function (it, s, rnd) {
    var d = it.d, u = it.u, P = K.P;
    var x = num(s.x, 0), y = num(s.y, 400), w = Math.max(4, num(s.w, 100)), h = Math.max(4, num(s.h, 200));
    var st = STYLE[s.style] ? s.style : 'concrete', S = STYLE[st];
    it.bx = x; it.by = y; it.bw = w; it.bh = h; it.st = st;
    it.cWall = hz(S.wall, d, P.wallK); it.cTrim = hz(S.trim, d, P.wallK); it.cDark = hz(S.win, d, P.wallK);
    it.cLedge = hz(S.ledge, d, P.wallK); it.cSil = hz('#121519', d, P.wallK); it.cMetal = hz('#0d0f12', d, P.wallK);
    it.cAc = hz('#4b5056', d, P.wallK);
    it.cRim = rimCol(d, 0.35);
    it.side = Math.min(w * 0.08, u * 1.2);
    it.rimLeft = K.keyX < x + w / 2;
    // Window bays sized to real floors (1 m = 2000 / dist world units): ~2.5 m wide, ~3 m tall.
    var cw = Math.max(4, 5000 / d), ch = Math.max(6, 6000 / d), ww, wh;
    if (st === 'glass') { ww = cw * 0.86; wh = ch * 0.78; }
    else if (st === 'concrete') { ww = cw * 0.92; wh = ch * 0.5; }
    else if (st === 'deco') { ww = cw * 0.42; wh = ch * 0.68; }
    else { ww = cw * 0.5; wh = ch * 0.56; }
    var mx = cw * 0.7, topM = ch * 0.7;
    var cols = Math.max(0, Math.floor((w - mx * 2) / cw)), rows = Math.max(0, Math.floor((h - topM - ch * 0.4) / ch));
    if (cols * rows > 3000) { rows = Math.floor(3000 / Math.max(1, cols)); }
    var ox = x + (w - cols * cw) / 2 + (cw - ww) / 2, oy = y + topM + (ch - wh) * 0.3;
    var lights = clamp(num(s.lights, 0.35), 0, 1), r, c, wx, wy, k, rowBias, cell, mw = Math.max(0.25, ww * 0.045);
    var aw, ah, ax, ay, i, xx, yy, fe, nfe, fc, fx, pw, py, rail, sl, sx0, sx1, q, kind, bw2, bh2, rb, rx0;
    it.gw = { cw: cw, ch: ch, ww: ww, wh: wh, ox: ox, oy: oy, cols: cols, rows: rows };
    it.cells = [];
    it.dark = new Batch(); it.blind = new Batch(); it.trim = new Batch(); it.refl = null;
    it.lit = [new Batch(), new Batch(), new Batch(), new Batch()];
    it.litCol = [hzLight('#e8a33d', d), hzLight('#f3c873', d), hzLight('#b9772f', d), hzLight('#a9cbd9', d)];
    it.flick = []; it.occ = [];
    it.mull = new Batch(); it.ledge = new Batch(); it.shade = new Batch(); it.recess = new Batch();
    it.ac = new Batch(); it.acG = new Batch(); it.stain = new Batch(); it.pipe = new Batch();
    it.feS = new Batch(); it.feL = new Batch(); it.feF = new Batch(); it.dent = new Batch();
    it.roofB = new Batch(); it.roofLit = new Batch();
    for (r = 0; r < rows; r++) {
      rowBias = (rnd() - 0.5) * 0.3;
      for (c = 0; c < cols; c++) {
        wx = ox + c * cw; wy = oy + r * ch;
        if (rnd() >= lights + rowBias) {
          it.dark.rect(wx, wy, ww, wh); cell = 0;
        } else {
          k = rnd(); k = k < 0.42 ? 0 : k < 0.62 ? 1 : k < 0.8 ? 2 : 3;
          if (rnd() < 0.035) {
            it.flick.push({ x: wx, y: wy, w: ww, h: wh, c: it.litCol[k], seed: rnd() * 1000, rate: 5 + rnd() * 10 });
            cell = 9;
          } else {
            it.lit[k].rect(wx, wy, ww, wh); cell = k + 1;
            if (rnd() < 0.06 && it.occ.length < 6) { it.occ.push({ x: wx, y: wy, w: ww, h: wh, seed: rnd() * 100, rate: 0.12 + rnd() * 0.3 }); }
          }
          if (rnd() < 0.25) { it.blind.rect(wx, wy, ww, wh * (0.2 + rnd() * 0.45)); }
        }
        it.cells.push(cell);
        if (st === 'glass') { it.mull.rect(wx + ww * 0.5 - mw / 2, wy, mw, wh); }
        else { it.mull.rect(wx + ww * 0.5 - mw / 2, wy, mw, wh); it.mull.rect(wx, wy + wh * 0.38, ww, mw); }
        it.recess.rect(wx, wy, ww, wh * 0.1);
        it.recess.rect(it.rimLeft ? wx + ww * 0.93 : wx, wy, ww * 0.07, wh);
        if (st === 'brick' || st === 'deco') {
          it.ledge.rect(wx - ww * 0.08, wy + wh, ww * 1.16, Math.max(0.3, ch * 0.05));
          it.shade.rect(wx - ww * 0.06, wy + wh + ch * 0.05, ww * 1.12, ch * 0.05);
          if (st === 'brick') { it.ledge.rect(wx - ww * 0.05, wy - ch * 0.06, ww * 1.1, ch * 0.06); }
        }
        if ((st === 'brick' || st === 'concrete') && rnd() < 0.07) {
          aw = ww * (st === 'concrete' ? 0.3 : 0.6); ah = ch * 0.2; ax = wx + (ww - aw) * rnd(); ay = wy + wh + ch * 0.03;
          it.ac.rect(ax, ay, aw, ah);
          it.acG.rect(ax + aw * 0.1, ay + ah * 0.28, aw * 0.8, ah * 0.1);
          it.acG.rect(ax + aw * 0.1, ay + ah * 0.58, aw * 0.8, ah * 0.1);
          it.acG.rect(ax, ay + ah, aw, ah * 0.12);
          it.stain.rect(ax + aw * 0.42, ay + ah, aw * 0.14, ch * (0.3 + rnd() * 0.6));
        }
        if (st === 'concrete' && rnd() < 0.3) { it.stain.rect(wx + ww * (0.2 + rnd() * 0.5), wy + wh, ww * 0.1, ch * (0.3 + rnd() * 0.7)); }
      }
    }
    if (st === 'brick') {
      for (r = 0; r < rows; r++) { it.trim.rect(x, oy + r * ch + wh + ch * 0.12, w, ch * 0.05); }
    } else if (st === 'concrete') {
      for (r = 0; r <= rows; r++) { it.trim.rect(x, oy + r * ch - ch * 0.2, w, ch * 0.1); }
      for (c = 0; c <= cols; c += 3) { it.trim.rect(ox - (cw - ww) / 2 + c * cw - cw * 0.015, y, cw * 0.03, h); }
    } else if (st === 'deco') {
      for (c = 0; c <= cols; c += 2) { it.trim.rect(ox - (cw - ww) / 2 + c * cw - cw * 0.09, y + topM * 0.5, cw * 0.18, h - topM * 0.5); }
      it.trim.rect(x, y, w, Math.max(u * 0.5, topM * 0.4));
    } else {
      for (c = 0; c <= cols; c++) { it.trim.rect(ox - (cw - ww) / 2 + c * cw - cw * 0.03, y, cw * 0.06, h); }
      for (r = 0; r <= rows; r++) { it.trim.rect(x, oy + r * ch - (ch - wh) * 0.6, w, (ch - wh) * 0.25); }
      it.refl = new Batch();
      it.refl.rect(x + w * (0.1 + rnd() * 0.3), y, w * 0.12, h);
      it.refl.rect(x + w * (0.55 + rnd() * 0.3), y, w * 0.05, h);
    }
    // fire escapes: platforms with rails, zig-zag stairs and a drop ladder
    if (st === 'brick' && cols >= 4 && rows >= 3) {
      nfe = cols >= 9 ? 2 : 1; rail = u * 0.95; sl = Math.max(0.3, u * 0.09);
      for (fe = 0; fe < nfe; fe++) {
        fc = fe === 0 ? 1 + Math.floor(rnd() * Math.max(1, Math.floor(cols / 2) - 1)) : cols - 2 - Math.floor(rnd() * Math.max(1, Math.floor(cols / 3)));
        fx = ox + fc * cw + ww / 2; pw = cw * 1.55;
        for (r = 1; r < rows; r++) {
          py = oy + r * ch + wh + ch * 0.03;
          it.feS.rect(fx - pw / 2, py, pw, sl);
          it.feS.tri(fx - pw / 2 + u * 0.1, py + sl, fx - pw / 2 + u * 0.6, py + sl, fx - pw / 2 + u * 0.1, py + sl + u * 0.5);
          it.feS.tri(fx + pw / 2 - u * 0.1, py + sl, fx + pw / 2 - u * 0.6, py + sl, fx + pw / 2 - u * 0.1, py + sl + u * 0.5);
          it.feL.line(fx - pw / 2, py - rail, fx + pw / 2, py - rail);
          it.feL.line(fx - pw / 2, py, fx - pw / 2, py - rail);
          it.feL.line(fx + pw / 2, py, fx + pw / 2, py - rail);
          for (xx = fx - pw / 2 + u * 0.3; xx < fx + pw / 2 - u * 0.1; xx += u * 0.3) { it.feF.line(xx, py, xx, py - rail); }
          it.feF.line(fx - pw / 2, py - rail * 0.5, fx + pw / 2, py - rail * 0.5);
          if (r + 1 < rows) {
            sx0 = (r % 2) ? fx - pw * 0.42 : fx + pw * 0.42; sx1 = (r % 2) ? fx + pw * 0.36 : fx - pw * 0.36;
            it.feL.line(sx0, py, sx1, py + ch);
            it.feL.line(sx0, py - rail * 0.9, sx1, py + ch - rail * 0.9);
            for (i = 1; i < 9; i++) { q = i / 9; it.feF.line(sx0 + (sx1 - sx0) * q - u * 0.22, py + ch * q, sx0 + (sx1 - sx0) * q + u * 0.22, py + ch * q); }
          }
        }
        py = oy + (rows - 1) * ch + wh + ch * 0.03;
        it.feL.line(fx + pw * 0.28, py, fx + pw * 0.28, py + ch * 0.75);
        it.feL.line(fx + pw * 0.28 + u * 0.4, py, fx + pw * 0.28 + u * 0.4, py + ch * 0.75);
        for (yy = py + u * 0.3; yy < py + ch * 0.75; yy += u * 0.3) { it.feF.line(fx + pw * 0.28, yy, fx + pw * 0.28 + u * 0.4, yy); }
      }
    }
    // drainpipe with brackets
    if (st !== 'glass' && h > u * 6) {
      xx = rnd() < 0.5 ? x + u * 0.3 : x + w - u * 0.55;
      it.pipe.rect(xx, y + u * 0.4, u * 0.2, h - u * 0.4);
      it.pipe.rect(xx - u * 0.18, y + u * 0.25, u * 0.56, u * 0.35);
      for (yy = y + ch; yy < y + h; yy += ch) { it.pipe.rect(xx - u * 0.08, yy, u * 0.36, u * 0.1); }
    }
    // cornice: dentils under the parapet
    if (st === 'brick' || st === 'deco') {
      for (xx = x + u * 0.2; xx < x + w - u * 0.3 && it.dent.n < 1500; xx += u * 0.7) { it.dent.rect(xx, y + u * 0.12, u * 0.35, u * 0.3); }
      it.trim.rect(x, y + u * 0.5, w, u * 0.14);
    }
    it.roof = s.roof || 'flat';
    it.rx = x + w * (0.2 + rnd() * 0.6);
    it.seed = rnd() * 100;
    // roof clutter (vents, pipes, chimneys, stair bulkheads, dishes) behind the parapet
    rb = y - u * 0.4;
    k = Math.min(14, Math.floor(w / (u * 5)));
    for (i = 0; i < k; i++) {
      rx0 = x + u + rnd() * Math.max(u, w - u * 4);
      kind = rnd();
      if ((it.roof === 'water-tower' || it.roof === 'antenna') && Math.abs(rx0 - it.rx) < u * 3) { continue; }
      if (it.roof === 'neon' && rx0 > x + w * 0.1 && rx0 < x + w * 0.9) { continue; }
      if (kind < 0.35) {
        bw2 = u * (0.6 + rnd() * 1.2); bh2 = u * (0.5 + rnd() * 0.8);
        it.roofB.rect(rx0, rb - bh2, bw2, bh2 + u * 0.3);
      } else if (kind < 0.55) {
        it.roofB.rect(rx0, rb - u * 1.6, u * 0.16, u * 1.9);
        it.roofB.rect(rx0 - u * 0.12, rb - u * 1.72, u * 0.4, u * 0.16);
      } else if (kind < 0.72 && st === 'brick') {
        it.roofB.rect(rx0, rb - u * 2.2, u * 0.8, u * 2.5);
        it.roofB.rect(rx0 - u * 0.12, rb - u * 2.38, u * 1.04, u * 0.24);
      } else if (kind < 0.86) {
        bw2 = u * 2.6; bh2 = u * 2.3;
        it.roofB.rect(rx0, rb - bh2, bw2, bh2 + u * 0.3);
        it.roofB.rect(rx0 - u * 0.1, rb - bh2 - u * 0.16, bw2 + u * 0.2, u * 0.2);
        if (rnd() < 0.5) { it.roofLit.rect(rx0 + bw2 * 0.6, rb - bh2 * 0.72, bw2 * 0.24, bh2 * 0.72); }
      } else {
        it.roofB.ell(rx0, rb - u * 1.1, u * 0.42, u * 0.58);
        it.roofB.rect(rx0 - u * 0.05, rb - u * 1.1, u * 0.12, u * 1.4);
      }
    }
    it.sign = (s.sign !== undefined && s.sign !== null && s.sign !== '') ? String(s.sign) : '';
    it.neonC = NEON[Math.floor(rnd() * NEON.length)];
    it.signX = x + w * (0.08 + rnd() * 0.2);
    var top = y - u * 3;
    if (it.roof === 'water-tower') { top = y - u * 10; }
    else if (it.roof === 'antenna') { top = y - u * 14; }
    else if (it.roof === 'neon') { top = y - u * 3 - Math.min(u * 4, w * 0.2); }
    if (st === 'deco') { top = Math.min(top, y - u * 4); }
    it.x0 = x - u * 3; it.x1 = x + w + u * 3; it.y0 = top - u * 2; it.y1 = y + h;
    it.fn = dBuilding;
  };

  function dBuilding(ctx, it, t) {
    var x = it.bx, y = it.by, w = it.bw, h = it.bh, u = it.u, P = K.P, G = it.gw, us = u * SC, wpx = G.ww * SC, i, f, on, rw;
    if (it.st === 'deco') {
      ctx.fillStyle = it.cWall;
      ctx.fillRect(x + w * 0.12, y - u * 2, w * 0.76, u * 2 + 1 * PX);
      ctx.fillRect(x + w * 0.3, y - u * 4, w * 0.4, u * 2 + 1 * PX);
      ctx.fillStyle = it.cRim;
      ctx.fillRect(x + w * 0.12, y - u * 2, w * 0.76, Math.max(PX, u * 0.08));
      ctx.fillRect(x + w * 0.3, y - u * 4, w * 0.4, Math.max(PX, u * 0.08));
    }
    ctx.fillStyle = it.cSil; it.roofB.fill(ctx);
    if (it.roofLit.n) { ctx.globalAlpha = P.lightA * 0.85; ctx.fillStyle = it.litCol[0]; it.roofLit.fill(ctx); ctx.globalAlpha = 1; }
    ctx.fillStyle = it.cWall;
    ctx.fillRect(x, y, w, h);
    if (it.st === 'brick' && u * 0.075 * SC > 2.6) { brickTex(ctx, it); }
    ctx.fillStyle = 'rgba(0,0,0,0.22)'; it.stain.fill(ctx);
    ctx.fillStyle = it.cTrim; it.trim.fill(ctx);
    ctx.fillStyle = it.cDark; it.dark.fill(ctx);
    ctx.globalAlpha = P.lightA;
    for (i = 0; i < 4; i++) { ctx.fillStyle = it.litCol[i]; it.lit[i].fill(ctx); }
    for (i = 0; i < it.flick.length; i++) {
      f = it.flick[i];
      on = hash1(Math.floor(t * f.rate) + f.seed) > 0.35;
      ctx.fillStyle = on ? f.c : it.cDark;
      ctx.fillRect(f.x, f.y, f.w, f.h);
    }
    ctx.globalAlpha = 1;
    if (wpx > 30) { interiors(ctx, it, t); }
    if (it.occ.length && wpx > 2.5) { occupants(ctx, it, t); }
    ctx.fillStyle = 'rgba(0,0,0,0.38)'; it.blind.fill(ctx);
    if (wpx > 6) {
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; it.recess.fill(ctx);
      ctx.fillStyle = it.cTrim; it.mull.fill(ctx);
    }
    if (it.ledge.n && us > 0.6) {
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; it.shade.fill(ctx);
      ctx.fillStyle = it.cLedge; it.ledge.fill(ctx);
    }
    if (it.refl) { ctx.fillStyle = 'rgba(170,205,225,0.06)'; it.refl.fill(ctx); }
    ctx.fillStyle = it.cMetal; it.pipe.fill(ctx);
    if (it.ac.n) {
      ctx.fillStyle = it.cAc; it.ac.fill(ctx);
      if (us > 1.2) { ctx.fillStyle = 'rgba(0,0,0,0.42)'; it.acG.fill(ctx); }
    }
    if (it.feS.n) {
      ctx.fillStyle = it.cMetal; it.feS.fill(ctx);
      ctx.strokeStyle = it.cMetal; ctx.lineCap = 'butt';
      ctx.lineWidth = Math.max(PX * 0.8, u * 0.07); it.feL.stroke(ctx);
      if (us > 2.2) { ctx.lineWidth = Math.max(PX * 0.6, u * 0.035); it.feF.stroke(ctx); }
    }
    if (it.dent.n && us > 2.5) { ctx.fillStyle = 'rgba(0,0,0,0.3)'; it.dent.fill(ctx); }
    // volume: shaded side, falloff toward the street, rim light on the side facing the moon / sun
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    if (it.rimLeft) { ctx.fillRect(x + w - it.side, y, it.side, h); } else { ctx.fillRect(x, y, it.side, h); }
    ctx.save();
    ctx.translate(x, y + h * 0.45); ctx.scale(w, h * 0.55);
    ctx.fillStyle = grad('down'); ctx.fillRect(0, 0, 1, 1);
    ctx.restore();
    rw = Math.max(PX * 1.2, u * 0.12);
    ctx.fillStyle = it.cRim;
    ctx.fillRect(it.rimLeft ? x : x + w - rw, y, rw, h);
    drawRoof(ctx, it, t);
    if (it.sign) { drawSign(ctx, it, t); }
  }

  // Brick courses and staggered joints, only for the visible part of the facade at high zoom.
  function brickTex(ctx, it) {
    var u = it.u, bh = u * 0.075, bl = u * 0.215, x0 = Math.max(it.bx, VR.x0), x1 = Math.min(it.bx + it.bw, VR.x1);
    var y0 = Math.max(it.by, VR.y0), y1 = Math.min(it.by + it.bh, VR.y1), r0, r1, r, yy, off, xx, mt = Math.max(PX * 0.7, bh * 0.14);
    if (x1 <= x0 || y1 <= y0) { return; }
    r0 = Math.floor((y0 - it.by) / bh); r1 = Math.ceil((y1 - it.by) / bh);
    if ((r1 - r0) * ((x1 - x0) / bl + 1) > 2600) { return; }
    ctx.beginPath();
    for (r = r0; r < r1; r++) {
      yy = it.by + r * bh;
      ctx.rect(x0, yy, x1 - x0, mt);
      off = (r % 2) * bl * 0.5;
      for (xx = it.bx + off + Math.floor((x0 - it.bx - off) / bl) * bl; xx < x1; xx += bl) { ctx.rect(xx, yy, mt, bh); }
    }
    ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fill();
    ctx.beginPath();
    for (r = r0; r < r1; r++) {
      yy = it.by + r * bh; off = (r % 2) * bl * 0.5;
      for (xx = it.bx + off + Math.floor((x0 - it.bx - off) / bl) * bl; xx < x1; xx += bl) {
        if (hash2(Math.floor((xx - it.bx) / bl * 2) + it.seed, r) > 0.8) { ctx.rect(xx + mt, yy + mt, bl - mt, bh - mt); }
      }
    }
    ctx.fillStyle = 'rgba(255,190,150,0.05)'; ctx.fill();
  }

  // Lit rooms at high zoom: lamp glow, ceiling / floor shadow, curtains and furniture silhouettes.
  function interiors(ctx, it, t) {
    var G = it.gw, ww = G.ww, wh = G.wh, pass, r, c, v, wx, wy, sd, ty, sd2;
    var c0 = Math.max(0, Math.floor((VR.x0 - G.ox) / G.cw)), c1 = Math.min(G.cols - 1, Math.floor((VR.x1 - G.ox) / G.cw));
    var r0 = Math.max(0, Math.floor((VR.y0 - G.oy) / G.ch)), r1 = Math.min(G.rows - 1, Math.floor((VR.y1 - G.oy) / G.ch));
    if (c1 < c0 || r1 < r0 || (c1 - c0 + 1) * (r1 - r0 + 1) > 90) { return; }
    for (pass = 0; pass < 4; pass++) {
      ctx.beginPath();
      for (r = r0; r <= r1; r++) {
        for (c = c0; c <= c1; c++) {
          v = it.cells[r * G.cols + c];
          if (!v || v === 9) { continue; }
          wx = G.ox + c * G.cw; wy = G.oy + r * G.ch;
          sd = hash2(r + it.seed, c * 1.7); ty = Math.floor(sd * 6); sd2 = hash2(c + it.seed, r * 2.3);
          if (pass === 0) {
            ctx.moveTo(wx + ww * (0.3 + 0.4 * sd2) + wh * 0.34, wy + wh * 0.34);
            ctx.arc(wx + ww * (0.3 + 0.4 * sd2), wy + wh * 0.34, wh * 0.34, 0, TAU);
          } else if (pass === 1) {
            ctx.rect(wx, wy, ww, wh * 0.13); ctx.rect(wx, wy + wh * 0.84, ww, wh * 0.16);
          } else if (pass === 2) {
            if (ty === 0) {
              ctx.rect(wx + ww * 0.77, wy + wh * 0.36, ww * 0.025, wh * 0.64);
              ctx.moveTo(wx + ww * 0.71, wy + wh * 0.4); ctx.lineTo(wx + ww * 0.87, wy + wh * 0.4);
              ctx.lineTo(wx + ww * 0.83, wy + wh * 0.28); ctx.lineTo(wx + ww * 0.75, wy + wh * 0.28); ctx.closePath();
              ctx.rect(wx + ww * 0.1, wy + wh * 0.66, ww * 0.42, wh * 0.34); ctx.rect(wx + ww * 0.08, wy + wh * 0.52, ww * 0.1, wh * 0.48);
            } else if (ty === 1) {
              ctx.rect(wx + ww * 0.06, wy + wh * 0.18, ww * 0.06, wh * 0.82); ctx.rect(wx + ww * 0.34, wy + wh * 0.18, ww * 0.04, wh * 0.82);
              ctx.rect(wx + ww * 0.06, wy + wh * 0.18, ww * 0.32, wh * 0.04); ctx.rect(wx + ww * 0.06, wy + wh * 0.44, ww * 0.32, wh * 0.1);
              ctx.rect(wx + ww * 0.06, wy + wh * 0.7, ww * 0.32, wh * 0.1);
            } else if (ty === 2) {
              ctx.rect(wx + ww * 0.3, wy + wh * 0.68, ww * 0.46, wh * 0.05);
              ctx.rect(wx + ww * 0.33, wy + wh * 0.72, ww * 0.03, wh * 0.28); ctx.rect(wx + ww * 0.7, wy + wh * 0.72, ww * 0.03, wh * 0.28);
              ctx.rect(wx + ww * 0.18, wy + wh * 0.55, ww * 0.04, wh * 0.45); ctx.rect(wx + ww * 0.18, wy + wh * 0.75, ww * 0.12, wh * 0.04);
              ctx.moveTo(wx + ww * 0.6, wy + wh * 0.68); ctx.lineTo(wx + ww * 0.62, wy + wh * 0.6); ctx.lineTo(wx + ww * 0.65, wy + wh * 0.68); ctx.closePath();
            } else if (ty === 3) {
              ctx.rect(wx + ww * 0.74, wy + wh * 0.8, ww * 0.14, wh * 0.2);
              ctx.moveTo(wx + ww * 0.88, wy + wh * 0.7); ctx.arc(wx + ww * 0.81, wy + wh * 0.7, ww * 0.07, 0, TAU);
              ctx.moveTo(wx + ww * 0.83, wy + wh * 0.6); ctx.arc(wx + ww * 0.77, wy + wh * 0.6, ww * 0.06, 0, TAU);
              ctx.moveTo(wx + ww * 0.92, wy + wh * 0.58); ctx.arc(wx + ww * 0.86, wy + wh * 0.58, ww * 0.06, 0, TAU);
            } else if (ty === 4) {
              ctx.rect(wx + ww * 0.36, wy + wh * 0.24, ww * 0.26, wh * 0.03); ctx.rect(wx + ww * 0.36, wy + wh * 0.42, ww * 0.26, wh * 0.03);
              ctx.rect(wx + ww * 0.36, wy + wh * 0.24, ww * 0.025, wh * 0.21); ctx.rect(wx + ww * 0.595, wy + wh * 0.24, ww * 0.025, wh * 0.21);
              ctx.rect(wx, wy + wh * 0.72, ww * 0.72, wh * 0.28); ctx.rect(wx, wy + wh * 0.6, ww * 0.62, wh * 0.14);
            } else {
              ctx.rect(wx + ww * 0.495, wy, ww * 0.012, wh * 0.24);
              ctx.moveTo(wx + ww * 0.42, wy + wh * 0.3); ctx.lineTo(wx + ww * 0.58, wy + wh * 0.3);
              ctx.lineTo(wx + ww * 0.54, wy + wh * 0.22); ctx.lineTo(wx + ww * 0.46, wy + wh * 0.22); ctx.closePath();
            }
          } else if (sd2 > 0.45) {
            ctx.moveTo(wx, wy); ctx.lineTo(wx + ww * 0.22, wy); ctx.lineTo(wx + ww * 0.09, wy + wh * 0.62); ctx.lineTo(wx + ww * 0.13, wy + wh); ctx.lineTo(wx, wy + wh); ctx.closePath();
            ctx.moveTo(wx + ww, wy); ctx.lineTo(wx + ww * 0.78, wy); ctx.lineTo(wx + ww * 0.91, wy + wh * 0.62); ctx.lineTo(wx + ww * 0.87, wy + wh); ctx.lineTo(wx + ww, wy + wh); ctx.closePath();
          }
        }
      }
      ctx.fillStyle = pass === 0 ? 'rgba(255,232,180,0.22)' : pass === 1 ? 'rgba(0,0,0,0.22)' : pass === 2 ? 'rgba(18,10,7,0.8)' : 'rgba(92,30,24,0.55)';
      ctx.fill();
    }
  }

  // People moving about in far lit windows: a head-and-shoulders shadow drifting across the room.
  function occupants(ctx, it, t) {
    var i, o, vis, k, sw, px, hr, by;
    ctx.fillStyle = 'rgba(10,7,6,0.85)';
    for (i = 0; i < it.occ.length; i++) {
      o = it.occ[i];
      if (o.x + o.w < VR.x0 || o.x > VR.x1 || o.y + o.h < VR.y0 || o.y > VR.y1) { continue; }
      vis = Math.sin(t * o.rate * 0.31 + o.seed);
      if (vis <= 0) { continue; }
      ctx.globalAlpha = Math.min(1, vis * 3) * K.P.lightA;
      k = 0.5 + 0.5 * Math.sin(t * o.rate + o.seed * 1.3);
      sw = o.w * 0.3; hr = Math.min(o.h * 0.1, sw * 0.38);
      px = o.x + sw * 0.5 + (o.w - sw) * k; by = o.y + o.h;
      ctx.beginPath();
      ctx.moveTo(px + hr, o.y + o.h * 0.4); ctx.arc(px, o.y + o.h * 0.4, hr, 0, TAU);
      ctx.moveTo(px - sw * 0.5, by);
      ctx.lineTo(px - sw * 0.5, o.y + o.h * 0.62);
      ctx.quadraticCurveTo(px - sw * 0.5, o.y + o.h * 0.53, px, o.y + o.h * 0.53);
      ctx.quadraticCurveTo(px + sw * 0.5, o.y + o.h * 0.53, px + sw * 0.5, o.y + o.h * 0.62);
      ctx.lineTo(px + sw * 0.5, by);
      ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawRoof(ctx, it, t) {
    var x = it.bx, y = it.by, w = it.bw, u = it.u, rx = it.rx, us = u * SC, on, bh, by, i, lw, rs;
    ctx.fillStyle = it.cTrim;
    ctx.fillRect(x - u * 0.2, y - u * 0.7, w + u * 0.4, u * 0.7);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(x - u * 0.2, y - u * 0.16, w + u * 0.4, u * 0.16);
    ctx.fillStyle = it.cRim;
    ctx.fillRect(x - u * 0.2, y - u * 0.7, w + u * 0.4, Math.max(PX, u * 0.08));
    rs = it.rimLeft ? -1 : 1;
    ctx.fillStyle = it.cSil;
    if (it.roof === 'water-tower') {
      ctx.fillRect(rx - u * 1.8, y - u * 3.6, u * 0.22, u * 3.2);
      ctx.fillRect(rx + u * 1.58, y - u * 3.6, u * 0.22, u * 3.2);
      ctx.fillRect(rx - u * 0.6, y - u * 3.6, u * 0.18, u * 3.2);
      ctx.fillRect(rx + u * 0.45, y - u * 3.6, u * 0.18, u * 3.2);
      ctx.fillRect(rx - u * 2, y - u * 3.7, u * 4, u * 0.25);
      if (us > 1) {
        ctx.strokeStyle = it.cSil; ctx.lineWidth = Math.max(PX * 0.6, u * 0.07);
        ctx.beginPath();
        ctx.moveTo(rx - u * 1.7, y - u * 3.5); ctx.lineTo(rx - u * 0.5, y - u * 0.5);
        ctx.moveTo(rx - u * 0.5, y - u * 3.5); ctx.lineTo(rx - u * 1.7, y - u * 0.5);
        ctx.moveTo(rx + u * 1.7, y - u * 3.5); ctx.lineTo(rx + u * 0.5, y - u * 0.5);
        ctx.moveTo(rx + u * 0.5, y - u * 3.5); ctx.lineTo(rx + u * 1.7, y - u * 0.5);
        ctx.stroke();
      }
      ctx.fillRect(rx - u * 2, y - u * 7.8, u * 4, u * 4.2);
      ctx.beginPath();
      ctx.moveTo(rx - u * 2.3, y - u * 7.7); ctx.lineTo(rx, y - u * 9.6); ctx.lineTo(rx + u * 2.3, y - u * 7.7);
      ctx.closePath(); ctx.fill();
      ctx.fillRect(rx - u * 0.08, y - u * 9.9, u * 0.16, u * 0.4);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(rx - u * 2, y - u * 6.6, u * 4, u * 0.18);
      ctx.fillRect(rx - u * 2, y - u * 4.8, u * 4, u * 0.18);
      if (us > 2.5) {
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        for (i = 1; i < 8; i++) { ctx.fillRect(rx - u * 2 + i * u * 0.5, y - u * 7.8, Math.max(PX * 0.6, u * 0.04), u * 4.2); }
        ctx.fillStyle = it.cSil;
        ctx.fillRect(rx + rs * u * 1.4, y - u * 7.6, u * 0.08, u * 4);
      }
      ctx.fillStyle = it.cRim;
      ctx.fillRect(rs < 0 ? rx - u * 2 : rx + u * 2 - Math.max(PX, u * 0.15), y - u * 7.8, Math.max(PX, u * 0.15), u * 4.2);
      ctx.beginPath();
      ctx.moveTo(rs < 0 ? rx - u * 2.3 : rx + u * 2.3, y - u * 7.7); ctx.lineTo(rx, y - u * 9.6);
      ctx.lineWidth = Math.max(PX, u * 0.1); ctx.strokeStyle = it.cRim; ctx.stroke();
    } else if (it.roof === 'antenna') {
      ctx.fillRect(rx - u * 0.12, y - u * 13, u * 0.24, u * 12.5);
      ctx.fillRect(rx - u * 1.1, y - u * 5, u * 2.2, u * 0.16);
      ctx.fillRect(rx - u * 0.7, y - u * 9, u * 1.4, u * 0.16);
      ctx.fillRect(rx - u * 0.45, y - u * 11.4, u * 0.9, u * 0.12);
      if (us > 0.8) {
        ctx.strokeStyle = it.cSil; ctx.lineWidth = Math.max(PX * 0.5, u * 0.03);
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.moveTo(rx, y - u * 12.5); ctx.lineTo(rx - u * 5, y - u * 0.6);
        ctx.moveTo(rx, y - u * 12.5); ctx.lineTo(rx + u * 5, y - u * 0.6);
        ctx.moveTo(rx, y - u * 8); ctx.lineTo(rx - u * 3.2, y - u * 0.6);
        ctx.moveTo(rx, y - u * 8); ctx.lineTo(rx + u * 3.2, y - u * 0.6);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      on = ((t * 0.7 + it.seed) % 1.4) < 0.7;
      if (on) {
        glowHalo(ctx, '#ff4a3c', rx, y - u * 13.2, u * 1.6, u * 1.6, 0.6);
        ctx.fillStyle = '#ff4a3c';
        ctx.beginPath(); ctx.arc(rx, y - u * 13.2, Math.max(u * 0.3, PX * 1.2), 0, TAU); ctx.fill();
      }
    } else if (it.roof === 'neon') {
      bh = Math.min(u * 4, w * 0.2); by = y - u * 1.6 - bh;
      ctx.fillRect(x + w * 0.22, by, u * 0.2, u * 1.6 + bh);
      ctx.fillRect(x + w * 0.78 - u * 0.2, by, u * 0.2, u * 1.6 + bh);
      if (us > 1.2) {
        ctx.strokeStyle = it.cSil; ctx.lineWidth = Math.max(PX * 0.6, u * 0.06);
        ctx.beginPath();
        ctx.moveTo(x + w * 0.22, by + bh); ctx.lineTo(x + w * 0.22 + u * 1.6, y - u * 0.6);
        ctx.moveTo(x + w * 0.78, by + bh); ctx.lineTo(x + w * 0.78 - u * 1.6, y - u * 0.6);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(8,8,10,0.85)';
      ctx.fillRect(x + w * 0.15, by, w * 0.7, bh);
      on = neonOn(t, it.seed);
      if (on) { glowHalo(ctx, it.neonC, x + w * 0.5, y + u * 1.5, w * 0.55, u * 6, 0.22 * K.P.lampK + 0.08); }
      if (it.sign) {
        neonText(ctx, it, it.sign, x + w * 0.5, by + bh * 0.54, w * 0.64, bh * 0.82, on);
      } else if (on) {
        lw = Math.max(PX, bh * 0.08);
        ctx.strokeStyle = it.neonC; ctx.lineWidth = lw;
        ctx.strokeRect(x + w * 0.17, by + bh * 0.15, w * 0.66, bh * 0.7);
      }
    }
  }

  function neonOn(t, seed) {
    return !(hash1(Math.floor(t * 9) + seed * 13) < 0.06 || Math.sin(t * 0.37 + seed) > 0.985);
  }

  // Fit text into maxW x maxH (world units). Size measured once per item and cached.
  function fitSize(ctx, it, text, maxW, maxH) {
    if (it.fit === undefined) {
      ctx.font = 'bold 100px ' + FONT;
      var mw = ctx.measureText(text).width || (text.length * 55);
      it.fit = 100 / mw;
    }
    return Math.max(0.5, Math.min(maxH, maxW * it.fit));
  }

  // Soft light halo from a cached unit radial gradient (no shadowBlur).
  function glowHalo(ctx, col, cx, cy, rx, ry, a) {
    if (a <= 0.003 || rx <= 0 || ry <= 0) { return; }
    ctx.save();
    ctx.translate(cx, cy); ctx.scale(rx, ry);
    ctx.globalAlpha = clamp(a, 0, 1); ctx.fillStyle = glowGrad(col);
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
  }

  // Neon text: halo, a wide translucent stroke, then the tube core with one shadowBlur. Close up the
  // letters become outlined tubes with a hot white centre. Off = dead dark tubes.
  function neonText(ctx, it, text, cx, cy, maxW, maxH, on) {
    var size = fitSize(ctx, it, text, maxW, maxH), spx = size * SC;
    ctx.font = 'bold ' + size + 'px ' + FONT;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    if (on) {
      glowHalo(ctx, it.neonC, cx, cy, maxW * 0.72, maxH * 1.5, 0.5);
      ctx.globalAlpha = 0.3;
      ctx.strokeStyle = it.neonC; ctx.lineWidth = size * 0.26;
      ctx.strokeText(text, cx, cy);
      ctx.globalAlpha = 1;
      ctx.shadowColor = it.neonC; ctx.shadowBlur = clamp(spx * 0.3, 2, 18);
      if (spx > 26) {
        ctx.strokeStyle = it.neonC; ctx.lineWidth = size * 0.075; ctx.strokeText(text, cx, cy);
        ctx.shadowBlur = 0; ctx.shadowColor = 'rgba(0,0,0,0)';
        ctx.strokeStyle = 'rgba(255,246,232,0.85)'; ctx.lineWidth = size * 0.022; ctx.strokeText(text, cx, cy);
      } else {
        ctx.fillStyle = it.neonC; ctx.fillText(text, cx, cy);
        ctx.shadowBlur = 0; ctx.shadowColor = 'rgba(0,0,0,0)';
      }
    } else {
      ctx.fillStyle = 'rgba(50,38,38,0.9)'; ctx.fillText(text, cx, cy);
    }
  }

  // Vertical blade sign hanging off the facade (used when the roof is not 'neon').
  function drawSign(ctx, it, t) {
    if (it.roof === 'neon') { return; }
    var u = it.u, txt = it.sign, n = Math.min(txt.length, 12), i, on, ls, bw, bx, by, bh, ch, cy;
    ls = Math.min(u * 2.2, (it.bh * 0.75) / Math.max(1, n));
    bw = ls * 1.3; bx = it.signX; by = it.by + u * 1.5; bh = ls * n + ls * 0.4;
    on = neonOn(t, it.seed);
    if (on) { glowHalo(ctx, it.neonC, bx + bw / 2, by + bh / 2, bw * 2.4, bh * 0.75, 0.38); }
    ctx.fillStyle = it.cMetal;
    ctx.fillRect(bx - u * 0.5, by + ls * 0.3, u * 0.5, Math.max(PX, u * 0.12));
    ctx.fillRect(bx - u * 0.5, by + bh - ls * 0.4, u * 0.5, Math.max(PX, u * 0.12));
    ctx.fillStyle = 'rgba(8,8,10,0.92)';
    ctx.fillRect(bx, by, bw, bh);
    if (on) {
      ctx.strokeStyle = it.neonC; ctx.globalAlpha = 0.8; ctx.lineWidth = Math.max(PX, ls * 0.05);
      ctx.strokeRect(bx + ls * 0.08, by + ls * 0.08, bw - ls * 0.16, bh - ls * 0.16);
      ctx.globalAlpha = 1;
    }
    ctx.font = 'bold ' + (ls * 0.92) + 'px ' + FONT;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    for (i = 0; i < n; i++) {
      ch = txt.charAt(i); cy = by + ls * 0.2 + ls * (i + 0.55);
      if (on && hash1(i * 7 + Math.floor(t * 4) + it.seed) > 0.03) {
        ctx.globalAlpha = 0.3; ctx.strokeStyle = it.neonC; ctx.lineWidth = ls * 0.25;
        ctx.strokeText(ch, bx + bw / 2, cy);
        ctx.globalAlpha = 1; ctx.fillStyle = it.neonC; ctx.fillText(ch, bx + bw / 2, cy);
      } else {
        ctx.fillStyle = 'rgba(50,38,38,0.9)'; ctx.fillText(ch, bx + bw / 2, cy);
      }
    }
  }

  // ---------- walls, ground, water ----------

  BUILD.wall = function (it, s, rnd) {
    var d = it.d, u = it.u, P = K.P, i, n, sx, cy;
    it.bx = num(s.x, 0); it.by = num(s.y, 900); it.bw = Math.max(1, num(s.w, 100)); it.bh = Math.max(1, num(s.h, 20));
    it.c = hz('#262a2f', d, P.wallK); it.cTop = hz('#4c525a', d, P.wallK); it.cRim = rimCol(d, 0.4);
    it.ct = Math.min(it.bh * 0.16, u * 0.25);
    it.stains = new Batch(); it.seams = new Batch(); it.cop = new Batch(); it.crack = new Batch();
    n = Math.min(60, Math.floor(it.bw / (u * 2.5)));
    for (i = 0; i < n; i++) {
      sx = it.bx + rnd() * it.bw;
      it.stains.rect(sx, it.by + it.bh * 0.12, u * (0.15 + rnd() * 0.6), it.bh * (0.25 + rnd() * 0.75));
    }
    if (u * 3 < it.bw) {
      for (sx = it.bx + u * 3; sx < it.bx + it.bw && it.seams.n < 1000; sx += u * 3) { it.seams.rect(sx, it.by, Math.max(0.3, u * 0.05), it.bh); }
    }
    for (sx = it.bx + rnd() * u; sx < it.bx + it.bw && it.cop.n < 1500; sx += u * (0.9 + rnd() * 0.5)) { it.cop.rect(sx, it.by, Math.max(0.2, u * 0.03), it.ct); }
    n = Math.min(40, Math.floor(it.bw / (u * 6)));
    for (i = 0; i < n; i++) {
      sx = it.bx + rnd() * it.bw; cy = it.by + it.ct + rnd() * it.bh * 0.5;
      it.crack.line(sx, cy, sx + (rnd() - 0.5) * u * 0.6, cy + u * (0.2 + rnd() * 0.4));
      it.crack.line(sx, cy, sx + (rnd() - 0.5) * u * 0.5, cy + u * (0.1 + rnd() * 0.3));
    }
    it.x0 = it.bx; it.x1 = it.bx + it.bw; it.y0 = it.by - u * 0.2; it.y1 = it.by + it.bh;
    it.fn = dWall;
  };

  function dWall(ctx, it) {
    var x = it.bx, y = it.by, w = it.bw, h = it.bh, ct = Math.max(PX, it.ct), us = it.u * SC, P = K.P;
    ctx.fillStyle = it.c; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; it.stains.fill(ctx); it.seams.fill(ctx);
    if (us > 3) { ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = Math.max(PX * 0.7, it.u * 0.015); ctx.lineCap = 'round'; it.crack.stroke(ctx); }
    ctx.fillStyle = it.cTop; ctx.fillRect(x, y, w, ct);
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x, y + ct, w, Math.min(h - ct, ct * 0.5));
    if (us > 1.5) { ctx.fillStyle = 'rgba(0,0,0,0.3)'; it.cop.fill(ctx); }
    if (P.wet > 0.5) { ctx.fillStyle = 'rgba(170,190,210,' + (0.1 * P.wet) + ')'; ctx.fillRect(x, y, w, ct * 0.45); }
    ctx.fillStyle = it.cRim; ctx.fillRect(x, y, w, Math.max(PX, ct * 0.3));
  }

  var GROUND = {
    street: { c: '#15181c', top: '#2b2f34' },
    dock: { c: '#28221e', top: '#3a322b' },
    rooftop: { c: '#212429', top: '#3b3f45' },
    park: { c: '#151e1a', top: '#22302a' }
  };

  BUILD.ground = function (it, s, rnd) {
    var d = it.d, u = it.u, P = K.P, W = K.W, y = num(s.y, 800), kind = GROUND[s.kind] ? s.kind : 'street';
    var G = GROUND[kind], x, yy, n, i, j, gap, sl, vpx = W / 2, mx, my, rx, ry, cx, f, yb, px;
    it.gy = y; it.kind = kind; it.refl = []; it.pud = []; it.steam = [];
    it.cA = hzA(G.c, d, P.wallK);
    it.c = css(it.cA); it.cTop = hz(G.top, d, P.wallK); it.cRim = rimCol(d, 0.3);
    it.cSil = hz('#0f1216', d, P.wallK); it.cPaint = hz('#cfc8b4', d); it.cCurb = hz('#50565d', d, P.wallK);
    it.cPud = css(mix(mix(it.cA, rgb(P.sky[P.sky.length - 1][1]), 0.55), K.haze, 0.2));
    it.det = new Batch(); it.det2 = new Batch(); it.lane = new Batch(); it.slab = new Batch(); it.mh = new Batch(); it.mhL = new Batch();
    it.prop = new Batch(); it.propRim = new Batch(); it.crack = new Batch(); it.drain = new Batch(); it.pudB = new Batch(); it.shad = new Batch();
    it.sw = 0; it.roadY = y; it.curbY = y;
    if (kind === 'street') {
      it.sw = u * 2.4; it.curbY = y + it.sw; it.roadY = it.curbY + u * 0.45;
      // sidewalk slabs, gently fanned around the world centre for a perspective feel
      for (x = rnd() * u * 1.8; x < W && it.slab.n < 3000; x += u * 1.8) {
        sl = clamp((x - vpx) * 0.05, -u * 0.9, u * 0.9);
        it.slab.line(x, y + u * 0.2, x + sl, it.curbY - u * 0.1);
      }
      it.slab.line(-500, y + it.sw * 0.45, W + 500, y + it.sw * 0.45);
      // lane paint: thin far centre dashes, bigger near lane dashes, solid edge line by the curb
      for (x = rnd() * u * 6; x < W && it.lane.n < 2000; x += u * 9) {
        sl = clamp((x - vpx) * 0.004, -u * 0.3, u * 0.3); yy = it.roadY + u * 3.4;
        it.lane.quad(x, yy, x + u * 3, yy, x + u * 3.08 + sl, yy + u * 0.16, x - u * 0.08 + sl, yy + u * 0.16);
      }
      for (x = rnd() * u * 8; x < W && it.lane.n < 4000; x += u * 12) {
        sl = clamp((x - vpx) * 0.008, -u * 0.5, u * 0.5); yy = it.roadY + u * 8.4;
        it.lane.quad(x, yy, x + u * 4.2, yy, x + u * 4.35 + sl, yy + u * 0.34, x - u * 0.15 + sl, yy + u * 0.34);
      }
      it.lane.rect(-500, it.roadY + u * 0.55, W + 1000, Math.max(0.3, u * 0.07));
      // crosswalks: stripes that widen and fan out toward the viewer
      n = Math.max(1, Math.floor(W / 1500));
      for (i = 0; i < n; i++) {
        cx = W * ((i + 0.3 + rnd() * 0.4) / n); yb = it.roadY + u * 11;
        sl = clamp((cx - vpx) * 0.06, -u * 3, u * 3);
        for (j = 0; j < 8; j++) {
          f = (j - 3.5) * u * 1.15;
          it.lane.quad(cx + f, it.roadY + u * 0.9, cx + f + u * 0.6, it.roadY + u * 0.9,
            cx + (f + u * 0.6) * 1.35 + sl, yb, cx + f * 1.35 + sl, yb);
        }
      }
      // manhole covers (some steaming) and storm drains at the curb
      n = Math.min(12, Math.max(1, Math.floor(W / (u * 40))));
      for (i = 0; i < n; i++) {
        mx = u * 3 + rnd() * (W - u * 6); my = it.roadY + u * (1.5 + rnd() * 6);
        rx = u * (0.62 + (my - it.roadY) / u * 0.03); ry = rx * 0.28;
        it.mh.ell(mx, my, rx, ry);
        it.mhL.ell(mx, my, rx * 0.78, ry * 0.78);
        it.mhL.line(mx - rx * 0.6, my, mx + rx * 0.6, my);
        it.mhL.line(mx - rx * 0.45, my - ry * 0.45, mx + rx * 0.45, my - ry * 0.45);
        it.mhL.line(mx - rx * 0.45, my + ry * 0.45, mx + rx * 0.45, my + ry * 0.45);
        if (rnd() < 0.45) { it.steam.push({ x: mx, y: my, s: rnd() * 10 }); }
      }
      n = Math.min(40, Math.floor(W / (u * 30)));
      for (i = 0; i < n; i++) {
        mx = rnd() * W;
        it.drain.rect(mx, it.curbY + u * 0.06, u * 1.1, u * 0.26);
        for (j = 1; j < 6; j++) { it.mhL.line(mx + j * u * 0.18, it.curbY + u * 0.08, mx + j * u * 0.18, it.curbY + u * 0.3); }
      }
      // puddles and cracks
      n = Math.min(40, Math.floor(W / (u * 16)));
      for (i = 0; i < n; i++) {
        px = rnd() * W; yy = it.roadY + u * (0.6 + rnd() * 7.5);
        rx = u * (0.8 + rnd() * 2.6) * (1 + (yy - it.roadY) / u * 0.04); ry = rx * (0.11 + rnd() * 0.06);
        it.pudB.ell(px, yy, rx, ry); it.pud.push({ x: px, y: yy, rx: rx, ry: ry, s: rnd() * 50 });
      }
      n = Math.min(70, Math.floor(W / (u * 8)));
      for (i = 0; i < n; i++) {
        px = rnd() * W; yy = it.roadY + u * (0.4 + rnd() * 9);
        mx = px + (rnd() - 0.5) * u * 1.5; my = yy + (rnd() - 0.3) * u * 0.3;
        it.crack.line(px, yy, mx, my);
        it.crack.line(mx, my, mx + (rnd() - 0.5) * u, my + (rnd() - 0.4) * u * 0.25);
      }
      streetProps(it, rnd);
    } else if (kind === 'dock') {
      gap = u * 0.32;
      for (yy = y + gap; yy < 1000 && it.det.n < 1000; yy += gap) { it.det.rect(-500, yy, W + 1000, Math.max(0.3, u * 0.05)); gap *= 1.04; }
      n = Math.min(300, Math.floor(W / u));
      for (i = 0; i < n; i++) { yy = y + rnd() * Math.min(1000 - y, u * 14); it.det.rect(rnd() * W, yy, Math.max(0.3, u * 0.05), u * 0.3); }
      for (x = u * 4 + rnd() * u * 8; x < W && it.det2.n < 1200; x += u * (8 + rnd() * 10)) {
        it.det2.rect(x, y - u * 0.55, u * 0.42, u * 0.65);
        it.det2.ell(x + u * 0.21, y - u * 0.58, u * 0.32, u * 0.1);
        if (rnd() < 0.3) { it.det2.ell(x + u * 1.3, y + u * 0.25, u * 0.55, u * 0.14); }
      }
      n = Math.min(30, Math.floor(W / (u * 20)));
      for (i = 0; i < n; i++) {
        px = rnd() * W; yy = y + u * (0.8 + rnd() * 6);
        rx = u * (1 + rnd() * 2.4); ry = rx * 0.13;
        it.pudB.ell(px, yy, rx, ry); it.pud.push({ x: px, y: yy, rx: rx, ry: ry, s: rnd() * 50 });
      }
    } else if (kind === 'rooftop') {
      n = Math.min(900, Math.floor(W * Math.min(1000 - y, u * 20) / (u * u * 1.2)));
      for (i = 0; i < n; i++) { it.det.rect(rnd() * W, y + Math.pow(rnd(), 1.4) * Math.min(1000 - y, u * 20), u * 0.09, u * 0.07); }
      for (yy = y + u * 1.5; yy < Math.min(1000, y + u * 22) && it.slab.n < 40; yy += u * (1.5 + (yy - y) / u * 0.15)) { it.slab.line(-500, yy, W + 500, yy); }
      for (x = rnd() * u * 20; x < W && it.det2.n < 600; x += u * (15 + rnd() * 30)) {
        f = rnd();
        if (f < 0.4) { it.det2.rect(x, y - u * 0.8, u * (0.8 + rnd() * 1.5), u * 0.9); }
        else if (f < 0.7) { it.det2.rect(x, y - u * 1.4, u * 0.18, u * 1.5); it.det2.rect(x - u * 0.15, y - u * 1.5, u * 0.48, u * 0.18); }
        else { it.det2.quad(x, y + u * 0.6, x + u * 2.4, y + u * 0.6, x + u * 2.6, y + u * 1.2, x - u * 0.2, y + u * 1.2); it.prop.rect(x + u * 0.1, y + u * 0.68, u * 2.2, u * 0.44); }
      }
      n = Math.min(30, Math.floor(W / (u * 18)));
      for (i = 0; i < n; i++) {
        px = rnd() * W; yy = y + u * (1 + rnd() * 8);
        rx = u * (0.8 + rnd() * 2); ry = rx * 0.14;
        it.pudB.ell(px, yy, rx, ry); it.pud.push({ x: px, y: yy, rx: rx, ry: ry, s: rnd() * 50 });
      }
    } else {
      for (x = 0; x < W && it.det.n < 4000; x += u * (0.3 + rnd() * 0.4)) { it.det.rect(x, y - u * (0.1 + rnd() * 0.25), Math.max(0.3, u * 0.05), u * 0.4); }
      n = Math.min(60, Math.floor(W / (u * 12)));
      for (i = 0; i < n; i++) { it.det2.ell(rnd() * W, y + u * 0.1, u * (0.8 + rnd() * 1.6), u * (0.5 + rnd() * 0.6)); }
      it.lane.rect(-500, y + u * 2.2, W + 1000, u * 1.2);
      n = Math.min(14, Math.floor(W / (u * 40)));
      for (i = 0; i < n; i++) {
        px = rnd() * W; yy = y + u * 1.9;
        it.prop.rect(px, yy - u * 0.9, u * 1.8, u * 0.12); it.prop.rect(px, yy - u * 0.5, u * 1.8, u * 0.14);
        it.prop.rect(px + u * 0.1, yy - u * 0.5, u * 0.1, u * 0.5); it.prop.rect(px + u * 1.6, yy - u * 0.5, u * 0.1, u * 0.5);
      }
    }
    it.y0 = y - u * 3; it.y1 = 1000;
    it.fn = dGround;
  };

  // Sidewalk furniture standing near the back of the sidewalk: hydrants, bins, news boxes, bollards, sign poles.
  function streetProps(it, rnd) {
    var u = it.u, W = K.W, n = Math.min(30, Math.floor(W / (u * 14))), i, px, base, k, rs, rw = Math.max(0.2, u * 0.05);
    for (i = 0; i < n; i++) {
      px = u + rnd() * (W - u * 2); base = it.gy + it.sw * (0.22 + rnd() * 0.18); k = rnd();
      rs = K.keyX < px ? -1 : 1;
      it.shad.ell(px, base, u * 0.45, u * 0.08);
      if (k < 0.25) {
        it.prop.rect(px - u * 0.14, base - u * 0.62, u * 0.28, u * 0.62);
        it.prop.rect(px - u * 0.2, base - u * 0.08, u * 0.4, u * 0.08);
        it.prop.rect(px - u * 0.26, base - u * 0.46, u * 0.52, u * 0.11);
        it.prop.circ(px, base - u * 0.64, u * 0.14);
        it.propRim.rect(rs > 0 ? px + u * 0.14 - rw : px - u * 0.14, base - u * 0.7, rw, u * 0.62);
      } else if (k < 0.5) {
        it.prop.quad(px - u * 0.32, base - u * 0.92, px + u * 0.32, base - u * 0.92, px + u * 0.26, base, px - u * 0.26, base);
        it.prop.rect(px - u * 0.36, base - u * 1.0, u * 0.72, u * 0.1);
        it.propRim.rect(rs > 0 ? px + u * 0.3 - rw : px - u * 0.3, base - u * 0.9, rw, u * 0.85);
        it.propRim.rect(px - u * 0.36, base - u * 1.0, u * 0.72, rw);
      } else if (k < 0.68) {
        it.prop.rect(px - u * 0.28, base - u * 1.05, u * 0.56, u * 0.75);
        it.prop.rect(px - u * 0.22, base - u * 0.3, u * 0.06, u * 0.3);
        it.prop.rect(px + u * 0.16, base - u * 0.3, u * 0.06, u * 0.3);
        it.propRim.rect(px - u * 0.28, base - u * 1.05, u * 0.56, rw);
      } else if (k < 0.85) {
        it.prop.rect(px - u * 0.09, base - u * 0.85, u * 0.18, u * 0.85);
        it.prop.circ(px, base - u * 0.85, u * 0.09);
        it.propRim.rect(rs > 0 ? px + u * 0.09 - rw : px - u * 0.09, base - u * 0.85, rw, u * 0.8);
      } else {
        it.prop.rect(px - u * 0.04, base - u * 2.6, u * 0.08, u * 2.6);
        it.prop.rect(px - u * 0.3, base - u * 2.7, u * 0.6, u * 0.45);
        it.propRim.rect(px - u * 0.3, base - u * 2.7, u * 0.6, rw);
      }
    }
  }

  function roadGrad(it) {
    var key = 'road' + it.i, g = K.g[key], c = it.cA;
    if (g) { return g; }
    g = K.gctx.createLinearGradient(0, it.roadY, 0, it.roadY + it.u * 14);
    g.addColorStop(0, css(mul(c, 0.7)));
    g.addColorStop(0.35, css(c));
    g.addColorStop(1, css(mix(c, K.haze, 0.18)));
    K.g[key] = g;
    return g;
  }

  function dGround(ctx, it, t) {
    var y = it.gy, u = it.u, P = K.P, x0 = VR.x0 - 2, w = VR.x1 - VR.x0 + 4, us = u * SC;
    ctx.fillStyle = it.c; ctx.fillRect(x0, y, w, 1000 - y + 2);
    if (it.kind === 'street') {
      ctx.fillStyle = roadGrad(it); ctx.fillRect(x0, it.roadY, w, 1000 - it.roadY + 2);
      ctx.fillStyle = it.cTop; ctx.fillRect(x0, y, w, it.sw);
      ctx.fillStyle = 'rgba(0,0,0,0.38)'; ctx.fillRect(x0, y, w, u * 0.32);
      ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(x0, y + u * 0.32, w, u * 0.4);
      if (us > 0.8) { ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = Math.max(PX * 0.7, u * 0.04); ctx.lineCap = 'butt'; it.slab.stroke(ctx); }
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; it.shad.fill(ctx);
      ctx.fillStyle = it.cSil; it.prop.fill(ctx);
      ctx.fillStyle = it.cRim; it.propRim.fill(ctx);
      ctx.fillStyle = it.cCurb; ctx.fillRect(x0, it.curbY - u * 0.12, w, u * 0.16);
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(x0, it.curbY + u * 0.04, w, u * 0.3);
      ctx.fillStyle = it.cRim; ctx.fillRect(x0, it.curbY - u * 0.12, w, Math.max(PX * 0.7, u * 0.035));
      ctx.fillStyle = css(AMBER, 0.1 * P.wet); ctx.fillRect(x0, it.curbY + u * 0.34, w, u * 0.06);
      ctx.fillStyle = 'rgba(0,0,0,0.65)'; it.drain.fill(ctx);
      ctx.globalAlpha = 0.3 + 0.45 * P.wet; ctx.fillStyle = it.cPud; it.pudB.fill(ctx); ctx.globalAlpha = 1;
      drawRefl(ctx, it, t, P.wet * 0.9);
      ctx.globalAlpha = 0.45; ctx.fillStyle = it.cPaint; it.lane.fill(ctx); ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; it.mh.fill(ctx);
      if (us > 1.2) { ctx.strokeStyle = 'rgba(125,130,136,0.32)'; ctx.lineWidth = Math.max(PX * 0.6, u * 0.045); it.mhL.stroke(ctx); }
      if (us > 2) { ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = Math.max(PX * 0.6, u * 0.025); it.crack.stroke(ctx); }
      if (P.rain >= 0.5 && us > 1.2) { ripples(ctx, it, t); }
      if (it.steam.length) { steam(ctx, it, t); }
    } else if (it.kind === 'dock') {
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; it.det.fill(ctx);
      ctx.globalAlpha = 0.25 + 0.4 * P.wet; ctx.fillStyle = it.cPud; it.pudB.fill(ctx); ctx.globalAlpha = 1;
      drawRefl(ctx, it, t, P.wet * 0.6);
      ctx.fillStyle = it.cTop; ctx.fillRect(x0, y, w, Math.max(PX, u * 0.25));
      ctx.fillStyle = hz('#141210', it.d); it.det2.fill(ctx);
      if (P.rain >= 0.5 && us > 1.2) { ripples(ctx, it, t); }
    } else if (it.kind === 'rooftop') {
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; it.det.fill(ctx);
      if (us > 0.8) { ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = Math.max(PX * 0.7, u * 0.05); it.slab.stroke(ctx); }
      ctx.globalAlpha = 0.25 + 0.4 * P.wet; ctx.fillStyle = it.cPud; it.pudB.fill(ctx); ctx.globalAlpha = 1;
      drawRefl(ctx, it, t, P.wet * 0.5);
      ctx.fillStyle = it.cTop; ctx.fillRect(x0, y, w, Math.max(PX, u * 0.3));
      ctx.fillStyle = hz('#1a1d21', it.d); it.det2.fill(ctx);
      ctx.fillStyle = 'rgba(120,150,170,0.12)'; it.prop.fill(ctx);
      if (P.rain >= 0.5 && us > 1.2) { ripples(ctx, it, t); }
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; it.lane.fill(ctx);
      ctx.fillStyle = it.cTop; it.det.fill(ctx);
      ctx.fillStyle = hz('#0f1713', it.d); it.det2.fill(ctx);
      ctx.fillStyle = it.cSil; it.prop.fill(ctx);
    }
    if (it.kind !== 'street') { ctx.fillStyle = it.cRim; ctx.fillRect(x0, y, w, Math.max(PX * 0.8, u * 0.05)); }
  }

  // Vertical light streaks on wet surfaces, three fading bands, gently wobbling.
  function drawRefl(ctx, g, t, base) {
    var i, k, e;
    if (!g.refl || !g.refl.length || base <= 0.01) { return; }
    for (k = 0; k < 3; k++) {
      ctx.save();
      ctx.translate(Math.sin(t * (0.9 + k * 0.4) + k + g.i) * g.u * 0.1 * (k + 1), 0);
      for (i = 0; i < g.refl.length; i++) {
        e = g.refl[i];
        ctx.globalAlpha = clamp(base * (k === 0 ? 0.5 : k === 1 ? 0.3 : 0.15) * (0.85 + 0.15 * Math.sin(t * 2.3 + i * 1.7 + k)), 0, 1);
        ctx.fillStyle = e.c; e.b[k].fill(ctx);
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  // Rain rings on puddles.
  function ripples(ctx, it, t) {
    var i, p, k, ph, cyc, f, ox, oy, r, n = 0;
    ctx.strokeStyle = 'rgba(190,206,218,0.3)'; ctx.lineWidth = Math.max(PX * 0.7, it.u * 0.022);
    ctx.beginPath();
    for (i = 0; i < it.pud.length && n < 60; i++) {
      p = it.pud[i];
      if (p.x + p.rx < VR.x0 || p.x - p.rx > VR.x1 || p.y + p.ry < VR.y0 || p.y - p.ry > VR.y1) { continue; }
      for (k = 0; k < 3; k++) {
        ph = t * 1.5 + p.s + k * 0.37; cyc = Math.floor(ph); f = ph - cyc;
        ox = (hash2(cyc, p.s + k) - 0.5) * p.rx * 1.3; oy = (hash2(p.s + k, cyc) - 0.5) * p.ry * 1.1;
        r = (0.15 + f) * p.ry * 1.1;
        ctx.moveTo(p.x + ox + r * 3.4, p.y + oy); ctx.ellipse(p.x + ox, p.y + oy, r * 3.4, r, 0, 0, TAU);
        n++;
      }
    }
    if (n) { ctx.stroke(); }
  }

  // Steam rising from manholes.
  function steam(ctx, it, t) {
    var u = it.u, i, s, k, f, r, cx, cy;
    ctx.fillStyle = K.P.fog ? 'rgb(200,206,208)' : 'rgb(160,170,180)';
    for (i = 0; i < it.steam.length; i++) {
      s = it.steam[i];
      if (s.x + u * 4 < VR.x0 || s.x - u * 4 > VR.x1 || s.y < VR.y0 || s.y - u * 7 > VR.y1) { continue; }
      for (k = 0; k < 4; k++) {
        f = (t * 0.22 + s.s + k * 0.25) % 1;
        r = u * (0.4 + f * 1.7);
        cx = s.x + Math.sin(t * 0.6 + k + s.s) * u * 0.5 * f + f * u * 0.9;
        cy = s.y - f * u * 5.5;
        ctx.globalAlpha = 0.13 * (1 - f) * (f < 0.15 ? f / 0.15 : 1);
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  BUILD.water = function (it, s, rnd) {
    var d = it.d, u = it.u, W = K.W, y = num(s.y, 800), i, b, yy, f;
    it.gy = y; it.roadY = y;
    it.c = hz('#0a1117', d); it.cTop = hz('#2c3b46', d);
    it.st = [new Batch(), new Batch(), new Batch()];
    it.stC = [css(rgb('#7fa3b8')), css(rgb('#e8a33d')), css(rgb('#c9d6dc'))];
    for (i = 0; i < 420; i++) {
      b = i % 3;
      f = Math.pow(rnd(), 1.6);
      yy = y + u * 0.3 + f * (1000 - y);
      it.st[b].rect(rnd() * (W + 200) - 100, yy, u * (1 + rnd() * 5) * (1 + f * 3), Math.max(0.3, u * 0.07 * (1 + f * 2)));
    }
    it.foam = new Batch();
    for (yy = rnd() * u; yy < W && it.foam.n < 800; yy += u * (0.8 + rnd() * 2)) { it.foam.rect(yy, y + u * 0.12, u * (0.4 + rnd() * 1.5), Math.max(0.3, u * 0.06)); }
    it.y0 = y - 1; it.y1 = 1000;
    it.fn = dWater;
  };

  function dWater(ctx, it, t) {
    var y = it.gy, x0 = VR.x0 - 2, w = VR.x1 - VR.x0 + 4, b, a, P = K.P, i, ph, cyc, f, px, py, r, n;
    ctx.fillStyle = it.c; ctx.fillRect(x0, y, w, 1000 - y + 2);
    ctx.save();
    ctx.translate(0, y); ctx.scale(1, 1000 - y);
    ctx.fillStyle = grad('waterSheen'); ctx.fillRect(x0, 0, w, 1);
    ctx.restore();
    drawRefl(ctx, it, t, 0.75);
    for (b = 0; b < 3; b++) {
      a = 0.09 + 0.07 * Math.sin(t * 1.3 + b * 2.1);
      if (b === 1) { a *= P.lampK; }
      ctx.save();
      ctx.translate(Math.sin(t * 0.45 + b * 1.7) * it.u * 0.8, 0);
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = it.stC[b]; it.st[b].fill(ctx);
      ctx.restore();
    }
    ctx.fillStyle = it.cTop; ctx.fillRect(x0, y, w, Math.max(PX, it.u * 0.15));
    ctx.save();
    ctx.translate(Math.sin(t * 0.8) * it.u * 0.4, 0);
    ctx.globalAlpha = 0.25 + 0.1 * Math.sin(t * 1.9); ctx.fillStyle = 'rgb(170,186,196)'; it.foam.fill(ctx);
    ctx.restore();
    if (P.rain >= 0.5 && it.u * SC > 1) {
      ctx.strokeStyle = 'rgba(180,198,212,0.28)'; ctx.lineWidth = Math.max(PX * 0.7, it.u * 0.025);
      ctx.beginPath(); n = 0;
      for (i = 0; i < 30; i++) {
        ph = t * 1.7 + i * 0.61; cyc = Math.floor(ph); f = ph - cyc;
        px = VR.x0 + hash2(cyc, i) * (VR.x1 - VR.x0);
        py = Math.max(y, VR.y0) + hash2(i, cyc + 3) * (Math.min(1000, VR.y1) - Math.max(y, VR.y0));
        if (py <= y) { continue; }
        r = it.u * (0.1 + f * 0.7) * (1 + (py - y) / (1000 - y + 1));
        ctx.moveTo(px + r * 3, py); ctx.ellipse(px, py, r * 3, r, 0, 0, TAU); n++;
      }
      if (n) { ctx.stroke(); }
    }
    ctx.globalAlpha = 1;
  }

  // ---------- vehicles, lamps, cranes, billboards, containers, boats ----------

  var CAR_LEN = { sedan: 4.6, van: 5.0, truck: 7.4 };

  BUILD.car = function (it, s, rnd) {
    var d = it.d, u = it.u, P = K.P, col = s.color || '#3a4a5a';
    it.kind = CAR_LEN[s.kind] ? s.kind : 'sedan';
    it.cx = num(s.x, 0); it.cy = num(s.y, 900);
    it.dir = rnd() < 0.5 ? -1 : 1;
    it.hl = P.beams && rnd() < 0.75;
    it.body = hz(col, d, 0.8 * P.wallK); it.bodyD = hz(col, d, 0.45 * P.wallK);
    it.glass = hz('#0d151c', d); it.cRim = rimCol(d, 0.5);
    var L = CAR_LEN[it.kind];
    it.x0 = it.cx - (L / 2 + 8) * u; it.x1 = it.cx + (L / 2 + 8) * u; it.y0 = it.cy - 3.6 * u; it.y1 = it.cy + 1.6 * u;
    it.fn = dCar;
  };

  function dCar(ctx, it) {
    var u = it.u, L = CAR_LEN[it.kind], P = K.P, us = u * SC, hy, wheels, wr = 0.33, i;
    ctx.save();
    ctx.translate(it.cx, it.cy); ctx.scale(it.dir * u, u);
    ctx.fillStyle = 'rgba(0,0,0,' + (0.18 * P.wet) + ')';
    ctx.fillRect(-L / 2, 0.02, L, 0.6);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath(); ctx.ellipse(0, 0.02, L * 0.55, 0.16, 0, 0, TAU); ctx.fill();
    if (it.kind === 'sedan') {
      ctx.fillStyle = it.body;
      poly(ctx, [-2.3, -0.35, -2.35, -0.85, -1.6, -0.98, -1.05, -1.42, 0.75, -1.42, 1.35, -0.98, 2.3, -0.86, 2.35, -0.4]);
      ctx.fillStyle = it.glass;
      poly(ctx, [-0.95, -1.0, -0.82, -1.33, -0.02, -1.33, -0.02, -1.0]);
      poly(ctx, [0.08, -1.0, 0.08, -1.33, 0.68, -1.33, 1.12, -1.0]);
      ctx.fillStyle = it.cRim; ctx.fillRect(-1.05, -1.44, 1.8, 0.05);
      hy = -0.78; wheels = [-1.45, 1.45];
    } else if (it.kind === 'van') {
      ctx.fillStyle = it.body;
      poly(ctx, [-2.5, -0.35, -2.5, -2.05, 1.3, -2.05, 2.3, -1.2, 2.5, -0.9, 2.5, -0.4]);
      ctx.fillStyle = it.glass;
      poly(ctx, [1.38, -1.95, 2.15, -1.22, 1.38, -1.22]);
      ctx.fillRect(0.3, -1.9, 0.9, 0.62);
      ctx.fillStyle = it.bodyD; ctx.fillRect(-0.6, -1.95, 0.04, 1.5);
      ctx.fillStyle = it.cRim; ctx.fillRect(-2.5, -2.07, 3.8, 0.05);
      hy = -0.95; wheels = [-1.6, 1.65];
    } else {
      ctx.fillStyle = it.bodyD; ctx.fillRect(-3.7, -0.62, 7.4, 0.28);
      ctx.fillStyle = it.body;
      ctx.fillRect(-3.7, -3.25, 5.0, 2.65);
      poly(ctx, [1.45, -0.45, 1.45, -2.75, 2.9, -2.75, 3.7, -1.6, 3.7, -0.45]);
      ctx.fillStyle = it.glass;
      poly(ctx, [1.7, -2.55, 2.8, -2.55, 3.38, -1.68, 1.7, -1.68]);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      for (i = 0; i < 9; i++) { ctx.fillRect(-3.55 + i * 0.55, -3.1, 0.06, 2.4); }
      ctx.fillStyle = it.cRim; ctx.fillRect(-3.7, -3.27, 5.0, 0.06);
      hy = -1.0; wheels = [-2.6, -1.6, 2.7]; wr = 0.48;
    }
    ctx.fillStyle = it.bodyD; ctx.fillRect(-L / 2, -0.45, L, 0.12);
    // beltline sheen, window glint, door seams (close up), bumpers
    ctx.fillStyle = it.cRim; ctx.fillRect(-L / 2 + 0.15, hy - 0.06, L - 0.3, 0.035);
    if (us > 1.2) {
      ctx.fillStyle = 'rgba(190,215,232,0.1)';
      poly(ctx, [-0.6, -1.0, -0.35, -1.0, -0.1, -1.33, -0.35, -1.33]);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      if (it.kind === 'sedan') { ctx.fillRect(-0.05, -0.98, 0.025, 0.55); ctx.fillRect(1.15, -0.95, 0.025, 0.5); ctx.fillRect(-1.0, -0.98, 0.025, 0.55); }
      ctx.fillRect(0.3, hy + 0.02, 0.22, 0.04); ctx.fillRect(-0.8, hy + 0.02, 0.22, 0.04);
      ctx.fillStyle = 'rgba(200,205,210,0.3)';
      ctx.fillRect(L / 2 - 0.05, -0.5, 0.12, 0.08); ctx.fillRect(-L / 2 - 0.07, -0.5, 0.12, 0.08);
    }
    for (i = 0; i < wheels.length; i++) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.beginPath(); ctx.arc(wheels[i], -wr, wr * 1.2, PI, TAU); ctx.fill();
      ctx.fillStyle = '#07080a';
      ctx.beginPath(); ctx.arc(wheels[i], -wr, wr, 0, TAU); ctx.fill();
      ctx.fillStyle = '#3a3d41';
      ctx.beginPath(); ctx.arc(wheels[i], -wr, wr * 0.42, 0, TAU); ctx.fill();
      if (us > 1.5) { ctx.fillStyle = 'rgba(220,225,230,0.35)'; ctx.fillRect(wheels[i] - wr * 0.3, -wr * 1.3, wr * 0.35, wr * 0.08); }
    }
    ctx.fillStyle = '#b3202a'; ctx.fillRect(-L / 2 - 0.03, hy - 0.1, 0.12, 0.2);
    glowHalo(ctx, '#d0283a', -L / 2 + 0.03, hy, 0.6, 0.45, 0.5);
    ctx.fillStyle = css(rgb('#c8303a'), 0.1 * P.wet); ctx.fillRect(-L / 2 - 0.05, 0.05, 0.2, 1.1);
    if (it.hl) {
      glowHalo(ctx, '#ffe2aa', L / 2, hy, 0.9, 0.6, 0.55);
      ctx.fillStyle = '#fff0cc'; ctx.fillRect(L / 2 - 0.12, hy - 0.08, 0.16, 0.16);
      ctx.fillStyle = 'rgba(255,226,170,0.07)';
      poly(ctx, [L / 2, hy - 0.12, L / 2 + 7.5, hy - 1.2, L / 2 + 7.5, 0.15, L / 2, hy + 0.12]);
      ctx.fillStyle = css(rgb('#ffe2aa'), 0.12 * P.wet);
      ctx.fillRect(L / 2 - 0.1, 0.05, 0.22, 1.4);
    } else {
      ctx.fillStyle = 'rgba(160,170,170,0.6)'; ctx.fillRect(L / 2 - 0.12, hy - 0.08, 0.14, 0.14);
    }
    ctx.restore();
  }

  BUILD.lamp = function (it, s, rnd) {
    var u = it.u;
    it.lx = num(s.x, 0); it.ly = num(s.y, 900);
    it.dir = rnd() < 0.5 ? -1 : 1;
    it.flk = rnd() < 0.2 ? rnd() * 100 : -1;
    it.cPole = hz('#101316', it.d);
    it.x0 = it.lx - 5 * u; it.x1 = it.lx + 5 * u; it.y0 = it.ly - 10 * u; it.y1 = it.ly + 3 * u;
    it.fn = dLamp;
  };

  function dLamp(ctx, it, t) {
    var P = K.P, k = P.lampK, on = true, us = it.u * SC, i, f, rx, ry;
    if (it.flk >= 0) { on = hash1(Math.floor(t * 14) + it.flk) > 0.12; }
    ctx.save();
    ctx.translate(it.lx, it.ly); ctx.scale(it.dir * it.u, it.u);
    if (on) {
      // pool of light on the ground and the volumetric cone
      ctx.save(); ctx.translate(1.25, 0.1); ctx.scale(3.8, 0.6);
      ctx.globalAlpha = clamp(k * (0.75 + 0.35 * P.wet), 0, 1); ctx.fillStyle = grad('lamp');
      ctx.fillRect(-1, -1, 2, 2);
      ctx.restore();
      ctx.globalAlpha = clamp(k * (P.fog ? 1.5 : 1), 0, 1); ctx.fillStyle = grad('cone');
      poly(ctx, [1.0, -6.4, 1.5, -6.4, 3.9, 0, -1.4, 0]);
      ctx.globalAlpha = 1;
      ctx.fillStyle = css(rgb('#e8a33d'), 0.14 * k * P.wet);
      ctx.fillRect(1.1, 0.1, 0.3, 2.6);
    }
    ctx.fillStyle = it.cPole;
    poly(ctx, [-0.22, 0, 0.22, 0, 0.15, -0.7, -0.15, -0.7]);
    poly(ctx, [-0.07, -0.7, 0.07, -0.7, 0.05, -6.6, -0.05, -6.6]);
    ctx.fillRect(-0.11, -2.4, 0.22, 0.12); ctx.fillRect(-0.09, -5.0, 0.18, 0.1);
    ctx.strokeStyle = it.cPole; ctx.lineWidth = 0.1; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, -6.3); ctx.quadraticCurveTo(0.05, -6.66, 1.1, -6.6); ctx.stroke();
    if (us > 1.5) { ctx.lineWidth = 0.04; ctx.beginPath(); ctx.moveTo(0, -5.9); ctx.quadraticCurveTo(0.5, -5.9, 0.6, -6.55); ctx.stroke(); }
    poly(ctx, [0.9, -6.72, 1.6, -6.72, 1.5, -6.44, 1.0, -6.44]);
    ctx.fillStyle = rimCol(it.d, 0.5); ctx.fillRect(0.05, -6.5, 0.025, 6.3);
    if (on) {
      ctx.fillStyle = '#ffd890'; ctx.fillRect(1.04, -6.46, 0.42, 0.08);
      if (K.P.rain > 0.2 && us > 0.8) {
        ctx.strokeStyle = 'rgba(255,214,150,0.4)'; ctx.lineWidth = 0.03; ctx.lineCap = 'butt';
        ctx.beginPath();
        for (i = 0; i < 12; i++) {
          f = (t * (1.3 + hash1(i) * 0.6) + i * 0.137) % 1;
          rx = 1.25 + (hash1(i * 3.7) - 0.5) * (0.5 + 4.8 * f); ry = -6.2 + f * 6.1;
          ctx.moveTo(rx, ry); ctx.lineTo(rx + 0.06, ry + 0.4);
        }
        ctx.stroke();
      }
      ctx.translate(1.25, -6.4);
      ctx.scale(P.fog ? 4 : 2.6, P.fog ? 4 : 2.6);
      ctx.globalAlpha = k;
      ctx.fillStyle = grad('lamp');
      ctx.beginPath(); ctx.arc(0, 0, 1, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  BUILD.crane = function (it, s, rnd) {
    var u = it.u;
    it.lx = num(s.x, 0); it.ly = num(s.y, 900);
    it.dir = rnd() < 0.5 ? -1 : 1; it.seed = rnd() * 10;
    it.c = hz('#171b20', it.d); it.cRim = rimCol(it.d, 0.4);
    it.x0 = it.lx - 36 * u; it.x1 = it.lx + 36 * u; it.y0 = it.ly - 38 * u; it.y1 = it.ly + u;
    it.fn = dCrane;
  };

  function dCrane(ctx, it, t) {
    var i, xa, xb;
    ctx.save();
    ctx.translate(it.lx, it.ly); ctx.scale(it.dir * it.u, it.u);
    ctx.strokeStyle = it.c; ctx.fillStyle = it.c; ctx.lineCap = 'butt';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(-7, 0); ctx.lineTo(-6, -24); ctx.moveTo(7, 0); ctx.lineTo(6, -24);
    ctx.moveTo(-6.6, -12); ctx.lineTo(6.6, -12); ctx.moveTo(-6.2, -24); ctx.lineTo(6.2, -24);
    ctx.stroke();
    ctx.lineWidth = 0.3;
    ctx.beginPath();
    ctx.moveTo(-6.6, -12); ctx.lineTo(6.2, -24); ctx.moveTo(6.6, -12); ctx.lineTo(-6.2, -24);
    ctx.moveTo(-6.9, -1); ctx.lineTo(6.6, -12); ctx.moveTo(6.9, -1); ctx.lineTo(-6.6, -12);
    ctx.stroke();
    ctx.fillRect(-4, -30, 8, 6);
    ctx.fillRect(-15, -30.5, 3, 3);
    ctx.lineWidth = 0.35;
    ctx.beginPath();
    ctx.moveTo(2, -29); ctx.lineTo(34, -31.2); ctx.moveTo(2, -27.2); ctx.lineTo(34, -30.6);
    for (i = 0; i < 12; i++) {
      xa = 2 + i * 2.67; xb = xa + 2.67;
      ctx.moveTo(xa, -29 - i * 0.18); ctx.lineTo(xb, -27.2 - (i + 1) * 0.28);
    }
    ctx.moveTo(-2, -28); ctx.lineTo(-14, -28.5);
    ctx.stroke();
    ctx.lineWidth = 0.15;
    ctx.beginPath();
    ctx.moveTo(-1, -30); ctx.lineTo(1, -36); ctx.lineTo(3, -30);
    ctx.moveTo(1, -36); ctx.lineTo(34, -31.2); ctx.moveTo(1, -36); ctx.lineTo(-14, -28.5);
    ctx.moveTo(24, -30.5); ctx.lineTo(24, -12.5);
    ctx.stroke();
    ctx.fillRect(23.4, -12.6, 1.2, 1.3);
    ctx.fillStyle = it.cRim; ctx.fillRect(-4, -30, 8, 0.2);
    if (((t + it.seed) % 1.6) < 0.8) {
      ctx.fillStyle = 'rgba(255,60,50,0.22)';
      ctx.beginPath(); ctx.arc(1, -36.4, 1.6, 0, TAU); ctx.moveTo(35.6, -31.6); ctx.arc(34, -31.6, 1.6, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ff4a3c';
      ctx.beginPath(); ctx.arc(1, -36.4, 0.4, 0, TAU); ctx.moveTo(34.4, -31.6); ctx.arc(34, -31.6, 0.4, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  BUILD.billboard = function (it, s) {
    var d = it.d;
    it.bx = num(s.x, 0); it.by = num(s.y, 300); it.bw = Math.max(2, num(s.w, 100)); it.bh = Math.max(1, num(s.h, 40));
    it.text = (s.text !== undefined && s.text !== null) ? String(s.text) : '';
    it.cPanel = hz('#b9b09a', d, K.P.wallK * 0.85); it.cInk = hz('#16181c', d); it.cRed = hz('#8a2028', d);
    it.cSil = hz('#111417', d);
    it.x0 = it.bx - it.bw * 0.05; it.x1 = it.bx + it.bw * 1.05; it.y0 = it.by - it.bw * 0.03; it.y1 = it.by + it.bh * 1.7;
    it.fn = dBoard;
  };

  function dBoard(ctx, it) {
    var x = it.bx, y = it.by, w = it.bw, h = it.bh, f = Math.min(w, h) * 0.04, size;
    ctx.fillStyle = it.cSil;
    ctx.fillRect(x + w * 0.2, y + h, w * 0.035, h * 0.65);
    ctx.fillRect(x + w * 0.765, y + h, w * 0.035, h * 0.65);
    ctx.fillRect(x - f, y - f, w + f * 2, h + f * 2);
    ctx.fillRect(x - w * 0.02, y + h + f, w * 1.04, Math.max(PX, h * 0.05));
    ctx.fillStyle = it.cPanel; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = it.cRed; ctx.fillRect(x, y + h * 0.82, w, h * 0.18);
    ctx.fillStyle = 'rgba(255,215,150,' + (0.14 * K.P.lampK) + ')';
    ctx.fillRect(x, y + h * 0.45, w, h * 0.55);
    if (it.text) {
      size = fitSize(ctx, it, it.text, w * 0.88, h * 0.55);
      ctx.font = 'bold ' + size + 'px ' + FONT;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = it.cInk; ctx.fillText(it.text, x + w / 2, y + h * 0.42);
    }
  }

  BUILD.container = function (it, s) {
    var d = it.d, i, n;
    it.bx = num(s.x, 0); it.by = num(s.y, 800); it.bw = Math.max(1, num(s.w, 120)); it.bh = Math.max(1, num(s.h, 50));
    it.c = hz(s.color || '#6e3526', d, 0.75 * K.P.wallK); it.cRim = rimCol(d, 0.35);
    it.ridges = new Batch();
    n = 16;
    for (i = 1; i < n; i++) { it.ridges.rect(it.bx + i * it.bw / n, it.by + it.bh * 0.06, it.bw / (n * 2.5), it.bh * 0.86); }
    it.x0 = it.bx; it.x1 = it.bx + it.bw; it.y0 = it.by; it.y1 = it.by + it.bh;
    it.fn = dContainer;
  };

  function dContainer(ctx, it) {
    var x = it.bx, y = it.by, w = it.bw, h = it.bh;
    ctx.fillStyle = it.c; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.22)'; it.ridges.fill(ctx);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(x, y + h * 0.93, w, h * 0.07);
    ctx.fillRect(x + w - w * 0.012, y, w * 0.012, h);
    ctx.fillRect(x, y, w * 0.012, h);
    ctx.fillStyle = it.cRim; ctx.fillRect(x, y, w, Math.max(PX, h * 0.04));
  }

  BUILD.boat = function (it, s, rnd) {
    var d = it.d;
    it.bx = num(s.x, 0); it.by = num(s.y, 800); it.bw = Math.max(4, num(s.w, 200));
    it.dir = rnd() < 0.5 ? -1 : 1; it.seed = rnd() * 10;
    it.cHull = hz('#14181c', d); it.cCab = hz('#2a2f35', d); it.cTrim = hz('#7f8584', d);
    it.cLit = hzLight('#e8a33d', d); it.cRim = rimCol(d, 0.4);
    it.x0 = it.bx - 2; it.x1 = it.bx + it.bw + 2; it.y0 = it.by - it.bw * 0.6; it.y1 = it.by + it.bw * 0.1;
    it.fn = dBoat;
  };

  function dBoat(ctx, it, t) {
    var i;
    ctx.save();
    ctx.translate(it.bx + it.bw / 2, it.by + Math.sin(t * 0.9 + it.seed) * it.bw * 0.003);
    ctx.scale(it.dir * it.bw, it.bw);
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(-0.46, 0, 0.9, 0.05);
    ctx.fillStyle = it.cHull;
    poly(ctx, [-0.5, -0.11, 0.42, -0.11, 0.5, -0.17, 0.44, 0.0, -0.46, 0.0]);
    ctx.fillStyle = it.cTrim; ctx.fillRect(-0.49, -0.105, 0.92, 0.01);
    ctx.fillStyle = it.cCab;
    ctx.fillRect(-0.32, -0.24, 0.36, 0.13);
    ctx.fillRect(-0.24, -0.33, 0.2, 0.09);
    ctx.fillRect(-0.12, -0.55, 0.006, 0.22);
    ctx.fillStyle = it.cRim; ctx.fillRect(-0.32, -0.245, 0.36, 0.006);
    ctx.globalAlpha = K.P.lightA;
    ctx.fillStyle = it.cLit;
    ctx.fillRect(-0.22, -0.31, 0.16, 0.04);
    for (i = 0; i < 6; i++) { ctx.fillRect(-0.36 + i * 0.12, -0.07, 0.014, 0.014); }
    ctx.fillStyle = css(rgb('#e8a33d'), 0.18);
    ctx.fillRect(-0.22, 0.01, 0.16, 0.06 + 0.01 * Math.sin(t * 2));
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#f4f0e0'; ctx.fillRect(-0.12, -0.56, 0.008, 0.008);
    ctx.fillStyle = '#ff3b30'; ctx.fillRect(0.45, -0.16, 0.008, 0.008);
    ctx.restore();
  }


  // ---------- people ----------
  // Drawn in body units: the entity's feet at (0, 0), height 1, facing +x (3/4 view, face on the +x side).
  // Matches LW.bodyGeom: head circle centre (0, -0.9) r 0.085, torso +-0.15 from -0.8 to -0.45, legs below.
  // LOD by on-screen height: 0 < 18 px (silhouette), 1 < 60 px (outlines, rim, knees), 2 < 140 px (face,
  // lapels, belt, folds, shaped hands, item detail), 3 (buttons, pockets, eye glints, smoke wisps).

  function lookCols(e) {
    var L = e.look || {}, key = (e.id || '?') + '|' + e.dist + '|' + (e.window ? 1 : 0), c = K.ents[key];
    if (c && c.src === L) { return c; }
    var d = e.dist, P = K.P, k = Math.min(1, P.dark * 1.2) * (e.window ? 0.75 : 1);
    var coat = L.coat || '#3a3d44', skin = L.skin || '#c8a27c', ks = Math.min(1.05, k + 0.28);
    c = { src: L, seed: (strHash(e.id) % 1000) / 10,
      coat: hz(coat, d, k), coatD: hz(coat, d, k * 0.6), coatB: hz(coat, d, k * 0.8), coatL: hz(coat, d, Math.min(1.3, k * 1.35)),
      pants: hz('#22252c', d, 1), pantsD: hz('#16181d', d, 1), shoe: hz('#0b0b0d', d), shoeL: hz('#55585e', d),
      skin: hz(skin, d, ks), skinD: hz(skin, d, ks * 0.72), skinS: hz(skin, d, ks * 0.5),
      hair: hz(L.hair || '#2a2420', d, k), hat: hz(coat, d, k * 0.5), band: hz('#0a0a0c', d),
      tie: L.tie ? hz(L.tie, d, Math.min(1, k + 0.15)) : null, shirt: hz('#c9c6bb', d, k),
      ink: hz('#040507', d), rim: rimCol(d, 0.85), rimS: rimCol(d, 0.4),
      item: hz('#141519', d), itemL: hz('#5a5f66', d), brief: hz('#3a2618', d, k + 0.1), briefL: hz('#7a5a3a', d, k + 0.1),
      umb: hz(coat, d, k * 0.45), umbD: hz(coat, d, k * 0.3),
      paper: hz(L.coat || '#d8cfb4', d, Math.min(1, P.dark + 0.35)), wood: hz('#4a3524', d, k), ring: hz('#1a1a1a', d),
      win: hzLight('#d39a4c', d), winD: hzLight('#7a4e26', d), curtain: hz('#4a2620', d), frame: hz('#0f1114', d),
      sill: hz('#50555c', d, P.wallK), pool: hz('#2a0306', d, 1, 0.92) };
    K.ents[key] = c;
    return c;
  }

  // Rim side from the nearest street lamp at a similar distance, else from the moon / sun side.
  var RIM = { s: 1, near: 0 };
  function rimFor(e) {
    var i, l, dx, best = 1e9, u = 2000 / e.dist, L = K.lamps, R = u * 14, a;
    for (i = 0; i < L.length; i++) {
      l = L[i];
      if (Math.abs(l.d - e.dist) > 45) { continue; }
      dx = (l.lx + l.dir * 1.25 * l.u) - e.x;
      if (Math.abs(dx) < Math.abs(best)) { best = dx; }
    }
    a = Math.abs(best);
    if (a < R) { RIM.near = 1 - a / R; RIM.s = (best >= 0 ? 1 : -1) * (0.55 + 0.45 * RIM.near); }
    else { RIM.near = 0; RIM.s = (K.keyX >= e.x ? 1 : -1) * 0.5; }
  }

  // Pose scratch, filled per person (no allocations): legs and arms as [x0,y0,x1,y1,x2,y2].
  var LF = [0, 0, 0, 0, 0, 0], LB = [0, 0, 0, 0, 0, 0], AF = [0, 0, 0, 0, 0, 0], AB = [0, 0, 0, 0, 0, 0];

  function legPose(o, hx, th, bend) {
    var hy = -0.47, kx = hx + Math.sin(th) * 0.24, ky = hy + Math.cos(th) * 0.24, sh = th - bend;
    o[0] = hx; o[1] = hy; o[2] = kx; o[3] = ky; o[4] = kx + Math.sin(sh) * 0.235; o[5] = ky + Math.cos(sh) * 0.235;
  }
  function armFK(o, sx, sy, ua, fb) {
    var ex = sx + Math.sin(ua) * 0.165, ey = sy + Math.cos(ua) * 0.165, fa = ua + fb;
    o[0] = sx; o[1] = sy; o[2] = ex; o[3] = ey; o[4] = ex + Math.sin(fa) * 0.16; o[5] = ey + Math.cos(fa) * 0.16;
  }
  function armSet(o, sx, sy, ex, ey, hx, hy) { o[0] = sx; o[1] = sy; o[2] = ex; o[3] = ey; o[4] = hx; o[5] = hy; }

  function strokePoly(ctx, a) { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(a[2], a[3]); ctx.lineTo(a[4], a[5]); ctx.stroke(); }

  // A two-part limb with an ink outline pass under the colour pass (comic look).
  function limb(ctx, a, w0, w1, col, ink, ow) {
    if (ow > 0) {
      ctx.strokeStyle = ink;
      ctx.lineWidth = w0 + ow * 2; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(a[2], a[3]); ctx.stroke();
      ctx.lineWidth = w1 + ow * 2; ctx.beginPath(); ctx.moveTo(a[2], a[3]); ctx.lineTo(a[4], a[5]); ctx.stroke();
    }
    ctx.strokeStyle = col;
    ctx.lineWidth = w0; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(a[2], a[3]); ctx.stroke();
    ctx.lineWidth = w1; ctx.beginPath(); ctx.moveTo(a[2], a[3]); ctx.lineTo(a[4], a[5]); ctx.stroke();
  }

  function shoe(ctx, x, y, ang, c, ow, lod) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
    ctx.fillStyle = c.shoe;
    ctx.beginPath();
    ctx.moveTo(-0.032, -0.014); ctx.lineTo(0.03, -0.024); ctx.quadraticCurveTo(0.072, -0.018, 0.072, 0.006);
    ctx.lineTo(-0.032, 0.006); ctx.closePath(); ctx.fill();
    if (ow > 0) { ctx.strokeStyle = c.ink; ctx.lineWidth = ow * 1.5; ctx.stroke(); }
    if (lod >= 2) { ctx.strokeStyle = c.shoeL; ctx.lineWidth = 0.005; ctx.beginPath(); ctx.moveTo(0.03, -0.02); ctx.quadraticCurveTo(0.06, -0.017, 0.066, -0.006); ctx.stroke(); }
    ctx.restore();
  }

  function hand(ctx, a, col, ink, ow, lod) {
    var hx = a[4], hy = a[5];
    if (lod >= 2) {
      var ang = Math.atan2(hy - a[3], hx - a[2]);
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.ellipse(hx, hy, 0.027, 0.019, ang, 0, TAU); ctx.fill();
      if (ow > 0) { ctx.strokeStyle = ink; ctx.lineWidth = ow * 1.4; ctx.stroke(); }
    } else {
      dot(ctx, hx, hy, 0.023, col);
    }
  }

  function drawEntity(ctx, e, t) {
    var h = LW.personHeight(e);
    if (!(h > 0) || !isFinite(h)) { return; }
    var c = lookCols(e), L = e.look || {}, hp = h * SC;
    var lod = hp < 18 ? 0 : hp < 60 ? 1 : hp < 140 ? 2 : 3;
    var ow = lod === 0 ? 0 : clamp(1.25 / hp, 0.004, 0.022);
    var facing = num(e.facing, 1) < 0 ? -1 : 1;
    var dead = e.dead || (e.alive === false ? { t: -100, dir: -facing } : null);
    var q = dead ? clamp((t - num(dead.t, t - 1)) / 0.75, 0, 1) : 0, ang, z, pe, g, ge, px;
    var dir = (dead && dead.dir) ? (dead.dir < 0 ? -1 : 1) : -facing;
    rimFor(e);
    var rs = RIM.s * facing, near = RIM.near;
    ctx.save();
    ctx.translate(e.x, e.y); ctx.scale(h, h);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (e.window) {
      pe = q * q;
      windowOpening(ctx, c, lod);
      ctx.save();
      ctx.beginPath(); ctx.rect(-0.32, -1.08, 0.64, 0.63); ctx.clip();
      if (dead) { ctx.translate(0, pe * 0.62 - 0.45); ctx.rotate(dir * pe * 0.35); ctx.translate(0, 0.45); }
      ctx.scale(facing, 1);
      body(ctx, e, c, L, t, dead, true, lod, 0, ow, 0);
      ctx.restore();
      ctx.fillStyle = c.ink; ctx.fillRect(-0.38, -0.475, 0.76, 0.065);
      ctx.fillStyle = c.sill; ctx.fillRect(-0.37, -0.47, 0.74, 0.05);
      ctx.fillStyle = c.rim; ctx.fillRect(-0.37, -0.47, 0.74, 0.01);
    } else {
      // contact shadow, plus a long cast shadow away from a nearby lamp
      ctx.fillStyle = 'rgba(0,0,0,0.38)';
      ctx.beginPath(); ctx.ellipse(0, 0.004, dead && q >= 1 ? 0.5 : 0.15, 0.02, 0, 0, TAU); ctx.fill();
      if (near > 0.05 && !dead) {
        ctx.globalAlpha = 0.35 * near;
        ctx.beginPath(); ctx.ellipse(-RIM.s / Math.abs(RIM.s) * 0.32, 0.008, 0.32, 0.022, 0, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (dead) {
        if (q < 0.8) { z = q / 0.8; ang = HALF_PI * z * z; } else { z = (q - 0.8) / 0.2; ang = HALF_PI - Math.sin(z * PI) * 0.09; }
        if (q >= 1 && !L.dummy) {
          g = clamp((t - num(dead.t, t) - 0.75) / 3.5, 0, 1); ge = 1 - (1 - g) * (1 - g);
          px = dir * (dead.head ? 0.84 : 0.6);
          ctx.fillStyle = c.pool;
          ctx.beginPath(); ctx.ellipse(px, 0.006, 0.05 + ge * 0.3, 0.012 + ge * 0.042, 0, 0, TAU); ctx.fill();
          if (ge > 0.2) { ctx.beginPath(); ctx.ellipse(px + dir * ge * 0.22, 0.012, ge * 0.12, ge * 0.025, 0, 0, TAU); ctx.fill(); }
          if (lod >= 2 && ge > 0.15) {
            ctx.strokeStyle = 'rgba(170,60,60,0.35)'; ctx.lineWidth = 0.006;
            ctx.beginPath(); ctx.ellipse(px, 0.006, (0.05 + ge * 0.3) * 0.8, (0.012 + ge * 0.042) * 0.6, 0, PI * 1.1, PI * 1.6); ctx.stroke();
          }
          droppedItem(ctx, c, L, -dir, lod, ow);
        }
        ctx.translate(0, -0.13 * (ang / HALF_PI)); ctx.rotate(dir * ang);
      }
      ctx.scale(facing, 1);
      if (L.dummy) { dummy(ctx, c, ow); } else { body(ctx, e, c, L, t, dead, false, lod, rs, ow, near); }
    }
    ctx.restore();
  }

  // Items lying next to a body (world-direction coords, before the facing flip).
  function droppedItem(ctx, c, L, side, lod, ow) {
    var item = L.item || 'none', x = side * 0.3;
    if (lod < 1 || item === 'none' || item === 'cigarette') { return; }
    ctx.fillStyle = item === 'briefcase' ? c.brief : item === 'umbrella' ? c.umb : c.item;
    ctx.beginPath();
    if (item === 'briefcase') { ctx.rect(x - 0.07, -0.08, 0.14, 0.08); }
    else if (item === 'phone') { ctx.fillStyle = 'rgba(150,205,235,0.8)'; ctx.rect(x, -0.012, 0.03, 0.012); }
    else if (item === 'umbrella') { ctx.ellipse(x * 1.6, -0.02, 0.3, 0.07, side * 0.15, PI, TAU); ctx.closePath(); }
    else if (item === 'rifle') { ctx.rect(x - 0.3, -0.03, 0.6, 0.028); }
    else { return; }
    ctx.fill();
    if (ow > 0 && item !== 'phone') { ctx.strokeStyle = c.ink; ctx.lineWidth = ow; ctx.stroke(); }
  }

  function windowOpening(ctx, c, lod) {
    ctx.fillStyle = c.ink; ctx.fillRect(-0.36, -1.12, 0.72, 0.7);
    ctx.fillStyle = c.frame; ctx.fillRect(-0.35, -1.11, 0.7, 0.68);
    ctx.fillStyle = c.win; ctx.fillRect(-0.32, -1.08, 0.64, 0.63);
    ctx.fillStyle = c.winD; ctx.fillRect(-0.32, -1.08, 0.64, 0.09);
    ctx.fillStyle = 'rgba(255,238,200,0.18)';
    ctx.beginPath(); ctx.ellipse(0, -0.86, 0.26, 0.3, 0, 0, TAU); ctx.fill();
    if (lod >= 1) {
      ctx.fillStyle = c.winD;
      ctx.fillRect(-0.27, -1.0, 0.13, 0.1); ctx.fillRect(0.15, -0.72, 0.15, 0.25); ctx.fillRect(0.2, -0.82, 0.02, 0.1);
      ctx.beginPath(); ctx.moveTo(0.14, -0.82); ctx.lineTo(0.28, -0.82); ctx.lineTo(0.25, -0.88); ctx.lineTo(0.17, -0.88); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = c.curtain; ctx.fillRect(-0.32, -1.08, 0.08, 0.63); ctx.fillRect(0.24, -1.08, 0.08, 0.63);
    if (lod >= 2) {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(-0.3, -1.08, 0.012, 0.63); ctx.fillRect(-0.27, -1.08, 0.012, 0.63);
      ctx.fillRect(0.26, -1.08, 0.012, 0.63); ctx.fillRect(0.29, -1.08, 0.012, 0.63);
    }
  }

  function dummy(ctx, c, ow) {
    if (ow > 0) {
      ctx.strokeStyle = c.ink; ctx.lineWidth = 0.03 + ow * 2;
      ctx.beginPath(); ctx.moveTo(-0.1, 0); ctx.lineTo(-0.07, -0.44); ctx.moveTo(0.1, 0); ctx.lineTo(0.07, -0.44); ctx.stroke();
    }
    seg(ctx, -0.1, 0, -0.07, -0.44, 0.03, c.wood);
    seg(ctx, 0.1, 0, 0.07, -0.44, 0.03, c.wood);
    ctx.fillStyle = c.wood; ctx.fillRect(-0.13, -0.46, 0.26, 0.035);
    ctx.fillStyle = c.paper;
    ctx.beginPath();
    ctx.moveTo(-0.15, -0.44); ctx.lineTo(-0.15, -0.75);
    ctx.quadraticCurveTo(-0.15, -0.8, -0.1, -0.8); ctx.lineTo(-0.032, -0.8); ctx.lineTo(-0.032, -0.84);
    ctx.arc(0, -0.9, 0.085, PI * 0.62, PI * 0.38, false);
    ctx.lineTo(0.032, -0.8); ctx.lineTo(0.1, -0.8);
    ctx.quadraticCurveTo(0.15, -0.8, 0.15, -0.75); ctx.lineTo(0.15, -0.44);
    ctx.closePath(); ctx.fill();
    if (ow > 0) { ctx.strokeStyle = c.ink; ctx.lineWidth = ow * 2; ctx.stroke(); }
    ctx.strokeStyle = c.ring; ctx.lineWidth = 0.009;
    ctx.beginPath();
    ctx.arc(0, -0.62, 0.1, 0, TAU); ctx.moveTo(0.05, -0.62); ctx.arc(0, -0.62, 0.05, 0, TAU);
    ctx.moveTo(0.045, -0.9); ctx.arc(0, -0.9, 0.045, 0, TAU);
    ctx.stroke();
    dot(ctx, 0, -0.62, 0.012, c.ring);
    dot(ctx, 0, -0.9, 0.01, c.ring);
    ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(-0.15, -0.8, 0.05, 0.36);
  }

  function coatPath(ctx, bw, hem, flB, flF) {
    ctx.beginPath();
    ctx.moveTo(-bw * 0.7, -0.812);
    ctx.quadraticCurveTo(-bw * 1.04, -0.806, -bw * 1.03, -0.74);
    ctx.lineTo(-bw * 0.98, -0.56);
    ctx.lineTo(-bw * 1.12 + flB, hem);
    ctx.quadraticCurveTo(0, hem + 0.014, bw * 1.14 + flF, hem - 0.004);
    ctx.lineTo(bw * 0.99, -0.56);
    ctx.lineTo(bw * 1.03, -0.74);
    ctx.quadraticCurveTo(bw * 1.04, -0.806, bw * 0.7, -0.812);
    ctx.quadraticCurveTo(0, -0.826, -bw * 0.7, -0.812);
    ctx.closePath();
  }

  // Half-moon shadow on the side of the head away from the light (side > 0: light from +x).
  function headShade(ctx, hx, hy, side, a) {
    ctx.save();
    ctx.translate(hx, hy); if (side < 0) { ctx.scale(-1, 1); }
    ctx.fillStyle = 'rgba(8,5,8,' + a + ')';
    ctx.beginPath();
    ctx.arc(0, 0, 0.085, HALF_PI, PI * 1.5, false);
    ctx.ellipse(0, 0, 0.03, 0.085, 0, PI * 1.5, HALF_PI, true);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function body(ctx, e, c, L, t, dead, inWin, lod, rs, ow, near) {
    var st = e.state || 'idle', item = L.item || 'none', hat = L.hat || 'none';
    var run = !dead && (st === 'panic' || st === 'flee');
    var moving = !dead && !inWin && (run || st === 'walk');
    var ph = num(e.walkPhase, 0), sw = moving ? Math.sin(ph) : 0, A = run ? 0.6 : 0.4;
    var bw = L.build === 'heavy' ? 0.158 : L.build === 'slim' ? 0.13 : 0.145;
    var hem = L.build === 'slim' ? -0.36 : -0.31;
    var aim = !dead && !run && st === 'alert' && item === 'rifle';
    var breathe = dead ? 0 : Math.sin(t * 1.6 + c.seed) * 0.004;
    var drag = !dead && !run && item === 'cigarette' && Math.sin(t * 0.5 + c.seed) > 0.6;
    var lean = run ? 0.16 : moving ? 0.035 : 0, dy = 0, hdx = 0, hdy = breathe * 0.5, flF, flB;
    var rsd = rs >= 0 ? 1 : -1, ra = Math.abs(rs), back = inWin, i, k, sx, sy, vx = 0.035;
    var lit = ra > 0 || back;
    // legs: hip, knee, foot with a knee bend on the swing phase; the body drops so a foot touches the ground
    if (moving) {
      legPose(LF, 0.025, Math.sin(ph) * A, Math.max(0, Math.cos(ph)) * (run ? 1.3 : 0.8) + 0.05);
      legPose(LB, -0.025, Math.sin(ph + PI) * A, Math.max(0, Math.cos(ph + PI)) * (run ? 1.3 : 0.8) + 0.05);
      dy = -Math.max(LF[5], LB[5]);
    } else if (dead) {
      legPose(LF, 0.025, 0.04, 0.02); legPose(LB, -0.025, -0.03, 0.02);
    } else {
      k = Math.sin(t * 0.4 + c.seed) * 0.03;
      legPose(LF, 0.025, 0.06 + k, 0.04); legPose(LB, -0.025, -0.05 + k, 0.06 - k);
      dy = -Math.max(LF[5], LB[5]);
    }
    flF = moving ? sw * 0.03 : 0; flB = moving ? -sw * 0.025 : 0;
    // arms and items
    sx = 0.065; sy = -0.77 + breathe;
    if (run && item !== 'rifle') {
      armSet(AF, sx, sy, 0.13, -0.93, 0.11 + Math.sin(ph) * 0.03, -1.08);
      armSet(AB, -0.055, sy, -0.1, -0.92, -0.08, -1.06 + Math.cos(ph) * 0.03);
    } else if (dead) {
      armSet(AF, sx, sy, 0.08, -0.6, 0.09, -0.45); armSet(AB, -0.055, sy, -0.06, -0.6, -0.05, -0.46);
    } else {
      if (moving) { armFK(AF, sx, sy, -sw * 0.45, 0.2 + Math.max(0, -sw) * 0.35); armFK(AB, -0.055, sy, sw * 0.45, 0.2 + Math.max(0, sw) * 0.35); }
      else { armFK(AF, sx, sy, 0.07 + breathe, 0.16); armFK(AB, -0.055, sy, -0.05, 0.18); }
      if (item === 'phone') { armSet(AF, sx, sy, 0.135, -0.73, 0.04, -0.872); hdy += Math.sin(t * 2.2 + c.seed) * 0.003; }
      else if (item === 'umbrella') { armSet(AF, sx, sy, 0.15, -0.66, 0.13, -0.84); }
      else if (item === 'cigarette') {
        if (drag) { armSet(AF, sx, sy, 0.17, -0.7, 0.085, -0.855); } else if (!moving) { armSet(AF, sx, sy, 0.1, -0.62, 0.19, -0.7); }
      } else if (item === 'briefcase') { armFK(AF, sx, sy, moving ? -sw * 0.12 : 0.03, 0.05); }
      else if (item === 'rifle') {
        if (aim) { armSet(AB, -0.055, sy, -0.02, -0.69, 0.1, -0.77); armSet(AF, sx, sy, 0.2, -0.7, 0.3, -0.778); hdx = 0.012; hdy += 0.012; }
        else { armSet(AB, -0.055, sy, -0.07, -0.62, 0.02, -0.58); armSet(AF, sx, sy, 0.11, -0.62, 0.12, -0.69); }
      }
    }
    ctx.save();
    ctx.translate(0, dy);
    leanPush(ctx, lean);
    limb(ctx, AB, 0.066, 0.058, c.coatD, c.ink, ow);
    hand(ctx, AB, c.skinD, c.ink, ow, lod);
    leanPop(ctx, lean);
    if (!inWin) {
      limb(ctx, LB, 0.088, 0.072, c.pantsD, c.ink, ow);
      shoe(ctx, LB[4], LB[5], moving ? clamp(-Math.cos(ph) * 0.3, -0.3, 0.35) : 0, c, ow, lod);
      limb(ctx, LF, 0.088, 0.072, c.pants, c.ink, ow);
      shoe(ctx, LF[4], LF[5], moving ? clamp(Math.cos(ph) * 0.3, -0.3, 0.35) : 0, c, ow, lod);
      if (lit && lod >= 1) {
        ctx.strokeStyle = c.rim; ctx.lineWidth = 0.008 * Math.max(ra, back ? 0.7 : 0);
        ctx.beginPath();
        ctx.moveTo(LF[0] + rsd * 0.04, LF[1]); ctx.lineTo(LF[2] + rsd * 0.04, LF[3]); ctx.lineTo(LF[4] + rsd * 0.034, LF[5] - 0.02);
        ctx.stroke();
      }
    }
    leanPush(ctx, lean);
    // coat
    ctx.fillStyle = c.coat; coatPath(ctx, bw, hem, flB, flF); ctx.fill();
    ctx.save();
    if (rs < 0) { ctx.scale(-1, 1); }
    ctx.fillStyle = back ? 'rgba(0,0,0,0.38)' : 'rgba(0,0,0,0.3)';
    poly(ctx, [-bw * 0.7, -0.81, -bw * 1.02, -0.76, -bw * 0.97, -0.56, -bw * 1.08, hem, -bw * 0.12, hem + 0.012, -bw * 0.18, -0.81]);
    ctx.restore();
    if (hat !== 'hood') {
      ctx.fillStyle = c.shirt; poly(ctx, [vx - 0.046, -0.812, vx + 0.052, -0.812, vx + 0.002, -0.63]);
      if (c.tie) {
        ctx.fillStyle = c.tie;
        poly(ctx, [vx - 0.013, -0.806, vx + 0.013, -0.806, vx + 0.009, -0.784, vx - 0.009, -0.784]);
        poly(ctx, [vx - 0.009, -0.784, vx + 0.009, -0.784, vx + 0.017, -0.66, vx + 0.001, -0.635, vx - 0.016, -0.66]);
        if (lod >= 2) { ctx.fillStyle = 'rgba(0,0,0,0.3)'; poly(ctx, [vx + 0.001, -0.784, vx + 0.009, -0.784, vx + 0.017, -0.66, vx + 0.001, -0.635]); }
      }
      if (lod >= 1) {
        ctx.fillStyle = rs >= 0 ? c.coatB : c.coatD;
        poly(ctx, [vx - 0.05, -0.814, vx - 0.002, -0.632, vx - 0.062, -0.705, vx - 0.088, -0.79]);
        ctx.fillStyle = rs >= 0 ? c.coatL : c.coatB;
        poly(ctx, [vx + 0.056, -0.814, vx + 0.004, -0.632, vx + 0.066, -0.705, vx + 0.094, -0.79]);
        if (ow > 0) {
          ctx.strokeStyle = c.ink; ctx.lineWidth = ow;
          ctx.beginPath();
          ctx.moveTo(vx - 0.05, -0.814); ctx.lineTo(vx - 0.002, -0.632); ctx.lineTo(vx - 0.062, -0.705); ctx.lineTo(vx - 0.088, -0.79);
          ctx.moveTo(vx + 0.056, -0.814); ctx.lineTo(vx + 0.004, -0.632); ctx.lineTo(vx + 0.066, -0.705); ctx.lineTo(vx + 0.094, -0.79);
          ctx.stroke();
        }
      }
    } else if (lod >= 2) {
      ctx.strokeStyle = c.coatD; ctx.lineWidth = 0.008;
      ctx.beginPath(); ctx.moveTo(vx, -0.8); ctx.lineTo(vx + 0.004, hem); ctx.stroke();
      ctx.strokeStyle = c.shirt; ctx.lineWidth = 0.004;
      ctx.beginPath(); ctx.moveTo(vx - 0.02, -0.8); ctx.lineTo(vx - 0.022, -0.74); ctx.moveTo(vx + 0.02, -0.8); ctx.lineTo(vx + 0.022, -0.74); ctx.stroke();
    }
    if (lod >= 2) {
      ctx.strokeStyle = c.coatD; ctx.lineWidth = 0.007;
      ctx.beginPath();
      if (hat !== 'hood') { ctx.moveTo(vx + 0.003, -0.632); ctx.lineTo(vx + 0.012 + flF * 0.5, hem); }
      ctx.moveTo(bw * 0.3, -0.54); ctx.lineTo(bw * 0.55 + flF, hem + 0.004);
      ctx.moveTo(-bw * 0.4, -0.54); ctx.lineTo(-bw * 0.7 + flB, hem + 0.006);
      ctx.moveTo(bw * 0.92, -0.72); ctx.quadraticCurveTo(bw * 0.6, -0.68, bw * 0.4, -0.66);
      ctx.stroke();
      if (hat !== 'hood') {
        ctx.fillStyle = c.coatD; ctx.fillRect(-bw * 0.98, -0.575, bw * 1.96, 0.024);
        ctx.fillStyle = c.itemL; ctx.fillRect(vx - 0.012, -0.578, 0.024, 0.03);
      }
    }
    if (lod >= 3) {
      ctx.fillStyle = c.coatD;
      ctx.fillRect(-bw * 0.65, -0.47, bw * 0.45, 0.01); ctx.fillRect(bw * 0.3, -0.47, bw * 0.45, 0.01);
      dot(ctx, vx + 0.024, -0.6, 0.007, c.ink); dot(ctx, vx + 0.024, -0.52, 0.007, c.ink); dot(ctx, vx + 0.024, -0.44, 0.007, c.ink);
    }
    if (ow > 0) { ctx.strokeStyle = c.ink; ctx.lineWidth = ow * 2; coatPath(ctx, bw, hem, flB, flF); ctx.stroke(); }
    // rim light along the lit edge of the coat and the shoulder top
    if (lit && lod >= 1 || (lod === 0 && ra > 0)) {
      ctx.strokeStyle = c.rim; ctx.lineWidth = lod === 0 ? 0.03 : 0.014 * Math.max(ra, 0.7);
      ctx.save(); if (rs < 0) { ctx.scale(-1, 1); }
      ctx.beginPath();
      ctx.moveTo(bw * 0.3, -0.818); ctx.quadraticCurveTo(bw * 1.0, -0.81, bw * 1.03, -0.74);
      ctx.lineTo(bw * 0.99, -0.56); ctx.lineTo(bw * 1.12, hem + 0.01);
      ctx.stroke();
      if (back) {
        ctx.scale(-1, 1); ctx.beginPath();
        ctx.moveTo(bw * 0.3, -0.818); ctx.quadraticCurveTo(bw * 1.0, -0.81, bw * 1.03, -0.74); ctx.lineTo(bw * 0.99, -0.56);
        ctx.stroke();
      }
      ctx.restore();
    }
    if (near > 0.3 && lod >= 1) {
      ctx.strokeStyle = c.rimS; ctx.lineWidth = 0.012;
      ctx.beginPath(); ctx.moveTo(-bw * 0.8, -0.81); ctx.quadraticCurveTo(0, -0.83, bw * 0.8, -0.81); ctx.stroke();
    }
    // rifle sits between the torso and the front arm
    if (!dead && item === 'rifle') {
      if (aim) { rifle(ctx, c, 0.1, -0.77, -0.03, lod, ow, rs); } else { rifle(ctx, c, 0.02, -0.58, -0.85, lod, ow, rs); }
    }
    head(ctx, c, L, lod, rs, ow, hdx, hdy, back, item === 'phone' && !dead);
    if (!dead && item === 'umbrella' && !run) { umbrella(ctx, c, AF[4], AF[5], lod, ow, t, rs); }
    if (!dead && item === 'briefcase' && !run) { briefcase(ctx, c, AF[4], AF[5], lod, ow, moving ? -sw * 0.08 : 0); }
    limb(ctx, AF, 0.07, 0.062, c.coat, c.ink, ow);
    if (lit && lod >= 1 && ra > 0) {
      ctx.strokeStyle = c.rim; ctx.lineWidth = 0.008 * ra;
      ctx.beginPath(); ctx.moveTo(AF[0] + rsd * 0.03, AF[1]); ctx.lineTo(AF[2] + rsd * 0.03, AF[3]); ctx.lineTo(AF[4] + rsd * 0.025, AF[5]); ctx.stroke();
    }
    if (lod >= 2) {
      ctx.strokeStyle = c.shirt; ctx.lineWidth = 0.05;
      ctx.beginPath();
      ctx.moveTo(AF[2] + (AF[4] - AF[2]) * 0.8, AF[3] + (AF[5] - AF[3]) * 0.8); ctx.lineTo(AF[2] + (AF[4] - AF[2]) * 0.86, AF[3] + (AF[5] - AF[3]) * 0.86);
      ctx.stroke();
    }
    hand(ctx, AF, c.skin, c.ink, ow, lod);
    if (!dead) {
      if (item === 'phone') { phone(ctx, c, AF[4], AF[5], lod); }
      else if (item === 'cigarette' && !run) { cigarette(ctx, c, t, drag, AF[4], AF[5], lod); }
    }
    leanPop(ctx, lean);
    ctx.restore();
  }

  // The upper body leans around the hips (running, walking).
  function leanPush(ctx, lean) { if (lean) { ctx.save(); ctx.translate(0, -0.47); ctx.rotate(lean); ctx.translate(0, 0.47); } }
  function leanPop(ctx, lean) { if (lean) { ctx.restore(); } }

  function head(ctx, c, L, lod, rs, ow, hdx, hdy, back, phoneGlow) {
    var hx = hdx, hy = -0.9 + hdy, hat = L.hat || 'none', R = 0.085, side = rs >= 0 ? 1 : -1, ra = Math.abs(rs);
    ctx.fillStyle = c.skinD; ctx.fillRect(hx - 0.03, -0.85, 0.058, 0.06);
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(hx - 0.03, -0.85, 0.058, 0.02);
    if (hat === 'hood') { dot(ctx, hx - 0.014, hy - 0.004, 0.107, c.coatB); if (ow > 0) { ctx.strokeStyle = c.ink; ctx.lineWidth = ow * 2; ctx.stroke(); } }
    if (hat === 'none' && L.build === 'slim') {
      ctx.fillStyle = c.hair;
      ctx.beginPath(); ctx.moveTo(hx - 0.09, hy - 0.01); ctx.quadraticCurveTo(hx - 0.1, hy + 0.1, hx - 0.05, hy + 0.11);
      ctx.lineTo(hx - 0.01, hy + 0.06); ctx.lineTo(hx - 0.02, hy - 0.04); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = c.skin;
    ctx.beginPath(); ctx.arc(hx, hy, R, 0, TAU); ctx.fill();
    if (ow > 0) { ctx.strokeStyle = c.ink; ctx.lineWidth = ow * 2; ctx.stroke(); }
    if (lod >= 2) {
      // nose, then features
      ctx.fillStyle = c.skin;
      ctx.beginPath(); ctx.moveTo(hx + 0.074, hy - 0.02); ctx.lineTo(hx + 0.101, hy + 0.016); ctx.lineTo(hx + 0.086, hy + 0.025); ctx.lineTo(hx + 0.072, hy + 0.022); ctx.closePath(); ctx.fill();
      if (ow > 0) { ctx.strokeStyle = c.ink; ctx.lineWidth = ow * 1.5; ctx.beginPath(); ctx.moveTo(hx + 0.078, hy - 0.016); ctx.lineTo(hx + 0.101, hy + 0.016); ctx.lineTo(hx + 0.086, hy + 0.025); ctx.stroke(); }
      ctx.fillStyle = 'rgba(10,6,6,0.42)';
      poly(ctx, [hx + 0.012, hy - 0.024, hx + 0.083, hy - 0.028, hx + 0.085, hy - 0.004, hx + 0.015, hy - 0.002]);
      ctx.fillStyle = c.ink;
      ctx.beginPath(); ctx.ellipse(hx + 0.056, hy - 0.012, 0.01, 0.0055, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = c.hair; ctx.lineWidth = 0.007;
      ctx.beginPath(); ctx.moveTo(hx + 0.036, hy - 0.031); ctx.lineTo(hx + 0.079, hy - 0.029); ctx.stroke();
      ctx.strokeStyle = c.ink; ctx.lineWidth = 0.006;
      ctx.beginPath(); ctx.moveTo(hx + 0.05, hy + 0.046); ctx.lineTo(hx + 0.076, hy + 0.043); ctx.stroke();
      ctx.strokeStyle = c.skinS; ctx.lineWidth = 0.016;
      ctx.beginPath(); ctx.arc(hx, hy, R * 0.93, 0.25, 1.65); ctx.stroke();
      ctx.fillStyle = c.skinD; ctx.beginPath(); ctx.ellipse(hx - 0.014, hy + 0.006, 0.014, 0.022, 0, 0, TAU); ctx.fill();
      if (lod >= 3) {
        dot(ctx, hx + 0.059, hy - 0.014, 0.0022, 'rgba(255,240,220,0.75)');
        ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.beginPath(); ctx.ellipse(hx + 0.036, hy + 0.024, 0.022, 0.012, 0, 0, TAU); ctx.fill();
      }
    } else if (lod === 1) {
      ctx.fillStyle = 'rgba(10,6,6,0.45)'; ctx.fillRect(hx + 0.015, hy - 0.024, 0.07, 0.02);
    }
    headShade(ctx, hx, hy, side, back ? 0.55 : 0.28 + 0.2 * (1 - ra));
    if (back) { headShade(ctx, hx, hy, -side, 0.4); }
    if (phoneGlow && lod >= 1) {
      ctx.globalAlpha = 0.22; ctx.fillStyle = 'rgb(140,200,235)';
      ctx.beginPath(); ctx.arc(hx + 0.02, hy + 0.01, 0.06, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
    }
    // hair and hats
    if (hat === 'hood') {
      ctx.fillStyle = c.coatB;
      ctx.beginPath(); ctx.arc(hx - 0.014, hy - 0.004, 0.107, 0, TAU);
      ctx.moveTo(hx + 0.094, hy + 0.012); ctx.ellipse(hx + 0.026, hy + 0.012, 0.068, 0.082, 0, TAU, 0, true); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.beginPath(); ctx.ellipse(hx + 0.03, hy - 0.04, 0.06, 0.03, 0, 0, TAU); ctx.fill();
      if (ow > 0) { ctx.strokeStyle = c.ink; ctx.lineWidth = ow * 1.5; ctx.beginPath(); ctx.ellipse(hx + 0.026, hy + 0.012, 0.068, 0.082, 0, PI * 1.2, PI * 2.3); ctx.stroke(); }
    } else if (hat === 'cap') {
      ctx.fillStyle = c.hair; ctx.fillRect(hx - 0.088, hy - 0.02, 0.03, 0.05);
      ctx.fillStyle = c.hat;
      ctx.beginPath();
      ctx.moveTo(hx - 0.09, hy - 0.016); ctx.quadraticCurveTo(hx - 0.098, hy - 0.1, hx - 0.01, hy - 0.106);
      ctx.quadraticCurveTo(hx + 0.08, hy - 0.1, hx + 0.098, hy - 0.06); ctx.lineTo(hx + 0.136, hy - 0.046);
      ctx.quadraticCurveTo(hx + 0.1, hy - 0.034, hx + 0.06, hy - 0.04); ctx.lineTo(hx - 0.09, hy - 0.016);
      ctx.closePath(); ctx.fill();
      if (ow > 0) { ctx.strokeStyle = c.ink; ctx.lineWidth = ow * 2; ctx.stroke(); }
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(hx + 0.01, hy - 0.04, 0.08, 0.02);
      ctx.strokeStyle = c.rim; ctx.lineWidth = 0.01 * Math.max(ra, 0.5);
      ctx.beginPath(); ctx.moveTo(hx - 0.06 * side, hy - 0.1); ctx.quadraticCurveTo(hx + 0.04 * side, hy - 0.104, hx + 0.09 * side, hy - 0.064); ctx.stroke();
    } else {
      ctx.fillStyle = c.hair;
      ctx.beginPath(); ctx.arc(hx, hy, 0.089, PI * 0.82, PI * 1.92);
      ctx.quadraticCurveTo(hx - 0.01, hy - 0.055, hx - 0.07, hy + 0.05); ctx.closePath(); ctx.fill();
      if (hat === 'fedora') {
        ctx.fillStyle = c.hat;
        ctx.beginPath();
        ctx.moveTo(hx - 0.072, hy - 0.062); ctx.lineTo(hx - 0.066, hy - 0.13);
        ctx.quadraticCurveTo(hx - 0.06, hy - 0.151, hx - 0.03, hy - 0.149);
        ctx.quadraticCurveTo(hx, hy - 0.136, hx + 0.03, hy - 0.151);
        ctx.quadraticCurveTo(hx + 0.064, hy - 0.151, hx + 0.068, hy - 0.128);
        ctx.lineTo(hx + 0.074, hy - 0.062); ctx.closePath(); ctx.fill();
        if (ow > 0) { ctx.strokeStyle = c.ink; ctx.lineWidth = ow * 2; ctx.stroke(); }
        ctx.fillStyle = c.band; ctx.fillRect(hx - 0.073, hy - 0.093, 0.147, 0.02);
        ctx.fillStyle = c.hat;
        ctx.beginPath();
        ctx.moveTo(hx - 0.132, hy - 0.058); ctx.quadraticCurveTo(hx - 0.12, hy - 0.075, hx - 0.07, hy - 0.075);
        ctx.lineTo(hx + 0.07, hy - 0.077); ctx.quadraticCurveTo(hx + 0.13, hy - 0.077, hx + 0.15, hy - 0.054);
        ctx.quadraticCurveTo(hx + 0.1, hy - 0.058, hx + 0.07, hy - 0.06); ctx.lineTo(hx - 0.07, hy - 0.058);
        ctx.quadraticCurveTo(hx - 0.11, hy - 0.055, hx - 0.132, hy - 0.058); ctx.closePath(); ctx.fill();
        if (ow > 0) { ctx.strokeStyle = c.ink; ctx.lineWidth = ow * 2; ctx.stroke(); }
        ctx.fillStyle = 'rgba(0,0,0,0.38)'; ctx.fillRect(hx - 0.01, hy - 0.058, 0.1, 0.034);
        ctx.strokeStyle = c.rim; ctx.lineWidth = 0.01 * Math.max(ra, 0.5);
        ctx.beginPath();
        if (side > 0) { ctx.moveTo(hx + 0.01, hy - 0.077); ctx.lineTo(hx + 0.07, hy - 0.077); ctx.quadraticCurveTo(hx + 0.13, hy - 0.077, hx + 0.148, hy - 0.056); ctx.moveTo(hx + 0.068, hy - 0.128); ctx.lineTo(hx + 0.073, hy - 0.095); }
        else { ctx.moveTo(hx - 0.01, hy - 0.075); ctx.lineTo(hx - 0.07, hy - 0.075); ctx.quadraticCurveTo(hx - 0.12, hy - 0.075, hx - 0.13, hy - 0.06); ctx.moveTo(hx - 0.066, hy - 0.13); ctx.lineTo(hx - 0.072, hy - 0.095); }
        ctx.stroke();
      } else if (lod >= 2) {
        ctx.strokeStyle = c.rimS; ctx.lineWidth = 0.008;
        ctx.beginPath(); ctx.arc(hx, hy, 0.084, side > 0 ? -1.4 : PI + 0.5, side > 0 ? -0.5 : PI + 1.4); ctx.stroke();
      }
    }
    // rim on the lit side of the face / back of the head
    if (ra > 0 || back) {
      ctx.strokeStyle = c.rim; ctx.lineWidth = lod === 0 ? 0.025 : 0.013 * Math.max(ra, 0.7);
      ctx.beginPath();
      if (side > 0 || back) { ctx.arc(hx, hy, R * 0.98, -0.9, 0.7); }
      if (side < 0 || back) { ctx.moveTo(hx + Math.cos(PI - 0.7) * R * 0.98, hy + Math.sin(PI - 0.7) * R * 0.98); ctx.arc(hx, hy, R * 0.98, PI - 0.7, PI + 0.9); }
      ctx.stroke();
    }
  }

  function rifle(ctx, c, gx, gy, ang, lod, ow, rs) {
    ctx.save(); ctx.translate(gx, gy); ctx.rotate(ang);
    ctx.fillStyle = c.item;
    ctx.beginPath();
    ctx.moveTo(-0.225, -0.012); ctx.lineTo(-0.04, -0.016); ctx.lineTo(0, -0.022); ctx.lineTo(0.26, -0.022); ctx.lineTo(0.26, 0.004);
    ctx.lineTo(0.1, 0.004); ctx.lineTo(0.1, 0.05); ctx.lineTo(0.07, 0.052); ctx.lineTo(0.064, 0.004);
    ctx.lineTo(0.028, 0.004); ctx.lineTo(0.018, 0.045); ctx.lineTo(-0.006, 0.04); ctx.lineTo(0, 0.012);
    ctx.lineTo(-0.2, 0.04); ctx.lineTo(-0.228, 0.034); ctx.closePath(); ctx.fill();
    if (ow > 0) { ctx.strokeStyle = c.ink; ctx.lineWidth = ow * 1.5; ctx.stroke(); }
    ctx.fillRect(0.25, -0.016, 0.2, 0.011);
    if (lod >= 1) {
      ctx.fillRect(0.03, -0.05, 0.13, 0.018); ctx.fillRect(0.016, -0.056, 0.032, 0.028); ctx.fillRect(0.14, -0.06, 0.042, 0.034);
      ctx.fillRect(0.06, -0.034, 0.012, 0.014); ctx.fillRect(0.12, -0.034, 0.012, 0.014);
    }
    if (lod >= 2) {
      ctx.fillStyle = c.itemL;
      ctx.fillRect(0.03, -0.05, 0.13, 0.004); ctx.fillRect(0.26, -0.016, 0.19, 0.003); ctx.fillRect(-0.2, -0.012, 0.18, 0.004);
      dot(ctx, 0.183, -0.043, 0.007, 'rgba(232,163,61,0.7)');
      if (lod >= 3) { ctx.strokeStyle = c.coatD; ctx.lineWidth = 0.006; ctx.beginPath(); ctx.moveTo(-0.18, 0.035); ctx.quadraticCurveTo(0.02, 0.12, 0.2, 0.004); ctx.stroke(); }
    }
    ctx.restore();
  }

  function briefcase(ctx, c, hx, hy, lod, ow, swing) {
    ctx.save(); ctx.translate(hx, hy); ctx.rotate(swing);
    ctx.strokeStyle = c.brief; ctx.lineWidth = 0.011;
    ctx.beginPath(); ctx.moveTo(-0.024, 0.032); ctx.quadraticCurveTo(0, -0.012, 0.024, 0.032); ctx.stroke();
    ctx.fillStyle = c.brief;
    ctx.beginPath(); ctx.rect(-0.075, 0.028, 0.15, 0.105); ctx.fill();
    if (ow > 0) { ctx.strokeStyle = c.ink; ctx.lineWidth = ow * 2; ctx.stroke(); }
    if (lod >= 2) {
      ctx.fillStyle = c.briefL; ctx.fillRect(-0.075, 0.028, 0.15, 0.007);
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(-0.075, 0.06, 0.15, 0.004);
      ctx.fillStyle = c.itemL; ctx.fillRect(-0.05, 0.034, 0.014, 0.012); ctx.fillRect(0.036, 0.034, 0.014, 0.012);
    }
    ctx.restore();
  }

  function phone(ctx, c, hx, hy, lod) {
    ctx.fillStyle = c.item; ctx.fillRect(hx - 0.004, hy - 0.05, 0.022, 0.064);
    ctx.fillStyle = 'rgba(150,210,240,0.9)';
    if (lod === 0) { ctx.fillRect(hx, hy - 0.04, 0.03, 0.03); return; }
    ctx.fillRect(hx + 0.014, hy - 0.044, 0.006, 0.05);
    glowHalo(ctx, '#8ccbec', hx + 0.02, hy - 0.02, 0.06, 0.06, 0.35);
  }

  function cigarette(ctx, c, t, drag, hx, hy, lod) {
    var tx = drag ? hx + 0.04 : hx + 0.03, ty = drag ? hy - 0.005 : hy - 0.01, i, k, x, y, sway;
    seg(ctx, tx - 0.045, ty, tx, ty, 0.009, '#d8d3c6');
    if (lod >= 2) { seg(ctx, tx - 0.045, ty, tx - 0.032, ty, 0.0095, '#b8783a'); }
    glowHalo(ctx, '#ff8a3a', tx + 0.002, ty, 0.03, 0.03, drag ? 0.9 : 0.45);
    dot(ctx, tx + 0.003, ty, 0.008, drag ? '#ffc060' : '#d0602a');
    if (lod >= 1) {
      ctx.lineCap = 'round';
      for (i = 0; i < 2; i++) {
        ctx.strokeStyle = 'rgba(185,190,198,' + (i ? 0.08 : 0.2) + ')'; ctx.lineWidth = i ? 0.02 : 0.007;
        ctx.beginPath(); ctx.moveTo(tx + 0.005, ty - 0.008);
        for (k = 1; k <= 6; k++) {
          sway = Math.sin(t * 1.3 - k * 0.9 + c.seed) * 0.012 * k;
          x = tx + 0.005 + sway + k * 0.006; y = ty - 0.008 - k * (i ? 0.055 : 0.04);
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      for (i = 0; i < 3; i++) {
        k = (t * 0.35 + i / 3 + c.seed) % 1;
        dot(ctx, tx + 0.01 + k * 0.06, ty - 0.03 - k * 0.28, 0.012 + k * 0.04, 'rgba(180,186,192,' + (0.12 * (1 - k)) + ')');
      }
    }
  }

  function umbrella(ctx, c, hx, hy, lod, ow, t, rs) {
    var cx = hx - 0.015, rim = -1.15, rx = 0.36, ry = 0.15, n = 6, i, x0, x1, f, side = rs >= 0 ? 1 : -1;
    ctx.strokeStyle = c.item; ctx.lineWidth = 0.012;
    ctx.beginPath(); ctx.moveTo(hx, hy + 0.06); ctx.lineTo(cx, rim - ry - 0.03); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(hx, hy + 0.06); ctx.quadraticCurveTo(hx, hy + 0.1, hx - 0.03, hy + 0.09); ctx.stroke();
    ctx.fillStyle = c.umb;
    ctx.beginPath();
    ctx.moveTo(cx - rx, rim); ctx.ellipse(cx, rim, rx, ry, 0, PI, TAU);
    for (i = n; i > 0; i--) {
      x0 = cx - rx + i * (2 * rx / n); x1 = x0 - 2 * rx / n;
      ctx.quadraticCurveTo((x0 + x1) / 2, rim - 0.035, x1, rim);
    }
    ctx.closePath(); ctx.fill();
    if (ow > 0) { ctx.strokeStyle = c.ink; ctx.lineWidth = ow * 2; ctx.stroke(); }
    if (lod >= 1) {
      ctx.fillStyle = c.umbD;
      for (i = 0; i < n; i += 2) {
        x0 = cx - rx + i * (2 * rx / n); x1 = x0 + 2 * rx / n;
        ctx.beginPath(); ctx.moveTo(cx, rim - ry); ctx.lineTo(x0, rim); ctx.quadraticCurveTo((x0 + x1) / 2, rim - 0.035, x1, rim); ctx.closePath(); ctx.fill();
      }
    }
    if (lod >= 2) {
      ctx.strokeStyle = c.ink; ctx.lineWidth = 0.004;
      ctx.beginPath();
      for (i = 1; i < n; i++) { ctx.moveTo(cx, rim - ry); ctx.lineTo(cx - rx + i * (2 * rx / n), rim); }
      ctx.stroke();
      if (K.P.rain > 0.2) {
        ctx.strokeStyle = 'rgba(190,206,220,0.5)'; ctx.lineWidth = 0.004;
        ctx.beginPath();
        for (i = 0; i <= n; i++) {
          f = (t * 1.8 + i * 0.37) % 1;
          x0 = cx - rx + i * (2 * rx / n);
          ctx.moveTo(x0, rim + f * 0.3); ctx.lineTo(x0, rim + f * 0.3 + 0.025);
        }
        ctx.stroke();
      }
    }
    ctx.strokeStyle = c.rim; ctx.lineWidth = lod === 0 ? 0.025 : 0.012;
    ctx.beginPath(); ctx.ellipse(cx, rim, rx * 0.98, ry * 0.96, 0, side > 0 ? PI * 1.55 : PI * 1.1, side > 0 ? PI * 1.92 : PI * 1.45); ctx.stroke();
    ctx.fillStyle = c.item; ctx.fillRect(cx - 0.006, rim - ry - 0.04, 0.012, 0.03);
  }

  // Screen-space markers: alert "!", target chevrons (unscoped), ally diamonds (unscoped).
  function markers(ctx, state, view, vw, vh, scoped) {
    var ents = state.entities || [], rules = (state.mission && state.mission.rules) || {};
    var mark = !scoped && rules.markTargets !== false, t = num(state.t, 0), i, e, p, lift, sz;
    var pulse = 0.7 + 0.3 * Math.sin(t * 5);
    ctx.lineJoin = 'round';
    for (i = 0; i < ents.length; i++) {
      e = ents[i];
      if (!e || e.removed || e.alive === false || e.dead || !(e.dist > 0)) { continue; }
      p = LW.cam.worldToScreen(view, vw, vh, e.x, e.y - LW.personHeight(e) * (e.look && e.look.item === 'umbrella' ? 1.3 : 1.1));
      if (p.x < -30 || p.x > vw + 30 || p.y < -40 || p.y > vh + 40) { continue; }
      lift = 0;
      if (e.state === 'alert') {
        ctx.font = 'bold 16px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 3;
        ctx.strokeText('!', p.x, p.y - 3);
        ctx.fillStyle = '#e8a33d'; ctx.fillText('!', p.x, p.y - 3);
        lift = 17;
      }
      if (mark && (e.role === 'target' || e.role === 'attacker')) {
        sz = 6;
        ctx.fillStyle = 'rgba(232,163,61,' + pulse + ')';
        ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(p.x - sz, p.y - lift - 6 - sz); ctx.lineTo(p.x, p.y - lift - 6); ctx.lineTo(p.x + sz, p.y - lift - 6 - sz);
        ctx.lineTo(p.x, p.y - lift - 6 - sz * 0.45); ctx.closePath();
        ctx.stroke(); ctx.fill();
      } else if (!scoped && e.role === 'ally') {
        ctx.fillStyle = 'rgba(127,196,232,0.85)';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - lift - 12); ctx.lineTo(p.x + 3.5, p.y - lift - 8.5); ctx.lineTo(p.x, p.y - lift - 5); ctx.lineTo(p.x - 3.5, p.y - lift - 8.5);
        ctx.closePath(); ctx.fill();
      }
    }
  }

  // ---------- effects (world space) ----------

  function effects(ctx, state, t) {
    var fx = state.effects || [], i, j, f, age, d, u, k, sd, ang, r, cx, cy;
    for (i = 0; i < fx.length; i++) {
      f = fx[i];
      if (!f || f.type === 'muzzle' || typeof f.x !== 'number' || typeof f.y !== 'number') { continue; }
      age = t - num(f.t0, t);
      if (age < 0 || age > 1) { continue; }
      d = num(f.dist, 200) > 0 ? num(f.dist, 200) : 200; u = 2000 / d;
      if (f.x + u * 3 < VR.x0 || f.x - u * 3 > VR.x1 || f.y + u * 3 < VR.y0 || f.y - u * 3 > VR.y1) { continue; }
      sd = hash1(num(f.t0, 0) * 13.7 + f.x * 0.37);
      if (f.type === 'impact') {
        if (age > 0.8) { continue; }
        k = age / 0.8;
        ctx.fillStyle = 'rgba(150,142,128,' + (0.45 * (1 - k)) + ')';
        ctx.beginPath();
        for (j = 0; j < 5; j++) {
          ang = sd * 6 + j * 1.4;
          r = u * (0.15 + k * 0.6) * (0.7 + 0.3 * hash1(sd + j));
          cx = f.x + Math.cos(ang) * u * 0.32 * k; cy = f.y - k * u * 0.45 + Math.sin(ang) * u * 0.15 * k;
          ctx.moveTo(cx + r, cy); ctx.arc(cx, cy, r, 0, TAU);
        }
        ctx.fill();
        ctx.fillStyle = 'rgba(20,18,16,' + (0.6 * (1 - k)) + ')';
        ctx.beginPath(); ctx.arc(f.x, f.y, u * 0.06, 0, TAU); ctx.fill();
        if (age < 0.1) { sparks(ctx, f, u, sd, age / 0.1); }
      } else if (f.type === 'spark') {
        if (age > 0.25) { continue; }
        sparks(ctx, f, u, sd, age / 0.25);
      } else if (f.type === 'blood') {
        if (age > 0.9) { continue; }
        k = age / 0.9;
        ctx.fillStyle = 'rgba(96,8,14,' + (0.6 * (1 - k) * (1 - k)) + ')';
        ctx.beginPath();
        for (j = 0; j < 7; j++) {
          ang = sd * 6 + j * 0.9;
          r = u * (0.05 + 0.28 * k) * (0.6 + 0.4 * hash1(sd * 2 + j));
          cx = f.x + Math.cos(ang) * u * (0.1 + 0.55 * k) * hash1(sd * 3 + j);
          cy = f.y + Math.sin(ang) * u * (0.1 + 0.35 * k) * hash1(sd * 5 + j) + k * k * u * 0.35;
          ctx.moveTo(cx + r, cy); ctx.arc(cx, cy, r, 0, TAU);
        }
        ctx.fill();
      }
    }
  }

  function sparks(ctx, f, u, sd, k) {
    var j, ang, l;
    ctx.strokeStyle = 'rgba(255,214,150,' + (1 - k) + ')';
    ctx.lineWidth = Math.max(PX, u * 0.04); ctx.lineCap = 'round';
    ctx.beginPath();
    for (j = 0; j < 6; j++) {
      ang = -Math.PI * (0.1 + 0.8 * hash1(sd * 7 + j));
      l = u * (0.2 + 0.7 * k);
      ctx.moveTo(f.x + Math.cos(ang) * l * 0.4, f.y + Math.sin(ang) * l * 0.4 + k * k * u * 0.2);
      ctx.lineTo(f.x + Math.cos(ang) * l, f.y + Math.sin(ang) * l + k * k * u * 0.4);
    }
    ctx.stroke();
  }

  // Rain splashes on ground bands and wall tops in the scoped view (world space, sized by distance).
  function splashes(ctx, t) {
    var P = K.P, n = Math.round(30 * P.rain), cand = K.cand, nc = 0, i, g, ph, cyc, f, sx, sy, r, y0, y1;
    for (i = 0; i < K.grounds.length; i++) {
      g = K.grounds[i];
      if (g.type !== 'ground') { continue; }
      y0 = Math.max(g.gy, VR.y0); y1 = Math.min(g.yEnd, VR.y1);
      if (y1 > y0) { g.sy0 = y0; g.sy1 = y1; cand[nc++] = g; }
    }
    for (i = 0; i < K.walls.length; i++) {
      g = K.walls[i];
      if (g.by >= VR.y0 && g.by <= VR.y1 && g.bx < VR.x1 && g.bx + g.bw > VR.x0) { g.sy0 = g.by; g.sy1 = g.by; cand[nc++] = g; }
    }
    if (!nc) { return; }
    ctx.strokeStyle = 'rgba(200,215,230,0.5)'; ctx.lineWidth = PX; ctx.lineCap = 'round';
    ctx.beginPath();
    for (i = 0; i < n; i++) {
      ph = t * 2.2 + i * 0.618; cyc = Math.floor(ph); f = ph - cyc;
      g = cand[Math.floor(hash2(i, cyc) * nc) % nc];
      sx = VR.x0 + hash2(cyc, i + 0.5) * (VR.x1 - VR.x0);
      if (g.type === 'wall' && (sx < g.bx || sx > g.bx + g.bw)) { continue; }
      sy = g.sy0 + hash2(i + 9.1, cyc) * (g.sy1 - g.sy0);
      r = g.u * 0.05 * (0.6 + f);
      ctx.moveTo(sx - r * 0.3, sy); ctx.lineTo(sx - r, sy - r * 1.3 * (1 - f));
      ctx.moveTo(sx + r * 0.3, sy); ctx.lineTo(sx + r, sy - r * 1.3 * (1 - f));
      ctx.moveTo(sx, sy - r * 0.2); ctx.lineTo(sx, sy - r * (0.5 + 1.2 * (1 - f)));
      ctx.moveTo(sx + r * 1.6 * f, sy); ctx.ellipse(sx, sy, r * 1.6 * f + 0.001, r * 0.4 * f + 0.001, 0, 0, TAU);
    }
    ctx.stroke();
  }

  // ---------- cached gradients ----------

  var HALO = { moon: '#c8d4e0', glow: '#8a9aaa', sun: '#f09050', dawn: '#f4c8b8', diffuse: '#e2e8e8' };

  // World/unit-space gradients, created once per (mission, context).
  function grad(name) {
    var g = K.g[name], ctx = K.gctx, P = K.P, i, st, c;
    if (g) { return g; }
    if (name === 'sky') {
      g = ctx.createLinearGradient(0, 0, 0, 1000);
      st = P.sky;
      for (i = 0; i < st.length; i++) { g.addColorStop(st[i][0], st[i][1]); }
    } else if (name === 'lamp') {
      g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0, 'rgba(255,220,150,0.6)'); g.addColorStop(0.2, 'rgba(232,163,61,0.25)'); g.addColorStop(1, 'rgba(232,163,61,0)');
    } else if (name === 'cone') {
      g = ctx.createLinearGradient(0, -6.4, 0, 0);
      g.addColorStop(0, 'rgba(255,214,140,0.17)'); g.addColorStop(0.6, 'rgba(232,163,61,0.07)'); g.addColorStop(1, 'rgba(232,163,61,0.02)');
    } else if (name === 'halo') {
      c = rgb(HALO[P.sky2] || HALO.moon);
      g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0, css(c, 0.55)); g.addColorStop(0.35, css(c, 0.16)); g.addColorStop(1, css(c, 0));
    } else if (name === 'down') {
      c = (P.fog >= 1 || P.sky2 === 'dawn') ? K.haze : [0, 0, 0];
      g = ctx.createLinearGradient(0, 0, 0, 1);
      g.addColorStop(0, css(c, 0)); g.addColorStop(1, css(c, P.fog >= 1 ? 0.3 : 0.32));
    } else if (name === 'veil') {
      c = mix(K.haze, [215, 222, 226], P.fog * 0.25);
      g = ctx.createLinearGradient(0, 380, 0, 1000);
      g.addColorStop(0, css(c, 0)); g.addColorStop(0.5, css(c, 1)); g.addColorStop(1, css(c, 0.45));
    } else if (name === 'horizon') {
      c = rgb(P.glow);
      g = ctx.createLinearGradient(0, 420, 0, 960);
      g.addColorStop(0, css(c, 0)); g.addColorStop(0.75, css(c, P.glowA)); g.addColorStop(1, css(c, P.glowA * 0.5));
    } else if (name === 'waterSheen') {
      c = mix(K.haze, rgb(P.sky[P.sky.length - 1][1]), 0.5);
      g = ctx.createLinearGradient(0, 0, 0, 1);
      g.addColorStop(0, css(c, 0.22)); g.addColorStop(0.4, css(c, 0.04)); g.addColorStop(1, css(c, 0.1));
    } else {
      c = rgb(P.haze);
      g = ctx.createLinearGradient(0, 0, 0, 1);
      g.addColorStop(0, css(c, 0)); g.addColorStop(0.5, css(mix(c, [230, 235, 235], 0.3), 0.5)); g.addColorStop(1, css(c, 0));
    }
    K.g[name] = g;
    return g;
  }

  // Unit radial glow per colour (neon, tail lights, embers).
  function glowGrad(col) {
    var key = 'glow|' + col, g = K.g[key], c;
    if (g) { return g; }
    c = rgb(col);
    g = K.gctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, css(c, 0.55)); g.addColorStop(0.3, css(c, 0.22)); g.addColorStop(1, css(c, 0));
    K.g[key] = g;
    return g;
  }

  // Screen-space gradients keyed by geometry (cleared on resize).
  function sgrad(key, make) {
    var g = K.sg[key];
    if (!g) { g = make(K.gctx); K.sg[key] = g; }
    return g;
  }

  // ---------- sky ----------

  function halo(ctx, x, y, r, a) {
    ctx.save();
    ctx.translate(x, y); ctx.scale(r, r);
    ctx.globalAlpha = a; ctx.fillStyle = grad('halo');
    ctx.beginPath(); ctx.arc(0, 0, 1, 0, TAU); ctx.fill();
    ctx.restore();
  }

  // Rare lightning on storm missions: a double flicker every few periods. Purely visual.
  function lightning(t) {
    if (!K.P.storm) { return 0; }
    var period = 11, n = Math.floor(t / period), at = 2 + hash1(n * 3.1 + (K.seed % 97)) * 7, dt = t - n * period - at;
    if (hash1(n * 7.7 + 1.3) < 0.5 || dt < 0 || dt > 0.9) { return 0; }
    K.boltN = n; K.boltDt = dt;
    return dt < 0.06 ? 1 : dt < 0.12 ? 0.25 : dt < 0.2 ? 0.85 : Math.max(0, 1 - (dt - 0.2) / 0.7) * 0.45;
  }

  function bolt(ctx, flash) {
    var n = K.boltN, x = K.W * (0.1 + 0.8 * hash1(n * 1.7)), y = 0, j, b;
    if (K.boltDt > 0.25) { return; }
    ctx.strokeStyle = 'rgba(230,236,255,' + (0.9 * flash) + ')'; ctx.lineWidth = Math.max(PX, 2.2); ctx.lineJoin = 'miter';
    ctx.beginPath(); ctx.moveTo(x, y);
    for (j = 0; j < 14; j++) {
      x += (hash2(n, j) - 0.5) * 70; y += 28 + hash2(j, n) * 20;
      ctx.lineTo(x, y);
      if (j === 6) { b = x; }
    }
    ctx.moveTo(b, 230);
    for (j = 0; j < 5; j++) { b += (hash2(n + 9, j) - 0.3) * 60; ctx.lineTo(b, 230 + (j + 1) * 30); }
    ctx.stroke();
  }

  function drawSky(ctx, t, flash) {
    var P = K.P, W = K.W, m = P.sky2, i, av, off, span = K.cloudSpan, x0 = VR.x0 - 1, w = VR.x1 - VR.x0 + 2;
    ctx.fillStyle = grad('sky');
    ctx.fillRect(x0, VR.y0 - 1, w, VR.y1 - VR.y0 + 2);
    if (VR.y0 < 820) {
      if (P.stars > 0 && VR.y0 < 450) {
        ctx.fillStyle = 'rgb(220,226,236)';
        ctx.globalAlpha = P.stars * (0.55 + 0.25 * Math.sin(t * 1.7)); K.stars.fill(ctx);
        ctx.globalAlpha = P.stars * (0.55 + 0.25 * Math.sin(t * 2.3 + 2)); K.stars2.fill(ctx);
        ctx.globalAlpha = 1;
      }
      if (m === 'moon') {
        halo(ctx, W * 0.68, 150, 200, 0.55);
        dot(ctx, W * 0.68, 150, 26, '#e3e5da');
        ctx.fillStyle = 'rgba(60,70,80,0.12)';
        ctx.beginPath(); ctx.arc(W * 0.68 - 8, 144, 7, 0, TAU); ctx.moveTo(W * 0.68 + 15, 160); ctx.arc(W * 0.68 + 10, 160, 5, 0, TAU); ctx.fill();
      } else if (m === 'glow') {
        halo(ctx, W * 0.6, 160, 280, 0.3);
      } else if (m === 'sun') {
        halo(ctx, W * 0.3, 690, 340, 0.65);
        ctx.globalAlpha = 0.85; dot(ctx, W * 0.3, 690, 46, '#f0893e'); ctx.globalAlpha = 1;
      } else if (m === 'dawn') {
        halo(ctx, W * 0.78, 700, 380, 0.5);
        ctx.globalAlpha = 0.7; dot(ctx, W * 0.78, 700, 38, '#f4d8ca'); ctx.globalAlpha = 1;
      } else {
        halo(ctx, W * 0.5, 320, 460, 0.35);
      }
      if (flash > 0) {
        ctx.fillStyle = 'rgba(190,205,230,' + (0.45 * flash) + ')';
        ctx.fillRect(x0, VR.y0 - 1, w, Math.min(VR.y1, 900) - VR.y0 + 2);
        bolt(ctx, flash);
      }
      off = (t * 1.2) % span;
      ctx.fillStyle = K.cCloud2;
      ctx.save(); ctx.translate(off * 0.5, 0); K.clouds2.fill(ctx); ctx.translate(-span, 0); K.clouds2.fill(ctx); ctx.restore();
      ctx.fillStyle = flash > 0.5 ? 'rgba(150,165,190,0.5)' : K.cCloud;
      ctx.save(); ctx.translate(off, 0); K.clouds.fill(ctx); ctx.translate(-span, 0); K.clouds.fill(ctx); ctx.restore();
    }
    if (VR.y1 > 420) { ctx.fillStyle = grad('horizon'); ctx.fillRect(x0, Math.max(420, VR.y0 - 1), w, Math.min(960, VR.y1) - Math.max(420, VR.y0 - 1) + 1); }
    ctx.fillStyle = K.cFar; K.far.fill(ctx);
    ctx.fillStyle = K.cNear; K.near.fill(ctx);
    ctx.fillStyle = K.cNearRim; K.nearRim.fill(ctx);
    ctx.fillStyle = K.cSkyWin; K.skyWin.fill(ctx);
    ctx.fillStyle = K.cSkyWin2; K.skyWin2.fill(ctx);
    av = K.aviation;
    if (((t * 0.6) % 1) < 0.5) {
      ctx.fillStyle = 'rgba(255,70,60,' + (0.8 * (1 - hazeF(600) * 0.6)) + ')';
      ctx.beginPath();
      for (i = 0; i < av.length; i += 3) { ctx.moveTo(av[i] + 1.4, av[i + 1]); ctx.arc(av[i], av[i + 1], 1.4, 0, TAU); }
      ctx.fill();
    }
  }

  // Depth fog veil between distance layers, with drifting fog banks on misty missions.
  var VEILS = [430, 260, 150];
  function drawVeil(ctx, k, t) {
    var P = K.P, a = P.veil * (k === 0 ? 1 : k === 1 ? 0.7 : 0.45), y0 = Math.max(380, VR.y0), y1 = Math.min(1000, VR.y1), j, x, span;
    if (a <= 0.005 || y1 <= y0) { return; }
    ctx.globalAlpha = a; ctx.fillStyle = grad('veil');
    ctx.fillRect(VR.x0 - 2, y0, VR.x1 - VR.x0 + 4, y1 - y0);
    ctx.globalAlpha = 1;
    if (P.fog >= 0.5 || P.sky2 === 'dawn') {
      span = K.W + 1200;
      for (j = 0; j < 3; j++) {
        x = ((hash1(j * 5.3 + k) * span + t * (5 + k * 3 + j)) % span) - 600;
        if (x + 600 < VR.x0 || x - 600 > VR.x1) { continue; }
        glowHalo(ctx, P.haze, x, 640 + k * 70 + j * 18, 560, 70, a * 1.6);
      }
    }
  }

  // ---------- world pass ----------

  var entBuf = [];
  function sortedEntities(state) {
    var src = state.entities || [], i, e;
    entBuf.length = 0;
    for (i = 0; i < src.length; i++) {
      e = src[i];
      if (!e || e.removed || !(e.dist > 0) || typeof e.x !== 'number' || typeof e.y !== 'number') { continue; }
      entBuf.push(e);
    }
    entBuf.sort(function (a, b) { return b.dist - a.dist; });
    return entBuf;
  }

  // Draws sky, skyline, structures, people and effects for a view. hw/hh: half extents in CSS px to cover.
  function drawWorld(ctx, state, view, vw, vh, hw, hh, flash) {
    var s = LW.cam.scale(view, vh), t = num(state.t, 0), items = K.items, ents, i = 0, j = 0, it, e, h, d, vi = 0;
    SC = s; PX = 1 / s;
    VR.x0 = view.x - hw / s; VR.x1 = view.x + hw / s; VR.y0 = view.y - hh / s; VR.y1 = view.y + hh / s;
    ctx.save();
    ctx.translate(vw / 2, vh / 2); ctx.scale(s, s); ctx.translate(-view.x, -view.y);
    drawSky(ctx, t, flash);
    ents = sortedEntities(state);
    while (i < items.length || j < ents.length) {
      if (j >= ents.length || (i < items.length && items[i].d >= ents[j].dist)) { d = items[i].d; } else { d = ents[j].dist; }
      while (vi < VEILS.length && d < VEILS[vi]) { drawVeil(ctx, vi, t); vi++; }
      if (j >= ents.length || (i < items.length && items[i].d >= ents[j].dist)) {
        it = items[i++];
        if (it.x1 < VR.x0 || it.x0 > VR.x1 || it.y1 < VR.y0 || it.y0 > VR.y1) { continue; }
        it.fn(ctx, it, t);
        ctx.globalAlpha = 1;
      } else {
        e = ents[j++];
        h = LW.personHeight(e);
        if (e.x + h * 1.1 < VR.x0 || e.x - h * 1.1 > VR.x1 || e.y - h * 1.35 > VR.y1 || e.y + h * 0.3 < VR.y0) { continue; }
        drawEntity(ctx, e, t);
      }
    }
    if (K.P.rain >= 0.5 && SC > 1.6) { splashes(ctx, t); }
    effects(ctx, state, t);
    ctx.restore();
  }

  // ---------- shots: tracers in flight and the impact marker (screen space) ----------

  // Fraction of the way from the target back to the muzzle as seen in perspective: fast near, slow far.
  function persp(k, D) { var d0 = 2, z = d0 + (D - d0) * k; return Math.max(0, (d0 / z - d0 / D) / (1 - d0 / D)); }

  function shots(ctx, state, view, vw, vh) {
    var t = num(state.t, 0), bl = state.bullets, s = LW.cam.scale(view, vh), sx = vw / 2, sy = vh;
    var i, b, k, t0, t1, D, ex, ey, f0, f1, a, ls, age, rr, col;
    ctx.lineCap = 'round';
    if (bl && bl.length) {
      for (i = 0; i < bl.length; i++) {
        b = bl[i];
        if (!b || typeof b.x !== 'number' || typeof b.y !== 'number') { continue; }
        t0 = num(b.fromT, t); t1 = num(b.hitT, t0 + 0.2);
        if (!(t1 > t0)) { continue; }
        k = clamp((t - t0) / (t1 - t0), 0, 1);
        D = Math.max(5, num(b.dist, 200));
        ex = (b.x - view.x) * s + vw / 2; ey = (b.y - view.y) * s + vh / 2;
        f1 = persp(k, D); f0 = persp(Math.max(0, k - 0.16), D);
        a = 0.85 * (1 - k * 0.5);
        ctx.strokeStyle = 'rgba(255,200,120,' + (a * 0.25) + ')'; ctx.lineWidth = 2 + 3 * f0;
        ctx.beginPath(); ctx.moveTo(ex + (sx - ex) * f0, ey + (sy - ey) * f0); ctx.lineTo(ex + (sx - ex) * f1, ey + (sy - ey) * f1); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,240,215,' + a + ')'; ctx.lineWidth = 0.8 + 1.4 * f0;
        ctx.stroke();
      }
    }
    ls = state.lastShot;
    if (ls && typeof ls.x === 'number' && typeof ls.y === 'number' && typeof ls.t === 'number') {
      age = t - ls.t;
      if (age >= 0 && age < 1.2) {
        k = age / 1.2;
        ex = (ls.x - view.x) * s + vw / 2; ey = (ls.y - view.y) * s + vh / 2;
        if (ex > -30 && ex < vw + 30 && ey > -30 && ey < vh + 30) {
          rr = 4 + 15 * (1 - k) * (1 - k); a = 1 - k * k;
          col = ls.hit === 'head' ? '255,72,56' : ls.hit ? '226,64,52' : '232,163,61';
          ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,' + (0.5 * a) + ')';
          ctx.beginPath(); ctx.arc(ex, ey, rr, 0, TAU); ctx.stroke();
          ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(' + col + ',' + a + ')';
          ctx.stroke();
          if (ls.hit === 'head') {
            ctx.beginPath();
            ctx.moveTo(ex - rr - 4, ey); ctx.lineTo(ex - rr - 1, ey); ctx.moveTo(ex + rr + 1, ey); ctx.lineTo(ex + rr + 4, ey);
            ctx.moveTo(ex, ey - rr - 4); ctx.lineTo(ex, ey - rr - 1); ctx.moveTo(ex, ey + rr + 1); ctx.lineTo(ex, ey + rr + 4);
            ctx.stroke();
          } else {
            ctx.fillStyle = 'rgba(' + col + ',' + a + ')';
            ctx.beginPath(); ctx.arc(ex, ey, 1.3, 0, TAU); ctx.fill();
          }
        }
      }
    }
  }

  // ---------- weather and film (screen space) ----------

  function rainLayer(ctx, list, n, t, vw, vh, sl, lenK, speed, scoped) {
    var i, d, len, x, y;
    ctx.beginPath();
    for (i = 0; i < n; i++) {
      d = list[i];
      len = lenK * (0.6 + d.l * 0.8) * vh;
      y = ((d.y + t * (speed + d.sp * 0.8)) % 1) * (vh + len) - len;
      x = d.x * (vw + 200) - 100 + y * sl;
      ctx.moveTo(x, y); ctx.lineTo(x + len * sl, y + len);
    }
    ctx.stroke();
  }

  function weather(ctx, state, vw, vh, scoped) {
    var P = K.P, t = num(state.t, 0), dens = P.rain, sl, k, yy;
    if (dens > 0) {
      sl = clamp(num(state.wind, 0) * 0.04, -0.4, 0.4) + 0.08;
      ctx.lineCap = 'butt';
      ctx.strokeStyle = scoped ? 'rgba(165,185,205,0.13)' : 'rgba(165,185,205,0.2)'; ctx.lineWidth = scoped ? 1.3 : 0.9;
      rainLayer(ctx, K.drops, Math.floor(K.drops.length * dens * (scoped ? 0.6 : 1)), t, vw, vh, sl, scoped ? 0.05 : 0.03, 1.4, scoped);
      ctx.strokeStyle = scoped ? 'rgba(185,200,215,0.06)' : 'rgba(185,200,215,0.12)'; ctx.lineWidth = scoped ? 4 : 2;
      rainLayer(ctx, K.dropsNear, Math.floor(K.dropsNear.length * dens), t, vw, vh, sl * 1.4, 0.1, 2.4, scoped);
      if (dens >= 1) { ctx.fillStyle = 'rgba(6,12,20,0.12)'; ctx.fillRect(0, 0, vw, vh); }
    }
    if (P.fog > 0) {
      ctx.fillStyle = css(rgb(P.haze), 0.05 * P.fog); ctx.fillRect(0, 0, vw, vh);
      for (k = 0; k < 3; k++) {
        yy = vh * (0.22 + 0.22 * k) + Math.sin(t * 0.07 + k * 2) * vh * 0.04;
        ctx.save();
        ctx.translate(0, yy); ctx.scale(1, vh * 0.32);
        ctx.globalAlpha = clamp(0.4 * P.fog, 0, 1);
        ctx.fillStyle = grad('fog'); ctx.fillRect(0, 0, vw, 1);
        ctx.restore();
      }
    }
  }

  // Raindrops sitting on the objective lens.
  function lensDrops(ctx, t, cx, cy, r) {
    var i, n, f, a, x, y, rr, cyc;
    for (i = 0; i < 7; i++) {
      n = t / 7 + i * 0.37; cyc = Math.floor(n); f = n - cyc;
      a = Math.sin(f * PI) * 0.8;
      x = cx + (hash2(cyc, i) - 0.5) * r * 1.5; y = cy + (hash2(i, cyc) - 0.5) * r * 1.5 + f * r * 0.15;
      rr = 3 + hash2(i + 3, cyc) * 7;
      ctx.globalAlpha = a;
      ctx.fillStyle = 'rgba(190,212,228,0.07)';
      ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, y, rr, 0.2, PI - 0.2); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.beginPath(); ctx.arc(x, y, rr * 0.7, PI * 1.15, PI * 1.5); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  var GRAIN = null;
  function grainCanvas() {
    if (GRAIN !== null) { return GRAIN; }
    GRAIN = false;
    try {
      if (typeof document === 'undefined' || !document.createElement) { return GRAIN; }
      var cv = document.createElement('canvas'), g, img, i, v, n = 128, rnd = mulberry32(777);
      cv.width = n; cv.height = n; g = cv.getContext('2d');
      if (!g || !g.createImageData) { return GRAIN; }
      img = g.createImageData(n, n);
      for (i = 0; i < n * n; i++) {
        v = rnd() < 0.5 ? 0 : 255;
        img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v;
        img.data[i * 4 + 3] = Math.floor(rnd() * rnd() * 255);
      }
      g.putImageData(img, 0, 0);
      GRAIN = cv;
    } catch (err) { GRAIN = false; }
    return GRAIN;
  }

  function grain(ctx, vw, vh, t, a) {
    var cv = grainCanvas(), f, ox, oy;
    if (!cv) { return; }
    if (!K.grainPat) {
      try { K.grainPat = ctx.createPattern(cv, 'repeat'); } catch (err) { K.grainPat = null; }
      if (!K.grainPat) { GRAIN = false; return; }
    }
    f = Math.floor(t * 24);
    ox = Math.floor(hash1(f) * 128); oy = Math.floor(hash1(f + 0.5) * 128);
    ctx.save();
    ctx.globalAlpha = a; ctx.translate(-ox, -oy);
    ctx.fillStyle = K.grainPat; ctx.fillRect(ox, oy, vw, vh);
    ctx.restore();
  }

  // ---------- scope, reticle, crosshair ----------

  function reticle(ctx, cx, cy, r, s) {
    var sp = (C.MARK || 5) * s, inner = r * 0.62, n, k, o, l, pass, x = Math.round(cx) + 0.5, y = Math.round(cy) + 0.5, gap = 3;
    ctx.lineCap = 'butt';
    n = sp >= 2.5 ? Math.min(80, Math.floor(inner / sp)) : 0;
    for (pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass ? 'rgba(6,7,9,0.95)' : 'rgba(200,210,215,0.22)';
      ctx.lineWidth = pass ? 1 : 3;
      ctx.beginPath();
      ctx.moveTo(x - inner, y); ctx.lineTo(x - gap, y); ctx.moveTo(x + gap, y); ctx.lineTo(x + inner, y);
      ctx.moveTo(x, y - inner); ctx.lineTo(x, y - gap); ctx.moveTo(x, y + gap); ctx.lineTo(x, y + inner);
      for (k = 1; k <= n; k++) {
        l = (k % 4 === 0) ? 7 : (k % 2 === 0) ? 4.5 : 3; o = Math.round(k * sp);
        ctx.moveTo(x + o, y - l); ctx.lineTo(x + o, y + l);
        ctx.moveTo(x - o, y - l); ctx.lineTo(x - o, y + l);
        ctx.moveTo(x - l, y + o); ctx.lineTo(x + l, y + o);
        ctx.moveTo(x - l, y - o); ctx.lineTo(x + l, y - o);
      }
      ctx.stroke();
      ctx.lineWidth = pass ? 3.5 : 6;
      ctx.beginPath();
      ctx.moveTo(x + inner, y); ctx.lineTo(x + r, y);
      ctx.moveTo(x - inner, y); ctx.lineTo(x - r, y);
      ctx.moveTo(x, y + inner); ctx.lineTo(x, y + r);
      ctx.moveTo(x, y - inner); ctx.lineTo(x, y - r);
      ctx.stroke();
    }
    if (sp > 16) {
      ctx.fillStyle = 'rgba(6,7,9,0.9)';
      ctx.beginPath();
      for (k = 0; k < n; k++) {
        o = Math.round((k + 0.5) * sp);
        ctx.moveTo(x + o + 1.1, y); ctx.arc(x + o, y, 1.1, 0, TAU);
        ctx.moveTo(x - o + 1.1, y); ctx.arc(x - o, y, 1.1, 0, TAU);
        ctx.moveTo(x + 1.1, y + o); ctx.arc(x, y + o, 1.1, 0, TAU);
      }
      ctx.fill();
    }
    if (sp * 4 > 26 && n >= 4) {
      ctx.font = '10px ' + FONT; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(200,210,215,0.3)'; ctx.fillStyle = 'rgba(6,7,9,0.95)';
      for (k = 4; k <= n; k += 4) {
        o = Math.round(k * sp);
        ctx.strokeText(String(k), x + 9, y + o); ctx.fillText(String(k), x + 9, y + o);
      }
    }
    ctx.fillStyle = 'rgba(255,60,40,0.28)';
    ctx.beginPath(); ctx.arc(cx, cy, 3.6, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ff3b2a';
    ctx.beginPath(); ctx.arc(cx, cy, 1.6, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,225,205,0.9)';
    ctx.beginPath(); ctx.arc(cx, cy, 0.6, 0, TAU); ctx.fill();
  }

  function drawScope(ctx, state, view, vw, vh, flash) {
    var cx = vw / 2, cy = vh / 2, r = LW.cam.scopeRadius(vw, vh), s = LW.cam.scale(view, vh), p, key, bw, hold = K.hold;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.clip();
    drawWorld(ctx, state, view, vw, vh, r, r, flash);
    markers(ctx, state, view, vw, vh, true);
    shots(ctx, state, view, vw, vh);
    weather(ctx, state, vw, vh, true);
    if (flash > 0) { ctx.fillStyle = 'rgba(200,215,235,' + (0.1 * flash) + ')'; ctx.fillRect(cx - r, cy - r, r * 2, r * 2); }
    if (K.P.rain >= 0.5) { lensDrops(ctx, num(state.t, 0), cx, cy, r); }
    ctx.fillStyle = 'rgba(30,80,95,0.06)'; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    key = cx + ',' + cy + ',' + r;
    ctx.fillStyle = sgrad('sv' + key, function (c) {
      var g = c.createRadialGradient(cx, cy, r * 0.55, cx, cy, r);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.72, 'rgba(0,0,0,0.2)'); g.addColorStop(0.92, 'rgba(0,0,0,0.6)'); g.addColorStop(1, 'rgba(0,0,0,0.92)');
      return g;
    });
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    if (hold > 0.01) {
      ctx.globalAlpha = hold;
      ctx.fillStyle = sgrad('sh' + key, function (c) {
        var g = c.createRadialGradient(cx, cy, r * 0.42, cx, cy, r);
        g.addColorStop(0, 'rgba(40,42,46,0)'); g.addColorStop(0.55, 'rgba(40,42,46,0.4)'); g.addColorStop(1, 'rgba(6,6,7,0.9)');
        return g;
      });
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      ctx.globalAlpha = 1;
    }
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,70,60,0.2)';
    ctx.beginPath(); ctx.arc(cx + 1.5, cy, r - 3, 0, TAU); ctx.stroke();
    ctx.strokeStyle = 'rgba(60,220,255,0.18)';
    ctx.beginPath(); ctx.arc(cx - 1.5, cy, r - 3, 0, TAU); ctx.stroke();
    ctx.strokeStyle = 'rgba(200,225,240,0.09)'; ctx.lineWidth = Math.max(2, r * 0.035);
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.9, PI * 1.08, PI * 1.42); ctx.stroke();
    reticle(ctx, cx, cy, r, s);
    if (state.predicted && typeof state.predicted.x === 'number' && typeof state.predicted.y === 'number') {
      p = LW.cam.worldToScreen(view, vw, vh, state.predicted.x, state.predicted.y);
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, TAU); ctx.stroke();
      ctx.strokeStyle = '#e8a33d'; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, TAU); ctx.stroke();
    }
    ctx.restore();
    // tube: black outside, a metallic bevel ring around the glass, a soft sheen on the tube wall
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.rect(0, 0, vw, vh); ctx.arc(cx, cy, r, 0, TAU); ctx.fill('evenodd');
    bw = Math.max(3, r * 0.035);
    ctx.strokeStyle = sgrad('tb' + key, function (c) {
      var g = c.createRadialGradient(cx, cy, r, cx, cy, r * 1.16);
      g.addColorStop(0, 'rgba(26,28,31,1)'); g.addColorStop(1, 'rgba(0,0,0,1)');
      return g;
    });
    ctx.lineWidth = r * 0.16;
    ctx.beginPath(); ctx.arc(cx, cy, r * 1.08, 0, TAU); ctx.stroke();
    ctx.strokeStyle = sgrad('bv' + key, function (c) {
      var g = c.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
      g.addColorStop(0, '#5a6068'); g.addColorStop(0.3, '#202327'); g.addColorStop(0.55, '#0b0c0e'); g.addColorStop(0.82, '#2e3238'); g.addColorStop(1, '#141619');
      return g;
    });
    ctx.lineWidth = bw;
    ctx.beginPath(); ctx.arc(cx, cy, r + bw / 2, 0, TAU); ctx.stroke();
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(205,215,225,' + (0.3 * (1 - hold * 0.6)) + ')';
    ctx.beginPath(); ctx.arc(cx, cy, r + bw - 0.5, PI * 1.1, PI * 1.7); ctx.stroke();
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(0,0,0,0.95)';
    ctx.beginPath(); ctx.arc(cx, cy, r + 0.5, 0, TAU); ctx.stroke();
    ctx.lineWidth = 2; ctx.strokeStyle = '#000';
    ctx.beginPath(); ctx.arc(cx, cy, r + bw + 1, 0, TAU); ctx.stroke();
  }

  function crosshair(ctx, vw, vh) {
    var cx = Math.round(vw / 2) + 0.5, cy = Math.round(vh / 2) + 0.5, g = 4, l = 7, pass;
    ctx.lineCap = 'butt';
    for (pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass ? 'rgba(240,178,80,0.95)' : 'rgba(0,0,0,0.65)';
      ctx.lineWidth = pass ? 1.4 : 3.4;
      ctx.beginPath();
      ctx.moveTo(cx - g - l, cy); ctx.lineTo(cx - g, cy); ctx.moveTo(cx + g, cy); ctx.lineTo(cx + g + l, cy);
      ctx.moveTo(cx, cy - g - l); ctx.lineTo(cx, cy - g); ctx.moveTo(cx, cy + g); ctx.lineTo(cx, cy + g + l);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(cx - 1.5, cy - 1.5, 3, 3);
    ctx.fillStyle = 'rgba(240,178,80,0.95)'; ctx.fillRect(cx - 1, cy - 1, 2, 2);
  }

  function vignette(ctx, vw, vh) {
    ctx.fillStyle = sgrad('v' + vw + 'x' + vh, function (c) {
      var g = c.createRadialGradient(vw / 2, vh / 2, Math.min(vw, vh) * 0.4, vw / 2, vh / 2, Math.sqrt(vw * vw + vh * vh) * 0.55);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.7, 'rgba(0,0,0,0.22)'); g.addColorStop(1, 'rgba(0,0,0,0.6)');
      return g;
    });
    ctx.fillRect(0, 0, vw, vh);
  }

  // ---------- screen effects: muzzle flash, killcam ----------

  function muzzle(ctx, state, vw, vh) {
    var fx = state.effects || [], t = num(state.t, 0), a = 0, i, age;
    for (i = 0; i < fx.length; i++) {
      if (!fx[i] || fx[i].type !== 'muzzle') { continue; }
      age = t - num(fx[i].t0, -10);
      if (age >= 0 && age < 0.08) { a = Math.max(a, 1 - age / 0.08); }
    }
    if (a > 0) { ctx.fillStyle = 'rgba(255,196,120,' + (0.32 * a) + ')'; ctx.fillRect(0, 0, vw, vh); }
  }

  function killcam(ctx, state, view, vw, vh) {
    var kc = state.killcam;
    if (!kc) { return; }
    var t = num(state.t, 0), age = Math.max(0, t - num(kc.t0, t)), x = kc.x, y = kc.y, ents = state.entities || [], i, p, a, bar;
    if (typeof x !== 'number' || typeof y !== 'number') {
      for (i = 0; i < ents.length; i++) {
        if (ents[i] && ents[i].id === kc.id && ents[i].dist > 0) { x = ents[i].x; y = ents[i].y - LW.personHeight(ents[i]) * 0.9; break; }
      }
    }
    if (typeof x === 'number' && typeof y === 'number') {
      p = LW.cam.worldToScreen(view, vw, vh, x, y);
      a = clamp(1 - age / 0.45, 0, 1);
      if (a > 0) {
        ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(232,163,61,' + (0.25 * a) + ')'; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(vw / 2, vh); ctx.lineTo(p.x, p.y); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,236,200,' + (0.85 * a) + ')'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(vw / 2, vh); ctx.lineTo(p.x, p.y); ctx.stroke();
      }
    }
    bar = vh * 0.075 * clamp(age / 0.06, 0, 1);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, vw, bar); ctx.fillRect(0, vh - bar, vw, bar);
  }

  // ---------- main entry ----------

  var warned = false;

  function draw(ctx, state, vw, vh) {
    if (!ctx || !state || !(vw > 0) || !(vh > 0)) { return; }
    var m = state.mission || {}, v, view, t, dt, flash;
    if (!K || K.mission !== m) { prepare(m); }
    if (K.gctx !== ctx) { K.gctx = ctx; K.g = {}; K.sg = {}; K.grainPat = null; }
    if (K.vw !== vw || K.vh !== vh) { K.vw = vw; K.vh = vh; K.sg = {}; }
    v = state.view || {};
    view = { x: num(v.x, K.W / 2), y: num(v.y, 500), zoom: num(v.zoom, 1) > 0 ? num(v.zoom, 1) : 1 };
    t = num(state.t, 0);
    dt = K.lastT < 0 ? 0 : clamp(t - K.lastT, 0, 0.1); K.lastT = t;
    K.hold += ((state.holding && state.scoped ? 1 : 0) - K.hold) * Math.min(1, dt * 6);
    ctx.save();
    try {
      flash = lightning(t);
      ctx.globalAlpha = 1; ctx.lineCap = 'butt'; ctx.lineJoin = 'miter'; ctx.shadowBlur = 0;
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, vw, vh);
      if (state.scoped) {
        drawScope(ctx, state, view, vw, vh, flash);
        grain(ctx, vw, vh, t, 0.05);
      } else {
        drawWorld(ctx, state, view, vw, vh, vw / 2, vh / 2, flash);
        markers(ctx, state, view, vw, vh, false);
        shots(ctx, state, view, vw, vh);
        weather(ctx, state, vw, vh, false);
        if (flash > 0) { ctx.fillStyle = 'rgba(200,215,235,' + (0.12 * flash) + ')'; ctx.fillRect(0, 0, vw, vh); }
        vignette(ctx, vw, vh);
        grain(ctx, vw, vh, t, 0.06);
        crosshair(ctx, vw, vh);
      }
      muzzle(ctx, state, vw, vh);
      killcam(ctx, state, view, vw, vh);
    } catch (err) {
      if (!warned && window.console) { warned = true; console.error('LW.Render.draw failed', err); }
      for (var i = 0; i < 8; i++) { ctx.restore(); }
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
      return;
    }
    ctx.restore();
  }

  LW.Render = { prepare: prepare, draw: draw };

  // ---------- dev helper: LW.Render._demo(canvas, { time, scoped, animate }) ----------

  LW.Render._demo = function (canvas, opts) {
    opts = opts || {};
    if (!canvas || !canvas.getContext) { return null; }
    var ctx = canvas.getContext('2d'), dpr = window.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { width: 0, height: 0 };
    var vw = rect.width || canvas.width || 960, vh = rect.height || canvas.height || 540;
    canvas.width = Math.round(vw * dpr); canvas.height = Math.round(vh * dpr);
    function look(coat, hat, tie, item, build) {
      return { coat: coat, skin: '#c8a27c', hair: '#2a2420', hat: hat, tie: tie, build: build || 'normal', item: item, dummy: false };
    }
    var mission = { id: 'demo', time: opts.time || 'rain', world: { width: 2400 }, rules: { markTargets: true },
      structures: [
        { type: 'building', x: 60, y: 260, w: 300, h: 560, dist: 320, style: 'glass', lights: 0.35, roof: 'antenna' },
        { type: 'building', x: 1520, y: 300, w: 380, h: 500, dist: 300, style: 'deco', lights: 0.3, roof: 'water-tower' },
        { type: 'billboard', x: 1560, y: 190, w: 280, h: 80, dist: 300, text: 'HALVARD TRUST' },
        { type: 'crane', x: 2150, y: 780, dist: 420 },
        { type: 'building', x: 300, y: 420, w: 560, h: 420, dist: 140, style: 'brick', lights: 0.5, roof: 'neon', sign: 'LUCKY 7' },
        { type: 'building', x: 1000, y: 380, w: 420, h: 460, dist: 140, style: 'concrete', lights: 0.4, roof: 'flat', sign: 'HOTEL' },
        { type: 'ground', y: 800, dist: 125, kind: 'street' },
        { type: 'lamp', x: 900, y: 860, dist: 125 },
        { type: 'car', x: 1500, y: 915, dist: 125, color: '#2e3a46', kind: 'sedan' },
        { type: 'container', x: 1900, y: 800, w: 260, h: 95, dist: 125, color: '#6e3526' },
        { type: 'wall', x: 0, y: 950, w: 2400, h: 50, dist: 60 }
      ],
      entities: [] };
    var ents = [
      { id: 'sanna', role: 'target', x: 1150, y: 880, dist: 125, look: look('#5b5f66', 'fedora', '#a3242b', 'cigarette'), facing: -1, state: 'idle', alive: true, walkPhase: 0, dead: null },
      { id: 'walker', role: 'civilian', x: 600, y: 875, dist: 125, look: look('#3a3f4a', 'none', null, 'umbrella', 'slim'), facing: 1, state: 'walk', alive: true, walkPhase: 0, dead: null },
      { id: 'lookout', role: 'guard', x: 640, y: 700, dist: 140, window: true, look: look('#2b2d33', 'cap', null, 'rifle', 'heavy'), facing: 1, state: 'alert', alive: true, walkPhase: 0, dead: null },
      { id: 'courier', role: 'guard', x: 1720, y: 878, dist: 125, look: look('#2b2b30', 'hood', null, 'phone'), facing: 1, state: 'idle', alive: false, walkPhase: 0, dead: { t: 0, head: true, dir: -1 } }
    ];
    mission.entities = ents;
    var state = { mission: mission, status: 'playing', t: 1, timeScale: 1, view: { x: 1200, y: 500, zoom: 1 }, scoped: !!opts.scoped,
      entities: ents, bullets: [], effects: [{ type: 'blood', x: 1720, y: 850, dist: 125, t0: 0.5 }], killcam: null, predicted: null, wind: 2, lastShot: null };
    if (opts.scoped) { state.view = { x: 1150, y: 880 - 28.8 * 0.8, zoom: 4 * (C.OPTIC || 3) }; state.holding = true; state.predicted = { x: 1151, y: 860 }; }
    LW.Render.prepare(mission);
    var stopped = false, start = (window.performance && performance.now) ? performance.now() : 0, last = 1;
    function frame(now) {
      if (stopped) { return; }
      state.t = 1 + ((now || 0) - start) / 1000;
      var dt = Math.min(0.05, Math.max(0, state.t - last)), w = ents[1], h = LW.personHeight(w);
      last = state.t;
      w.x += 20.8 * dt * w.facing; w.walkPhase += 20.8 * dt * 8 / h;
      if (w.x > 2300) { w.facing = -1; } else if (w.x < 100) { w.facing = 1; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      LW.Render.draw(ctx, state, vw, vh);
      if (opts.animate !== false && window.requestAnimationFrame) { window.requestAnimationFrame(frame); }
    }
    frame(start);
    return { state: state, stop: function () { stopped = true; } };
  };
})(window.LW);
