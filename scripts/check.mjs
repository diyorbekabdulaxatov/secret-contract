// Static checks: every game script parses, is ASCII-only, and the mission data follows game/CONTRACT.md.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const jsDir = join(root, 'game', 'js');
const errors = [];
const fail = (msg) => errors.push(msg);

// 1. Syntax and encoding of every script.
const scripts = readdirSync(jsDir).filter((f) => f.endsWith('.js')).sort();
for (const f of scripts) {
  const path = join(jsDir, f);
  const r = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
  if (r.status !== 0) fail(`${f}: syntax error\n${r.stderr.trim()}`);
  const text = readFileSync(path, 'utf8');
  const bad = text.search(/[^\x00-\x7F]/);
  if (bad >= 0) {
    const line = text.slice(0, bad).split('\n').length;
    fail(`${f}:${line}: non-ASCII character; use a \\uXXXX escape so the file decodes the same everywhere`);
  }
}

// 2. Load shared.js + data.js the way the browser does and validate LW.DATA.
const sandbox = { window: {}, console };
vm.createContext(sandbox);
for (const f of ['shared.js', 'data.js']) {
  vm.runInContext(readFileSync(join(jsDir, f), 'utf8'), sandbox, { filename: f });
}
const LW = sandbox.window.LW;
const D = LW && LW.DATA;
if (!D) {
  fail('data.js did not define LW.DATA');
} else {
  const TIMES = ['night', 'rain', 'dusk', 'dawn', 'fog'];
  const ROLES = ['target', 'guard', 'civilian', 'attacker', 'ally'];
  const STRUCT = ['building', 'wall', 'ground', 'water', 'car', 'lamp', 'crane', 'billboard', 'container', 'boat'];
  const BGS = ['rain-street', 'bar', 'office', 'rooftop', 'car', 'phone', 'harbor', 'warehouse', 'apartment', 'church', 'penthouse', 'black'];
  const FIGURES = ['crane', 'mara', 'halvard', 'thug', 'detective', 'none'];
  const GEAR = ['scope', 'stock', 'mag', 'suppressor', 'computer'];

  const panels = (list, where) => {
    (list || []).forEach((p, i) => {
      if (!BGS.includes(p.bg)) fail(`${where}[${i}]: unknown bg "${p.bg}"`);
      if (!FIGURES.includes(p.figure)) fail(`${where}[${i}]: unknown figure "${p.figure}"`);
      if (!p.text) fail(`${where}[${i}]: empty text`);
    });
  };
  panels(D.intro, 'intro');
  panels(D.ending, 'ending');

  if (!Array.isArray(D.weapons) || !D.weapons.length) fail('no weapons');
  else if (D.weapons[0].price !== 0) fail('the first weapon must be free (price 0)');
  for (const w of D.weapons || []) {
    for (const k of ['damage', 'velocity', 'dropMul', 'swayMul', 'magazine', 'reloadTime', 'boltTime']) {
      if (!(typeof w[k] === 'number' && w[k] > 0)) fail(`weapon ${w.id}: ${k} must be a positive number`);
    }
  }
  const gearIds = (D.gear || []).map((g) => g.id);
  for (const id of GEAR) if (!gearIds.includes(id)) fail(`gear "${id}" is missing`);
  for (const g of D.gear || []) {
    if (!g.levels || !g.levels.length || g.levels[0].price !== 0) fail(`gear ${g.id}: level 0 must exist and be free`);
  }

  const chapterIds = new Set((D.chapters || []).map((c) => c.id));
  const seen = new Set();
  for (const m of D.missions || []) {
    const where = `mission ${m.id}`;
    if (seen.has(m.id)) fail(`${where}: duplicate id`);
    seen.add(m.id);
    if (m.chapter !== 0 && !chapterIds.has(m.chapter)) fail(`${where}: unknown chapter ${m.chapter}`);
    if (!TIMES.includes(m.time)) fail(`${where}: unknown time "${m.time}"`);
    const W = m.world && m.world.width;
    if (!(W >= 1200 && W <= 6000)) fail(`${where}: world.width ${W} out of range`);
    panels(m.storyBefore, `${where} storyBefore`);
    panels(m.storyAfter, `${where} storyAfter`);
    for (const s of m.structures || []) {
      if (!STRUCT.includes(s.type)) fail(`${where}: unknown structure type "${s.type}"`);
      if (s.type !== 'ground' && s.type !== 'water' && !(s.dist > 0)) fail(`${where}: ${s.type} needs a positive dist`);
    }
    const all = (m.entities || []).concat((m.spawns || []).map((sp) => sp.entity));
    const ids = new Set();
    let goals = 0;
    for (const e of all) {
      const ew = `${where} entity ${e.id}`;
      if (ids.has(e.id)) fail(`${ew}: duplicate id`);
      ids.add(e.id);
      if (!ROLES.includes(e.role)) fail(`${ew}: unknown role "${e.role}"`);
      if (e.role === 'target' || e.role === 'attacker') goals++;
      if (!(e.dist >= LW.CONST.MIN_DIST && e.dist <= LW.CONST.MAX_DIST)) fail(`${ew}: dist ${e.dist} outside ${LW.CONST.MIN_DIST}-${LW.CONST.MAX_DIST}`);
      if (!(e.x >= 0 && e.x <= W)) fail(`${ew}: x ${e.x} outside the world`);
      if (!(e.y > 0 && e.y <= 1000)) fail(`${ew}: y ${e.y} outside the world`);
      for (const p of (e.path || []).concat(e.fleePath || [])) {
        if (!(p.x >= 0 && p.x <= W && p.y > 0 && p.y <= 1000)) fail(`${ew}: waypoint (${p.x}, ${p.y}) outside the world`);
      }
      if (e.escape && !(e.path && e.path.length)) fail(`${ew}: escape needs a path`);
    }
    if (!goals) fail(`${where}: no target or attacker, so it can never be won`);
  }
  if (!seen.has('range')) fail('the shooting range mission "range" is missing');
}

if (errors.length) {
  console.error(`${errors.length} problem(s):\n- ` + errors.join('\n- '));
  process.exit(1);
}
console.log(`OK: ${scripts.length} scripts parse; ${(D.missions || []).length} missions validated.`);
