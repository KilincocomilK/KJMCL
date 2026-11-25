import { useEffect, useState } from 'react';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import type { Snapshot, WorldRef } from '../../shared/types';
import type { ProjectionDocument } from '../../shared/projection';
import { ItemArt, type ItemName } from '../components/ItemArt';
import type { Run } from '../ui';
import { SkinEditorPage } from './SkinEditor';
import { SeedMapPage } from './SeedMap';
import { ProjectionWorkshopPage } from './ProjectionWorkshop';
import '../toolbox.css';
export type ToolId = 'skin-editor' | 'seed-map' | 'projection';
export const toolLabels: Record<ToolId, string> = {
  'skin-editor': '皮肤编辑器',
  'seed-map': '种子地图',
  projection: '投影工坊',
};
const toolItems: { id: ToolId; art: ItemName }[] = [
  { id: 'projection', art: 'plan' },
  { id: 'skin-editor', art: 'brush' },
  { id: 'seed-map', art: 'map' },
];
export function ToolboxPage({
  state,
  run,
  active,
  tool,
  onTool,
  skinAccountId,
  onSkinImported,
  world,
  onWorldImported,
  projectionDocument,
  onProjectionImported,
  onProjectionBack,
}: {
  state: Snapshot;
  run: Run;
  active: boolean;
  tool?: ToolId;
  onTool: (tool?: ToolId) => void;
  skinAccountId?: string;
  onSkinImported: () => void;
  world?: WorldRef;
  onWorldImported: () => void;
  projectionDocument?: ProjectionDocument;
  onProjectionImported: () => void;
  onProjectionBack?: () => void;
}) {
  const [visited, setVisited] = useState<Partial<Record<ToolId, boolean>>>({});
  useEffect(() => {
    if (tool) setVisited((v) => ({ ...v, [tool]: true }));
  }, [tool]);
  return (
    <section className="toolbox-page" hidden={!active} aria-label="工具箱">
      {!tool && (
        <div className="toolbox-grid">
          {toolItems.map(({ id, art }) => (
            <button key={id} className={'toolbox-card tool-' + id} onClick={() => onTool(id)}>
              <span className="tool-art">
                <ItemArt name={art} size={80} />
              </span>
              <span className="tool-label">
                <strong>{toolLabels[id]}</strong>
                <ChevronRight size={17} />
              </span>
            </button>
          ))}
        </div>
      )}
      {tool && (
        <div className="toolbox-navigation">
          <button
            onClick={() =>
              tool === 'projection' && onProjectionBack ? onProjectionBack() : onTool(undefined)
            }
          >
            <ArrowLeft size={15} />
            {tool === 'projection' && onProjectionBack ? '返回资源管理' : '返回工具箱'}
          </button>
        </div>
      )}
      {(visited['skin-editor'] || tool === 'skin-editor') && (
        <SkinEditorPage
          state={state}
          run={run}
          active={active && tool === 'skin-editor'}
          importAccountId={skinAccountId}
          onImported={onSkinImported}
        />
      )}
      {(visited['seed-map'] || tool === 'seed-map') && (
        <SeedMapPage
          state={state}
          run={run}
          active={active && tool === 'seed-map'}
          importWorld={world}
          onImported={onWorldImported}
        />
      )}
      {(visited.projection || tool === 'projection') && (
        <ProjectionWorkshopPage
          state={state}
          run={run}
          active={active && tool === 'projection'}
          importDocument={projectionDocument}
          onImported={onProjectionImported}
        />
      )}
    </section>
  );
}
