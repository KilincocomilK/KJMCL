import type { LightweightState } from '../shared/types';
import { noticeDuration } from '../shared/activity';
import { remainingTime, taskStatus } from './ui';
import './lightweight.css';

const api = window.kjmcl!;
const notice = document.querySelector<HTMLElement>('#notice')!;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
let windowVisible = false;
const activityCard = document.querySelector<HTMLElement>('#activity')!;
const activityDetails = activityCard.querySelector('details')!;
const releaseButton = document.querySelector<HTMLButtonElement>('#release')!;
let activity: LightweightState['activity'];
let activityTimer: ReturnType<typeof setTimeout> | undefined;
let activityKey = '';

async function dismissActivity() {
  if (!activity) return;
  await api.dismissNotification(
    'task' in activity ? { taskId: activity.task.id } : { version: activity.version },
  );
  renderActivity((await api.lightweightState()).activity);
}
function timeActivity() {
  clearTimeout(activityTimer);
  if (
    windowVisible &&
    activity &&
    'task' in activity &&
    activity.task.status !== 'running' &&
    !activityCard.matches(':hover, :focus-within')
  ) {
    activityTimer = setTimeout(() => void run(dismissActivity), noticeDuration);
  }
}
function renderActivity(next: LightweightState['activity']) {
  activity = next;
  activityCard.hidden = !next;
  const key = next && ('task' in next ? next.task.id : next.version);
  if (key !== activityKey) activityDetails.open = false;
  activityKey = key ?? '';
  if (!next) return;
  const task = 'task' in next ? next.task : undefined;
  const running = task?.status === 'running';
  activityCard.querySelector('strong')!.textContent = task?.title ?? '启动器有更新';
  activityCard.querySelector('small')!.textContent = task
    ? running
      ? `${remainingTime(task.remainingSeconds)} · ${Math.floor(task.progress)}%`
      : taskStatus[task.status]
    : 'KJMCL v' + ('version' in next ? next.version : '');
  const detail = activityCard.querySelector('p')!;
  detail.hidden = !task;
  detail.textContent = task?.detail ?? '';
  releaseButton.hidden = !!task;
  const progress = activityCard.querySelector('progress')!;
  progress.hidden = !running;
  if (task?.progress) progress.value = task.progress;
  else progress.removeAttribute('value');
  timeActivity();
}
document.querySelector<HTMLButtonElement>('#dismiss-activity')!.onclick = () =>
  void run(dismissActivity);
releaseButton.onclick = () => void run(() => api.openLauncherRelease());
for (const event of ['mouseenter', 'mouseleave', 'focusin', 'focusout'])
  activityCard.addEventListener(event, timeActivity);
function visibility(visible: boolean) {
  windowVisible = visible;
  timeActivity();
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
  renderActivity(state.activity);
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
