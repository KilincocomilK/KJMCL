import { expect } from '@playwright/test';

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
