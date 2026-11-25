import { useEffect, useState, type CSSProperties } from 'react';
import type { Snapshot } from '../shared/types';
import { api } from './api';

export function Background({ state }: { state: Snapshot }) {
  const appearance = state.appearance;
  const backgroundId = appearance?.backgroundId;
  const [image, setImage] = useState<{ id: string; url: string }>();
  useEffect(() => {
    let current = true;
    if (backgroundId) {
      void api
        .backgroundImage()
        .then((url) => {
          if (current) setImage(url ? { id: backgroundId, url } : undefined);
        })
        .catch(() => {
          if (current) setImage(undefined);
        });
    } else setImage(undefined);
    return () => {
      current = false;
    };
  }, [backgroundId]);
  const url = image?.id === backgroundId ? image?.url : undefined;
  return (
    <div
      className="app-background"
      aria-hidden="true"
      style={
        {
          '--background-darkness': (appearance?.dim ?? 32) / 100,
          '--background-blur': `${appearance?.blur ?? 0}px`,
        } as CSSProperties
      }
    >
      <div className="background-scene">
        {url && <img src={url} alt="" onError={() => setImage(undefined)} />}
      </div>
      <div className="background-shade" />
    </div>
  );
}
