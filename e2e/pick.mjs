// Picks a choice in a choice box the way a person does: the studio's own (ui/Select.tsx, a Radix Select: open it, press the choice) or the browser's
// <select> (telephony keeps those). `choice` is the option's value, or { label } for its words, or { index }.
export async function pick(page, box, choice) {
  const tag = await box.first().evaluate((el) => el.tagName);
  if (tag === 'SELECT') {
    await box.first().selectOption(choice);
    return;
  }
  await box.first().click();
  const list = page.locator('.rxSelectList');
  await list.waitFor({ timeout: 10000 });
  const option =
    choice && typeof choice === 'object'
      ? choice.index !== undefined
        ? list.getByRole('option').nth(choice.index)
        : list.getByRole('option', { name: choice.label, exact: true })
      : list.locator(`[role="option"][data-value="${String(choice).replace(/"/g, '\\"')}"]`);
  await option.first().click();
  await list.waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
}

// What a choice box shows as chosen (its words), for either kind.
export async function chosen(box) {
  return box.first().evaluate((el) => (el.tagName === 'SELECT' ? el.options[el.selectedIndex]?.text || '' : el.textContent.trim()));
}

// The chosen value of a choice box (button.value) or a <select>.
export async function valueOf(box) {
  return box.first().evaluate((el) => el.value);
}

// The words of every choice, as a person reads them by opening the list (and closing it again); a <select>'s options as they are.
export async function choiceTexts(page, box) {
  const tag = await box.first().evaluate((el) => el.tagName);
  if (tag === 'SELECT') return box.first().evaluate((el) => [...el.options].map((o) => o.text));
  await box.first().click();
  const list = page.locator('.rxSelectList');
  await list.waitFor({ timeout: 10000 });
  const texts = await list.getByRole('option').allInnerTexts();
  await page.keyboard.press('Escape');
  await list.waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
  return texts.map((t) => t.replace(/\s+/g, ' ').trim());
}
