import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { firstVisibleWindow } from './desktop-test-utils.mjs';

// Deterministic local protocol fixture. No model or external MCP agent is contacted.
const root = await mkdtemp(path.join(os.tmpdir(), 'kjmcl-ai-desktop-'));
const fixtureKey = process.platform === 'win32' ? randomUUID() : '';
const fixture = createServer(async (request, response) => {
  response.setHeader('Content-Type', 'application/json');
  if (fixtureKey && request.headers.authorization !== 'Bearer ' + fixtureKey) {
    response.writeHead(401);
    return response.end();
  }
  if (request.url === '/v1/models')
    return response.end(JSON.stringify({ data: [{ id: 'desktop-fixture' }] }));
  if (request.url !== '/v1/chat/completions') {
    response.writeHead(404);
    return response.end();
  }
  const chunks = [];
  for await (const part of request) chunks.push(part);
  const body = JSON.parse(Buffer.concat(chunks).toString());
  if (body.model !== 'desktop-fixture') {
    response.writeHead(400);
    return response.end();
  }
  response.end(
    JSON.stringify({
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            content: null,
            tool_calls: [
              {
                id: 'test-1',
                type: 'function',
                function: {
                  name: 'configure_launcher',
                  arguments: '{"changes":{"concurrency":4}}',
                },
              },
            ],
          },
        },
      ],
    }),
  );
});
let app;
const errors = [];
try {
  await new Promise((resolve) => fixture.listen(0, '127.0.0.1', resolve));
  const env = { ...process.env, KJMCL_DATA_DIR: path.join(root, 'profile') };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.KJMCL_DEV_URL;
  const launch = async () => {
    app = await electron.launch(
      process.env.KJMCL_EXECUTABLE
        ? { executablePath: process.env.KJMCL_EXECUTABLE, args: [], env }
        : { args: ['.'], env },
    );
    const page = await firstVisibleWindow(app);
    page.on('pageerror', (e) => errors.push(e.message));
    await page.getByRole('button', { name: 'AI 助手', exact: true }).click();
    return page;
  };
  let page = await launch();
  await page.getByRole('button', { name: '配置模型服务' }).click();
  await page.getByRole('button', { name: '添加服务商', exact: true }).click();
  const modal = page.getByRole('dialog', { name: '添加服务商' });
  await modal.getByLabel('名称', { exact: true }).fill('本地测试服务');
  if (fixtureKey) await modal.getByLabel('API 密钥（可选）').fill(fixtureKey);
  await modal
    .getByRole('textbox', { name: /API 地址/ })
    .fill('http://127.0.0.1:' + fixture.address().port + '/v1');
  await modal.getByRole('button', { name: '添加', exact: true }).click();
  await expect(page.getByRole('heading', { name: '本地测试服务' })).toBeVisible();
  await page.getByRole('button', { name: '检测', exact: true }).click();
  await expect(page.getByText('连接成功 · 1 个模型')).toBeVisible();
  if (fixtureKey) {
    const credentials = path.join(root, 'profile/credentials');
    const keyFile = (await readdir(credentials)).find((file) => file.startsWith('ai-'));
    expect(keyFile).toBeTruthy();
    expect(
      (await readFile(path.join(credentials, keyFile))).includes(Buffer.from(fixtureKey)),
    ).toBe(false);
    expect(await readFile(path.join(root, 'profile/assistant/config.json'), 'utf8')).not.toContain(
      fixtureKey,
    );
    expect(await page.getByLabel('API 密钥', { exact: true }).inputValue()).toBe('');
  }
  await page.getByRole('button', { name: '同步模型', exact: true }).click();
  await expect(page.getByRole('button', { name: 'desktop-fixture', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await mkdir('.local', { recursive: true });
  await page.screenshot({ path: '.local/assistant-providers.png' });
  await page.getByRole('tab', { name: '对话', exact: true }).click();
  await page.getByRole('textbox', { name: '消息' }).fill('把并行下载数设为 4');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  const concurrency = () =>
    page.evaluate(async () => (await window.kjmcl.snapshot()).settings.concurrency);
  await expect(page.getByRole('button', { name: '应用修改' })).toBeVisible();
  expect(await concurrency()).toBe(6);
  await page.screenshot({ path: '.local/assistant-change.png' });
  await page.getByRole('button', { name: '应用修改' }).click();
  await expect.poll(concurrency).toBe(4);
  await page.getByText(/本次修改记录/).click();
  await page.getByRole('button', { name: '撤销修改' }).click();
  await expect.poll(concurrency).toBe(6);
  await page.getByRole('tab', { name: 'MCP 接入' }).click();
  await expect(page.getByRole('switch', { name: '已停止' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  if (process.platform === 'win32') {
    await page.getByLabel('端口', { exact: true }).fill(String(await freePort()));
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByRole('switch', { name: '已停止' }).click();
    await expect(page.getByRole('switch', { name: '运行中' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await page.getByRole('switch', { name: '运行中' }).click();
    await expect(page.getByRole('switch', { name: '已停止' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  }
  const win = await app.browserWindow(page);
  await win.evaluate((w) => w.setSize(960, 650));
  await win.dispose();
  for (const tab of ['模型服务', '对话', 'MCP 接入']) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    expect(await page.locator('main').evaluate((n) => n.scrollWidth <= n.clientWidth + 1)).toBe(
      true,
    );
    await expect(page.getByRole('button', { name: '账户管理', exact: true })).toBeInViewport();
  }
  await app.close();
  app = undefined;
  page = await launch();
  await expect(page.getByRole('log', { name: '对话消息' })).toContainText('已撤销');
  const historyRail = page.getByRole('complementary', { name: '对话历史' });
  await historyRail.getByRole('button', { name: '新对话', exact: true }).click();
  await expect(page.getByRole('log', { name: '对话消息' })).toBeEmpty();
  await historyRail.locator('.rail-option').first().click();
  await expect(page.getByRole('log', { name: '对话消息' })).toContainText('已撤销');
  const id = await page.evaluate(() =>
    window.kjmcl.createInstance({ name: '诊断测试实例', version: '1.21.1', loader: 'vanilla' }),
  );
  const dir = path.join(root, 'profile/diagnostics');
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, id + '.json'),
    JSON.stringify([
      {
        id: randomUUID(),
        instanceId: id,
        startedAt: Date.now(),
        status: 'failed',
        phase: '准备阶段',
        diagnoses: [],
        tail: [],
      },
    ]),
  );
  await page.getByRole('button', { name: '诊断与维护', exact: true }).click();
  await page.getByRole('tab', { name: '性能诊断', exact: true }).click();
  await page.getByRole('button', { name: '询问助手' }).click();
  await expect(page.getByRole('combobox', { name: '对话范围' })).toContainText('诊断测试实例');
  await expect(page.getByRole('textbox', { name: '消息' })).toHaveValue(/启动结果/);
  expect(errors).toEqual([]);
  console.log(
    'PASS assistant provider controls, local fixture conversation, config diff/apply/undo, history restart, MCP settings and compact layout',
  );
} finally {
  if (app) await app.close();
  const closed = new Promise((resolve) => fixture.close(resolve));
  fixture.closeAllConnections();
  await closed;
  await rm(root, { recursive: true, force: true });
}
async function freePort() {
  const temp = createServer();
  await new Promise((resolve) => temp.listen(0, '127.0.0.1', resolve));
  const port = temp.address().port;
  await new Promise((resolve) => temp.close(resolve));
  return port;
}
