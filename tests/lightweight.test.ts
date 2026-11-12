import { afterEach, expect, it, vi } from 'vitest';
import { LightweightMode } from '../electron/core/lightweight';
import { schemas } from '../shared/schema';

afterEach(() => vi.useRealTimers());
function policy() {
  vi.useFakeTimers();
  const replace = vi.fn(async (_active: boolean) => {});
  const idle = vi.fn(() => true),
    changed = vi.fn(),
    failed = vi.fn();
  return {
    mode: new LightweightMode(replace, idle, changed, failed),
    replace,
    idle,
    changed,
    failed,
  };
}
it('automatically enters once and restores only after the last game exits', async () => {
  const { mode, replace } = policy();
  mode.running(1);
  await vi.advanceTimersByTimeAsync(1499);
  expect(replace).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(mode.active).toBe(true);
  mode.running(2);
  mode.running(1);
  await vi.advanceTimersByTimeAsync(2000);
  expect(replace.mock.calls).toEqual([[true]]);
  mode.running(0);
  await vi.advanceTimersByTimeAsync(0);
  expect(replace.mock.calls).toEqual([[true], [false]]);
});
it('suppresses mode flashes for a process that immediately exits', async () => {
  const { mode, replace } = policy();
  mode.running(1);
  await vi.advanceTimersByTimeAsync(300);
  mode.running(0);
  await vi.advanceTimersByTimeAsync(3000);
  expect(replace).not.toHaveBeenCalled();
});
it('manual full UI persists for the play session and resets on the next launch', async () => {
  const { mode, replace } = policy();
  expect(() => mode.request(true)).toThrow('游戏运行时');
  mode.running(1);
  await vi.advanceTimersByTimeAsync(1500);
  mode.request(false);
  await vi.advanceTimersByTimeAsync(50);
  mode.running(2);
  mode.running(1);
  await vi.advanceTimersByTimeAsync(2000);
  expect(replace.mock.calls).toEqual([[true], [false]]);
  mode.running(0);
  mode.running(1);
  await vi.advanceTimersByTimeAsync(1500);
  expect(mode.active).toBe(true);
});
it('waits for in-flight mutations/dialogs and cancels entry when the game exits meanwhile', async () => {
  const { mode, idle, replace } = policy();
  idle.mockReturnValue(false);
  mode.running(1);
  await vi.advanceTimersByTimeAsync(2500);
  expect(replace).not.toHaveBeenCalled();
  mode.running(0);
  idle.mockReturnValue(true);
  await vi.advanceTimersByTimeAsync(500);
  expect(replace).not.toHaveBeenCalled();
  mode.running(1);
  await vi.advanceTimersByTimeAsync(1500);
  expect(mode.active).toBe(true);
});
it('serializes a game exit during renderer replacement', async () => {
  const { mode, replace } = policy();
  let finish!: () => void;
  replace.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  mode.running(1);
  await vi.advanceTimersByTimeAsync(1500);
  mode.running(0);
  expect(replace).toHaveBeenCalledTimes(1);
  finish();
  await vi.advanceTimersByTimeAsync(0);
  expect(replace.mock.calls).toEqual([[true], [false]]);
  expect(mode.active).toBe(false);
});
it('keeps the original mode on load failure, permits retry, and cancels on quit', async () => {
  const { mode, replace, failed } = policy();
  replace.mockRejectedValueOnce(new Error('load failed'));
  mode.running(1);
  await vi.advanceTimersByTimeAsync(1500);
  expect(mode.active).toBe(false);
  expect(failed).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(10000);
  expect(replace).toHaveBeenCalledTimes(1);
  mode.request(true);
  await vi.advanceTimersByTimeAsync(50);
  expect(mode.active).toBe(true);
  mode.running(0);
  mode.dispose();
  await vi.advanceTimersByTimeAsync(1000);
  expect(replace).toHaveBeenCalledTimes(2);
});
it('accepts only boolean mode requests through the named IPC schema', () => {
  expect(schemas.setLightweight.parse(true)).toBe(true);
  for (const value of ['true', 1, {}, null, undefined])
    expect(() => schemas.setLightweight.parse(value)).toThrow();
});
