import { BrowserWindow, type Rectangle } from 'electron';
import path from 'node:path';
import type { LauncherEvent } from '../shared/types';

/** Replace, rather than hide, the heavy renderer. Keep the native window lifecycle in main. */
export class WindowHost {
  current?: BrowserWindow;
  lightweight = false;
  private bounds?: Rectangle;
  private maximized = false;
  private closed = false;
  constructor(
    private onClose: (window: BrowserWindow, event: Electron.Event) => void,
    private onCurrent: (window: BrowserWindow | undefined) => void,
  ) {}

  dispose() {
    this.closed = true;
  }

  async open(lightweight = false, notify = false) {
    const previous = this.current;
    const previousMode = this.lightweight;
    const minimized = previous?.isMinimized() ?? false;
    const focused = previous?.isFocused() ?? true;
    if (previous && !previousMode) {
      this.bounds = previous.getNormalBounds();
      this.maximized = previous.isMaximized();
    }
    const window = new BrowserWindow({
      ...(lightweight
        ? { width: 660, height: 480 }
        : (this.bounds ?? { width: 1280, height: 820 })),
      minWidth: lightweight ? 540 : 960,
      minHeight: lightweight ? 420 : 650,
      backgroundColor: '#10100f',
      frame: false,
      title: lightweight ? 'KJMCL · 轻量模式' : 'KJMCL',
      icon: path.join(__dirname, '../build/icon.png'),
      show: false,
      paintWhenInitiallyHidden: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        backgroundThrottling: true,
        // A distinct session prevents Chromium from reusing the full UI renderer process.
        // The light page needs neither persistent cookies nor browser caches.
        ...(lightweight ? { partition: 'kjmcl-lightweight' } : {}),
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.session.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
    window.on('close', (event) => this.onClose(window, event));
    const visibility = (visible: boolean) => {
      if (!window.isDestroyed())
        window.webContents.send('kjmcl:event', {
          type: 'window-visibility',
          visible,
        } satisfies LauncherEvent);
    };
    const hidden = () => visibility(false);
    const shown = () =>
      visibility(window.isVisible() && !window.isMinimized() && window.isFocused());
    window.on('blur', hidden).on('hide', hidden).on('minimize', hidden);
    window.on('focus', shown).on('show', shown).on('restore', shown);
    this.current = window;
    this.onCurrent(window);
    this.lightweight = lightweight;
    previous?.hide();
    try {
      const file = lightweight ? 'lightweight.html' : 'index.html';
      const query: Record<string, string> = notify
        ? { modeNotice: lightweight ? 'entered' : 'exited' }
        : {};
      if (process.env.KJMCL_DEV_URL === 'http://127.0.0.1:5173') {
        const url = new URL(file, process.env.KJMCL_DEV_URL);
        for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value!);
        await window.loadURL(url.toString());
      } else await window.loadFile(path.join(__dirname, '../dist', file), { query });
      if (this.closed) return;
      if (!lightweight && this.maximized) window.maximize();
      if (minimized) {
        window.showInactive();
        window.minimize();
      } else if (focused) window.show();
      else window.showInactive();
      // destroy() bypasses the user's close confirmation and releases the former webContents.
      previous?.destroy();
    } catch (error) {
      this.current = previous;
      this.onCurrent(previous);
      this.lightweight = previousMode;
      if (previous && !previous.isDestroyed()) {
        if (minimized) previous.minimize();
        else previous.showInactive();
      }
      window.destroy();
      throw error;
    }
  }
}
