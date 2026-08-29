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
// glyphScale is the cap height as a fraction of the canvas. The maskable one is
// smaller because its crop is unknown and can be a full circle, so its artwork
// has to survive inside the middle 80%.
const TARGETS = [
  { file: 'icon-192.png', size: 192, glyphScale: 0.58 },
  { file: 'icon-512.png', size: 512, glyphScale: 0.58 },
  { file: 'icon-maskable-512.png', size: 512, glyphScale: 0.62 },
];

const page = (size, glyphScale) => `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; background: transparent; }
  .icon {
    width: ${size}px; height: ${size}px;
    background: ${theme.bg};
    display: flex; align-items: center; justify-content: center;
    position: relative; overflow: hidden;
  }
  .t {
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif;
    font-size: ${Math.round(size * glyphScale)}px;
    font-weight: 700;
    /* No letter-spacing. It is meaningless for a single glyph and it is applied
       after the last character as well as between characters, so centring a
       one-letter line with it leaves the glyph off-centre by half the tracking -
       5px at 512, which a launcher crop then makes visible. */
    color: ${theme.ink};
    line-height: 1;
    /* The optical centre of a T sits above its bounding box centre. */
    transform: translateY(${-size * 0.012}px);
  }
</style></head><body><div class="icon"><div class="t">T</div></div></body></html>`;

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const out = path.join(__dirname, '..', 'icons');
  for (const t of TARGETS) {
    const ctx = await browser.newContext({ viewport: { width: t.size, height: t.size }, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    await p.setContent(page(t.size, t.glyphScale));
    await p.waitForTimeout(120);
    await p.locator('.icon').screenshot({ path: path.join(out, t.file), omitBackground: false });
    console.log(`${t.file}  ${t.size}x${t.size}`);
    await ctx.close();
  }
  await browser.close();
})();
