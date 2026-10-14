// Builds a single self-contained HTML file (JS + CSS inlined) from dist/.
// Usage: npm run build && node scripts/build-standalone.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'dist';
let html = readFileSync(join(dist, 'index.html'), 'utf8');
const js = html.match(/<script type="module" crossorigin src="\.\/([^"]+)"><\/script>/);
const css = html.match(/<link rel="stylesheet" crossorigin href="\.\/([^"]+)">/);
if (!js || !css) throw new Error('Unexpected dist/index.html layout');
const jsCode = readFileSync(join(dist, js[1]), 'utf8').replace(/<\/script/gi, '<\\/script');
const cssCode = readFileSync(join(dist, css[1]), 'utf8');
// function replacers: the bundle contains `$` sequences that string patterns would expand
html = html.replace(js[0], () => '').replace(css[0], () => `<style>${cssCode}</style>`);
html = html.replace('</body>', () => `<script type="module">${jsCode}</script>\n</body>`);
mkdirSync('standalone', { recursive: true });
writeFileSync('standalone/index.html', html);

// Artifact variant: page content only (the host adds the document skeleton).
const head = html.match(/<head>([\s\S]*?)<\/head>/)[1].replace(/<meta charset[^>]*>|<meta name="viewport"[^>]*>/g, '');
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
const extra = '<meta name="claude:viewport-fit-sides" content="cover"><style>:root{color-scheme:dark}html,body{height:100%;background:#14243d}</style>';
writeFileSync('standalone/artifact.html', head.replace('</title>', () => '</title>' + extra) + body);
console.log('standalone/index.html', (html.length / 1024).toFixed(0) + ' KB');
