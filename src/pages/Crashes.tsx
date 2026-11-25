import { matchesSearch } from '../../shared/search';
import { useEffect, useRef, useState } from 'react';
import { Download, RefreshCw, Search } from 'lucide-react';
import type { CrashFile, CrashReport, Snapshot } from '../../shared/types';
import { SplitView } from '../components/SplitView';
import { api } from '../api';
import { Empty, InstanceSelect } from '../components';
import { type Run, size } from '../ui';
export function CrashesPage({
  state,
  run,
  showInstanceSelect = true,
}: {
  state: Snapshot;
  run: Run;
  showInstanceSelect?: boolean;
}) {
  const id = state.selectedInstanceId ?? '';
  return (
    <>
      {showInstanceSelect && (
        <div className="toolbar">
          <InstanceSelect state={state} run={run} />
        </div>
      )}
      {id ? <CrashContent key={id} id={id} run={run} /> : <Empty title="选择一个游戏实例" />}
    </>
  );
}
function CrashContent({ id, run }: { id: string; run: Run }) {
  const [files, setFiles] = useState<CrashFile[]>([]),
    [report, setReport] = useState<CrashReport>(),
    [busy, setBusy] = useState(false),
    [query, setQuery] = useState(''),
    [onlyEvidence, setOnlyEvidence] = useState(false),
    [exported, setExported] = useState('');
  const epoch = useRef(0);
  const list = async () => {
    const n = ++epoch.current;
    setBusy(true);
    const r = await run(() => api.crashFiles(id));
    if (n === epoch.current) {
      if (r) setFiles(r);
      setBusy(false);
    }
  };
  useEffect(() => {
    void list();
    return () => {
      epoch.current++;
    };
  }, []);
  const read = async (file: CrashFile) => {
    const n = ++epoch.current;
    setReport(undefined);
    setExported('');
    setBusy(true);
    const r = await run(() => api.readCrash({ id, name: file.name }));
    if (n === epoch.current) {
      if (r) setReport(r);
      setBusy(false);
    }
  };
  const lines = report?.text.split(/\r?\n/) ?? [];
  const shown = lines.filter(
    (l) =>
      matchesSearch(query, l) &&
      (!onlyEvidence || /error|exception|caused by|fatal|failed|suspected|mod id/i.test(l)),
  );
  return (
    <SplitView
      className="crash-reports"
      railLabel="报告列表"
      rail={
        <>
          <div className="pane-heading">
            <h2>报告列表</h2>
            <button
              className="icon"
              aria-label="刷新报告"
              title="刷新报告"
              disabled={busy}
              onClick={() => void list()}
            >
              <RefreshCw size={16} />
            </button>
          </div>
          <div className="rail-list">
            {files.map((f) => (
              <button
                key={f.name}
                className="rail-option"
                aria-pressed={report?.file.name === f.name}
                title={f.name}
                disabled={busy}
                onClick={() => void read(f)}
              >
                <span>
                  <strong>{f.name}</strong>
                  <small>
                    {new Date(f.modifiedAt).toLocaleString('zh-CN')} · {size(f.bytes)}
                  </small>
                </span>
              </button>
            ))}
          </div>
        </>
      }
    >
      {report ? (
        <>
          <section className="panel crash-findings">
            <div className="row">
              <h2>诊断线索</h2>
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const result = await api.exportCrash({ id, name: report.file.name });
                    setExported(result ? '诊断包已导出' : '');
                  })
                }
              >
                <Download size={16} />
                导出诊断包
              </button>
            </div>
            {exported && <p role="status">{exported}</p>}
            {report.diagnoses.map((d, n) => (
              <div key={n}>
                <h3>{d.title}</h3>
                <p>{d.suggestion}</p>
                <code>{d.evidence}</code>
              </div>
            ))}
            {report.truncated && <p className="muted">报告过大，已截取部分内容。</p>}
          </section>
          <div className="toolbar">
            <Search size={16} />
            <input
              aria-label="搜索报告"
              placeholder="搜索报告内容"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <label>
              <input
                type="checkbox"
                checked={onlyEvidence}
                onChange={(e) => setOnlyEvidence(e.target.checked)}
              />
              仅异常线索
            </label>
          </div>
          <pre className="crash-text">
            {shown.slice(0, 20000).join('\n')}
            {shown.length > 20000 ? '\n…显示已截断，请缩小搜索范围' : ''}
          </pre>
        </>
      ) : (
        <Empty
          title={busy ? '读取报告中' : files.length ? '选择一份报告' : '尚无本地崩溃报告'}
          art="book"
        />
      )}
    </SplitView>
  );
}
