import { useState } from 'react';
import type { Account } from '../../shared/types';
import { Select } from '../Select';
import { SettingGroup } from '../components/SettingGroup';
import { api } from '../api';
import { Field } from '../components';
import type { Run } from '../ui';

const servers = [
  { name: 'LittleSkin', url: 'https://littleskin.cn/api/yggdrasil' },
  { name: 'KJMC', url: 'https://api.kjmc.top/api/yggdrasil' },
];

export function ThirdPartyLogin({ run, onConfigured }: { run: Run; onConfigured?: () => void }) {
  const [service, setService] = useState(servers[0].url);
  const [custom, setCustom] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [profiles, setProfiles] = useState<Account[]>([]);
  const [selectedProfile, setSelectedProfile] = useState('');
  const [busy, setBusy] = useState(false);
  const server = service || custom.trim();
  const resetLogin = () => {
    setUsername('');
    setPassword('');
    setProfiles([]);
  };
  return (
    <SettingGroup title="第三方账户" art="gear" className="third-login">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setProfiles([]);
          try {
            const result = await run(() => api.loginThirdParty({ server, username, password }));
            if (result) {
              setProfiles(result);
              setSelectedProfile(result[0]?.uuid ?? '');
              onConfigured?.();
            }
          } finally {
            setPassword('');
            setBusy(false);
          }
        }}
      >
        <Field label="认证服务" hint={service || undefined}>
          <Select
            value={service}
            disabled={busy}
            onChange={(e) => {
              resetLogin();
              setService(e.target.value);
            }}
          >
            {servers.map(({ name, url }) => (
              <option key={url} value={url}>
                {name}
              </option>
            ))}
            <option value="">自定义地址</option>
          </Select>
        </Field>
        {!service && (
          <Field label="认证 API 根地址">
            <input
              required
              type="url"
              placeholder="https://…/api/yggdrasil"
              value={custom}
              disabled={busy}
              onChange={(e) => {
                setCustom(e.target.value);
                resetLogin();
              }}
            />
          </Field>
        )}
        <div className="form-grid">
          <Field label="用户名 / 邮箱">
            <input
              required
              disabled={busy}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
          </Field>
          <Field label="密码">
            <input
              required
              disabled={busy}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </Field>
        </div>
        <button disabled={busy} className="primary">
          {busy ? '正在登录…' : '登录第三方账户'}
        </button>
      </form>
      {profiles.length > 0 && (
        <p className="inline-note" role="status">
          已添加账户 · {profiles.find((p) => p.uuid === selectedProfile)?.name}
        </p>
      )}
      {profiles.length > 1 && (
        <Field label="游戏角色">
          <Select
            value={selectedProfile}
            disabled={busy}
            onChange={async (e) => {
              const uuid = e.target.value;
              setBusy(true);
              try {
                const selected = await run(async () => {
                  await api.selectProfile({ accountId: profiles[0].id, uuid });
                  return true;
                });
                if (selected) {
                  setSelectedProfile(uuid);
                  onConfigured?.();
                }
              } finally {
                setBusy(false);
              }
            }}
          >
            {profiles.map((p) => (
              <option key={p.uuid} value={p.uuid}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
    </SettingGroup>
  );
}
