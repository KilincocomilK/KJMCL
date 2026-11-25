import path from 'node:path';
import { lstat, open } from 'node:fs/promises';
import type { LocalCardKind, LocalResourceCard } from '../../shared/types';
import type { Store } from './store';
import type { Resources } from './resources';
import { backgroundDimensions } from './appearance';
import { checkGamePath } from './game-folders';
import { assertOwned } from './instances';
import { inside } from './files';
import { pool } from './network';
import { withZipMetadata } from './resource-preview';

type ReadEntry = (name: string) => Promise<Buffer | undefined>;
type CardMetadata = Omit<LocalResourceCard, 'name' | 'icon'> & { iconPath?: string };
const manifests = [
  'fabric.mod.json',
  'quilt.mod.json',
  'META-INF/neoforge.mods.toml',
  'META-INF/mods.toml',
  'META-INF/MANIFEST.MF',
  'mcmod.info',
  'pack.mcmeta',
];
const text = (value: unknown) =>
  typeof value === 'string' ? value.trim().slice(0, 300) || undefined : undefined;

function declaredIcon(value: unknown) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return;
  const sizes = Object.entries(value)
    .filter(([size, file]) => Number(size) > 0 && typeof file === 'string')
    .sort(([a], [b]) => Number(a) - Number(b));
  return text((sizes.find(([size]) => Number(size) >= 64) ?? sizes.at(-1))?.[1]);
}
async function modMetadata(names: Set<string>, read: ReadEntry): Promise<CardMetadata> {
  const json = async (file: string) => {
    const bytes = await read(file);
    return bytes && JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
  };
  const fabric = await json('fabric.mod.json');
  const mod = fabric ?? (await json('quilt.mod.json'))?.quilt_loader;
  if (mod) {
    const meta = fabric ?? mod.metadata ?? {};
    const modId = text(mod.id);
    return {
      modId,
      title: text(meta.name),
      version: text(mod.version),
      iconPath: declaredIcon(meta.icon) ?? (modId ? 'assets/' + modId + '/icon.png' : undefined),
    };
  }
  const forge = (await read('META-INF/neoforge.mods.toml')) ?? (await read('META-INF/mods.toml'));
  if (forge) {
    const section =
      forge
        .toString('utf8')
        .split(/^\s*\[\[mods\]\]\s*(?:#.*)?$/m)[1]
        ?.split(/^\s*\[/m)[0] ?? '';
    const fields = new Map(
      Array.from(
        section.matchAll(
          /^\s*(modId|displayName|version|logoFile)\s*=\s*["']([^"'\r\n]*)["']\s*(?:#.*)?$/gm,
        ),
        (m) => [m[1], m[2]],
      ),
    );
    let version = text(fields.get('version'));
    if (version?.includes('${')) {
      const manifest = (await read('META-INF/MANIFEST.MF'))
        ?.toString('utf8')
        .replace(/\r?\n /g, '');
      version =
        version === '${file.jarVersion}'
          ? text(/^Implementation-Version:[ \t]*([^\r\n]+)/im.exec(manifest ?? '')?.[1])
          : undefined;
    }
    return {
      modId: text(fields.get('modId')),
      title: text(fields.get('displayName')),
      version,
      iconPath: fields.get('logoFile'),
    };
  }
  if (names.has('mcmod.info')) {
    const legacy = await json('mcmod.info');
    const entry = (Array.isArray(legacy) ? legacy : legacy?.modList)?.[0];
    if (entry)
      return {
        modId: text(entry.modid),
        title: text(entry.name),
        version: text(entry.version),
        iconPath: text(entry.logoFile),
      };
  }
  return {};
}

export class LocalResourceCards {
  private cache = new Map<string, { stamp: string; card: LocalResourceCard }>();
  constructor(
    private store: Store,
    private resources: Resources,
    private resize: (data: Buffer, width: number, height: number) => string | undefined,
  ) {}

  private thumbnail(bytes?: Buffer) {
    if (!bytes || bytes.length > 4 * 1024 ** 2) return;
    try {
      const { width, height } = backgroundDimensions(bytes);
      if (width * height > 4_194_304) return;
      const scale = Math.min(1, 64 / Math.max(width, height));
      return this.resize(
        bytes,
        Math.max(1, Math.round(width * scale)),
        Math.max(1, Math.round(height * scale)),
      );
    } catch {
      return undefined;
    }
  }
  private async worldIcon(file: string) {
    const handle = await open(file, 'r');
    try {
      const { size } = await handle.stat();
      if (!size || size > 4 * 1024 ** 2) return;
      const data = Buffer.alloc(size);
      const { bytesRead } = await handle.read(data, 0, size, 0);
      if (bytesRead === size) return this.thumbnail(data);
    } finally {
      await handle.close();
    }
  }
  private async card(id: string, kind: LocalCardKind, name: string): Promise<LocalResourceCard> {
    let file: string;
    if (kind === 'worlds') {
      const world = inside(path.join(this.store.dir(id), 'saves'), name);
      await checkGamePath(path.join(world, 'level.dat'));
      file = path.join(world, 'icon.png');
      await checkGamePath(file);
    } else {
      file = await this.resources.file(id, kind, name);
    }
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) return { name };
    const stamp = [stat.size, stat.mtimeMs, stat.ctimeMs].join(':');
    const cached = this.cache.get(file);
    if (cached?.stamp === stamp) return cached.card;
    const card: LocalResourceCard = { name };
    if (kind === 'worlds') card.icon = await this.worldIcon(file);
    else
      await withZipMetadata(
        file,
        (entry) =>
          kind === 'mods'
            ? manifests.includes(entry) ||
              /\.(png|jpe?g)$/i.test(entry) ||
              entry.endsWith('/lang/zh_cn.json')
            : entry === 'pack.png' || entry === 'pack.mcmeta',
        async (names, read) => {
          let iconPath = 'pack.png';
          if (kind === 'mods') {
            const { iconPath: declared, ...fields } = await modMetadata(names, read);
            Object.assign(card, fields);
            if (declared) iconPath = declared.replace(/^\.\//, '');
            if (card.modId && /^[\w.-]+$/.test(card.modId)) {
              const locale = await read('assets/' + card.modId + '/lang/zh_cn.json');
              if (locale) {
                try {
                  const entries = JSON.parse(locale.toString('utf8'));
                  card.localizedTitle =
                    text(entries['modmenu.nameTranslation.' + card.modId]) ??
                    text(entries['mod.' + card.modId + '.name']);
                } catch {
                  /* Keep the manifest title when an optional language file is malformed. */
                }
              }
            }
          } else {
            const meta = await read('pack.mcmeta');
            if (meta) {
              try {
                const description = JSON.parse(meta.toString('utf8')).pack?.description;
                card.description = text(description) ?? text(description?.text);
              } catch {
                /* A pack can still have a usable icon. */
              }
            }
          }
          card.icon = this.thumbnail(await read(iconPath));
        },
      ).catch(() => {
        /* Unrecognized archives keep their file name and category artwork. */
      });
    if (this.cache.size >= 1200) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(file, { stamp, card });
    return card;
  }
  async list(id: string, kind: LocalCardKind, names: string[]) {
    await assertOwned(this.store, id);
    const result: LocalResourceCard[] = [];
    await pool(
      [...new Set(names)],
      3,
      async (name, index) => {
        result[index] = await this.card(id, kind, name).catch(() => ({ name }));
      },
      new AbortController().signal,
    );
    return result;
  }
}
