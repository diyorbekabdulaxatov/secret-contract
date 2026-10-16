// Builds dist/ for static hosting (GitHub Pages).
// game/index.html is a page fragment (the claude.ai artifact host adds the document skeleton),
// so this wraps it in a full document with the same charset, viewport and small reset.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'game');
const out = join(root, 'dist');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(src, 'js'), join(out, 'js'), { recursive: true });

let fragment = readFileSync(join(src, 'index.html'), 'utf8');
if (/<!doctype|<html[\s>]|<body[\s>]/i.test(fragment)) {
  throw new Error('game/index.html must stay a fragment without <!doctype>, <html> or <body>.');
}
fragment = fragment.replace(/^\s*<meta charset="utf-8">\s*/i, '');

// Everything up to the end of the first <style> block goes in <head>; the rest is the body.
const cut = fragment.search(/<\/style>/i);
if (cut < 0) throw new Error('Expected a <style> block in game/index.html.');
const headPart = fragment.slice(0, cut + '</style>'.length);
const bodyPart = fragment.slice(cut + '</style>'.length);

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0b1016">
<meta name="description" content="Silent Contract: a noir sniper game. One shot. One truth.">
<style>
:root { padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px); }
body { margin: 0; font: 14px system-ui, sans-serif; }
img { max-width: 100%; }
[hidden] { display: none !important; }
</style>
${headPart.trim()}
</head>
<body>
${bodyPart.trim()}
</body>
</html>
`;

writeFileSync(join(out, 'index.html'), html);
writeFileSync(join(out, '.nojekyll'), '');
if (!existsSync(join(out, 'js', 'ui.js'))) throw new Error('dist/js/ui.js is missing.');
console.log('Built dist/ (' + html.length + ' bytes of HTML).');
