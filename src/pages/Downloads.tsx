import { useEffect, useRef } from 'react';
import { Check, LoaderCircle, Square, X } from 'lucide-react';
import type { Task } from '../../shared/types';
import { api } from '../api';
import { Empty } from '../components';
import { remainingTime, taskStatus, type Run } from '../ui';

export function DownloadsPage({
  tasks,
  selected,
  run,
}: {
  tasks: Task[];
  selected?: string;
  run: Run;
}) {
  const selectedRow = useRef<HTMLElement>(null);
  useEffect(() => {
    selectedRow.current?.focus({ preventScroll: true });
    selectedRow.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);
  if (!tasks.length) return <Empty art="hopper" title="没有下载任务" />;
  return (
    <div className="task-list">
      {tasks.map((task) => {
        const running = task.status === 'running';
        const Icon = { running: LoaderCircle, completed: Check, failed: X, cancelled: Square }[
          task.status
        ];
        return (
          <section
            className="task panel"
            key={task.id}
            tabIndex={-1}
            ref={task.id === selected ? selectedRow : undefined}
            aria-label={task.title}
          >
            <div className={'task-icon ' + task.status}>
              <Icon className={running ? 'spin' : undefined} />
            </div>
            <div className="task-main">
              <div className="row">
                <strong>{task.title}</strong>
                <span>
                  {taskStatus[task.status]} · {Math.floor(task.progress)}%
                  {running && ' · ' + remainingTime(task.remainingSeconds)}
                </span>
              </div>
              <p>{task.detail}</p>
              <progress
                aria-label={task.title}
                value={running && !task.progress ? undefined : task.progress}
                max={100}
              />
            </div>
            {running && (
              <button
                className="icon"
                aria-label="取消任务"
                onClick={() => void run(() => api.cancelTask(task.id))}
              >
                <X size={18} />
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
}
