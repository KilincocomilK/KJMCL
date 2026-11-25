import { useEffect, useState } from 'react';
import type { LocalCardKind, LocalResourceCard } from '../../shared/types';
import { api } from '../api';
import { ItemArt } from './ItemArt';

// Read archives after the list is on screen. Each batch can update independently of the search filter.
export function useLocalCards(
  id: string | undefined,
  kind: LocalCardKind | undefined,
  names: string[],
) {
  const [entries, setEntries] = useState<{
    id?: string;
    kind?: LocalCardKind;
    cards: Map<string, LocalResourceCard>;
  }>();
  useEffect(() => {
    let active = true;
    if (id && kind) {
      const cards = new Map<string, LocalResourceCard>();
      void (async () => {
        for (let index = 0; active && index < names.length; index += 16) {
          const batch = await api
            .localResourceCards({ id, kind, names: names.slice(index, index + 16) })
            .catch(() => []);
          if (!active) return;
          for (const item of batch) cards.set(item.name, item);
          setEntries({ id, kind, cards: new Map(cards) });
        }
      })();
    }
    return () => {
      active = false;
    };
  }, [id, kind, names]);
  return entries && entries.id === id && entries.kind === kind ? entries.cards : undefined;
}

const art = { mods: 'dust', resourcepacks: 'chest', worlds: 'block' } as const;
export function LocalResourceArt({ kind, icon }: { kind: LocalCardKind; icon?: string }) {
  return (
    <span className="local-resource-art" aria-hidden="true">
      {icon ? <img src={icon} alt="" /> : <ItemArt name={art[kind]} size={28} />}
    </span>
  );
}
