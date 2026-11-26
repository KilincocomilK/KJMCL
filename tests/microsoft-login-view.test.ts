import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import type { Snapshot, Task } from '../shared/types';
import { AccountSetup } from '../src/pages/Accounts';

vi.mock('../src/api', () => ({ api: {} }));

const userCode = {
  userCode: 'FIXTURE-CODE',
  verificationUri: 'https://microsoft.com/link',
  expiresAt: Date.now() + 60000,
};
function view(status: Task['status'], detail: string, showCode = false) {
  const task: Task = {
    id: 'auth-test',
    scope: 'auth',
    title: 'Microsoft 登录',
    status,
    progress: 0,
    detail,
    createdAt: 0,
  };
  const state: Snapshot = {
    accounts: [],
    instances: [],
    gameFolders: [],
    tasks: [task],
    running: [],
    dataPath: '',
    platform: 'linux',
    appVersion: '',
    settings: {
      memoryMb: 4096,
      javaPath: '',
      source: 'official',
      proxy: '',
      concurrency: 4,
      microsoftClientId: '',
      closeOnLaunch: false,
      showSnapshots: false,
    },
    microsoftLoginCode: showCode ? userCode : undefined,
  };
  return renderToStaticMarkup(
    createElement(AccountSetup, { state, welcome: true, run: async () => undefined }),
  );
}

it('restores an active user code into a fresh account form and switches to verification progress after authorization', () => {
  expect(view('running', '等待授权', true)).toContain(userCode.userCode);
  const authorized = view('running', '验证 Xbox 账户');
  expect(authorized).toContain('验证 Xbox 账户');
  expect(authorized).not.toContain('打开登录页面');
});

it('replaces the code with the task error and retry action even when a terminal snapshot holds an older code', () => {
  const failed = view('failed', 'Xbox 档案尚未创建', true);
  expect(failed).toContain('Xbox 档案尚未创建');
  expect(failed).toContain('重新登录 Microsoft');
  expect(failed).not.toContain(userCode.userCode);
  expect(view('cancelled', '已取消', true)).toContain('登录已取消');
  expect(view('completed', '已完成', true)).not.toContain('取消登录');
});
