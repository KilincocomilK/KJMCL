import type { Store } from './store';

export function moveAccount(store: Store, id: string, direction: 'up' | 'down') {
  const previous = store.data.accounts;
  const index = previous.findIndex((account) => account.id === id);
  if (index < 0) throw new Error('账户不存在');
  const destination = index + (direction === 'up' ? -1 : 1);
  if (destination < 0 || destination >= previous.length) return;
  const next = [...previous];
  [next[index], next[destination]] = [next[destination], next[index]];
  store.data.accounts = next;
  try {
    store.save();
  } catch (error) {
    store.data.accounts = previous;
    throw error;
  }
}
