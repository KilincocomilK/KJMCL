import { useEffect, useState } from 'react';
import type { Instance, LaunchChoices, Snapshot } from '../../shared/types';
import { api } from '../api';
import { Field } from '../components';
import { Select } from '../Select';

export function LaunchOptionsSettings({
  instance,
  state,
  onChange,
}: {
  instance: Instance;
  state: Snapshot;
  onChange: (value: Instance) => void;
}) {
  const [choices, setChoices] = useState<LaunchChoices>();
  const [error, setError] = useState('');
  const options = instance.launchOptions ?? {
    fullscreen: false,
    target: { kind: 'menu' as const },
  };
  useEffect(() => {
    let live = true;
    setChoices(undefined);
    setError('');
    void api
      .launchChoices(instance.id)
      .then((value) => {
        if (live) setChoices(value);
      })
      .catch(() => {
        if (live) setError('无法读取快速进入选项');
      });
    return () => {
      live = false;
    };
  }, [instance.id]);
  const change = (patch: Partial<typeof options>) =>
    onChange({ ...instance, launchOptions: { ...options, ...patch } });
  return (
    <>
      <div className="form-grid">
        <Field label="启动账户">
          <Select
            value={options.accountId ?? ''}
            onChange={(e) => change({ accountId: e.target.value || undefined })}
          >
            <option value="">跟随当前账户</option>
            {options.accountId && !state.accounts.some((a) => a.id === options.accountId) && (
              <option value={options.accountId}>账户已移除</option>
            )}
            {state.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ·{' '}
                {a.kind === 'offline' ? '离线' : a.kind === 'microsoft' ? 'Microsoft' : '第三方'}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="启动后进入">
          <Select
            value={options.target.kind}
            onChange={(e) =>
              change({
                target:
                  e.target.value === 'server'
                    ? { kind: 'server', address: '' }
                    : e.target.value === 'world'
                      ? { kind: 'world', name: choices?.worlds[0] ?? '' }
                      : { kind: 'menu' },
              })
            }
          >
            <option value="menu">主菜单</option>
            <option value="server" disabled={!choices?.server}>
              服务器{choices && !choices.server ? '（此版本不支持）' : ''}
            </option>
            <option value="world" disabled={!choices?.world || !choices.worlds.length}>
              存档
              {choices && !choices.world
                ? '（此版本不支持）'
                : choices && !choices.worlds.length
                  ? '（暂无存档）'
                  : ''}
            </option>
          </Select>
        </Field>
      </div>
      {options.target.kind === 'server' && (
        <Field label="服务器地址">
          <input
            required
            maxLength={253}
            placeholder="mc.example.com:25565"
            value={options.target.address}
            onChange={(e) => change({ target: { kind: 'server', address: e.target.value } })}
          />
        </Field>
      )}
      {options.target.kind === 'world' && (
        <Field label="存档">
          <Select
            value={options.target.name}
            onChange={(e) => change({ target: { kind: 'world', name: e.target.value } })}
          >
            {!choices?.worlds.includes(options.target.name) && (
              <option value={options.target.name}>{options.target.name || '请选择存档'}</option>
            )}
            {choices?.worlds.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {error && <p className="inline-error">{error}</p>}
      <label className="check">
        <input
          type="checkbox"
          checked={options.fullscreen}
          onChange={(e) => change({ fullscreen: e.target.checked })}
        />
        全屏启动
      </label>
    </>
  );
}
