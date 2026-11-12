import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import type { Snapshot } from '../../shared/types';
import { api } from '../api';
import { Field } from '../components';
import type { Run } from '../ui';
export function Integrations({ state, run }: { state: Snapshot; run: Run }) {
  const [keys, setKeys] = useState({ curseforge: '', modrinth: '' });
  return (
    <section className="panel setting-section">
      <div className="section-title">
        <ShieldCheck size={19} />
        <h2>平台凭据</h2>
      </div>
      <div className="form-grid">
        {(['curseforge', 'modrinth'] as const).map((service) => (
          <Field
            key={service}
            label={service === 'curseforge' ? 'CurseForge API Key' : 'Modrinth 发布令牌'}
            hint={state.integrations?.[service] ? '已加密保存' : '尚未配置'}
          >
            <input
              type="password"
              autoComplete="off"
              value={keys[service]}
              onChange={(e) => setKeys({ ...keys, [service]: e.target.value })}
            />
            <div className="row">
              <button
                type="button"
                disabled={!keys[service]}
                onClick={async () => {
                  await run(
                    () => api.integrationKey({ service, key: keys[service] }),
                    '凭据已保存',
                  );
                  setKeys({ ...keys, [service]: '' });
                }}
              >
                保存凭据
              </button>
              <button
                type="button"
                onClick={() =>
                  void run(() => api.integrationKey({ service, key: '' }), '凭据已移除')
                }
              >
                移除
              </button>
            </div>
          </Field>
        ))}
      </div>
    </section>
  );
}
