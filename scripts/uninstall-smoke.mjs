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
dialog.showMessageBox=async options=>{
 fs.writeFileSync(process.env.KJMCL_TEST_REPORT,JSON.stringify({options,profile:app.getPath('userData')}));
 return {response:Number(process.env.KJMCL_TEST_CHOICE)};
};
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
    assert.equal(result.options.defaultId, 0);
    assert.equal(result.options.cancelId, 2);
    assert.equal(result.options.buttons.length, 3);
    assert.ok(result.options.detail.includes(control));
    assert.notEqual(result.profile, control);
    assert.equal(
      await access(path.join(control, 'assets/probe')).then(
        () => true,
        () => false,
      ),
      choice !== 1,
    );
    assert.equal(await readFile(path.join(outside, 'world.txt'), 'utf8'), 'external-world');
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
