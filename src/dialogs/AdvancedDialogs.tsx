import { Select } from '../Select';
import { useEffect, useRef, useState } from 'react';
import { Copy, FolderOpen, Upload, Download, RefreshCw, ArrowUpRight } from 'lucide-react';
import type { Account, Instance, MinecraftScan, PackReview, GameLayout } from '../../shared/types';
import { api } from '../api';
import { Field, Modal } from '../components';
import type { Run } from '../ui';
export function DirectoryField({
  value,
  onChange,
  label = '游戏目录',
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
}) {
  const [error, setError] = useState('');
  return (
    <Field label={label}>
      <div className="row">
        <input
          value={value}
          placeholder="默认实例目录"
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          onClick={async () => {
            try {
              const p = await api.pickDirectory();
              if (p) onChange(p);
              setError('');
            } catch (e) {
              setError(String(e));
            }
          }}
        >
          <FolderOpen size={16} />
          选择
        </button>
      </div>
      {error && <small className="inline-error">{error}</small>}
    </Field>
  );
}
export function ImportDialog({
  scan,
  run,
  onClose,
}: {
  scan: MinecraftScan;
  run: Run;
  onClose: () => void;
}) {
  const [name, setName] = useState(
      scan.root.split(/[\\/]/).filter(Boolean).at(-1)?.slice(0, 80) || '外部游戏',
    ),
    [layouts, setLayouts] = useState<Record<string, GameLayout>>(
      Object.fromEntries(scan.versions.map((v) => [v.id, 'auto'])),
    ),
    [busy, setBusy] = useState(false);
  return (
    <Modal
      title="添加游戏文件夹"
      wide
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const id = await run(() =>
            api.importMinecraft({
              selectionId: scan.selectionId,
              name,
              layouts: Object.entries(layouts).map(([versionId, layout]) => ({
                versionId,
                layout,
              })),
            }),
          );
          setBusy(false);
          if (id) onClose();
        }}
      >
        <div className="form-body">
          <div className="path-value">{scan.root}</div>
          <Field label="文件夹名称">
            <input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <p className="muted">
            发现 {scan.versions.length} 个版本。只添加索引，游戏和存档留在原位置。
          </p>
          <div className="folder-import-versions">
            {scan.versions.map((v) => (
              <div className="folder-import-version" key={v.id}>
                <strong>{v.name}</strong>
                <Select
                  aria-label={'运行目录 · ' + v.id}
                  value={layouts[v.id]}
                  onChange={(e) => setLayouts({ ...layouts, [v.id]: e.target.value as GameLayout })}
                >
                  <option value="auto">沿用原配置 / 自动识别</option>
                  <option value="shared">共享游戏文件夹</option>
                  <option value="version">版本独立目录</option>
                </Select>
                <small className="path-value">
                  {layouts[v.id] === 'shared'
                    ? scan.root
                    : layouts[v.id] === 'version'
                      ? scan.root +
                        (scan.root.includes('\\') ? '\\versions\\' : '/versions/') +
                        v.id
                      : v.gameDir}
                </small>
                {v.error && <small className="inline-error">{v.error}</small>}
              </div>
            ))}
          </div>
        </div>
        <div className="modal-footer">
          <button className="primary" disabled={busy}>
            <FolderOpen size={16} />
            {busy ? '正在建立索引' : '添加文件夹'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function CloneDialog({
  instance,
  run,
  onClose,
}: {
  instance: Instance;
  run: Run;
  onClose: () => void;
}) {
  const [name, setName] = useState(instance.name + ' 副本'),
    [dir, setDir] = useState(''),
    [saves, setSaves] = useState(false),
    [busy, setBusy] = useState(false);
  return (
    <Modal title="克隆实例" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const result = await run(() =>
            api.cloneInstance({
              id: instance.id,
              name,
              includeSaves: saves,
              gameDir: dir || undefined,
            }),
          );
          setBusy(false);
          if (result) onClose();
        }}
      >
        <div className="form-body">
          <Field label="副本名称">
            <input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <DirectoryField value={dir} onChange={setDir} />
          <label className="check">
            <input type="checkbox" checked={saves} onChange={(e) => setSaves(e.target.checked)} />
            包含存档
          </label>
        </div>
        <div className="modal-footer">
          <button className="primary" disabled={busy}>
            <Copy size={16} />
            创建副本
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function PublishDialog({
  instance,
  run,
  onClose,
}: {
  instance: Instance;
  run: Run;
  onClose: () => void;
}) {
  const [format, setFormat] = useState<'mrpack' | 'curseforge'>('mrpack'),
    [name, setName] = useState(instance.name),
    [version, setVersion] = useState('1.0.0'),
    [author, setAuthor] = useState(''),
    [summary, setSummary] = useState(''),
    [review, setReview] = useState<PackReview>(),
    [project, setProject] = useState(''),
    [changelog, setChangelog] = useState(''),
    [channel, setChannel] = useState<'release' | 'beta' | 'alpha'>('release'),
    [busy, setBusy] = useState(false),
    [url, setUrl] = useState('');
  return (
    <Modal title="整合包发布" wide onClose={onClose}>
      <div className="form-body">
        {!review ? (
          <>
            <div className="form-grid">
              <Field label="格式">
                <Select value={format} onChange={(e) => setFormat(e.target.value as typeof format)}>
                  <option value="mrpack">Modrinth .mrpack</option>
                  <option value="curseforge">CurseForge .zip</option>
                </Select>
              </Field>
              <Field label="版本号">
                <input
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  maxLength={64}
                />
              </Field>
              <Field label="整合包名称">
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
              </Field>
              <Field label="作者">
                <input value={author} onChange={(e) => setAuthor(e.target.value)} maxLength={80} />
              </Field>
            </div>
            <Field label="简介">
              <textarea
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                maxLength={500}
              />
            </Field>
            <small>包含已启用的托管模组和 config 目录</small>
            <button
              className="primary"
              disabled={busy || !name.trim() || !version.trim()}
              onClick={async () => {
                setBusy(true);
                const r = await run(() =>
                  api.preparePack({ id: instance.id, format, name, version, author, summary }),
                );
                if (r) setReview(r);
                setBusy(false);
              }}
            >
              <Download size={16} />
              生成发布包
            </button>
          </>
        ) : (
          <>
            <div className="panel publish-review">
              <strong>
                {review.name} · {review.version}
              </strong>
              <p>
                {review.files} 个文件 · {(review.size / 1024).toFixed(1)} KB
              </p>
              <div className="path-value">
                {review.path}
                <br />
                SHA-256: {review.sha256}
              </div>
              <small>文件清单：{review.path}.manifest.txt</small>
            </div>
            {format === 'mrpack' && !url ? (
              <>
                <Field label="Modrinth 项目 ID / Slug">
                  <input value={project} onChange={(e) => setProject(e.target.value)} />
                </Field>
                <div className="form-grid">
                  <Field label="渠道">
                    <Select
                      value={channel}
                      onChange={(e) => setChannel(e.target.value as typeof channel)}
                    >
                      <option>release</option>
                      <option>beta</option>
                      <option>alpha</option>
                    </Select>
                  </Field>
                  <Field label="更新日志">
                    <textarea value={changelog} onChange={(e) => setChangelog(e.target.value)} />
                  </Field>
                </div>
                <button
                  className="primary"
                  disabled={busy || !project}
                  onClick={async () => {
                    setBusy(true);
                    const result = await run(() =>
                      api.publishPack({
                        ticket: review.ticket,
                        projectId: project,
                        changelog,
                        channel,
                      }),
                    );
                    if (result) setUrl(result);
                    setBusy(false);
                  }}
                >
                  <Upload size={16} />
                  发布至 Modrinth
                </button>
              </>
            ) : url ? (
              <button onClick={() => void run(() => api.external(url))}>
                查看已发布版本
                <ArrowUpRight size={16} />
              </button>
            ) : (
              <p className="muted">发布包已生成，可上传至 CurseForge 作者后台。</p>
            )}
            <button
              onClick={() => {
                setReview(undefined);
                setUrl('');
              }}
            >
              重新生成
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
function SkinModel({ image, variant }: { image: string; variant: 'classic' | 'slim' }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      const c = canvas.current?.getContext('2d');
      if (!c) return;
      c.clearRect(0, 0, 128, 160);
      c.imageSmoothingEnabled = false;
      const part = (x: number, y: number, w: number, h: number, dx: number, dy: number) =>
        c.drawImage(img, x, y, w, h, dx, dy, w * 4, h * 4);
      part(8, 8, 8, 8, 48, 8);
      part(20, 20, 8, 12, 48, 40);
      const arm = variant === 'slim' ? 3 : 4;
      part(44, 20, arm, 12, 48 - arm * 4, 40);
      part(img.height === 64 ? 36 : 44, img.height === 64 ? 52 : 20, arm, 12, 80, 40);
      part(4, 20, 4, 12, 48, 88);
      part(img.height === 64 ? 20 : 4, img.height === 64 ? 52 : 20, 4, 12, 64, 88);
      part(40, 8, 8, 8, 48, 8);
      if (img.height === 64) {
        part(20, 36, 8, 12, 48, 40);
        part(44, 36, arm, 12, 48 - arm * 4, 40);
        part(52, 52, arm, 12, 80, 40);
        part(4, 36, 4, 12, 48, 88);
        part(4, 52, 4, 12, 64, 88);
      }
    };
    img.src = image;
  }, [image, variant]);
  return (
    <canvas
      ref={canvas}
      width={128}
      height={160}
      className="skin-model"
      aria-label="皮肤正面预览"
    />
  );
}
export function SkinDialog({
  account,
  run,
  onClose,
}: {
  account: Account;
  run: Run;
  onClose: () => void;
}) {
  const [image, setImage] = useState<string | null>(null),
    [variant, setVariant] = useState<'classic' | 'slim'>('classic'),
    [busy, setBusy] = useState(false);
  const refresh = async () => {
    setBusy(true);
    const result = await run(() => api.skinPreview(account.id));
    if (result !== undefined) setImage(result);
    setBusy(false);
  };
  useEffect(() => {
    void refresh();
  }, [account.id]);
  return (
    <Modal title={account.name + ' · 皮肤'} onClose={onClose}>
      <div className="form-body">
        <div className="skin-stage">
          {image ? (
            <SkinModel image={image} variant={variant} />
          ) : (
            <span>{busy ? '正在读取…' : '尚无皮肤预览'}</span>
          )}
        </div>
        {account.kind === 'offline' && <small>离线皮肤仅供本地预览</small>}
        <Field label="模型">
          <Select
            aria-label="模型"
            value={variant}
            onChange={(e) => setVariant(e.target.value as typeof variant)}
          >
            <option value="classic">经典</option>
            <option value="slim">纤细</option>
          </Select>
        </Field>
        <div className="row">
          <button disabled={busy} onClick={() => void refresh()}>
            <RefreshCw size={16} />
            刷新
          </button>
          <button
            disabled={busy}
            onClick={async () => {
              await run(() => api.resetSkin(account.id));
              await refresh();
            }}
          >
            重置
          </button>
          <button
            className="primary"
            disabled={busy}
            onClick={async () => {
              await run(() => api.uploadSkin({ id: account.id, variant }));
              await refresh();
            }}
          >
            <Upload size={16} />
            {account.kind === 'offline' ? '选择皮肤' : '上传皮肤'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
