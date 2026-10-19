// Writes the static brand files in public/brand (and the favicons) from src/brand/glyphs.ts.
// Run `npm run brand` after changing the glyphs. Needs Node 22.18+ to import the .ts file.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { GLYPHS, WORDMARK, MARK, GRADIENT } from '../src/brand/glyphs.ts';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const OUT = `${PUBLIC}brand/`;
mkdirSync(OUT, { recursive: true });

const INK = '#ebe9f4';
const NAVY = '#161925';
const TILE = '#1c2030';
const AGENT = GRADIENT[0];

const stops = GRADIENT.map((c, k) => `<stop offset="${k / (GRADIENT.length - 1)}" stop-color="${c}"/>`).join('');
/** The wordmark gradient, shifted so a letter drawn at its own origin gets its slice of it. */
const wordGradient = (id, x = 0) => `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${-x}" y1="0" x2="${WORDMARK.width - x}" y2="0">${stops}</linearGradient>`;
const markGradient = `<linearGradient id="m" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${MARK.width}" y2="${MARK.height}">${stops}</linearGradient>`;

const stroke = (g, paint) => `<path d="${g.d}" fill="none" stroke="${paint}" stroke-width="${g.weight}" stroke-linecap="round" stroke-linejoin="${g.join}"/>`;
const dot = (d, paint) => `<circle cx="${d.cx}" cy="${d.cy}" r="${d.r}" fill="${paint}"/>`;
const svg = (viewBox, body, label = 'Vibe') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-label="${label}">${body}</svg>\n`;

const files = {};

// The wordmark: gradient letters with a white dot for dark backgrounds, a navy dot for light ones.
const word = (letterPaint, dotPaint, defs = '') => {
  const body = WORDMARK.letters.map(({ name, x }) => {
    const g = GLYPHS[name];
    return `<g transform="translate(${x} 0)">${stroke(g, letterPaint(name, x))}${g.dot ? dot(g.dot, dotPaint) : ''}</g>`;
  }).join('');
  const pad = 2;
  return svg(`${-pad} ${-pad} ${WORDMARK.width + pad * 2} ${WORDMARK.height + pad * 2}`, `<defs>${defs}</defs>${body}`);
};
const perLetter = WORDMARK.letters.map(({ name, x }) => wordGradient(`g-${name}`, x)).join('');
files['wordmark.svg'] = word((name) => `url(#g-${name})`, '#ffffff', perLetter);
files['wordmark-light.svg'] = word((name) => `url(#g-${name})`, NAVY, perLetter);
files['wordmark-mono.svg'] = word(() => INK, AGENT);

// Each letter on its own, with its slice of the gradient, so they line up again side by side.
for (const { name, x } of WORDMARK.letters) {
  const g = GLYPHS[name];
  files[`letter-${name.toLowerCase()}.svg`] = svg(`-2 -2 ${g.width + 4} ${WORDMARK.height + 4}`, `<defs>${wordGradient('g', x)}</defs>${stroke(g, 'url(#g)')}${g.dot ? dot(g.dot, '#ffffff') : ''}`, name);
}

// The mark: the V holding the dot.
const pad = 4;
const markBody = (vPaint, dotPaint) => `${stroke(MARK.glyph, vPaint)}${dot(MARK.dot, dotPaint)}`;
const markBox = `${-pad} ${-pad} ${MARK.width + pad * 2} ${MARK.height + pad * 2}`;
files['mark.svg'] = svg(markBox, `<defs>${markGradient}</defs>${markBody('url(#m)', '#ffffff')}`);
files['mark-mono.svg'] = svg(markBox, markBody(INK, AGENT));

// On a tile, for favicons and app icons. `round` is the corner radius as a share of the side.
const TILE_SIZE = 160;
const tile = (round) => {
  const s = TILE_SIZE, scale = (s * 0.64) / MARK.height;
  const tx = (s - MARK.width * scale) / 2, ty = (s - MARK.height * scale) / 2;
  return svg(`0 0 ${s} ${s}`, `<defs>${markGradient}</defs><rect width="${s}" height="${s}" rx="${s * round}" fill="${TILE}"/><g transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${scale})">${markBody('url(#m)', '#ffffff')}</g>`);
};
files['icon.svg'] = tile(0);
for (const [name, body] of Object.entries(files)) writeFileSync(OUT + name, body);
writeFileSync(`${PUBLIC}favicon.svg`, tile(0.22));

// iOS home screen and other places that want a bitmap. iOS rounds the corners itself.
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {});
const page = await browser.newPage();
for (const [file, size] of [['apple-touch-icon.png', 180], ['brand/icon-512.png', 512]]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${files['icon.svg']}`);
  await page.screenshot({ path: PUBLIC + file, omitBackground: false });
}
// The link preview card: the wordmark under a stage light.
await page.setViewportSize({ width: 1200, height: 630 });
await page.setContent(`<style>html,body{margin:0;height:100%}body{display:grid;place-items:center;background:radial-gradient(closest-side at 42% 50%,rgba(182,156,255,.2),transparent),radial-gradient(closest-side at 64% 56%,rgba(255,143,207,.1),transparent) ${NAVY}}svg{height:250px;filter:drop-shadow(0 0 50px rgba(255,143,207,.2))}</style>${files['wordmark.svg']}`);
await page.screenshot({ path: `${OUT}og.jpg`, type: 'jpeg', quality: 90 });
await browser.close();
console.log(`Wrote ${Object.keys(files).length + 4} files to public/`);
