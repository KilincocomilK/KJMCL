import { useEffect, useState } from 'react';
import { ArrowLeft, ChevronRight, Map, Paintbrush, Blocks } from 'lucide-react';
import type { Snapshot, WorldRef } from '../../shared/types';
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
}) {
  const [visited, setVisited] = useState<Partial<Record<ToolId, boolean>>>({});
  useEffect(() => {
    if (tool) setVisited((v) => ({ ...v, [tool]: true }));
  }, [tool]);
  return (
    <section className="toolbox-page" hidden={!active} aria-label="工具箱">
      {!tool && (
        <div className="toolbox-grid">
          <button className="toolbox-card" onClick={() => onTool('projection')}>
            <Blocks size={30} />
            <span>
              <strong>投影工坊</strong>
              <small>3D 分层 · 方块编辑 · 材料清单</small>
            </span>
            <ChevronRight size={18} />
          </button>
          <button className="toolbox-card" onClick={() => onTool('skin-editor')}>
            <Paintbrush size={30} />
            <span>
              <strong>皮肤编辑器</strong>
              <small>像素绘画 · 3D 预览 · 作品库</small>
            </span>
            <ChevronRight size={18} />
          </button>
          <button className="toolbox-card" onClick={() => onTool('seed-map')}>
            <Map size={30} />
            <span>
              <strong>种子地图</strong>
              <small>群系与结构 · 坐标标记 · 三维度</small>
            </span>
            <ChevronRight size={18} />
          </button>
        </div>
      )}
      {tool && (
        <div className="toolbox-navigation">
          <button onClick={() => onTool(undefined)}>
            <ArrowLeft size={15} />
            返回工具箱
          </button>
          <div className="segmented" aria-label="工具切换">
            {(Object.keys(toolLabels) as ToolId[]).map((key) => (
              <button
                key={key}
                className={key === tool ? 'active' : ''}
                aria-pressed={key === tool}
                onClick={() => onTool(key)}
              >
                {toolLabels[key]}
              </button>
            ))}
          </div>
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
        <ProjectionWorkshopPage state={state} run={run} active={active && tool === 'projection'} />
      )}
    </section>
  );
}
