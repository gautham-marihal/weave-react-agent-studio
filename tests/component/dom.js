// Test support for rendering the form in jsdom: a browser-like global environment, the schema served to `fetch`, the harness bundled
// by esbuild (it is JSX), and small helpers to click, type and look things up the way a person would.
import { readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';

const schema = readFileSync(new URL('../fixtures/agent-config.schema.json', import.meta.url), 'utf8');

const channels = [];

// Closes what the test environment opened, so the process can end.
export function teardownDom() {
  channels.splice(0).forEach((channel) => { channel.port1.close(); channel.port2.close(); });
  window.close();
}

export async function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
  const { window } = dom;
  const globals = {
    window, document: window.document, HTMLElement: window.HTMLElement, HTMLInputElement: window.HTMLInputElement, HTMLSelectElement: window.HTMLSelectElement,
    HTMLTextAreaElement: window.HTMLTextAreaElement, Node: window.Node, Element: window.Element, Event: window.Event, MouseEvent: window.MouseEvent,
    KeyboardEvent: window.KeyboardEvent, CustomEvent: window.CustomEvent, MutationObserver: window.MutationObserver, localStorage: window.localStorage,
    sessionStorage: window.sessionStorage, getComputedStyle: window.getComputedStyle.bind(window), requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  };
  Object.entries(globals).forEach(([key, value]) => Object.defineProperty(globalThis, key, { value, configurable: true, writable: true }));
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
  window.Element.prototype.scrollIntoView = () => {};
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  // React's act() opens a MessageChannel for every flush and never closes it; the open ports would keep the test process alive
  // after the tests end. They are remembered here and closed by teardownDom().
  const NativeChannel = globalThis.MessageChannel;
  Object.defineProperty(globalThis, 'MessageChannel', { configurable: true, writable: true, value: class extends NativeChannel { constructor() { super(); channels.push(this); } } });
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/schema')) return new Response(schema, { status: 200, headers: { 'Content-Type': 'application/json' } });
    return new Response(JSON.stringify({ detail: `no such endpoint in the test: ${url}` }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  };

  const dir = join(tmpdir(), 'weave-component-tests');
  mkdirSync(dir, { recursive: true });
  const outfile = join(dir, `harness-${process.pid}-${Date.now()}.mjs`);
  await build({
    entryPoints: [fileURLToPath(new URL('./harness.jsx', import.meta.url))],
    outfile, bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic', logLevel: 'error',
    loader: { '.css': 'empty' }, define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"development"' },
  });
  return import(pathToFileURL(outfile).href);
}

// ---- looking things up and acting, wrapped in act() so React has finished when they return
export const $ = (root, selector) => root.querySelector(selector);
export const $$ = (root, selector) => [...root.querySelectorAll(selector)];
export const textOf = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
export const byText = (root, selector, pattern) => $$(root, selector).find((el) => (pattern instanceof RegExp ? pattern.test(textOf(el)) : textOf(el) === pattern)) || null;
export const byLabel = (root, label) => $$(root, '[aria-label]').find((el) => el.getAttribute('aria-label') === label) || null;

export function actions(act) {
  const nativeSet = (el, value) => {
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  };
  return {
    async click(el) { if (!el) throw new Error('nothing to click'); await act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); }); },
    async type(el, value) { if (!el) throw new Error('nothing to type in'); await act(async () => { nativeSet(el, value); el.dispatchEvent(new window.Event('input', { bubbles: true })); }); },
    async choose(el, value) {
      if (!el) throw new Error('nothing to choose in');
      if (el.getAttribute('role') === 'combobox') {
        // a searchable list (SmartSelect): open it, and press on the option with this value (or this text)
        await act(async () => { el.focus(); el.click(); });
        const list = window.document.getElementById(el.getAttribute('aria-controls'));
        const option = [...(list?.querySelectorAll('[role=option]') || [])].find((o) => o.dataset.value === value || textOf(o) === value || textOf(o).replace(/ ✓$/, '') === value);
        if (!option) throw new Error(`the list has no option “${value}”`);
        await act(async () => { option.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true })); });
        return;
      }
      await act(async () => { nativeSet(el, value); el.dispatchEvent(new window.Event('change', { bubbles: true })); });
    },
    // the texts of the choices of a select, or of a searchable list (opened to read it, then closed again)
    async options(el) {
      if (el.getAttribute('role') !== 'combobox') return [...el.options].map((o) => o.text);
      await act(async () => { el.focus(); el.click(); });
      const list = window.document.getElementById(el.getAttribute('aria-controls'));
      const texts = [...list.querySelectorAll('[role=option]')].map((o) => textOf(o).replace(/ ✓$/, ''));
      await act(async () => { el.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
      return texts;
    },
    async check(el) { if (!el) throw new Error('nothing to check'); await act(async () => { el.click(); }); },
    // goes to a screen of "All settings" by its id ('tools', 'defaults.models'…), opening the group that holds it
    async section(root, id) {
      const chip = () => $(root, `[data-section="${id}"]`);
      if (!chip()) {
        for (const tab of $$(root, '.stFNavGroups [role=tab]')) {
          await act(async () => { tab.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); });
          if (chip()) break;
        }
      }
      const target = chip();
      if (!target) throw new Error(`no screen “${id}”`);
      await act(async () => { target.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); });
    },
  };
}
