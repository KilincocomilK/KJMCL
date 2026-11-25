import type { LauncherActivity, LauncherUpdate, Task } from './types';

export const noticeDuration = 6500;

export function activities(tasks: Task[], update: LauncherUpdate | undefined, since: number) {
  const items: { activity: LauncherActivity; time: number }[] = [];
  for (const task of tasks) {
    if (task.notificationDismissed || (task.status !== 'running' && (task.finishedAt ?? 0) < since))
      continue;
    items.push({ activity: { task }, time: task.finishedAt ?? task.createdAt });
  }
  if (update?.status === 'available' && update.version && !update.notificationDismissed) {
    items.push({ activity: { version: update.version }, time: update.checkedAt ?? 0 });
  }
  return items.sort((a, b) => b.time - a.time).map((item) => item.activity);
}
