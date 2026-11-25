import { FolderOpen, MoveRight, RotateCw, Trash2 } from 'lucide-react';
import type { Snapshot } from '../../shared/types';
import { api } from '../api';
import { Field, Modal } from '../components';
import { size, type Run } from '../ui';
async function choose(run: Run) {
  const directory = await run(() => api.pickDirectory());
  if (directory) await run(() => api.migrateStorage(directory));
}
export function StorageSettings({ state, run }: { state: Snapshot; run: Run }) {
  const info = state.storage,
    locked = state.running.length > 0 || state.tasks.some((t) => t.status === 'running');
  return (
    <div className="storage-settings">
      <Field label="数据目录">
        <div className="path-value">{state.dataPath}</div>
      </Field>
      <div className="row">
        <button type="button" onClick={() => void run(() => api.openFolder({}))}>
          <FolderOpen size={16} />
          打开
        </button>
        <button
          type="button"
          disabled={locked || !!info?.pendingRestart || !!info?.retired}
          onClick={() => void choose(run)}
        >
          <MoveRight size={16} />
          迁移数据
        </button>
      </div>
      <p className="performance-note">
        包含游戏、资源、Java 与备份。外部自定义 MC 目录保持原位置。
      </p>
      {info?.mode === 'portable' && <small>便携模式</small>}
      {info?.pendingRestart && (
        <div className="storage-pending">
          <p>已校验：{info.pendingRestart}</p>
          <button
            type="button"
            disabled={locked}
            onClick={() => void run(() => api.restartLauncher())}
          >
            <RotateCw size={15} />
            重启并切换
          </button>
        </div>
      )}
      {info?.retired && (
        <div className="storage-pending">
          <p>原数据：{info.retired.path}</p>
          <p>
            {size(info.retired.bytes)} · {info.retired.files} 个文件
          </p>
          <button
            type="button"
            disabled={locked}
            onClick={() => void run(() => api.cleanupStorage())}
          >
            <Trash2 size={15} />
            清理原数据
          </button>
        </div>
      )}
    </div>
  );
}
export function StorageSetup({ state, run }: { state: Snapshot; run: Run }) {
  const busy = state.tasks.some((t) => t.status === 'running'),
    pending = state.storage?.pendingRestart;
  return (
    <Modal title="选择数据目录" onClose={() => void run(() => api.window('close'))}>
      <div className="form-body">
        <p>用于存放游戏、模组、Java 和备份。</p>
        <div className="path-value">{pending || state.dataPath}</div>
        {busy && <p>正在复制并校验…</p>}
      </div>
      <div className="modal-footer">
        {pending ? (
          <button
            className="primary"
            disabled={busy}
            onClick={() => void run(() => api.restartLauncher())}
          >
            重启并继续
          </button>
        ) : (
          <>
            <button disabled={busy} onClick={() => void run(() => api.finishStorageSetup())}>
              使用此目录
            </button>
            <button className="primary" disabled={busy} onClick={() => void choose(run)}>
              选择其他目录
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
