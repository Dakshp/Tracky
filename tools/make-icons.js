/**
 * Regenerates icons/ from one definition, so the set can never drift apart.
 *
 * Rendered through headless Chromium rather than drawn by hand because the three
 * files are the same artwork at different sizes and safe areas, and hand-editing
 * three PNGs is how a maskable icon ends up cropped differently from the one
 * beside it.
 *
 *   node tools/make-icons.js            # OLED black (the default)
 *   node tools/make-icons.js indigo     # the original purple
 *
 * A maskable icon is cropped by the launcher to whatever shape it likes - a
 * circle on some Androids - so its artwork must sit inside the middle 80%. The
 * plain icon has no such crop and can therefore run larger, which is why the two
 * are generated at different glyph scales rather than one file used twice.
 */
// Playwright is a dev-time tool here, not a dependency of the app, so it is
// resolved from wherever it happens to be installed rather than vendored into a
// project that otherwise has no node_modules at all.
const { chromium } = require(require('module')
  .createRequire('/opt/node22/lib/node_modules/')('playwright/package.json')
  ? '/opt/node22/lib/node_modules/playwright'
  : 'playwright');
const fs = require('fs');
const path = require('path');

const THEMES = {
  black: { bg: '#000000', ink: '#8f96ff' },
  indigo: { bg: '#5b53e8', ink: '#ffffff' },
};

const theme = THEMES[process.argv[2] || 'black'];
if (!theme) { console.error('Unknown theme'); process.exit(1); }

// All three are full-bleed squares with square corners. iOS masks a home-screen
// icon into its own squircle and Android into whatever shape the launcher uses,
// so rounding the corners here would round an already-rounded shape and leave
// transparent notches at the edges of the result.
//
// scale is applied to the mark about its own centre. The plain icons keep the
// original artwork exactly, at 1. The maskable one shrinks, because its crop is
// unknown and can be a full circle: at full size the mark's far corner sits
// 0.392 of the canvas from centre against a 0.4 limit, which is not a margin.
const TARGETS = [
  { file: 'icon-192.png', size: 192, scale: 1 },
  { file: 'icon-512.png', size: 512, scale: 1 },
  { file: 'icon-maskable-512.png', size: 512, scale: 0.82 },
];

/**
 * The mark, in fractions of the canvas, measured off the original artwork so
 * the recolour did not quietly redraw it. A font glyph was tried first and lost
 * two things that turn out to be the whole identity: the rounded stem ends, and
 * the dot beneath - which is what makes it a mark rather than a letter.
 */
const MARK = {
  bar: { x: 0.2402, y: 0.2598, w: 0.5195, h: 0.1348 },
  // Measured at mid-height, not near the ends: a span read inside the corner
  // rounding comes back narrower than the shape actually is, which is how the
  // first attempt at this rebuilt the stem three-quarters of its real width.
  stem: { x: 0.4277, y: 0.2598, w: 0.1445, bottom: 0.6582 },
  dot: { cx: 0.4990, cy: 0.7441, r: 0.0527 },
  radius: 0.0262,
};

// The mark sits a little below centre by design, so its own bounding box - not
// the canvas - is what has to be centred when the maskable version shrinks it.
const BOX = {
  minX: MARK.bar.x,
  maxX: MARK.bar.x + MARK.bar.w,
  minY: MARK.bar.y,
  maxY: MARK.dot.cy + MARK.dot.r,
};
const BOX_CX = (BOX.minX + BOX.maxX) / 2;
const BOX_CY = (BOX.minY + BOX.maxY) / 2;

function markSvg(scale) {
  const m = MARK;
  const inner = [
    `<rect x="${m.bar.x}" y="${m.bar.y}" width="${m.bar.w}" height="${m.bar.h}" rx="${m.radius}"/>`,
    `<rect x="${m.stem.x}" y="${m.stem.y}" width="${m.stem.w}" height="${(m.stem.bottom - m.stem.y).toFixed(4)}" rx="${m.radius}"/>`,
    `<circle cx="${m.dot.cx}" cy="${m.dot.cy}" r="${m.dot.r}"/>`,
  ].join('');
  // Centre the mark's own box, scale about that point, put it back.
  const t = scale === 1 ? '' :
    ` transform="translate(${(0.5 - BOX_CX * scale).toFixed(5)} ${(0.5 - BOX_CY * scale).toFixed(5)}) scale(${scale})"`;
  return `<g fill="${theme.ink}"${t}>${inner}</g>`;
}

const page = (size, scale) => `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; background: transparent; }
  .icon { width: ${size}px; height: ${size}px; background: ${theme.bg}; }
  svg { display: block; width: 100%; height: 100%; }
</style></head><body><div class="icon">
  <svg viewBox="0 0 1 1" xmlns="http://www.w3.org/2000/svg">${markSvg(scale)}</svg>
</div></body></html>`;

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const out = path.join(__dirname, '..', 'icons');
  for (const t of TARGETS) {
    const ctx = await browser.newContext({ viewport: { width: t.size, height: t.size }, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    await p.setContent(page(t.size, t.scale));
    await p.waitForTimeout(120);
    await p.locator('.icon').screenshot({ path: path.join(out, t.file), omitBackground: false });
    console.log(`${t.file}  ${t.size}x${t.size}`);
    await ctx.close();
  }
  await browser.close();
})();
