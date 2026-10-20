// Silent Contract: shared constants, body geometry, ballistics and camera math.
// Loaded first. Every other module relies on these exact formulas, so change them here only.
window.LW = window.LW || {};
(function (LW) {
  'use strict';

  LW.CONST = {
    WORLD_H: 1000,     // world height in world units; every mission uses it
    PERSON_K: 3600,    // person height (world units) = PERSON_K / dist (m)
    DROP_K: 5.0e-5,    // bullet drop (world units, downward) = DROP_K * dist^2 * loadout.dropMul
    WIND_K: 0.0018,    // wind drift (world units) = WIND_K * wind(m/s, + blows right) * dist
    MARK: 5,           // reticle hash spacing in world units
    OPTIC: 5,          // camera zoom per 1x of scope magnification (a 4x scope shows the world at zoom 20)
    MIN_DIST: 60,
    MAX_DIST: 600,
    HEAD_LENIENCY: 1.2 // head hit radius multiplier, keeps headshots fair on phones
  };

  LW.clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  LW.lerp = function (a, b, t) { return a + (b - a) * t; };

  // Person height in world units for an entity at e.dist metres.
  LW.personHeight = function (e) {
    var h = LW.CONST.PERSON_K / e.dist;
    var build = e.look && e.look.build;
    if (build === 'heavy') h *= 1.05;
    else if (build === 'slim') h *= 0.97;
    return h;
  };

  // Hit geometry. (e.x, e.y) is the point between the feet. y grows downward.
  // Window entities stand behind a sill at y - 0.45h: legs are hidden and cannot be hit.
  LW.bodyGeom = function (e) {
    var h = LW.personHeight(e);
    return {
      h: h,
      head:  { x: e.x, y: e.y - h * 0.9, r: h * 0.085 },
      torso: { x0: e.x - h * 0.15, x1: e.x + h * 0.15, y0: e.y - h * 0.8, y1: e.y - h * 0.45 },
      legs:  { x0: e.x - h * 0.11, x1: e.x + h * 0.11, y0: e.y - h * 0.45, y1: e.y },
      sillY: e.window ? e.y - h * 0.45 : null
    };
  };

  // Returns 'head', 'body' or null for a bullet arriving at (px, py) at the entity's distance.
  LW.hitTest = function (e, px, py) {
    var g = LW.bodyGeom(e);
    var dx = px - g.head.x, dy = py - g.head.y, r = g.head.r * LW.CONST.HEAD_LENIENCY;
    if (dx * dx + dy * dy <= r * r) return 'head';
    var t = g.torso;
    if (px >= t.x0 && px <= t.x1 && py >= t.y0 && py <= t.y1) return 'body';
    if (!e.window) {
      var l = g.legs;
      if (px >= l.x0 && px <= l.x1 && py >= l.y0 && py <= l.y1) return 'body';
    }
    return null;
  };

  // Ballistics. lo is the loadout object (see CONTRACT.md).
  LW.drop = function (dist, lo) { return LW.CONST.DROP_K * dist * dist * (lo ? lo.dropMul : 1); };
  LW.drift = function (dist, wind) { return LW.CONST.WIND_K * wind * dist; };
  LW.flightTime = function (dist, lo) { return dist / (lo ? lo.velocity : 800); };
  // Where a bullet aimed at (ax, ay) lands at a given distance.
  LW.impactAt = function (ax, ay, dist, wind, lo) {
    return { x: ax + LW.drift(dist, wind), y: ay + LW.drop(dist, lo) };
  };

  // Camera. view = { x, y, zoom }: the world point at the screen centre and the zoom (1 = unscoped).
  // Pixels per world unit = (viewport height / WORLD_H) * zoom.
  LW.cam = {
    scale: function (view, vh) { return (vh / LW.CONST.WORLD_H) * view.zoom; },
    worldToScreen: function (view, vw, vh, x, y) {
      var s = LW.cam.scale(view, vh);
      return { x: (x - view.x) * s + vw / 2, y: (y - view.y) * s + vh / 2 };
    },
    screenToWorld: function (view, vw, vh, sx, sy) {
      var s = LW.cam.scale(view, vh);
      return { x: (sx - vw / 2) / s + view.x, y: (sy - vh / 2) / s + view.y };
    },
    // Scope circle radius in CSS pixels, used by render (drawing) and core (nothing outside is visible).
    scopeRadius: function (vw, vh) { return Math.min(vw, vh) * 0.46; }
  };

  // Persistent storage that never throws.
  LW.store = {
    get: function (key, fallback) {
      try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (err) { return fallback; }
    },
    set: function (key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (err) { /* storage unavailable */ }
    }
  };
})(window.LW);
