import { useEffect, useState } from 'react';
import type { MigrationSource, MinecraftScan, Snapshot } from '../../shared/types';
import { api } from '../api';
import { ImportDialog } from '../dialogs/AdvancedDialogs';
import { Modal } from '../components';
import type { Run } from '../ui';

export function LauncherImport({
  state,
  run,
  onClose,
  onConfigured,
}: {
  state: Snapshot;
  run: Run;
  onClose?: () => void;
  onConfigured?: () => void;
}) {
  const [sources, setSources] = useState<MigrationSource[]>([]);
  const [scan, setScan] = useState<MinecraftScan>();
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [message, setMessage] = useState('');
  const [importedId, setImportedId] = useState('');
  const imported = state.gameFolders.find((folder) => folder.id === importedId);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setMessage('');
    setImportedId('');
    void api
      .discoverLaunchers()
      .then((found) => {
        if (current) setSources(found);
      })
      .catch((e) => {
        if (current) setMessage(String(e));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [attempt]);
  const preview = async (source: MigrationSource) => {
    const result = await run(() => api.previewLauncher(source.id));
    if (result) setScan(result);
  };
  const pick = async () => {
    setLoading(true);
    try {
      const found = await run(() => api.pickLauncher());
      if (!found) return;
      setImportedId('');
      if (!found.length) {
        setMessage('所选位置未找到游戏数据，请选择 .minecraft 或启动器文件夹。');
        return;
      }
      setSources((old) => [...found, ...old.filter((s) => !found.some((f) => f.root === s.root))]);
      setMessage('');
      if (found.length === 1) await preview(found[0]);
    } finally {
      setLoading(false);
    }
  };
  const content = (
    <div className="welcome-import">
      <p>检测官方启动器、HMCL、PCL2 和独立的 .minecraft 文件夹。</p>
      {loading ? (
        <p role="status">正在查找游戏目录…</p>
      ) : (
        !sources.length && !message && <p className="muted">常用位置未找到游戏，可以手动选择。</p>
      )}
      <div className="welcome-sources">
        {sources.map((source) => (
          <button
            key={source.root}
            type="button"
            disabled={loading}
            onClick={async () => {
              setLoading(true);
              try {
                await preview(source);
              } finally {
                setLoading(false);
              }
            }}
          >
            <span>
              <strong>{source.launchers.join(' / ')}</strong>
              <small>{source.root}</small>
            </span>
            <b>
              {state.gameFolders.some((f) => f.path === source.root) ? '已添加 · 查看' : '预览'}
            </b>
          </button>
        ))}
      </div>
      {message && <p role="status">{message}</p>}
      {imported && (
        <div role="status" className="welcome-import-result">
          <strong>已添加到「游戏实例」</strong>
          <small>{imported.path}</small>
        </div>
      )}
      <div className="row">
        <button type="button" disabled={loading} onClick={() => void pick()}>
          手动选择文件夹
        </button>
        <button type="button" disabled={loading} onClick={() => setAttempt(attempt + 1)}>
          重新检测
        </button>
      </div>
    </div>
  );
  if (scan)
    return (
      <ImportDialog
        scan={scan}
        run={run}
        task={state.tasks.find((t) => t.scope === 'game-folders' && t.status === 'running')}
        migration={{
          onImported: (id) => {
            setMessage('');
            setImportedId(id);
            onConfigured?.();
          },
        }}
        onClose={() => setScan(undefined)}
      />
    );
  return onClose ? (
    <Modal title="导入其他启动器" wide onClose={onClose}>
      <div className="form-body">{content}</div>
    </Modal>
  ) : (
    content
  );
}
