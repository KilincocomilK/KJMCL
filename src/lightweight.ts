import type { LightweightState } from '../shared/types';
import './lightweight.css';

const api = window.kjmcl!;
const notice = document.querySelector<HTMLElement>('#notice')!;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
let windowVisible = false;
function visibility(visible: boolean) {
  windowVisible = visible;
  clearTimeout(noticeTimer);
  if (visible && !notice.hidden) noticeTimer = setTimeout(() => (notice.hidden = true), 6000);
}
function notify(message: string) {
  notice.querySelector('span')!.textContent = message;
  notice.hidden = false;
  // Native window focus is authoritative; Chromium can report a minimized document as visible.
  visibility(windowVisible);
}
notice.querySelector('button')!.onclick = () => (notice.hidden = true);
async function run(work: () => Promise<unknown>) {
  try {
    await work();
  } catch (error) {
    notify(error instanceof Error ? error.message : String(error));
  }
}
function render(state: LightweightState) {
  visibility(state.visible);
  const list = document.querySelector('#games')!;
  list.replaceChildren(
    ...state.games.map((game) => {
      const row = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = game.name;
      const stop = document.createElement('button');
      stop.textContent = '结束游戏';
      stop.onclick = () =>
        void run(async () => {
          stop.disabled = true;
          try {
            await api.stop(game.id);
          } finally {
            stop.disabled = false;
          }
        });
      row.append(name, stop);
      return row;
    }),
  );
  document.querySelector('#tasks')!.textContent = state.tasks
    ? `${state.tasks} 个后台任务继续运行`
    : '';
}
document.querySelector<HTMLButtonElement>('#minimize')!.onclick = () =>
  void run(() => api.window('minimize'));
document.querySelector<HTMLButtonElement>('#close')!.onclick = () =>
  void run(() => api.window('close'));
document.querySelector<HTMLButtonElement>('#restore')!.onclick = () =>
  void run(() => api.setLightweight(false));
api.onEvent((event) => {
  if (event.type === 'lightweight') render(event.state);
  if (event.type === 'mode-error') notify(event.message);
  if (event.type === 'window-visibility') visibility(event.visible);
});
void run(async () => render(await api.lightweightState()));
if (new URLSearchParams(location.search).get('modeNotice') === 'entered')
  notify('已进入轻量模式，减少启动器资源占用');
