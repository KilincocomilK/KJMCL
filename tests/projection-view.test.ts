import { describe, it, expect } from 'vitest';
import {
  blockIndex,
  coordinates,
  parseBlock,
  blockState,
  decodeBlocks,
  distance,
  isAir,
} from '../src/projection/model';
import type { ProjectionDocument } from '../shared/projection';
describe('projection view coordinates', () => {
  it('matches x-fast z-next y-last volume for noncubic dimensions', () => {
    const size: [number, number, number] = [7, 4, 19];
    for (let i = 0; i < 7 * 4 * 19; i++) expect(blockIndex(coordinates(i, size), size)).toBe(i);
    expect(coordinates(7 * 19, size)).toEqual([0, 1, 0]);
  });
  it('reads little endian palette indices beyond one byte and rejects truncated data', () => {
    const bytes = Buffer.alloc(8);
    bytes.writeUInt32LE(260, 0);
    bytes.writeUInt32LE(1, 4);
    const doc = { blocks: bytes.toString('base64'), dimensions: [2, 1, 1] } as ProjectionDocument;
    expect([...decodeBlocks(doc)]).toEqual([260, 1]);
    expect(() => decodeBlocks({ ...doc, blocks: 'AAAA' })).toThrow();
  });
  it('round trips valid block states and refuses malformed or duplicated properties', () => {
    const value = parseBlock('minecraft:oak_stairs[facing=north,half=top]');
    expect(blockState(value)).toBe('minecraft:oak_stairs[facing=north,half=top]');
    expect(() => parseBlock('minecraft:oak_log[axis=x,axis=y]')).toThrow();
    expect(() => parseBlock('../file')).toThrow();
    expect(isAir({ name: 'minecraft:void_air' })).toBe(true);
    expect(distance([0, 0, 0], [3, 4, 0])).toBe(5);
  });
});
