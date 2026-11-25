import { describe, expect, it, vi } from 'vitest';
import { Reden } from '../electron/core/reden';
import type { Network } from '../electron/core/network';
import type { ProjectionWorkshop } from '../electron/core/projection-workshop';
import { MAX_RESOURCE_BYTES, type Resources } from '../electron/core/resources';

describe('RedenMC files', () => {
  it('uses the interactive size limit only for previews and preserves original attachment indices', async () => {
    const size = 65 * 1024 ** 2;
    const net = {
      json: async () => ({
        d: [
          {
            key: 'test',
            name: '小屋',
            type: 'LitematicaShare',
            attachments: [
              { name: '说明.txt', size: 20 },
              { name: '小屋.litematic', size },
            ],
          },
        ],
      }),
      download: vi.fn(async () => {
        throw new Error('stop before transfer');
      }),
    };
    const reden = new Reden(net as unknown as Network, {} as ProjectionWorkshop, {} as Resources);
    const file = { kind: 'attachment', key: 'test', index: 2 } as const;
    await expect(reden.preview(file)).rejects.toThrow('64 MiB');
    expect(net.download).not.toHaveBeenCalled();
    await expect(
      reden.install('fixture', file, { signal: new AbortController().signal, progress: vi.fn() }),
    ).rejects.toThrow('stop before transfer');
    expect(net.download).toHaveBeenCalledWith(
      'https://redenmc.com/api/mc-services/yisibite/test/download/2',
      expect.any(String),
      expect.objectContaining({ maxBytes: MAX_RESOURCE_BYTES, size }),
    );
  });
});
