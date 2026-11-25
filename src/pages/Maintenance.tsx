import { useState } from 'react';
import { HardDrive, RefreshCw, Trash2 } from 'lucide-react';
import type { CacheReview, DiskReport, Snapshot } from '../../shared/types';
import { api } from '../api';
import { Modal, Empty } from '../components';
import { type Run, size } from '../ui';
export function MaintenancePage({ state, run }: { state: Snapshot; run: Run }) {
  const [report, setReport] = useState<DiskReport>(),
    [review, setReview] = useState<CacheReview>(),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState('');
  const locked =
    busy || state.running.length > 0 || state.tasks.some((t) => t.status === 'running');
  const scan = async () => {
    setBusy(true);
    const r = await run(() => api.diskUsage());
    if (r) setReport(r);
    setBusy(false);
  };
  const total = report?.rows.reduce((n, r) => n + r.bytes, 0) ?? 0;
  return (
    <>
      <div className="toolbar">
        <button disabled={busy} onClick={() => void scan()}>
          <RefreshCw size={16} />
          {busy ? '扫描中' : '分析磁盘占用'}
        </button>
        <button
          disabled={locked}
          onClick={() => {
            setBusy(true);
            void run(async () => setReview(await api.planCacheCleanup())).finally(() =>
              setBusy(false),
            );
          }}
        >
          <Trash2 size={16} />
          预览缓存清理
        </button>
      </div>
      {result && <p role="status">{result}</p>}
      {report ? (
        <section className="panel disk-report">
          <h2>
            <HardDrive size={20} /> 已统计 {(total / 1024 ** 3).toFixed(2)} GiB
          </h2>
          <p className="muted">
            {new Date(report.scannedAt).toLocaleString('zh-CN')} · 逻辑文件大小，硬链接可能重复计数
          </p>
          {report.rows.map((r) => (
            <div className="disk-row" key={r.key}>
              <div>
                <strong>{r.label}</strong>
                <span>
                  {size(r.bytes)} · {r.files.toLocaleString()} 个文件
                  {r.skipped ? ` · 跳过 ${r.skipped} 项` : ''}
                </span>
              </div>
              <progress value={r.bytes} max={total || 1} />
            </div>
          ))}
          {report.warnings.length > 0 && (
            <details>
              <summary>未统计项（{report.warnings.length}）</summary>
              {report.warnings.map((w, n) => (
                <p key={n}>{w}</p>
              ))}
            </details>
          )}
        </section>
      ) : (
        <Empty art="chest" title="尚未统计磁盘占用" />
      )}
      {review && (
        <Modal
          title="清理缓存预览"
          onClose={() => {
            if (!busy) setReview(undefined);
          }}
        >
          <div className="form-stack">
            <p>
              超过 24 小时的缓存共 {review.files} 个文件，{size(review.bytes)}。
            </p>
            <button
              className="primary"
              disabled={locked || !review.files}
              onClick={() => {
                setBusy(true);
                void run(async () => {
                  const r = await api.applyCacheCleanup(review.token);
                  setReview(undefined);
                  setReport(undefined);
                  setResult(
                    `已清理 ${r.files} 个文件，释放 ${size(r.bytes)}` +
                      (r.skipped ? `，跳过 ${r.skipped} 个` : ''),
                  );
                }).finally(() => setBusy(false));
              }}
            >
              清理这些缓存
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
