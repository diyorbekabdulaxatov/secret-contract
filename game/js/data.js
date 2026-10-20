// Silent Contract: game data (story panels, chapters, weapons, gear, missions).
// Pure data. See CONTRACT.md for the schema and SCENARIO.md for the story.
// Coordinates: world height 1000, y grows downward, a person at dist d metres is 3600/d units tall.
window.LW = window.LW || {};
(function (LW) {
  'use strict';

  // ---------- small builders (keep the mission tables readable) ----------

  function panel(bg, figure, speaker, text) {
    return { bg: bg, figure: figure, speaker: speaker, text: text };
  }
  function mara(bg, text) { return panel(bg, 'mara', 'MARA', text); }

  function msg(t, text) { return { t: t, text: 'MARA: ' + text }; }

  function bld(x, y, w, h, dist, style, lights, roof, sign) {
    var o = { type: 'building', x: x, y: y, w: w, h: h, dist: dist, style: style, lights: lights, roof: roof };
    if (sign) { o.sign = sign; }
    return o;
  }
  function wall(x, y, w, h, dist) { return { type: 'wall', x: x, y: y, w: w, h: h, dist: dist }; }
  function ground(y, dist, kind) { return { type: 'ground', y: y, dist: dist, kind: kind }; }
  function water(y, dist) { return { type: 'water', y: y, dist: dist }; }
  function car(x, y, dist, color, kind) { return { type: 'car', x: x, y: y, dist: dist, color: color, kind: kind }; }
  function lamp(x, y, dist) { return { type: 'lamp', x: x, y: y, dist: dist }; }
  function crane(x, y, dist) { return { type: 'crane', x: x, y: y, dist: dist }; }
  function board(x, y, w, h, dist, text) { return { type: 'billboard', x: x, y: y, w: w, h: h, dist: dist, text: text }; }
  function box(x, y, w, h, dist, color) { return { type: 'container', x: x, y: y, w: w, h: h, dist: dist, color: color }; }
  function boat(x, y, w, dist) { return { type: 'boat', x: x, y: y, w: w, dist: dist }; }

  function look(coat, skin, hair, hat, tie, build, item) {
    return { coat: coat, skin: skin, hair: hair, hat: hat, tie: tie, build: build, item: item, dummy: false };
  }
  var DUMMY = { coat: '#d8cfb4', skin: '#d8cfb4', hair: '#d8cfb4', hat: 'none', tie: null, build: 'normal', item: 'none', dummy: true };

  // Entity with contract defaults; opt overrides (path, speed, loop, window, fleePath, facing, hp, escape).
  function person(id, role, name, x, y, dist, lk, opt) {
    var e = { id: id, role: role, name: name, x: x, y: y, dist: dist, look: lk,
      window: false, speed: 1.3, loop: false, escape: false, facing: 1 };
    var k;
    if (opt) {
      for (k in opt) {
        if (opt.hasOwnProperty(k)) { e[k] = opt[k]; }
      }
    }
    return e;
  }

  // Skin and hair tones.
  var SK1 = '#f0cfb0', SK2 = '#e0b896', SK3 = '#c8a27c', SK4 = '#a8754f', SK5 = '#8d5a3b';
  var HB = '#1a1a1a', HD = '#2a2420', HBR = '#5a3b22', HG = '#8a8a8a', HS = '#c8c8c8', HF = '#b08850';

  // ---------- story ----------

  var intro = [
    panel('black', 'none', '', "Port Varenne. It has rained for eleven years. Nobody remembers who started paying for it."),
    panel('rain-street', 'none', '', "The Halvard Syndicate owns the docks, the courts and the weather report."),
    panel('apartment', 'crane', '', "Elias Crane came home from Kessel Bridge with a rifle, a medal and no voice."),
    mara('phone', "You don't have to talk, Crane. You only have to listen. And aim."),
    mara('phone', "I have names. Halvard's men. Each one pays. Together they pay for him."),
    panel('rooftop', 'crane', '', "He never answered. He just started climbing.")
  ];

  var ending = [
    panel('black', 'none', '', "Augustin Halvard died at 02:14, between one word and the next."),
    mara('penthouse', "Don't look at me like that, Elias. I can feel it through the glass."),
    mara('penthouse', "Every name you crossed out was his. Every name left in the ledger is mine now."),
    panel('penthouse', 'mara', '', "She did not leave the penthouse. She sat down in his chair and poured one glass."),
    panel('office', 'detective', '', "At dawn a parcel reached Inspector Brandt's desk. The Halvard ledger. All of it."),
    panel('office', 'detective', '', "The last page was written in a woman's hand. It began with M."),
    panel('phone', 'mara', '', "At noon Mara's phone rang. Nobody spoke. Nobody ever did. She knew exactly who it was.")
  ];

  var chapters = [
    { id: 1, title: 'Rain Ledger', subtitle: "Every debt in Port Varenne is written in rain." },
    { id: 2, title: 'Glass Saints', subtitle: "The cleaner the window, the dirtier the hand." },
    { id: 3, title: "The Banker's Due", subtitle: "Every account closes." }
  ];

  // ---------- armory ----------

  var weapons = [
    { id: 'kestrel', name: 'Kestrel .308', desc: "Your old service rifle, rebarrelled. Honest, loud and forgiving.",
      price: 0, damage: 70, velocity: 780, dropMul: 1.0, swayMul: 1.0,
      magazine: 5, reloadTime: 2.2, boltTime: 1.0, suppressed: false },
    { id: 'heron', name: 'Heron 7mm Magnum', desc: "Faster round, flatter arc. A body shot usually ends the argument.",
      price: 1200, damage: 100, velocity: 840, dropMul: 0.85, swayMul: 0.95,
      magazine: 5, reloadTime: 2.0, boltTime: 0.9, suppressed: false },
    { id: 'nightjar', name: 'Nightjar SD', desc: "Integrally suppressed precision rifle. It whispers, and the whisper carries.",
      price: 2600, damage: 140, velocity: 880, dropMul: 0.75, swayMul: 0.85,
      magazine: 6, reloadTime: 2.0, boltTime: 0.8, suppressed: true },
    { id: 'albatross', name: 'Albatross .338', desc: "Long-range magnum. Stops armour, ignores most wind, wakes the whole city.",
      price: 4800, damage: 200, velocity: 950, dropMul: 0.6, swayMul: 0.8,
      magazine: 5, reloadTime: 2.4, boltTime: 1.1, suppressed: false }
  ];

  var gear = [
    { id: 'scope', name: 'Scope', desc: "Maximum magnification. More zoom, smaller targets look bigger.",
      levels: [
        { price: 0, value: 3, label: '3x' },
        { price: 350, value: 4.5, label: '4.5x' },
        { price: 800, value: 6, label: '6x' },
        { price: 1350, value: 8, label: '8x' }
      ] },
    { id: 'stock', name: 'Stock', desc: "Steadier cheek weld. Reduces scope sway.",
      levels: [
        { price: 0, value: 1, label: 'Factory' },
        { price: 300, value: 0.8, label: 'Padded' },
        { price: 700, value: 0.65, label: 'Match' },
        { price: 1300, value: 0.5, label: 'Bench-grade' }
      ] },
    { id: 'mag', name: 'Magazine', desc: "Extra rounds before you have to reload.",
      levels: [
        { price: 0, value: 0, label: 'Standard' },
        { price: 350, value: 1, label: '+1 round' },
        { price: 900, value: 2, label: '+2 rounds' }
      ] },
    { id: 'suppressor', name: 'Suppressor', desc: "Muffles any rifle. Shots only alert people close to the impact.",
      levels: [
        { price: 0, value: false, label: 'None' },
        { price: 900, value: true, label: 'Fitted' }
      ] },
    { id: 'computer', name: 'Ballistic computer', desc: "Shows the predicted impact point in the scope, wind and drop included.",
      levels: [
        { price: 0, value: false, label: 'None' },
        { price: 1800, value: true, label: 'Installed' }
      ] }
  ];

  // ---------- missions ----------

  var missions = [];

  // ===== RANGE (chapter 0) =====
  missions.push({
    id: 'range', chapter: 0, practice: true, title: 'Cold Range', location: 'Varenne Rifle Club, 06:30',
    briefing: "The club opens at eight. Until then the range is yours. Ten paper targets from eighty to four hundred metres. Learn how far the bullet falls before you need to know it.",
    objectives: ['Knock down all ten paper targets', 'Do not shoot the range keeper'],
    intel: [
      { name: 'Paper targets', text: "On stands at 80, 120, 160, 200, 250, 300, 350 and 400 m. The boards on the left mark the distance." },
      { name: 'Teodor Pell', text: "Range keeper. Brown coat, by his hut on the right. Makes the only decent coffee in the city." }
    ],
    storyBefore: [
      panel('rooftop', 'crane', '', "The Varenne Rifle Club at dawn. Paper does not bleed, and it does not lie.")
    ],
    storyAfter: [],
    reward: 120,
    time: 'dawn',
    world: { width: 3000 },
    start: { x: 1500, y: 600 },
    wind: { base: 1, gust: 0.8 },
    timeLimit: 0,
    rules: { noAlarm: false, noCivilianKills: true, markTargets: true },
    failText: { escape: 'A target walked off. Impressive.', attacker: 'Something went very wrong.', alarm: 'The club woke up.', time: 'Time ran out.' },
    messages: [
      msg(1, "Morning, Crane. The range is yours until the club opens."),
      msg(6, "Ten paper men, from eighty to four hundred metres. The boards on the left tell you the range."),
      msg(12, "Watch the drop grow. At eighty it is nothing. At four hundred it is more than a whole man."),
      msg(20, "Wind is light, one metre. Even so, it nudges you right at long range."),
      msg(28, "And don't shoot Teodor. He makes the only decent coffee in Port Varenne.")
    ],
    structures: [
      wall(0, 560, 3000, 45, 420),
      ground(605, 400, 'park'),
      board(150, 580, 45, 20, 400, '400 M'),
      ground(616, 350, 'park'),
      ground(630, 300, 'park'),
      ground(650, 250, 'park'),
      board(150, 615, 60, 28, 250, '250 M'),
      ground(676, 200, 'park'),
      ground(712, 160, 'park'),
      bld(2620, 650, 260, 125, 130, 'brick', 0.5, 'antenna', 'RANGE'),
      ground(770, 120, 'park'),
      board(150, 720, 90, 40, 120, '120 M'),
      ground(880, 80, 'park'),
      wall(0, 965, 3000, 35, 60)
    ],
    entities: [
      person('d1', 'target', 'Target 80 m', 700, 930, 80, DUMMY),
      person('d2', 'target', 'Target 120 m', 1900, 820, 120, DUMMY),
      person('d3', 'target', 'Target 120 m', 400, 830, 120, DUMMY),
      person('d4', 'target', 'Target 160 m', 1250, 740, 160, DUMMY),
      person('d5', 'target', 'Target 200 m', 2300, 700, 200, DUMMY),
      person('d6', 'target', 'Target 200 m', 900, 698, 200, DUMMY),
      person('d7', 'target', 'Target 250 m', 1650, 668, 250, DUMMY),
      person('d8', 'target', 'Target 300 m', 2450, 648, 300, DUMMY),
      person('d9', 'target', 'Target 350 m', 600, 630, 350, DUMMY),
      person('d10', 'target', 'Target 400 m', 2000, 615, 400, DUMMY),
      person('teodor', 'ally', 'Teodor Pell', 2560, 800, 120, look('#5a4632', SK3, HG, 'cap', null, 'heavy', 'none'), { facing: -1 })
    ],
    spawns: []
  });

  // ===== CHAPTER 1: RAIN LEDGER =====

  // m1: tutorial, static target at 125 m, no wind.
  missions.push({
    id: 'm1', chapter: 1, title: 'Wet Paint', location: 'Corso Street, 23:40',
    briefing: "Pietro Sanna takes bets for the Halvard Syndicate and collects with a hammer. Every night he smokes outside the Lucky 7. You are on the roof across the street. Make it quiet, make it once.",
    objectives: ['Eliminate Pietro Sanna', 'Do not harm civilians'],
    intel: [
      { name: 'Pietro Sanna', text: "Grey coat, red tie, fedora. Smokes by the door of the Lucky 7 bar." }
    ],
    storyBefore: [
      panel('rain-street', 'none', '', "Corso Street, 23:40. The rain has opinions about everyone."),
      mara('phone', "First name on the list, Crane. Pietro Sanna. He takes bets for the Banker and breaks fingers when they lose."),
      mara('phone', "Do this clean and there's money in a locker at the station. Do it messy and there's nothing anywhere."),
      panel('rooftop', 'crane', '', "Crane unpacked the rifle the way other men pray.")
    ],
    storyAfter: [
      panel('bar', 'thug', '', "Sanna dropped his last cigarette. The jukebox kept playing for nobody."),
      mara('phone', "One finger off the Banker's hand. Nine to go.")
    ],
    reward: 300,
    time: 'night',
    world: { width: 2600 },
    start: { x: 1100, y: 600 },
    wind: { base: 0, gust: 0 },
    timeLimit: 0,
    rules: { noAlarm: false, noCivilianKills: true, markTargets: true },
    failText: { escape: 'Sanna walked away into the rain.', attacker: 'Something went very wrong.', alarm: 'The street woke up and Sanna ran.', time: 'Time ran out.' },
    messages: [
      msg(1, "Evening, Crane. The bar with the red seven. Grey coat, red tie, smoking by the door. That's Sanna."),
      msg(7, "Drag to look around. Find him with your naked eye first."),
      msg(13, "Now the scope. Tap SCOPE, or right-click. Plus and minus change the zoom."),
      msg(19, "Your hands drift in the glass. Hold BREATH to steady the reticle, but only for a few seconds."),
      msg(26, "At this range the bullet barely drops. Past two hundred metres it falls, and the hash marks are your ruler."),
      msg(33, "A head shot is final. The chest may need two. Squeeze FIRE when you are ready."),
      msg(45, "Take your time. He likes that cigarette.")
    ],
    structures: [
      bld(120, 330, 260, 470, 260, 'concrete', 0.3, 'antenna'),
      bld(560, 380, 280, 420, 260, 'brick', 0.3, 'flat'),
      bld(1100, 320, 200, 480, 260, 'concrete', 0.25, 'water-tower'),
      bld(1380, 300, 240, 500, 260, 'glass', 0.45, 'antenna'),
      board(1370, 210, 260, 80, 260, 'HALVARD TRUST'),
      bld(1620, 350, 240, 450, 260, 'deco', 0.3, 'flat'),
      bld(2080, 360, 320, 440, 260, 'deco', 0.3, 'water-tower'),
      bld(100, 420, 480, 380, 130, 'brick', 0.5, 'water-tower'),
      bld(620, 540, 520, 260, 130, 'brick', 0.6, 'neon', 'LUCKY 7'),
      bld(1200, 470, 420, 330, 130, 'concrete', 0.35, 'flat'),
      bld(1760, 380, 600, 420, 130, 'deco', 0.4, 'antenna', 'PENSIONE'),
      ground(790, 125, 'street'),
      lamp(420, 800, 125),
      lamp(1180, 800, 125),
      lamp(1960, 800, 125),
      car(1500, 915, 125, '#2e3a46', 'sedan'),
      car(2280, 880, 125, '#4a3b30', 'van'),
      wall(0, 950, 2600, 50, 60)
    ],
    entities: [
      person('sanna', 'target', 'Pietro Sanna', 880, 835, 125, look('#5b5f66', SK3, HD, 'fedora', '#a3242b', 'normal', 'cigarette'), { facing: -1 }),
      person('c1', 'civilian', 'Woman with umbrella', 1300, 860, 125, look('#6b2a3a', SK1, HB, 'none', null, 'slim', 'umbrella'),
        { path: [{ x: 1300, y: 860, wait: 2 }, { x: 2150, y: 860, wait: 3 }], speed: 1.0, loop: true }),
      person('c2', 'civilian', 'Tenant', 300, 760, 130, look('#3a3a3a', SK2, HBR, 'none', null, 'normal', 'none'), { window: true }),
      person('c3', 'civilian', 'Bartender', 1020, 772, 130, look('#d8d0c0', SK4, HB, 'none', '#1a1a1a', 'heavy', 'none'), { window: true, facing: -1 }),
      person('c4', 'civilian', 'Drunk', 1990, 830, 125, look('#4a4030', SK3, HG, 'cap', null, 'heavy', 'none'), { facing: -1 }),
      person('c5', 'civilian', 'Night walker', 200, 900, 125, look('#2a3038', SK5, HB, 'fedora', null, 'normal', 'none'),
        { path: [{ x: 200, y: 900, wait: 1 }, { x: 700, y: 900, wait: 4 }], speed: 1.2, loop: true })
    ],
    spawns: []
  });

  // m2: rooftop target pacing slowly at 190 m, light wind, two guards.
  missions.push({
    id: 'm2', chapter: 1, title: 'Laundry Day', location: 'The Lavanderia, Via Sottile, 05:50',
    briefing: "Tomas Rekker washes the syndicate's money through a chain of laundries. He takes his calls on the roof of the Lavanderia because he believes the rain cannot be wiretapped. His minder stays close, his driver waits on the next roof.",
    objectives: ['Eliminate Tomas Rekker', 'Do not let him reach the stairwell', 'Do not harm civilians'],
    intel: [
      { name: 'Tomas Rekker', text: "Tan coat, blue tie, black umbrella. Paces the Lavanderia roof while he talks." },
      { name: 'Minder and driver', text: "Two of Halvard's men. If either raises the alarm, Rekker runs for the stairwell door on the right of the roof." }
    ],
    storyBefore: [
      panel('apartment', 'crane', '', "Crane slept two hours. He dreamed of a bridge and a voice counting wind."),
      mara('phone', "Tomas Rekker. Every dirty coin in Port Varenne passes through his laundry and comes out smelling of lavender."),
      mara('phone', "He takes his calls on the roof because he thinks the rain can't be wiretapped."),
      panel('rooftop', 'crane', '', "The rain could not be wiretapped. It could be waited out.")
    ],
    storyAfter: [
      panel('rooftop', 'none', '', "The umbrella rolled off the roof and opened again in the street, as if it had somewhere to be."),
      mara('phone', "Halvard will hear about Rekker by breakfast. Let him choke on it.")
    ],
    reward: 380,
    time: 'rain',
    world: { width: 2800 },
    start: { x: 1300, y: 550 },
    wind: { base: 1.2, gust: 0.6 },
    timeLimit: 0,
    rules: { noAlarm: false, noCivilianKills: true, markTargets: true },
    failText: { escape: 'Rekker made the stairwell. He will not use that roof again.', attacker: 'Something went very wrong.', alarm: 'The alarm was raised.', time: 'Time ran out.' },
    messages: [
      msg(2, "Rekker is on the Lavanderia roof. Umbrella, blue tie, pacing while he talks to his bankers."),
      msg(9, "His minder is at the chimney, his driver on the next roof. If either one panics, Rekker bolts for the stairwell."),
      msg(16, "There's a breeze from the west. Watch the wind arrow: it pushes your round to the right."),
      msg(24, "Hundred and ninety metres. Hold a hair high and a hair left."),
      msg(34, "Wait for him to stop. Stillness is a gift.")
    ],
    structures: [
      bld(80, 300, 300, 420, 330, 'concrete', 0.25, 'antenna'),
      bld(1700, 250, 220, 470, 330, 'glass', 0.4, 'antenna'),
      board(1690, 170, 240, 70, 330, 'SOAP OF SAINTS'),
      bld(2300, 330, 340, 390, 330, 'deco', 0.3, 'water-tower'),
      bld(420, 580, 520, 300, 200, 'brick', 0.4, 'flat'),
      bld(1700, 600, 560, 280, 200, 'concrete', 0.35, 'water-tower'),
      bld(1000, 540, 640, 340, 190, 'brick', 0.45, 'flat', 'LAVANDERIA'),
      wall(1560, 505, 60, 35, 190),
      wall(1100, 515, 40, 25, 190),
      ground(860, 120, 'street'),
      lamp(600, 870, 120),
      lamp(1500, 870, 120),
      lamp(2400, 870, 120),
      car(900, 940, 120, '#3b3f46', 'sedan'),
      car(2100, 935, 120, '#5a2e2e', 'van'),
      bld(0, 360, 300, 500, 110, 'brick', 0.5, 'water-tower'),
      bld(2500, 420, 300, 440, 110, 'concrete', 0.4, 'antenna'),
      wall(0, 955, 2800, 45, 60)
    ],
    entities: [
      person('rekker', 'target', 'Tomas Rekker', 1180, 540, 190, look('#7a6a52', SK2, HBR, 'none', '#2b4a7a', 'heavy', 'umbrella'),
        { path: [{ x: 1180, y: 540, wait: 4 }, { x: 1460, y: 540, wait: 5 }], speed: 0.8, loop: true, fleePath: [{ x: 1590, y: 540 }] }),
      person('minder', 'guard', 'Minder', 1060, 540, 190, look('#22252b', SK3, HB, 'cap', null, 'heavy', 'none')),
      person('driver', 'guard', 'Driver', 1850, 600, 200, look('#30343a', SK5, HB, 'none', null, 'normal', 'cigarette'), { facing: -1 }),
      person('laundry', 'civilian', 'Laundry woman', 560, 580, 200, look('#7a5a6a', SK1, HBR, 'none', null, 'slim', 'none'),
        { path: [{ x: 560, y: 580, wait: 3 }, { x: 820, y: 580, wait: 3 }], speed: 0.7, loop: true }),
      person('tenant', 'civilian', 'Tenant', 1300, 820, 190, look('#4a4a50', SK3, HD, 'none', null, 'normal', 'none'), { window: true }),
      person('walker1', 'civilian', 'Pedestrian', 350, 900, 120, look('#3a2a2a', SK2, HD, 'none', null, 'slim', 'umbrella'),
        { path: [{ x: 350, y: 900, wait: 2 }, { x: 1300, y: 900, wait: 2 }], speed: 1.1, loop: true }),
      person('walker2', 'civilian', 'Pedestrian', 1700, 890, 120, look('#2a3a4a', SK4, HB, 'fedora', null, 'normal', 'umbrella'),
        { path: [{ x: 1700, y: 890, wait: 1 }, { x: 2300, y: 890, wait: 3 }], speed: 1.2, loop: true })
    ],
    spawns: []
  });

  // m3: two targets on a foggy dock at 235 m.
  missions.push({
    id: 'm3', chapter: 1, title: 'Dockside Arithmetic', location: 'Pier 9, 05:30',
    briefing: "Gus Malloy unloads Halvard's crates at Pier 9. Hendrik Szabo stamps them clean at customs. Tonight they meet in the container yard to count. You are across the harbour water on the old grain pier.",
    objectives: ['Eliminate Gus Malloy', 'Eliminate Hendrik Szabo', 'Do not harm civilians'],
    intel: [
      { name: 'Gus Malloy', text: "Big man, green work jacket, cap. Walks between the container stacks." },
      { name: 'Hendrik Szabo', text: "Thin, grey hair, fedora, dark red tie, briefcase. Waits near the Pier 9 warehouse." },
      { name: 'Guards', text: "Szabo's driver and a dock patrol. After the first shot the survivor runs for the warehouse door." }
    ],
    storyBefore: [
      panel('harbor', 'none', '', "Pier 9. The fog came in off the water and sat down like it owned the place."),
      mara('phone', "Gus Malloy unloads Halvard's crates. Hendrik Szabo stamps them clean. Tonight they meet to count."),
      mara('phone', "Two men, one shot each. If you need a third, you've already lost one of them."),
      panel('warehouse', 'thug', '', "Somewhere a radio played an old song about a sailor who never came home.")
    ],
    storyAfter: [
      panel('harbor', 'none', '', "The customs stamp went into the water with Szabo. The fog kept the paperwork."),
      mara('car', "You're good, Crane. Better than they told me. That worries me a little.")
    ],
    reward: 460,
    time: 'fog',
    world: { width: 3000 },
    start: { x: 1400, y: 650 },
    wind: { base: 1.5, gust: 1 },
    timeLimit: 0,
    rules: { noAlarm: false, noCivilianKills: true, markTargets: true },
    failText: { escape: 'One of them reached the warehouse and vanished into the fog.', attacker: 'Something went very wrong.', alarm: 'The dock alarm went off.', time: 'Time ran out.' },
    messages: [
      msg(2, "Pier 9. Malloy is the big one in the cap. Szabo is waiting by the warehouse with his briefcase."),
      msg(9, "Two names, one meeting. The fog lies about distance, so trust the rangefinder, not your eyes."),
      msg(16, "Once the first one drops, the guards start shouting and the other runs for the warehouse. You'll have seconds."),
      msg(25, "Two hundred and thirty-five metres. Hold a little high now. Use the hash marks."),
      msg(40, "Breathe. Then don't.")
    ],
    structures: [
      bld(150, 470, 260, 230, 520, 'concrete', 0.2, 'antenna'),
      bld(2500, 440, 240, 260, 520, 'deco', 0.25, 'flat'),
      crane(620, 700, 320),
      crane(2350, 700, 320),
      bld(1820, 470, 560, 230, 260, 'brick', 0.3, 'flat', 'PIER 9'),
      box(900, 630, 210, 70, 240, '#7a2e24'),
      box(1120, 630, 210, 70, 240, '#2e4a5a'),
      box(1000, 560, 210, 70, 240, '#8a6a2a'),
      box(1450, 630, 210, 70, 240, '#3a5a3a'),
      ground(700, 235, 'dock'),
      lamp(1350, 712, 235),
      lamp(2480, 712, 235),
      water(770, 150),
      boat(400, 820, 260, 150),
      boat(2650, 830, 220, 150),
      ground(940, 70, 'dock')
    ],
    entities: [
      person('malloy', 'target', 'Gus Malloy', 1000, 735, 235, look('#3f4a3a', SK3, HBR, 'cap', null, 'heavy', 'none'),
        { path: [{ x: 1000, y: 735, wait: 4 }, { x: 1350, y: 735, wait: 3 }], speed: 0.9, loop: true, fleePath: [{ x: 1950, y: 735 }] }),
      person('szabo', 'target', 'Hendrik Szabo', 1600, 728, 235, look('#2c2c34', SK1, HG, 'fedora', '#7a1f1f', 'slim', 'briefcase'),
        { facing: -1, fleePath: [{ x: 2050, y: 728 }] }),
      person('driver', 'guard', 'Driver', 1720, 740, 235, look('#22252b', SK5, HB, 'cap', null, 'heavy', 'none'), { facing: -1 }),
      person('patrol', 'guard', 'Dock patrol', 2000, 732, 235, look('#2a3038', SK3, HD, 'hood', null, 'normal', 'rifle'),
        { path: [{ x: 2000, y: 732, wait: 3 }, { x: 2350, y: 732, wait: 3 }], speed: 1.0, loop: true }),
      person('docker', 'civilian', 'Dock worker', 760, 745, 235, look('#6a4a2a', SK4, HB, 'cap', null, 'heavy', 'none'),
        { path: [{ x: 760, y: 745, wait: 5 }, { x: 880, y: 745, wait: 5 }], speed: 0.7, loop: true }),
      person('watchman', 'civilian', 'Night watchman', 2200, 680, 260, look('#3a3a2a', SK2, HG, 'cap', null, 'normal', 'none'), { window: true, facing: -1 })
    ],
    spawns: []
  });

  // m4: target in a hotel window at 250 m, guard on the balcony, dusk.
  missions.push({
    id: 'm4', chapter: 1, title: 'The Meridian', location: 'Hotel Meridian, Boulevard Ostre, 19:20',
    briefing: "Councilman Lionel Ashby votes the way Halvard pays. On Thursdays he stays in a suite at the Hotel Meridian and leaves the curtains open. A bodyguard watches from the balcony below, his driver waits by the limousine.",
    objectives: ['Eliminate Councilman Ashby', 'Do not harm civilians'],
    intel: [
      { name: 'Lionel Ashby', text: "Grey hair, navy jacket, gold tie. Stands in his lit suite window, fourth floor." },
      { name: 'The escort', text: "Burgundy dress, in the window to his left. She is not part of the contract." },
      { name: 'Bodyguard', text: "On the balcony under the suite. If he raises the alarm, Ashby steps back from the glass for good." }
    ],
    storyBefore: [
      panel('rain-street', 'none', '', "The Hotel Meridian. Gold doors, red carpet, a doorman who never sees anything."),
      mara('phone', "Councilman Lionel Ashby. He votes the way Halvard pays. Thursdays he stays in suite 4B."),
      mara('phone', "The woman with him is a professional too. Leave her out of it."),
      panel('rooftop', 'crane', '', "Dusk is a good liar. It makes everyone look innocent.")
    ],
    storyAfter: [
      panel('office', 'detective', '', "Inspector Ilse Brandt, Homicide. Five dead men in two weeks, all from the same family tree."),
      panel('office', 'detective', '', "Brandt: 'Somebody is pruning the Halvard Syndicate. Or somebody is pruning it for him.'"),
      mara('phone', "There's a detective sniffing at our trail. Ignore her. The next names are bigger.")
    ],
    reward: 550,
    time: 'dusk',
    world: { width: 3000 },
    start: { x: 1300, y: 650 },
    wind: { base: 2, gust: 0.8 },
    timeLimit: 0,
    rules: { noAlarm: false, noCivilianKills: true, markTargets: true },
    failText: { escape: 'Ashby left the window and the hotel locked down.', attacker: 'Something went very wrong.', alarm: 'The bodyguard raised the alarm.', time: 'Time ran out.' },
    messages: [
      msg(2, "Councilman Ashby, suite on the fourth floor. Grey hair, gold tie."),
      msg(9, "The woman in the next window is with him. She is not on the list."),
      msg(16, "Two hundred and fifty metres. The drop is real now. Aim about one hash mark high."),
      msg(24, "His bodyguard is on the balcony below. Take the councilman first, or he'll be on the floor behind the bed."),
      msg(35, "Dusk is short. Make it count.")
    ],
    structures: [
      bld(100, 380, 260, 440, 420, 'glass', 0.35, 'antenna'),
      bld(1900, 300, 200, 520, 420, 'glass', 0.4, 'antenna'),
      board(1880, 220, 240, 70, 420, 'VOTE ASHBY'),
      bld(2550, 410, 300, 410, 420, 'concrete', 0.3, 'water-tower'),
      bld(520, 470, 460, 350, 255, 'brick', 0.4, 'water-tower'),
      bld(1640, 420, 420, 400, 255, 'concrete', 0.35, 'flat'),
      bld(1050, 300, 520, 520, 250, 'deco', 0.55, 'neon', 'HOTEL MERIDIAN'),
      wall(1300, 690, 140, 10, 248),
      ground(820, 160, 'street'),
      lamp(400, 830, 160),
      lamp(1200, 830, 160),
      lamp(2000, 830, 160),
      lamp(2700, 830, 160),
      car(800, 920, 160, '#1e2a36', 'sedan'),
      car(1320, 915, 160, '#111111', 'sedan'),
      car(2300, 925, 160, '#5a5040', 'van'),
      wall(0, 955, 3000, 45, 60)
    ],
    entities: [
      person('ashby', 'target', 'Councilman Lionel Ashby', 1360, 680, 250, look('#22283a', SK1, HG, 'none', '#c9a227', 'heavy', 'none'),
        { window: true, facing: -1, fleePath: [{ x: 1110, y: 680 }] }),
      person('escort', 'civilian', 'Escort', 1180, 700, 250, look('#7a1e3a', SK2, HB, 'none', null, 'slim', 'none'), { window: true }),
      person('guest', 'civilian', 'Hotel guest', 1500, 760, 250, look('#d8d0c0', SK3, HBR, 'none', '#2a2a2a', 'normal', 'phone'), { window: true, facing: -1 }),
      person('bodyguard', 'guard', 'Bodyguard', 1400, 690, 248, look('#1c1c22', SK5, HB, 'none', null, 'heavy', 'none'), { facing: -1 }),
      person('chauffeur', 'guard', 'Chauffeur', 1400, 860, 160, look('#15151a', SK3, HD, 'cap', null, 'normal', 'none'), { facing: -1 }),
      person('doorman', 'civilian', 'Doorman', 1250, 850, 160, look('#5a1e1e', SK4, HB, 'cap', null, 'normal', 'none')),
      person('walker', 'civilian', 'Passer-by', 300, 870, 160, look('#3a3a40', SK2, HBR, 'fedora', null, 'normal', 'umbrella'),
        { path: [{ x: 300, y: 870, wait: 2 }, { x: 1000, y: 870, wait: 2 }], speed: 1.2, loop: true }),
      person('neighbour', 'civilian', 'Neighbour', 700, 760, 255, look('#4a4a50', SK3, HD, 'none', null, 'normal', 'none'), { window: true })
    ],
    spawns: []
  });

  // ===== CHAPTER 2: GLASS SAINTS =====

  // m5: walking courier on a canal quay at 260 m.
  missions.push({
    id: 'm5', chapter: 2, title: 'Canal Market', location: 'Canal Market, Quai Luna, 22:15',
    briefing: "Dario Fenn carries Halvard's takings from the Casino Luna to the counting house, on foot, through the night market. Same route every night, a bodyguard one step behind. He stops at the stalls. Lead him while he walks, or wait for him to stop.",
    objectives: ['Eliminate Dario Fenn', 'Do not harm civilians'],
    intel: [
      { name: 'Dario Fenn', text: "Camel coat, fedora, briefcase. Walks the quay from stall to stall." },
      { name: 'The shadow', text: "Heavy man in black, a few steps behind Fenn. On an alarm Fenn runs for the alley on the far left." }
    ],
    storyBefore: [
      panel('black', 'none', '', "Two weeks later. The rain had learned Crane's name."),
      panel('rain-street', 'detective', '', "Brandt left a card under his door. No message. Just a phone number and a drawing of a crane."),
      mara('phone', "Don't call her. Detectives are like stray cats. Feed one and she never leaves."),
      mara('phone', "Dario Fenn walks Halvard's money from the Casino Luna to the counting house. Every night. Same route."),
      panel('rooftop', 'crane', '', "Moving targets. Crane had done this before, in a country where the rain was sand.")
    ],
    storyAfter: [
      panel('rain-street', 'none', '', "The briefcase burst open on the stones. It was full of receipts, not cash."),
      mara('phone', "Receipts? Doesn't matter. He's off the board.")
    ],
    reward: 650,
    time: 'night',
    world: { width: 3200 },
    start: { x: 1500, y: 650 },
    wind: { base: 2.5, gust: 1.5 },
    timeLimit: 0,
    rules: { noAlarm: false, noCivilianKills: true, markTargets: true },
    failText: { escape: 'Fenn disappeared into the alleys.', attacker: 'Something went very wrong.', alarm: 'His shadow raised the alarm.', time: 'Time ran out.' },
    messages: [
      msg(2, "Fenn is on the quay. Camel coat, fedora, briefcase. The big man behind him is his shadow."),
      msg(9, "He's moving. Lead him: aim ahead of him in the direction he walks and let him walk into the round."),
      msg(17, "Two hundred and sixty metres, and the wind off the canal gusts. Watch the arrow."),
      msg(27, "He stops at the stalls. That's your window."),
      msg(40, "If the shadow sees you, Fenn runs for the alley on the left.")
    ],
    structures: [
      bld(200, 380, 260, 310, 520, 'deco', 0.3, 'antenna'),
      bld(2700, 360, 240, 330, 520, 'glass', 0.35, 'antenna'),
      bld(500, 420, 380, 270, 280, 'brick', 0.5, 'flat'),
      bld(900, 380, 360, 310, 280, 'deco', 0.55, 'neon', 'CASINO LUNA'),
      bld(1300, 440, 400, 250, 280, 'brick', 0.45, 'water-tower'),
      bld(1740, 400, 380, 290, 280, 'concrete', 0.5, 'flat', 'NOODLES'),
      bld(2160, 430, 420, 260, 280, 'brick', 0.4, 'antenna'),
      wall(1000, 660, 90, 30, 265),
      wall(1450, 660, 90, 30, 265),
      wall(1900, 660, 90, 30, 265),
      ground(690, 260, 'street'),
      lamp(800, 700, 260),
      lamp(1600, 700, 260),
      lamp(2350, 700, 260),
      water(760, 200),
      boat(500, 830, 200, 200),
      boat(2600, 840, 240, 200),
      ground(900, 120, 'street'),
      lamp(600, 910, 120),
      lamp(2000, 910, 120),
      wall(0, 960, 3200, 40, 60)
    ],
    entities: [
      person('fenn', 'target', 'Dario Fenn', 850, 722, 260, look('#8a6a42', SK2, HD, 'fedora', null, 'slim', 'briefcase'),
        { path: [{ x: 850, y: 722, wait: 3 }, { x: 1450, y: 722, wait: 6 }, { x: 2150, y: 722, wait: 4 }, { x: 1450, y: 722, wait: 5 }],
          speed: 1.2, loop: true, fleePath: [{ x: 640, y: 722 }] }),
      person('shadow', 'guard', 'The shadow', 820, 726, 260, look('#141418', SK5, HB, 'none', null, 'heavy', 'none'),
        { path: [{ x: 820, y: 726, wait: 3 }, { x: 1420, y: 726, wait: 6 }, { x: 2120, y: 726, wait: 4 }, { x: 1420, y: 726, wait: 5 }],
          speed: 1.2, loop: true }),
      person('stroller', 'civilian', 'Stroller', 750, 730, 260, look('#5a4a6a', SK1, HBR, 'none', null, 'slim', 'umbrella'),
        { path: [{ x: 750, y: 730, wait: 2 }, { x: 1300, y: 730, wait: 4 }], speed: 1.0, loop: true }),
      person('vendor1', 'civilian', 'Fish vendor', 1040, 715, 260, look('#6a5a3a', SK4, HB, 'cap', null, 'heavy', 'none')),
      person('vendor2', 'civilian', 'Noodle cook', 1490, 712, 260, look('#d8d0c0', SK3, HB, 'none', null, 'normal', 'none'), { facing: -1 }),
      person('walker', 'civilian', 'Pedestrian', 1800, 728, 260, look('#2a3a4a', SK2, HD, 'fedora', null, 'normal', 'umbrella'),
        { path: [{ x: 1800, y: 728, wait: 2 }, { x: 2200, y: 728, wait: 3 }], speed: 1.1, loop: true }),
      person('couple', 'civilian', 'Tourist', 1200, 734, 260, look('#7a3a2a', SK1, HF, 'none', null, 'slim', 'phone'),
        { path: [{ x: 1200, y: 734, wait: 3 }, { x: 1900, y: 734, wait: 3 }], speed: 0.9, loop: true }),
      person('gambler', 'civilian', 'Gambler', 1100, 650, 280, look('#3a1a1a', SK3, HD, 'none', '#c9a227', 'normal', 'cigarette'), { window: true }),
      person('loiterer', 'civilian', 'Loiterer', 1500, 930, 120, look('#2a2a30', SK5, HB, 'hood', null, 'normal', 'none'), { facing: -1 })
    ],
    spawns: []
  });

  // m6: identify the target among look-alikes, no markers, 320 m, rain.
  missions.push({
    id: 'm6', chapter: 2, title: 'Same Coat, Different Man', location: 'Gare Lisiere tram platform, 08:05',
    briefing: "Victor Lisle moves Halvard's ledgers between banks. He knows someone wants him dead, so he hired men to wear his coat and walk his platform. No markers this time: read the intel, check every face in the glass, and shoot only the man who matches all of it.",
    objectives: ['Identify and eliminate Victor Lisle', 'Do not harm civilians: one wrong man voids the contract'],
    intel: [
      { name: 'Victor Lisle', text: "Grey coat. Fedora. RED tie. Briefcase. All four, nothing less." },
      { name: 'Decoys', text: "Four men on the platform match all but one detail: a blue tie, an umbrella instead of a briefcase, a cap, or no hat at all." },
      { name: 'Watcher', text: "Halvard's man in a black coat and cap at the far right end of the platform. If he raises the alarm, Lisle runs." }
    ],
    storyBefore: [
      panel('rain-street', 'none', '', "Gare Lisiere, morning rush. Five hundred umbrellas and one liar."),
      mara('phone', "Victor Lisle moves Halvard's ledgers between banks. He's careful. He hires men to wear his coat."),
      mara('phone', "Grey coat. Fedora. Red tie. Briefcase. All four, Crane. Shoot a decoy and you shoot somebody's father."),
      panel('apartment', 'crane', '', "Crane read the dossier twice. Then he memorised the colour of the tie.")
    ],
    storyAfter: [
      panel('rain-street', 'none', '', "Lisle's briefcase held a train ticket to the capital and an appointment with the state prosecutor."),
      mara('phone', "He was running. That's all. Men run when they know what they owe."),
      panel('office', 'detective', '', "Brandt pinned a seventh photograph to the wall. Every line she drew ended at the same name: HALVARD.")
    ],
    reward: 750,
    time: 'rain',
    world: { width: 3200 },
    start: { x: 1600, y: 620 },
    wind: { base: 3, gust: 1.5 },
    timeLimit: 0,
    rules: { noAlarm: false, noCivilianKills: true, markTargets: false },
    failText: { escape: 'Lisle caught his tram and was gone.', attacker: 'Something went very wrong.', alarm: 'The watcher raised the alarm.', time: 'Time ran out.' },
    messages: [
      msg(2, "Lisle is on the platform somewhere. So are four men dressed exactly like him."),
      msg(10, "No markers this time. Grey coat, fedora, red tie, briefcase. All four, or you don't shoot."),
      msg(18, "Check each one in the glass. A blue tie is not a red tie, even in this light."),
      msg(28, "Wrong man, and the contract is void. And so is somebody's family."),
      msg(42, "Three hundred and twenty metres, rain blowing from the left. Lead him, and hold high.")
    ],
    structures: [
      bld(150, 380, 280, 250, 460, 'concrete', 0.3, 'antenna'),
      bld(1000, 340, 240, 290, 460, 'deco', 0.35, 'water-tower'),
      bld(2500, 360, 300, 270, 460, 'concrete', 0.3, 'flat'),
      bld(300, 470, 560, 170, 345, 'brick', 0.35, 'water-tower'),
      bld(1150, 430, 900, 210, 340, 'deco', 0.45, 'flat', 'GARE LISIERE'),
      board(1400, 340, 300, 70, 340, 'TRAM 9  LISIERE'),
      bld(2250, 450, 600, 190, 345, 'brick', 0.4, 'antenna'),
      wall(700, 590, 1800, 8, 325),
      ground(640, 320, 'street'),
      lamp(900, 650, 320),
      lamp(1700, 650, 320),
      lamp(2500, 650, 320),
      ground(760, 200, 'street'),
      car(700, 830, 200, '#2a3440', 'sedan'),
      car(1500, 850, 200, '#6a1f1f', 'truck'),
      car(2400, 840, 200, '#7a6a2a', 'van'),
      wall(0, 960, 3200, 40, 60)
    ],
    entities: [
      person('lisle', 'target', 'Victor Lisle', 950, 672, 320, look('#6a6e74', SK2, HD, 'fedora', '#b0262c', 'normal', 'briefcase'),
        { path: [{ x: 950, y: 672, wait: 5 }, { x: 1850, y: 672, wait: 6 }, { x: 2350, y: 672, wait: 4 }, { x: 1850, y: 672, wait: 3 }],
          speed: 1.1, loop: true, fleePath: [{ x: 3150, y: 672 }] }),
      person('decoy1', 'civilian', 'Man in grey (blue tie)', 2300, 668, 320, look('#6a6e74', SK3, HD, 'fedora', '#2a4a8a', 'normal', 'briefcase'),
        { path: [{ x: 2300, y: 668, wait: 4 }, { x: 1200, y: 668, wait: 5 }], speed: 1.2, loop: true }),
      person('decoy2', 'civilian', 'Man in grey (umbrella)', 700, 676, 320, look('#6a6e74', SK2, HBR, 'fedora', '#b0262c', 'normal', 'umbrella'),
        { path: [{ x: 700, y: 676, wait: 3 }, { x: 1600, y: 676, wait: 6 }], speed: 1.0, loop: true }),
      person('decoy3', 'civilian', 'Man in grey (cap)', 1600, 664, 320, look('#6a6e74', SK4, HB, 'cap', '#b0262c', 'normal', 'briefcase'),
        { path: [{ x: 1600, y: 664, wait: 2 }, { x: 2600, y: 664, wait: 5 }], speed: 1.3, loop: true }),
      person('decoy4', 'civilian', 'Man in grey (no hat)', 2700, 680, 320, look('#6a6e74', SK1, HD, 'none', '#b0262c', 'normal', 'briefcase'),
        { path: [{ x: 2700, y: 680, wait: 6 }, { x: 1900, y: 680, wait: 2 }], speed: 1.15, loop: true }),
      person('commuter', 'civilian', 'Commuter', 1300, 662, 320, look('#4a2a3a', SK1, HBR, 'none', null, 'slim', 'umbrella')),
      person('newsboy', 'civilian', 'Newspaper seller', 1720, 666, 320, look('#5a4a2a', SK5, HB, 'cap', null, 'slim', 'none'), { facing: -1 }),
      person('watcher', 'guard', 'Watcher', 2900, 670, 320, look('#1c1c22', SK3, HB, 'cap', null, 'heavy', 'none'), { facing: -1 }),
      person('street', 'civilian', 'Pedestrian', 300, 790, 200, look('#2a3a2a', SK2, HD, 'none', null, 'normal', 'umbrella'),
        { path: [{ x: 300, y: 790, wait: 2 }, { x: 1100, y: 790, wait: 2 }], speed: 1.2, loop: true })
    ],
    spawns: []
  });

  // m7: no-alarm stealth in a churchyard, two targets, four guards, 340-360 m, fog.
  missions.push({
    id: 'm7', chapter: 2, title: 'Choir of Wolves', location: 'St. Aurel Basilica, 04:40',
    briefing: "Silvio Brask, Halvard's enforcer, confesses in the churchyard at dawn. Ruben Kahl, the Deacon, cooks the syndicate's books in the rectory. The yard is full of Halvard's men. If anyone sounds the alarm, both targets disappear into the crypt tunnels. A suppressor is strongly advised.",
    objectives: ['Eliminate Silvio Brask', 'Eliminate Ruben Kahl', 'Do not raise the alarm', 'Do not harm civilians'],
    intel: [
      { name: 'Silvio Brask', text: "Bald, black leather coat, cigarette. Paces the churchyard beside the priest." },
      { name: 'Ruben Kahl', text: "The Deacon. Grey hair, dark tie. Works in the lit rectory window on the right." },
      { name: 'Guards', text: "A patrol walks the whole churchyard, a lookout stands on the nave roof, one guard at the rectory door, a sentry on the cemetery wall far left. An unsuppressed shot alerts everyone near the impact; a body on the patrol route will be found." }
    ],
    storyBefore: [
      panel('church', 'none', '', "St. Aurel Basilica. The bells stopped ringing in the war. The confessions never did."),
      mara('phone', "Silvio Brask breaks legs for Halvard and confesses on Sundays. Ruben Kahl, the Deacon, keeps the books in the rectory."),
      mara('phone', "The yard is full of Halvard's men. One alarm and both of them vanish into the crypt tunnels."),
      panel('church', 'thug', '', "Brask had killed eleven people. He asked forgiveness for nine of them."),
      panel('rooftop', 'crane', '', "Crane counted the guards twice. The fog counted them once more.")
    ],
    storyAfter: [
      panel('church', 'none', '', "When the police reached the rectory, the Deacon's ledger was already gone from his desk."),
      mara('phone', "Good work. One more, and then we talk about the Banker himself.")
    ],
    reward: 850,
    time: 'fog',
    world: { width: 3400 },
    start: { x: 1700, y: 600 },
    wind: { base: 4, gust: 1.5 },
    timeLimit: 0,
    rules: { noAlarm: true, noCivilianKills: true, markTargets: true },
    failText: { escape: 'They reached the crypt tunnels.', attacker: 'Something went very wrong.', alarm: 'The alarm was raised. Brask and Kahl vanished underground.', time: 'Time ran out.' },
    messages: [
      msg(2, "Brask is in the churchyard with the priest. Kahl is in the rectory window on the right."),
      msg(10, "If anyone sounds the alarm, they both vanish and Halvard knows we're coming. No alarm. None."),
      msg(18, "With a suppressor only people close to the impact hear it. Without one, every shot wakes the yard and you'll have seconds."),
      msg(27, "The patrol walks the whole yard. A body on his route will be found."),
      msg(38, "Wind is four and rising. Fog eats the distance, so read the range.")
    ],
    structures: [
      bld(200, 420, 240, 280, 560, 'concrete', 0.2, 'antenna'),
      bld(2900, 400, 260, 300, 560, 'deco', 0.2, 'flat'),
      bld(1150, 400, 720, 300, 360, 'deco', 0.35, 'flat'),
      bld(1870, 160, 150, 540, 360, 'deco', 0.3, 'antenna'),
      bld(2200, 480, 380, 220, 360, 'brick', 0.4, 'water-tower'),
      wall(500, 660, 560, 40, 345),
      ground(700, 340, 'park'),
      lamp(1000, 705, 340),
      lamp(2100, 705, 340),
      ground(800, 220, 'street'),
      car(900, 880, 220, '#202830', 'sedan'),
      car(2600, 885, 220, '#3a3a3a', 'van'),
      bld(0, 300, 260, 500, 150, 'brick', 0.3, 'water-tower'),
      wall(0, 960, 3400, 40, 70)
    ],
    entities: [
      person('brask', 'target', 'Silvio Brask', 1350, 738, 340, look('#1c1c1c', SK3, HB, 'none', null, 'heavy', 'cigarette'),
        { path: [{ x: 1350, y: 738, wait: 6 }, { x: 1650, y: 738, wait: 8 }], speed: 0.9, loop: true, fleePath: [{ x: 1950, y: 738 }] }),
      person('kahl', 'target', 'Ruben Kahl', 2420, 660, 360, look('#2a2a30', SK1, HG, 'none', '#4a1a1a', 'slim', 'none'),
        { window: true, facing: -1, fleePath: [{ x: 2260, y: 660 }] }),
      person('priest', 'civilian', 'Father Anselm', 1500, 742, 340, look('#111114', SK2, HG, 'none', null, 'slim', 'none'), { facing: -1 }),
      person('nun', 'civilian', 'Sister Agathe', 900, 760, 340, look('#202024', SK1, HB, 'hood', null, 'slim', 'none'),
        { path: [{ x: 900, y: 760, wait: 6 }, { x: 1200, y: 760, wait: 6 }], speed: 0.6, loop: true }),
      person('patrol', 'guard', 'Yard patrol', 1100, 750, 340, look('#2a2a30', SK4, HD, 'cap', null, 'heavy', 'rifle'),
        { path: [{ x: 1100, y: 750, wait: 3 }, { x: 1950, y: 750, wait: 3 }], speed: 1.4, loop: true }),
      person('lookout', 'guard', 'Roof lookout', 1700, 400, 360, look('#2a3038', SK3, HB, 'hood', null, 'normal', 'rifle'), { facing: -1 }),
      person('doorguard', 'guard', 'Rectory guard', 2300, 735, 340, look('#1c1c22', SK5, HB, 'none', null, 'heavy', 'none'), { facing: -1 }),
      person('sentry', 'guard', 'Wall sentry', 700, 660, 345, look('#2a3028', SK2, HBR, 'cap', null, 'normal', 'rifle'))
    ],
    spawns: []
  });

  // m8: long walk across a bridge deck at 370 m, dawn, the end-of-act twist.
  missions.push({
    id: 'm8', chapter: 2, title: 'The Messenger', location: 'Varenne Bridge, 06:20',
    briefing: "Jonah Reyes has been stealing pages out of Halvard's ledger. At dawn he crosses the Varenne Bridge on foot to sell them to a buyer on the far bank. Two men tail him. Make sure he never reaches the other side.",
    objectives: ['Eliminate Jonah Reyes', 'Do not harm civilians'],
    intel: [
      { name: 'Jonah Reyes', text: "Olive coat, no hat, briefcase. Walks the bridge deck and stops at the middle to wait for his buyer." },
      { name: 'The tails', text: "One follows him a few steps back, one waits at the midpoint. On an alarm Reyes runs for the far end." }
    ],
    storyBefore: [
      panel('car', 'mara', '', "For the first time, Mara asked to meet in person. A parked car, engine running, rain on the glass."),
      mara('car', "Jonah Reyes. He's been stealing pages from Halvard's ledger to sell them. If those pages get out, everyone burns. Even us."),
      mara('car', "He crosses the Varenne Bridge at dawn. Make sure he never reaches the other side."),
      panel('car', 'crane', '', "Her hands shook when she lit her cigarette. Crane noticed. Crane always noticed.")
    ],
    storyAfter: [
      panel('office', 'detective', '', "Inspector Jonah Reyes. Eight years undercover. He was carrying the ledger pages to Brandt."),
      panel('phone', 'detective', '', "Brandt called Crane at midnight. She didn't wait for him to speak. She knew he wouldn't."),
      panel('phone', 'detective', '', "Brandt: 'Every man on your list was about to testify against Halvard. Every single one.'"),
      panel('phone', 'detective', '', "Brandt: 'You are not hunting the Banker, Crane. You are his broom. And your handler holds the handle.'")
    ],
    reward: 950,
    time: 'dawn',
    world: { width: 3200 },
    start: { x: 1500, y: 600 },
    wind: { base: 4.5, gust: 1.5 },
    timeLimit: 0,
    rules: { noAlarm: false, noCivilianKills: true, markTargets: true },
    failText: { escape: 'Reyes reached the far bank.', attacker: 'Something went very wrong.', alarm: 'The tails raised the alarm.', time: 'Time ran out.' },
    messages: [
      msg(2, "Reyes is starting across. Olive coat, briefcase."),
      msg(10, "Two men are tailing him. They want him alive. We don't."),
      msg(18, "Three hundred and seventy metres. He stops in the middle of the bridge. Lead him if you can't wait, and mind the wind."),
      msg(30, "Put the briefcase in the river with him. Don't think about what's in it."),
      msg(45, "Crane. Whatever you hear about this one later, it was business.")
    ],
    structures: [
      bld(150, 430, 240, 190, 600, 'concrete', 0.15, 'antenna'),
      bld(1300, 380, 200, 240, 600, 'glass', 0.2, 'antenna'),
      bld(2600, 410, 260, 210, 600, 'deco', 0.15, 'flat'),
      water(620, 400),
      bld(780, 360, 80, 280, 375, 'concrete', 0, 'antenna'),
      bld(2340, 360, 80, 280, 375, 'concrete', 0, 'antenna'),
      wall(60, 600, 3080, 40, 370),
      car(1100, 600, 370, '#3a3a40', 'sedan'),
      car(1900, 600, 370, '#5a4a2a', 'truck'),
      car(2700, 600, 370, '#202a36', 'sedan'),
      water(700, 250),
      boat(700, 760, 180, 250),
      boat(2500, 770, 200, 250),
      ground(820, 160, 'street'),
      lamp(500, 830, 160),
      lamp(1500, 830, 160),
      lamp(2500, 830, 160),
      wall(0, 960, 3200, 40, 60)
    ],
    entities: [
      person('reyes', 'target', 'Jonah Reyes', 300, 600, 370, look('#4a4f3a', SK3, HBR, 'none', null, 'slim', 'briefcase'),
        { path: [{ x: 300, y: 600, wait: 2 }, { x: 1500, y: 600, wait: 10 }, { x: 2900, y: 600, wait: 3 }],
          speed: 1.3, loop: true, fleePath: [{ x: 3140, y: 600 }] }),
      person('tail1', 'guard', 'Tail', 200, 600, 370, look('#1c1c22', SK2, HB, 'fedora', null, 'heavy', 'none'),
        { path: [{ x: 200, y: 600, wait: 2 }, { x: 1420, y: 600, wait: 10 }, { x: 2820, y: 600, wait: 3 }], speed: 1.3, loop: true }),
      person('tail2', 'guard', 'Man at the rail', 1580, 600, 370, look('#2a2a30', SK4, HB, 'cap', null, 'normal', 'cigarette'), { facing: -1 }),
      person('jogger', 'civilian', 'Jogger', 2900, 600, 370, look('#8a2a2a', SK1, HF, 'none', null, 'slim', 'none'),
        { path: [{ x: 2900, y: 600, wait: 0 }, { x: 400, y: 600, wait: 0 }], speed: 2.6, loop: true }),
      person('umbrella', 'civilian', 'Commuter', 1800, 600, 370, look('#3a3a4a', SK2, HD, 'fedora', null, 'normal', 'umbrella'),
        { path: [{ x: 1800, y: 600, wait: 2 }, { x: 2500, y: 600, wait: 2 }], speed: 1.0, loop: true }),
      person('fisher', 'civilian', 'Fisherman', 2150, 600, 370, look('#4a5a3a', SK4, HG, 'cap', null, 'heavy', 'none'), { facing: -1 }),
      person('dogwalker', 'civilian', 'Dog walker', 1200, 860, 160, look('#5a3a2a', SK1, HBR, 'none', null, 'slim', 'none'),
        { path: [{ x: 1200, y: 860, wait: 3 }, { x: 1900, y: 860, wait: 3 }], speed: 1.0, loop: true }),
      person('bench', 'civilian', 'Old man', 600, 880, 160, look('#3a3a30', SK3, HS, 'fedora', null, 'normal', 'none'))
    ],
    spawns: []
  });

  // ===== CHAPTER 3: THE BANKER'S DUE =====

  // m9: defend Brandt; attackers in waves walk to the hotel door at 345 m.
  function atk(id, x, y, dist, speed, path, lk) {
    return person(id, 'attacker', 'Halvard gunman', x, y, dist, lk, { path: path, speed: speed, loop: false });
  }
  var GUN1 = look('#1a1a1e', SK3, HB, 'cap', null, 'heavy', 'none');
  var GUN2 = look('#22252b', SK5, HB, 'hood', null, 'normal', 'rifle');
  var GUN3 = look('#2a2420', SK2, HD, 'fedora', null, 'normal', 'none');

  missions.push({
    id: 'm9', chapter: 3, title: 'Cut Loose', location: 'Hotel Calvaire, Rue des Pendus, 01:10',
    briefing: "Halvard knows Inspector Brandt is hiding in the Hotel Calvaire with copies of Reyes's pages. His gunmen are coming down the street from both ends, out of the alleys and over the rooftops. Nobody reaches that door.",
    objectives: ['Stop every gunman before he reaches the hotel door', 'Keep Inspector Brandt alive', 'Do not harm civilians'],
    intel: [
      { name: 'Ilse Brandt', text: "Brown trench coat, fedora. In a lit window of the Hotel Calvaire. Do not hit her." },
      { name: 'Gunmen', text: "About ten, in waves. They walk or run along the street toward the hotel door; one comes across the rooftops to the hotel stairs." }
    ],
    storyBefore: [
      panel('black', 'none', '', "Crane did not sleep. He sat by the phone until it rang."),
      mara('phone', "Yes. Halvard paid for every bullet. I wrote the names. I'm not going to apologise for it."),
      mara('phone', "There's more, and you'll hear it. Not now. Halvard knows where Brandt is hiding and his men are already driving."),
      panel('apartment', 'detective', '', "Hotel Calvaire. Brandt sat in a rented room with Reyes's pages and a revolver she had never fired."),
      mara('phone', "Whatever you think of me, Elias, keep her alive. She's the only honest person left in this city.")
    ],
    storyAfter: [
      panel('apartment', 'detective', '', "Brandt: 'Your handler called me an hour before they came. She told me to stay away from the windows.'"),
      mara('phone', "My name is Mara Halvard. Voss was my mother's name. He had her drowned in the harbour when I was nine."),
      mara('phone', "I spent twenty years becoming his most useful daughter. I needed you to become his most useful broom. Now we sweep him.")
    ],
    reward: 1100,
    time: 'rain',
    world: { width: 3200 },
    start: { x: 1600, y: 620 },
    wind: { base: 4.5, gust: 2 },
    timeLimit: 0,
    rules: { noAlarm: false, noCivilianKills: true, markTargets: true },
    failText: { escape: 'Something went very wrong.', attacker: 'They got through the door. Brandt is dead.', alarm: 'The alarm was raised.', time: 'Time ran out.' },
    messages: [
      msg(1, "You're angry. Good. Be angry at the men walking up that street."),
      msg(6, "Halvard found out where Brandt is. I didn't tell him. Believe that or don't, but keep her alive."),
      msg(20, "Runners from both ends of the street. Don't let a single one reach the door."),
      msg(42, "Two coming out of the alleys. Closer than the others."),
      msg(67, "Roof! One on the rooftops heading for the hotel stairs."),
      msg(92, "Last of them. Then we talk.")
    ],
    structures: [
      bld(100, 360, 260, 330, 560, 'concrete', 0.25, 'antenna'),
      bld(2750, 340, 300, 350, 560, 'glass', 0.3, 'antenna'),
      bld(500, 420, 420, 300, 350, 'brick', 0.35, 'water-tower'),
      bld(920, 470, 480, 250, 350, 'deco', 0.3, 'flat'),
      bld(1400, 380, 420, 340, 350, 'brick', 0.45, 'neon', 'HOTEL CALVAIRE'),
      bld(1820, 380, 500, 340, 350, 'concrete', 0.3, 'flat'),
      board(1850, 300, 260, 70, 350, 'PAWN & LOAN'),
      bld(2320, 440, 420, 280, 350, 'brick', 0.35, 'antenna'),
      ground(720, 345, 'street'),
      lamp(800, 730, 345),
      lamp(1300, 730, 345),
      lamp(2100, 730, 345),
      lamp(2700, 730, 345),
      car(1100, 770, 345, '#2a2f38', 'sedan'),
      car(2500, 775, 345, '#3a2a2a', 'van'),
      ground(860, 140, 'rooftop'),
      wall(0, 955, 3200, 45, 60)
    ],
    entities: [
      person('brandt', 'ally', 'Inspector Ilse Brandt', 1600, 640, 350, look('#6b5a40', SK2, HBR, 'fedora', null, 'slim', 'phone'), { window: true, facing: -1 }),
      person('tenant', 'civilian', 'Tenant', 650, 690, 350, look('#4a4a50', SK3, HD, 'none', null, 'normal', 'cigarette'), { window: true }),
      person('smoker', 'civilian', 'Man in a doorway', 900, 744, 345, look('#3a3028', SK4, HB, 'cap', null, 'normal', 'cigarette')),
      person('passerby', 'civilian', 'Passer-by', 2000, 752, 345, look('#4a2a3a', SK1, HBR, 'none', null, 'slim', 'umbrella'),
        { path: [{ x: 2000, y: 752, wait: 2 }, { x: 2200, y: 752, wait: 2 }], speed: 1.0, loop: true }),
      atk('a1', 420, 748, 345, 2.0, [{ x: 900, y: 748, wait: 3 }, { x: 1580, y: 748 }], GUN1),
      atk('a2', 2900, 752, 345, 2.0, [{ x: 2300, y: 752, wait: 3 }, { x: 1640, y: 752 }], GUN3)
    ],
    spawns: [
      { t: 18, entity: atk('a3', 60, 756, 345, 2.6, [{ x: 1580, y: 756 }], GUN2) },
      { t: 18, entity: atk('a4', 3140, 744, 345, 2.6, [{ x: 1640, y: 744 }], GUN1) },
      { t: 40, entity: atk('a5', 1000, 750, 345, 2.0, [{ x: 1580, y: 750 }], GUN3) },
      { t: 40, entity: atk('a6', 2300, 746, 345, 2.0, [{ x: 1640, y: 746 }], GUN1) },
      { t: 65, entity: atk('a7', 2280, 380, 350, 2.0, [{ x: 1720, y: 380 }], GUN2) },
      { t: 65, entity: atk('a8', 300, 752, 345, 3.0, [{ x: 1580, y: 752 }], GUN1) },
      { t: 90, entity: atk('a9', 1150, 748, 345, 1.6, [{ x: 1580, y: 748 }], GUN3) },
      { t: 90, entity: atk('a10', 2900, 756, 345, 3.0, [{ x: 2500, y: 756, wait: 2 }, { x: 1640, y: 756 }], GUN2) }
    ]
  });

  // m10: timed escape; target walks from the bank steps to an armoured car at 420 m.
  missions.push({
    id: 'm10', chapter: 3, title: 'Paper Boats', location: 'Quai des Banques, 18:50',
    briefing: "With his witnesses dead, only the original ledger can still hang Halvard. His lawyer Oskar Lund is walking it from the Halvard Trust to an armoured car on the quay, bound for a ship at sundown. Once that car door shuts, the ledger is gone.",
    objectives: ['Eliminate Oskar Lund before he reaches the armoured car', 'Do not harm civilians'],
    intel: [
      { name: 'Oskar Lund', text: "The Clerk. Charcoal coat, fedora, burgundy tie, briefcase chained to his wrist. Waits on the bank steps, then walks to the black car." },
      { name: 'Escort', text: "A minder in front, a minder behind, a driver at the car and a rifleman on the bank roof. Make sure your round finds Lund and not a shoulder." }
    ],
    storyBefore: [
      panel('harbor', 'none', '', "Quai des Banques. The Halvard Trust stands over the water like a tombstone with a doorman."),
      mara('phone', "With his witnesses dead, only the original ledger can still hang him. Him, and everyone else in it."),
      mara('phone', "Oskar Lund, his lawyer, is moving it to a ship at sundown. Armoured car, two minders, one short walk."),
      panel('rooftop', 'crane', '', "Crane noticed she said everyone else. He wondered if she meant herself.")
    ],
    storyAfter: [
      panel('harbor', 'thug', '', "Lund fell on the quay. When the harbour police arrived, the briefcase was already gone."),
      mara('phone', "Don't worry about the ledger. It's somewhere safe. With me.")
    ],
    reward: 1200,
    time: 'dusk',
    world: { width: 3200 },
    start: { x: 1400, y: 620 },
    wind: { base: 5.5, gust: 2 },
    timeLimit: 80,
    rules: { noAlarm: false, noCivilianKills: true, markTargets: true },
    failText: { escape: 'Lund reached the car. The ledger sailed at sundown.', attacker: 'Something went very wrong.', alarm: 'The escort raised the alarm.', time: 'The armoured car pulled away with the ledger.' },
    messages: [
      msg(1, "Oskar Lund. Halvard's lawyer. The briefcase on his wrist is the real ledger, every bribe for twenty years."),
      msg(8, "He's walking to the black car. Once that door shuts, the ledger is gone forever."),
      msg(16, "Four hundred and twenty metres, wind off the water. Don't rush the first shot. Don't miss it either."),
      msg(30, "His men walk close. Make sure the round finds Lund, not a shoulder in front of him."),
      msg(55, "He's halfway. Elias. Now."),
      msg(70, "Ten seconds.")
    ],
    structures: [
      bld(150, 420, 260, 230, 600, 'concrete', 0.25, 'antenna'),
      bld(2700, 400, 280, 250, 600, 'glass', 0.3, 'antenna'),
      crane(500, 650, 480),
      crane(2800, 650, 480),
      bld(600, 470, 360, 180, 430, 'brick', 0.3, 'water-tower'),
      bld(1000, 420, 520, 230, 430, 'deco', 0.4, 'flat', 'HALVARD TRUST'),
      bld(1560, 450, 360, 200, 430, 'concrete', 0.3, 'antenna'),
      bld(2000, 440, 400, 210, 435, 'glass', 0.45, 'antenna'),
      ground(650, 420, 'dock'),
      car(1640, 682, 420, '#121418', 'sedan'),
      car(2300, 690, 420, '#3a3a3a', 'van'),
      lamp(1300, 660, 420),
      lamp(1900, 660, 420),
      water(730, 260),
      boat(800, 800, 220, 260),
      boat(2400, 810, 260, 260),
      ground(880, 140, 'dock'),
      box(2800, 780, 300, 120, 140, '#5a2e24'),
      wall(0, 960, 3200, 40, 70)
    ],
    entities: [
      person('lund', 'target', 'Oskar Lund', 1180, 688, 420, look('#2a2a30', SK1, HG, 'fedora', '#8a1f3a', 'slim', 'briefcase'),
        { path: [{ x: 1180, y: 688, wait: 6 }, { x: 1610, y: 688 }], speed: 1.2, loop: false, escape: true, fleePath: [{ x: 1610, y: 688 }] }),
      person('minder1', 'guard', 'Minder', 1215, 690, 420, look('#1c1c22', SK5, HB, 'none', null, 'heavy', 'none'),
        { path: [{ x: 1215, y: 690, wait: 6 }, { x: 1645, y: 690 }], speed: 1.2, loop: false }),
      person('minder2', 'guard', 'Minder', 1150, 686, 420, look('#22252b', SK3, HB, 'cap', null, 'heavy', 'none'),
        { path: [{ x: 1150, y: 686, wait: 6 }, { x: 1575, y: 686 }], speed: 1.2, loop: false }),
      person('driver', 'guard', 'Driver', 1690, 690, 420, look('#15151a', SK2, HD, 'cap', null, 'normal', 'none'), { facing: -1 }),
      person('rifleman', 'guard', 'Roof rifleman', 1300, 420, 430, look('#2a3038', SK3, HB, 'hood', null, 'normal', 'rifle')),
      person('clerk', 'civilian', 'Bank clerk', 1050, 684, 420, look('#3a3a4a', SK2, HBR, 'none', '#2a2a2a', 'slim', 'none')),
      person('docker', 'civilian', 'Docker', 2000, 692, 420, look('#6a4a2a', SK4, HB, 'cap', null, 'heavy', 'none'),
        { path: [{ x: 2000, y: 692, wait: 4 }, { x: 2200, y: 692, wait: 4 }], speed: 0.8, loop: true }),
      person('cashier', 'civilian', 'Cashier', 1400, 630, 430, look('#d8d0c0', SK1, HF, 'none', null, 'slim', 'none'), { window: true })
    ],
    spawns: []
  });

  // m11: counter-sniper on a lighthouse gallery at 503 m, timed, fog.
  missions.push({
    id: 'm11', chapter: 3, title: 'Old Friends', location: 'Cap Noir lighthouse, 05:10',
    briefing: "Kaspar Wendt, your spotter at Kessel Bridge, did not die there. He sold your unit, Halvard bought him out of a prison camp, and tonight he is on the Cap Noir lighthouse with a rifle, sweeping the coast for you. His spotter is on the breakwater. You have until his scope finds your glint.",
    objectives: ['Eliminate Kaspar Wendt', 'Eliminate his spotter, Lukas Merle', 'Finish before Wendt finds you', 'Do not harm civilians'],
    intel: [
      { name: 'Kaspar Wendt', text: "Grey-green field jacket, cap, rifle. Walks the lighthouse gallery." },
      { name: 'Lukas Merle', text: "Wendt's spotter. Hood, binoculars and radio, on the breakwater left of the tower." },
      { name: 'Guards', text: "Two patrol the breakwater. The keeper in the cottage window is a civilian." }
    ],
    storyBefore: [
      panel('black', 'none', '', "Kessel Bridge, nine years ago. A spotter named Kaspar Wendt called the wind. Then he called the enemy and told them where to look."),
      panel('black', 'crane', '', "Eleven men died on that bridge. Crane carried the twelfth home. He never spoke again."),
      mara('phone', "Wendt didn't die there, Elias. Halvard bought him out of a prison camp. He's been the Banker's rifle ever since."),
      mara('phone', "Tonight he's on the Cap Noir lighthouse, hunting you. Halvard wants his broom put back in the closet."),
      panel('rooftop', 'crane', '', "The fog came in thick as wool. Somewhere in it, an old friend was counting the wind.")
    ],
    storyAfter: [
      panel('harbor', 'none', '', "Wendt's rifle went over the rail and into the sea. It took the last of Kessel Bridge with it."),
      mara('phone', "Halvard has nobody left but himself. And me. Tomorrow night he's pouring me a drink.")
    ],
    reward: 1350,
    time: 'fog',
    world: { width: 3400 },
    start: { x: 1640, y: 450 },
    wind: { base: 6.5, gust: 2 },
    timeLimit: 100,
    rules: { noAlarm: false, noCivilianKills: true, markTargets: true },
    failText: { escape: 'Wendt slipped away into the fog. He will be back.', attacker: 'Something went very wrong.', alarm: 'The breakwater raised the alarm.', time: 'Wendt found you first. You never heard the shot.' },
    messages: [
      msg(1, "Cap Noir. Halvard's own rifle is up on that gallery, and you know him."),
      msg(8, "Kaspar Wendt. Your spotter at Kessel Bridge. The one they buried in an empty coffin."),
      msg(16, "He's sweeping the coast with a scope of his own. I give you a minute and a half before he finds your glint."),
      msg(30, "His spotter is on the breakwater. Both of them, or Wendt walks away again."),
      msg(60, "Wind's six and gusting. At five hundred metres that's more than a man's width. Read it."),
      msg(85, "Fifteen seconds, Elias.")
    ],
    structures: [
      bld(100, 470, 400, 170, 590, 'concrete', 0.1, 'antenna'),
      bld(2900, 500, 380, 140, 590, 'brick', 0.1, 'flat'),
      bld(1610, 255, 70, 45, 506, 'glass', 0.9, 'antenna'),
      bld(1600, 300, 90, 340, 505, 'concrete', 0.2, 'flat'),
      bld(1750, 570, 220, 70, 505, 'brick', 0.5, 'flat'),
      wall(1575, 300, 140, 8, 503),
      box(2100, 615, 90, 25, 502, '#4a4a4a'),
      ground(640, 500, 'dock'),
      lamp(1300, 650, 500),
      lamp(2300, 650, 500),
      water(700, 330),
      boat(900, 760, 200, 330),
      boat(2900, 770, 220, 330),
      ground(870, 130, 'park'),
      wall(0, 840, 600, 30, 130)
    ],
    entities: [
      person('wendt', 'target', 'Kaspar Wendt', 1590, 300, 503, look('#4a5040', SK3, '#5a5a50', 'cap', null, 'normal', 'rifle'),
        { path: [{ x: 1590, y: 300, wait: 5 }, { x: 1700, y: 300, wait: 5 }], speed: 0.6, loop: true, fleePath: [{ x: 1600, y: 300 }] }),
      person('merle', 'target', 'Lukas Merle', 1480, 662, 500, look('#3a4038', SK2, HF, 'hood', null, 'slim', 'phone'),
        { fleePath: [{ x: 1180, y: 662 }] }),
      person('guard1', 'guard', 'Breakwater guard', 1250, 668, 500, look('#22252b', SK4, HB, 'cap', null, 'heavy', 'rifle'),
        { path: [{ x: 1250, y: 668, wait: 3 }, { x: 1550, y: 668, wait: 3 }], speed: 1.0, loop: true }),
      person('guard2', 'guard', 'Breakwater guard', 2000, 665, 500, look('#2a3038', SK3, HD, 'hood', null, 'normal', 'none'),
        { path: [{ x: 2000, y: 665, wait: 4 }, { x: 2450, y: 665, wait: 4 }], speed: 1.0, loop: true }),
      person('keeper', 'civilian', 'Lighthouse keeper', 1860, 632, 505, look('#3a3a2a', SK2, HS, 'none', null, 'normal', 'none'), { window: true }),
      person('fisher', 'civilian', 'Fisherman', 2600, 660, 500, look('#4a5a3a', SK4, HG, 'cap', null, 'heavy', 'none'), { facing: -1 })
    ],
    spawns: []
  });

  // m12: finale. Halvard in his penthouse window at 515 m, Mara beside him, no alarm.
  missions.push({
    id: 'm12', chapter: 3, title: "The Banker's Due", location: 'Halvard Tower, penthouse, 02:00',
    briefing: "Augustin Halvard believes his daughter is bringing him the broom's address tonight. She is, and his cars are on their way to an empty flat. He walks his penthouse while he talks. Mara stands in the same window. The terrace and the neighbouring roofs are full of his guards. Any alarm, and he is in his private elevator.",
    objectives: ['Eliminate Augustin Halvard', 'Do not hit Mara', 'Do not raise the alarm'],
    intel: [
      { name: 'Augustin Halvard', text: "The Banker. White dinner jacket, silver hair, black tie. Armoured vest: head shot, or a heavy rifle." },
      { name: 'Mara Voss', text: "Red coat, black hair, in the penthouse window. Halvard walks past her. Wait for a clean line." },
      { name: 'Guards', text: "Three bodyguards on the terrace, two riflemen on the neighbouring roofs." }
    ],
    storyBefore: [
      panel('penthouse', 'halvard', '', "Augustin Halvard, the Banker. He never raised his voice. He never had to."),
      panel('penthouse', 'halvard', '', "Halvard: 'My daughter brings me the broom's address tonight. Family is the only account that never closes.'"),
      mara('phone', "I'm in his penthouse. I gave him an address. Yours. He's sent two cars. They'll find it empty."),
      mara('phone', "Halvard Tower, five hundred metres, top floor. This is the last name, Elias. Then you're free."),
      panel('rooftop', 'crane', '', "Crane loaded five rounds. He only planned to use one. He had planned that before, too.")
    ],
    storyAfter: [
      panel('penthouse', 'mara', '', "The glass broke half a second before the sound arrived. Halvard's drink never reached the table."),
      mara('penthouse', "Thank you, Elias. Go home. Don't call. You never do.")
    ],
    reward: 1500,
    time: 'rain',
    world: { width: 3600 },
    start: { x: 1770, y: 420 },
    wind: { base: 7, gust: 2 },
    timeLimit: 0,
    rules: { noAlarm: true, noCivilianKills: true, markTargets: true },
    failText: { escape: 'Halvard reached his elevator.', attacker: 'Something went very wrong.', alarm: 'The alarm was raised. Halvard is gone, and so is Mara.', time: 'Time ran out.' },
    messages: [
      msg(1, "Halvard Tower. He's in the penthouse with me, pouring two glasses. He thinks I brought him your address."),
      msg(9, "White jacket, silver hair. The vest under it stops a lesser rifle. Go for the head if you can."),
      msg(17, "I'm the one in red. Keep me out of your arithmetic."),
      msg(26, "Five hundred and fifteen metres. Seven metres of wind. If his guards hear a miss, he's in the elevator and I'm dead."),
      msg(40, "He likes to walk while he gloats. Wait until I'm not beside him."),
      msg(60, "Elias. For my mother. For your spotter. For every name.")
    ],
    structures: [
      bld(300, 280, 260, 560, 580, 'glass', 0.35, 'antenna'),
      bld(2200, 340, 220, 500, 580, 'concrete', 0.25, 'water-tower'),
      bld(2800, 250, 280, 590, 580, 'deco', 0.3, 'antenna'),
      bld(1100, 470, 380, 370, 520, 'concrete', 0.3, 'antenna'),
      bld(2060, 440, 360, 400, 520, 'deco', 0.3, 'water-tower'),
      bld(1560, 410, 420, 430, 515, 'glass', 0.4, 'flat', 'HALVARD'),
      bld(1640, 300, 260, 110, 515, 'deco', 0.85, 'neon', 'HALVARD'),
      lamp(1600, 410, 515),
      lamp(1940, 410, 515),
      bld(0, 660, 700, 300, 300, 'brick', 0.3, 'flat'),
      bld(700, 640, 700, 320, 300, 'brick', 0.35, 'water-tower'),
      board(800, 560, 300, 70, 300, 'VARENNE NEVER SLEEPS'),
      bld(1400, 700, 700, 260, 300, 'concrete', 0.3, 'flat'),
      bld(2100, 620, 700, 340, 300, 'brick', 0.4, 'antenna'),
      bld(2800, 680, 800, 280, 300, 'deco', 0.3, 'flat'),
      ground(930, 90, 'rooftop')
    ],
    entities: [
      person('halvard', 'target', 'Augustin Halvard', 1690, 398, 515, look('#e8e2d0', SK1, HS, 'none', '#1a1a1a', 'heavy', 'cigarette'),
        { window: true, hp: 160, path: [{ x: 1690, y: 398, wait: 6 }, { x: 1850, y: 398, wait: 5 }], speed: 0.7, loop: true,
          fleePath: [{ x: 1660, y: 398 }] }),
      person('mara', 'ally', 'Mara Voss', 1770, 400, 515, look('#7a1e2a', SK1, HB, 'none', null, 'slim', 'phone'), { window: true, facing: -1 }),
      person('bg1', 'guard', 'Bodyguard', 1590, 410, 515, look('#15151a', SK3, HB, 'none', null, 'heavy', 'none')),
      person('bg2', 'guard', 'Bodyguard', 1950, 410, 515, look('#1c1c22', SK5, HB, 'none', null, 'heavy', 'none'), { facing: -1 }),
      person('bg3', 'guard', 'Bodyguard', 1620, 410, 515, look('#22252b', SK2, HD, 'none', null, 'heavy', 'none'),
        { path: [{ x: 1620, y: 410, wait: 4 }, { x: 1940, y: 410, wait: 4 }], speed: 0.9, loop: true }),
      person('rifle1', 'guard', 'Rooftop rifleman', 2150, 440, 520, look('#2a3038', SK3, HB, 'hood', null, 'normal', 'rifle'), { facing: -1 }),
      person('rifle2', 'guard', 'Rooftop rifleman', 1300, 470, 520, look('#2a2a30', SK4, HB, 'cap', null, 'normal', 'rifle')),
      person('clerk', 'civilian', 'Night clerk', 1920, 690, 515, look('#3a3a4a', SK2, HBR, 'none', '#2a2a2a', 'normal', 'none'), { window: true, facing: -1 }),
      person('cleaner', 'civilian', 'Cleaner', 1620, 692, 515, look('#5a6a7a', SK4, HB, 'none', null, 'slim', 'none'), { window: true })
    ],
    spawns: []
  });

  LW.DATA = {
    title: 'SILENT CONTRACT',
    tagline: 'One shot. One truth.',
    intro: intro,
    ending: ending,
    chapters: chapters,
    weapons: weapons,
    gear: gear,
    missions: missions
  };
})(window.LW);
