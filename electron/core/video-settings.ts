import path from 'node:path';
import { lstat, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { Store } from './store';
import { atomicJson, exists, json } from './files';
import type { VideoPresetState } from '../../shared/types';
const presets = {
  balanced: {
    renderDistance: '12',
    simulationDistance: '8',
    entityDistanceScaling: '1.0',
    maxFps: '120',
  },
  low: {
    renderDistance: '8',
    simulationDistance: '5',
    entityDistanceScaling: '0.75',
    maxFps: '60',
  },
};
type Undo = {
  schemaVersion: 1;
  before: Record<string, string>;
  after: Record<string, string>;
  createdAt: number;
};
export function optionValues(text: string) {
  const values: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const n = line.indexOf(':');
    if (n > 0 && Object.hasOwn(presets.low, line.slice(0, n))) {
      if (Object.hasOwn(values, line.slice(0, n)))
        throw new Error('游戏设置包含重复字段，请先在游戏中重新保存');
      values[line.slice(0, n)] = line.slice(n + 1);
    }
  }
  return values;
}
export function replaceOptions(text: string, values: Record<string, string>) {
  return text.replace(/^([^:\r\n]+):([^\r\n]*)/gm, (line, key: string) =>
    Object.hasOwn(values, key) ? `${key}:${values[key]}` : line,
  );
}
export class VideoSettings {
  constructor(private store: Store) {}
  private paths(id: string) {
    return {
      options: path.join(this.store.dir(id), 'options.txt'),
      undo: path.join(this.store.root, 'video-backups', id + '.json'),
    };
  }
  private async read(id: string) {
    const { options } = this.paths(id);
    const s = await lstat(options).catch(() => null);
    if (!s) throw new Error('请先启动游戏并保存一次视频设置');
    if (!s.isFile() || s.isSymbolicLink() || s.size > 1024 * 1024)
      throw new Error('无法安全编辑此 options.txt');
    return readFile(options, 'utf8');
  }
  async state(id: string): Promise<VideoPresetState> {
    const values = await this.read(id)
      .then(optionValues)
      .catch(() => ({}));
    return { values, canRestore: await exists(this.paths(id).undo) };
  }
  private async write(id: string, original: string, next: string) {
    const { options } = this.paths(id),
      temp = options + '.kjmcl.tmp';
    try {
      // Exclusive temporary file: never follow a pre-existing symlink.
      await writeFile(temp, next, { flag: 'wx' });
    } catch {
      throw new Error('无法写入游戏设置临时文件，请检查权限或残留的 options.txt.kjmcl.tmp');
    }
    try {
      if ((await this.read(id)) !== original) throw new Error('游戏设置在操作期间发生变化，请重试');
      await rename(temp, options);
    } finally {
      await rm(temp, { force: true });
    }
  }
  async apply(id: string, preset: keyof typeof presets) {
    const text = await this.read(id),
      current = optionValues(text),
      after: Record<string, string> = {},
      before: Record<string, string> = {};
    for (const [k, v] of Object.entries(presets[preset]))
      if (Object.hasOwn(current, k) && current[k] !== v) {
        before[k] = current[k];
        after[k] = v;
      }
    if (!Object.keys(after).length) throw new Error('无需修改，或当前版本没有可识别的视频设置');
    const undoFile = this.paths(id).undo;
    if (await exists(undoFile)) throw new Error('请先还原上次预设，再应用新的预设');
    await atomicJson(undoFile, {
      schemaVersion: 1,
      before,
      after,
      createdAt: Date.now(),
    } satisfies Undo);
    try {
      await this.write(id, text, replaceOptions(text, after));
    } catch (e) {
      await rm(undoFile, { force: true });
      throw e;
    }
  }
  async restore(id: string) {
    const file = this.paths(id).undo,
      undo = await json<Undo>(file),
      text = await this.read(id),
      current = optionValues(text);
    if (undo.schemaVersion !== 1) throw new Error('不支持的视频设置备份');
    for (const [k, v] of Object.entries(undo.after))
      if (current[k] !== v && current[k] !== undo.before[k])
        throw new Error('预设字段已在游戏中修改；为保留这些修改，本次未还原');
    await this.write(id, text, replaceOptions(text, undo.before));
    await rm(file);
  }
}
