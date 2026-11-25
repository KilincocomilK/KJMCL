import { useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { Modal } from '../components';
import { api } from '../api';
import type { Run } from '../ui';
import type { WorldRef } from '../../shared/types';

export function WorldBackup({
  id,
  world,
  run,
  onClose,
}: WorldRef & { run: Run; onClose: () => void }) {
  const [choice, setChoice] = useState<{ path: string; token: string }>();
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title="备份世界"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="form-body world-backup-fields">
        <strong>{world}</strong>
        <label>
          备份导出路径
          <input readOnly value={choice?.path ?? '仅保存到启动器备份库'} />
        </label>
        <div className="toolbar">
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const selected = await api.chooseBackupExport({ id, world });
                if (selected) setChoice(selected);
              })
            }
          >
            <FolderOpen size={15} />
            选择路径
          </button>
          {choice && <button onClick={() => setChoice(undefined)}>取消导出</button>}
        </div>
      </div>
      <div className="modal-footer">
        <button disabled={busy} onClick={onClose}>
          取消
        </button>
        <button
          className="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const ok = await run(() => api.backupWorld({ id, world, exportToken: choice?.token }));
            setBusy(false);
            if (ok) onClose();
          }}
        >
          开始备份
        </button>
      </div>
    </Modal>
  );
}
