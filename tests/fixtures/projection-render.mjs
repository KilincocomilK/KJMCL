import { gzipSync } from 'node:zlib';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

// Standalone Java structure NBT writer. Neither the production codec nor the
// existing 101-block projection fixture participates in this rendering test.
const int = (value) => {
  const bytes = Buffer.alloc(4);
  bytes.writeInt32BE(value);
  return bytes;
};
const string = (value) => {
  const bytes = Buffer.from(value, 'utf8'),
    length = Buffer.alloc(2);
  length.writeUInt16BE(bytes.length);
  return Buffer.concat([length, bytes]);
};
const named = (type, name, value) => Buffer.concat([Buffer.from([type]), string(name), value]);
const compound = (entries) => Buffer.concat([...entries, Buffer.from([0])]);
const list = (type, entries) =>
  Buffer.concat([Buffer.from([type]), int(entries.length), ...entries]);
const vector = (values) => list(3, values.map(int));

export function projectionRenderGeometry() {
  const dimensions = [24, 5, 16],
    placements = [],
    palette = [],
    lookup = new Map();
  const add = (x, y, z, id, properties = {}) => {
    const state = { name: `minecraft:${id}`, properties };
    const key = JSON.stringify(state);
    if (!lookup.has(key)) {
      lookup.set(key, palette.length);
      palette.push(state);
    }
    placements.push({ pos: [x, y, z], state: lookup.get(key) });
  };
  for (let z = 0; z < 16; z++)
    for (let x = 0; x < 24; x++)
      add(
        x,
        0,
        z,
        (Math.floor(x / 4) + Math.floor(z / 4)) % 2 ? 'smooth_stone' : 'polished_andesite',
      );
  const stair = (x, z, facing, half = 'bottom', shape = 'straight', y = 1) =>
    add(x, y, z, 'oak_stairs', { facing, half, shape, waterlogged: 'false' });
  stair(1, 2, 'north');
  stair(3, 2, 'south');
  stair(5, 2, 'east');
  stair(7, 2, 'west');
  stair(9, 2, 'north', 'top');
  stair(11, 2, 'south', 'top');
  stair(1, 4, 'north', 'bottom', 'inner_left');
  stair(3, 4, 'east', 'bottom', 'inner_right');
  stair(5, 4, 'west', 'bottom', 'outer_left');
  stair(7, 4, 'south', 'bottom', 'outer_right');
  for (const [x, type] of [
    [9, 'bottom'],
    [10, 'top'],
    [11, 'double'],
  ])
    add(x, 1, 4, 'oak_slab', { type, waterlogged: 'false' });
  add(1, 1, 7, 'water', { level: '0' });
  add(2, 1, 7, 'water', { level: '5' });
  // Matched front-facing wood surfaces distinguish water in the empty upper
  // half from an incorrect translucent overlay on the solid lower half.
  add(3, 1, 7, 'oak_slab', { type: 'bottom', waterlogged: 'false' });
  add(4, 1, 7, 'oak_slab', { type: 'bottom', waterlogged: 'true' });
  add(6, 1, 7, 'lava', { level: '0' });
  add(7, 1, 7, 'lava', { level: '5' });
  add(9, 1, 7, 'glass');
  add(11, 1, 7, 'blue_stained_glass');
  add(1, 1, 10, 'grass_block', { snowy: 'false' });
  add(2, 1, 10, 'oak_leaves', { distance: '1', persistent: 'true', waterlogged: 'false' });
  add(3, 1, 10, 'redstone_wire', {
    east: 'side',
    north: 'none',
    power: '15',
    south: 'none',
    west: 'side',
  });
  for (const x of [5, 6, 7])
    add(x, 1, 10, 'oak_fence', {
      east: String(x < 7),
      west: String(x > 5),
      north: 'false',
      south: 'false',
      waterlogged: 'false',
    });
  add(9, 1, 10, 'chest', { facing: 'south', type: 'single', waterlogged: 'false' });
  for (const [y, half] of [
    [1, 'lower'],
    [2, 'upper'],
  ])
    add(11, y, 10, 'oak_door', {
      facing: 'east',
      half,
      hinge: 'left',
      open: 'false',
      powered: 'false',
    });
  // Same translucent material, with and without an opaque red block behind it.
  add(14, 1, 12, 'white_stained_glass');
  add(14, 1, 10, 'red_concrete');
  add(16, 1, 12, 'white_stained_glass');
  // A source below a waterlogged block must reach their shared face, leaving no
  // dark strip between the water column and the upper slab.
  add(20, 1, 7, 'water', { level: '0' });
  add(20, 2, 7, 'oak_slab', { type: 'bottom', waterlogged: 'true' });
  // Isolated above the gallery so a side-view ray can pass through its empty
  // upper/south corner without accidentally hitting an unrelated block.
  stair(2, 13, 'north', 'bottom', 'straight', 3);
  return { dimensions, palette, placements };
}

export async function writeProjectionRenderFixture(directory) {
  const geometry = projectionRenderGeometry();
  const palette = geometry.palette.map((state) =>
    compound([
      named(8, 'Name', string(state.name)),
      named(
        10,
        'Properties',
        compound(
          Object.entries(state.properties).map(([key, value]) => named(8, key, string(value))),
        ),
      ),
    ]),
  );
  const blocks = geometry.placements.map(({ pos, state }) =>
    compound([named(9, 'pos', vector(pos)), named(3, 'state', int(state))]),
  );
  const payload = compound([
    named(3, 'DataVersion', int(4189)),
    named(9, 'size', vector(geometry.dimensions)),
    named(9, 'palette', list(10, palette)),
    named(9, 'blocks', list(10, blocks)),
    named(9, 'entities', list(10, [])),
  ]);
  const file = path.join(directory, 'vanilla-render-gallery.nbt');
  await writeFile(file, gzipSync(named(10, '', payload)));
  return { file, ...geometry, nonAir: geometry.placements.length };
}
