import { useEffect, useRef, useState } from 'react';
import { Download, RefreshCw, Search } from 'lucide-react';
import type { CrashFile, CrashReport, Snapshot } from '../../shared/types';
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
      (!query || l.toLowerCase().includes(query.toLowerCase())) &&
      (!onlyEvidence || /error|exception|caused by|fatal|failed|suspected|mod id/i.test(l)),
  );
  return (
    <>
      <div className="toolbar">
        <button disabled={busy} onClick={() => void list()}>
          <RefreshCw size={16} />
          刷新报告
        </button>
        <span className="muted">崩溃报告、JVM 错误和最近日志 · 最多 200 项</span>
      </div>
      <div className="crash-workspace">
        <aside className="panel crash-library">
          {files.map((f) => (
            <button
              key={f.name}
              className={report?.file.name === f.name ? 'active' : ''}
              disabled={busy}
              onClick={() => void read(f)}
            >
              <strong>{f.name}</strong>
              <small>
                {new Date(f.modifiedAt).toLocaleString('zh-CN')} · {size(f.bytes)}
              </small>
            </button>
          ))}
        </aside>
        <div>
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
                <p className="muted">
                  规则匹配仅提供排查线索。
                  {report.truncated ? '文件超过 4 MiB，仅显示部分内容。' : ''}
                </p>
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
              description="在本机分析，不自动上传日志"
            />
          )}
        </div>
      </div>
    </>
  );
}
