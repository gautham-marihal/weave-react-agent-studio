// The agent's JSON on Settings › Edit as JSON. The code editor (CodeMirror) draws only the lines in sight, so the whole text is read through the editor's
// own hook (weaveJsonText, on its frame); writing selects everything and puts the new text in at once, as a paste does, then waits until the editor
// holds exactly that.
const FRAME = '.nlPage .stEditor';

export async function readJson(page) {
  await page.waitForSelector(`${FRAME} .cm-content`, { timeout: 20000 });
  await page.waitForFunction((frame) => (document.querySelector(frame)?.weaveJsonText?.() || '').length > 20, FRAME, { timeout: 20000 });
  return page.evaluate((frame) => document.querySelector(frame).weaveJsonText(), FRAME);
}

export async function writeJson(page, text) {
  await page.locator(`${FRAME} .cm-content`).click({ position: { x: 24, y: 8 } });
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(text);
  await page.waitForFunction(([frame, wanted]) => document.querySelector(frame)?.weaveJsonText?.() === wanted, [FRAME, text], { timeout: 20000 });
}
