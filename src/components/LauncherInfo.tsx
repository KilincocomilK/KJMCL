import { ArrowUpRight, RefreshCw } from 'lucide-react';
import { AUTHOR, LICENSE } from '../../shared/version';
import type { LauncherUpdate, Snapshot } from '../../shared/types';
import { api } from '../api';
import type { Run } from '../ui';
import { Brand } from '../components';

function updateLabel(update?: LauncherUpdate) {
  switch (update?.status) {
    case 'checking':
      return '正在检查更新…';
    case 'available':
      return '可更新至 v' + update.version;
    case 'current':
      return '暂无可用更新';
    case 'unpublished':
      return '暂无正式版本';
    case 'unavailable':
      if (update.issue === 'rate-limit') return '请求频繁，请稍后再试';
      if (update.issue === 'access') return '暂时无法读取发布源';
      if (update.issue === 'release') return '无法识别发布版本';
      return '暂时无法检查更新';
    default:
      return '尚未检查';
  }
}

export function LauncherInfo({ state, run }: { state: Snapshot; run: Run }) {
  const update = state.launcherUpdate;
  const available = update?.status === 'available';
  const checking = update?.status === 'checking';
  return (
    <section
      className="panel setting-section launcher-info"
      aria-labelledby="launcher-info-heading"
    >
      <div className="launcher-summary">
        <div className="section-title">
          <Brand />
          <div>
            <h2 id="launcher-info-heading" tabIndex={-1}>
              启动器信息
            </h2>
            <span className="launcher-version">v{state.appVersion}</span>
          </div>
        </div>
      </div>
      <div className="release-actions" role="group" aria-label="版本更新">
        <div className="release-status">
          <strong className={available ? 'has-update' : undefined} aria-live="polite">
            {updateLabel(update)}
          </strong>
        </div>
        <div className="release-buttons">
          <button
            type="button"
            className={available ? undefined : 'primary'}
            disabled={checking}
            onClick={() => void run(() => api.checkLauncherUpdate())}
          >
            <RefreshCw size={15} className={checking ? 'spin' : undefined} />
            检查更新
          </button>
          <button
            type="button"
            className={available ? 'primary' : undefined}
            onClick={() => void run(() => api.openLauncherRelease())}
          >
            {available ? '查看新版本' : '发布记录'}
            <ArrowUpRight size={15} />
          </button>
        </div>
      </div>
      <details className="minor-details">
        <summary>版本详情</summary>
        <dl className="version-facts">
          <div>
            <dt>作者</dt>
            <dd>{AUTHOR}</dd>
          </div>
          <div>
            <dt>许可证</dt>
            <dd>{LICENSE}</dd>
          </div>
          {update?.checkedAt && (
            <div>
              <dt>上次检查</dt>
              <dd>{new Date(update.checkedAt).toLocaleString('zh-CN')}</dd>
            </div>
          )}
        </dl>
      </details>
    </section>
  );
}
