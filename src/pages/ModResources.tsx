import { useState, useEffect, useRef, type ReactNode } from 'react';
import { Download, LoaderCircle, X } from 'lucide-react';
import type {
  Snapshot,
  ModFile,
  ResourceFile,
  ContentProject,
  ModUpdatePreview,
  ModUpdateReceipt,
  LocalResourceCard,
} from '../../shared/types';
import { matchesSearch } from '../../shared/search';
import { LocalResourceArt } from '../components/LocalResourceArt';
import { Switch } from '../components';
import { api } from '../api';
import { type Run, size } from '../ui';
import { ModAuditPanel } from './ModAudit';
import { ContentBrowser } from './ContentBrowser';

export function ModResources({
  state,
  run,
  files,
  cards,
  query,
  search,
  revision,
  onChanged,
  actions,
}: {
  state: Snapshot;
  run: Run;
  files: ResourceFile[];
  cards?: Map<string, LocalResourceCard>;
  query: string;
  search: ReactNode;
  revision: number;
  onChanged: () => void;
  actions: (file: ResourceFile, allowRename?: boolean) => ReactNode;
}) {
  const id = state.selectedInstanceId!;
  const instance = state.instances.find((i) => i.id === id)!;
  const [mods, setMods] = useState<ModFile[]>([]);
  const [preview, setPreview] = useState<ModUpdatePreview | null>(null);
  const [receipt, setReceipt] = useState<ModUpdateReceipt | null>(null);
  const [reading, setReading] = useState(true);
  const [audit, setAudit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Record<string, string>>({});
  const live = useRef(true);
  const terminalTasks = state.tasks
    .filter((t) => t.status !== 'running')
    .map((t) => `${t.id}:${t.status}`)
    .join('|');
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setReading(true);
    void run(async () => {
      const next = await api.mods(id);
      if (active) setMods(next);
    }).finally(() => {
      if (active) setReading(false);
    });
    return () => {
      active = false;
    };
  }, [id, revision, terminalTasks, run]);
  useEffect(() => {
    setPreview(null);
    setReceipt(null);
  }, [id]);
  useEffect(() => {
    let active = true;
    void run(async () => {
      const last = await api.lastModUpdate(id);
      if (active) setReceipt(last);
    });
    return () => {
      active = false;
    };
  }, [id, revision, terminalTasks, run]);
  const mutate = async (work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    const task = await run(work);
    if (live.current) {
      if (typeof task === 'string') setPending((p) => ({ ...p, update: task }));
      setBusy(false);
      onChanged();
    }
  };
  const runningTask = Object.values(pending).some((taskId) =>
    state.tasks.some((t) => t.id === taskId && t.status === 'running'),
  );
  const updateTask = state.tasks.find((t) => t.id === pending.update && t.scope === id);
  const locked =
    busy ||
    runningTask ||
    state.running.includes(id) ||
    state.tasks.some((t) => t.scope === id && t.status === 'running');
  const filesByName = new Map(files.map((file, rank) => [file.name, { file, rank }]));
  const visible = mods
    .filter((m) => {
      const card = cards?.get(m.name);
      return matchesSearch(
        query,
        m.name,
        card?.modId,
        card?.title,
        card?.localizedTitle,
        card?.version,
        m.source,
      );
    })
    .sort(
      (a, b) =>
        (filesByName.get(a.name)?.rank ?? files.length) -
        (filesByName.get(b.name)?.rank ?? files.length),
    );
  const install = async (project: ContentProject) => {
    setBusy(true);
    const key = project.source + ':' + project.projectId;
    const task = await run(() =>
      project.source === 'modrinth'
        ? api.installMod({ id, projectId: project.projectId })
        : api.installCurseForge({ id, projectId: Number(project.projectId) }),
    );
    if (live.current) {
      if (task) setPending((p) => ({ ...p, [key]: task }));
      setBusy(false);
    }
  };
  return (
    <div className="mod-resources">
      <ContentBrowser
        kind="mod"
        state={state}
        run={run}
        projectAction={(project) => {
          const installed = mods.some(
            (m) => m.projectId === project.projectId && (m.source ?? 'modrinth') === project.source,
          );
          const task = state.tasks.find(
            (t) => t.id === pending[project.source + ':' + project.projectId],
          );
          const downloading = task?.status === 'running';
          return (
            <button
              disabled={
                installed ||
                locked ||
                downloading ||
                instance.loader === 'vanilla' ||
                (task?.status === 'completed' && reading)
              }
              onClick={() => void install(project)}
            >
              {downloading ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                !installed && <Download size={16} />
              )}
              {installed
                ? '已安装'
                : downloading
                  ? '下载中'
                  : task?.status === 'failed' || task?.status === 'cancelled'
                    ? '重试'
                    : '安装'}
            </button>
          );
        }}
      />
      {instance.loader === 'vanilla' && (
        <p className="muted resource-hint">安装模组需要 Fabric、Forge 等加载器</p>
      )}
      <section aria-label="已安装模组">
        <div className="resource-section-head">
          <h2>
            已安装{' '}
            <span>
              {visible.length}
              {query.trim() ? ` / ${mods.length}` : ''}
            </span>
          </h2>
          <div className="row">
            {receipt && (
              <button
                disabled={locked}
                title={new Date(receipt.updatedAt).toLocaleString()}
                onClick={() =>
                  void mutate(async () => {
                    await api.undoModUpdates(id);
                    setReceipt(null);
                    setPreview(null);
                  })
                }
              >
                撤销上次更新
              </button>
            )}
            <button
              hidden={!mods.some((m) => m.projectId)}
              disabled={locked}
              onClick={() =>
                void mutate(async () => {
                  setPreview(null);
                  const result = await api.previewModUpdates(id);
                  if (live.current) setPreview(result);
                })
              }
            >
              检查更新
            </button>
            <button
              hidden={!mods.length}
              disabled={locked || !mods.length}
              onClick={() => setAudit(true)}
            >
              检查与批量操作
            </button>
          </div>
        </div>
        {preview && (
          <section className="panel form-body" aria-label="模组更新预览">
            <div className="resource-section-head">
              <h3>
                {preview.items.length ? `可更新 ${preview.items.length} 项` : '托管模组均为最新'}
              </h3>
              <button className="icon" aria-label="关闭更新预览" onClick={() => setPreview(null)}>
                <X size={16} />
              </button>
            </div>
            {preview.items.map((item) => (
              <div className="mod-row" key={item.source + ':' + item.projectId}>
                <div className="grow">
                  <strong>{item.file}</strong>
                  <small>
                    {item.source === 'modrinth' ? 'Modrinth' : 'CurseForge'} ·{' '}
                    {item.previousFile ? item.previousFile + ' → ' + item.file : '新增依赖'} ·{' '}
                    {size(item.size)}
                    {item.disabled && ' · 保持停用'}
                  </small>
                  <small>
                    {item.previousVersion ? item.previousVersion + ' → ' : ''}
                    {item.version}
                  </small>
                </div>
              </div>
            ))}
            {preview.items.length > 0 && (
              <div className="row">
                <button
                  className="primary"
                  disabled={locked}
                  onClick={() =>
                    void mutate(async () => {
                      const task = await api.applyModUpdates({ id, token: preview.token });
                      setPreview(null);
                      return task;
                    })
                  }
                >
                  应用全部更新
                </button>
              </div>
            )}
          </section>
        )}
        {updateTask && ['failed', 'cancelled', 'running'].includes(updateTask.status) && (
          <p role="status" className={updateTask.status === 'failed' ? 'inline-error' : 'muted'}>
            {updateTask.detail}
          </p>
        )}
        {search}
        {visible.length ? (
          <div className="mod-list panel">
            {visible.map((m) => {
              const file = filesByName.get(m.name)?.file;
              const card = cards?.get(m.name);
              return (
                <article className="mod-row resource-mod-row" key={m.name}>
                  <LocalResourceArt kind="mods" icon={card?.icon} />
                  <div className="grow">
                    <strong title={m.name}>
                      {card?.title ?? m.name.replace(/\.disabled$/, '')}
                      {card?.localizedTitle &&
                        card.localizedTitle !== card.title &&
                        '（' + card.localizedTitle + '）'}
                    </strong>
                    <small>
                      {card?.version && (
                        <>
                          <b className="local-mod-version">{card.version}</b> ·{' '}
                        </>
                      )}
                      {card?.title && card.title !== m.name ? (
                        <>
                          <span className="mod-filename">{m.name.replace(/\.disabled$/, '')}</span>{' '}
                          ·{' '}
                        </>
                      ) : (
                        card?.modId && <>{card.modId} · </>
                      )}
                      {m.source === 'curseforge' ? 'CurseForge' : m.projectId ? 'Modrinth' : '本地'}{' '}
                      · {size(m.size)}
                      {!m.enabled && ' · 已停用'}
                    </small>
                  </div>
                  <Switch
                    label={'启用 ' + m.name}
                    checked={m.enabled}
                    disabled={locked}
                    onChange={() => void mutate(() => api.toggleMod({ id, name: m.name }))}
                  />
                  {file && actions(file, !m.projectId)}
                </article>
              );
            })}
          </div>
        ) : (
          <p className="resource-empty" role="status">
            {reading ? '正在读取…' : query.trim() ? '没有匹配的已安装模组' : '暂无模组'}
          </p>
        )}
      </section>
      {audit && (
        <section className="resource-audit" aria-label="检查与批量操作">
          <div className="resource-section-head">
            <h2>检查与批量操作</h2>
            <button
              aria-label="收起模组检查"
              className="icon"
              onClick={() => {
                setAudit(false);
                onChanged();
              }}
            >
              <X size={16} />
            </button>
          </div>
          <ModAuditPanel id={id} state={state} run={run} />
        </section>
      )}
    </div>
  );
}
