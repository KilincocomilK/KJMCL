import { useEffect, useRef, useState } from 'react';
import type {
  ResourceCandidate,
  ResourceImportChoice,
  ResourceImportResult,
  Snapshot,
} from '../../shared/types';
import { api } from '../api';
import { Modal } from '../components';
import { size, type Run } from '../ui';
export const resourceLabels = {
  mods: '模组',
  shaderpacks: '光影包',
  resourcepacks: '资源包',
  replay_recordings: 'Replay 录像',
  schematics: '投影原理图',
};
export function ResourceImport({
  state,
  run,
  files,
  onFiles,
}: {
  state: Snapshot;
  run: Run;
  files: ResourceCandidate[];
  onFiles: (files: ResourceCandidate[]) => void;
}) {
  const [dragging, setDragging] = useState(false),
    [inspecting, setInspecting] = useState(false);
  const active = useRef(false),
    depth = useRef(0);
  useEffect(() => {
    const isFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const enter = (e: DragEvent) => {
      if (isFiles(e)) {
        e.preventDefault();
        depth.current++;
        setDragging(true);
      }
    };
    const over = (e: DragEvent) => {
      if (isFiles(e)) {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      }
    };
    const leave = (e: DragEvent) => {
      if (isFiles(e) && --depth.current <= 0) {
        depth.current = 0;
        setDragging(false);
      }
    };
    const drop = (e: DragEvent) => {
      if (!isFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      depth.current = 0;
      setDragging(false);
      if (active.current) return;
      const incoming = Array.from(e.dataTransfer?.files ?? []);
      if (!incoming.length) return;
      active.current = true;
      setInspecting(true);
      void run(async () => {
        const paths = api.droppedPaths(incoming);
        if (!paths.length) throw new Error('无法读取拖入文件，请使用“添加资源”选择文件');
        if (paths.length > 100) throw new Error('每次最多添加 100 个文件');
        onFiles(await api.inspectResources(paths));
      }).finally(() => {
        active.current = false;
        setInspecting(false);
      });
    };
    window.addEventListener('dragenter', enter, true);
    window.addEventListener('dragover', over, true);
    window.addEventListener('dragleave', leave, true);
    window.addEventListener('drop', drop, true);
    return () => {
      window.removeEventListener('dragenter', enter, true);
      window.removeEventListener('dragover', over, true);
      window.removeEventListener('dragleave', leave, true);
      window.removeEventListener('drop', drop, true);
    };
  }, [onFiles, run]);
  return (
    <>
      {(dragging || inspecting) && (
        <div className="drop-overlay">
          <strong>{inspecting ? '正在识别资源…' : '松开以添加资源'}</strong>
          <span>模组 · 光影 · 资源包 · 录像 · 原理图</span>
        </div>
      )}
      {files.length > 0 && (
        <ImportReview
          key={files.map((f) => f.token).join(',')}
          state={state}
          files={files}
          run={run}
          onClose={() => onFiles([])}
        />
      )}
    </>
  );
}
function ImportReview({
  state,
  files,
  run,
  onClose,
}: {
  state: Snapshot;
  files: ResourceCandidate[];
  run: Run;
  onClose: () => void;
}) {
  const [choices, setChoices] = useState(
      files.map((f) => ({
        token: f.token,
        id: f.suggestedInstanceId ?? '',
        kind: f.kind ?? '',
        conflict: 'skip' as const,
      })),
    ),
    [busy, setBusy] = useState(false),
    [results, setResults] = useState<ResourceImportResult[]>();
  const update = (index: number, patch: object) =>
    setChoices((old) => old.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  const valid =
    files.filter((f) => !f.error).length > 0 &&
    choices.every((c, i) => files[i].error || (c.id && c.kind));
  return (
    <Modal
      wide
      title="添加资源"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="resource-import-body">
        <p className="muted">确认目标实例后添加。原文件保留，同名文件默认跳过。</p>
        {!state.instances.length && <p role="alert">请先创建游戏实例，再添加资源。</p>}
        {!results && (
          <label>
            统一添加到
            <select
              aria-label="统一目标实例"
              defaultValue=""
              disabled={busy}
              onChange={(e) => setChoices((old) => old.map((c) => ({ ...c, id: e.target.value })))}
            >
              <option value="">逐项选择实例</option>
              {state.instances.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} · {i.version}
                </option>
              ))}
            </select>
          </label>
        )}
        {files.map((file, index) => (
          <section className="import-row" key={file.token}>
            <strong>{file.name}</strong>
            <small>{size(file.size)}</small>
            <p>{file.error || file.reason}</p>
            {!file.error && !results && (
              <div className="resource-import-controls">
                <select
                  aria-label={file.name + ' 类型'}
                  value={choices[index].kind}
                  disabled={busy || !!file.kind}
                  onChange={(e) => update(index, { kind: e.target.value })}
                >
                  <option value="">选择类型</option>
                  {Object.entries(resourceLabels).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={file.name + ' 实例'}
                  value={choices[index].id}
                  disabled={busy}
                  onChange={(e) => update(index, { id: e.target.value })}
                >
                  <option value="">选择实例</option>
                  {state.instances.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name} · {i.version} · {i.loader}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={file.name + ' 同名处理'}
                  value={choices[index].conflict}
                  disabled={busy}
                  onChange={(e) => update(index, { conflict: e.target.value })}
                >
                  <option value="skip">同名跳过</option>
                  <option value="rename">保留为副本</option>
                </select>
              </div>
            )}
          </section>
        ))}
        {results && (
          <div role="status">
            {results.map((r, i) => (
              <p key={i}>
                {r.status === 'added' ? '已添加' : r.status === 'skipped' ? '已跳过' : '添加失败'} ·{' '}
                {files.filter((f) => !f.error)[i]?.name} · {r.detail}
              </p>
            ))}
          </div>
        )}
      </div>
      <div className="modal-footer">
        <button disabled={busy} onClick={onClose}>
          {results ? '完成' : '取消'}
        </button>
        {!results && (
          <button
            className="primary"
            disabled={busy || !valid}
            onClick={async () => {
              setBusy(true);
              const result = await run(() =>
                api.importResources(
                  choices.filter((_, i) => !files[i].error) as ResourceImportChoice[],
                ),
              );
              if (result) setResults(result);
              setBusy(false);
            }}
          >
            {busy ? '正在添加…' : '确认添加'}
          </button>
        )}
      </div>
    </Modal>
  );
}
