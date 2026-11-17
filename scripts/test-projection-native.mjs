// Independently encoded NBT, decoded without importing production codec code.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  decodeNbt,
  fixtureGeometry,
  litematicFixture,
  tag,
} from '../tests/fixtures/projection-nbt.mjs';

const root = await mkdtemp(path.join(os.tmpdir(), 'kjmcl-projection-native-'));
const binary = path.resolve(
  'dist-native/projection/kjmcl-projection' + (process.platform === 'win32' ? '.exe' : ''),
);
const output = (name) => path.join(root, name);
async function invoke(command, args) {
  const result = await new Promise((resolve, reject) => {
    const child = spawn(binary, [], {
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '',
      err = '';
    child.stdout.setEncoding('utf8').on('data', (s) => {
      out += s;
    });
    child.stderr.setEncoding('utf8').on('data', (s) => {
      err += s;
    });
    child.on('error', reject);
    child.on('close', () => {
      try {
        resolve(JSON.parse(out));
      } catch {
        reject(new Error(out + err));
      }
    });
    child.stdin.end(JSON.stringify({ protocol: 1, command, ...args }));
  });
  if (!result.ok) throw new Error(result.error);
  assert.equal(result.result.protocol, 1);
  return result.result.data;
}
const geometry = fixtureGeometry();
geometry.palette.push({
  name: 'minecraft:chest',
  properties: { facing: 'north', type: 'single', waterlogged: 'false' },
});
geometry.blocks[9] = 6; // x=1,y=0,z=1; negative-size regions still index from their minimum corner.
const items = [
  { Slot: tag('byte', 2), id: tag('string', 'minecraft:diamond'), count: tag('int', 17) },
];
const extras = {
  TileEntities: tag('list', [
    10,
    [
      {
        id: tag('string', 'minecraft:chest'),
        x: tag('int', 1),
        y: tag('int', 0),
        z: tag('int', 1),
        Items: tag('list', [10, items]),
        Lock: tag('string', 'keep'),
        Payload: tag('long', 987654321n),
      },
    ],
  ]),
  PendingBlockTicks: tag('list', [
    10,
    [
      {
        Block: tag('string', 'minecraft:stone'),
        x: tag('int', 2),
        y: tag('int', 0),
        z: tag('int', 1),
        Time: tag('long', 99n),
        Priority: tag('int', 1),
      },
    ],
  ]),
};
const source = output('container-negative.litematic'),
  project = output('container.kjprojection');
const bytes = litematicFixture(geometry, true, 7, extras);
await writeFile(source, bytes);
const imported = await invoke('import', { input: source, output: project });
assert.deepEqual(imported.origin, [4, -2, -13]);
await invoke('export', {
  input: project,
  output: output('original.litematic'),
  format: 'litematic',
});
assert.deepEqual(await readFile(output('original.litematic')), bytes);
await assert.rejects(
  invoke('export', { input: project, output: output('unsafe.schem'), format: 'schem' }),
  /附加|数据|格式|保留/,
);
await assert.rejects(access(output('unsafe.schem')));

const rotated = output('rotated.kjprojection');
await invoke('edit', { input: project, output: rotated, op: { kind: 'rotate', direction: 'cw' } });
await invoke('export', {
  input: rotated,
  output: output('rotated.litematic'),
  format: 'litematic',
});
const read = decodeNbt(await readFile(output('rotated.litematic'))),
  region = Object.values(read.Regions)[0];
assert.deepEqual(region.Size, { x: 7, y: 5, z: 8 });
const entity = region.TileEntities[0],
  tick = region.PendingBlockTicks[0];
assert.deepEqual([entity.x, entity.y, entity.z], [5, 0, 1]);
assert.deepEqual(entity.Items, [{ Slot: 2, id: 'minecraft:diamond', count: 17 }]);
assert.equal(entity.Lock, 'keep');
assert.equal(entity.Payload, 987654321n);
assert.deepEqual([tick.x, tick.y, tick.z], [5, 0, 2]);
assert.equal(tick.Time, 99n);
assert.equal(read.Metadata.Author, 'KJMCL test');

const replaced = output('replaced.kjprojection'),
  restored = output('restored.kjprojection');
await invoke('edit', {
  input: project,
  output: replaced,
  op: { kind: 'replace', indices: [9], block: { name: 'minecraft:stone' } },
});
await invoke('edit', {
  input: replaced,
  output: restored,
  op: { kind: 'replace', indices: [9], block: geometry.palette[6] },
});
await invoke('export', {
  input: restored,
  output: output('restored.litematic'),
  format: 'litematic',
});
assert.deepEqual(
  Object.values(decodeNbt(await readFile(output('restored.litematic'))).Regions)[0].TileEntities,
  [],
);

const withEntity = output('entity.litematic'),
  entityProject = output('entity.kjprojection');
const entityBytes = litematicFixture(geometry, true, 7, {
  ...extras,
  Entities: tag('list', [
    10,
    [
      {
        id: tag('string', 'minecraft:armor_stand'),
        Pos: tag('list', [6, [-2.5, 0.0, -1.5]]),
        Rotation: tag('list', [5, [45, 0]]),
      },
    ],
  ]),
});
await writeFile(withEntity, entityBytes);
await invoke('import', { input: withEntity, output: entityProject });
await assert.rejects(
  invoke('edit', {
    input: entityProject,
    output: output('unsafe-rotation.kjprojection'),
    op: { kind: 'rotate', direction: 'cw' },
  }),
  /实体/,
);
await assert.rejects(access(output('unsafe-rotation.kjprojection')));
await invoke('export', {
  input: entityProject,
  output: output('entity-copy.litematic'),
  format: 'litematic',
});
assert.deepEqual(await readFile(output('entity-copy.litematic')), entityBytes);
assert.deepEqual(await readFile(source), bytes);
console.log(
  JSON.stringify({
    passed: true,
    artifacts: root,
    checks: [
      'independent negative-size container/tick coordinates',
      'byte-exact unedited export',
      'rotation preserves inventory/custom NBT/ticks',
      'replace round-trip does not resurrect inventory',
      'unsafe conversions/transforms reject without partial output',
    ],
  }),
);
