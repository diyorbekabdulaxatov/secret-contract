// Silent Contract: UI layer. Page shell logic, menus, story panels, briefing, HUD, armory, saves and LW.Audio.
// ES5 only (var/function), so it parses everywhere. Boots the game.
window.LW = window.LW || {};
(function (LW) {
  'use strict';

  /* =====================================================================
   * Helpers
   * ===================================================================== */
  var PI2 = Math.PI * 2;
  var SODIUM = '#e8a33d', PAPER = '#e9e3d6', FOG = '#9aa7b2', BLOOD = '#9c2b2b';
  var SAVE_KEY = 'silentContract.save.v1';
  var HINT_KEY = 'silentContract.hint.v2';   // v2: new drag/tap controls, show the notes again once

  var store = LW.store || { get: function (k, f) { return f; }, set: function () {} };

  function $(id) { return document.getElementById(id); }
  function arr(x) { return Object.prototype.toString.call(x) === '[object Array]' ? x : []; }
  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function now() { return (window.performance && performance.now) ? performance.now() : new Date().getTime(); }
  function mk(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = String(text);
    return e;
  }
  function clear(el) { while (el && el.firstChild) el.removeChild(el.firstChild); }
  function pad2(n) { n = Math.max(0, Math.floor(n)); return (n < 10 ? '0' : '') + n; }
  function fmtMoney(n) {
    n = Math.round(num(n, 0));
    var s = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (n < 0 ? '\u2212$' : '$') + s;
  }
  function fmtSigned(n) { n = Math.round(num(n, 0)); return (n > 0 ? '+' : '') + fmtMoney(n); }
  function fmtTime(sec) {
    sec = Math.max(0, Math.ceil(num(sec, 0)));
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function starStr(n) { var s = '', i; for (i = 0; i < 3; i++) s += i < n ? '\u2605' : '\u2606'; return s; }
  function rgba(hex, a) {
    var h = String(hex || '#000000').replace('#', '');
    if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    var n = parseInt(h, 16) || 0;
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  function imul(a, b) {
    if (Math.imul) return Math.imul(a, b);
    var ah = (a >>> 16) & 0xffff, al = a & 0xffff, bh = (b >>> 16) & 0xffff, bl = b & 0xffff;
    return ((al * bl) + (((ah * bl + al * bh) << 16) >>> 0) | 0);
  }
  function rng(seed) {
    var s = (seed >>> 0) || 1;
    return function () {
      s = (s + 0x6D2B79F5) | 0;
      var t = imul(s ^ (s >>> 15), 1 | s);
      t = (t + imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashStr(str) {
    var h = 2166136261, i;
    str = String(str);
    for (i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = imul(h, 16777619); }
    return h >>> 0;
  }
  function each(list, fn) { var i; for (i = 0; i < list.length; i++) fn(list[i], i); }
  function matches(q) { try { return !!(window.matchMedia && window.matchMedia(q).matches); } catch (e) { return false; } }

  var reduceMotion = matches('(prefers-reduced-motion: reduce)');
  (function () {
    try {
      var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      var f = function (e) { reduceMotion = !!e.matches; };
      if (mq.addEventListener) mq.addEventListener('change', f);
      else if (mq.addListener) mq.addListener(f);
    } catch (e) { /* ignore */ }
  })();

  /* =====================================================================
   * LW.Audio: WebAudio synthesis, no files. Never throws.
   * ===================================================================== */
  var Audio = (function () {
    var ctx = null, master = null, sfx = null, ambBus = null, musicBus = null, echoIn = null, noiseBuf = null, failed = false;
    // Volumes are 0..1. Ambience follows the effects volume. muted silences everything.
    var sfxVol = 0.8, musicVol = 0.5, muted = false, menuWanted = false;
    var gestured = false, primed = false, ready = false;
    var amb = null, ambWanted = null;
    var music = { playing: false, timer: 0, next: 0, step: 0 };
    var lastPlay = {};
    var SFX_GAIN = 1.15, AMB_GAIN = 1.0, MUSIC_GAIN = 1.1;

    function node(v, dest) { var g = ctx.createGain(); g.gain.value = v; if (dest) g.connect(dest); return g; }
    function sfxLevel() { return muted ? 0 : sfxVol * SFX_GAIN; }
    function ambLevel() { return muted ? 0 : sfxVol * AMB_GAIN; }
    function musicLevel() { return muted ? 0 : musicVol * MUSIC_GAIN; }
    function sfxAudible() { return !muted && sfxVol > 0.001; }
    function musicAudible() { return !muted && musicVol > 0.001; }

    function ensure() {
      if (ctx || failed) return ctx;
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) { failed = true; return null; }
        ctx = new AC();
      } catch (e0) { failed = true; ctx = null; return null; }
      try {
        master = ctx.createGain(); master.gain.value = 0.85;
        var comp = null;
        try {
          if (ctx.createDynamicsCompressor) {
            comp = ctx.createDynamicsCompressor();
            comp.threshold.value = -12; comp.knee.value = 10; comp.ratio.value = 5;
            comp.attack.value = 0.003; comp.release.value = 0.25;
          }
        } catch (e1) { comp = null; }
        if (comp) { master.connect(comp); comp.connect(ctx.destination); } else master.connect(ctx.destination);
        sfx = node(sfxLevel(), master);
        ambBus = node(ambLevel(), master);
        musicBus = node(0, master);
        try {
          var delay = ctx.createDelay ? ctx.createDelay(1.0) : ctx.createDelayNode(1.0);
          delay.delayTime.value = 0.24;
          var fb = node(0.33);
          var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1300;
          echoIn = node(0.8);
          echoIn.connect(delay); delay.connect(lp); lp.connect(fb); fb.connect(delay); lp.connect(sfx);
        } catch (e2) { echoIn = null; }
        var len = Math.floor(ctx.sampleRate * 2);
        noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
        var d = noiseBuf.getChannelData(0), i;
        for (i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        ctx.onstatechange = function () {
          try {
            if (!ctx) return;
            if (ctx.state === 'running') afterUnlock();
            else ready = false;
          } catch (e3) { /* ignore */ }
        };
      } catch (e) {
        try { if (ctx && ctx.close) ctx.close(); } catch (e4) { /* ignore */ }
        failed = true; ctx = null;
      }
      return ctx;
    }

    function env(g, t, a, peak, d) {
      a = Math.max(0.001, a); d = Math.max(0.005, d);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    }
    function noise(t, o) {
      var a = o.a || 0.002, d = o.d || 0.1, dur = a + d + 0.05;
      var src = ctx.createBufferSource(); src.buffer = noiseBuf;
      var f = ctx.createBiquadFilter(); f.type = o.type || 'bandpass'; f.Q.value = o.q || 1;
      f.frequency.setValueAtTime(o.f || 1000, t);
      if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t + a + d);
      var g = ctx.createGain(); env(g, t, a, o.p || 0.4, d);
      src.connect(f); f.connect(g); g.connect(o.out || sfx);
      src.start(t, Math.random() * Math.max(0, 1.9 - dur));
      src.stop(t + dur);
      return g;
    }
    function tone(t, o) {
      var a = o.a || 0.004, d = o.d || 0.2;
      var osc = ctx.createOscillator(); osc.type = o.type || 'sine';
      osc.frequency.setValueAtTime(o.f, t);
      if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + a + d);
      var g = ctx.createGain(); env(g, t, a, o.p || 0.3, d);
      osc.connect(g); g.connect(o.out || sfx);
      osc.start(t); osc.stop(t + a + d + 0.05);
      return g;
    }
    function tick(t, f, p) {
      noise(t, { type: 'bandpass', f: f, q: 7, a: 0.001, d: 0.03, p: p });
      tone(t, { type: 'square', f: f * 0.5, a: 0.001, d: 0.012, p: p * 0.12 });
    }

    var S = {
      shot: function (t) {
        noise(t, { type: 'highpass', f: 1000, q: 0.7, a: 0.001, d: 0.08, p: 0.9 });
        var crack = noise(t, { type: 'bandpass', f: 2200, f2: 380, q: 0.9, a: 0.001, d: 0.24, p: 0.75 });
        if (echoIn) crack.connect(echoIn);
        tone(t, { f: 150, f2: 38, a: 0.002, d: 0.34, p: 0.95 });
        var tail = noise(t + 0.03, { type: 'lowpass', f: 1000, f2: 220, q: 0.4, a: 0.05, d: 1.15, p: 0.24 });
        if (echoIn) tail.connect(echoIn);
      },
      stamp: function (t) {
        noise(t, { type: 'lowpass', f: 520, a: 0.001, d: 0.09, p: 0.55 });
        tone(t, { f: 120, f2: 60, a: 0.002, d: 0.08, p: 0.35 });
        noise(t + 0.005, { type: 'bandpass', f: 2400, q: 2, a: 0.001, d: 0.025, p: 0.12 });
      },
      radio: function (t) {
        noise(t, { type: 'bandpass', f: 2600, q: 1.2, a: 0.004, d: 0.07, p: 0.08 });
        tone(t + 0.02, { type: 'square', f: 1240, a: 0.002, d: 0.05, p: 0.025 });
      },
      shotSuppressed: function (t) {
        noise(t, { type: 'lowpass', f: 1500, f2: 400, q: 0.7, a: 0.001, d: 0.08, p: 0.55 });
        tone(t, { f: 110, f2: 50, a: 0.002, d: 0.13, p: 0.45 });
        tick(t + 0.01, 3600, 0.12);
      },
      bolt: function (t) {
        tick(t, 2600, 0.35);
        noise(t + 0.06, { type: 'bandpass', f: 1800, f2: 3200, q: 2, a: 0.01, d: 0.09, p: 0.1 });
        tick(t + 0.18, 3200, 0.3);
        tick(t + 0.34, 2100, 0.42);
      },
      reload: function (t) {
        tick(t, 2400, 0.3);
        noise(t + 0.14, { type: 'bandpass', f: 1400, f2: 3000, q: 2, a: 0.02, d: 0.2, p: 0.12 });
        noise(t + 0.5, { type: 'lowpass', f: 420, a: 0.001, d: 0.07, p: 0.32 });
        tick(t + 0.5, 1900, 0.4);
        tick(t + 0.64, 3400, 0.25);
      },
      hitBody: function (t) {
        noise(t, { type: 'lowpass', f: 380, a: 0.001, d: 0.13, p: 0.75 });
        tone(t, { f: 95, f2: 45, a: 0.002, d: 0.12, p: 0.5 });
      },
      hitHead: function (t) {
        noise(t, { type: 'bandpass', f: 1700, f2: 450, q: 1.4, a: 0.001, d: 0.08, p: 0.6 });
        noise(t + 0.01, { type: 'lowpass', f: 320, a: 0.001, d: 0.17, p: 0.65 });
        tone(t, { f: 75, f2: 40, a: 0.002, d: 0.1, p: 0.4 });
      },
      impact: function (t) {
        noise(t, { type: 'bandpass', f: 2600, q: 2, a: 0.001, d: 0.05, p: 0.4 });
        noise(t + 0.01, { type: 'lowpass', f: 900, a: 0.002, d: 0.12, p: 0.2 });
        tone(t + 0.01, { f: 2300, f2: 900, a: 0.002, d: 0.18, p: 0.05 });
      },
      alert: function (t) {
        tone(t, { type: 'triangle', f: 620, a: 0.01, d: 0.1, p: 0.2 });
        tone(t + 0.14, { type: 'triangle', f: 830, a: 0.01, d: 0.16, p: 0.2 });
      },
      alarm: function (t) {
        var osc = ctx.createOscillator(); osc.type = 'sawtooth';
        var f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1500;
        var g = ctx.createGain(), k;
        osc.frequency.setValueAtTime(560, t);
        for (k = 0; k < 4; k++) {
          osc.frequency.linearRampToValueAtTime(920, t + k * 0.7 + 0.35);
          osc.frequency.linearRampToValueAtTime(560, t + k * 0.7 + 0.7);
        }
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.15, t + 0.06);
        g.gain.setValueAtTime(0.15, t + 2.5);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 2.85);
        osc.connect(f); f.connect(g); g.connect(sfx);
        osc.start(t); osc.stop(t + 2.9);
      },
      scopeIn: function (t) {
        noise(t, { type: 'bandpass', f: 420, f2: 2400, q: 3, a: 0.03, d: 0.12, p: 0.13 });
        tick(t + 0.15, 4200, 0.12);
      },
      scopeOut: function (t) {
        noise(t, { type: 'bandpass', f: 2400, f2: 420, q: 3, a: 0.02, d: 0.1, p: 0.1 });
        tick(t + 0.02, 3000, 0.08);
      },
      breath: function (t) { noise(t, { type: 'bandpass', f: 750, q: 0.8, a: 0.32, d: 0.55, p: 0.13 }); },
      click: function (t) {
        tone(t, { type: 'square', f: 1400, a: 0.001, d: 0.022, p: 0.05 });
        noise(t, { type: 'highpass', f: 4000, a: 0.001, d: 0.012, p: 0.05 });
      },
      win: function (t) {
        var notes = [220, 261.63, 329.63, 440, 554.37], i;
        for (i = 0; i < notes.length; i++) tone(t + i * 0.11, { type: 'triangle', f: notes[i], a: 0.04, d: 1.6 - i * 0.12, p: 0.11 });
        tone(t + 0.62, { type: 'sine', f: 659.25, a: 0.02, d: 1.4, p: 0.08 });
      },
      fail: function (t) {
        tone(t, { f: 196, f2: 98, a: 0.02, d: 1.2, p: 0.26 });
        tone(t, { f: 207.65, f2: 103.8, a: 0.02, d: 1.2, p: 0.12 });
        noise(t, { type: 'lowpass', f: 220, a: 0.05, d: 1.0, p: 0.18 });
      },
      cash: function (t) {
        tick(t, 5200, 0.14);
        tone(t + 0.02, { f: 1568, a: 0.002, d: 0.25, p: 0.16 });
        tone(t + 0.09, { f: 2093, a: 0.002, d: 0.42, p: 0.14 });
      },
      type: function (t) {
        noise(t, { type: 'bandpass', f: 1700 + Math.random() * 1300, q: 4, a: 0.001, d: 0.022, p: 0.16 });
        tone(t, { type: 'square', f: 170, a: 0.001, d: 0.01, p: 0.025 });
      }
    };

    function play(name) {
      if (!sfxAudible()) return;
      try {
        var fn = S[name];
        if (!fn) return;
        // Only create the context once the player has touched the page; a context made
        // outside a gesture starts suspended on Android/iOS WebViews.
        if (!ctx && !gestured) return;
        if (!ensure() || !noiseBuf) return;
        if (ctx.state !== 'running') {
          if (gestured) tryResume();
          return;   // a suspended clock would replay every queued sound at once on resume
        }
        var t = ctx.currentTime;
        if (lastPlay[name] !== undefined && t - lastPlay[name] < 0.025) return;
        lastPlay[name] = t;
        fn(t + 0.004);
      } catch (e) { /* never throw */ }
    }

    // ---- ambience: looped filtered noise for rain and city hum
    function ambience(time) {
      stopAmbience();
      ambWanted = time || 'night';
      if (!ctx || !noiseBuf || !ambBus) return;   // started on the next user gesture (unlock)
      try {
        var t = ctx.currentTime, nodes = [];
        var out = ctx.createGain();
        out.gain.setValueAtTime(0.0001, t);
        out.gain.exponentialRampToValueAtTime(1, t + 1.5);
        out.connect(ambBus);
        var loopNoise = function (type, freq, q, vol) {
          var s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
          var f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
          var g = ctx.createGain(); g.gain.value = vol;
          s.connect(f); f.connect(g); g.connect(out);
          s.start(t, Math.random());
          nodes.push(s);
          return g;
        };
        loopNoise('lowpass', 320, 0.7, 0.10);                 // distant traffic / city hum
        if (ambWanted === 'rain') {
          loopNoise('bandpass', 5200, 0.6, 0.11);             // hiss of rain
          loopNoise('lowpass', 1600, 0.5, 0.13);              // body of the downpour
          loopNoise('bandpass', 2600, 1.5, 0.04);
        } else if (ambWanted === 'fog' || ambWanted === 'dawn') {
          loopNoise('bandpass', 650, 0.4, 0.05);              // wind
        } else {
          loopNoise('highpass', 6000, 0.5, 0.025);            // light drizzle in the air
        }
        var o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 55;
        var og = ctx.createGain(); og.gain.value = 0.022;
        o.connect(og); og.connect(out); o.start(t); nodes.push(o);
        amb = { out: out, nodes: nodes };
      } catch (e) { amb = null; }
    }
    function stopAmbience() {
      ambWanted = null;
      if (!amb || !ctx) { amb = null; return; }
      var a = amb; amb = null;
      try {
        var t = ctx.currentTime, i;
        a.out.gain.cancelScheduledValues(t);
        a.out.gain.setValueAtTime(Math.max(0.0001, a.out.gain.value), t);
        a.out.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
        for (i = 0; i < a.nodes.length; i++) { try { a.nodes[i].stop(t + 0.7); } catch (e1) { /* ignore */ } }
        setTimeout(function () { try { a.out.disconnect(); } catch (e2) { /* ignore */ } }, 1000);
      } catch (e) { /* ignore */ }
    }

    // ---- menu music: slow minor progression on a soft pad, sparse bass and a bell
    var CHORDS = [[45, 57, 60, 64], [41, 53, 57, 60], [38, 50, 53, 57], [40, 52, 56, 59]];  // Am, F, Dm, E
    var BAR = 4.8;
    function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
    function pad(t, f, dur, vol) {
      var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 650; lp.Q.value = 0.4;
      var g = ctx.createGain(), k, o;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 1.5);
      g.gain.setValueAtTime(vol, t + dur - 1.6);
      g.gain.linearRampToValueAtTime(0, t + dur);
      lp.connect(g); g.connect(musicBus);
      for (k = 0; k < 2; k++) {
        o = ctx.createOscillator(); o.type = k ? 'sawtooth' : 'triangle';
        o.frequency.value = f; o.detune.value = k ? 6 : -6;
        o.connect(lp); o.start(t); o.stop(t + dur + 0.05);
      }
    }
    function bass(t, f, dur, vol) {
      var parts = [[1, 'sine', 1], [2, 'triangle', 0.3]], i, o, g;
      for (i = 0; i < parts.length; i++) {
        o = ctx.createOscillator(); o.type = parts[i][1]; o.frequency.value = f * parts[i][0];
        g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vol * parts[i][2], t + 0.04);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g); g.connect(musicBus); o.start(t); o.stop(t + dur + 0.05);
      }
    }
    function bell(t, f, vol) {
      var mult = [1, 2.01], i, o, g;
      for (i = 0; i < mult.length; i++) {
        o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * mult[i];
        g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vol / (i + 1), t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
        o.connect(g); g.connect(musicBus); o.start(t); o.stop(t + 2.7);
      }
    }
    function chord(t, step) {
      var ch = CHORDS[step % CHORDS.length], i;
      for (i = 1; i < ch.length; i++) pad(t, mtof(ch[i]), BAR + 1.0, 0.035);
      bass(t, mtof(ch[0]), 2.2, 0.12);
      if (Math.random() < 0.5) bass(t + BAR * 0.5 + 0.4, mtof(ch[0]), 1.4, 0.07);
      if (Math.random() < 0.55) bell(t + 1.0 + Math.random() * 2.4, mtof(ch[1 + Math.floor(Math.random() * 3)] + 12), 0.035);
    }
    function musicTick() {
      if (!ctx || !music.playing) return;
      try {
        if (music.next < ctx.currentTime) music.next = ctx.currentTime + 0.1;
        while (music.next < ctx.currentTime + 1.2) {
          chord(music.next, music.step);
          music.step++;
          music.next += BAR;
        }
      } catch (e) { /* ignore */ }
    }
    function startMusic() {
      if (!ctx || !musicBus) return;
      try {
        var t = ctx.currentTime;
        musicBus.gain.cancelScheduledValues(t);
        musicBus.gain.setTargetAtTime(musicLevel(), t, music.playing ? 0.25 : 0.8);
        if (music.playing) return;
        music.playing = true; music.next = t + 0.15; music.step = 0;
        musicTick();
        clearInterval(music.timer);
        music.timer = setInterval(musicTick, 400);
      } catch (e) { /* ignore */ }
    }
    function stopMusic() {
      if (ctx && musicBus) {
        try {
          var t = ctx.currentTime;
          musicBus.gain.cancelScheduledValues(t);
          musicBus.gain.setTargetAtTime(0, t, 0.3);
        } catch (e) { /* ignore */ }
      }
      music.playing = false;
      clearInterval(music.timer); music.timer = 0;
    }
    function updateMusic() { if (musicAudible() && menuWanted) startMusic(); else stopMusic(); }

    // Push the current volumes to the buses (smoothly, so slider drags do not click).
    function applyGains() {
      if (!ctx || !sfx) return;
      try {
        var t = ctx.currentTime;
        sfx.gain.cancelScheduledValues(t);
        sfx.gain.setTargetAtTime(sfxLevel(), t, 0.04);
        ambBus.gain.cancelScheduledValues(t);
        ambBus.gain.setTargetAtTime(ambLevel(), t, 0.15);
      } catch (e) { /* ignore */ }
      updateMusic();
    }

    function afterUnlock() {
      if (!ctx || ctx.state !== 'running') return;
      ready = true;
      applyGains();
      if (ambWanted && !amb) ambience(ambWanted);
    }
    function tryResume() {
      try {
        if (!ctx || ctx.state === 'running' || ctx.state === 'closed') return;
        if (document.hidden) return;
        var p = ctx.resume();
        if (p && typeof p.then === 'function') p.then(afterUnlock, function () {});
      } catch (e) { /* ignore */ }
    }
    // Called on every gesture (pointerdown, touchstart, touchend, click, keydown). Cheap once running.
    function unlock() {
      try {
        gestured = true;
        if (ready && ctx && ctx.state === 'running') return;
        if (!ensure()) return;
        if (!primed) {
          // iOS/WebKit only unlocks output after a buffer is started inside a gesture.
          try {
            var b = ctx.createBuffer(1, 1, 22050), s = ctx.createBufferSource();
            s.buffer = b; s.connect(ctx.destination);
            if (s.start) s.start(0); else if (s.noteOn) s.noteOn(0);
            primed = true;
          } catch (e1) { /* ignore */ }
        }
        if (ctx.state === 'running') afterUnlock();
        else tryResume();
      } catch (e) { /* ignore */ }
    }
    function setVolumes(sfxV, musicV) {
      if (typeof sfxV === 'number' && isFinite(sfxV)) sfxVol = clamp(sfxV, 0, 1);
      if (typeof musicV === 'number' && isFinite(musicV)) musicVol = clamp(musicV, 0, 1);
      applyGains();
    }
    function setMuted(on) { muted = !!on; applyGains(); }
    function isMuted() { return muted; }
    // Back-compat with the old on/off API.
    function setSound(on) { setVolumes(on ? (sfxVol > 0.001 ? sfxVol : 0.8) : 0); }
    function setMusic(on) { setVolumes(undefined, on ? (musicVol > 0.001 ? musicVol : 0.5) : 0); }
    function setMenu(on) { menuWanted = !!on; updateMusic(); }
    function suspend() {
      try { if (ctx && ctx.state === 'running') { ready = false; var p = ctx.suspend(); if (p && p.then) p.then(null, function () {}); } } catch (e) { /* ignore */ }
    }
    function resume() { tryResume(); }
    function getState() {
      return { context: ctx ? ctx.state : (failed ? 'unavailable' : 'none'), sfx: sfxVol, music: musicVol, muted: muted, musicPlaying: music.playing, ambience: !!amb };
    }

    return {
      play: play, ambience: ambience, stopAmbience: stopAmbience,
      unlock: unlock, setVolumes: setVolumes, setMuted: setMuted, isMuted: isMuted,
      setSound: setSound, setMusic: setMusic, setMenu: setMenu,
      suspend: suspend, resume: resume, getState: getState
    };
  })();
  LW.Audio = Audio;

  /* =====================================================================
   * Data index
   * ===================================================================== */
  var D = null, WEAPONS = [], GEAR = [], MISSIONS = [], CAMPAIGN = [], RANGE = null, CHAPTERS = [];

  function indexData() {
    D = LW.DATA;
    WEAPONS = []; GEAR = []; MISSIONS = []; CAMPAIGN = []; RANGE = null; CHAPTERS = [];
    each(arr(D.weapons), function (w) { if (w && w.id) WEAPONS.push(w); });
    each(arr(D.gear), function (g) { if (g && g.id && arr(g.levels).length) GEAR.push(g); });
    each(arr(D.missions), function (m) {
      if (!m || !m.id) return;
      MISSIONS.push(m);
      if (m.id === 'range' || m.chapter === 0) { if (!RANGE) RANGE = m; }
      else CAMPAIGN.push(m);
    });
    var seen = {};
    if (RANGE) { CHAPTERS.push({ id: 0, title: 'Shooting Range', subtitle: 'Calibrate the rifle. Get paid. Repeat.' }); seen[0] = true; }
    each(arr(D.chapters), function (c) {
      if (!c || typeof c.id !== 'number' || seen[c.id]) return;
      seen[c.id] = true; CHAPTERS.push(c);
    });
    each(CAMPAIGN, function (m) {
      var id = num(m.chapter, 1);
      if (!seen[id]) { seen[id] = true; CHAPTERS.push({ id: id, title: 'Chapter ' + id, subtitle: '' }); }
    });
    CHAPTERS.sort(function (a, b) { return a.id - b.id; });
  }
  function weaponById(id) { var i; for (i = 0; i < WEAPONS.length; i++) if (WEAPONS[i].id === id) return WEAPONS[i]; return null; }
  function gearById(id) { var i; for (i = 0; i < GEAR.length; i++) if (GEAR[i].id === id) return GEAR[i]; return null; }
  function chapterById(id) { var i; for (i = 0; i < CHAPTERS.length; i++) if (CHAPTERS[i].id === id) return CHAPTERS[i]; return null; }
  function labelOf(level) {
    if (!level) return '';
    if (level.label) return String(level.label);
    if (level.value === true) return 'Fitted';
    if (level.value === false) return 'None';
    return String(level.value);
  }

  /* =====================================================================
   * Save
   * ===================================================================== */
  var save = null;

  function defaultSave() {
    var first = WEAPONS[0];
    var gear = { scope: 0, stock: 0, mag: 0, suppressor: 0, computer: 0 };
    each(GEAR, function (g) { gear[g.id] = 0; });
    return {
      money: 0,
      weapons: first ? [first.id] : [],
      equipped: first ? first.id : null,
      gear: gear,
      missions: {},
      settings: defaultSettings(),
      seenIntro: false
    };
  }
  var SENS_MIN = 0.4, SENS_MAX = 2.5;
  function defaultSettings() {
    return { sfxVolume: 0.8, musicVolume: 0.5, muted: false, sensitivity: 1, aimInvert: false, tapToScope: true, sound: true, music: true };
  }
  function vol01(v, d) { v = num(v, d); return Math.round(clamp(v, 0, 1) * 100) / 100; }
  function normalizeSettings(st) {
    st = (st && typeof st === 'object') ? st : {};
    var out = defaultSettings();
    // migrate the old on/off flags: sound false -> effects 0, music false -> music 0
    out.sfxVolume = typeof st.sfxVolume === 'number' ? vol01(st.sfxVolume, 0.8) : (st.sound === false ? 0 : 0.8);
    out.musicVolume = typeof st.musicVolume === 'number' ? vol01(st.musicVolume, 0.5) : (st.music === false ? 0 : 0.5);
    out.muted = st.muted === true;
    out.sensitivity = Math.round(clamp(num(st.sensitivity, 1), SENS_MIN, SENS_MAX) * 100) / 100;
    out.aimInvert = st.aimInvert === true;
    out.tapToScope = st.tapToScope !== false;
    syncLegacyFlags(out);
    return out;
  }
  // Keep the contract's old booleans meaningful for anything else that reads them.
  function syncLegacyFlags(s) {
    s.sound = !s.muted && s.sfxVolume > 0;
    s.music = !s.muted && s.musicVolume > 0;
  }
  function normalizeSave(s) {
    var out = defaultSave();
    if (!s || typeof s !== 'object') return out;
    out.money = Math.max(0, Math.floor(num(s.money, 0)));
    var owned = [];
    each(arr(s.weapons), function (id) { if (typeof id === 'string' && weaponById(id) && owned.indexOf(id) < 0) owned.push(id); });
    if (WEAPONS[0] && owned.indexOf(WEAPONS[0].id) < 0) owned.unshift(WEAPONS[0].id);
    out.weapons = owned;
    out.equipped = (typeof s.equipped === 'string' && owned.indexOf(s.equipped) >= 0) ? s.equipped : (owned[0] || null);
    if (s.gear && typeof s.gear === 'object') {
      each(Object.keys(out.gear), function (k) {
        var g = gearById(k), max = g ? arr(g.levels).length - 1 : 0;
        out.gear[k] = clamp(Math.floor(num(s.gear[k], 0)), 0, Math.max(0, max));
      });
    }
    if (s.missions && typeof s.missions === 'object') {
      each(Object.keys(s.missions), function (k) {
        var v = s.missions[k];
        var st = (v && typeof v === 'object') ? num(v.stars, 0) : 0;
        out.missions[k] = { stars: clamp(Math.floor(st), 0, 3) };
      });
    }
    out.settings = normalizeSettings(s.settings);
    out.seenIntro = !!s.seenIntro;
    return out;
  }
  function loadSave() { return normalizeSave(store.get(SAVE_KEY, null)); }
  function persist() { store.set(SAVE_KEY, save); }

  function starsOf(id) { var r = save.missions[id]; return r ? num(r.stars, 0) : 0; }
  function isUnlocked(m) {
    if (!m) return false;
    if (m === RANGE) return true;
    var i = CAMPAIGN.indexOf(m);
    if (i <= 0) return true;
    return starsOf(CAMPAIGN[i - 1].id) >= 1;
  }
  function nextMission(m) { var i = CAMPAIGN.indexOf(m); return (i >= 0 && i + 1 < CAMPAIGN.length) ? CAMPAIGN[i + 1] : null; }
  function isFinal(m) { return !!m && (m.id === 'm12' || (CAMPAIGN.length > 0 && CAMPAIGN[CAMPAIGN.length - 1] === m)); }
  function completedCount() { var n = 0; each(CAMPAIGN, function (m) { if (starsOf(m.id) > 0) n++; }); return n; }
  function nextOpenMission() { var i; for (i = 0; i < CAMPAIGN.length; i++) if (isUnlocked(CAMPAIGN[i]) && !starsOf(CAMPAIGN[i].id)) return CAMPAIGN[i]; return null; }

  function gearLevel(id) {
    var g = gearById(id);
    if (!g) return 0;
    return clamp(Math.floor(num(save.gear[id], 0)), 0, Math.max(0, arr(g.levels).length - 1));
  }
  function gearLevelObj(id) { var g = gearById(id); return g ? (arr(g.levels)[gearLevel(id)] || null) : null; }
  function gearValue(id, def) { var l = gearLevelObj(id); return (l && l.value !== undefined && l.value !== null) ? l.value : def; }

  function buildLoadout() {
    var w = weaponById(save.equipped) || WEAPONS[0] || { id: 'rifle', name: 'Rifle' };
    var stock = num(gearValue('stock', 1), 1);
    return {
      weaponId: w.id,
      name: w.name || w.id,
      damage: num(w.damage, 70),
      velocity: num(w.velocity, 780),
      dropMul: num(w.dropMul, 1),
      swayMul: num(w.swayMul, 1) * stock,
      zoom: num(gearValue('scope', 3), 3),
      magazine: Math.max(1, Math.round(num(w.magazine, 5) + num(gearValue('mag', 0), 0))),
      reloadTime: num(w.reloadTime, 2.2),
      boltTime: num(w.boltTime, 1),
      suppressed: !!(w.suppressed || gearValue('suppressor', false) === true),
      computer: gearValue('computer', false) === true
    };
  }

  /* =====================================================================
   * Elements and screens
   * ===================================================================== */
  var E = {};
  var IDS = {
    canvas: 'game-canvas', hud: 'hud', targets: 'hud-targets', objectives: 'hud-objectives', timer: 'hud-timer',
    alarm: 'hud-alarm', alarmFill: 'hud-alarm-fill', alarmLabel: 'hud-alarm-label', alarmPct: 'hud-alarm-pct',
    pauseBtn: 'btn-pause', soundBtn: 'btn-sound', wind: 'hud-wind', windSvg: 'hud-wind-svg', windPanel: 'hud-wind-panel',
    gust: 'hud-gust', range: 'hud-range', rangeLz: 'hud-range-lz', rangeBox: 'hud-range-box',
    targetsRow: 'hud-targets-row', tally: 'hud-tally',
    sub: 'hud-sub', subSpeaker: 'hud-sub-speaker', subText: 'hud-sub-text', subSr: 'hud-sub-sr', toast: 'hud-toast',
    pips: 'hud-ammo-pips', ringLabel: 'hud-ring-label', ring: 'fire-ring', ringArc: 'fire-ring-arc',
    fire: 'ctl-fire', scope: 'ctl-scope', reload: 'ctl-reload', zoomIn: 'ctl-zoom-in', zoomOut: 'ctl-zoom-out',
    zoom: 'hud-zoom', breath: 'ctl-breath', breathFill: 'hud-breath-fill',
    hint: 'hud-hint', hintTouch: 'hud-hint-touch', hintKeys: 'hud-hint-keys',
    titleCanvas: 'title-canvas', menuContinue: 'menu-continue', continueLabel: 'menu-continue-label',
    continueNote: 'menu-continue-note', menuMissions: 'menu-missions', missionsNote: 'menu-missions-note',
    menuArmory: 'menu-armory', menuRange: 'menu-range', menuSettings: 'menu-settings', titleMoney: 'title-money',
    missionsBack: 'missions-back', missionsMoney: 'missions-money', chapterTabs: 'chapter-tabs',
    chapterTitle: 'chapter-title', chapterSub: 'chapter-sub', missionGrid: 'mission-grid',
    storyCanvas: 'story-canvas', storyCaption: 'story-caption', storySpeaker: 'story-speaker',
    storyText: 'story-text', storyNext: 'story-next', storyCount: 'story-count', storySkip: 'story-skip',
    briefDossier: 'brief-dossier', briefFile: 'brief-file', briefTitle: 'brief-title', briefLoc: 'brief-loc', briefBadges: 'brief-badges',
    briefText: 'brief-text', briefIntelWrap: 'brief-intel-wrap', briefIntel: 'brief-intel',
    briefObjWrap: 'brief-obj-wrap', briefObjectives: 'brief-objectives', briefConditions: 'brief-conditions',
    briefReward: 'brief-reward', briefLoadout: 'brief-loadout', briefAccept: 'brief-accept',
    briefArmory: 'brief-armory', briefBack: 'brief-back',
    resHead: 'res-head', resMission: 'res-mission', resTitle: 'res-title', resReason: 'res-reason',
    resStars: 'res-stars', resBest: 'res-best', resStamp: 'res-stamp', resStats: 'res-stats', resMoney: 'res-money',
    resBalance: 'res-balance', resNext: 'res-next', resRetry: 'res-retry', resMissions: 'res-missions',
    armoryBack: 'armory-back', armoryMoney: 'armory-money', armoryRifles: 'armory-rifles', armoryGear: 'armory-gear',
    settingsBack: 'settings-back', setSound: 'set-sound', setSens: 'set-sensitivity',
    setSensVal: 'set-sensitivity-val', setReset: 'set-reset',
    setSfxVol: 'set-sfx-vol', setMusicVol: 'set-music-vol', setDrag: 'set-drag', setTap: 'set-tap',
    pause: 'pause', pauseMission: 'pause-mission', pauseObjectives: 'pause-objectives', pauseSettings: 'pause-settings',
    pauseSound: 'pause-sound', pauseSfxVol: 'pause-sfx-vol', pauseMusicVol: 'pause-music-vol',
    pauseSens: 'pause-sensitivity', pauseDrag: 'pause-drag', pauseTap: 'pause-tap',
    pauseResume: 'pause-resume', pauseRestart: 'pause-restart', pauseQuit: 'pause-quit',
    confirm: 'confirm', confirmCard: 'confirm-card', confirmTitle: 'confirm-title', confirmText: 'confirm-text',
    confirmYes: 'confirm-yes', confirmNo: 'confirm-no',
    error: 'error-panel', errorTitle: 'error-title', errorText: 'error-text', errorClose: 'error-close',
    menuToast: 'menu-toast', portrait: 'portrait-hint', portraitDismiss: 'portrait-dismiss'
  };
  var SCREEN_NAMES = ['title', 'missions', 'story', 'briefing', 'results', 'armory', 'settings'];
  var SCREENS = {};
  var current = null;
  var enterTimer = 0;

  function grabElements() {
    var missing = [];
    each(Object.keys(IDS), function (k) { E[k] = $(IDS[k]); if (!E[k]) missing.push('#' + IDS[k]); });
    each(SCREEN_NAMES, function (n) { SCREENS[n] = $('screen-' + n); if (!SCREENS[n]) missing.push('#screen-' + n); });
    return missing;
  }

  function focusSoon(target) {
    setTimeout(function () {
      var el = typeof target === 'string' ? $(target) : target;
      if (el && !el.disabled && typeof el.focus === 'function') {
        try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
      }
    }, 30);
  }

  function showScreen(name, focusId) {
    each(SCREEN_NAMES, function (n) { if (SCREENS[n]) SCREENS[n].hidden = n !== name; });
    current = name;
    if (name === 'title') titleStart(); else titleStop();
    if (!Play.active && E.canvas) E.canvas.hidden = name !== 'results';
    Audio.setMenu(!!name && !Play.active);
    if (name && SCREENS[name]) {
      SCREENS[name].scrollTop = 0;
      SCREENS[name].classList.remove('enter');
      if (!reduceMotion) {
        var scr = SCREENS[name];
        void scr.offsetWidth;
        scr.classList.add('enter');
        clearTimeout(enterTimer);
        enterTimer = setTimeout(function () { scr.classList.remove('enter'); }, 1000);
      }
      if (focusId) focusSoon(focusId);
      else {
        var b = SCREENS[name].querySelector('button:not([disabled])');
        if (b) focusSoon(b);
      }
    }
  }

  var toastTimer = 0;
  function menuToast(text) {
    if (!E.menuToast) return;
    E.menuToast.textContent = text;
    E.menuToast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { E.menuToast.hidden = true; }, 2400);
  }

  /* ---------- in-page confirm ---------- */
  var confirmCb = null, confirmPrev = null;
  function showConfirm(o, onYes) {
    E.confirmTitle.textContent = o.title || 'Are you sure?';
    E.confirmText.textContent = o.text || '';
    E.confirmYes.textContent = o.yes || 'Confirm';
    E.confirmNo.textContent = o.no || 'Cancel';
    E.confirmYes.className = o.danger ? 'btn-danger' : 'btn-primary';
    E.confirmCard.className = 'confirm-card' + (o.danger ? ' danger' : '');
    confirmCb = onYes || null;
    confirmPrev = document.activeElement;
    E.confirm.hidden = false;
    focusSoon(E.confirmNo);
  }
  function closeConfirm(ok) {
    if (E.confirm.hidden) return;
    E.confirm.hidden = true;
    var cb = confirmCb; confirmCb = null;
    if (confirmPrev && document.body.contains(confirmPrev)) focusSoon(confirmPrev);
    confirmPrev = null;
    if (ok && cb) cb();
  }

  /* ---------- error panel ---------- */
  var errorOnClose = null;
  function showError(title, text, closable, onClose) {
    if (!E.error || !E.errorTitle) {
      var d = document.createElement('div');
      d.style.cssText = 'position:fixed;inset:0;z-index:99;background:#0b1016;color:#e9e3d6;padding:24px;font:16px/1.5 monospace;white-space:pre-wrap';
      d.textContent = title + '\n\n' + text;
      document.body.appendChild(d);
      return;
    }
    E.errorTitle.textContent = title;
    E.errorText.textContent = text;
    E.errorClose.hidden = !closable;
    errorOnClose = onClose || null;
    E.error.hidden = false;
    if (closable) focusSoon(E.errorClose);
  }
  function closeError() {
    if (E.errorClose.hidden) return;
    E.error.hidden = true;
    var f = errorOnClose; errorOnClose = null;
    if (f) f();
  }

  /* =====================================================================
   * Shared procedural drawing
   * ===================================================================== */
  function makeLayer(W, H, dpr, fn) {
    var cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(W * dpr)); cv.height = Math.max(1, Math.round(H * dpr));
    var c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    fn(c, W, H);
    return cv;
  }
  function lg(c, x0, y0, x1, y1, stops) {
    var g = c.createLinearGradient(x0, y0, x1, y1), i;
    for (i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
    return g;
  }
  function glow(c, x, y, r, hex, a) {
    if (!(r > 0)) return;
    var g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(hex, a)); g.addColorStop(1, rgba(hex, 0));
    c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  function cone(c, x, y, topW, botW, len, hex, a) {
    c.fillStyle = lg(c, x, y, x, y + len, [[0, rgba(hex, a)], [1, rgba(hex, 0)]]);
    c.beginPath();
    c.moveTo(x - topW / 2, y); c.lineTo(x + topW / 2, y);
    c.lineTo(x + botW / 2, y + len); c.lineTo(x - botW / 2, y + len);
    c.closePath(); c.fill();
  }
  function vignette(c, W, H, a) {
    var g = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,' + a + ')');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
  }
  function bokeh(c, W, r, n, y0, y1, H, colors) {
    var i;
    for (i = 0; i < n; i++) glow(c, r() * W, y0 + r() * (y1 - y0), H * (0.012 + r() * 0.04), colors[Math.floor(r() * colors.length)], 0.15 + r() * 0.35);
  }
  // A row of buildings with lit windows between x0 and x1, standing on baseY.
  function skyline(c, x0, x1, baseY, minH, maxH, color, r, win, lit, alpha) {
    var x = x0 - r() * 40, W = x1 - x0;
    while (x < x1) {
      var bw = Math.max(win * 4, W * (0.035 + r() * 0.08));
      var bh = minH + r() * (maxH - minH);
      var top = baseY - bh;
      c.fillStyle = color;
      c.fillRect(x, top, bw, bh + 2);
      var roll = r();
      if (roll < 0.22) {
        c.fillRect(x + bw * (0.2 + r() * 0.5), top - bh * 0.12, Math.max(1, win * 0.4), bh * 0.12);
      } else if (roll < 0.34) {
        var tw = bw * 0.28, tx = x + bw * (0.15 + r() * 0.5);
        c.fillRect(tx, top - tw * 1.1, tw, tw * 0.8);
        c.fillRect(tx + tw * 0.1, top - tw * 0.3, tw * 0.1, tw * 0.3);
        c.fillRect(tx + tw * 0.8, top - tw * 0.3, tw * 0.1, tw * 0.3);
      } else if (roll < 0.44) {
        c.fillRect(x + bw * 0.1, top - win * 1.5, bw * 0.8, win * 1.5);
      }
      var gx = win * 2.1, gy = win * 2.6;
      var cols = Math.floor((bw - win) / gx), rows = Math.floor((bh - win * 2) / gy);
      var ox = x + (bw - cols * gx + (gx - win)) / 2, i, j;
      for (j = 0; j < rows; j++) {
        for (i = 0; i < cols; i++) {
          if (r() < lit) {
            c.fillStyle = r() < 0.86 ? rgba(SODIUM, (alpha * (0.3 + r() * 0.7)).toFixed(3)) : rgba(FOG, (alpha * (0.25 + r() * 0.4)).toFixed(3));
            c.fillRect(ox + i * gx, top + win * 1.5 + j * gy, win, win * 1.3);
          }
        }
      }
      x += bw + r() * W * 0.012;
    }
  }
  function makeDrops(W, H, n) {
    var d = [], i;
    for (i = 0; i < n; i++) d.push({ x: Math.random() * W * 1.2 - W * 0.1, y: Math.random() * H, l: 8 + Math.random() * 16, v: 600 + Math.random() * 600 });
    return d;
  }
  function drawRain(c, drops, W, H, dt, alpha, slant) {
    var i, d;
    c.strokeStyle = 'rgba(154,167,178,' + alpha + ')';
    c.lineWidth = 1;
    c.beginPath();
    for (i = 0; i < drops.length; i++) {
      d = drops[i];
      if (dt) {
        d.y += d.v * dt; d.x += d.v * slant * dt;
        if (d.y > H + 20) { d.y = -20 - Math.random() * 40; d.x = Math.random() * W * 1.2 - W * 0.1; }
        if (d.x > W + 20) d.x -= W * 1.2;
      }
      c.moveTo(d.x, d.y);
      c.lineTo(d.x - d.l * slant, d.y - d.l);
    }
    c.stroke();
  }
  function neonText(c, text, x, y, size, hex, vertical) {
    var i;
    c.save();
    c.font = '800 ' + Math.round(size) + 'px "Big Shoulders Stencil Display", "Big Shoulders Stencil", Impact, sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'top';
    c.shadowColor = rgba(hex, 0.9); c.shadowBlur = size * 0.5;
    c.fillStyle = rgba(hex, 0.85);
    if (vertical) { for (i = 0; i < text.length; i++) c.fillText(text.charAt(i), x, y + i * size * 1.02); }
    else c.fillText(text, x, y);
    c.restore();
  }
  function lamp(c, x, baseY, hgt) {
    var k = hgt / 200, top = baseY - hgt, hx = x + hgt * 0.14;
    c.fillStyle = '#05070a';
    c.fillRect(x - 2 * k, top, 4 * k, hgt);
    c.fillRect(x - 2 * k, top, hgt * 0.14, 3 * k);
    c.beginPath();
    c.moveTo(hx - 10 * k, top + 2 * k); c.lineTo(hx + 10 * k, top + 2 * k);
    c.lineTo(hx + 6 * k, top + 9 * k); c.lineTo(hx - 6 * k, top + 9 * k);
    c.closePath(); c.fill();
    cone(c, hx, top + 9 * k, 12 * k, hgt * 0.9, hgt - 9 * k, SODIUM, 0.2);
    glow(c, hx, top + 8 * k, hgt * 0.18, SODIUM, 0.5);
    c.fillStyle = 'rgba(255,214,150,0.9)'; c.fillRect(hx - 5 * k, top + 8 * k, 10 * k, 2 * k);
    c.save(); c.translate(hx, baseY + hgt * 0.03); c.scale(1, 0.18); glow(c, 0, 0, hgt * 0.5, SODIUM, 0.4); c.restore();
  }
  function waterTower(c, x, baseY, h) {
    var w = h * 0.36, tankTop = baseY - h, tankBot = baseY - h * 0.45;
    c.fillStyle = '#06080b';
    c.fillRect(x - w / 2, tankTop, w, tankBot - tankTop);
    c.beginPath(); c.moveTo(x - w * 0.58, tankTop); c.lineTo(x, tankTop - h * 0.16); c.lineTo(x + w * 0.58, tankTop); c.closePath(); c.fill();
    c.strokeStyle = '#06080b'; c.lineWidth = Math.max(2, h * 0.025);
    c.beginPath();
    c.moveTo(x - w * 0.4, tankBot); c.lineTo(x - w * 0.5, baseY);
    c.moveTo(x + w * 0.4, tankBot); c.lineTo(x + w * 0.5, baseY);
    c.moveTo(x - w * 0.45, tankBot + h * 0.2); c.lineTo(x + w * 0.45, tankBot + h * 0.2);
    c.stroke();
    c.fillStyle = 'rgba(154,167,178,0.12)'; c.fillRect(x - w / 2, tankTop, w * 0.08, tankBot - tankTop);
  }
  function craneSil(c, x, baseY, h, dir) {
    var w = h * 0.07, top = baseY - h, y;
    c.strokeStyle = '#080b0f'; c.lineWidth = Math.max(1.5, h * 0.012);
    c.beginPath();
    c.moveTo(x - w, baseY); c.lineTo(x - w, top);
    c.moveTo(x + w, baseY); c.lineTo(x + w, top);
    for (y = baseY; y > top + w * 2; y -= w * 2) { c.moveTo(x - w, y); c.lineTo(x + w, y - w * 2); }
    c.moveTo(x - dir * h * 0.3, top); c.lineTo(x + dir * h * 0.95, top);
    c.moveTo(x - dir * h * 0.3, top + w); c.lineTo(x + dir * h * 0.95, top + w * 0.6);
    c.moveTo(x, top); c.lineTo(x, top - h * 0.12); c.lineTo(x + dir * h * 0.95, top);
    c.moveTo(x, top - h * 0.12); c.lineTo(x - dir * h * 0.3, top);
    var hx = x + dir * h * 0.6;
    c.moveTo(hx, top + w); c.lineTo(hx, top + h * 0.35);
    c.stroke();
    c.fillStyle = '#080b0f';
    c.fillRect(x - dir * h * 0.3 - (dir > 0 ? 0 : h * 0.1), top, h * 0.1, h * 0.06);
    glow(c, x, top - h * 0.12, h * 0.03, BLOOD, 0.9);
  }
  function crate(c, x, baseY, s) {
    c.fillStyle = '#15110d'; c.fillRect(x, baseY - s, s, s);
    c.strokeStyle = '#0a0806'; c.lineWidth = Math.max(1, s * 0.05);
    c.strokeRect(x + s * 0.06, baseY - s * 0.94, s * 0.88, s * 0.88);
    c.beginPath(); c.moveTo(x + s * 0.06, baseY - s * 0.06); c.lineTo(x + s * 0.94, baseY - s * 0.94); c.stroke();
    c.fillStyle = 'rgba(232,163,61,0.16)'; c.fillRect(x, baseY - s, s, 2);
  }

  /* =====================================================================
   * Story panel scenes (one function per Panel.bg)
   * ===================================================================== */
  var SCENES = {
    'rain-street': function (c, W, H, r, side) {
      var i, x;
      c.fillStyle = lg(c, 0, 0, 0, H * 0.72, [[0, '#070b10'], [1, '#1a222c']]); c.fillRect(0, 0, W, H);
      skyline(c, 0, W, H * 0.72, H * 0.15, H * 0.45, '#111820', r, Math.max(2, H * 0.008), 0.2, 0.6);
      c.fillStyle = '#080b0f';
      c.fillRect(0, 0, W * 0.16, H * 0.74);
      c.fillRect(W * 0.86, H * 0.05, W * 0.14, H * 0.7);
      for (i = 0; i < 6; i++) {
        c.fillStyle = rgba(SODIUM, (0.08 + r() * 0.3).toFixed(3));
        c.fillRect(W * 0.03, H * (0.38 + i * 0.055), W * 0.05, H * 0.035);
        c.fillStyle = rgba(r() < 0.5 ? SODIUM : FOG, (0.06 + r() * 0.25).toFixed(3));
        c.fillRect(W * 0.9, H * (0.12 + i * 0.09), W * 0.06, H * 0.05);
      }
      neonText(c, 'HOTEL', W * 0.125, H * 0.06, H * 0.055, BLOOD, true);
      c.fillStyle = lg(c, 0, H * 0.72, 0, H, [[0, '#121921'], [1, '#06080b']]); c.fillRect(0, H * 0.72, W, H * 0.28);
      c.fillStyle = 'rgba(154,167,178,0.18)'; c.fillRect(0, H * 0.74, W, 2);
      lamp(c, side > 0 ? W * 0.34 : W * 0.6, H * 0.74, H * 0.52);
      for (i = 0; i < 26; i++) {
        x = r() * W;
        c.fillStyle = rgba(r() < 0.8 ? SODIUM : FOG, (0.04 + r() * 0.1).toFixed(3));
        c.fillRect(x, H * 0.76 + r() * H * 0.05, 1 + r() * W * 0.01, H * (0.05 + r() * 0.18));
      }
      return { rain: true, rim: SODIUM };
    },
    bar: function (c, W, H, r, side) {
      var s, x, sy, bh, bw, i;
      var cols = ['#2a1a10', '#1d2418', '#3a2412', '#151a20'];
      c.fillStyle = lg(c, 0, 0, 0, H, [[0, '#120d0a'], [0.6, '#1d1510'], [1, '#080605']]); c.fillRect(0, 0, W, H);
      c.fillStyle = 'rgba(154,167,178,0.05)'; c.fillRect(W * 0.05, H * 0.12, W * 0.9, H * 0.42);
      for (s = 0; s < 2; s++) {
        sy = H * (0.32 + s * 0.18);
        c.fillStyle = '#0a0705'; c.fillRect(W * 0.04, sy, W * 0.92, H * 0.012);
        x = W * 0.06;
        while (x < W * 0.94) {
          bh = H * (0.06 + r() * 0.06); bw = W * (0.012 + r() * 0.01);
          c.fillStyle = cols[Math.floor(r() * cols.length)];
          c.fillRect(x, sy - bh, bw, bh);
          c.fillRect(x + bw * 0.35, sy - bh * 1.35, bw * 0.3, bh * 0.35);
          c.fillStyle = rgba(SODIUM, (0.2 + r() * 0.3).toFixed(3));
          c.fillRect(x + bw * 0.15, sy - bh * 0.9, Math.max(1, bw * 0.12), bh * 0.7);
          x += bw + W * (0.004 + r() * 0.012);
        }
      }
      neonText(c, 'LOUNGE', side > 0 ? W * 0.3 : W * 0.7, H * 0.035, H * 0.07, SODIUM, false);
      each([0.22, 0.5, 0.78], function (fx) {
        var lx = W * fx;
        c.fillStyle = '#050403'; c.fillRect(lx - 1, 0, 2, H * 0.12);
        c.beginPath(); c.moveTo(lx - H * 0.04, H * 0.15); c.lineTo(lx + H * 0.04, H * 0.15); c.lineTo(lx + H * 0.02, H * 0.12); c.lineTo(lx - H * 0.02, H * 0.12); c.closePath(); c.fill();
        cone(c, lx, H * 0.15, H * 0.08, H * 0.5, H * 0.55, SODIUM, 0.1);
        glow(c, lx, H * 0.15, H * 0.08, SODIUM, 0.4);
      });
      c.fillStyle = '#0b0806'; c.fillRect(0, H * 0.7, W, H * 0.3);
      c.fillStyle = rgba(SODIUM, 0.35); c.fillRect(0, H * 0.7, W, 2);
      c.fillStyle = '#140e0a'; c.fillRect(0, H * 0.705, W, H * 0.03);
      var gx = side > 0 ? W * 0.42 : W * 0.55;
      c.fillStyle = 'rgba(233,227,214,0.14)'; c.fillRect(gx, H * 0.64, H * 0.035, H * 0.06);
      c.fillStyle = rgba(SODIUM, 0.45); c.fillRect(gx, H * 0.675, H * 0.035, H * 0.025);
      for (i = 0; i < 5; i++) glow(c, r() * W, H * (0.2 + r() * 0.4), H * (0.2 + r() * 0.2), FOG, 0.05);
      return { rim: SODIUM };
    },
    office: function (c, W, H, r, side) {
      var wx = side > 0 ? W * 0.08 : W * 0.56, ww = W * 0.36, wy = H * 0.12, wh = H * 0.5, y, k, dx, lx;
      c.fillStyle = lg(c, 0, 0, 0, H, [[0, '#10161c'], [1, '#0a0e12']]); c.fillRect(0, 0, W, H);
      c.fillStyle = '#16202b'; c.fillRect(wx, wy, ww, wh);
      c.save(); c.beginPath(); c.rect(wx, wy, ww, wh); c.clip();
      skyline(c, wx, wx + ww, wy + wh, wh * 0.2, wh * 0.7, '#0c1218', r, Math.max(2, H * 0.006), 0.25, 0.7);
      c.restore();
      c.fillStyle = 'rgba(8,11,14,0.85)';
      for (y = wy; y < wy + wh; y += H * 0.028) c.fillRect(wx, y, ww, H * 0.016);
      c.strokeStyle = '#06080a'; c.lineWidth = H * 0.012; c.strokeRect(wx, wy, ww, wh);
      c.save(); c.globalCompositeOperation = 'lighter';
      dx = side > 0 ? W * 0.5 : -W * 0.5;
      for (k = 0; k < 9; k++) {
        var y0 = wy + k * H * 0.055;
        c.fillStyle = rgba(SODIUM, 0.03);
        c.beginPath();
        c.moveTo(wx + ww * 0.5, y0); c.lineTo(wx + ww * 0.5 + dx, y0 + H * 0.3);
        c.lineTo(wx + ww * 0.5 + dx, y0 + H * 0.32); c.lineTo(wx + ww * 0.5, y0 + H * 0.014);
        c.closePath(); c.fill();
      }
      c.restore();
      c.fillStyle = '#07090c'; c.fillRect(0, H * 0.74, W, H * 0.26);
      c.fillStyle = 'rgba(154,167,178,0.15)'; c.fillRect(0, H * 0.74, W, 2);
      lx = side > 0 ? W * 0.18 : W * 0.82;
      c.fillStyle = '#050608'; c.fillRect(lx - H * 0.004, H * 0.6, H * 0.008, H * 0.14);
      c.beginPath(); c.moveTo(lx - H * 0.06, H * 0.62); c.lineTo(lx + H * 0.06, H * 0.62); c.lineTo(lx + H * 0.03, H * 0.56); c.lineTo(lx - H * 0.03, H * 0.56); c.closePath(); c.fill();
      cone(c, lx, H * 0.62, H * 0.11, H * 0.3, H * 0.12, SODIUM, 0.35);
      glow(c, lx, H * 0.74, H * 0.18, SODIUM, 0.25);
      c.save(); c.translate(lx + H * 0.12 * (side > 0 ? 1 : -1), H * 0.745); c.rotate(0.06);
      c.fillStyle = 'rgba(233,227,214,0.5)'; c.fillRect(0, 0, H * 0.12, H * 0.02); c.restore();
      return { rim: SODIUM };
    },
    rooftop: function (c, W, H, r, side) {
      var mx = side > 0 ? W * 0.2 : W * 0.8, i, ax = W * 0.5;
      c.fillStyle = lg(c, 0, 0, 0, H * 0.75, [[0, '#05080c'], [1, '#18212b']]); c.fillRect(0, 0, W, H);
      glow(c, mx, H * 0.16, H * 0.25, PAPER, 0.12);
      c.fillStyle = 'rgba(233,227,214,0.7)'; c.beginPath(); c.arc(mx, H * 0.16, H * 0.045, 0, PI2); c.fill();
      for (i = 0; i < 6; i++) {
        c.fillStyle = 'rgba(10,14,19,' + (0.3 + r() * 0.3).toFixed(2) + ')';
        c.beginPath(); c.ellipse(r() * W, H * (0.08 + r() * 0.3), W * (0.12 + r() * 0.2), H * (0.02 + r() * 0.03), 0, 0, PI2); c.fill();
      }
      skyline(c, 0, W, H * 0.72, H * 0.08, H * 0.3, '#0e151c', r, Math.max(2, H * 0.006), 0.22, 0.6);
      waterTower(c, side > 0 ? W * 0.12 : W * 0.86, H * 0.78, H * 0.3);
      c.fillStyle = '#07090c'; c.fillRect(0, H * 0.78, W, H * 0.22);
      c.fillStyle = 'rgba(154,167,178,0.22)'; c.fillRect(0, H * 0.78, W, 2);
      c.strokeStyle = '#07090c'; c.lineWidth = 2;
      c.beginPath();
      c.moveTo(ax, H * 0.78); c.lineTo(ax, H * 0.42);
      c.moveTo(ax - H * 0.03, H * 0.48); c.lineTo(ax + H * 0.03, H * 0.48);
      c.moveTo(ax - H * 0.02, H * 0.54); c.lineTo(ax + H * 0.02, H * 0.54);
      c.stroke();
      glow(c, ax, H * 0.42, H * 0.02, BLOOD, 0.9);
      return { rain: true, rim: FOG };
    },
    car: function (c, W, H, r, side) {
      var i, x, y, rad, dx = side > 0 ? W * 0.3 : W * 0.7;
      c.fillStyle = '#0a0f15'; c.fillRect(0, 0, W, H);
      skyline(c, 0, W, H * 0.62, H * 0.05, H * 0.25, '#121a23', r, Math.max(2, H * 0.007), 0.25, 0.5);
      bokeh(c, W, r, 28, H * 0.2, H * 0.7, H, [SODIUM, SODIUM, BLOOD, FOG]);
      for (i = 0; i < 70; i++) {
        x = r() * W; y = r() * H * 0.75; rad = 1 + r() * H * 0.008;
        c.fillStyle = 'rgba(233,227,214,0.10)'; c.beginPath(); c.arc(x, y, rad, 0, PI2); c.fill();
        c.fillStyle = 'rgba(233,227,214,0.25)'; c.fillRect(x - rad * 0.3, y - rad * 0.5, Math.max(1, rad * 0.3), Math.max(1, rad * 0.3));
      }
      c.fillStyle = '#040608';
      c.fillRect(0, 0, W, H * 0.08);
      c.beginPath(); c.moveTo(0, 0); c.lineTo(W * 0.1, 0); c.lineTo(W * 0.02, H * 0.76); c.lineTo(0, H * 0.76); c.closePath(); c.fill();
      c.beginPath(); c.moveTo(W, 0); c.lineTo(W * 0.9, 0); c.lineTo(W * 0.98, H * 0.76); c.lineTo(W, H * 0.76); c.closePath(); c.fill();
      c.fillRect(W * 0.47, H * 0.08, W * 0.06, H * 0.05);
      c.beginPath(); c.moveTo(0, H * 0.74); c.quadraticCurveTo(W * 0.5, H * 0.66, W, H * 0.74); c.lineTo(W, H); c.lineTo(0, H); c.closePath(); c.fill();
      glow(c, dx, H * 0.8, H * 0.08, SODIUM, 0.25);
      c.strokeStyle = rgba(SODIUM, 0.5); c.lineWidth = 1.5;
      c.beginPath(); c.arc(dx - H * 0.04, H * 0.8, H * 0.025, 0, PI2); c.stroke();
      c.beginPath(); c.arc(dx + H * 0.04, H * 0.8, H * 0.025, 0, PI2); c.stroke();
      c.strokeStyle = '#020304'; c.lineWidth = H * 0.025;
      c.beginPath(); c.ellipse(dx, H * 0.95, H * 0.17, H * 0.12, 0, Math.PI * 1.05, Math.PI * 1.95); c.stroke();
      return { rain: true, glass: true, rim: SODIUM };
    },
    phone: function (c, W, H, r, side) {
      var px = side > 0 ? W * 0.3 : W * 0.7, py = H * 0.5, pw = H * 0.22, ph = H * 0.42;
      c.fillStyle = '#050709'; c.fillRect(0, 0, W, H);
      glow(c, px, py, H * 0.55, FOG, 0.12);
      c.fillStyle = lg(c, 0, H * 0.8, 0, H, [[0, '#0d1116'], [1, '#030405']]); c.fillRect(0, H * 0.8, W, H * 0.2);
      c.save(); c.translate(px, py); c.rotate(-0.08 * side);
      c.fillStyle = '#020304'; c.fillRect(-pw / 2 - 4, -ph / 2 - 6, pw + 8, ph + 12);
      c.fillStyle = lg(c, 0, -ph / 2, 0, ph / 2, [[0, '#2a3440'], [1, '#141b23']]); c.fillRect(-pw / 2, -ph / 2, pw, ph);
      c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = PAPER;
      c.font = '600 ' + Math.round(ph * 0.07) + 'px "Barlow Condensed", "Arial Narrow", sans-serif';
      c.fillText('INCOMING', 0, -ph * 0.24);
      c.font = Math.round(ph * 0.1) + 'px "Special Elite", "Courier New", monospace';
      c.fillText('PRIVATE', 0, -ph * 0.08);
      c.fillStyle = rgba(SODIUM, 0.9); c.beginPath(); c.arc(-pw * 0.22, ph * 0.3, pw * 0.09, 0, PI2); c.fill();
      c.fillStyle = rgba(BLOOD, 0.95); c.beginPath(); c.arc(pw * 0.22, ph * 0.3, pw * 0.09, 0, PI2); c.fill();
      c.restore();
      return { rim: FOG };
    },
    harbor: function (c, W, H, r, side) {
      var x = 0, cw, stack, k, i, y;
      var ccols = ['#2a2f33', '#3a2a26', '#24303a', '#2f3328'];
      c.fillStyle = lg(c, 0, 0, 0, H * 0.62, [[0, '#070b10'], [1, '#1b252f']]); c.fillRect(0, 0, W, H * 0.62);
      while (x < W) {
        cw = W * (0.04 + r() * 0.05); stack = 1 + Math.floor(r() * 3);
        for (k = 0; k < stack; k++) { c.fillStyle = ccols[Math.floor(r() * ccols.length)]; c.fillRect(x, H * 0.62 - (k + 1) * H * 0.035, cw - 2, H * 0.033); }
        x += cw + r() * W * 0.03;
      }
      craneSil(c, W * 0.18, H * 0.62, H * 0.5, 1);
      craneSil(c, W * 0.62, H * 0.62, H * 0.42, -1);
      craneSil(c, W * 0.9, H * 0.62, H * 0.36, 1);
      c.fillStyle = '#0a0e13';
      c.beginPath(); c.moveTo(W * 0.32, H * 0.6); c.lineTo(W * 0.58, H * 0.6); c.lineTo(W * 0.55, H * 0.66); c.lineTo(W * 0.34, H * 0.66); c.closePath(); c.fill();
      c.fillRect(W * 0.4, H * 0.55, W * 0.06, H * 0.05);
      c.fillStyle = lg(c, 0, H * 0.62, 0, H, [[0, '#0f171f'], [1, '#04070a']]); c.fillRect(0, H * 0.62, W, H * 0.38);
      for (i = 0; i < 60; i++) {
        y = H * 0.63 + r() * H * 0.37;
        c.fillStyle = rgba(r() < 0.7 ? SODIUM : FOG, (0.04 + r() * 0.1).toFixed(3));
        c.fillRect(r() * W, y, W * (0.01 + r() * 0.06), 1 + r() * 2);
      }
      c.fillStyle = lg(c, 0, H * 0.45, 0, H * 0.7, [[0, 'rgba(154,167,178,0)'], [0.6, 'rgba(154,167,178,0.12)'], [1, 'rgba(154,167,178,0)']]);
      c.fillRect(0, H * 0.45, W, H * 0.25);
      c.fillStyle = '#05070a'; c.fillRect(0, H * 0.86, W, H * 0.14);
      c.fillRect(side > 0 ? W * 0.12 : W * 0.84, H * 0.82, H * 0.04, H * 0.05);
      lamp(c, side > 0 ? W * 0.4 : W * 0.56, H * 0.87, H * 0.4);
      return { rain: true, rim: FOG };
    },
    warehouse: function (c, W, H, r, side) {
      var i, wx, wy = H * 0.08, ww = W * 0.12, wh = H * 0.2, x, bx, cx0;
      c.fillStyle = lg(c, 0, 0, 0, H, [[0, '#0c1015'], [1, '#07090b']]); c.fillRect(0, 0, W, H);
      for (i = 0; i < 5; i++) {
        wx = W * (0.06 + i * 0.19);
        c.fillStyle = '#1e2a35'; c.fillRect(wx, wy, ww, wh);
        c.strokeStyle = '#07090b'; c.lineWidth = 2;
        c.beginPath();
        c.moveTo(wx + ww / 3, wy); c.lineTo(wx + ww / 3, wy + wh);
        c.moveTo(wx + ww * 2 / 3, wy); c.lineTo(wx + ww * 2 / 3, wy + wh);
        c.moveTo(wx, wy + wh / 2); c.lineTo(wx + ww, wy + wh / 2);
        c.stroke();
        c.save(); c.globalCompositeOperation = 'lighter';
        c.fillStyle = lg(c, 0, wy + wh, 0, H * 0.95, [[0, 'rgba(154,167,178,0.09)'], [1, 'rgba(154,167,178,0)']]);
        c.beginPath();
        c.moveTo(wx, wy + wh); c.lineTo(wx + ww, wy + wh);
        c.lineTo(wx + ww - side * W * 0.12, H * 0.95); c.lineTo(wx - side * W * 0.12, H * 0.95);
        c.closePath(); c.fill();
        c.restore();
      }
      c.strokeStyle = '#05070a'; c.lineWidth = Math.max(2, H * 0.01);
      c.beginPath();
      c.moveTo(0, H * 0.04); c.lineTo(W, H * 0.04);
      c.moveTo(0, H * 0.32); c.lineTo(W, H * 0.32);
      for (x = 0; x < W; x += H * 0.14) { c.moveTo(x, H * 0.32); c.lineTo(x + H * 0.07, H * 0.04); c.lineTo(x + H * 0.14, H * 0.32); }
      c.stroke();
      c.fillStyle = '#090b0e'; c.fillRect(0, H * 0.82, W, H * 0.18);
      cx0 = side > 0 ? W * 0.04 : W * 0.96 - H * 0.41;
      crate(c, cx0, H * 0.82, H * 0.2);
      crate(c, cx0 + H * 0.21, H * 0.82, H * 0.2);
      crate(c, cx0 + H * 0.1, H * 0.62, H * 0.2);
      bx = side > 0 ? W * 0.45 : W * 0.55;
      c.fillStyle = '#05070a'; c.fillRect(bx - 1, H * 0.32, 2, H * 0.14);
      glow(c, bx, H * 0.47, H * 0.2, SODIUM, 0.35);
      c.fillStyle = 'rgba(255,214,150,0.95)'; c.beginPath(); c.arc(bx, H * 0.47, H * 0.01, 0, PI2); c.fill();
      for (i = 0; i < 40; i++) { c.fillStyle = 'rgba(233,227,214,' + (0.05 + r() * 0.12).toFixed(2) + ')'; c.fillRect(r() * W, H * 0.3 + r() * H * 0.5, 1.5, 1.5); }
      return { rim: SODIUM };
    },
    apartment: function (c, W, H, r, side) {
      var x, i, wx = side > 0 ? W * 0.08 : W * 0.58, ww = W * 0.34, wy = H * 0.12, wh = H * 0.52, lx;
      c.fillStyle = lg(c, 0, 0, 0, H, [[0, '#151b21'], [1, '#0b0f13']]); c.fillRect(0, 0, W, H);
      c.fillStyle = 'rgba(0,0,0,0.12)';
      for (x = 0; x < W; x += H * 0.06) c.fillRect(x, 0, H * 0.03, H * 0.8);
      c.fillStyle = '#18222d'; c.fillRect(wx, wy, ww, wh);
      c.save(); c.beginPath(); c.rect(wx, wy, ww, wh); c.clip();
      skyline(c, wx, wx + ww, wy + wh, wh * 0.2, wh * 0.8, '#0d141b', r, Math.max(2, H * 0.006), 0.3, 0.7);
      bokeh(c, wx + ww, r, 10, wy + wh * 0.4, wy + wh, H, [SODIUM, FOG]);
      c.strokeStyle = 'rgba(233,227,214,0.10)'; c.lineWidth = 1;
      c.beginPath();
      for (i = 0; i < 30; i++) { x = wx + r() * ww; var y = wy + r() * wh; c.moveTo(x, y); c.lineTo(x + 1, y + H * (0.02 + r() * 0.05)); }
      c.stroke();
      c.restore();
      c.fillStyle = '#06080b';
      c.fillRect(wx + ww / 2 - 3, wy, 6, wh); c.fillRect(wx, wy + wh * 0.45, ww, 5);
      c.strokeStyle = '#06080b'; c.lineWidth = H * 0.014; c.strokeRect(wx, wy, ww, wh);
      c.fillStyle = lg(c, wx - W * 0.05, 0, wx + W * 0.04, 0, [[0, '#0a0d10'], [1, '#1a1512']]); c.fillRect(wx - W * 0.05, H * 0.08, W * 0.06, H * 0.64);
      c.fillStyle = lg(c, wx + ww - W * 0.01, 0, wx + ww + W * 0.05, 0, [[0, '#1a1512'], [1, '#0a0d10']]); c.fillRect(wx + ww - W * 0.01, H * 0.08, W * 0.06, H * 0.64);
      c.fillStyle = '#07090c'; c.fillRect(0, H * 0.8, W, H * 0.2);
      c.fillStyle = '#0a0c0f';
      c.fillRect(wx, H * 0.68, ww * 0.9, H * 0.14);
      c.fillRect(wx - W * 0.01, H * 0.62, W * 0.03, H * 0.2);
      c.fillRect(wx + ww * 0.88, H * 0.62, W * 0.03, H * 0.2);
      lx = side > 0 ? wx + ww + W * 0.1 : wx - W * 0.1;
      c.fillStyle = '#050608'; c.fillRect(lx - 1.5, H * 0.42, 3, H * 0.4);
      c.fillStyle = '#2a1f14';
      c.beginPath(); c.moveTo(lx - H * 0.05, H * 0.44); c.lineTo(lx + H * 0.05, H * 0.44); c.lineTo(lx + H * 0.035, H * 0.36); c.lineTo(lx - H * 0.035, H * 0.36); c.closePath(); c.fill();
      glow(c, lx, H * 0.4, H * 0.25, SODIUM, 0.3);
      return { rim: SODIUM };
    },
    church: function (c, W, H, r) {
      var ax = W * 0.5, aw = H * 0.26, atop = H * 0.08, abot = H * 0.56, x, y, p, k, cx, cy;
      var gcols = ['#7a2a2a', '#a8742a', '#2b3d52', '#3d4a3a', '#5a5f6a'];
      c.fillStyle = lg(c, 0, 0, 0, H, [[0, '#07090c'], [1, '#0c1014']]); c.fillRect(0, 0, W, H);
      each([0.12, 0.3, 0.7, 0.88], function (f) {
        c.fillStyle = '#0a0d11'; c.fillRect(W * f - W * 0.025, 0, W * 0.05, H);
        c.fillStyle = 'rgba(154,167,178,0.06)'; c.fillRect(W * f - W * 0.025, 0, W * 0.008, H);
      });
      c.save();
      c.beginPath();
      c.moveTo(ax - aw / 2, abot); c.lineTo(ax - aw / 2, atop + aw / 2);
      c.arc(ax, atop + aw / 2, aw / 2, Math.PI, 0);
      c.lineTo(ax + aw / 2, abot); c.closePath(); c.clip();
      for (y = atop; y < abot; y += aw * 0.18) {
        for (x = ax - aw / 2; x < ax + aw / 2; x += aw * 0.2) {
          c.globalAlpha = 0.45 + r() * 0.4;
          c.fillStyle = gcols[Math.floor(r() * gcols.length)];
          c.fillRect(x, y, aw * 0.2, aw * 0.18);
        }
      }
      c.globalAlpha = 1;
      c.strokeStyle = '#050608'; c.lineWidth = 2;
      c.beginPath();
      for (y = atop; y < abot; y += aw * 0.18) { c.moveTo(ax - aw / 2, y); c.lineTo(ax + aw / 2, y); }
      for (x = ax - aw / 2; x < ax + aw / 2; x += aw * 0.2) { c.moveTo(x, atop); c.lineTo(x, abot); }
      c.stroke();
      c.fillStyle = '#050608';
      c.fillRect(ax - aw * 0.03, atop + aw * 0.2, aw * 0.06, (abot - atop) * 0.7);
      c.fillRect(ax - aw * 0.2, atop + aw * 0.45, aw * 0.4, aw * 0.06);
      c.restore();
      c.save(); c.globalCompositeOperation = 'lighter';
      c.fillStyle = lg(c, 0, abot, 0, H, [[0, 'rgba(232,163,61,0.10)'], [1, 'rgba(232,163,61,0)']]);
      c.beginPath(); c.moveTo(ax - aw / 2, abot); c.lineTo(ax + aw / 2, abot); c.lineTo(ax + aw * 1.4, H); c.lineTo(ax - aw * 1.4, H); c.closePath(); c.fill();
      c.restore();
      for (p = 0; p < 4; p++) {
        var py = H * (0.7 + p * 0.08), pw = W * (0.32 + p * 0.06);
        c.fillStyle = '#050608'; c.fillRect(W * 0.02, py, pw, H * 0.05); c.fillRect(W * 0.98 - pw, py, pw, H * 0.05);
        c.fillStyle = 'rgba(232,163,61,0.12)'; c.fillRect(W * 0.02, py, pw, 1.5); c.fillRect(W * 0.98 - pw, py, pw, 1.5);
      }
      for (k = 0; k < 7; k++) {
        cx = W * (0.36 + k * 0.047); cy = H * 0.64;
        c.fillStyle = '#d9d0bc'; c.fillRect(cx - 2, cy, 4, H * 0.04);
        glow(c, cx, cy - 4, H * 0.04, SODIUM, 0.55);
        c.fillStyle = '#ffd38a'; c.beginPath(); c.ellipse(cx, cy - 4, 2, 4, 0, 0, PI2); c.fill();
      }
      return { rim: SODIUM };
    },
    penthouse: function (c, W, H, r, side) {
      var i, x, y, s, dx;
      c.fillStyle = '#080b10'; c.fillRect(0, 0, W, H);
      c.fillStyle = lg(c, 0, 0, 0, H * 0.75, [[0, '#06090e'], [1, '#141c26']]); c.fillRect(0, H * 0.05, W, H * 0.7);
      skyline(c, 0, W, H * 0.46, H * 0.04, H * 0.2, '#0d141b', r, 2, 0.3, 0.6);
      for (i = 0; i < 380; i++) {
        y = H * 0.46 + Math.pow(r(), 0.7) * H * 0.28;
        c.fillStyle = rgba(r() < 0.8 ? SODIUM : (r() < 0.5 ? FOG : BLOOD), (0.15 + r() * 0.6).toFixed(2));
        s = 1 + r() * 1.5;
        c.fillRect(r() * W, y, s, s);
      }
      c.fillStyle = '#030405';
      for (x = 0; x <= W; x += W * 0.2) c.fillRect(x - 3, H * 0.05, 6, H * 0.7);
      c.fillRect(0, 0, W, H * 0.05);
      c.fillStyle = lg(c, 0, H * 0.75, 0, H, [[0, '#151a20'], [1, '#07090b']]); c.fillRect(0, H * 0.75, W, H * 0.25);
      c.fillStyle = 'rgba(232,163,61,0.05)';
      for (x = 0; x < W; x += W * 0.2) c.fillRect(x + W * 0.02, H * 0.76, W * 0.16, H * 0.2);
      dx = side > 0 ? W * 0.1 : W * 0.64;
      c.fillStyle = '#040506';
      c.fillRect(dx, H * 0.7, W * 0.26, H * 0.03);
      c.fillRect(dx + W * 0.01, H * 0.73, W * 0.015, H * 0.2);
      c.fillRect(dx + W * 0.235, H * 0.73, W * 0.015, H * 0.2);
      c.fillStyle = 'rgba(233,227,214,0.18)'; c.fillRect(dx + W * 0.18, H * 0.655, H * 0.03, H * 0.045);
      c.fillStyle = rgba(SODIUM, 0.5); c.fillRect(dx + W * 0.18, H * 0.68, H * 0.03, H * 0.02);
      c.fillStyle = '#030405'; c.fillRect(dx + W * 0.06, 0, 2, H * 0.2);
      glow(c, dx + W * 0.06, H * 0.22, H * 0.15, SODIUM, 0.35);
      c.fillStyle = '#2a2014'; c.fillRect(dx + W * 0.06 - H * 0.04, H * 0.2, H * 0.08, H * 0.02);
      return { rim: SODIUM };
    },
    black: function (c, W, H) {
      c.fillStyle = '#030405'; c.fillRect(0, 0, W, H);
      glow(c, W / 2, H / 2, Math.max(W, H) * 0.6, FOG, 0.04);
      return { rim: FOG };
    }
  };

  /* ---------- silhouettes per Panel.figure ---------- */
  var FIG = {
    crane:     { sh: 0.17, hem: 0.25, head: 1.0,  neck: 1.0 },
    mara:      { sh: 0.13, hem: 0.17, head: 0.94, neck: 0.85 },
    halvard:   { sh: 0.23, hem: 0.31, head: 1.12, neck: 1.6 },
    thug:      { sh: 0.2,  hem: 0.22, head: 1.0,  neck: 1.35 },
    detective: { sh: 0.18, hem: 0.27, head: 1.0,  neck: 1.0 }
  };
  function figGeom(P, cx, top, s) {
    var hr = s * 0.062 * P.head, hy = top + s * 0.085;
    return { hr: hr, hy: hy, nw: s * 0.03 * P.neck, sy: hy + hr * 1.1 + s * 0.03, sh: s * P.sh, hem: s * P.hem, base: top + s * 1.3 };
  }
  function collar(c, cx, g, s) {
    c.beginPath(); c.moveTo(cx - g.nw * 2.6, g.sy + s * 0.03); c.lineTo(cx - g.nw * 1.3, g.hy + g.hr * 0.45); c.lineTo(cx - g.nw * 0.2, g.sy + s * 0.03); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(cx + g.nw * 2.6, g.sy + s * 0.03); c.lineTo(cx + g.nw * 1.3, g.hy + g.hr * 0.45); c.lineTo(cx + g.nw * 0.2, g.sy + s * 0.03); c.closePath(); c.fill();
  }
  function figureParts(c, kind, P, cx, top, s, dir) {
    var g = figGeom(P, cx, top, s), hr = g.hr, hy = g.hy, sy = g.sy, sh = g.sh;
    c.strokeStyle = c.fillStyle;
    c.beginPath(); c.rect(cx - g.nw, hy, g.nw * 2, sy - hy + s * 0.02); c.fill();
    c.beginPath();
    c.moveTo(cx - g.nw * 1.4, sy - s * 0.012);
    c.quadraticCurveTo(cx - sh * 0.8, sy - s * 0.008, cx - sh, sy + s * 0.04);
    c.quadraticCurveTo(cx - sh * 1.08, sy + s * 0.25, cx - g.hem, g.base);
    c.lineTo(cx + g.hem, g.base);
    c.quadraticCurveTo(cx + sh * 1.08, sy + s * 0.25, cx + sh, sy + s * 0.04);
    c.quadraticCurveTo(cx + sh * 0.8, sy - s * 0.008, cx + g.nw * 1.4, sy - s * 0.012);
    c.closePath(); c.fill();
    c.beginPath(); c.ellipse(cx + dir * hr * 0.08, hy, hr, hr * 1.2, 0, 0, PI2); c.fill();
    c.beginPath(); c.moveTo(cx + dir * hr * 0.9, hy - hr * 0.1); c.lineTo(cx + dir * hr * 1.18, hy + hr * 0.25); c.lineTo(cx + dir * hr * 0.85, hy + hr * 0.45); c.closePath(); c.fill();
    if (kind === 'crane') {
      collar(c, cx, g, s);
      c.beginPath(); c.ellipse(cx - dir * hr * 0.05, hy - hr * 0.35, hr * 1.04, hr * 0.85, 0, Math.PI, PI2); c.fill();
      c.save(); c.translate(cx - dir * sh * 0.85, sy - s * 0.06); c.rotate(dir * 0.16);
      c.fillRect(-s * 0.032, 0, s * 0.064, s * 1.0);
      c.fillRect(-s * 0.045, s * 0.38, s * 0.09, s * 0.05);
      c.restore();
    } else if (kind === 'mara') {
      c.beginPath();
      c.moveTo(cx - hr * 1.25, hy + hr * 0.85);
      c.lineTo(cx - hr * 1.3, hy - hr * 0.2);
      c.quadraticCurveTo(cx - hr * 1.25, hy - hr * 1.45, cx, hy - hr * 1.42);
      c.quadraticCurveTo(cx + hr * 1.25, hy - hr * 1.45, cx + hr * 1.3, hy - hr * 0.2);
      c.lineTo(cx + hr * 1.25, hy + hr * 0.85);
      c.closePath(); c.fill();
      c.lineWidth = s * 0.05; c.lineJoin = 'round'; c.lineCap = 'round';
      c.beginPath(); c.moveTo(cx + dir * sh * 0.7, sy + s * 0.05); c.lineTo(cx + dir * sh * 1.15, sy + s * 0.2); c.lineTo(cx + dir * hr * 1.05, hy + hr * 0.7); c.stroke();
      c.fillRect(cx + dir * hr * 0.95 - s * 0.012, hy - hr * 0.4, s * 0.024, s * 0.075);
    } else if (kind === 'halvard') {
      c.beginPath(); c.ellipse(cx - dir * hr * 0.1, hy - hr * 0.4, hr * 1.02, hr * 0.8, 0, Math.PI, PI2); c.fill();
      c.beginPath(); c.ellipse(cx + dir * hr * 0.2, hy + hr * 0.85, hr * 0.85, hr * 0.45, 0, 0, PI2); c.fill();
      c.lineWidth = s * 0.016; c.lineCap = 'butt';
      c.beginPath(); c.moveTo(cx + dir * hr * 0.95, hy + hr * 0.5); c.lineTo(cx + dir * (hr * 0.95 + s * 0.07), hy + hr * 0.5 - s * 0.012); c.stroke();
    } else if (kind === 'thug') {
      c.beginPath(); c.ellipse(cx, hy - hr * 0.35, hr * 1.08, hr * 0.9, 0, Math.PI, PI2); c.fill();
      c.beginPath(); c.moveTo(cx - dir * hr * 0.2, hy - hr * 0.42); c.lineTo(cx + dir * hr * 1.7, hy - hr * 0.3); c.lineTo(cx + dir * hr * 1.6, hy - hr * 0.18); c.lineTo(cx - dir * hr * 0.2, hy - hr * 0.22); c.closePath(); c.fill();
    } else if (kind === 'detective') {
      collar(c, cx, g, s);
      c.beginPath(); c.ellipse(cx, hy - hr * 0.5, hr * 2.0, hr * 0.3, 0, 0, PI2); c.fill();
      c.beginPath(); c.moveTo(cx - hr * 1.05, hy - hr * 0.5); c.lineTo(cx - hr * 0.95, hy - hr * 1.45); c.quadraticCurveTo(cx, hy - hr * 1.2, cx + hr * 0.95, hy - hr * 1.45); c.lineTo(cx + hr * 1.05, hy - hr * 0.5); c.closePath(); c.fill();
    }
  }
  function figureDetails(c, kind, P, cx, top, s, dir, rimHex) {
    var g = figGeom(P, cx, top, s), hr = g.hr, hy = g.hy, sy = g.sy, sh = g.sh;
    if (kind === 'detective' || kind === 'crane') {
      c.strokeStyle = rgba(rimHex, 0.18); c.lineWidth = Math.max(1, s * 0.004);
      c.beginPath();
      c.moveTo(cx - g.nw * 1.2, sy); c.lineTo(cx - sh * 0.2, sy + s * 0.35);
      c.moveTo(cx + g.nw * 1.2, sy); c.lineTo(cx + sh * 0.2, sy + s * 0.35);
      c.stroke();
    }
    if (kind === 'detective') {
      c.strokeStyle = rgba(rimHex, 0.15); c.lineWidth = s * 0.012;
      c.beginPath(); c.moveTo(cx - sh * 1.02, sy + s * 0.42); c.lineTo(cx + sh * 1.02, sy + s * 0.42); c.stroke();
    }
    if (kind === 'halvard') {
      var ex = cx + dir * (hr * 0.95 + s * 0.07), ey = hy + hr * 0.5 - s * 0.012;
      glow(c, ex, ey, s * 0.05, SODIUM, 0.7);
      c.fillStyle = '#ffb35a'; c.beginPath(); c.arc(ex, ey, s * 0.008, 0, PI2); c.fill();
      c.strokeStyle = 'rgba(154,167,178,0.22)'; c.lineWidth = Math.max(1, s * 0.005);
      c.beginPath(); c.moveTo(ex, ey); c.bezierCurveTo(ex + dir * s * 0.04, ey - s * 0.08, ex - dir * s * 0.03, ey - s * 0.14, ex + dir * s * 0.02, ey - s * 0.24); c.stroke();
    }
    if (kind === 'mara') {
      var px = cx + dir * hr * 0.95, py = hy - hr * 0.4 + s * 0.0375;
      glow(c, px, py, s * 0.09, FOG, 0.35);
      c.fillStyle = 'rgba(200,220,235,0.8)';
      c.fillRect(px + dir * s * 0.008 - s * 0.003, hy - hr * 0.35, s * 0.006, s * 0.065);
    }
  }
  function drawFigure(c, kind, W, H, side, rimHex) {
    var P = FIG[kind];
    if (!P) return;
    var s = H * 0.9, top = H * 0.13, cx = side > 0 ? W * 0.72 : W * 0.28, dir = -side, k = Math.max(2, H * 0.006);
    glow(c, cx, top + s * 0.3, s * 0.5, rimHex, 0.10);
    c.save();
    c.translate(dir * k, -k * 0.3);
    c.fillStyle = rgba(rimHex, 0.75);
    figureParts(c, kind, P, cx, top, s, dir);
    c.restore();
    c.save();
    c.fillStyle = '#05070a';
    figureParts(c, kind, P, cx, top, s, dir);
    c.restore();
    figureDetails(c, kind, P, cx, top, s, dir, rimHex);
  }

  /* =====================================================================
   * Title backdrop
   * ===================================================================== */
  var Title = { cv: null, c: null, W: 0, H: 0, dpr: 1, sky: null, city: null, over: null, drops: [], raf: 0, on: false, last: 0, t: 0 };

  function titleStart() {
    if (!E.titleCanvas || !E.titleCanvas.getContext) return;
    Title.cv = E.titleCanvas;
    if (!Title.c) Title.c = Title.cv.getContext('2d');
    if (!Title.c) return;
    titleResize(true);
    if (Title.on) { if (reduceMotion) titleDraw(0); return; }
    Title.on = true; Title.last = now();
    if (reduceMotion) { titleDraw(0); return; }
    Title.raf = requestAnimationFrame(titleLoop);
  }
  function titleStop() {
    Title.on = false;
    if (Title.raf) cancelAnimationFrame(Title.raf);
    Title.raf = 0;
  }
  function titleLoop() {
    if (!Title.on) return;
    Title.raf = requestAnimationFrame(titleLoop);
    var t = now(), dt = Math.min(0.05, (t - Title.last) / 1000);
    Title.last = t;
    if (document.hidden) return;
    Title.t += dt;
    titleDraw(dt);
  }
  function titleResize(quiet) {
    var cv = Title.cv;
    if (!cv) return;
    var rect = cv.getBoundingClientRect();
    var W = Math.max(1, Math.round(rect.width)), H = Math.max(1, Math.round(rect.height));
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    if (W === Title.W && H === Title.H && dpr === Title.dpr && Title.sky) return;
    Title.W = W; Title.H = H; Title.dpr = dpr;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    Title.sky = makeLayer(W, H, dpr, function (c) {
      var i, r = rng(7);
      c.fillStyle = lg(c, 0, 0, 0, H, [[0, '#05080c'], [0.55, '#111a24'], [0.82, '#1f2228'], [1, '#0b0f14']]);
      c.fillRect(0, 0, W, H);
      var hz = c.createRadialGradient(W * 0.62, H * 0.85, 0, W * 0.62, H * 0.85, W * 0.6);
      hz.addColorStop(0, 'rgba(232,163,61,0.16)'); hz.addColorStop(1, 'rgba(232,163,61,0)');
      c.fillStyle = hz; c.fillRect(0, 0, W, H);
      glow(c, W * 0.84, H * 0.18, H * 0.22, PAPER, 0.10);
      c.fillStyle = 'rgba(233,227,214,0.55)'; c.beginPath(); c.arc(W * 0.84, H * 0.18, H * 0.035, 0, PI2); c.fill();
      for (i = 0; i < 7; i++) {
        c.fillStyle = 'rgba(10,14,19,' + (0.25 + r() * 0.3).toFixed(2) + ')';
        c.beginPath(); c.ellipse(r() * W, H * (0.08 + r() * 0.35), W * (0.15 + r() * 0.25), H * (0.02 + r() * 0.03), 0, 0, PI2); c.fill();
      }
    });
    Title.city = makeLayer(W, H, dpr, function (c) {
      var r = rng(1337);
      skyline(c, 0, W, H * 0.86, H * 0.12, H * 0.36, '#0f161e', r, Math.max(2, H * 0.006), 0.18, 0.5);
      skyline(c, 0, W, H * 0.95, H * 0.16, H * 0.5, '#080b10', r, Math.max(3, H * 0.01), 0.12, 0.8);
      c.fillStyle = '#05070a'; c.fillRect(0, H * 0.95, W, H * 0.05 + 2);
    });
    Title.over = makeLayer(W, H, dpr, function (c) {
      c.fillStyle = lg(c, 0, 0, W * 0.6, 0, [[0, 'rgba(6,9,13,0.82)'], [0.6, 'rgba(6,9,13,0.35)'], [1, 'rgba(6,9,13,0)']]);
      c.fillRect(0, 0, W, H);
      vignette(c, W, H, 0.6);
    });
    Title.drops = makeDrops(W, H, Math.min(220, Math.round(W * H / 5000)));
    if (reduceMotion && !quiet) titleDraw(0);
  }
  function beam(c, x, y, ang, len, spread, alpha) {
    var ex = x + Math.cos(ang) * len, ey = y + Math.sin(ang) * len;
    c.fillStyle = lg(c, x, y, ex, ey, [[0, 'rgba(233,227,214,' + alpha + ')'], [1, 'rgba(233,227,214,0)']]);
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + Math.cos(ang - spread) * len, y + Math.sin(ang - spread) * len);
    c.lineTo(x + Math.cos(ang + spread) * len, y + Math.sin(ang + spread) * len);
    c.closePath(); c.fill();
  }
  function titleDraw(dt) {
    var c = Title.c, W = Title.W, H = Title.H, t = Title.t, k;
    if (!c || !Title.sky) return;
    c.setTransform(Title.dpr, 0, 0, Title.dpr, 0, 0);
    c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
    c.drawImage(Title.sky, 0, 0, W, H);
    c.globalCompositeOperation = 'lighter';
    beam(c, W * 0.74, H * 0.95, -Math.PI / 2 + Math.sin(t * 0.13) * 0.55, H * 1.3, 0.05, 0.11);
    beam(c, W * 0.3, H * 0.98, -Math.PI / 2 + Math.sin(t * 0.09 + 2.1) * 0.45, H * 1.2, 0.04, 0.07);
    c.globalCompositeOperation = 'source-over';
    c.drawImage(Title.city, 0, 0, W, H);
    drawRain(c, Title.drops, W, H, dt, 0.26, 0.18);
    // drifting scope reticle
    var sx = W * (0.68 + 0.1 * Math.sin(t * 0.07)), sy = H * (0.52 + 0.12 * Math.sin(t * 0.11 + 1.3)), sr = Math.min(W, H) * 0.17;
    c.strokeStyle = 'rgba(232,163,61,0.28)'; c.lineWidth = 1.2;
    c.beginPath(); c.arc(sx, sy, sr, 0, PI2); c.stroke();
    c.beginPath();
    c.moveTo(sx - sr, sy); c.lineTo(sx - sr * 0.12, sy); c.moveTo(sx + sr * 0.12, sy); c.lineTo(sx + sr, sy);
    c.moveTo(sx, sy - sr); c.lineTo(sx, sy - sr * 0.12); c.moveTo(sx, sy + sr * 0.12); c.lineTo(sx, sy + sr);
    for (k = 1; k <= 4; k++) {
      c.moveTo(sx + k * sr * 0.2, sy - 3); c.lineTo(sx + k * sr * 0.2, sy + 3);
      c.moveTo(sx - k * sr * 0.2, sy - 3); c.lineTo(sx - k * sr * 0.2, sy + 3);
      c.moveTo(sx - 3, sy + k * sr * 0.2); c.lineTo(sx + 3, sy + k * sr * 0.2);
    }
    c.stroke();
    c.fillStyle = 'rgba(232,163,61,0.5)'; c.fillRect(sx - 1, sy - 1, 2, 2);
    c.font = '600 12px "Barlow Condensed", "Arial Narrow", sans-serif';
    c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    c.fillText('RNG ' + Math.round(340 + 90 * Math.sin(t * 0.05)) + ' m', sx + sr + 8, sy - sr * 0.6);
    c.drawImage(Title.over, 0, 0, W, H);
  }

  /* =====================================================================
   * Story player
   * ===================================================================== */
  var Story = {
    active: false, panels: [], i: 0, done: null, text: '', count: 0, t0: 0, typing: false, raf: 0,
    scene: null, flags: null, side: 1, drops: [], lastType: 0, W: 0, H: 0, dpr: 1, c: null, last: 0,
    drawn: false, grain: null, seen: {}
  };

  function makeGrain() {
    try {
      var g = document.createElement('canvas'); g.width = 128; g.height = 128;
      var c = g.getContext('2d'), img = c.createImageData(128, 128), i, v;
      for (i = 0; i < img.data.length; i += 4) {
        v = Math.random() * 255;
        img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255;
      }
      c.putImageData(img, 0, 0);
      return g;
    } catch (e) { return null; }
  }
  function storySize() {
    var cv = E.storyCanvas, rect = cv.getBoundingClientRect();
    var W = Math.max(1, Math.round(rect.width)), H = Math.max(1, Math.round(rect.height)), dpr = Math.min(2, window.devicePixelRatio || 1);
    if (W === Story.W && H === Story.H && dpr === Story.dpr) return false;
    Story.W = W; Story.H = H; Story.dpr = dpr;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    Story.drops = makeDrops(W, H, Math.min(160, Math.round(W * H / 6000)));
    return true;
  }
  function storyBuild() {
    var p = Story.panels[Story.i] || {};
    var bg = SCENES[p.bg] ? p.bg : 'black';
    var flags = { rain: false, glass: false, rim: SODIUM };
    var W = Story.W, H = Story.H, side = Story.side;
    try {
      Story.scene = makeLayer(W, H, Story.dpr, function (c) {
        var r = rng(hashStr(bg + ':' + Story.i + ':' + String(p.text || '').length));
        var f = SCENES[bg](c, W, H, r, side) || {};
        flags.rain = !!f.rain; flags.glass = !!f.glass; if (f.rim) flags.rim = f.rim;
        if (p.figure && p.figure !== 'none') drawFigure(c, p.figure, W, H, side, flags.rim);
        vignette(c, W, H, 0.65);
      });
    } catch (e) {
      Story.scene = makeLayer(W, H, Story.dpr, function (c) { c.fillStyle = '#030405'; c.fillRect(0, 0, W, H); });
    }
    Story.flags = flags;
    Story.drawn = false;
  }
  function playStory(panels, done) {
    var list = [];
    each(arr(panels), function (p) { if (p && typeof p === 'object') list.push(p); });
    if (!list.length || !E.storyCanvas) { if (done) done(); return; }
    Story.panels = list; Story.done = done || null; Story.active = true;
    if (!Story.c) Story.c = E.storyCanvas.getContext('2d');
    if (!Story.grain) Story.grain = makeGrain();
    showScreen('story', SCREENS.story);
    Story.W = 0;
    storyShow(0);
    Story.last = now();
    if (Story.raf) cancelAnimationFrame(Story.raf);
    Story.raf = requestAnimationFrame(storyLoop);
  }
  function storyShow(i) {
    var p = Story.panels[i] || {};
    Story.i = i;
    var hasFig = p.figure && p.figure !== 'none' && FIG[p.figure];
    Story.side = hasFig ? (i % 2 === 0 ? 1 : -1) : 1;
    Story.text = String(p.text || '');
    var speaker = p.speaker ? String(p.speaker) : '';
    E.storySpeaker.textContent = speaker;
    E.storySpeaker.hidden = !speaker;
    E.storyCaption.className = 'caption ' + (speaker ? 'speech' : 'narr') + (Story.side < 0 ? ' right' : '');
    E.storyCount.textContent = (i + 1) + ' / ' + Story.panels.length;
    storySize();
    storyBuild();
    Story.t0 = now(); Story.count = 0; Story.lastType = 0;
    if (reduceMotion || !Story.text) {
      Story.typing = false;
      E.storyText.textContent = Story.text;
      E.storyText.removeAttribute('aria-busy');
      E.storyNext.hidden = false;
    } else {
      Story.typing = true;
      E.storyText.textContent = '';
      E.storyText.setAttribute('aria-busy', 'true');
      E.storyNext.hidden = true;
    }
    E.storyCanvas.classList.remove('enter');
    void E.storyCanvas.offsetWidth;
    E.storyCanvas.classList.add('enter');
  }
  function storyFinishTyping() {
    Story.typing = false;
    Story.count = Story.text.length;
    E.storyText.textContent = Story.text;
    E.storyText.removeAttribute('aria-busy');
    E.storyNext.hidden = false;
  }
  function storyAdvance() {
    if (!Story.active) return;
    Audio.unlock();
    if (Story.typing) { storyFinishTyping(); return; }
    if (Story.i + 1 < Story.panels.length) { Audio.play('click'); storyShow(Story.i + 1); }
    else storyEnd();
  }
  function storyEnd() {
    if (!Story.active) return;
    Story.active = false;
    if (Story.raf) cancelAnimationFrame(Story.raf);
    Story.raf = 0;
    Story.scene = null;
    var d = Story.done; Story.done = null;
    if (d) d(); else showTitle();
  }
  function storyLoop() {
    if (!Story.active) return;
    Story.raf = requestAnimationFrame(storyLoop);
    var t = now(), dt = Math.min(0.05, (t - Story.last) / 1000);
    Story.last = t;
    if (Story.typing) {
      var n = Math.min(Story.text.length, Math.floor((t - Story.t0) / 1000 * 42));
      if (n !== Story.count) {
        if (n > Story.count && t - Story.lastType > 55 && /\S/.test(Story.text.charAt(n - 1))) {
          Audio.play('type'); Story.lastType = t;
        }
        Story.count = n;
        E.storyText.textContent = Story.text.slice(0, n);
      }
      if (n >= Story.text.length) storyFinishTyping();
    }
    if (reduceMotion && Story.drawn) return;
    if (document.hidden) return;
    storyDraw(t, dt);
  }
  function storyDraw(t, dt) {
    var c = Story.c, W = Story.W, H = Story.H;
    if (!c || !Story.scene) return;
    c.setTransform(Story.dpr, 0, 0, Story.dpr, 0, 0);
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    var el = (t - Story.t0) / 1000;
    var z = reduceMotion ? 1 : 1 + Math.min(el, 14) * 0.0025;
    var drift = reduceMotion ? 0 : Math.min(el, 14) * 0.6 * Story.side;
    c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
    c.save();
    c.translate(W / 2, H / 2); c.scale(z, z); c.translate(-W / 2 - drift, -H / 2);
    c.drawImage(Story.scene, 0, 0, W, H);
    c.restore();
    if (Story.flags && Story.flags.rain) {
      if (Story.flags.glass) drawRain(c, Story.drops, W, H, reduceMotion ? 0 : dt * 0.35, 0.16, 0.04);
      else drawRain(c, Story.drops, W, H, reduceMotion ? 0 : dt, 0.3, 0.16);
    }
    if (Story.grain) {
      try {
        var pat = c.createPattern(Story.grain, 'repeat');
        c.save();
        c.globalAlpha = 0.06;
        var ox = reduceMotion ? 0 : Math.floor(Math.random() * 128), oy = reduceMotion ? 0 : Math.floor(Math.random() * 128);
        c.translate(-ox, -oy);
        c.fillStyle = pat;
        c.fillRect(0, 0, W + 128, H + 128);
        c.restore();
      } catch (e) { /* ignore */ }
    }
    Story.drawn = true;
  }
  function runStories(list, done) {
    var rest = [];
    each(list, function (p) { if (arr(p).length) rest.push(p); });
    if (!rest.length) { done(); return; }
    playStory(rest[0], function () { runStories(rest.slice(1), done); });
  }

  /* =====================================================================
   * Title + main menu
   * ===================================================================== */
  function hasStarted() { return !!save.seenIntro || completedCount() > 0; }
  function renderTitle() {
    var started = hasStarted(), nxt = nextOpenMission();
    E.continueLabel.textContent = started ? 'Continue' : 'New Campaign';
    E.continueNote.textContent = started && nxt ? (nxt.title || '') : '';
    E.missionsNote.textContent = completedCount() + ' / ' + CAMPAIGN.length;
    E.titleMoney.textContent = 'Funds ' + fmtMoney(save.money);
    E.menuRange.disabled = !RANGE;
  }
  function showTitle() { renderTitle(); showScreen('title', 'menu-continue'); }
  function menuContinue() {
    Audio.play('click');
    if (hasStarted()) { showMissions(); return; }
    var intro = arr(D.intro);
    var after = function () { save.seenIntro = true; persist(); Missions.chapter = null; showMissions(); };
    if (intro.length) playStory(intro, after); else after();
  }

  /* =====================================================================
   * Mission select
   * ===================================================================== */
  var Missions = { chapter: null };
  function chapterMissions(id) {
    if (id === 0) return RANGE ? [RANGE] : [];
    var out = [];
    each(CAMPAIGN, function (m) { if (num(m.chapter, 1) === id) out.push(m); });
    return out;
  }
  function defaultChapter() {
    var nxt = nextOpenMission();
    if (nxt) return num(nxt.chapter, 1);
    if (CAMPAIGN.length) return num(CAMPAIGN[CAMPAIGN.length - 1].chapter, 1);
    return CHAPTERS.length ? CHAPTERS[0].id : 0;
  }
  function showMissions() {
    if (Missions.chapter === null || !chapterById(Missions.chapter)) Missions.chapter = defaultChapter();
    renderMissions();
    showScreen('missions', 'chapter-tab-' + Missions.chapter);
  }
  function renderMissions() {
    E.missionsMoney.textContent = fmtMoney(save.money);
    clear(E.chapterTabs);
    each(CHAPTERS, function (ch) {
      var ms = chapterMissions(ch.id), done = 0, st = 0;
      each(ms, function (m) { var s = starsOf(m.id); st += s; if (s > 0) done++; });
      var b = mk('button', 'folder');
      b.type = 'button';
      b.id = 'chapter-tab-' + ch.id;
      b.setAttribute('aria-pressed', ch.id === Missions.chapter ? 'true' : 'false');
      b.appendChild(mk('span', 'f-no', pad2(ch.id)));
      b.appendChild(mk('span', 'f-title', ch.title || ('Chapter ' + ch.id)));
      b.appendChild(mk('span', 'f-meta', ch.id === 0 ? 'Repeatable' : (done + '/' + ms.length + ' \u00b7 ' + st + ' \u2605')));
      b.addEventListener('click', function () {
        Audio.play('click');
        Missions.chapter = ch.id;
        renderMissions();
        focusSoon('chapter-tab-' + ch.id);
      });
      E.chapterTabs.appendChild(b);
    });
    var ch = chapterById(Missions.chapter) || CHAPTERS[0] || { id: 0, title: '' };
    E.chapterTitle.textContent = ch.id === 0 ? (ch.title || 'Shooting Range') : 'Chapter ' + ch.id + ': ' + (ch.title || '');
    E.chapterSub.textContent = ch.subtitle || '';
    clear(E.missionGrid);
    each(chapterMissions(ch.id), function (m, k) {
      var unlocked = isUnlocked(m), stars = starsOf(m.id), idx = CAMPAIGN.indexOf(m);
      var b = mk('button', 'mcard' + (!unlocked ? ' locked' : (stars && m !== RANGE) ? ' done' : ' new') + (reduceMotion ? '' : ' deal'));
      b.type = 'button';
      b.id = 'mission-card-' + m.id;
      if (!reduceMotion) b.style.animationDelay = (k * 0.05) + 's';
      if (unlocked && stars && m !== RANGE) b.appendChild(mk('span', 'c-stamp', stars >= 3 ? 'Clean' : 'Closed'));
      var top = mk('span', 'c-top');
      top.appendChild(mk('span', null, m === RANGE ? 'TRAINING' : 'M-' + pad2(idx + 1)));
      top.appendChild(mk('span', 'c-stars', starStr(stars)));
      b.appendChild(top);
      b.appendChild(mk('span', 'c-title', m.title || m.id));
      b.appendChild(mk('span', 'c-loc', m.location || ''));
      var foot = mk('span', 'c-foot');
      foot.appendChild(mk('span', 'c-reward', fmtMoney(m.reward)));
      foot.appendChild(mk('span', 'c-state', !unlocked ? 'Locked' : m === RANGE ? 'Open' : stars ? 'Closed' : 'Open file'));
      b.appendChild(foot);
      if (!unlocked) {
        b.appendChild(mk('span', 'lock-stamp', 'Locked'));
        b.setAttribute('aria-label', (m.title || m.id) + ', locked. Complete the previous contract first.');
      } else {
        b.setAttribute('aria-label', (m.title || m.id) + ', ' + (m.location || '') + ', ' + stars + ' of 3 stars, fee ' + fmtMoney(m.reward));
      }
      b.addEventListener('click', function () {
        if (!isUnlocked(m)) {
          Audio.play('click');
          b.style.animationDelay = '0s';
          b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake');
          menuToast('Close the previous contract first.');
          return;
        }
        openMission(m, 'missions');
      });
      E.missionGrid.appendChild(b);
    });
  }
  function openMission(m, from) {
    Audio.play('click');
    var before = arr(m.storyBefore);
    if (before.length && !starsOf(m.id) && !Story.seen[m.id]) {
      Story.seen[m.id] = true;
      playStory(before, function () { showBriefing(m, from); });
    } else {
      showBriefing(m, from);
    }
  }

  /* =====================================================================
   * Briefing
   * ===================================================================== */
  var Brief = { m: null, from: 'missions' };
  var TIME_LABEL = { night: 'Night', rain: 'Night, heavy rain', dusk: 'Dusk', dawn: 'Dawn', fog: 'Fog' };
  var MUG_SVG = '<svg viewBox="0 0 46 54" width="46" height="54" aria-hidden="true"><rect width="46" height="54" fill="#c9c0ad"/><circle cx="23" cy="20" r="9" fill="#3a3632"/><path d="M6 54c1-12 8-19 17-19s16 7 17 19z" fill="#3a3632"/></svg>';

  function allEntities(m) {
    var list = arr(m.entities).slice();
    each(arr(m.spawns), function (s) { if (s && s.entity) list.push(s.entity); });
    return list;
  }
  function hasRole(m, role) { var l = allEntities(m), i; for (i = 0; i < l.length; i++) if (l[i] && l[i].role === role) return true; return false; }
  function dl(parent, label, value) { parent.appendChild(mk('dt', null, label)); parent.appendChild(mk('dd', null, value)); }

  function showBriefing(m, from) {
    Brief.m = m;
    if (from) Brief.from = from;
    var rules = m.rules || {}, idx = CAMPAIGN.indexOf(m);
    E.briefFile.textContent = m === RANGE ? 'Training file' : 'Contract No. ' + pad2(idx + 1);
    E.briefTitle.textContent = m.title || m.id;
    E.briefLoc.textContent = m.location || '';
    clear(E.briefBadges);
    var badge = function (text, soft) { E.briefBadges.appendChild(mk('span', 'badge' + (soft ? ' soft' : ''), text)); };
    if (rules.noAlarm) badge('No alarm');
    if (num(m.timeLimit, 0) > 0) badge('Timed ' + fmtTime(m.timeLimit));
    if (rules.markTargets === false) badge('Identify');
    if (hasRole(m, 'attacker')) badge('Defend');
    if (hasRole(m, 'ally')) badge('Protect');
    if (rules.noCivilianKills !== false) badge('No civilians', true);
    briefType(m.briefing || '');

    clear(E.briefIntel);
    each(arr(m.intel), function (it) {
      if (!it) return;
      var li = mk('li');
      var mug = mk('span', 'mug');
      mug.innerHTML = MUG_SVG;
      li.appendChild(mug);
      var info = mk('div');
      info.appendChild(mk('strong', null, it.name || 'Unknown'));
      info.appendChild(mk('span', null, it.text || ''));
      li.appendChild(info);
      E.briefIntel.appendChild(li);
    });
    E.briefIntelWrap.hidden = !E.briefIntel.firstChild;

    clear(E.briefObjectives);
    each(arr(m.objectives), function (o) { E.briefObjectives.appendChild(mk('li', null, String(o))); });
    E.briefObjWrap.hidden = !E.briefObjectives.firstChild;

    clear(E.briefConditions);
    dl(E.briefConditions, 'Time', TIME_LABEL[m.time] || 'Night');
    var wb = num(m.wind && m.wind.base, 0), wg = num(m.wind && m.wind.gust, 0), wt;
    if (Math.abs(wb) < 0.05) wt = 'Calm';
    else wt = (wb > 0 ? '\u2192 ' : '\u2190 ') + Math.abs(wb).toFixed(1) + ' m/s, ' + (wb > 0 ? 'left to right' : 'right to left');
    if (wg > 0.05) wt += (Math.abs(wb) < 0.05 ? ', ' : '; ') + 'gusts \u00b1' + wg.toFixed(1) + ' m/s';
    dl(E.briefConditions, 'Wind', wt);
    var dmin = Infinity, dmax = -Infinity, nT = 0;
    each(allEntities(m), function (e) {
      if (!e || (e.role !== 'target' && e.role !== 'attacker')) return;
      nT++;
      var d = num(e.dist, NaN);
      if (isFinite(d)) { dmin = Math.min(dmin, d); dmax = Math.max(dmax, d); }
    });
    if (isFinite(dmin)) dl(E.briefConditions, 'Distance', Math.round(dmin) === Math.round(dmax) ? Math.round(dmin) + ' m' : Math.round(dmin) + '\u2013' + Math.round(dmax) + ' m');
    if (nT) dl(E.briefConditions, 'Marks', String(nT));
    if (num(m.timeLimit, 0) > 0) dl(E.briefConditions, 'Time limit', fmtTime(m.timeLimit));
    dl(E.briefConditions, 'Civilians', rules.noCivilianKills !== false ? 'Any casualty voids the contract' : '\u2212$150 per casualty');
    if (m !== RANGE && starsOf(m.id)) dl(E.briefConditions, 'Best', starStr(starsOf(m.id)));

    E.briefReward.textContent = fmtMoney(m.reward);
    renderLoadoutSummary();
    showScreen('briefing', 'brief-accept');
  }
  function renderLoadoutSummary() {
    var lo = buildLoadout(), w = weaponById(save.equipped) || {};
    clear(E.briefLoadout);
    dl(E.briefLoadout, 'Rifle', lo.name);
    dl(E.briefLoadout, 'Scope', labelOf(gearLevelObj('scope')) || (lo.zoom + 'x'));
    dl(E.briefLoadout, 'Stock', labelOf(gearLevelObj('stock')) || '-');
    dl(E.briefLoadout, 'Magazine', lo.magazine + ' rds');
    dl(E.briefLoadout, 'Suppressor', lo.suppressed ? (w.suppressed ? 'Integral' : 'Fitted') : 'None');
    dl(E.briefLoadout, 'Computer', lo.computer ? 'Installed' : 'None');
  }
  // Typewriter reveal of the dossier text. The untyped rest stays in the layout (hidden) so nothing jumps.
  var BriefType = { timer: 0, text: '', n: 0, typed: null, ghost: null, forId: null };
  function briefType(text) {
    clearInterval(BriefType.timer); BriefType.timer = 0;
    BriefType.text = String(text || '');
    clear(E.briefText);
    BriefType.typed = mk('span', 'typed');
    BriefType.ghost = mk('span', 'ghost');
    E.briefText.appendChild(BriefType.typed);
    E.briefText.appendChild(BriefType.ghost);
    var id = Brief.m ? Brief.m.id : null;
    if (reduceMotion || !BriefType.text || BriefType.forId === id) { BriefType.forId = id; briefTypeDone(); return; }
    BriefType.forId = id;
    BriefType.n = 0;
    BriefType.ghost.textContent = BriefType.text;
    E.briefText.classList.add('typing');
    var t0 = now(), lastSnd = 0;
    BriefType.timer = setInterval(function () {
      if (current !== 'briefing') { briefTypeDone(); return; }
      var t = now(), n = Math.min(BriefType.text.length, Math.max(0, Math.floor((t - t0 - 280) / 1000 * 90)));
      if (n <= BriefType.n) return;
      BriefType.n = n;
      BriefType.typed.textContent = BriefType.text.slice(0, n);
      BriefType.ghost.textContent = BriefType.text.slice(n);
      if (t - lastSnd > 90 && /\S/.test(BriefType.text.charAt(n - 1))) { Audio.play('type'); lastSnd = t; }
      if (n >= BriefType.text.length) briefTypeDone();
    }, 30);
  }
  function briefTypeDone() {
    clearInterval(BriefType.timer); BriefType.timer = 0;
    if (BriefType.typed) BriefType.typed.textContent = BriefType.text;
    if (BriefType.ghost) BriefType.ghost.textContent = '';
    E.briefText.classList.remove('typing');
  }

  function briefBack() {
    Audio.play('click');
    if (Brief.from === 'title') showTitle(); else showMissions();
  }

  /* =====================================================================
   * Play: HUD, controls, hooks
   * ===================================================================== */
  var Play = { m: null, token: 0, active: false, paused: false, ended: false, lastPauseClose: 0, loadout: null, pendingAfter: null };
  var Hud = { cache: {}, pips: [], subQ: [], subTimer: 0, subBusy: false, toastPri: 0, toastAt: 0, toastTimer: 0, lastHead: 0, lastAlert: 0, hintTimer: 0 };

  function coreOk() { return !!(LW.Core && typeof LW.Core.start === 'function' && LW.Render); }
  function safeStop() { try { if (LW.Core && typeof LW.Core.stop === 'function') LW.Core.stop(); } catch (e) { /* ignore */ } }
  function coreInput(name, arg) {
    if (!Play.active || Play.paused) return;
    try {
      var inp = LW.Core && LW.Core.input;
      if (inp && typeof inp[name] === 'function') inp[name](arg);
    } catch (e) { /* ignore */ }
  }

  // Objectives that are satisfied by killing every target/attacker get a check mark when targetsLeft hits 0.
  var RULE_RX = /^\s*(do not|don't|dont|no |never|avoid|keep|protect|stay|without|leave|spare|survive)/i;
  var GOAL_RX = /(eliminat|kill|take (him |her |them )?out|neutrali[sz]|assassinat|stop|silence|remove|drop|shoot|hit |destroy|down |put down|finish|end |defend|hold|clear|paper|target)/i;

  function hudSetup(m, lo) {
    var i;
    Hud.cache = {}; Hud.subQ = []; Hud.subBusy = false; Hud.toastPri = 0; Hud.maxTargets = 0; Hud.tallyN = -1;
    Hud.windAvg = null; Hud.windT = 0; Hud.gustUntil = 0;
    clearTimeout(Hud.subTimer); clearTimeout(Hud.toastTimer); clearInterval(Hud.typeTimer);
    E.sub.classList.remove('on'); E.sub.classList.remove('typing');
    E.subText.textContent = ''; E.subSpeaker.textContent = ''; E.subSr.textContent = '';
    E.toast.className = 'hud-toast'; E.toast.textContent = '';
    clear(E.objectives); Hud.objItems = [];
    each(arr(m.objectives).slice(0, 3), function (o) {
      var text = String(o), li = mk('li', RULE_RX.test(text) ? 'rule' : null, text);
      li.title = text;
      E.objectives.appendChild(li);
      Hud.objItems.push({ el: li, goal: !RULE_RX.test(text) && GOAL_RX.test(text) });
    });
    // if no objective reads like a kill order, tick the first non-rule one when the board is clear
    var anyGoal = false;
    each(Hud.objItems, function (it) { if (it.goal) anyGoal = true; });
    if (!anyGoal) each(Hud.objItems, function (it) { if (!anyGoal && !RULE_RX.test(it.el.textContent)) { it.goal = true; anyGoal = true; } });
    clear(E.tally); E.targetsRow.classList.remove('clear');
    clear(E.pips); Hud.pips = [];
    for (i = 0; i < lo.magazine; i++) { var p = mk('i'); E.pips.appendChild(p); Hud.pips.push(p); }
    E.timer.hidden = !(num(m.timeLimit, 0) > 0);
    E.timer.classList.remove('warn');
    if (!E.timer.hidden) E.timer.textContent = fmtTime(m.timeLimit);
    E.alarm.hidden = true; E.alarm.classList.remove('raised'); E.alarm.classList.remove('hot');
    E.scope.classList.remove('on');
    E.zoomIn.hidden = true; E.zoomOut.hidden = true; E.zoom.hidden = true;
    E.breath.classList.remove('holding'); E.breath.classList.remove('shaky');
    E.fire.classList.remove('busy');
    E.reload.classList.remove('suggest');
    E.ringLabel.textContent = 'Ready'; E.ringLabel.className = '';
    E.gust.classList.remove('on'); E.windPanel.classList.remove('gusting');
    E.windSvg.setAttribute('class', 'calm');
    E.range.textContent = '---'; E.rangeLz.textContent = ''; E.rangeBox.className = 'rf-box none';
    E.breathFill.style.strokeDashoffset = '0';
    updateSoundBtn();
  }

  function renderTally(left) {
    var total = Hud.maxTargets, i, n = Math.min(total, 6);
    if (Hud.tallyN !== n) {
      clear(E.tally);
      for (i = 0; i < n; i++) E.tally.appendChild(mk('i'));
      Hud.tallyN = n;
    }
    var done = total - left, kids = E.tally.childNodes;
    for (i = 0; i < kids.length; i++) kids[i].className = i < done ? 'done' : '';
    E.tally.hidden = total < 2 || total > 6;
    var clearNow = total > 0 && left === 0;
    E.targetsRow.classList.toggle('clear', clearNow);
    each(Hud.objItems || [], function (it) { if (it.goal) it.el.classList.toggle('done', clearNow); });
  }

  function hudFrame(s) {
    if (!s) return;
    var C = Hud.cache, v, i, tnow = now();
    v = Math.max(0, Math.floor(num(s.targetsLeft, 0)));
    if (v > Hud.maxTargets) Hud.maxTargets = v;
    if (C.tl !== v) { C.tl = v; E.targets.textContent = String(v); renderTally(v); }

    if (s.timeLeft !== null && s.timeLeft !== undefined && isFinite(s.timeLeft)) {
      v = Math.max(0, Math.ceil(s.timeLeft));
      if (C.time !== v) { C.time = v; E.timer.hidden = false; E.timer.textContent = fmtTime(v); E.timer.classList.toggle('warn', v <= 10); }
    } else if (C.time !== null) { C.time = null; E.timer.hidden = true; }

    var raised = !!s.alarmRaised;
    v = raised ? 100 : Math.round(clamp(num(s.alarm, 0), 0, 1) * 100);
    if (C.alarm !== v || C.raised !== raised) {
      C.alarm = v; C.raised = raised;
      E.alarm.hidden = v <= 0;
      E.alarmFill.style.transform = 'scaleX(' + (v / 100) + ')';
      E.alarmPct.textContent = raised ? '' : v + '%';
      E.alarmLabel.textContent = raised ? 'Alarm raised' : 'Suspicion';
      E.alarm.classList.toggle('raised', raised);
      E.alarm.classList.toggle('hot', !raised && v >= 60);
    }

    // wind: animated flow arrow (speed follows strength) and a flickering GUST tag on fast changes
    var wraw = num(s.wind, 0);
    if (Hud.windAvg === null) { Hud.windAvg = wraw; Hud.windT = tnow; }
    var wdt = Math.min(0.25, Math.max(0, (tnow - Hud.windT) / 1000));
    Hud.windT = tnow;
    Hud.windAvg += (wraw - Hud.windAvg) * Math.min(1, wdt / 1.6);
    if (Math.abs(wraw - Hud.windAvg) > 0.35) Hud.gustUntil = tnow + 900;
    var gusting = tnow < Hud.gustUntil;
    if (C.gust !== gusting) { C.gust = gusting; E.gust.classList.toggle('on', gusting); E.windPanel.classList.toggle('gusting', gusting); }
    v = Math.round(wraw * 10) / 10;
    if (C.wind !== v) {
      C.wind = v;
      E.wind.textContent = Math.abs(v).toFixed(1);
      var calm = Math.abs(v) < 0.1;
      var bucket = calm ? 0 : Math.max(1, Math.round(Math.abs(v) * 2));
      if (C.windBucket !== bucket || C.windLeft !== (v < 0)) {
        C.windBucket = bucket; C.windLeft = v < 0;
        E.windSvg.setAttribute('class', calm ? 'calm' : (v < 0 ? 'left' : ''));
        if (!calm) E.windSvg.style.setProperty('--wdur', clamp(1.8 / (bucket / 2), 0.22, 2.4).toFixed(2) + 's');
      }
    }

    v = (s.range === null || s.range === undefined || !isFinite(s.range)) ? -1 : Math.round(s.range);
    if (C.range !== v) {
      C.range = v;
      if (v < 0) { E.rangeLz.textContent = ''; E.range.textContent = '---'; E.rangeBox.className = 'rf-box none'; }
      else {
        var rs = String(v), lz = '';
        while (lz.length + rs.length < 3) lz += '0';
        E.rangeLz.textContent = lz; E.range.textContent = rs; E.rangeBox.className = 'rf-box';
      }
    }

    var sc = !!s.scoped;
    if (C.scoped !== sc) {
      C.scoped = sc;
      E.scope.classList.toggle('on', sc);
      E.zoomIn.hidden = !sc; E.zoomOut.hidden = !sc; E.zoom.hidden = !sc;
    }
    if (sc) {
      v = Math.round(num(s.view && s.view.zoom, 1) / LW.CONST.OPTIC * 10) / 10;
      if (C.zoom !== v) { C.zoom = v; E.zoom.textContent = v.toFixed(1) + '\u00d7'; }
    }

    v = Math.round(clamp(num(s.breath, 1), 0, 1) * 40) / 40;
    if (C.breath !== v) { C.breath = v; E.breathFill.style.strokeDashoffset = String(Math.round((1 - v) * 1000) / 10); }
    var hold = !!s.holding, shaky = !!s.shaky;
    if (C.hold !== hold) { C.hold = hold; E.breath.classList.toggle('holding', hold); }
    if (C.shaky !== shaky) { C.shaky = shaky; E.breath.classList.toggle('shaky', shaky); }

    var ammo = Math.max(0, Math.floor(num(s.ammo, 0)));
    if (C.ammo !== ammo) {
      C.ammo = ammo;
      for (i = 0; i < Hud.pips.length; i++) Hud.pips[i].className = i < ammo ? '' : 'spent';
    }

    var rl = num(s.reloading, 0), bo = num(s.bolt, 0), mode, p;
    if (rl > 0) { mode = 'reload'; p = rl; }
    else if (bo > 0) { mode = 'bolt'; p = bo; }
    else { mode = ammo === 0 ? 'empty' : 'ready'; p = 1; }
    p = Math.round(clamp(p, 0, 1) * 50) / 50;
    if (C.mode !== mode) {
      C.mode = mode;
      E.ring.setAttribute('class', mode === 'ready' ? 'ready' : '');
      E.ringLabel.textContent = mode === 'reload' ? 'Reloading' : mode === 'bolt' ? 'Cycling' : mode === 'empty' ? 'Empty' : 'Ready';
      E.ringLabel.className = mode === 'empty' ? 'empty' : mode === 'ready' ? '' : 'busy';
      E.fire.classList.toggle('busy', mode !== 'ready');
    }
    var suggest = mode !== 'reload' && ammo < Hud.pips.length && ammo <= 1;
    if (C.suggest !== suggest) { C.suggest = suggest; E.reload.classList.toggle('suggest', suggest); }
    if (C.ring !== p) { C.ring = p; E.ringArc.style.strokeDashoffset = String(100 * (1 - p)); }
  }

  function hudToast(text, cls, pri) {
    var t = now();
    if (pri < Hud.toastPri && t - Hud.toastAt < 700) return;
    Hud.toastPri = pri; Hud.toastAt = t;
    var el = E.toast;
    el.className = 'hud-toast';
    el.textContent = text;
    Hud.toastN = (Hud.toastN || 0) + 1;
    el.style.setProperty('--rot', (((Hud.toastN % 2 ? -4 : 3) + Math.random() * 2 - 1).toFixed(1)) + 'deg');
    void el.offsetWidth;
    el.className = 'hud-toast show' + (cls ? ' ' + cls : '');
    clearTimeout(Hud.toastTimer);
    Hud.toastTimer = setTimeout(function () { el.className = 'hud-toast'; Hud.toastPri = 0; }, 1550);
  }

  function hudSubtitle(text) {
    text = String(text || '').replace(/^\s+|\s+$/g, '');
    if (!text) return;
    Hud.subQ.push(text);
    if (Hud.subQ.length > 4) Hud.subQ.shift();
    if (!Hud.subBusy) subNext();
  }
  // Earpiece line: speaker tag + typewriter reveal, hold long enough to read, then fade out.
  var SUB_CPS = 46;
  function subNext() {
    var t = Hud.subQ.shift();
    clearTimeout(Hud.subTimer); clearInterval(Hud.typeTimer);
    if (t === undefined) { Hud.subBusy = false; E.sub.classList.remove('on'); E.sub.classList.remove('typing'); return; }
    Hud.subBusy = true;
    var m = /^([A-Z][A-Za-z .'\-]{0,24}):\s*([\s\S]*)$/.exec(t);
    var speaker = m ? m[1].toUpperCase() : '', body = m ? m[2] : t;
    E.subSpeaker.textContent = speaker;
    E.subSr.textContent = (speaker ? speaker + ': ' : '') + body;
    var hold = clamp(1600 + body.length * 38, 2600, 5600);
    var finish = function () {
      clearInterval(Hud.typeTimer);
      E.subText.textContent = body;
      E.sub.classList.remove('typing');
      Hud.subTimer = setTimeout(function () {
        if (Hud.subQ.length) {
          E.sub.classList.remove('on');
          Hud.subTimer = setTimeout(subNext, 260);
        } else { E.sub.classList.remove('on'); Hud.subBusy = false; }
      }, hold);
    };
    E.sub.classList.add('on');
    Audio.play('radio');
    if (reduceMotion || !body) { finish(); return; }
    // typed part + invisible rest, so the band keeps its final size while the text types in
    clear(E.subText);
    var typed = mk('span', 'typed'), ghost = mk('span', 'ghost', body);
    E.subText.appendChild(typed); E.subText.appendChild(ghost);
    E.sub.classList.add('typing');
    var t0 = now(), shown = 0;
    Hud.typeTimer = setInterval(function () {
      var n = Math.min(body.length, Math.floor((now() - t0) / 1000 * SUB_CPS));
      if (n !== shown) { shown = n; typed.textContent = body.slice(0, n); ghost.textContent = body.slice(n); }
      if (n >= body.length) finish();
    }, 33);
  }

  function onGameEvent(evt) {
    if (!evt || !evt.type) return;
    var t = now();
    switch (evt.type) {
      case 'headshot': Hud.lastHead = t; hudToast('Headshot', 'gold', 3); break;
      case 'kill': if (t - Hud.lastHead > 350) hudToast('Kill', '', 2); break;
      case 'hit': hudToast('Hit', 'small', 1); break;
      case 'civilian': hudToast('Civilian down', 'blood', 3); break;
      case 'alert':
        if (t - Hud.lastAlert > 2500) { Hud.lastAlert = t; hudToast('Alerted', 'warn', 2); }
        break;
      case 'alarm': hudToast('Alarm raised', 'blood', 4); break;
      case 'spawn': hudToast('New contact', 'warn', 1); break;
      case 'message': hudSubtitle(evt.text); break;
      default: break;
    }
  }

  function hideHint() {
    clearTimeout(Hud.hintTimer);
    if (E.hint) E.hint.hidden = true;
  }
  function maybeHint() {
    if (store.get(HINT_KEY, false)) return;
    store.set(HINT_KEY, true);
    var st = save.settings;
    clear(E.hintTouch);
    var add = function (txt, bold) { E.hintTouch.appendChild(bold ? mk('b', null, txt) : document.createTextNode(txt)); };
    add(st.aimInvert ? 'Drag to move the view. ' : 'Drag to move the crosshair. ');
    add(st.tapToScope ? 'Tap the city to zoom in there. ' : 'Tap SCOPE to zoom in. ');
    add('Hold '); add('STEADY', true); add(', then '); add('FIRE', true); add('.');
    E.hintKeys.hidden = !(matches('(pointer: fine)') || matches('(any-pointer: fine)'));
    E.hint.hidden = false;
    clearTimeout(Hud.hintTimer);
    Hud.hintTimer = setTimeout(hideHint, 10000);
  }
  function aimOptions() {
    var st = save.settings;
    return { sensitivity: st.sensitivity, invertDrag: !!st.aimInvert, tapToScope: st.tapToScope !== false };
  }
  function pushAimOptions() {
    if (!Play.active) return;
    try { if (LW.Core && typeof LW.Core.setOptions === 'function') LW.Core.setOptions(aimOptions()); } catch (e) { /* ignore */ }
  }

  function beginPlay(m) {
    if (!m) return;
    if (!coreOk()) {
      showError('Rifle not assembled', 'The engine (core.js) or renderer (render.js) did not load, so missions cannot start. Menus, the armory and settings still work.', true);
      return;
    }
    safeStop();
    Play.token++;
    var tk = Play.token;
    Play.m = m; Play.active = true; Play.paused = false; Play.ended = false;
    var lo = buildLoadout();
    Play.loadout = lo;
    showScreen(null);
    E.pause.hidden = true;
    E.canvas.hidden = false;
    E.hud.hidden = false;
    hudSetup(m, lo);
    BriefType.forId = null;
    Audio.unlock();     // beginPlay runs from a tap: retry creating/resuming the context here
    Audio.resume();
    Audio.setMenu(false);
    Audio.ambience(m.time || 'night');
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    var hooks = {
      onFrame: function (s) { if (tk === Play.token && Play.active) { try { hudFrame(s); } catch (e) { /* keep playing */ } } },
      onEvent: function (evt) { if (tk === Play.token && Play.active) onGameEvent(evt); },
      onEnd: function (result) {
        if (tk !== Play.token || !Play.active || Play.ended) return;
        Play.ended = true;
        setTimeout(function () { if (tk === Play.token) finishMission(m, result); }, 0);
      },
      onPause: function () { if (tk === Play.token) showPause(); }
    };
    try {
      LW.Core.start(m, lo, hooks, aimOptions());
    } catch (e) {
      endPlay();
      showError('The rifle jammed', 'The mission could not start.\n' + (e && e.message ? e.message : String(e)), true, showMissions);
      return;
    }
    maybeHint();
  }
  function endPlay() {
    Play.active = false; Play.paused = false;
    safeStop();
    Audio.stopAmbience();
    E.hud.hidden = true;
    E.pause.hidden = true;
    hideHint();
    clearTimeout(Hud.subTimer); clearInterval(Hud.typeTimer); clearTimeout(Hud.toastTimer);
    Hud.subQ = []; Hud.subBusy = false;
    if (E.sub) { E.sub.classList.remove('on'); E.sub.classList.remove('typing'); }
  }

  /* ---------- pause ---------- */
  function showPause() {
    if (!Play.active || Play.paused || Play.ended) return;
    if (now() - Play.lastPauseClose < 300) return;
    try { if (LW.Core.state && LW.Core.state.outcome) return; } catch (eo) { /* ignore */ }
    Play.paused = true;
    try { if (LW.Core.input && LW.Core.input.setBreath) LW.Core.input.setBreath(false); } catch (e0) { /* ignore */ }
    try { LW.Core.pause(); } catch (e) { /* ignore */ }
    var m = Play.m || {};
    E.pauseMission.textContent = (m.title || '') + (m.location ? ' \u00b7 ' + m.location : '');
    clear(E.pauseObjectives);
    each(arr(m.objectives), function (o) { E.pauseObjectives.appendChild(mk('li', null, String(o))); });
    syncSettingsUI();
    E.pause.scrollTop = 0;
    E.pause.hidden = false;
    E.breath.classList.remove('pressed');
    focusSoon(E.pauseResume);
  }
  function hidePause() {
    if (!Play.paused) return;
    Play.paused = false;
    Play.lastPauseClose = now();
    E.pause.hidden = true;
    try { LW.Core.resume(); } catch (e) { /* ignore */ }
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }

  /* =====================================================================
   * Results
   * ===================================================================== */
  function failReason(m, result) {
    var r = result && result.reason, ft = (m && m.failText) || {};
    if (typeof r === 'string' && ft[r]) return ft[r];
    if (typeof r === 'string' && r) return r;
    return 'The contract fell apart.';
  }
  var Results = { m: null, win: false };

  function finishMission(m, result) {
    endPlay();
    result = (result && typeof result === 'object') ? result : {};
    var win = !!result.win;
    var st = win ? clamp(Math.round(num(result.stars, 1)), 1, 3) : 0;
    var reward = win ? Math.round(num(result.reward, num(m.reward, 0))) : 0;
    var prev = starsOf(m.id);
    var firstWin = win && prev === 0;
    if (win) {
      save.missions[m.id] = { stars: Math.max(prev, st) };
      save.money = Math.max(0, save.money + reward);
    }
    persist();
    Play.pendingAfter = null;
    if (firstWin && m !== RANGE) {
      var after = arr(m.storyAfter), ending = isFinal(m) ? arr(D.ending) : [];
      if (after.length || ending.length) Play.pendingAfter = { after: after, ending: ending };
    }
    Results.m = m; Results.win = win;
    renderResults(m, result, win, st, reward, prev);
    showScreen('results', win && !E.resNext.hidden ? 'res-next' : 'res-retry');
    Audio.play(win ? 'win' : 'fail');
    resultsSequence(win, st, reward);
  }

  // Stars stamp in one after another, then the stamp, then the money counts up.
  var ResAnim = { token: 0, raf: 0, timers: [] };
  function resLater(ms, fn) { ResAnim.timers.push(setTimeout(fn, ms)); }
  function resCancel() {
    ResAnim.token++;
    each(ResAnim.timers, function (t) { clearTimeout(t); });
    ResAnim.timers = [];
    if (ResAnim.raf) cancelAnimationFrame(ResAnim.raf);
    ResAnim.raf = 0;
  }
  function countUp(el, from, to, ms, tk, done, silent) {
    var t0 = now(), lastTick = 0;
    var step = function () {
      if (tk !== ResAnim.token) return;
      var t = now(), k = clamp((t - t0) / ms, 0, 1), e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmtMoney(from + (to - from) * e);
      if (!silent && t - lastTick > 70 && k < 1) { Audio.play('type'); lastTick = t; }
      if (k < 1) ResAnim.raf = requestAnimationFrame(step);
      else { ResAnim.raf = 0; if (done) done(); }
    };
    step();
  }
  function resultsSequence(win, st, reward) {
    resCancel();
    var tk = ResAnim.token, i;
    var stars = E.resStars.childNodes;
    var STEP = 320, START = 420;
    for (i = 0; i < stars.length; i++) {
      stars[i].style.animationDelay = (reduceMotion ? 0 : (START + i * STEP) / 1000) + 's';
      if (win && i < st) resLater(reduceMotion ? 0 : START + i * STEP + 160, function () { if (tk === ResAnim.token) Audio.play('stamp'); });
    }
    var stampAt = reduceMotion ? 0 : START + 3 * STEP + 80;
    resLater(stampAt, function () {
      if (tk !== ResAnim.token) return;
      E.resStamp.classList.add('go');
      Audio.play('stamp');
    });
    var total = E.resMoney.querySelector('dd.total'), bal = E.resBalance.querySelector('b');
    if (!win || reward <= 0 || reduceMotion || !total || !bal) {
      if (win && reward > 0) resLater(stampAt + 300, function () { if (tk === ResAnim.token) Audio.play('cash'); });
      return;
    }
    var before = save.money - reward;
    total.textContent = fmtMoney(0);
    bal.textContent = fmtMoney(before);
    resLater(stampAt + 260, function () {
      if (tk !== ResAnim.token) return;
      countUp(total, 0, reward, 900, tk, function () { Audio.play('cash'); });
      countUp(bal, before, save.money, 900, tk, null, true);
    });
  }

  function renderResults(m, result, win, st, reward, prev) {
    var stats = result.stats || {}, i;
    E.resHead.className = 'results-head' + (win ? '' : ' fail');
    E.resMission.textContent = (m.title || m.id) + (m.location ? ' \u00b7 ' + m.location : '');
    E.resTitle.textContent = win ? 'Mission complete' : 'Contract failed';
    E.resReason.textContent = win ? (m === RANGE ? 'Range session logged. The club pays in cash.' : 'Contract fulfilled. Payment has been wired.') : failReason(m, result);
    clear(E.resStars);
    for (i = 0; i < 3; i++) E.resStars.appendChild(mk('span', i < st ? 'on' : 'off', i < st ? '\u2605' : '\u2606'));
    E.resStamp.className = 'res-stamp' + (win ? '' : ' fail');
    E.resStamp.textContent = win ? (m === RANGE ? 'Logged' : 'Paid') : 'Void';
    E.resStars.setAttribute('aria-label', st + ' of 3 stars');
    var best = Math.max(prev, st);
    E.resBest.textContent = win && st > prev && prev > 0 ? 'New best' : (best > 0 ? 'Best ' + starStr(best) : '');

    clear(E.resStats);
    var shots = Math.max(0, num(stats.shots, 0)), hits = Math.max(0, num(stats.hits, 0));
    var acc = num(result.accuracy, shots ? hits / shots : 0);
    if (acc > 1) acc = acc / 100;
    dl(E.resStats, 'Shots', String(shots));
    dl(E.resStats, 'Hits', String(hits));
    dl(E.resStats, 'Headshots', String(Math.max(0, num(stats.headshots, 0))));
    dl(E.resStats, 'Kills', String(Math.max(0, num(stats.kills, 0))));
    dl(E.resStats, 'Civilians', String(Math.max(0, num(stats.civilians, 0))));
    dl(E.resStats, 'Accuracy', Math.round(clamp(acc, 0, 1) * 100) + '%');

    clear(E.resMoney);
    var row = function (label, amount, cls) {
      var dt = mk('dt', cls || null, label), dd = mk('dd', cls || null, amount);
      if (!cls && /^\u2212/.test(amount)) dd.className = 'neg';
      E.resMoney.appendChild(dt); E.resMoney.appendChild(dd);
    };
    if (win) {
      var bon = arr(result.bonuses), sum = 0, fee = num(m.reward, 0);
      each(bon, function (b) { sum += num(b && b.amount, 0); });
      if (fee && Math.abs(fee + sum - reward) <= 1) row('Contract fee', fmtMoney(fee));
      each(bon, function (b) { if (b) row(String(b.label || 'Bonus'), fmtSigned(num(b.amount, 0))); });
      if (!E.resMoney.firstChild) row('Contract fee', fmtMoney(reward));
      row('Total', fmtMoney(reward), 'total');
    } else {
      row('Contract fee', 'Void');
      row('Total', fmtMoney(0), 'total');
    }
    E.resBalance.innerHTML = '';
    E.resBalance.appendChild(document.createTextNode('Balance '));
    E.resBalance.appendChild(mk('b', null, fmtMoney(save.money)));
    if (!reduceMotion) {
      var stagger = function (list, base) {
        var k;
        for (k = 0; k < list.length; k++) {
          list[k].classList.add('reveal');
          list[k].style.animationDelay = (base + Math.floor(k / 2) * 0.07).toFixed(2) + 's';
        }
      };
      stagger(E.resStats.childNodes, 0.2);
      stagger(E.resMoney.childNodes, 0.5);
    }

    var nxt = win ? nextMission(m) : null;
    E.resNext.hidden = !(nxt && isUnlocked(nxt));
    E.resRetry.className = E.resNext.hidden ? 'btn-primary' : 'btn';
  }

  function leaveResults(action) {
    var m = Results.m, pend = Play.pendingAfter, endingShown = false;
    Play.pendingAfter = null;
    resCancel();
    var go = function () {
      if (endingShown) { showTitle(); menuToast('Case closed.'); return; }
      if (action === 'retry' && m) beginPlay(m);
      else if (action === 'next' && m && nextMission(m)) openMission(nextMission(m), 'missions');
      else { if (m && m !== RANGE) Missions.chapter = num(m.chapter, Missions.chapter); showMissions(); }
    };
    Audio.play('click');
    if (pend) {
      endingShown = pend.ending.length > 0;
      E.canvas.hidden = true;
      runStories([pend.after, pend.ending], go);
    } else {
      go();
    }
  }

  /* =====================================================================
   * Armory
   * ===================================================================== */
  var Armory = { from: 'title', animate: false, bars: [] };
  function showArmory(from) {
    Armory.from = from || 'title';
    Armory.animate = true;
    renderArmory();
    showScreen('armory', 'armory-back');
  }
  function armoryBack() {
    Audio.play('click');
    if (Armory.from === 'briefing' && Brief.m) showBriefing(Brief.m); else showTitle();
  }
  function statRow(parent, label, frac, val, inv) {
    parent.appendChild(mk('span', 'stat-l', label));
    var bar = mk('span', 'stat-bar' + (inv ? ' inv' : ''));
    var b = mk('b'), w = Math.round(clamp(frac, 0, 1) * 100) + '%';
    if (Armory.animate && !reduceMotion) { b.style.width = '0%'; Armory.bars.push({ el: b, w: w }); }
    else b.style.width = w;
    bar.appendChild(b);
    parent.appendChild(bar);
    parent.appendChild(mk('span', 'stat-v', val));
  }
  function growBars() {
    var list = Armory.bars;
    Armory.bars = [];
    if (!list.length) return;
    // two frames so the 0% width is committed before the transition target is set
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        each(list, function (it, k) { it.el.style.transitionDelay = (0.12 + k * 0.02).toFixed(2) + 's'; it.el.style.width = it.w; });
      });
    });
  }
  function renderArmory() {
    Armory.bars = [];
    E.armoryMoney.textContent = fmtMoney(save.money);
    clear(E.armoryRifles);
    var maxD = 1, maxV = 1, maxS = 0.001, maxDrop = 0.001;
    each(WEAPONS, function (w) {
      maxD = Math.max(maxD, num(w.damage, 0));
      maxV = Math.max(maxV, num(w.velocity, 0));
      maxS = Math.max(maxS, 1 / Math.max(0.05, num(w.swayMul, 1)));
      maxDrop = Math.max(maxDrop, num(w.dropMul, 1));
    });
    each(WEAPONS, function (w) {
      var owned = save.weapons.indexOf(w.id) >= 0, eq = save.equipped === w.id, price = Math.max(0, num(w.price, 0));
      var card = mk('div', 'rifle' + (eq ? ' equipped' : owned ? ' owned' : ' locked'));
      var head = mk('div', 'r-head');
      head.appendChild(mk('div', 'r-name', w.name || w.id));
      if (eq) head.appendChild(mk('span', 'r-tag eq', 'Equipped'));
      else if (owned) head.appendChild(mk('span', 'r-tag own', 'Owned'));
      else head.appendChild(mk('span', 'r-tag ' + (save.money >= price ? 'price' : 'short'), fmtMoney(price)));
      card.appendChild(head);
      var btn = mk('button', 'r-act ' + (owned ? 'btn' : 'btn-primary'));
      btn.type = 'button';
      btn.id = 'rifle-act-' + w.id;
      if (eq) { btn.textContent = 'Equipped'; btn.disabled = true; }
      else if (owned) {
        btn.textContent = 'Equip';
        btn.addEventListener('click', function () { equipWeapon(w); });
      } else {
        btn.textContent = 'Buy ' + fmtMoney(price);
        if (save.money < price) {
          btn.disabled = true;
          btn.className = 'r-act btn';
          btn.appendChild(mk('small', null, 'Need ' + fmtMoney(price - save.money) + ' more'));
        } else {
          btn.addEventListener('click', function () { buyWeapon(w); });
        }
      }
      card.appendChild(btn);
      if (w.desc) card.appendChild(mk('div', 'r-desc', w.desc));
      var st = mk('div', 'r-stats');
      var stab = 1 / Math.max(0.05, num(w.swayMul, 1));
      statRow(st, 'Damage', num(w.damage, 0) / maxD, String(Math.round(num(w.damage, 0))), false);
      statRow(st, 'Velocity', num(w.velocity, 0) / maxV, Math.round(num(w.velocity, 0)) + ' m/s', false);
      statRow(st, 'Stability', stab / maxS, stab.toFixed(2), false);
      statRow(st, 'Drop', num(w.dropMul, 1) / maxDrop, num(w.dropMul, 1).toFixed(2) + '\u00d7', true);
      card.appendChild(st);
      card.appendChild(mk('div', 'r-specs',
        'Mag ' + Math.round(num(w.magazine, 5)) + ' \u00b7 Reload ' + num(w.reloadTime, 2.2).toFixed(1) + ' s \u00b7 Bolt ' +
        num(w.boltTime, 1).toFixed(1) + ' s' + (w.suppressed ? ' \u00b7 Suppressed' : '') + (owned ? '' : ' \u00b7 ' + fmtMoney(price))));
      E.armoryRifles.appendChild(card);
    });

    clear(E.armoryGear);
    each(GEAR, function (g) {
      var levels = arr(g.levels), lv = gearLevel(g.id), cur = levels[lv], nxt = levels[lv + 1], i;
      var row = mk('div', 'gear-row' + (nxt ? '' : ' maxed'));
      row.appendChild(mk('div', 'g-name', g.name || g.id));
      var btn = mk('button', 'g-act ' + (nxt ? 'btn-primary' : 'btn'));
      btn.type = 'button';
      btn.id = 'gear-act-' + g.id;
      if (!nxt) { btn.textContent = 'Maxed'; btn.disabled = true; }
      else {
        var price = Math.max(0, num(nxt.price, 0));
        btn.textContent = 'Upgrade';
        btn.appendChild(mk('small', null, fmtMoney(price)));
        if (save.money < price) { btn.disabled = true; btn.className = 'g-act btn'; }
        else btn.addEventListener('click', function () { upgradeGear(g); });
      }
      row.appendChild(btn);
      if (g.desc) row.appendChild(mk('div', 'g-desc', g.desc));
      var lvl = mk('div', 'g-lv'), pips = mk('span', 'pips');
      pips.setAttribute('aria-label', 'Level ' + (lv + 1) + ' of ' + levels.length);
      for (i = 0; i < levels.length; i++) pips.appendChild(mk('i', i <= lv ? 'on' : null));
      lvl.appendChild(pips);
      lvl.appendChild(mk('span', null, labelOf(cur) + (nxt ? '  \u2192  ' + labelOf(nxt) : '')));
      row.appendChild(lvl);
      E.armoryGear.appendChild(row);
    });
    growBars();
    Armory.animate = false;
  }
  function equipWeapon(w) {
    if (save.weapons.indexOf(w.id) < 0) return;
    save.equipped = w.id;
    persist();
    Audio.play('bolt');
    renderArmory();
    menuToast((w.name || w.id) + ' equipped.');
    focusSoon('armory-back');
  }
  function buyWeapon(w) {
    var price = Math.max(0, num(w.price, 0));
    Audio.play('click');
    showConfirm({
      title: 'Buy ' + (w.name || w.id) + '?',
      text: 'Price ' + fmtMoney(price) + '. Balance after purchase: ' + fmtMoney(save.money - price) + '. The rifle will be equipped.',
      yes: 'Buy'
    }, function () {
      if (save.money < price || save.weapons.indexOf(w.id) >= 0) return;
      save.money -= price;
      save.weapons.push(w.id);
      save.equipped = w.id;
      persist();
      Audio.play('cash');
      renderArmory();
      menuToast((w.name || w.id) + ' acquired.');
      focusSoon('armory-back');
    });
  }
  function upgradeGear(g) {
    var levels = arr(g.levels), lv = gearLevel(g.id), nxt = levels[lv + 1];
    if (!nxt) return;
    var price = Math.max(0, num(nxt.price, 0));
    Audio.play('click');
    showConfirm({
      title: 'Upgrade ' + (g.name || g.id) + '?',
      text: labelOf(levels[lv]) + ' \u2192 ' + labelOf(nxt) + ' for ' + fmtMoney(price) + '. Balance after purchase: ' + fmtMoney(save.money - price) + '.',
      yes: 'Upgrade'
    }, function () {
      if (save.money < price || gearLevel(g.id) !== lv) return;
      save.money -= price;
      save.gear[g.id] = lv + 1;
      persist();
      Audio.play('cash');
      renderArmory();
      menuToast((g.name || g.id) + ': ' + labelOf(nxt) + '.');
      var b = $('gear-act-' + g.id);
      focusSoon(b && !b.disabled ? b : 'armory-back');
    });
  }

  /* =====================================================================
   * Settings
   * ===================================================================== */
  // The settings screen and the pause overlay carry the same controls ('set-*' and 'pause-*').
  var SET_PANELS = ['set', 'pause'];
  var persistTimer = 0;
  function persistSoon() { clearTimeout(persistTimer); persistTimer = setTimeout(persist, 250); }
  function rangeFill(input) {
    var mn = parseFloat(input.min), mx = parseFloat(input.max), v = parseFloat(input.value);
    if (!isFinite(mn)) mn = 0;
    if (!isFinite(mx) || mx <= mn) mx = mn + 1;
    if (!isFinite(v)) v = mn;
    input.style.setProperty('--fill', clamp((v - mn) / (mx - mn) * 100, 0, 100).toFixed(1) + '%');
  }
  function setOut(input, text) { var o = $(input.id + '-val'); if (o) o.textContent = text; }
  function volText(v) { return v <= 0 ? 'Off' : String(Math.round(v * 100)); }
  function segSet(seg, value) {
    var bs = seg.querySelectorAll('button[data-v]'), i;
    for (i = 0; i < bs.length; i++) {
      var on = bs[i].getAttribute('data-v') === value;
      bs[i].setAttribute('aria-checked', on ? 'true' : 'false');
      bs[i].tabIndex = on ? 0 : -1;
    }
  }
  function setRange(input, value, text) {
    if (!input) return;
    var s = String(value);
    if (input.value !== s) input.value = s;
    rangeFill(input);
    setOut(input, text);
  }
  function syncSettingsUI() {
    var st = save.settings;
    each(SET_PANELS, function (p) {
      var snd = $(p + '-sound'), drag = $(p + '-drag'), tap = $(p + '-tap');
      if (snd) snd.checked = !st.muted;
      setRange($(p + '-sfx-vol'), Math.round(st.sfxVolume * 100), volText(st.sfxVolume));
      setRange($(p + '-music-vol'), Math.round(st.musicVolume * 100), volText(st.musicVolume));
      setRange($(p + '-sensitivity'), st.sensitivity, st.sensitivity.toFixed(2) + '\u00d7');
      if (drag) segSet(drag, st.aimInvert ? 'world' : 'follow');
      if (tap) tap.checked = st.tapToScope !== false;
    });
    updateSoundBtn();
  }
  function applyAudio() {
    var st = save.settings;
    syncLegacyFlags(st);
    Audio.setMuted(st.muted);
    Audio.setVolumes(st.sfxVolume, st.musicVolume);
  }
  function updateSoundBtn() {
    if (!E.soundBtn || !save) return;
    var st = save.settings, off = st.muted || st.sfxVolume <= 0;
    E.soundBtn.classList.toggle('muted', off);
    E.soundBtn.classList.toggle('low', !off && st.sfxVolume < 0.45);
    E.soundBtn.setAttribute('aria-pressed', off ? 'true' : 'false');
  }
  function toggleMute() {
    var st = save.settings;
    if (st.muted || st.sfxVolume <= 0) {
      st.muted = false;
      if (st.sfxVolume <= 0) st.sfxVolume = 0.8;
    } else {
      st.muted = true;
    }
    applyAudio(); syncSettingsUI(); persist();
    if (!st.muted) Audio.play('click');
  }
  function bindSettingsPanel(p) {
    var st = function () { return save.settings; };
    var snd = $(p + '-sound'), sfxR = $(p + '-sfx-vol'), musR = $(p + '-music-vol');
    var sens = $(p + '-sensitivity'), drag = $(p + '-drag'), tap = $(p + '-tap');
    if (snd) snd.addEventListener('change', function () {
      st().muted = !snd.checked;
      if (!st().muted && st().sfxVolume <= 0 && st().musicVolume <= 0) st().sfxVolume = 0.8;
      applyAudio(); syncSettingsUI(); persist();
      if (!st().muted) Audio.play('click');
    });
    var vol = function (input, key) {
      if (!input) return;
      var f = function () {
        var v = clamp((parseFloat(input.value) || 0) / 100, 0, 1);
        st()[key] = Math.round(v * 100) / 100;
        if (v > 0 && st().muted) st().muted = false;   // moving a volume up means "I want sound"
        applyAudio(); syncSettingsUI(); persistSoon();
      };
      input.addEventListener('input', f);
      input.addEventListener('change', function () {
        f(); persist();
        if (key === 'sfxVolume') Audio.play('bolt');   // let the player hear the new level
      });
    };
    vol(sfxR, 'sfxVolume');
    vol(musR, 'musicVolume');
    if (sens) {
      var sf = function () {
        var v = clamp(parseFloat(sens.value) || 1, SENS_MIN, SENS_MAX);
        st().sensitivity = Math.round(v * 100) / 100;
        syncSettingsUI(); pushAimOptions(); persistSoon();
      };
      sens.addEventListener('input', sf);
      sens.addEventListener('change', function () { sf(); persist(); });
    }
    if (drag) {
      var pick = function (v, focus) {
        st().aimInvert = v === 'world';
        syncSettingsUI(); pushAimOptions(); persist();
        Audio.play('click');
        if (focus) { var b = drag.querySelector('button[data-v="' + v + '"]'); if (b) b.focus(); }
      };
      drag.addEventListener('click', function (e) {
        var b = e.target && e.target.closest ? e.target.closest('button[data-v]') : null;
        if (b) pick(b.getAttribute('data-v'), false);
      });
      drag.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault(); e.stopPropagation();
          pick(st().aimInvert ? 'follow' : 'world', true);
        }
      });
    }
    if (tap) tap.addEventListener('change', function () {
      st().tapToScope = !!tap.checked;
      syncSettingsUI(); pushAimOptions(); persist();
      Audio.play('click');
    });
  }
  function showSettings() {
    syncSettingsUI();
    showScreen('settings', 'settings-back');
  }
  function resetProgress() {
    Audio.play('click');
    showConfirm({
      title: 'Burn the file?',
      text: 'All money, rifles, upgrades and mission stars will be erased. Settings are kept. This cannot be undone.',
      yes: 'Erase',
      danger: true
    }, function () {
      var keep = save.settings;
      save = defaultSave();
      save.settings = keep;
      persist();
      Story.seen = {};
      Missions.chapter = null;
      menuToast('Progress erased.');
      focusSoon('settings-back');
    });
  }

  /* =====================================================================
   * Portrait hint
   * ===================================================================== */
  var portraitDismissed = false;
  function checkPortrait() {
    if (!E.portrait) return;
    var w = window.innerWidth, h = window.innerHeight;
    var touch = matches('(pointer: coarse)') || ('ontouchstart' in window);
    var p = touch && h > w * 1.05 && Math.min(w, h) < 900;
    E.portrait.hidden = !p || portraitDismissed;
  }

  /* =====================================================================
   * Event wiring
   * ===================================================================== */
  function onClick(el, fn) { if (el) el.addEventListener('click', fn); }
  function bindHold(el, down, up) {
    if (!el) return;
    el.addEventListener('pointerdown', function (e) {
      e.preventDefault(); e.stopPropagation();
      Audio.unlock();
      hideHint();
      el.classList.add('pressed');
      try { el.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
      down(e);
    });
    var end = function (e) {
      e.stopPropagation();
      if (!el.classList.contains('pressed')) return;
      el.classList.remove('pressed');
      if (up) up(e);
    };
    each(['pointerup', 'pointercancel', 'lostpointercapture', 'pointerleave'], function (t) { el.addEventListener(t, end); });
    el.addEventListener('pointermove', function (e) { e.stopPropagation(); });
    el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    el.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); });
  }

  function bindAll() {
    // audio unlock on every gesture type, capture phase so nothing can swallow it (cheap no-op once running)
    var gesture = function () { Audio.unlock(); };
    each(['pointerdown', 'touchstart', 'touchend', 'mousedown', 'click', 'keydown'], function (t) {
      try { document.addEventListener(t, gesture, true); } catch (e) { /* ignore */ }
    });
    document.addEventListener('pointerdown', function () { if (E.hint && !E.hint.hidden) hideHint(); }, true);

    // title
    onClick(E.menuContinue, menuContinue);
    onClick(E.menuMissions, function () { Audio.play('click'); showMissions(); });
    onClick(E.menuArmory, function () { Audio.play('click'); showArmory('title'); });
    onClick(E.menuRange, function () { if (RANGE) { Audio.play('click'); showBriefing(RANGE, 'title'); } });
    onClick(E.menuSettings, function () { Audio.play('click'); showSettings(); });

    // missions
    onClick(E.missionsBack, function () { Audio.play('click'); showTitle(); });

    // story
    onClick(SCREENS.story, function (e) {
      if (e.target && e.target.closest && e.target.closest('#story-skip')) return;
      storyAdvance();
    });
    onClick(E.storySkip, function (e) { e.stopPropagation(); Audio.play('click'); storyEnd(); });

    // briefing
    onClick(E.briefAccept, function () { Audio.play('click'); if (Brief.m) beginPlay(Brief.m); });
    onClick(E.briefArmory, function () { Audio.play('click'); showArmory('briefing'); });
    onClick(E.briefBack, briefBack);

    // results
    onClick(E.resNext, function () { leaveResults('next'); });
    onClick(E.resRetry, function () { leaveResults('retry'); });
    onClick(E.resMissions, function () { leaveResults('missions'); });

    // armory / settings
    onClick(E.armoryBack, armoryBack);
    onClick(E.settingsBack, function () { Audio.play('click'); showTitle(); });
    each(SET_PANELS, bindSettingsPanel);
    onClick(E.setReset, resetProgress);
    onClick(E.briefDossier, function () { if (BriefType.timer) briefTypeDone(); });

    // pause
    onClick(E.pauseResume, function () { Audio.play('click'); hidePause(); });
    onClick(E.pauseRestart, function () {
      Audio.play('click');
      var m = Play.m;
      endPlay();
      if (m) beginPlay(m);
    });
    onClick(E.pauseQuit, function () {
      Audio.play('click');
      endPlay();
      E.canvas.hidden = true;
      showMissions();
    });

    // confirm / error / portrait
    onClick(E.confirmYes, function () { Audio.play('click'); closeConfirm(true); });
    onClick(E.confirmNo, function () { Audio.play('click'); closeConfirm(false); });
    onClick(E.confirm, function (e) { if (e.target === E.confirm) closeConfirm(false); });
    onClick(E.errorClose, closeError);
    onClick(E.portraitDismiss, function () { portraitDismissed = true; checkPortrait(); });

    // HUD controls: pointer events, never start canvas drags
    bindHold(E.fire, function () { coreInput('fire'); });
    bindHold(E.scope, function () { coreInput('toggleScope'); });
    bindHold(E.reload, function () { coreInput('reload'); });
    bindHold(E.zoomIn, function () { coreInput('zoomStep', 1); });
    bindHold(E.zoomOut, function () { coreInput('zoomStep', -1); });
    bindHold(E.breath, function () { coreInput('setBreath', true); }, function () {
      try { if (LW.Core && LW.Core.input && LW.Core.input.setBreath) LW.Core.input.setBreath(false); } catch (e) { /* ignore */ }
    });
    if (E.pauseBtn) {
      E.pauseBtn.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
      E.pauseBtn.addEventListener('click', function (e) { e.stopPropagation(); Audio.play('click'); showPause(); });
    }
    if (E.soundBtn) {
      E.soundBtn.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
      E.soundBtn.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); toggleMute(); });
    }
    if (E.hint) E.hint.addEventListener('pointerdown', function (e) { e.preventDefault(); e.stopPropagation(); hideHint(); });

    // keyboard
    document.addEventListener('keydown', onKeyDown);

    // resize / orientation
    var resizeQueued = false;
    var onResize = function () {
      if (resizeQueued) return;
      resizeQueued = true;
      requestAnimationFrame(function () {
        resizeQueued = false;
        if (Title.on) titleResize();
        if (Story.active && storySize()) storyBuild();
        checkPortrait();
      });
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        if (Play.active && !Play.paused) showPause();
        Audio.suspend();
      } else {
        Audio.resume();
      }
    });

    if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
      document.fonts.ready.then(function () { if (Story.active) storyBuild(); }, function () {});
    }
  }

  function onKeyDown(e) {
    var key = e.key;
    Audio.unlock();
    if (E.error && !E.error.hidden) {
      if ((key === 'Escape' || key === 'Esc') && !E.errorClose.hidden) { e.preventDefault(); closeError(); }
      return;
    }
    if (E.confirm && !E.confirm.hidden) {
      if (key === 'Escape' || key === 'Esc') { e.preventDefault(); closeConfirm(false); }
      return;
    }
    if (Play.active) {
      if (key === 'Escape' || key === 'Esc') {
        if (Play.paused) { e.preventDefault(); hidePause(); }
        else showPause();
      }
      return;
    }
    if (Story.active) {
      if (key === 'Escape' || key === 'Esc') { e.preventDefault(); storyEnd(); return; }
      if (key === ' ' || key === 'Spacebar' || key === 'Enter' || key === 'ArrowRight') {
        if (e.target && e.target.tagName === 'BUTTON') return;
        e.preventDefault();
        storyAdvance();
      }
      return;
    }
    if (current === 'title' && (key === 'ArrowDown' || key === 'ArrowUp')) {
      var items = SCREENS.title.querySelectorAll('.index-item:not([disabled])'), i, at = -1;
      for (i = 0; i < items.length; i++) if (items[i] === document.activeElement) at = i;
      var nx = key === 'ArrowDown' ? at + 1 : at - 1;
      if (nx < 0) nx = items.length - 1;
      if (nx >= items.length) nx = 0;
      if (items[nx]) { e.preventDefault(); items[nx].focus(); }
      return;
    }
    if (key === 'Escape' || key === 'Esc') {
      if (current === 'missions') { Audio.play('click'); showTitle(); }
      else if (current === 'briefing') briefBack();
      else if (current === 'armory') armoryBack();
      else if (current === 'settings') { Audio.play('click'); showTitle(); }
      else if (current === 'results') leaveResults('missions');
    }
  }

  /* =====================================================================
   * Boot
   * ===================================================================== */
  function boot() {
    var missing = grabElements();
    if (missing.length) {
      showError('Page incomplete', 'These page elements are missing: ' + missing.join(', '), false);
      return;
    }
    if (!LW.DATA || !arr(LW.DATA.missions).length) {
      showError('Dossier missing', 'The mission data (js/data.js, LW.DATA) did not load, so there is nothing to play.\nReload the page. If it keeps happening, the file is missing or has an error.', false);
      return;
    }
    indexData();
    save = loadSave();
    persist();
    applyAudio();
    syncSettingsUI();
    if (E.storyText) E.storyText.setAttribute('aria-live', 'polite');
    bindAll();
    showTitle();
    checkPortrait();

    var lacking = [];
    if (!LW.Core || typeof LW.Core.start !== 'function') lacking.push('LW.Core (js/core.js)');
    if (!LW.Render) lacking.push('LW.Render (js/render.js)');
    if (lacking.length) {
      showError('Rifle not assembled', 'Menus work, but missions cannot start until these load:\n' + lacking.join('\n'), true);
    }

    try {
      if (window.claude && window.claude.hot && typeof window.claude.hot.snapshot === 'function') {
        window.claude.hot.snapshot(function () { return save; });
      }
    } catch (e) { /* optional */ }

    LW.UI = {
      buildLoadout: buildLoadout,
      getSave: function () { return save; },
      showTitle: showTitle
    };
  }

  function safeBoot() {
    try { boot(); }
    catch (e) {
      showError('Something broke', 'The game failed to start.\n' + (e && e.message ? e.message : String(e)), false);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', safeBoot);
  else safeBoot();
})(window.LW);
