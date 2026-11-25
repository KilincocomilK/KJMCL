import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import electron from 'electron';
import assert from 'node:assert/strict';
const exec = promisify(execFile);
const root = realpathSync.native(await mkdtemp(path.join(os.tmpdir(), 'kjmcl-uninstall-test-')));
const harness = path.join(root, 'harness.cjs');
const entry = process.env.KJMCL_ASAR
  ? path.join(process.env.KJMCL_ASAR, 'dist-electron/main.cjs')
  : path.resolve('dist-electron/main.cjs');
await writeFile(
  harness,
  `
const {app,dialog}=require('electron');
const fs=require('node:fs');
process.argv.push('--kjmcl-uninstall-data');
app.on('browser-window-created', (_event, win) => {
 win.once('show', async () => {
   const collect = () => ({
     title: document.querySelector('h1').textContent,
     focus: document.activeElement.textContent,
     buttons: [...document.querySelectorAll('footer button')].map(b => b.textContent),
     paths: [...document.querySelectorAll('#paths li')].map(li => li.textContent),
     launcherApi: typeof window.kjmcl
   });
   const content = await win.webContents.executeJavaScript('(' + collect.toString() + ')()');
   fs.writeFileSync(process.env.KJMCL_TEST_REPORT,JSON.stringify({content,profile:app.getPath('userData')}));
   const label = ['保留数据并卸载','删除数据并卸载','关闭'][Number(process.env.KJMCL_TEST_CHOICE)];
   await win.webContents.executeJavaScript(
     '[...document.querySelectorAll("button")].find(b => (b.ariaLabel || b.textContent) === ' + JSON.stringify(label) + ').click()'
   ).catch(() => {});
 });
});
dialog.showErrorBox=(title,content)=>{fs.writeFileSync(process.env.KJMCL_TEST_REPORT,JSON.stringify({title,content}));app.exit(99);};
require(process.env.KJMCL_TEST_ENTRY);
`,
);
try {
  for (const choice of [0, 1, 2]) {
    const control = path.join(root, 'profile-' + choice),
      outside = path.join(root, 'external-' + choice),
      owner = randomUUID(),
      report = path.join(root, 'report-' + choice + '.json');
    await mkdir(path.join(control, 'assets'), { recursive: true });
    await mkdir(outside);
    await writeFile(
      path.join(control, '.kjmcl-data.json'),
      JSON.stringify({ app: 'KJMCL', version: 1, owner }),
    );
    await writeFile(
      path.join(control, 'storage-location.json'),
      JSON.stringify({ version: 1, root: control, owner, setupComplete: true }),
    );
    await writeFile(path.join(control, 'assets/probe'), 'managed');
    await mkdir(path.join(control, 'seed-map'));
    await mkdir(path.join(control, 'projection-workshop'));
    await writeFile(
      path.join(control, 'projection-workshop/index.json'),
      '{"schemaVersion":1,"current":null,"entries":[]}',
    );
    await writeFile(
      path.join(control, 'seed-map/workspace.json'),
      '{"schemaVersion":1,"current":null,"saved":[]}',
    );
    await writeFile(path.join(control, 'unrelated.txt'), 'unrelated');
    await writeFile(path.join(outside, 'world.txt'), 'external-world');
    const env = {
      ...process.env,
      KJMCL_DATA_DIR: control,
      KJMCL_TEST_ENTRY: entry,
      KJMCL_TEST_CHOICE: String(choice),
      KJMCL_TEST_REPORT: report,
    };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.KJMCL_DEV_URL;
    delete env.PORTABLE_EXECUTABLE_DIR;
    let code = 0;
    try {
      await exec(electron, [harness], { env, timeout: 20000, windowsHide: true });
    } catch (e) {
      code = e.code;
    }
    const result = JSON.parse(await readFile(report, 'utf8'));
    assert.equal(code, choice === 2 ? 2 : 0, JSON.stringify(result));
    assert.equal(result.content.title, '卸载时保留游戏数据？');
    assert.equal(result.content.focus, '保留数据并卸载');
    assert.equal(result.content.launcherApi, 'undefined');
    assert.deepEqual(result.content.buttons.sort(), ['取消卸载', '保留数据并卸载', '删除数据并卸载'].sort());
    assert.ok(result.content.paths.includes(control));
    assert.notEqual(result.profile, control);
    assert.equal(
      await access(path.join(control, 'assets/probe')).then(
        () => true,
        () => false,
      ),
      choice !== 1,
    );
    assert.equal(await readFile(path.join(outside, 'world.txt'), 'utf8'), 'external-world');
    assert.equal(
      await access(path.join(control, 'projection-workshop/index.json')).then(
        () => true,
        () => false,
      ),
      choice !== 1,
    );
    assert.equal(
      await access(path.join(control, 'seed-map/workspace.json')).then(
        () => true,
        () => false,
      ),
      choice !== 1,
    );
    assert.equal(await readFile(path.join(control, 'unrelated.txt'), 'utf8'), 'unrelated');
    console.log(
      'PASS uninstall main-process choice ' +
        choice +
        ', exit status, default retention and deletion boundaries',
    );
  }
} finally {
  if (path.basename(root).startsWith('kjmcl-uninstall-test-'))
    await rm(root, { recursive: true, force: true });
}
