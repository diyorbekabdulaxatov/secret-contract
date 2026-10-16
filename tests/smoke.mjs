// Smoke test: serve dist/, open it in headless Chromium at phone-landscape size, check the title
// screen, then start every mission, scope in, fire, force a win and expect a clean result.
// Any page error or console error fails the run. Screenshots go to test-results/.
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const shots = join(root, 'test-results');
if (!existsSync(join(dist, 'index.html'))) throw new Error('Run "npm run build" first.');
mkdirSync(shots, { recursive: true });

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css' };
const server = createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = normalize(join(dist, url === '/' ? 'index.html' : url));
  if (!file.startsWith(dist) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const problems = [];
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true });
  page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
  page.on('console', (msg) => {
    // Google Fonts can be unreachable from CI runners; that is not a game bug.
    if (msg.type() === 'error' && !/fonts\.(googleapis|gstatic)\.com/.test(msg.text())) problems.push(`console error: ${msg.text()}`);
  });
  page.on('requestfailed', (req) => {
    if (!/fonts\.(googleapis|gstatic)\.com/.test(req.url())) problems.push(`request failed: ${req.url()}`);
  });

  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction(() => window.LW && LW.DATA && LW.Core && LW.Render && LW.UI, null, { timeout: 10000 });
  const titleVisible = await page.evaluate(() => {
    const t = document.getElementById('screen-title');
    return !!t && !t.hidden;
  });
  if (!titleVisible) problems.push('title screen is not visible after load');
  await page.screenshot({ path: join(shots, 'title.png') });

  const results = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    document.querySelectorAll('.screen').forEach((s) => { s.hidden = true; });
    const canvas = document.getElementById('game-canvas');
    for (let el = canvas; el && el !== document.body; el = el.parentElement) el.hidden = false;
    const out = [];
    for (const m of LW.DATA.missions) {
      let ended = null;
      const events = {};
      LW.Core.stop();
      LW.Core.start(m, LW.UI.buildLoadout(), {
        onFrame() {}, onPause() {},
        onEvent(e) { events[e.type] = (events[e.type] || 0) + 1; },
        onEnd(r) { ended = r; }
      }, { sensitivity: 1 });
      await sleep(250);
      LW.Core.input.setScoped(true);
      LW.Core.input.zoomStep(1);
      LW.Core.input.pan(40, 20);
      await sleep(250);
      LW.Core.input.fire();
      await sleep(500);
      LW.Core.debug.win();
      for (let i = 0; i < 100 && !ended; i++) await sleep(50);
      const s = LW.Core.state;
      out.push({ id: m.id, ended: !!ended, win: !!(ended && ended.win), stars: ended ? ended.stars : 0,
        shots: s.stats.shots, zoom: s.view.zoom, events });
    }
    LW.Core.stop();
    return out;
  });

  for (const r of results) {
    const line = `${r.id.padEnd(6)} ended=${r.ended} win=${r.win} stars=${r.stars} shots=${r.shots} zoom=${r.zoom.toFixed(1)}`;
    console.log(line);
    if (!r.ended || !r.win) problems.push(`mission ${r.id} did not end in a win`);
    if (r.shots < 1) problems.push(`mission ${r.id}: firing did not register a shot`);
  }

  // One scoped frame for the record.
  await page.evaluate(async () => {
    const m = LW.DATA.missions.find((x) => x.id === 'm1');
    LW.Core.start(m, LW.UI.buildLoadout(), { onFrame() {}, onEvent() {}, onEnd() {}, onPause() {} }, { sensitivity: 1 });
    await new Promise((r) => setTimeout(r, 300));
    LW.Core.input.setScoped(true);
    await new Promise((r) => setTimeout(r, 600));
  });
  await page.screenshot({ path: join(shots, 'scope-m1.png') });
} finally {
  await browser.close();
  server.close();
}

if (problems.length) {
  console.error(`\nSmoke test failed with ${problems.length} problem(s):\n- ` + problems.join('\n- '));
  process.exit(1);
}
console.log('\nSmoke test passed.');
