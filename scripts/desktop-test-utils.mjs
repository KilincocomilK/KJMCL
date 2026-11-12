import { expect } from '@playwright/test';

export async function navigateWorkspace(page, name) {
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

export async function firstVisibleWindow(app) {
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
  return page;
}
