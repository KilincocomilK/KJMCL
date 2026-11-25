import { useEffect, useState, type ReactNode } from 'react';
import {
  ArrowUpCircle,
  Check,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Download,
  Square,
  X,
} from 'lucide-react';
import type { ActivityRef, LauncherUpdate, Task } from '../../shared/types';
import { activities, noticeDuration } from '../../shared/activity';
import { remainingTime, taskStatus } from '../ui';

type Dismiss = (activity: ActivityRef) => void;

function TaskCard({
  task,
  visible,
  dismiss,
  open,
}: {
  task: Task;
  visible: boolean;
  dismiss: Dismiss;
  open: (id: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [detail, setDetail] = useState(false);
  const running = task.status === 'running';
  useEffect(() => {
    if (running || !visible || focused || hovered) return;
    const timer = setTimeout(() => dismiss({ taskId: task.id }), noticeDuration);
    return () => clearTimeout(timer);
  }, [running, task.id, dismiss, visible, hovered, focused]);
  const Icon = { running: Download, completed: Check, failed: CircleAlert, cancelled: Square }[
    task.status
  ];
  return (
    <div
      className={'activity-card ' + task.status}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => setFocused(e.currentTarget.contains(e.relatedTarget))}
    >
      <button
        className="activity-open"
        aria-label={'查看任务 · ' + task.title}
        onClick={() => {
          if (document.querySelector('[aria-modal="true"]')) setDetail(!detail);
          else open(task.id);
        }}
      >
        <Icon size={17} />
        <span className="activity-copy">
          <strong title={task.title}>{task.title}</strong>
          <small>
            {running ? remainingTime(task.remainingSeconds) : taskStatus[task.status]}
            {running && <b>{Math.floor(task.progress)}%</b>}
          </small>
        </span>
      </button>
      <button
        className="activity-close"
        aria-label={'关闭通知 · ' + task.title}
        onClick={() => dismiss({ taskId: task.id })}
      >
        <X size={14} />
      </button>
      {detail && <p className="activity-detail">{task.detail}</p>}
      {running && <progress aria-label={task.title} max={100} value={task.progress || undefined} />}
    </div>
  );
}

export function ActivityNotifications({
  tasks,
  update,
  currentVersion,
  visible,
  dismiss,
  openTask,
  openInfo,
  children,
}: {
  tasks: Task[];
  update?: LauncherUpdate;
  currentVersion: string;
  visible: boolean;
  dismiss: Dismiss;
  openTask: (id: string) => void;
  openInfo: () => void;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const [detailedVersion, setDetailedVersion] = useState<string>();
  // On returning from lightweight mode, show live work and recent results only.
  const [since] = useState(() => Date.now() - noticeDuration);
  const items = activities(tasks, update, since);
  const latest = items[0];
  const cards = items.map((item) =>
    'task' in item ? (
      <TaskCard
        key={item.task.id}
        task={item.task}
        visible={visible}
        dismiss={dismiss}
        open={openTask}
      />
    ) : (
      <div key={'release-' + item.version} className="activity-card update">
        <button
          className="activity-open"
          aria-label={'查看启动器更新 v' + item.version}
          onClick={() => {
            if (document.querySelector('[aria-modal="true"]'))
              setDetailedVersion(detailedVersion === item.version ? undefined : item.version);
            else openInfo();
          }}
        >
          <ArrowUpCircle size={17} />
          <span className="activity-copy">
            <strong>启动器有更新</strong>
            <small>KJMCL v{item.version}</small>
          </span>
        </button>
        <button
          className="activity-close"
          aria-label="关闭更新通知"
          onClick={() => dismiss({ version: item.version })}
        >
          <X size={14} />
        </button>
        {detailedVersion === item.version && (
          <p className="activity-detail">
            v{currentVersion} → v{item.version}
          </p>
        )}
      </div>
    ),
  );
  useEffect(() => {
    if (cards.length < 2) setExpanded(false);
  }, [cards.length]);
  return (
    <aside className="activity-stack" aria-label="活动通知">
      {children}
      <span className="activity-announcement" aria-live="polite" aria-atomic="true">
        {latest &&
          ('task' in latest
            ? latest.task.title + '，' + taskStatus[latest.task.status]
            : '启动器有更新 v' + latest.version)}
      </span>
      <div className={'activity-cards' + (expanded ? ' expanded' : '')}>{cards}</div>
      {cards.length > 1 && (
        <button
          className="activity-more"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? (
            <>
              <ChevronUp size={13} />
              收起通知
            </>
          ) : (
            <>
              <ChevronDown size={13} />
              另有 {cards.length - 1} 条通知
            </>
          )}
        </button>
      )}
    </aside>
  );
}
