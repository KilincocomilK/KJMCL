import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile, mkdir, rm, readdir, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { PNG } from 'pngjs';
import { ProjectionWorkshop, type ProjectionRunner } from '../electron/core/projection-workshop';
import type { ProjectionData, ProjectionOp } from '../shared/projection';
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const fixtureData = (): ProjectionData => ({
  name: 'test',
  format: 'Litematic v7',
  dataVersion: 4189,
  dimensions: [2, 1, 1],
  origin: [0, 0, 0],
  palette: [{ name: 'minecraft:air' }, { name: 'minecraft:stone' }],
  blocks: Buffer.from([1, 0, 0, 0, 1, 0, 0, 0]).toString('base64'),
  nonAir: 2,
  materials: [{ palette: 1, count: 2 }],
  warnings: [],
});
async function setup(initial = fixtureData) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kjmcl-projection-service-'));
  roots.push(root);
  const source = path.join(root, 'source.litematic');
  await writeFile(source, 'source untouched');
  let active = 0,
    max = 0;
  const runner: ProjectionRunner = async (command, args) => {
    active++;
    max = Math.max(max, active);
    try {
      if (command === 'import') {
        const data = initial();
        await writeFile(String(args.output), JSON.stringify(data), { flag: 'wx' });
        return data;
      }
      const value = JSON.parse(await readFile(String(args.input), 'utf8')) as ProjectionData;
      if (command === 'read') return value;
      if (command === 'edit') {
        const op = args.op as ProjectionOp;
        if (op.kind === 'rename') value.name = op.name;
        await writeFile(String(args.output), JSON.stringify(value), { flag: 'wx' });
        return value;
      }
      if (command === 'select') return { indices: [0, 1] };
      if (command === 'export') {
        await writeFile(String(args.output), 'encoded fixture', { flag: 'wx' });
        return {};
      }
      throw new Error('Unknown test command');
    } finally {
      active--;
    }
  };
  const make = () => new ProjectionWorkshop({ root }, 'unused injected boundary', runner);
  return {
    root,
    source,
    service: make(),
    runner,
    make,
    max: () => max,
    index: path.join(root, 'projection-workshop/index.json'),
  };
}
describe('projection service persistence and boundaries', () => {
  it('reuses resource previews across restart and retains edits without touching the source', async () => {
    const f = await setup(),
      key = JSON.stringify(['fabric', 'builds/source.litematic']);
    const first = await f.service.importFile(f.source, key);
    const edited = await f.service.edit({
      ...first,
      op: { kind: 'rename', name: 'work in progress' },
    });
    const reopened = await f.make().importFile(f.source, key);
    expect(reopened).toEqual(edited);
    expect((await f.make().state()).entries).toHaveLength(1);
    expect(await readFile(f.source, 'utf8')).toBe('source untouched');
    expect((await readdir(path.dirname(f.index))).some((name) => name.startsWith('.import-'))).toBe(
      false,
    );
  });
  it('creates a separate resource project after content or resource identity changes', async () => {
    const f = await setup(),
      key = JSON.stringify(['fabric', 'source.litematic']);
    const first = await f.service.importFile(f.source, key);
    await writeFile(f.source, 'modified source');
    const modified = await f.service.importFile(f.source, key);
    const elsewhere = await f.service.importFile(
      f.source,
      JSON.stringify(['older', 'source.litematic']),
    );
    expect(new Set([first.id, modified.id, elsewhere.id]).size).toBe(3);
    expect((await f.service.state()).entries).toHaveLength(3);
    expect((await f.service.open(first.id)).revision).toBe(first.revision);
    expect(await readFile(f.source, 'utf8')).toBe('modified source');
  });
  it('keeps ordinary imports separate even when the source bytes match', async () => {
    const f = await setup();
    const a = await f.service.importFile(f.source),
      b = await f.service.importFile(f.source);
    expect(a.id).not.toBe(b.id);
    expect((await f.service.state()).entries).toHaveLength(2);
  });
  it('reopens a known resource when the library is full and preserves it on new-import failure', async () => {
    const f = await setup(),
      key = JSON.stringify(['fabric', 'source.litematic']);
    const first = await f.service.importFile(f.source, key);
    for (let i = 1; i < 32; i++) await f.service.importFile(f.source);
    const reopened = await f.service.importFile(f.source, key);
    expect(reopened.id).toBe(first.id);
    await expect(f.service.importFile(f.source, 'different resource')).rejects.toThrow('最多保存');
    expect((await f.service.state()).current?.id).toBe(first.id);
    expect((await f.service.state()).entries).toHaveLength(32);
    expect((await readdir(path.dirname(f.index))).some((name) => name.startsWith('.import-'))).toBe(
      false,
    );
  });
  it('hashes and parses the same bounded resource snapshot while the source is being edited', async () => {
    const f = await setup(),
      key = 'resource-snapshot';
    let copiedInput = '';
    const service = new ProjectionWorkshop(
      { root: f.root },
      'unused boundary',
      async (command, args) => {
        if (command === 'import') {
          copiedInput = String(args.input);
          await writeFile(f.source, 'changed by another application');
          expect(await readFile(copiedInput, 'utf8')).toBe('source untouched');
          expect(path.basename(copiedInput)).toBe(path.basename(f.source));
        }
        return f.runner(command, args);
      },
    );
    const first = await service.importFile(f.source, key);
    expect(copiedInput).not.toBe(f.source);
    await expect(readFile(copiedInput)).rejects.toThrow();
    await writeFile(f.source, 'source untouched');
    expect((await f.make().importFile(f.source, key)).id).toBe(first.id);
  });
  it('leaves the current project unchanged and removes temporary input after a failed resource import', async () => {
    const f = await setup(),
      first = await f.service.importFile(f.source);
    const service = new ProjectionWorkshop(
      { root: f.root },
      'unused boundary',
      async (command, args) => {
        if (command === 'import') throw new Error('暂不支持此投影格式');
        return f.runner(command, args);
      },
    );
    await expect(service.importFile(f.source, 'unsupported resource')).rejects.toThrow('暂不支持');
    expect((await f.service.state()).current).toEqual(first);
    expect((await readdir(path.dirname(f.index))).some((name) => name.startsWith('.import-'))).toBe(
      false,
    );
    expect(await readFile(f.source, 'utf8')).toBe('source untouched');
  });
  it('leaves the damaged index untouched when backup revisions are unreadable', async () => {
    const f = await setup(),
      first = await f.service.importFile(f.source);
    await f.service.edit({ ...first, op: { kind: 'rename', name: 'second' } });
    await rm(path.join(path.dirname(f.index), first.revision + '.kjprojection'));
    await writeFile(f.index, 'damaged original');
    await expect(f.make().recover()).rejects.toThrow();
    expect(await readFile(f.index, 'utf8')).toBe('damaged original');
    expect(
      (await readdir(path.dirname(f.index))).some((name) => name.startsWith('index.damaged')),
    ).toBe(false);
  });
  it.each([
    [
      'palette index',
      (d: ProjectionData) => {
        d.blocks = Buffer.from([9, 0, 0, 0, 1, 0, 0, 0]).toString('base64');
      },
    ],
    [
      'material counts',
      (d: ProjectionData) => {
        d.materials[0].count = 1;
      },
    ],
    [
      'volume',
      (d: ProjectionData) => {
        d.dimensions[0] = 3;
      },
    ],
    [
      'block name',
      (d: ProjectionData) => {
        d.palette[1].name = '../stone';
      },
    ],
  ])('does not commit invalid native %s data', async (_name, mutate) => {
    const f = await setup(() => {
      const data = fixtureData();
      mutate(data);
      return data;
    });
    await expect(f.service.importFile(f.source)).rejects.toThrow();
    expect(await f.service.state()).toEqual({ current: null, entries: [] });
    expect(
      (await readdir(path.dirname(f.index))).filter((name) => name.endsWith('.kjprojection')),
    ).toEqual([]);
    expect(await readFile(f.source, 'utf8')).toBe('source untouched');
  });
  it('explicitly recovers valid index backup and preserves damaged original', async () => {
    const f = await setup(),
      first = await f.service.importFile(f.source);
    await f.service.edit({ ...first, op: { kind: 'rename', name: 'second' } });
    await writeFile(f.index, 'damaged original');
    await expect(f.make().state()).rejects.toThrow();
    const recovered = await f.make().recover();
    expect(recovered?.current?.name).toBe('test');
    const archived = (await readdir(path.dirname(f.index))).find((name) =>
      name.startsWith('index.damaged'),
    );
    expect(archived).toBeTruthy();
    expect(await readFile(path.join(path.dirname(f.index), archived!), 'utf8')).toBe(
      'damaged original',
    );
    expect((await f.make().state()).current?.id).toBe(first.id);
  });
  it('keeps source bytes, revisions and history across reopen, rejects stale edits', async () => {
    const f = await setup(),
      first = await f.service.importFile(f.source),
      next = await f.service.edit({ ...first, op: { kind: 'rename', name: 'renamed' } });
    expect(next.revision).not.toBe(first.revision);
    expect(next.canUndo).toBe(true);
    await expect(
      f.service.edit({ ...first, op: { kind: 'rename', name: 'stale' } }),
    ).rejects.toThrow('已更新');
    const undo = await f.service.undo(next);
    expect(undo.name).toBe('test');
    expect(undo.canRedo).toBe(true);
    const redo = await f.service.redo(undo);
    expect(redo.name).toBe('renamed');
    await f.service.flush();
    expect((await f.make().state()).current).toEqual(redo);
    expect(await readFile(f.source, 'utf8')).toBe('source untouched');
  });
  it('serializes concurrent mutations with optimistic revision checks', async () => {
    const f = await setup(),
      doc = await f.service.importFile(f.source);
    const results = await Promise.allSettled(
      ['a', 'b', 'c'].map((name) => f.service.edit({ ...doc, op: { kind: 'rename', name } })),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(2);
    expect(f.max()).toBe(1);
    expect((await f.service.state()).current?.name).toBe('a');
  });
  it('retains only bounded history and discards the redo branch after a new edit', async () => {
    const f = await setup();
    let doc = await f.service.importFile(f.source);
    for (let i = 0; i < 24; i++)
      doc = await f.service.edit({ ...doc, op: { kind: 'rename', name: 'v' + i } });
    expect(
      (await readdir(path.dirname(f.index))).filter((n) => n.endsWith('.kjprojection')),
    ).toHaveLength(21);
    doc = await f.service.undo(doc);
    doc = await f.service.edit({ ...doc, op: { kind: 'rename', name: 'branch' } });
    expect(doc.canRedo).toBe(false);
    await expect(f.service.redo(doc)).rejects.toThrow('没有可重做');
  });
  it('retains the committed revision when removing old history fails', async () => {
    const f = await setup(),
      first = await f.service.importFile(f.source);
    let doc = first;
    for (let i = 0; i < 20; i++)
      doc = await f.service.edit({ ...doc, op: { kind: 'rename', name: 'v' + i } });
    const expired = path.join(path.dirname(f.index), first.revision + '.kjprojection');
    await rm(expired);
    await mkdir(expired);
    const committed = await f.service.edit({ ...doc, op: { kind: 'rename', name: 'committed' } });
    expect((await f.make().state()).current).toEqual(committed);
    expect(
      (JSON.parse(await readFile(f.index, 'utf8')) as { entries: { history: string[] }[] })
        .entries[0].history,
    ).not.toContain(first.revision);
  });
  it('does not reset corrupt indices or alter existing exports', async () => {
    const f = await setup(),
      doc = await f.service.importFile(f.source),
      destination = path.join(f.root, 'existing.csv');
    await writeFile(destination, 'keep');
    await expect(f.service.export(doc, 'materials', destination)).rejects.toThrow();
    expect(await readFile(destination, 'utf8')).toBe('keep');
    await writeFile(f.index, '{broken');
    await expect(f.make().state()).rejects.toThrow('原文件已保留');
    expect(await readFile(f.index, 'utf8')).toBe('{broken');
  });
  it('writes real material CSV and validated PNG, removes managed revisions only', async () => {
    const f = await setup(),
      doc = await f.service.importFile(f.source),
      csv = path.join(f.root, 'materials.csv'),
      png = path.join(f.root, 'view.png');
    await f.service.export(doc, 'materials', csv);
    expect(await readFile(csv, 'utf8')).toContain('"minecraft:stone","{}",2,0,2');
    const image = new PNG({ width: 2, height: 1 });
    image.data.set([242, 107, 33, 255, 0, 0, 0, 0]);
    await f.service.export(
      doc,
      'png',
      png,
      'data:image/png;base64,' + PNG.sync.write(image).toString('base64'),
    );
    expect(PNG.sync.read(await readFile(png)).data).toEqual(image.data);
    await expect(
      f.service.export(doc, 'png', path.join(f.root, 'bad.png'), 'data:image/png;base64,AAAA'),
    ).rejects.toThrow();
    await f.service.remove(doc.id);
    expect(await f.service.state()).toEqual({ current: null, entries: [] });
    expect(await readFile(f.source, 'utf8')).toBe('source untouched');
  });
  it('rejects linked sources and revision paths outside the workspace', async () => {
    const f = await setup(),
      external = path.join(f.root, 'outside'),
      link = path.join(f.root, 'linked');
    await mkdir(external);
    await writeFile(path.join(external, 'input'), 'outside');
    await symlink(external, link, 'junction');
    await expect(f.service.importFile(path.join(link, 'input'))).rejects.toThrow();
    await expect(f.service.open('../outside')).rejects.toThrow();
    expect(await readFile(path.join(external, 'input'), 'utf8')).toBe('outside');
  });
});
