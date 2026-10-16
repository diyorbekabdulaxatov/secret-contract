// Silent Contract: renderer. Draws the sky, skyline, structures, people, effects, weather and the scope.
// LW.Render = { prepare(mission), draw(ctx, state, vw, vh) }. See CONTRACT.md. ES5 only.
window.LW = window.LW || {};
(function (LW) {
  'use strict';

  var C = LW.CONST || { WORLD_H: 1000, MARK: 5, MIN_DIST: 60, MAX_DIST: 600 };
  var TAU = Math.PI * 2;
  var HAS_P2D = typeof Path2D !== 'undefined';
  var FONT = '"Bebas Neue", Oswald, Impact, "Arial Narrow", sans-serif';
  var NEON = ['#ff4f5e', '#e8a33d', '#ff4f5e', '#5fd6e6', '#f0b95a'];

  // ---------- small helpers ----------

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
  function mulberry32(a) {
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash1(n) { var x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
  function strHash(s) {
    var h = 2166136261, i;
    s = String(s || '');
    for (i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 16777619); }
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

  // Batched geometry: recorded once in prepare(), filled with one call per frame (Path2D when available).
  function Batch() { this.ops = []; this.p = null; }
  Batch.prototype.rect = function (x, y, w, h) { this.ops.push(0, x, y, w, h); };
  Batch.prototype.circ = function (x, y, r) { this.ops.push(1, x, y, r, 0); };
  Batch.prototype.line = function (x0, y0, x1, y1) { this.ops.push(2, x0, y0, x1, y1); };
  Batch.prototype.ell = function (x, y, rx, ry) { this.ops.push(3, x, y, rx, ry); };
  Batch.prototype.trace = function (c) {
    var o = this.ops, i, k;
    for (i = 0; i < o.length; i += 5) {
      k = o[i];
      if (k === 0) { c.rect(o[i + 1], o[i + 2], o[i + 3], o[i + 4]); }
      else if (k === 1) { c.moveTo(o[i + 1] + o[i + 3], o[i + 2]); c.arc(o[i + 1], o[i + 2], o[i + 3], 0, TAU); }
      else if (k === 2) { c.moveTo(o[i + 1], o[i + 2]); c.lineTo(o[i + 3], o[i + 4]); }
      else { c.moveTo(o[i + 1] + o[i + 3], o[i + 2]); c.ellipse(o[i + 1], o[i + 2], o[i + 3], o[i + 4], 0, 0, TAU); }
    }
  };
  Batch.prototype.path = function () {
    if (!this.p && HAS_P2D) { this.p = new Path2D(); this.trace(this.p); }
    return this.p;
  };
  Batch.prototype.fill = function (ctx) {
    if (!this.ops.length) { return; }
    var p = this.path();
    if (p) { ctx.fill(p); } else { ctx.beginPath(); this.trace(ctx); ctx.fill(); }
  };
  Batch.prototype.stroke = function (ctx) {
    if (!this.ops.length) { return; }
    var p = this.path();
    if (p) { ctx.stroke(p); } else { ctx.beginPath(); this.trace(ctx); ctx.stroke(); }
  };

  // ---------- palettes per mission time ----------

  var TIMES = {
    night: { sky: [[0, '#02060d'], [0.4, '#081424'], [0.66, '#132638'], [0.8, '#1d3346'], [1, '#22394c']],
      haze: '#1d2e40', hazeMax: 0.55, silo: '#070d15', cloud: '#2a3a4c', cloudA: 0.35, rim: '#e8a33d',
      dark: 0.6, wallK: 1, lightA: 1, lampK: 1, wet: 0.6, beams: true, rain: 0.25, fog: 0, sky2: 'moon' },
    rain: { sky: [[0, '#04070b'], [0.4, '#0d151e'], [0.66, '#1a2530'], [0.8, '#24303b'], [1, '#2a3642']],
      haze: '#27323d', hazeMax: 0.7, silo: '#0a1017', cloud: '#1e2833', cloudA: 0.6, rim: '#e8a33d',
      dark: 0.55, wallK: 0.9, lightA: 1, lampK: 1, wet: 1, beams: true, rain: 1, fog: 0.12, sky2: 'glow' },
    dusk: { sky: [[0, '#130e24'], [0.32, '#33203f'], [0.55, '#6c3346'], [0.7, '#b65638'], [0.8, '#d5823f'], [1, '#c9763e']],
      haze: '#6a4656', hazeMax: 0.6, silo: '#140e18', cloud: '#5a2c3e', cloudA: 0.5, rim: '#f0a35a',
      dark: 0.62, wallK: 1.05, lightA: 0.85, lampK: 0.8, wet: 0.3, beams: true, rain: 0, fog: 0.05, sky2: 'sun' },
    dawn: { sky: [[0, '#28303f'], [0.4, '#55566a'], [0.64, '#9a7f8c'], [0.76, '#c49c9c'], [0.86, '#cdb0aa'], [1, '#b7a6a8']],
      haze: '#988f98', hazeMax: 0.62, silo: '#2a2a34', cloud: '#8a7a88', cloudA: 0.35, rim: '#d5dde4',
      dark: 0.72, wallK: 1.25, lightA: 0.55, lampK: 0.45, wet: 0.35, beams: false, rain: 0, fog: 0.15, sky2: 'dawn' },
    fog: { sky: [[0, '#535d63'], [0.45, '#78838a'], [0.72, '#949ea2'], [1, '#a2aaac']],
      haze: '#959fa3', hazeMax: 0.9, silo: '#3a4248', cloud: '#a0a8aa', cloudA: 0.2, rim: '#dfe3e0',
      dark: 0.72, wallK: 1.1, lightA: 0.75, lampK: 0.9, wet: 0.4, beams: true, rain: 0, fog: 1, sky2: 'diffuse' }
  };

  var STYLE = {
    brick: { wall: '#3d2b26', trim: '#2a1d1a', win: '#110e0f' },
    concrete: { wall: '#353b41', trim: '#43494f', win: '#101418' },
    glass: { wall: '#18262f', trim: '#2d404b', win: '#0b151b' },
    deco: { wall: '#3a3532', trim: '#4b4541', win: '#121112' }
  };

  var K = null;   // per-mission cache, built by prepare()
  var PX = 1;     // one screen pixel in world units for the current pass
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
      items: [], ents: {}, gctx: null, g: {}, sg: {}, drops: [], seed: strHash(mission.id) };
    var list = mission.structures || [], i, s, it, d;
    for (i = 0; i < list.length; i++) {
      s = list[i];
      if (!s || !BUILD[s.type]) { continue; }
      d = num(s.dist, 0) > 0 ? s.dist : 200;
      it = { s: s, i: i, d: d, u: 2000 / d, x0: -1e9, x1: 1e9, y0: -1e9, y1: 1e9, fn: null };
      BUILD[s.type](it, s, mulberry32(i * 7919 + 1013 + K.seed));
      if (it.fn) { K.items.push(it); }
    }
    K.items.sort(function (a, b) { return (b.d - a.d) || (a.i - b.i); });
    buildSky();
    buildDrops();
  }

  function buildSky() {
    var P = K.P, W = K.W, rnd = mulberry32(4242 + K.seed), x, w, top, a, b, ah, nw, nh;
    var silo = rgb(P.silo);
    K.cFar = css(mix(silo, K.haze, Math.min(0.95, P.hazeMax + 0.28)));
    K.cNear = css(mix(silo, K.haze, Math.min(0.9, P.hazeMax + 0.1)));
    K.cSkyWin = css(mix(rgb('#e8a33d'), K.haze, Math.min(0.9, P.hazeMax + 0.1)), P.lightA * 0.8);
    K.far = new Batch(); K.near = new Batch(); K.skyWin = new Batch(); K.aviation = [];
    x = -400;
    while (x < W + 400) {
      w = 18 + rnd() * 60; top = 520 + rnd() * 150;
      K.far.rect(x, top, w + 1, 950 - top);
      if (rnd() < 0.12) { K.far.rect(x + w * 0.5 - 0.6, top - 20 - rnd() * 30, 1.2, 60); }
      x += w;
    }
    x = -400;
    while (x < W + 400) {
      w = 26 + rnd() * 90; top = 570 + rnd() * 140;
      K.near.rect(x, top, w + 1, 950 - top);
      if (rnd() < 0.3) { K.near.rect(x + w * 0.2, top - 10 - rnd() * 22, w * 0.6, 40); }
      if (rnd() < 0.12) {
        ah = 25 + rnd() * 40;
        K.near.rect(x + w * 0.5 - 0.7, top - ah, 1.4, ah + 2);
        K.aviation.push(x + w * 0.5, top - ah - 1, rnd() * 3);
      }
      nw = Math.floor(w / 6); nh = Math.floor((780 - top) / 8);
      for (a = 0; a < nw; a++) {
        for (b = 0; b < nh; b++) { if (rnd() < 0.05) { K.skyWin.rect(x + 2 + a * 6, top + 4 + b * 8, 2, 3); } }
      }
      x += w + (rnd() < 0.2 ? rnd() * 24 : 0);
    }
    K.clouds = new Batch();
    for (a = 0; a < 26; a++) {
      K.clouds.ell(-700 + rnd() * (W + 1000), 50 + rnd() * 340, 120 + rnd() * 280, 10 + rnd() * 30);
    }
    K.cCloud = css(rgb(P.cloud), P.cloudA);
  }

  function buildDrops() {
    var rnd = mulberry32(99 + K.seed), i;
    for (i = 0; i < 170; i++) { K.drops.push({ x: rnd(), y: rnd(), l: rnd(), sp: rnd() }); }
  }

  // ---------- buildings ----------

  BUILD.building = function (it, s, rnd) {
    var d = it.d, u = it.u, P = K.P;
    var x = num(s.x, 0), y = num(s.y, 400), w = Math.max(4, num(s.w, 100)), h = Math.max(4, num(s.h, 200));
    var st = STYLE[s.style] ? s.style : 'concrete', S = STYLE[st];
    it.bx = x; it.by = y; it.bw = w; it.bh = h; it.st = st;
    it.cWall = hz(S.wall, d, P.wallK); it.cTrim = hz(S.trim, d, P.wallK); it.cDark = hz(S.win, d, P.wallK);
    it.cSil = hz('#121519', d, P.wallK);
    it.cRim = rimCol(d, 0.35);
    it.side = Math.min(w * 0.08, u * 1.2);
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
    var lights = clamp(num(s.lights, 0.35), 0, 1), r, c, wx, wy, k, rowBias;
    it.dark = new Batch(); it.blind = new Batch(); it.trim = new Batch(); it.refl = null;
    it.lit = [new Batch(), new Batch(), new Batch(), new Batch()];
    it.litCol = [hzLight('#e8a33d', d), hzLight('#f3c873', d), hzLight('#b9772f', d), hzLight('#a9cbd9', d)];
    it.flick = [];
    for (r = 0; r < rows; r++) {
      rowBias = (rnd() - 0.5) * 0.3;
      for (c = 0; c < cols; c++) {
        wx = ox + c * cw; wy = oy + r * ch;
        if (rnd() >= lights + rowBias) { it.dark.rect(wx, wy, ww, wh); continue; }
        k = rnd(); k = k < 0.42 ? 0 : k < 0.62 ? 1 : k < 0.8 ? 2 : 3;
        if (rnd() < 0.035) { it.flick.push({ x: wx, y: wy, w: ww, h: wh, c: it.litCol[k], seed: rnd() * 1000, rate: 5 + rnd() * 10 }); }
        else { it.lit[k].rect(wx, wy, ww, wh); }
        if (rnd() < 0.25) { it.blind.rect(wx, wy, ww, wh * (0.2 + rnd() * 0.45)); }
      }
    }
    if (st === 'brick') {
      for (r = 0; r < rows; r++) { it.trim.rect(x, oy + r * ch + wh + ch * 0.08, w, ch * 0.07); }
    } else if (st === 'concrete') {
      for (r = 0; r <= rows; r++) { it.trim.rect(x, oy + r * ch - ch * 0.2, w, ch * 0.1); }
    } else if (st === 'deco') {
      for (c = 0; c <= cols; c += 2) { it.trim.rect(ox - (cw - ww) / 2 + c * cw - cw * 0.09, y + topM * 0.5, cw * 0.18, h - topM * 0.5); }
      it.trim.rect(x, y, w, Math.max(u * 0.5, topM * 0.4));
    } else {
      for (c = 0; c <= cols; c++) { it.trim.rect(ox - (cw - ww) / 2 + c * cw - cw * 0.03, y, cw * 0.06, h); }
      it.refl = new Batch();
      it.refl.rect(x + w * (0.1 + rnd() * 0.3), y, w * 0.12, h);
      it.refl.rect(x + w * (0.55 + rnd() * 0.3), y, w * 0.05, h);
    }
    it.roof = s.roof || 'flat';
    it.rx = x + w * (0.2 + rnd() * 0.6);
    it.seed = rnd() * 100;
    it.sign = (s.sign !== undefined && s.sign !== null && s.sign !== '') ? String(s.sign) : '';
    it.neonC = NEON[Math.floor(rnd() * NEON.length)];
    it.signX = x + w * (0.08 + rnd() * 0.2);
    var top = y - u * 2;
    if (it.roof === 'water-tower') { top = y - u * 10; }
    else if (it.roof === 'antenna') { top = y - u * 14; }
    else if (it.roof === 'neon') { top = y - u * 3 - Math.min(u * 4, w * 0.2); }
    if (st === 'deco') { top = Math.min(top, y - u * 4); }
    it.x0 = x - u * 3; it.x1 = x + w + u * 3; it.y0 = top - u * 2; it.y1 = y + h;
    it.fn = dBuilding;
  };

  function dBuilding(ctx, it, t) {
    var x = it.bx, y = it.by, w = it.bw, h = it.bh, u = it.u, P = K.P, i, f, on;
    if (it.st === 'deco') {
      ctx.fillStyle = it.cWall;
      ctx.fillRect(x + w * 0.12, y - u * 2, w * 0.76, u * 2 + 1 * PX);
      ctx.fillRect(x + w * 0.3, y - u * 4, w * 0.4, u * 2 + 1 * PX);
    }
    ctx.fillStyle = it.cWall;
    ctx.fillRect(x, y, w, h);
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
    ctx.fillStyle = 'rgba(0,0,0,0.38)'; it.blind.fill(ctx);
    if (it.refl) { ctx.fillStyle = 'rgba(170,205,225,0.06)'; it.refl.fill(ctx); }
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(x + w - it.side, y, it.side, h);
    ctx.fillStyle = it.cRim;
    ctx.fillRect(x, y, Math.max(PX * 1.2, u * 0.12), h);
    drawRoof(ctx, it, t);
    if (it.sign) { drawSign(ctx, it, t); }
  }

  function drawRoof(ctx, it, t) {
    var x = it.bx, y = it.by, w = it.bw, u = it.u, rx = it.rx, on, bh, by;
    ctx.fillStyle = it.cTrim;
    ctx.fillRect(x - u * 0.2, y - u * 0.7, w + u * 0.4, u * 0.7);
    ctx.fillStyle = it.cRim;
    ctx.fillRect(x - u * 0.2, y - u * 0.7, w + u * 0.4, Math.max(PX, u * 0.08));
    ctx.fillStyle = it.cSil;
    if (it.roof === 'water-tower') {
      ctx.fillRect(rx - u * 1.8, y - u * 3.5, u * 0.25, u * 3);
      ctx.fillRect(rx + u * 1.55, y - u * 3.5, u * 0.25, u * 3);
      ctx.fillRect(rx - u * 0.12, y - u * 3.5, u * 0.24, u * 3);
      ctx.fillRect(rx - u * 2, y - u * 7.8, u * 4, u * 4.4);
      ctx.beginPath();
      ctx.moveTo(rx - u * 2.3, y - u * 7.7); ctx.lineTo(rx, y - u * 9.6); ctx.lineTo(rx + u * 2.3, y - u * 7.7);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(rx - u * 2, y - u * 6.6, u * 4, u * 0.18);
      ctx.fillRect(rx - u * 2, y - u * 4.8, u * 4, u * 0.18);
      ctx.fillStyle = it.cRim;
      ctx.fillRect(rx - u * 2, y - u * 7.8, Math.max(PX, u * 0.15), u * 4.4);
    } else if (it.roof === 'antenna') {
      ctx.fillRect(rx - u * 0.12, y - u * 13, u * 0.24, u * 12.5);
      ctx.fillRect(rx - u * 1.1, y - u * 5, u * 2.2, u * 0.16);
      ctx.fillRect(rx - u * 0.7, y - u * 9, u * 1.4, u * 0.16);
      on = ((t * 0.7 + it.seed) % 1.4) < 0.7;
      if (on) {
        ctx.fillStyle = 'rgba(255,60,50,0.22)';
        ctx.beginPath(); ctx.arc(rx, y - u * 13.2, u * 1.1, 0, TAU); ctx.fill();
        ctx.fillStyle = '#ff4a3c';
        ctx.beginPath(); ctx.arc(rx, y - u * 13.2, Math.max(u * 0.3, PX * 1.2), 0, TAU); ctx.fill();
      }
    } else if (it.roof === 'neon') {
      bh = Math.min(u * 4, w * 0.2); by = y - u * 1.6 - bh;
      ctx.fillRect(x + w * 0.22, by, u * 0.2, u * 1.6 + bh);
      ctx.fillRect(x + w * 0.78 - u * 0.2, by, u * 0.2, u * 1.6 + bh);
      ctx.fillStyle = 'rgba(8,8,10,0.85)';
      ctx.fillRect(x + w * 0.15, by, w * 0.7, bh);
      on = neonOn(t, it.seed);
      if (it.sign) {
        neonText(ctx, it, it.sign, x + w * 0.5, by + bh * 0.54, w * 0.64, bh * 0.82, on);
      } else if (on) {
        ctx.strokeStyle = it.neonC; ctx.lineWidth = Math.max(PX, bh * 0.08);
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

  // Neon text: a wide translucent stroke as the glow, then a bright core. Off = dead dark tubes.
  function neonText(ctx, it, text, cx, cy, maxW, maxH, on) {
    var size = fitSize(ctx, it, text, maxW, maxH);
    ctx.font = 'bold ' + size + 'px ' + FONT;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (on) {
      ctx.globalAlpha = 0.3;
      ctx.strokeStyle = it.neonC; ctx.lineWidth = size * 0.3; ctx.lineJoin = 'round';
      ctx.strokeText(text, cx, cy);
      ctx.globalAlpha = 1;
      ctx.fillStyle = it.neonC; ctx.fillText(text, cx, cy);
    } else {
      ctx.fillStyle = 'rgba(50,38,38,0.9)'; ctx.fillText(text, cx, cy);
    }
  }

  // Vertical blade sign hanging off the facade (used when the roof is not 'neon').
  function drawSign(ctx, it, t) {
    if (it.roof === 'neon') { return; }
    var u = it.u, txt = it.sign, n = Math.min(txt.length, 12), i, on, ls, bw, bx, by, bh;
    ls = Math.min(u * 2.2, (it.bh * 0.75) / Math.max(1, n));
    bw = ls * 1.3; bx = it.signX; by = it.by + u * 1.5; bh = ls * n + ls * 0.4;
    ctx.fillStyle = 'rgba(8,8,10,0.9)';
    ctx.fillRect(bx, by, bw, bh);
    on = neonOn(t, it.seed);
    if (on) {
      ctx.fillStyle = css(rgb(it.neonC), 0.08);
      ctx.fillRect(bx - bw * 0.8, by - ls * 0.5, bw * 2.6, bh + ls);
    }
    ctx.font = 'bold ' + (ls * 0.92) + 'px ' + FONT;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (i = 0; i < n; i++) {
      var ch = txt.charAt(i), cy = by + ls * 0.2 + ls * (i + 0.55);
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
    var d = it.d, u = it.u, P = K.P, i, n, sx;
    it.bx = num(s.x, 0); it.by = num(s.y, 900); it.bw = Math.max(1, num(s.w, 100)); it.bh = Math.max(1, num(s.h, 20));
    it.c = hz('#262a2f', d, P.wallK); it.cTop = hz('#4c525a', d, P.wallK); it.cRim = rimCol(d, 0.4);
    it.stains = new Batch();
    n = Math.min(60, Math.floor(it.bw / (u * 2.5)));
    for (i = 0; i < n; i++) {
      sx = it.bx + rnd() * it.bw;
      it.stains.rect(sx, it.by + it.bh * 0.12, u * (0.15 + rnd() * 0.6), it.bh * (0.25 + rnd() * 0.75));
    }
    it.seams = new Batch();
    if (u * 3 < it.bw) {
      for (sx = it.bx + u * 3; sx < it.bx + it.bw && it.seams.ops.length < 1000; sx += u * 3) { it.seams.rect(sx, it.by, Math.max(0.3, u * 0.05), it.bh); }
    }
    it.x0 = it.bx; it.x1 = it.bx + it.bw; it.y0 = it.by - u * 0.2; it.y1 = it.by + it.bh;
    it.fn = dWall;
  };

  function dWall(ctx, it) {
    var x = it.bx, y = it.by, w = it.bw, h = it.bh, ct = Math.max(PX, Math.min(h * 0.12, it.u * 0.18));
    ctx.fillStyle = it.c; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; it.stains.fill(ctx); it.seams.fill(ctx);
    ctx.fillStyle = it.cTop; ctx.fillRect(x, y, w, ct);
    ctx.fillStyle = it.cRim; ctx.fillRect(x, y, w, Math.max(PX, ct * 0.35));
  }

  var GROUND = {
    street: { c: '#15181c', top: '#2b2f34' },
    dock: { c: '#28221e', top: '#3a322b' },
    rooftop: { c: '#212429', top: '#3b3f45' },
    park: { c: '#151e1a', top: '#22302a' }
  };

  BUILD.ground = function (it, s, rnd) {
    var d = it.d, u = it.u, P = K.P, W = K.W, y = num(s.y, 800), kind = GROUND[s.kind] ? s.kind : 'street';
    var G = GROUND[kind], x, yy, n, i, gap;
    it.gy = y; it.kind = kind;
    it.c = hz(G.c, d, P.wallK); it.cTop = hz(G.top, d, P.wallK); it.cRim = rimCol(d, 0.3);
    it.det = new Batch(); it.det2 = new Batch(); it.warm = new Batch(); it.cold = new Batch();
    it.curb = 0;
    if (kind === 'street') {
      it.curb = u * 2.4;
      for (x = rnd() * u * 6; x < W && it.det.ops.length < 2000; x += u * 9) { it.det.rect(x, y + it.curb + u * 3.4, u * 3, Math.max(0.4, u * 0.16)); }
      n = Math.min(160, Math.floor(W / (u * 5)));
      for (i = 0; i < n; i++) {
        (rnd() < 0.55 ? it.warm : it.cold).rect(rnd() * W, y + it.curb + rnd() * u * 4, u * (0.12 + rnd() * 0.3), u * (1.2 + rnd() * 4));
      }
      n = Math.min(40, Math.floor(W / (u * 25)));
      for (i = 0; i < n; i++) { it.det2.ell(rnd() * W, y + it.curb + u * (1 + rnd() * 6), u * (1 + rnd() * 2.5), u * (0.12 + rnd() * 0.2)); }
    } else if (kind === 'dock') {
      gap = u * 0.32;
      for (yy = y + gap; yy < 1000 && it.det.ops.length < 1000; yy += gap) { it.det.rect(-500, yy, W + 1000, Math.max(0.3, u * 0.05)); gap *= 1.04; }
      n = Math.min(300, Math.floor(W / u));
      for (i = 0; i < n; i++) { yy = y + rnd() * Math.min(1000 - y, u * 14); it.det.rect(rnd() * W, yy, Math.max(0.3, u * 0.05), u * 0.3); }
      for (x = u * 4 + rnd() * u * 8; x < W && it.det2.ops.length < 1000; x += u * (8 + rnd() * 10)) { it.det2.rect(x, y - u * 0.6, u * 0.45, u * 0.7); }
    } else if (kind === 'rooftop') {
      n = Math.min(900, Math.floor(W * Math.min(1000 - y, u * 20) / (u * u * 1.2)));
      for (i = 0; i < n; i++) { it.det.rect(rnd() * W, y + Math.pow(rnd(), 1.4) * Math.min(1000 - y, u * 20), u * 0.09, u * 0.07); }
      for (x = rnd() * u * 20; x < W && it.det2.ops.length < 500; x += u * (15 + rnd() * 30)) { it.det2.rect(x, y - u * 0.8, u * (0.8 + rnd() * 1.5), u * 0.9); }
    } else {
      for (x = 0; x < W && it.det.ops.length < 4000; x += u * (0.3 + rnd() * 0.4)) { it.det.rect(x, y - u * (0.1 + rnd() * 0.25), Math.max(0.3, u * 0.05), u * 0.4); }
      n = Math.min(60, Math.floor(W / (u * 12)));
      for (i = 0; i < n; i++) { it.det2.ell(rnd() * W, y + u * 0.1, u * (0.8 + rnd() * 1.6), u * (0.5 + rnd() * 0.6)); }
    }
    it.y0 = y - u * 1.2; it.y1 = 1000;
    it.fn = dGround;
  };

  function dGround(ctx, it, t) {
    var y = it.gy, u = it.u, P = K.P, x0 = VR.x0 - 2, w = VR.x1 - VR.x0 + 4, a;
    ctx.fillStyle = it.c; ctx.fillRect(x0, y, w, 1000 - y + 2);
    if (it.kind === 'street') {
      ctx.fillStyle = it.cTop; ctx.fillRect(x0, y, w, it.curb);
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(x0, y + it.curb, w, Math.max(PX, u * 0.2));
      ctx.fillStyle = 'rgba(200,200,190,0.18)'; it.det.fill(ctx);
      a = P.wet * (0.14 + 0.04 * Math.sin(t * 1.7));
      ctx.fillStyle = css(rgb('#e8a33d'), a); it.warm.fill(ctx);
      ctx.fillStyle = css(rgb('#8fb4c8'), a * 0.8); it.cold.fill(ctx);
      ctx.fillStyle = css(rgb('#6f8796'), P.wet * 0.12); it.det2.fill(ctx);
    } else if (it.kind === 'dock') {
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; it.det.fill(ctx);
      ctx.fillStyle = hz('#141210', it.d); it.det2.fill(ctx);
      ctx.fillStyle = it.cTop; ctx.fillRect(x0, y, w, Math.max(PX, u * 0.25));
    } else if (it.kind === 'rooftop') {
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; it.det.fill(ctx);
      ctx.fillStyle = it.cTop; ctx.fillRect(x0, y, w, Math.max(PX, u * 0.3));
      ctx.fillStyle = hz('#1a1d21', it.d); it.det2.fill(ctx);
    } else {
      ctx.fillStyle = it.cTop; it.det.fill(ctx);
      ctx.fillStyle = hz('#0f1713', it.d); it.det2.fill(ctx);
    }
    ctx.fillStyle = it.cRim; ctx.fillRect(x0, y, w, Math.max(PX * 0.8, u * 0.05));
  }

  BUILD.water = function (it, s, rnd) {
    var d = it.d, u = it.u, W = K.W, y = num(s.y, 800), i, b, yy, f;
    it.gy = y;
    it.c = hz('#0a1117', d); it.cTop = hz('#2c3b46', d);
    it.st = [new Batch(), new Batch(), new Batch()];
    it.stC = [css(rgb('#7fa3b8')), css(rgb('#e8a33d')), css(rgb('#c9d6dc'))];
    for (i = 0; i < 360; i++) {
      b = i % 3;
      f = Math.pow(rnd(), 1.6);
      yy = y + u * 0.3 + f * (1000 - y);
      it.st[b].rect(rnd() * (W + 200) - 100, yy, u * (1 + rnd() * 5) * (1 + f * 3), Math.max(0.3, u * 0.07 * (1 + f * 2)));
    }
    it.y0 = y - 1; it.y1 = 1000;
    it.fn = dWater;
  };

  function dWater(ctx, it, t) {
    var y = it.gy, x0 = VR.x0 - 2, w = VR.x1 - VR.x0 + 4, b, a;
    ctx.fillStyle = it.c; ctx.fillRect(x0, y, w, 1000 - y + 2);
    ctx.fillStyle = it.cTop; ctx.fillRect(x0, y, w, Math.max(PX, it.u * 0.15));
    for (b = 0; b < 3; b++) {
      a = 0.09 + 0.07 * Math.sin(t * 1.3 + b * 2.1);
      if (b === 1) { a *= K.P.lampK; }
      ctx.save();
      ctx.translate(Math.sin(t * 0.45 + b * 1.7) * it.u * 0.8, 0);
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = it.stC[b]; it.st[b].fill(ctx);
      ctx.restore();
    }
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

  function poly(ctx, pts) {
    ctx.beginPath(); ctx.moveTo(pts[0], pts[1]);
    for (var i = 2; i < pts.length; i += 2) { ctx.lineTo(pts[i], pts[i + 1]); }
    ctx.closePath(); ctx.fill();
  }

  function dCar(ctx, it) {
    var u = it.u, L = CAR_LEN[it.kind], P = K.P, hy, wheels, wr = 0.33, i;
    ctx.save();
    ctx.translate(it.cx, it.cy); ctx.scale(it.dir * u, u);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
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
    for (i = 0; i < wheels.length; i++) {
      ctx.fillStyle = '#07080a';
      ctx.beginPath(); ctx.arc(wheels[i], -wr, wr, 0, TAU); ctx.fill();
      ctx.fillStyle = '#3a3d41';
      ctx.beginPath(); ctx.arc(wheels[i], -wr, wr * 0.38, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = '#b3202a'; ctx.fillRect(-L / 2 - 0.03, hy - 0.1, 0.12, 0.2);
    ctx.fillStyle = 'rgba(200,30,40,0.25)'; ctx.fillRect(-L / 2 - 0.35, hy - 0.3, 0.5, 0.6);
    if (it.hl) {
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
    var P = K.P, k = P.lampK, on = true;
    if (it.flk >= 0) { on = hash1(Math.floor(t * 14) + it.flk) > 0.12; }
    ctx.save();
    ctx.translate(it.lx, it.ly); ctx.scale(it.dir * it.u, it.u);
    ctx.fillStyle = it.cPole;
    ctx.fillRect(-0.08, -6.6, 0.16, 6.6);
    ctx.fillRect(-0.18, -0.6, 0.36, 0.6);
    ctx.fillRect(0, -6.62, 1.3, 0.1);
    poly(ctx, [0.9, -6.64, 1.6, -6.64, 1.5, -6.42, 1.0, -6.42]);
    if (on) {
      ctx.fillStyle = '#ffd890'; ctx.fillRect(1.05, -6.45, 0.4, 0.07);
      ctx.fillStyle = css(rgb('#e8a33d'), 0.07 * k);
      poly(ctx, [1.0, -6.4, 1.5, -6.4, 3.8, 0, -1.3, 0]);
      ctx.fillStyle = css(rgb('#e8a33d'), 0.16 * k);
      ctx.beginPath(); ctx.ellipse(1.25, 0.05, 3.0, 0.38, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = css(rgb('#e8a33d'), 0.14 * k * P.wet);
      ctx.fillRect(1.1, 0.1, 0.3, 2.6);
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
  // Drawn in body units: the entity's feet at (0, 0), height 1, facing +x. Matches LW.bodyGeom:
  // head circle centre (0, -0.9) r 0.085, torso +-0.15 from -0.8 to -0.45, legs below.

  function lookCols(e) {
    var L = e.look || {}, key = (e.id || '?') + '|' + e.dist + '|' + (e.window ? 1 : 0), c = K.ents[key];
    if (c && c.src === L) { return c; }
    var d = e.dist, k = K.P.dark * (e.window ? 0.75 : 1), coat = L.coat || '#3a3d44', skin = L.skin || '#c8a27c';
    c = { src: L, seed: (strHash(e.id) % 1000) / 10,
      coat: hz(coat, d, k), coatD: hz(coat, d, k * 0.6), coatB: hz(coat, d, k * 0.8),
      pants: hz('#20232a', d, 1), pantsD: hz('#15171c', d, 1), shoe: hz('#0b0b0d', d),
      skin: hz(skin, d, Math.min(1, k + 0.2)), skinD: hz(skin, d, k * 0.75),
      hair: hz(L.hair || '#2a2420', d, k), hat: hz(coat, d, k * 0.5), band: hz('#0a0a0c', d),
      tie: L.tie ? hz(L.tie, d, Math.min(1, k + 0.15)) : null, shirt: hz('#c9c6bb', d, k),
      rim: rimCol(d, 0.75), item: hz('#141519', d), brief: hz('#3a2618', d, k + 0.1),
      paper: hz(L.coat || '#d8cfb4', d, Math.min(1, K.P.dark + 0.35)), wood: hz('#4a3524', d, k), ring: hz('#1a1a1a', d),
      win: hzLight('#d39a4c', d), winD: hzLight('#7a4e26', d), curtain: hz('#4a2620', d), frame: hz('#0f1114', d),
      sill: hz('#50555c', d, K.P.wallK) };
    K.ents[key] = c;
    return c;
  }

  function seg(ctx, x0, y0, x1, y1, w, col) {
    ctx.strokeStyle = col; ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  }
  function dot(ctx, x, y, r, col) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); }

  function leg(ctx, hx, ang, c, back) {
    var fx = hx + Math.sin(ang) * 0.44, fy = -0.44 + Math.cos(ang) * 0.44;
    seg(ctx, hx, -0.44, fx, fy, 0.085, back ? c.pantsD : c.pants);
    seg(ctx, fx - 0.01, fy - 0.005, fx + 0.055, fy - 0.005, 0.035, c.shoe);
  }

  function drawEntity(ctx, e, t) {
    var h = LW.personHeight(e);
    if (!(h > 0) || !isFinite(h)) { return; }
    var c = lookCols(e), L = e.look || {};
    var facing = num(e.facing, 1) < 0 ? -1 : 1;
    var dead = e.dead || (e.alive === false ? { t: -100, dir: -facing } : null);
    var p = dead ? clamp((t - num(dead.t, t - 1)) / 0.6, 0, 1) : 0, pe = p * p;
    var dir = (dead && dead.dir) ? (dead.dir < 0 ? -1 : 1) : -facing;
    ctx.save();
    ctx.translate(e.x, e.y); ctx.scale(h, h);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (e.window) {
      ctx.fillStyle = c.frame; ctx.fillRect(-0.35, -1.11, 0.7, 0.68);
      ctx.fillStyle = c.win; ctx.fillRect(-0.32, -1.08, 0.64, 0.63);
      ctx.fillStyle = c.winD; ctx.fillRect(-0.32, -1.08, 0.64, 0.09);
      ctx.fillStyle = 'rgba(255,238,200,0.16)'; ctx.fillRect(-0.13, -0.99, 0.26, 0.54);
      ctx.fillStyle = c.curtain; ctx.fillRect(-0.32, -1.08, 0.07, 0.63); ctx.fillRect(0.25, -1.08, 0.07, 0.63);
      ctx.save();
      ctx.beginPath(); ctx.rect(-0.32, -1.08, 0.64, 0.63); ctx.clip();
      if (dead) { ctx.translate(0, pe * 0.62 - 0.45); ctx.rotate(dir * pe * 0.35); ctx.translate(0, 0.45); }
      ctx.scale(facing, 1);
      body(ctx, e, c, L, t, dead, true);
      ctx.restore();
      ctx.fillStyle = c.sill; ctx.fillRect(-0.37, -0.47, 0.74, 0.05);
      ctx.fillStyle = c.rim; ctx.fillRect(-0.37, -0.47, 0.74, 0.008);
    } else {
      if (dead) {
        if (p >= 1 && !L.dummy) {
          var g = clamp((t - num(dead.t, t) - 0.6) / 3, 0, 1);
          ctx.fillStyle = 'rgba(52,6,9,0.85)';
          ctx.beginPath(); ctx.ellipse(dir * 0.72, 0, 0.08 + g * 0.22, 0.02 + g * 0.035, 0, 0, TAU); ctx.fill();
        }
        ctx.translate(0, -0.12 * pe); ctx.rotate(dir * pe * Math.PI / 2);
      }
      ctx.scale(facing, 1);
      if (L.dummy) { dummy(ctx, c); } else { body(ctx, e, c, L, t, dead, false); }
    }
    ctx.restore();
  }

  function dummy(ctx, c) {
    seg(ctx, -0.1, 0, -0.07, -0.44, 0.03, c.wood);
    seg(ctx, 0.1, 0, 0.07, -0.44, 0.03, c.wood);
    ctx.fillStyle = c.wood; ctx.fillRect(-0.13, -0.46, 0.26, 0.035);
    ctx.fillStyle = c.paper;
    ctx.beginPath();
    ctx.moveTo(-0.15, -0.44); ctx.lineTo(-0.15, -0.75);
    ctx.quadraticCurveTo(-0.15, -0.8, -0.1, -0.8); ctx.lineTo(0.1, -0.8);
    ctx.quadraticCurveTo(0.15, -0.8, 0.15, -0.75); ctx.lineTo(0.15, -0.44);
    ctx.closePath(); ctx.fill();
    ctx.fillRect(-0.032, -0.84, 0.064, 0.05);
    dot(ctx, 0, -0.9, 0.085, c.paper);
    ctx.strokeStyle = c.ring; ctx.lineWidth = 0.009;
    ctx.beginPath();
    ctx.arc(0, -0.62, 0.1, 0, TAU); ctx.moveTo(0.05, -0.62); ctx.arc(0, -0.62, 0.05, 0, TAU);
    ctx.moveTo(0.045, -0.9); ctx.arc(0, -0.9, 0.045, 0, TAU);
    ctx.stroke();
    dot(ctx, 0, -0.62, 0.012, c.ring);
    dot(ctx, 0, -0.9, 0.01, c.ring);
    ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(-0.15, -0.8, 0.05, 0.36);
  }

  function body(ctx, e, c, L, t, dead, inWin) {
    var st = e.state || 'idle', item = L.item || 'none', hat = L.hat || 'none';
    var run = !dead && (st === 'panic' || st === 'flee');
    var moving = !dead && !inWin && (run || st === 'walk');
    var ph = num(e.walkPhase, 0), sw = moving ? Math.sin(ph) : 0, amp = run ? 0.6 : 0.36;
    var bw = L.build === 'heavy' ? 0.155 : L.build === 'slim' ? 0.125 : 0.145;
    var bob = dead ? 0 : moving ? -Math.abs(Math.cos(ph)) * 0.008 : Math.sin(t * 1.7 + c.seed) * 0.003;
    var aim = !dead && !run && st === 'alert' && item === 'rifle';
    var fx, fy, bx, by, aF, drag = false, fl = moving ? sw * 0.012 : 0, i, k;
    if (run) {
      fx = 0.1 + Math.sin(ph) * 0.04; fy = -1.08; bx = -0.1; by = -1.06 + Math.cos(ph) * 0.03;
    } else if (dead) {
      fx = 0.07; fy = -0.47; bx = -0.05; by = -0.47;
    } else {
      aF = moving ? -sw * amp * 0.8 : 0.08;
      fx = 0.08 + Math.sin(aF) * 0.31; fy = -0.76 + Math.cos(aF) * 0.31;
      bx = -0.06 + Math.sin(-aF) * 0.31; by = -0.76 + Math.cos(-aF) * 0.31;
      if (item === 'phone') { fx = 0.075; fy = -0.87; }
      else if (item === 'umbrella') { fx = 0.12; fy = -0.98; }
      else if (item === 'cigarette' && Math.sin(t * 0.5 + c.seed) > 0.55) { fx = 0.085; fy = -0.865; drag = true; }
      else if (item === 'rifle') {
        if (aim) { fx = 0.27; fy = -0.77; bx = 0.08; by = -0.73; } else { fx = 0.12; fy = -0.62; bx = -0.04; by = -0.55; }
      }
    }
    ctx.save();
    ctx.translate(0, bob);
    seg(ctx, -0.06, -0.76, bx, by, 0.068, c.coatD);
    dot(ctx, bx, by, 0.023, c.skinD);
    if (!inWin) {
      leg(ctx, -0.035, moving ? -sw * amp : -0.05, c, true);
      leg(ctx, 0.035, moving ? sw * amp : 0.05, c, false);
    }
    // coat
    ctx.fillStyle = c.coat;
    ctx.beginPath();
    ctx.moveTo(-bw * 0.85, -0.805);
    ctx.quadraticCurveTo(-bw, -0.795, -bw, -0.74);
    ctx.lineTo(-bw * 1.04 - fl, -0.38);
    ctx.lineTo(bw * 1.04 + fl, -0.38);
    ctx.lineTo(bw, -0.74);
    ctx.quadraticCurveTo(bw, -0.795, bw * 0.85, -0.805);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    poly(ctx, [-bw, -0.75, -bw * 0.15, -0.8, -bw * 0.15, -0.38, -bw * 1.04 - fl, -0.38]);
    ctx.fillStyle = c.coatD; ctx.fillRect(-bw, -0.565, bw * 2, 0.02);
    ctx.fillStyle = c.shirt; poly(ctx, [-0.035, -0.8, 0.035, -0.8, 0, -0.7]);
    if (c.tie) { ctx.fillStyle = c.tie; poly(ctx, [-0.011, -0.795, 0.011, -0.795, 0.017, -0.66, 0, -0.64, -0.017, -0.66]); }
    seg(ctx, bw, -0.76, bw * 1.04 + fl, -0.4, 0.012, c.rim);
    // neck and head
    ctx.fillStyle = c.skinD; ctx.fillRect(-0.028, -0.845, 0.056, 0.05);
    if (hat === 'hood') { dot(ctx, -0.012, -0.905, 0.106, c.coatB); }
    dot(ctx, 0, -0.9, 0.085, c.skin);
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.beginPath(); ctx.arc(0, -0.9, 0.085, Math.PI * 0.5, Math.PI * 1.5); ctx.closePath(); ctx.fill();
    ctx.fillStyle = c.skin; poly(ctx, [0.08, -0.915, 0.1, -0.888, 0.08, -0.875]);
    if (hat === 'hood') {
      ctx.fillStyle = c.coatB;
      ctx.beginPath(); ctx.arc(-0.02, -0.91, 0.1, Math.PI * 0.9, Math.PI * 1.8); ctx.closePath(); ctx.fill();
    } else if (hat === 'cap') {
      ctx.fillStyle = c.hair; ctx.fillRect(-0.086, -0.915, 0.03, 0.045);
      ctx.fillStyle = c.hat;
      ctx.beginPath(); ctx.arc(0, -0.915, 0.088, Math.PI, TAU); ctx.closePath(); ctx.fill();
      ctx.fillRect(0.03, -0.926, 0.095, 0.018);
    } else {
      ctx.fillStyle = c.hair;
      ctx.beginPath(); ctx.arc(0, -0.9, 0.089, Math.PI * 0.82, Math.PI * 1.92);
      ctx.quadraticCurveTo(-0.01, -0.955, -0.07, -0.85); ctx.closePath(); ctx.fill();
      if (hat === 'fedora') {
        ctx.fillStyle = c.hat;
        poly(ctx, [-0.072, -0.966, -0.066, -1.045, 0.064, -1.05, 0.074, -0.966]);
        poly(ctx, [-0.13, -0.962, 0.14, -0.968, 0.135, -0.983, -0.125, -0.979]);
        ctx.fillStyle = c.band; ctx.fillRect(-0.072, -0.992, 0.146, 0.016);
        ctx.fillStyle = c.rim; ctx.fillRect(-0.066, -1.05, 0.13, 0.008);
      }
    }
    ctx.strokeStyle = c.rim; ctx.lineWidth = 0.012;
    ctx.beginPath(); ctx.arc(0, -0.9, 0.086, -1.0, 0.6); ctx.stroke();
    // items (dropped when dead)
    if (!dead) {
      if (item === 'rifle') {
        if (aim) { seg(ctx, 0.0, -0.75, 0.47, -0.79, 0.028, c.item); seg(ctx, -0.05, -0.72, 0.07, -0.76, 0.05, c.item); }
        else { seg(ctx, -0.1, -0.46, 0.2, -0.92, 0.028, c.item); }
      } else if (item === 'umbrella') {
        seg(ctx, fx, fy, fx - 0.02, -1.22, 0.012, c.item);
        ctx.fillStyle = c.item;
        ctx.beginPath(); ctx.ellipse(fx - 0.02, -1.17, 0.34, 0.11, 0, Math.PI, TAU); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = c.rim; ctx.lineWidth = 0.01;
        ctx.beginPath(); ctx.ellipse(fx - 0.02, -1.17, 0.34, 0.11, 0, Math.PI * 1.25, Math.PI * 1.75); ctx.stroke();
      }
    }
    seg(ctx, 0.08, -0.76, fx, fy, 0.072, c.coat);
    dot(ctx, fx, fy, 0.024, c.skin);
    if (!dead) {
      if (item === 'briefcase' && !run) {
        ctx.fillStyle = c.brief; ctx.fillRect(fx - 0.06, fy + 0.01, 0.12, 0.085);
        ctx.strokeStyle = c.brief; ctx.lineWidth = 0.01; ctx.strokeRect(fx - 0.02, fy - 0.005, 0.04, 0.02);
      } else if (item === 'phone') {
        ctx.fillStyle = c.item; ctx.fillRect(0.058, -0.935, 0.03, 0.075);
        ctx.fillStyle = 'rgba(150,200,230,0.7)'; ctx.fillRect(0.06, -0.93, 0.008, 0.06);
      } else if (item === 'cigarette') {
        var tx = drag ? fx + 0.04 : 0.125, ty = drag ? fy - 0.005 : -0.87;
        seg(ctx, tx - 0.045, ty, tx, ty, 0.01, '#d8d3c6');
        dot(ctx, tx + 0.003, ty, 0.009, drag ? '#ffb347' : '#c8622a');
        for (i = 0; i < 3; i++) {
          k = (t * 0.35 + i / 3 + c.seed) % 1;
          dot(ctx, tx + 0.01 + k * 0.06, ty - 0.02 - k * 0.26, 0.012 + k * 0.04, 'rgba(180,186,192,' + (0.16 * (1 - k)) + ')');
        }
      }
    }
    ctx.restore();
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
        if (age > 0.7) { continue; }
        k = age / 0.7;
        ctx.fillStyle = 'rgba(150,142,128,' + (0.45 * (1 - k)) + ')';
        ctx.beginPath();
        for (j = 0; j < 4; j++) {
          ang = sd * 6 + j * 1.7;
          r = u * (0.15 + k * 0.6) * (0.7 + 0.3 * hash1(sd + j));
          cx = f.x + Math.cos(ang) * u * 0.3 * k; cy = f.y - k * u * 0.4 + Math.sin(ang) * u * 0.15 * k;
          ctx.moveTo(cx + r, cy); ctx.arc(cx, cy, r, 0, TAU);
        }
        ctx.fill();
        if (age < 0.09) { sparks(ctx, f, u, sd, age / 0.09); }
      } else if (f.type === 'spark') {
        if (age > 0.25) { continue; }
        sparks(ctx, f, u, sd, age / 0.25);
      } else if (f.type === 'blood') {
        if (age > 0.9) { continue; }
        k = age / 0.9;
        ctx.fillStyle = 'rgba(96,8,14,' + (0.6 * (1 - k) * (1 - k)) + ')';
        ctx.beginPath();
        for (j = 0; j < 6; j++) {
          ang = sd * 6 + j * 1.05;
          r = u * (0.06 + 0.3 * k);
          cx = f.x + Math.cos(ang) * u * (0.1 + 0.5 * k) * hash1(sd * 3 + j);
          cy = f.y + Math.sin(ang) * u * (0.1 + 0.35 * k) * hash1(sd * 5 + j) + k * u * 0.25;
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
    for (j = 0; j < 5; j++) {
      ang = -Math.PI * (0.1 + 0.8 * hash1(sd * 7 + j));
      l = u * (0.2 + 0.7 * k);
      ctx.moveTo(f.x + Math.cos(ang) * l * 0.4, f.y + Math.sin(ang) * l * 0.4);
      ctx.lineTo(f.x + Math.cos(ang) * l, f.y + Math.sin(ang) * l);
    }
    ctx.stroke();
  }

  // ---------- cached gradients ----------

  var HALO = { moon: '#c8d4e0', glow: '#8a9aaa', sun: '#f09050', dawn: '#f4c8b8', diffuse: '#e2e8e8' };

  // World/unit-space gradients, created once per (mission, context).
  function grad(name) {
    var g = K.g[name], ctx = K.gctx, i, st, c;
    if (g) { return g; }
    if (name === 'sky') {
      g = ctx.createLinearGradient(0, 0, 0, 1000);
      st = K.P.sky;
      for (i = 0; i < st.length; i++) { g.addColorStop(st[i][0], st[i][1]); }
    } else if (name === 'lamp') {
      g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0, 'rgba(255,220,150,0.6)'); g.addColorStop(0.2, 'rgba(232,163,61,0.25)'); g.addColorStop(1, 'rgba(232,163,61,0)');
    } else if (name === 'halo') {
      c = rgb(HALO[K.P.sky2] || HALO.moon);
      g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0, css(c, 0.55)); g.addColorStop(0.35, css(c, 0.16)); g.addColorStop(1, css(c, 0));
    } else {
      c = rgb(K.P.haze);
      g = ctx.createLinearGradient(0, 0, 0, 1);
      g.addColorStop(0, css(c, 0)); g.addColorStop(0.5, css(mix(c, [230, 235, 235], 0.3), 0.5)); g.addColorStop(1, css(c, 0));
    }
    K.g[name] = g;
    return g;
  }

  // Screen-space gradients keyed by geometry (rebuilt only on resize).
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

  function drawSky(ctx, t) {
    var P = K.P, W = K.W, m = P.sky2, i, av;
    ctx.fillStyle = grad('sky');
    ctx.fillRect(VR.x0 - 1, VR.y0 - 1, VR.x1 - VR.x0 + 2, VR.y1 - VR.y0 + 2);
    if (VR.y0 < 800) {
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
      ctx.save();
      ctx.translate(t * 1.2, 0);
      ctx.fillStyle = K.cCloud; K.clouds.fill(ctx);
      ctx.restore();
    }
    ctx.fillStyle = K.cFar; K.far.fill(ctx);
    ctx.fillStyle = K.cNear; K.near.fill(ctx);
    ctx.fillStyle = K.cSkyWin; K.skyWin.fill(ctx);
    av = K.aviation;
    if (((t * 0.6) % 1) < 0.5) {
      ctx.fillStyle = 'rgba(255,70,60,' + (0.8 * (1 - hazeF(600) * 0.6)) + ')';
      ctx.beginPath();
      for (i = 0; i < av.length; i += 3) { ctx.moveTo(av[i] + 1.4, av[i + 1]); ctx.arc(av[i], av[i + 1], 1.4, 0, TAU); }
      ctx.fill();
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
  function drawWorld(ctx, state, view, vw, vh, hw, hh) {
    var s = LW.cam.scale(view, vh), t = num(state.t, 0), items = K.items, ents, i = 0, j = 0, it, e, h;
    PX = 1 / s;
    VR.x0 = view.x - hw / s; VR.x1 = view.x + hw / s; VR.y0 = view.y - hh / s; VR.y1 = view.y + hh / s;
    ctx.save();
    ctx.translate(vw / 2, vh / 2); ctx.scale(s, s); ctx.translate(-view.x, -view.y);
    drawSky(ctx, t);
    ents = sortedEntities(state);
    while (i < items.length || j < ents.length) {
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
    effects(ctx, state, t);
    ctx.restore();
  }

  // ---------- weather (screen space) ----------

  function weather(ctx, state, vw, vh, scoped) {
    var P = K.P, t = num(state.t, 0), dens = P.rain, i, d, n, x, y, len, sl, k, yy;
    if (dens > 0) {
      n = Math.floor(K.drops.length * dens * (scoped ? 0.5 : 1));
      sl = clamp(num(state.wind, 0) * 0.04, -0.4, 0.4) + 0.08;
      ctx.strokeStyle = 'rgba(170,190,210,' + (scoped ? 0.15 : 0.22) + ')';
      ctx.lineWidth = scoped ? 1.6 : 1; ctx.lineCap = 'butt';
      ctx.beginPath();
      for (i = 0; i < n; i++) {
        d = K.drops[i];
        len = (0.03 + d.l * 0.05) * vh * (scoped ? 1.8 : 1);
        y = ((d.y + t * (1.1 + d.sp * 0.9)) % 1) * (vh + len) - len;
        x = d.x * (vw + 200) - 100 + y * sl;
        ctx.moveTo(x, y); ctx.lineTo(x + len * sl, y + len);
      }
      ctx.stroke();
      if (dens >= 1) { ctx.fillStyle = 'rgba(6,12,20,0.12)'; ctx.fillRect(0, 0, vw, vh); }
    }
    if (P.fog > 0) {
      ctx.fillStyle = css(rgb(P.haze), 0.06 * P.fog); ctx.fillRect(0, 0, vw, vh);
      for (k = 0; k < 3; k++) {
        yy = vh * (0.22 + 0.22 * k) + Math.sin(t * 0.07 + k * 2) * vh * 0.04;
        ctx.save();
        ctx.translate(0, yy); ctx.scale(1, vh * 0.32);
        ctx.globalAlpha = clamp(0.55 * P.fog, 0, 1);
        ctx.fillStyle = grad('fog'); ctx.fillRect(0, 0, vw, 1);
        ctx.restore();
      }
    }
  }

  // ---------- scope, reticle, crosshair ----------

  function reticle(ctx, cx, cy, r, s) {
    var sp = (C.MARK || 5) * s, inner = r * 0.62, n, k, o, l, pass;
    ctx.lineCap = 'butt';
    for (pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass ? 'rgba(8,10,12,0.92)' : 'rgba(190,200,205,0.35)';
      ctx.lineWidth = pass ? 1 : 3;
      ctx.beginPath();
      ctx.moveTo(cx - inner, cy); ctx.lineTo(cx + inner, cy);
      ctx.moveTo(cx, cy - inner); ctx.lineTo(cx, cy + inner);
      if (sp >= 2.5) {
        n = Math.min(80, Math.floor(inner / sp));
        for (k = 1; k <= n; k++) {
          l = (k % 4 === 0) ? 7 : 3.5; o = k * sp;
          ctx.moveTo(cx + o, cy - l); ctx.lineTo(cx + o, cy + l);
          ctx.moveTo(cx - o, cy - l); ctx.lineTo(cx - o, cy + l);
          ctx.moveTo(cx - l, cy + o); ctx.lineTo(cx + l, cy + o);
          ctx.moveTo(cx - l, cy - o); ctx.lineTo(cx + l, cy - o);
        }
      }
      ctx.stroke();
      ctx.lineWidth = pass ? 4 : 6.5;
      ctx.beginPath();
      ctx.moveTo(cx + inner, cy); ctx.lineTo(cx + r, cy);
      ctx.moveTo(cx - inner, cy); ctx.lineTo(cx - r, cy);
      ctx.moveTo(cx, cy + inner); ctx.lineTo(cx, cy + r);
      ctx.moveTo(cx, cy - inner); ctx.lineTo(cx, cy - r);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(190,200,205,0.5)';
    ctx.beginPath(); ctx.arc(cx, cy, 2.6, 0, TAU); ctx.fill();
    ctx.fillStyle = '#08090b';
    ctx.beginPath(); ctx.arc(cx, cy, 1.6, 0, TAU); ctx.fill();
  }

  function drawScope(ctx, state, view, vw, vh) {
    var cx = vw / 2, cy = vh / 2, r = LW.cam.scopeRadius(vw, vh), s = LW.cam.scale(view, vh), p, key;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.clip();
    drawWorld(ctx, state, view, vw, vh, r, r);
    markers(ctx, state, view, vw, vh, true);
    weather(ctx, state, vw, vh, true);
    ctx.fillStyle = 'rgba(30,80,95,0.06)'; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    key = 'sv' + cx + ',' + cy + ',' + r;
    ctx.fillStyle = sgrad(key, function (c) {
      var g = c.createRadialGradient(cx, cy, r * 0.55, cx, cy, r);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.75, 'rgba(0,0,0,0.22)'); g.addColorStop(1, 'rgba(0,0,0,0.85)');
      return g;
    });
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    reticle(ctx, cx, cy, r, s);
    if (state.predicted && typeof state.predicted.x === 'number' && typeof state.predicted.y === 'number') {
      p = LW.cam.worldToScreen(view, vw, vh, state.predicted.x, state.predicted.y);
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, TAU); ctx.stroke();
      ctx.strokeStyle = '#e8a33d'; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, TAU); ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.rect(0, 0, vw, vh); ctx.arc(cx, cy, r, 0, TAU); ctx.fill('evenodd');
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,70,60,0.2)';
    ctx.beginPath(); ctx.arc(cx + 1.5, cy, r - 2.5, 0, TAU); ctx.stroke();
    ctx.strokeStyle = 'rgba(60,220,255,0.18)';
    ctx.beginPath(); ctx.arc(cx - 1.5, cy, r - 2.5, 0, TAU); ctx.stroke();
    ctx.lineWidth = 4; ctx.strokeStyle = '#0a0b0d';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(150,160,170,0.35)';
    ctx.beginPath(); ctx.arc(cx, cy, r - 2.5, 0, TAU); ctx.stroke();
  }

  function crosshair(ctx, vw, vh) {
    var cx = Math.round(vw / 2) + 0.5, cy = Math.round(vh / 2) + 0.5, g = 4, l = 8, pass;
    ctx.lineCap = 'butt';
    for (pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass ? 'rgba(228,232,232,0.85)' : 'rgba(0,0,0,0.6)';
      ctx.lineWidth = pass ? 1 : 3;
      ctx.beginPath();
      ctx.moveTo(cx - g - l, cy); ctx.lineTo(cx - g, cy); ctx.moveTo(cx + g, cy); ctx.lineTo(cx + g + l, cy);
      ctx.moveTo(cx, cy - g - l); ctx.lineTo(cx, cy - g); ctx.moveTo(cx, cy + g); ctx.lineTo(cx, cy + g + l);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(232,163,61,0.9)'; ctx.fillRect(cx - 1.5, cy - 1.5, 2, 2);
  }

  function vignette(ctx, vw, vh) {
    ctx.fillStyle = sgrad('v' + vw + 'x' + vh, function (c) {
      var g = c.createRadialGradient(vw / 2, vh / 2, Math.min(vw, vh) * 0.4, vw / 2, vh / 2, Math.sqrt(vw * vw + vh * vh) * 0.55);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.5)');
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
    var m = state.mission || {}, v, view;
    if (!K || K.mission !== m) { prepare(m); }
    if (K.gctx !== ctx) { K.gctx = ctx; K.g = {}; K.sg = {}; }
    v = state.view || {};
    view = { x: num(v.x, K.W / 2), y: num(v.y, 500), zoom: num(v.zoom, 1) > 0 ? num(v.zoom, 1) : 1 };
    ctx.save();
    try {
      ctx.globalAlpha = 1; ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, vw, vh);
      if (state.scoped) {
        drawScope(ctx, state, view, vw, vh);
      } else {
        drawWorld(ctx, state, view, vw, vh, vw / 2, vh / 2);
        markers(ctx, state, view, vw, vh, false);
        weather(ctx, state, vw, vh, false);
        vignette(ctx, vw, vh);
        crosshair(ctx, vw, vh);
      }
      muzzle(ctx, state, vw, vh);
      killcam(ctx, state, view, vw, vh);
    } catch (err) {
      if (!warned && window.console) { warned = true; console.error('LW.Render.draw failed', err); }
      for (var i = 0; i < 6; i++) { ctx.restore(); }
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
      entities: ents, bullets: [], effects: [{ type: 'blood', x: 1720, y: 850, dist: 125, t0: 0.5 }], killcam: null, predicted: null, wind: 2 };
    if (opts.scoped) { state.view = { x: 1150, y: 880 - 28.8 * 0.8, zoom: 4 }; state.predicted = { x: 1151, y: 860 }; }
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
