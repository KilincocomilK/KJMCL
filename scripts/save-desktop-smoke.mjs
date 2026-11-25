import { answerSystemDialog, firstVisibleWindow } from './desktop-test-utils.mjs';
import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createSaveFixture, regionFixture } from './save-fixtures.mjs';
const root = await mkdtemp(path.join(os.tmpdir(), 'kjmcl-saves-desktop-'));
const env = { ...process.env, KJMCL_DATA_DIR: root };
delete env.ELECTRON_RUN_AS_NODE;
delete env.KJMCL_DEV_URL;
let app, java;
async function checkMapPan(page, map) {
  await page.getByRole('button', { name: '停留热力图' }).click();
  await expect(map).toHaveAttribute('data-tiles', '2');
  const rect = await map.boundingBox();
  const x = rect.x + rect.width / 2,
    y = rect.y + rect.height / 2;
  const sample = () =>
    map.evaluate((el) => {
      const data = el
        .getContext('2d')
        .getImageData(
          Math.floor(el.width / 2),
          Math.floor(el.height / 2),
          Math.floor(el.width / 4),
          1,
        );
      return Array.from(data.data);
    });
  const before = await sample();
  await map.evaluate((el) => {
    const ctx = CanvasRenderingContext2D.prototype;
    const fill = ctx.fillRect;
    const draw = ctx.drawImage;
    let fills = 0,
      terrainDraws = 0;
    ctx.fillRect = function (...args) {
      if (this.canvas === el || !this.canvas.isConnected) fills++;
      return fill.apply(this, args);
    };
    ctx.drawImage = function (...args) {
      if ((this.canvas === el || !this.canvas.isConnected) && args[0] instanceof HTMLImageElement)
        terrainDraws++;
      return draw.apply(this, args);
    };
    window.stopPanSample = () => {
      ctx.fillRect = fill;
      ctx.drawImage = draw;
      return { fills, terrainDraws };
    };
  });
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 40, y, { steps: 16 });
  await expect.poll(sample).not.toEqual(before);
  await page.mouse.up();
  const { fills, terrainDraws } = await page.evaluate(() => window.stopPanSample());
  console.log(
    '40 CSS px pan with chunk heat enabled:',
    fills,
    'canvas fills,',
    terrainDraws,
    'terrain image draws',
  );
  expect(fills).toBeLessThan(100);
  expect(terrainDraws).toBeLessThanOrEqual(6);
  await page.mouse.down();
  await page.mouse.move(x + Math.min(220, rect.width / 3), y, { steps: 8 });
  await page.mouse.move(x, y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(sample).toEqual(before);
  await page.getByRole('button', { name: '停留热力图' }).click();
  await page.getByRole('button', { name: '回到世界中心' }).click();
}
try {
  app = await electron.launch(
    process.env.KJMCL_EXECUTABLE
      ? { executablePath: process.env.KJMCL_EXECUTABLE, args: [], env }
      : { args: ['.'], env },
  );
  const page = await firstVisibleWindow(app);
  await page.waitForSelector('h1');
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const id = await page.evaluate(() =>
    window.kjmcl.createInstance({ name: 'Rust 存档测试', version: '1.21.1', loader: 'vanilla' }),
  );
  const world = path.join(root, 'instances', id, 'saves', 'Fixture');
  const original = await createSaveFixture(world);
  const emptyEntities = path.join(world, 'entities/r.0.0.mca');
  await mkdir(path.dirname(emptyEntities));
  await writeFile(emptyEntities, Buffer.alloc(0));
  await writeFile(path.join(world, 'region/r.-1.0.mca'), regionFixture(2));
  const originalLevel = await readFile(path.join(world, 'level.dat'));
  await writeFile(path.join(world, 'icon.png'), await readFile('build/icon.png'));
  await page.getByRole('button', { name: '存档管理', exact: true }).click();
  const worldRow = page.getByRole('button', { name: /测试世界/ });
  await expect(worldRow.locator('.local-resource-art img')).toHaveJSProperty('naturalWidth', 64);
  await page.getByLabel('搜索存档').fill('测试 fixture');
  await expect(page.getByLabel('区块地表地图')).toBeVisible();
  const bounds = await Promise.all([
    page.locator('.save-workspace-bar .workspace-instance').boundingBox(),
    page.getByRole('tablist', { name: '存档管理视图' }).boundingBox(),
  ]);
  expect(bounds[0].x + bounds[0].width).toBeLessThanOrEqual(bounds[1].x);
  await worldRow.click();
  await expect(page.getByRole('heading', { name: '测试世界', exact: true })).toBeVisible();
  await expect(page.getByLabel('区块地表地图')).toBeVisible();
  const map = page.getByLabel('区块地表地图');
  await expect(page.locator('.save-detail')).not.toContainText(
    /缓存命中|地表解码|地表示意色|只清理当前区域/,
  );
  await expect
    .poll(() => map.evaluate((c) => c.getContext('2d').getImageData(8, 8, 1, 1).data[3]))
    .toBe(255);
  await expect(map).toHaveAttribute('data-tiles', '2');
  await page.getByRole('button', { name: '放大地图' }).click();
  await page.getByRole('button', { name: '缩小地图' }).click();
  await page.getByRole('button', { name: '适应全图' }).click();
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: '缩小地图' }).click();
  await expect(map).not.toHaveAttribute('data-resolution', '512');
  await expect(map).toHaveAttribute('data-tiles', '2');
  await page.getByRole('button', { name: '回到世界中心' }).click();
  const mapPoint = async (dx, dz) => {
    const rect = await map.boundingBox();
    return { x: rect.x + rect.width / 2 + dx, y: rect.y + rect.height / 2 + dz };
  };
  await checkMapPan(page, map);
  const mark = async (tool, dx = 48, dz = 0) => {
    await page.getByRole('button', { name: tool, exact: true }).click();
    const p = await mapPoint(dx, dz);
    await page.mouse.click(p.x, p.y);
  };
  await mark('画笔');
  await expect(page.getByText('已选 1 个', { exact: true })).toBeVisible();
  await mark('擦除');
  await expect(page.getByText('已选 0 个', { exact: true })).toBeVisible();
  const start = await mapPoint(40, 0),
    end = await mapPoint(78, 20);
  const dragBox = async (mode, from, to) => {
    await page.getByRole('button', { name: mode, exact: true }).click();
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 5 });
    await page.mouse.up();
  };
  const count = async () =>
    Number((await page.locator('.atlas-selection span').innerText()).match(/\d+/)[0]);
  await mark('画笔', 109, 8);
  await dragBox('框选添加', start, end);
  await expect.poll(count).toBeGreaterThan(3);
  const selected = await count();
  await dragBox('框选添加', end, start);
  expect(await count()).toBe(selected);
  await dragBox('框选移除', end, end);
  await expect.poll(count).toBe(selected - 1);
  await dragBox('框选移除', end, start);
  await expect.poll(count).toBe(1);
  await page.getByRole('button', { name: '清空选择' }).click();
  await mark('设置出生点');
  const spawnDialog = page.getByRole('dialog', { name: '设置世界出生点' });
  async function checkGutters(dialog, field) {
    const box = await dialog.boundingBox();
    const input = await field.boundingBox();
    expect(input.x - box.x).toBeGreaterThanOrEqual(16);
    expect(box.x + box.width - input.x - input.width).toBeGreaterThanOrEqual(16);
  }
  await checkGutters(spawnDialog, spawnDialog.getByLabel('出生点 Y'));
  await spawnDialog.getByLabel('出生点 Y').fill('72');
  await spawnDialog.getByRole('button', { name: '保存出生点' }).click();
  await expect(spawnDialog).not.toBeVisible();
  const changedSpawn = (
    await page.evaluate((id) => window.kjmcl.scanWorld({ id, world: 'Fixture' }), id)
  ).metadata.spawn;
  expect(changedSpawn.y).toBe(72);
  expect(changedSpawn.x).toBeGreaterThan(0);
  await page.getByRole('button', { name: '撤销', exact: true }).first().click();
  await expect
    .poll(async () => (await readFile(path.join(world, 'level.dat'))).equals(originalLevel))
    .toBe(true);
  await page.getByRole('button', { name: '游戏规则', exact: true }).click();
  const rules = page.getByRole('dialog', { name: '游戏规则' });
  await checkGutters(rules, rules.getByLabel('搜索游戏规则'));
  await expect(rules.getByText(/保留背包物品和经验/)).toBeVisible();
  await rules.getByRole('switch', { name: '死亡保留物品' }).click();
  const reviewRules = () => rules.getByRole('button', { name: /审阅更改/ }).click();
  await answerSystemDialog(app, reviewRules, async (dialog) => {
    await expect(dialog.getByText(/关闭 → 开启/)).toBeVisible();
    await dialog.getByRole('button', { name: '取消' }).click();
  });
  expect(await readFile(path.join(world, 'level.dat'))).toEqual(originalLevel);
  await answerSystemDialog(app, reviewRules, (dialog) =>
    dialog.getByRole('button', { name: '保存规则' }).click(),
  );
  await expect(rules).not.toBeVisible();
  expect(
    (await page.evaluate((id) => window.kjmcl.scanWorld({ id, world: 'Fixture' }), id)).metadata
      .rules.keepInventory,
  ).toBe('true');
  await page.getByRole('button', { name: '撤销', exact: true }).first().click();
  await expect
    .poll(async () => (await readFile(path.join(world, 'level.dat'))).equals(originalLevel))
    .toBe(true);
  const destination = path.join(root, 'world-backup.zip');
  await app.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, destination);
  await page.getByRole('button', { name: '备份', exact: true }).click();
  const backup = page.getByRole('dialog', { name: '备份世界' });
  await checkGutters(backup, backup.getByLabel('备份导出路径'));
  await backup.getByRole('button', { name: '选择路径' }).click();
  await expect(backup.getByLabel('备份导出路径')).toHaveValue(destination);
  await backup.getByRole('button', { name: '开始备份' }).click();
  const records = () => page.evaluate((id) => window.kjmcl.backups(id), id);
  await expect.poll(async () => (await records()).length).toBe(1);
  const internal = path.join(root, 'backups', id, (await records())[0].id + '.zip');
  await expect
    .poll(
      async () =>
        await readFile(destination)
          .then(async (b) => b.equals(await readFile(internal)))
          .catch(() => false),
    )
    .toBe(true);
  await page.getByRole('button', { name: '属性', exact: true }).click();
  await page.getByLabel('世界名称').fill('Rust 编辑验收');
  await page.getByRole('button', { name: '备份并保存', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Rust 编辑验收', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '撤销', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: '测试世界', exact: true })).toBeVisible();
  await expect(map).toBeVisible();
  await page.getByText('定位与筛选', { exact: true }).click();
  await expect(map).toHaveAttribute('data-tiles', '2');
  await page.getByLabel('出生点保护半径').fill('0');
  await page.getByLabel('最大停留分钟').fill('5');
  await page.getByRole('button', { name: '选择符合条件的区块', exact: true }).click();
  await expect(page.getByText('已选 8 个', { exact: true })).toBeVisible();
  const history = () =>
    page.evaluate(
      async (id) => (await window.kjmcl.scanWorld({ id, world: 'Fixture' })).history,
      id,
    );
  const historyBefore = await history();
  const preview = page.getByRole('button', { name: '删除区块', exact: true });
  const review = page.getByRole('dialog', { name: '区块清理预览' });
  const proceed = review.getByRole('button', { name: '继续清理…', exact: true });
  await preview.click();
  await expect(review).toContainText('可清理 8 个区块');
  await review.getByRole('button', { name: '取消', exact: true }).click();
  await expect(review).not.toBeVisible();
  await preview.click();
  await answerSystemDialog(
    app,
    () => proceed.click(),
    async (dialog) => {
      await expect(dialog.getByRole('alertdialog')).toContainText('主世界的 8 个区块');
      await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeFocused();
      await dialog.getByRole('button', { name: '取消', exact: true }).click();
    },
  );
  await expect(proceed).toBeEnabled();
  expect(await history()).toEqual(historyBefore);
  expect((await readFile(path.join(world, 'region/r.0.0.mca'))).equals(original)).toBe(true);
  expect(await readFile(path.join(world, 'region/r.-1.0.mca'))).toEqual(regionFixture(2));
  await answerSystemDialog(
    app,
    () => proceed.click(),
    (dialog) => dialog.getByRole('button', { name: '备份并清理', exact: true }).click(),
  );
  await expect
    .poll(() =>
      page.evaluate(
        async (id) =>
          (await window.kjmcl.scanWorld({ id, world: 'Fixture' })).dimensions[0].regions.find(
            (r) => r.x === 0 && r.z === 0,
          ).chunks,
        id,
      ),
    )
    .toBe(1018);
  await expect(page.getByText('清理 8 个区块', { exact: true })).toBeVisible();
  expect(await readFile(emptyEntities)).toHaveLength(0);
  await page.getByRole('button', { name: '撤销', exact: true }).first().click();
  await expect
    .poll(() => readFile(path.join(world, 'region/r.0.0.mca')).then((b) => b.equals(original)))
    .toBe(true);
  expect(await readFile(path.join(world, 'region/r.-1.0.mca'))).toEqual(regionFixture(2));
  // Validate Java FileChannel lock interoperability, not only Rust-on-Rust locking.
  const source = path.join(root, 'WorldLock.java');
  await writeFile(
    source,
    'import java.nio.channels.*; import java.nio.file.*; class WorldLock { public static void main(String[] a) throws Exception { try (var c=FileChannel.open(Path.of(a[0]),StandardOpenOption.CREATE,StandardOpenOption.WRITE); var l=c.lock()) { System.out.println("LOCKED"); System.out.flush(); Thread.sleep(60000); } } }',
  );
  java = spawn('java', [source, path.join(world, 'session.lock')], {
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Java world lock timeout')), 15000);
    java.stdout.on('data', (b) => {
      if (b.toString().includes('LOCKED')) {
        clearTimeout(timer);
        resolve();
      }
    });
    java.on('error', reject);
  });
  const locked = await page.evaluate(async (id) => {
    try {
      await window.kjmcl.editWorld({ id, world: 'Fixture', patch: { name: 'must not write' } });
      return false;
    } catch (e) {
      return String(e).includes('正在被');
    }
  }, id);
  expect(locked).toBe(true);
  java.kill();
  java = undefined;
  const rejected = await page.evaluate(async (id) => {
    try {
      await window.kjmcl.scanWorld({ id, world: '../escape' });
      return false;
    } catch {
      return true;
    }
  }, id);
  expect(rejected).toBe(true);
  await expect(map).toBeVisible();
  await mkdir('.local', { recursive: true });
  await page.locator('.save-browser .pane-content').evaluate((el) => el.scrollTo(0, 0));
  await page.screenshot({ path: '.local/save-manager-v050.png' });
  await map.scrollIntoViewIfNeeded();
  await page.screenshot({ path: '.local/save-manager-map-v050.png' });
  expect(errors).toEqual([]);
  console.log(
    'PASS automatic terrain, cross-region edits, game-rule confirmation/undo, ZIP export, Java FileChannel lock and IPC validation (synthetic save)',
  );
} finally {
  java?.kill();
  if (app) await app.close();
  if (path.basename(root).startsWith('kjmcl-saves-desktop-'))
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}
