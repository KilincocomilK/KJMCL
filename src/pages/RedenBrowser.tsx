import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Download, Eye, Search } from 'lucide-react';
import { validAxis, type RedenDetails, type RedenFile, type RedenHit } from '../../shared/reden';
import type { RedenPreviewData } from '../../shared/reden';
import { Modal } from '../components';
import { Select } from '../Select';
import { api } from '../api';
import { size, type Run } from '../ui';

const Preview = lazy(() => import('../projection/RedenPreview'));
type Action = 'preview' | 'install';
export function RedenBrowser({ id, run, locked }: { id: string; run: Run; locked: boolean }) {
  const [query, setQuery] = useState(''),
    [results, setResults] = useState<{
      items: RedenHit[];
      query: string;
      page: number;
      more: boolean;
    }>();
  const [searching, setSearching] = useState(false),
    [loading, setLoading] = useState(false);
  const [choice, setChoice] = useState<{ hit: RedenHit; detail: RedenDetails; action: Action }>(),
    [index, setIndex] = useState(0);
  const [sizes, setSizes] = useState<[number, number, number]>([0, 0, 0]),
    [doc, setDoc] = useState<RedenPreviewData>();
  const [web, setWeb] = useState<{ file: RedenFile; host: string }>();
  const searchId = useRef(0),
    actionId = useRef(0);
  useEffect(
    () => () => {
      searchId.current++;
      actionId.current++;
    },
    [],
  );
  async function search(term: string, page: number) {
    const seq = ++searchId.current;
    setSearching(true);
    const value = await run(() => api.searchReden({ query: term.trim(), page }));
    if (seq !== searchId.current) return;
    if (value) setResults({ ...value, query: term, page });
    setSearching(false);
  }
  async function act(file: RedenFile, action: Action, seq: number) {
    const delivery = await run(() => api.redenDelivery(file));
    if (delivery === undefined || actionId.current !== seq) return;
    if (delivery) {
      setChoice(undefined);
      setWeb({ file, host: delivery.host });
      return;
    }
    if (action === 'preview') {
      const preview = await run(() => api.previewReden(file));
      if (preview && actionId.current === seq) {
        setChoice(undefined);
        setDoc(preview);
      }
    } else {
      const task = await run(() => api.installReden({ id, file }));
      if (task && actionId.current === seq) setChoice(undefined);
    }
  }
  async function open(hit: RedenHit, action: Action) {
    const seq = ++actionId.current;
    setLoading(true);
    const detail = await run(() => api.redenDetails(hit.key));
    if (seq !== actionId.current) return;
    if (detail) {
      if (detail.files.length === 1 && !detail.axes) {
        await act({ key: hit.key, kind: 'attachment', index: detail.files[0].index }, action, seq);
      } else {
        const defaults: [number, number, number] = [0, 0, 0];
        for (const axis of detail.axes ?? []) {
          let n = axis.min;
          while (n <= axis.max && !validAxis(axis, n)) n++;
          defaults['xyz'.indexOf(axis.axis)] = n;
        }
        setSizes(defaults);
        setIndex(detail.files[0]?.index ?? 0);
        setChoice({ hit, detail, action });
      }
    }
    if (seq === actionId.current) setLoading(false);
  }
  return (
    <section className="content-browser reden-browser" aria-label="RedenMC 在线投影">
      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          void search(query, 1);
        }}
      >
        <label className="search-input grow">
          <Search size={16} />
          <input
            aria-label="搜索在线投影"
            placeholder="搜索 RedenMC 投影"
            value={query}
            maxLength={160}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <button className="primary" type="submit" disabled={searching}>
          {searching ? '搜索中…' : '搜索'}
        </button>
      </form>
      {results?.items.map((hit) => (
        <article key={hit.key} className="resource-row panel">
          <div className="grow">
            <strong>{hit.name}</strong>
            <small>{[hit.author, hit.versions.join(' / ')].filter(Boolean).join(' · ')}</small>
          </div>
          <div className="resource-actions">
            <button
              className="icon"
              title="预览"
              aria-label={'预览 ' + hit.name}
              disabled={loading}
              onClick={() => void open(hit, 'preview')}
            >
              <Eye size={17} />
            </button>
            <button
              className="icon"
              title="下载"
              aria-label={'下载 ' + hit.name}
              disabled={loading || locked}
              onClick={() => void open(hit, 'install')}
            >
              <Download size={17} />
            </button>
            <button
              className="icon"
              title="发布页"
              aria-label={'打开发布页 ' + hit.name}
              onClick={() => void run(() => api.openReden(hit.key))}
            >
              <ArrowUpRight size={17} />
            </button>
          </div>
        </article>
      ))}
      {loading && <small role="status">正在读取投影…</small>}
      {results && !results.items.length && <p className="muted">没有匹配的投影</p>}
      {results && (results.more || results.page > 1) && (
        <div className="toolbar">
          <button
            disabled={searching || results.page === 1}
            onClick={() => void search(results.query, results.page - 1)}
          >
            上一页
          </button>
          <span>{results.page}</span>
          <button
            disabled={searching || !results.more}
            onClick={() => void search(results.query, results.page + 1)}
          >
            下一页
          </button>
        </div>
      )}
      {choice && (
        <Modal
          title={choice.hit.name}
          onClose={() => {
            actionId.current++;
            setChoice(undefined);
            setLoading(false);
          }}
        >
          <div className="form-body">
            {choice.detail.files.length > 0 && (
              <Select
                aria-label="投影附件"
                value={String(index)}
                onChange={(e) => setIndex(Number(e.target.value))}
              >
                {choice.detail.files.map((f) => (
                  <option key={f.index} value={f.index}>
                    {f.name} · {size(f.size)}
                  </option>
                ))}
                {choice.detail.axes && <option value={0}>按尺寸生成</option>}
              </Select>
            )}
            {!index &&
              choice.detail.axes?.map((a) => (
                <label key={a.axis} className="field">
                  {a.axis.toUpperCase()} 尺寸
                  <input
                    type="number"
                    min={a.min}
                    max={a.max}
                    value={sizes['xyz'.indexOf(a.axis)]}
                    onChange={(e) =>
                      setSizes((old) => {
                        const next: [number, number, number] = [...old];
                        next['xyz'.indexOf(a.axis)] = Number(e.target.value);
                        return next;
                      })
                    }
                  />
                  <small>
                    {a.min}–{a.max}
                    {a.modulo.map(([m, r]) => ' · 除以 ' + m + ' 余 ' + r).join('')}
                  </small>
                </label>
              ))}
            {!index && !choice.detail.axes && <p>此作品没有可预览的投影附件。</p>}
          </div>
          <div className="modal-footer">
            <button onClick={() => void run(() => api.openReden(choice.hit.key))}>发布页</button>
            <button
              className="primary"
              disabled={
                loading ||
                (!index &&
                  (!choice.detail.axes ||
                    !choice.detail.axes.every((a) => validAxis(a, sizes['xyz'.indexOf(a.axis)]))))
              }
              onClick={async () => {
                const seq = ++actionId.current;
                setLoading(true);
                await act(
                  index
                    ? { key: choice.hit.key, kind: 'attachment', index }
                    : { key: choice.hit.key, kind: 'generator', sizes },
                  choice.action,
                  seq,
                );
                if (seq === actionId.current) setLoading(false);
              }}
            >
              {choice.action === 'preview' ? '预览' : '下载到实例'}
            </button>
          </div>
        </Modal>
      )}
      {web && (
        <Modal title="投影下载页" onClose={() => setWeb(undefined)}>
          <div className="form-body">
            <p>此投影由 {web.host === 'pan.quark.cn' ? '夸克网盘' : web.host} 提供。</p>
          </div>
          <div className="modal-footer">
            <button onClick={() => setWeb(undefined)}>取消</button>
            <button
              className="primary"
              onClick={() =>
                void run(async () => {
                  await api.openRedenDownload(web.file);
                  setWeb(undefined);
                })
              }
            >
              打开下载页
            </button>
          </div>
        </Modal>
      )}
      {doc && (
        <Modal
          wide
          title={doc.kind === 'model' ? doc.doc.name : doc.data.title}
          onClose={() => setDoc(undefined)}
        >
          <div className="form-body">
            <Suspense fallback={<p>加载预览…</p>}>
              <Preview preview={doc} />
            </Suspense>
          </div>
        </Modal>
      )}
    </section>
  );
}
