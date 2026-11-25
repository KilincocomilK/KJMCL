import { BrowserWindow, dialog, ipcMain, screen, type IpcMainEvent } from 'electron';
import path from 'node:path';
import { systemDialogChoice, systemDialogHeight } from '../shared/schema';
import type { SystemDialogContent } from '../shared/types';

interface Dialog {
  content: SystemDialogContent;
  show(height: number): void;
  finish(index: number): void;
}
const dialogs = new Map<number, Dialog>();
let registered = false;

function sender(event: Pick<IpcMainEvent, 'sender' | 'senderFrame'>) {
  if (event.senderFrame === event.sender.mainFrame) return dialogs.get(event.sender.id);
}

function register() {
  if (registered) return;
  registered = true;
  ipcMain.handle('kjmcl-dialog:read', (event) => {
    const dialog = sender(event);
    if (!dialog) throw new Error('无效弹窗');
    return dialog.content;
  });
  ipcMain.on('kjmcl-dialog:choose', (event, value: unknown) => {
    const dialog = sender(event);
    const index = systemDialogChoice.safeParse(value);
    if (dialog && index.success && index.data < dialog.content.buttons.length)
      dialog.finish(index.data);
  });
  ipcMain.on('kjmcl-dialog:ready', (event, value: unknown) => {
    const height = systemDialogHeight.safeParse(value);
    if (height.success) sender(event)?.show(height.data);
  });
}

export async function showSystemDialog(
  parent: BrowserWindow | undefined,
  options: SystemDialogContent & { title?: string },
): Promise<{ response: number }> {
  register();
  if (parent?.isDestroyed()) return { response: options.cancelId };
  const display = parent
    ? screen.getDisplayMatching(parent.getBounds())
    : screen.getPrimaryDisplay();
  const window = new BrowserWindow({
    ...(parent ? { parent, modal: true } : {}),
    title: options.title ?? options.message,
    icon: path.join(__dirname, '../build/icon.png'),
    width: Math.min(516, display.workArea.width),
    height: Math.min(520, display.workArea.height),
    useContentSize: true,
    show: false,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: !!parent,
    backgroundColor: '#252824',
    webPreferences: {
      preload: path.join(__dirname, 'dialog-preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      partition: 'kjmcl-system-dialog',
      devTools: false,
    },
  });
  const wc = window.webContents;
  const id = wc.id;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (event) => event.preventDefault());
  wc.session.setPermissionRequestHandler((_sender, _permission, callback) => callback(false));
  let ready!: () => void;
  let fail!: () => void;
  const rendererReady = new Promise<void>((resolve, reject) => {
    ready = resolve;
    fail = () => reject(new Error('弹窗加载失败'));
  });
  const timeout = setTimeout(fail, 12000);
  wc.once('preload-error', fail);
  let response = options.cancelId;
  const closed = new Promise<{ response: number }>((resolve) => {
    const cancel = () => {
      if (!window.isDestroyed()) window.destroy();
    };
    parent?.once('closed', cancel);
    wc.once('render-process-gone', cancel);
    window.once('closed', () => {
      ready();
      dialogs.delete(id);
      parent?.removeListener('closed', cancel);
      resolve({ response });
    });
    dialogs.set(id, {
      content: options,
      show(requestedHeight) {
        if (window.isVisible()) return;
        const area = display.workArea,
          anchor = parent?.getBounds() ?? area;
        const width = window.getContentSize()[0],
          height = Math.min(area.height, requestedHeight);
        const x = Math.max(
          area.x,
          Math.min(area.x + area.width - width, anchor.x + (anchor.width - width) / 2),
        );
        const y = Math.max(
          area.y,
          Math.min(area.y + area.height - height, anchor.y + (anchor.height - height) / 2),
        );
        window.setBounds({ x: Math.round(x), y: Math.round(y), width, height });
        window.show();
        wc.focus();
        ready();
      },
      finish(index) {
        response = index;
        window.destroy();
      },
    });
  });
  try {
    const load =
      process.env.KJMCL_DEV_URL === 'http://127.0.0.1:5173'
        ? window.loadURL('http://127.0.0.1:5173/system-dialog.html')
        : window.loadFile(path.join(__dirname, '../dist/system-dialog.html'));
    await Promise.all([load, rendererReady]);
  } catch {
    if (!window.isDestroyed()) {
      window.destroy();
      // The recovery prompt also works if an installation has lost its renderer assets.
      const native = {
        ...options,
        detail: [options.detail, ...(options.paths ?? [])].filter(Boolean).join('\n'),
        noLink: true,
      };
      if (parent?.isDestroyed()) return closed;
      return parent ? dialog.showMessageBox(parent, native) : dialog.showMessageBox(native);
    }
  } finally {
    clearTimeout(timeout);
    wc.removeListener('preload-error', fail);
  }
  return closed;
}
