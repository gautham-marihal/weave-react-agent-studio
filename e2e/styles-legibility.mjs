// Can every style be read? In a real browser, for each design style in light and in dark, open Home, Agents, an agent's
// Build page and Calls, and measure the contrast of every piece of visible text against what is behind it (4.5:1, or
// 3:1 for large text). Text over a gradient or an image can't be measured this way and is skipped.
// E2E_SHOTS=<dir> also saves a screenshot of each page in each style and mode.
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { check, suite } from './support/harness.mjs';

const STYLES = ['studio', 'simple', 'professional', 'calm', 'premium', 'futuristic', 'vibrant'];
const PAGES = [
  ['home', '/', /Overview|Good (morning|afternoon|evening)/],
  ['agents', '/agents', /Agents/],
  ['build', '/agents/acme-support/build', /Acme Support/],
  ['calls', '/calls', /Calls/],
];
const SHOTS = process.env.E2E_SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const { page, context, base, step, finish } = await suite('styles-legibility');
// the harness puts light back on every load; this puts back the mode the walk asks for
await context.addInitScript(() => {
  const mode = sessionStorage.getItem('e2e_theme');
  if (mode) localStorage.setItem('weave_theme', mode);
});

// runs in the page: visible text whose contrast with what is behind it is too low
function measure() {
  const parse = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] };
  };
  const lum = ({ r, g, b }) => {
    const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const over = (top, bottom) => ({
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
    a: 1,
  });
  const behind = (el) => {
    const chain = [];
    for (let e = el; e; e = e.parentElement) {
      const style = getComputedStyle(e);
      if (/gradient|url\(/.test(style.backgroundImage)) return null;
      const c = parse(style.backgroundColor);
      if (c && c.a > 0) {
        chain.push(c);
        if (c.a >= 1) break;
      }
    }
    const root = parse(getComputedStyle(document.body).backgroundColor);
    let bg = root && root.a > 0 ? { ...root, a: 1 } : { r: 255, g: 255, b: 255, a: 1 };
    for (const c of chain.reverse()) bg = over(c, bg);
    return bg;
  };
  const found = [];
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent.trim();
    const el = node.parentElement;
    // a lone separator (·, |, –) is decoration, not something to read
    if (!text || /^[·•|–—/]+$/.test(text) || !el || el.closest('script,style,svg,[aria-hidden="true"],.react-flow__minimap')) continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none' || el.closest(':disabled,[aria-disabled="true"]')) continue;
    let faded = false;
    for (let e = el; e; e = e.parentElement) if (Number(getComputedStyle(e).opacity) < 1) faded = true;
    if (faded) continue; // placeholders and things on their way in or out
    const box = el.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) continue;
    const key = `${el.tagName}.${el.className}|${text.slice(0, 24)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const fg = parse(style.color);
    const bg = behind(el);
    if (!fg || !bg) continue;
    const front = fg.a < 1 ? over(fg, bg) : fg;
    const [hi, lo] = [lum(front), lum(bg)].sort((a, b) => b - a);
    const ratio = (hi + 0.05) / (lo + 0.05);
    const size = parseFloat(style.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
    if (ratio < (large ? 3 : 4.5)) {
      const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter((c) => /^(text|bg)-/.test(c)).join(' ') : '';
      found.push(`${ratio.toFixed(2)}:1 “${text.slice(0, 40)}” <${el.tagName.toLowerCase()} ${cls}>`);
    }
  }
  return found;
}

for (const theme of ['light', 'dark']) {
  for (const style of STYLES) {
    await step(`${style} in ${theme}: Home, Agents, Build and Calls can be read`, async () => {
      await page.goto(`${base}/`, { timeout: 120_000 }); // the dev server's first page takes a while
      await page.evaluate(
        ({ s, t }) => {
          sessionStorage.setItem('e2e_theme', t);
          localStorage.setItem('weave_style', s);
          localStorage.removeItem(`weave_accent_${s}`);
        },
        { s: style, t: theme },
      );
      const low = [];
      for (const [name, route, text] of PAGES) {
        await page.goto(`${base}${route}`);
        await page.locator('main').waitFor();
        await page.waitForFunction((source) => new RegExp(source).test(document.querySelector('main')?.innerText || ''), text.source, { timeout: 15_000 });
        await page.waitForTimeout(400);
        const now = await page.evaluate(() => [document.documentElement.dataset.style, document.documentElement.dataset.theme]);
        check(now[0] === style && now[1] === theme, `the page is ${now.join('/')}`);
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${style}-${theme}-${name}.png`) });
        (await page.evaluate(measure)).forEach((p) => low.push(`${name}: ${p}`));
      }
      check(low.length === 0, `${low.length} hard to read:\n${low.slice(0, 12).join('\n')}`);
    });
  }
}
await page.evaluate(() => {
  sessionStorage.removeItem('e2e_theme');
  localStorage.setItem('weave_style', 'studio');
});

await finish();
