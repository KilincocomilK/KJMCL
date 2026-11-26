import { expect } from '@playwright/test';

export async function navigateWorkspace(page, name) {
  if (['皮肤编辑器', '种子地图', '投影工坊'].includes(name)) {
    await page.getByRole('button', { name: '工具箱', exact: true }).click();
    await page.getByRole('button', { name: new RegExp(name) }).click();
    return;
  }
  const targets = {
    账户: ['账户管理'],
    模组中心: ['资源管理'],
    存档备份: ['存档管理', '存档备份'],
    性能与诊断: ['诊断与维护', '性能诊断'],
    游戏日志: ['诊断与维护', '游戏日志'],
    崩溃报告: ['诊断与维护', '崩溃报告'],
    磁盘管理: ['诊断与维护', '磁盘管理'],
  };
  const [workspace, tab] = targets[name] ?? [name];
  await page.getByRole('button', { name: workspace, exact: true }).click();
  if (tab) await page.getByRole('tab', { name: tab, exact: true }).click();
}

export async function dismissWelcome(page) {
  await page.waitForSelector('h1');
  const skip = page.getByTitle('跳过整个欢迎引导', { exact: true });
  if (await skip.isVisible()) {
    await skip.click();
    await expect(page.getByRole('heading', { name: '开始游戏', exact: true })).toBeVisible();
  }
}

export async function firstVisibleWindow(app, { welcome = false } = {}) {
  const page = await app.firstWindow();
  await page.waitForLoadState('load');
  const window = await app.browserWindow(page);
  try {
    // DOM visibility alone does not mean a show:false native window can paint.
    await expect
      .poll(() => window.evaluate((w) => w.isVisible() && !w.isMinimized()), { timeout: 15000 })
      .toBe(true);
  } finally {
    await window.dispose();
  }
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  if (!welcome) await dismissWelcome(page);
  return page;
}

/** Exercise the visible launcher dropdown rather than its hidden form control. */
export async function selectLauncherOption(page, name, value) {
  const trigger = page.getByRole('combobox', { name, exact: true });
  await trigger.click();
  const options = page.getByRole('listbox').getByRole('option');
  const index = await options.evaluateAll(
    (nodes, selected) => nodes.findIndex((node) => node.dataset.value === selected),
    String(value),
  );
  expect(index, `Dropdown ${name} contains value ${value}`).toBeGreaterThanOrEqual(0);
  await options.nth(index).click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
}

export async function answerSystemDialog(app, action, answer) {
  const dialog = app.waitForEvent('window').then(async (page) => {
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await expect(page.locator('footer .primary')).toBeFocused();
    expect(await page.evaluate(() => typeof window.kjmcl)).toBe('undefined');
    await answer(page);
  });
  const [, result] = await Promise.all([dialog, action()]);
  return result;
}

export async function closeFixtureApp(app) {
  const timer = setTimeout(() => app.process().kill(), 8000);
  app.on('window', (page) => {
    void page
      .getByRole('button', { name: '退出启动器', exact: true })
      .click({ timeout: 4000 })
      .catch(() => {});
  });
  try {
    await app.close();
  } finally {
    clearTimeout(timer);
  }
}
