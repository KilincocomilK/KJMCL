import path from 'node:path';
import { mkdir, readdir, realpath } from 'node:fs/promises';
import { contains } from './instances';
import { checkGamePath } from './game-folders';
import type { Store } from './store';

/** Custom locations get a dedicated child so a player's existing files stay separate. */
export async function prepareGameDirectory(store: Store, parent?: string) {
  const standard = path.join(store.root, 'instances');
  const target = parent ? path.join(parent, 'KJMCL-games') : standard;
  await checkGamePath(target, true);
  const overlaps = (other: string) => contains(other, target) || contains(target, other);
  if ((parent && overlaps(store.root)) || store.data.gameFolders.some((f) => overlaps(f.path)))
    throw new Error('请选择启动器和已有游戏目录以外的位置');
  if (store.data.instances.some((i) => contains(store.dir(i.id), target)))
    throw new Error('不能在已有实例内新建游戏文件夹');
  if (parent && path.relative(store.data.settings.instancesDir || standard, target) !== '') {
    const contents = await readdir(target).catch((error) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    if (contents.length) throw new Error('此处已有 KJMCL-games 文件，请选择其他位置');
  }
  await mkdir(target, { recursive: true });
  const directory = await realpath(target);
  const previous = store.data.settings;
  store.data.settings = { ...previous, instancesDir: parent ? directory : undefined };
  try {
    store.save('newDirectory');
  } catch (error) {
    store.data.settings = previous;
    throw error;
  }
  return directory;
}
