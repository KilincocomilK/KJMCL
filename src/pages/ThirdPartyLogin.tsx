import { Select } from '../Select';
import { useState } from 'react';
import { Globe } from 'lucide-react';
import type { Account } from '../../shared/types';
import { api } from '../api';
import { Field } from '../components';
import type { Run } from '../ui';
export function ThirdPartyLogin({ run }: { run: Run }) {
  const [server, setServer] = useState(''),
    [username, setUsername] = useState(''),
    [password, setPassword] = useState(''),
    [profiles, setProfiles] = useState<Account[]>([]),
    [busy, setBusy] = useState(false);
  return (
    <section className="panel setting-section third-login">
      <div className="section-title">
        <Globe size={19} />
        <h2>第三方账户</h2>
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const result = await run(() => api.loginThirdParty({ server, username, password }));
          setPassword('');
          setBusy(false);
          if (result) setProfiles(result);
        }}
      >
        <Field label="认证 API 根地址">
          <input
            required
            type="url"
            placeholder="https://skin.example.com/api/yggdrasil"
            value={server}
            onChange={(e) => setServer(e.target.value)}
          />
        </Field>
        <div className="form-grid">
          <Field label="用户名 / 邮箱">
            <input
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
          </Field>
          <Field label="密码">
            <input
              required
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </Field>
        </div>
        <button disabled={busy} className="primary">
          登录第三方账户
        </button>
      </form>
      {profiles.length > 1 && (
        <Field label="游戏角色">
          <Select
            onChange={(e) =>
              void run(() => api.selectProfile({ accountId: profiles[0].id, uuid: e.target.value }))
            }
          >
            {profiles.map((p) => (
              <option key={p.uuid} value={p.uuid}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
    </section>
  );
}
