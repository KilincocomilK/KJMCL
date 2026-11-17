import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Camera,
  Copy,
  Eye,
  EyeOff,
  FolderOpen,
  Lock,
  Plus,
  Redo2,
  Save,
  Scissors,
  Trash2,
  Undo2,
  Unlock,
  Upload,
} from 'lucide-react';
import type { Snapshot, SkinEditorEntry, SkinEditorVersion } from '../../shared/types';
import type {
  RGBA,
  SkinBlend,
  SkinBrush,
  SkinFace,
  SkinPart,
  SkinPoint,
  SkinProject,
  SkinResolution,
  SkinTool,
  SkinImportImage,
} from '../../shared/skin';
import { SkinEditor, defaultBrush, inspectSkin, type SkinAdjustment } from '../skin/engine';
import { SkinViewport } from '../skin/SkinViewport';
import { SkinAtlas } from '../skin/SkinAtlas';
import type { SkinPointerEvent, SkinAnimationOptions } from '../skin/view-math';
import { emptyWorkspace, type SkinWorkspace } from '../../shared/skin-workspace';
import { blendLabels, colorHex, parseColor, partLabels, tools } from '../skin/editor-ui';
import {
  AdjustmentDialog,
  AnimationDialog,
  ShortcutDialog,
  ResizeDialog,
} from '../skin/EditorDialogs';
import { BrushOptions } from '../skin/BrushOptions';
import { ColorPanel } from '../skin/ColorPanel';
import { ReferencePanel, StampPanel, PosePanel } from '../skin/WorkspacePanels';
import { SkinImportDialog } from '../skin/ImportDialog';
import { api } from '../api';
import { Select } from '../Select';
import { Field, Modal } from '../components';
import type { Run } from '../ui';
import '../skin/editor.css';

type EditorTool = (typeof tools)[number]['id'];
export function SkinEditorPage({
  state,
  run,
  active = true,
  importAccountId,
  onImported,
}: {
  state: Snapshot;
  run: Run;
  active?: boolean;
  importAccountId?: string;
  onImported?: () => void;
}) {
  const [editor, setEditor] = useState(() => new SkinEditor());
  const editorIdentity = useRef(editor);
  editorIdentity.current = editor;
  const [workspace, setWorkspace] = useState<SkinWorkspace>(emptyWorkspace);
  const [editorKey, setEditorKey] = useState(0);
  const mutationId = useRef(0);
  const [dirty, setDirty] = useState(false),
    [draftBlocked, setDraftBlocked] = useState(false);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const [pendingSwitch, setPendingSwitch] = useState<(() => void) | null>(null);
  const [revision, setRevision] = useState(0),
    [committed, setCommitted] = useState(0);
  const [loaded, setLoaded] = useState(false),
    [status, setStatus] = useState('正在恢复草稿…'),
    [error, setError] = useState('');
  const [projectId, setProjectId] = useState<string>();
  const [tool, setTool] = useState<EditorTool>('pencil');
  const [color, setColor] = useState<RGBA>([242, 107, 33, 255]),
    [secondary, setSecondary] = useState<RGBA>([30, 35, 44, 255]);
  const [hex, setHex] = useState('#f26b21'),
    [recent, setRecent] = useState<string[]>([]);
  const [brush, setBrush] = useState<SkinBrush>({
    ...defaultBrush,
    clipFace: true,
    fillScope: 'face',
  });
  const [layout, setLayout] = useState<'split' | '3d' | '2d'>('split'),
    [surface, setSurface] = useState<'base' | 'outer'>('base');
  const [showBase, setShowBase] = useState(true),
    [showOuter, setShowOuter] = useState(true),
    [grid, setGrid] = useState(true),
    [labels, setLabels] = useState(true);
  const [visibleParts, setVisibleParts] = useState<Partial<Record<SkinPart, boolean>>>({});
  const [view, setView] = useState<'free' | 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom'>(
      'free',
    ),
    [viewRevision, setViewRevision] = useState(0);
  const [pose, setPose] = useState<'stand' | 'walk' | 'run' | 'sit' | 'armsUp'>('stand'),
    [animate, setAnimate] = useState(false),
    [rotate, setRotate] = useState(false);
  const [gamePreview, setGamePreview] = useState(false),
    [flat, setFlat] = useState(true),
    [orbit, setOrbit] = useState(false);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null),
    [face, setFace] = useState<SkinFace | null>(null);
  const [dialog, setDialog] = useState<
      | 'new'
      | 'library'
      | 'adjust'
      | 'help'
      | 'apply'
      | 'animation'
      | 'model'
      | 'import'
      | 'resize'
      | null
    >(null),
    [library, setLibrary] = useState<SkinEditorEntry[]>([]);
  const [nextResolution, setNextResolution] = useState<SkinResolution>(64);
  const [pendingImage, setPendingImage] = useState<{
    image: SkinImportImage;
    mode: 'replace' | 'layer' | 'part';
  }>();
  const [selectedLayers, setSelectedLayers] = useState<string[]>([]);
  const [versions, setVersions] = useState<SkinEditorVersion[]>([]),
    [versionOwner, setVersionOwner] = useState<string>();
  const versionRequest = useRef(0);
  const [nextModel, setNextModel] = useState<'classic' | 'slim'>('classic');
  const [newName, setNewName] = useState('未命名皮肤'),
    [newResolution, setNewResolution] = useState<SkinResolution>(64),
    [newModel, setNewModel] = useState<'classic' | 'slim'>('classic');
  const [accountId, setAccountId] = useState(state.selectedAccountId ?? ''),
    [adjustment, setAdjustment] = useState<SkinAdjustment>({});
  const [importPart, setImportPart] = useState<SkinPart>('head'),
    [importSurface, setImportSurface] = useState<'both' | 'base' | 'outer'>('both');
  const [comparison, setComparison] = useState<{
    pixels: Uint8ClampedArray;
    resolution: SkinResolution;
    model: 'classic' | 'slim';
  }>();
  const [comparing, setComparing] = useState(false);
  const animationCapture = useRef<
    ((options: SkinAnimationOptions) => Promise<string[]>) | undefined
  >(undefined);
  const capture = useRef<((transparent?: boolean) => string) | undefined>(undefined),
    gesture = useRef<
      | {
          start: SkinPoint;
          points: SkinPoint[];
          selectionMode: 'replace' | 'add' | 'subtract';
          sampling?: boolean;
        }
      | undefined
    >(undefined);
  const frame = useRef<number | undefined>(undefined),
    draftSequence = useRef(0),
    initialized = useRef(false);
  const redraw = useCallback(() => {
    if (frame.current === undefined)
      frame.current = requestAnimationFrame(() => {
        frame.current = undefined;
        setRevision((v) => v + 1);
      });
  }, []);
  const commit = useCallback(() => {
    mutationId.current++;
    dirtyRef.current = true;
    redraw();
    setCommitted((v) => v + 1);
    setDirty(true);
  }, [redraw]);
  const change = useCallback(
    (work: () => void, save = true) => {
      try {
        const before = editorIdentity.current.revision;
        work();
        setError('');
        if (save && before !== editorIdentity.current.revision) commit();
        else redraw();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [commit, redraw],
  );
  const chooseColor = (next: RGBA) => {
    setColor(next);
    setHex(colorHex(next, next[3] !== 255));
    setRecent((v) =>
      [colorHex(next, true), ...v.filter((c) => c !== colorHex(next, true))].slice(0, 12),
    );
  };
  const projectForSave = (): SkinProject => ({ ...editor.serialize(), workspace });
  const updateWorkspace = (next: SkinWorkspace) => {
    setWorkspace(next);
    commit();
  };
  const replaceEditor = (project: SkinProject, id?: string) => {
    const apply = () => {
      const next = new SkinEditor(project);
      editorIdentity.current = next;
      setEditor(next);
      setEditorKey((v) => v + 1);
      setWorkspace(project.workspace ?? emptyWorkspace());
      setProjectId(id);
      setError('');
      setDraftBlocked(false);
      setComparing(false);
      setComparison({
        pixels: next.composite(),
        resolution: next.doc.resolution,
        model: next.doc.model,
      });
      setSelectedLayers([]);
      commit();
      setDirty(!id);
    };
    if (dirtyRef.current) setPendingSwitch(() => apply);
    else apply();
  };
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    void api
      .skinEditorLoadDraft()
      .then((project) => {
        if (project) {
          const next = new SkinEditor(project);
          setEditor(next);
          setWorkspace(project.workspace ?? emptyWorkspace());
          setComparison({
            pixels: next.composite(),
            resolution: next.doc.resolution,
            model: next.doc.model,
          });
          setDirty(true);
        }
        setStatus(project ? '草稿已恢复' : '');
      })
      .catch((e) => {
        setDraftBlocked(true);
        setError('草稿未能读取：' + (e instanceof Error ? e.message : String(e)));
      })
      .finally(() => setLoaded(true));
  }, []);
  useEffect(() => {
    if (!loaded || !committed || draftBlocked) return;
    const sequence = ++draftSequence.current;
    setStatus('正在保存草稿…');
    void api
      .skinEditorSaveDraft(projectForSave())
      .then(() => {
        if (sequence === draftSequence.current) setStatus('草稿已保存');
      })
      .catch((e) => {
        if (sequence === draftSequence.current) {
          setStatus('草稿未保存');
          setError(e instanceof Error ? e.message : String(e));
        }
      });
  }, [committed, loaded, editor, draftBlocked, workspace]);
  useEffect(() => {
    if (!loaded || !importAccountId) return;
    let live = true;
    void run(() => api.skinEditorAccount(importAccountId)).then((image) => {
      if (image && live && editorIdentity.current === editor) {
        setPendingImage({ image, mode: 'replace' });
        setDialog('import');
      }
      if (live) onImported?.();
    });
    return () => {
      live = false;
    };
  }, [loaded, importAccountId, editor, run, change, onImported]);
  const pixels = useMemo(() => editor.composite(), [editor, revision]);
  const inspection = useMemo(
    () => inspectSkin(pixels, editor.doc.model, editor.doc.resolution),
    [pixels, editor],
  );
  const displayPixels = useMemo(
    () =>
      comparing && comparison
        ? comparison.pixels
        : dialog === 'adjust'
          ? editor.previewAdjust(adjustment)
          : pixels,
    [comparing, comparison, dialog, adjustment, pixels, editor],
  );
  const displayModel = comparing && comparison ? comparison.model : editor.doc.model;
  const displayResolution = comparing && comparison ? comparison.resolution : editor.doc.resolution;
  const layer = editor.doc.layers.find((item) => item.id === editor.doc.activeLayerId)!;
  const history = editor.history();
  const painting = [
    'pencil',
    'eraser',
    'fill',
    'replace',
    'line',
    'rectangle',
    'ellipse',
    'gradient',
    'noise',
    'lighten',
    'darken',
    'clone',
    'sculpt',
    'stamp',
  ].includes(tool);
  const save = async (copy = false) => {
    const current = editor,
      version = mutationId.current,
      project = projectForSave();
    const id = await run(() => api.skinEditorSave({ id: copy ? undefined : projectId, project }));
    if (id && editorIdentity.current === current) {
      setProjectId(id);
      if (mutationId.current === version) setDirty(false);
      setStatus('作品已保存');
    }
    return !!id && editorIdentity.current === current && mutationId.current === version;
  };
  const importImage = async (mode: 'replace' | 'layer' | 'part') => {
    const current = editor;
    const image = await run(() => api.skinEditorImport('skin'));
    if (!image || current !== editorIdentity.current) return;
    setPendingImage({ image, mode });
    setDialog('import');
  };
  const openProject = async (id?: string) => {
    const current = editor;
    const project = await run(() => (id ? api.skinEditorOpen(id) : api.skinEditorImportProject()));
    if (project && current === editorIdentity.current) {
      replaceEditor(project, id);
      setDialog(null);
    }
  };
  const accountImport = async (mode: 'replace' | 'layer') => {
    const current = editor;
    const image = await run(() => api.skinEditorAccount(accountId));
    if (image && current === editorIdentity.current) {
      setPendingImage({ image, mode });
      setDialog('import');
    }
  };
  const onPixel = (event: SkinPointerEvent) => {
    if (!loaded || comparing || dialog || pendingSwitch) return;
    const point = { x: event.x, y: event.y };
    setHover(point);
    if (event.face) setFace(event.face);
    try {
      if (event.phase === 'start') {
        gesture.current = {
          start: point,
          points: [point],
          selectionMode: event.shiftKey ? 'add' : event.ctrlKey ? 'subtract' : 'replace',
          sampling: tool === 'eyedropper' || event.altKey,
        };
        if (gesture.current.sampling) {
          chooseColor(editor.sample(point.x, point.y, brush.sampleMerged));
          return;
        }
        if (tool === 'clone' && event.ctrlKey) {
          editor.cloneSource(point);
          setStatus('克隆源已设置');
          return;
        }
        if (tool === 'wand') {
          editor.selectWand(
            point,
            brush.tolerance,
            brush.contiguous,
            brush.sampleMerged,
            gesture.current.selectionMode,
          );
          redraw();
          return;
        }
        if (painting)
          editor.beginStroke(point, {
            ...brush,
            tool: tool as SkinTool,
            color,
            secondary,
            opacity: brush.opacity * (event.pressure || 1),
          });
      } else if (event.phase === 'move') {
        if (gesture.current?.sampling) {
          chooseColor(editor.sample(point.x, point.y, brush.sampleMerged));
          return;
        } else if (painting) editor.moveStroke(point, event.discontinuous);
        if (gesture.current && tool === 'lasso') gesture.current.points.push(point);
        if (gesture.current && tool === 'select' && gesture.current.selectionMode === 'replace')
          editor.selectRect(gesture.current.start, point);
      } else {
        const action = gesture.current;
        const before = editor.revision;
        if (action?.sampling) {
          gesture.current = undefined;
          return;
        }
        if (painting) editor.endStroke();
        if (action && tool === 'select')
          editor.selectRect(action.start, point, action.selectionMode);
        if (action && tool === 'lasso')
          editor.selectPolygon([...action.points, point], action.selectionMode);
        if (action && tool === 'move')
          editor.moveSelection(point.x - action.start.x, point.y - action.start.y);
        gesture.current = undefined;
        if ((painting || tool === 'move') && editor.revision !== before) commit();
      }
      redraw();
      setError('');
    } catch (e) {
      gesture.current = undefined;
      editor.cancelStroke();
      setError(e instanceof Error ? e.message : String(e));
      redraw();
    }
  };
  useEffect(() => {
    if (!active || !loaded || pendingSwitch || comparing) return;
    const key = (event: KeyboardEvent) => {
      if (
        (event.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]') ||
        dialog
      )
        return;
      const command = event.ctrlKey || event.metaKey,
        letter = event.key.toLowerCase();
      if (command) {
        const action =
          letter === 'z'
            ? () => (event.shiftKey ? editor.redo() : editor.undo())
            : letter === 'y'
              ? () => editor.redo()
              : letter === 'a'
                ? () => editor.selectAll()
                : letter === 'd'
                  ? () => editor.clearSelection()
                  : letter === 'c'
                    ? () => editor.copy()
                    : letter === 'x'
                      ? () => editor.copy(true)
                      : letter === 'v'
                        ? () => editor.paste()
                        : undefined;
        if (action) {
          event.preventDefault();
          change(action, ['z', 'y', 'x', 'v'].includes(letter));
        }
        if (letter === 's') {
          event.preventDefault();
          void save(event.shiftKey);
        }
        return;
      }
      if (event.key === 'Escape') {
        change(() => {
          editor.cancelStroke();
          editor.clearSelection();
        }, false);
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        change(() => editor.clear());
        return;
      }
      if (event.key === '[' || event.key === ']') {
        setBrush((b) => ({
          ...b,
          size: Math.max(1, Math.min(64, b.size + (event.key === ']' ? 1 : -1))),
        }));
        return;
      }
      if (letter === 'x') {
        setSecondary(color);
        chooseColor(secondary);
        return;
      }
      const selected = tools.find(
        (t) => (workspace.shortcuts[t.id] ?? t.key).toLowerCase() === letter,
      );
      if (selected) {
        event.preventDefault();
        setTool(selected.id);
      }
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        change(() =>
          editor.moveSelection(
            event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0,
            event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0,
          ),
        );
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  const openLibrary = async () => {
    const entries = await run(() => api.skinEditorList());
    if (entries) {
      setLibrary(entries);
      setDialog('library');
    }
  };
  const loadVersions = async (id: string) => {
    const seq = ++versionRequest.current;
    setVersionOwner(undefined);
    const list = await run(() => api.skinEditorVersions(id));
    if (list && seq === versionRequest.current) {
      setVersions(list);
      setVersionOwner(id);
    }
  };
  if (!loaded)
    return (
      <section className="skin-editor" hidden={!active}>
        <p role="status">正在恢复草稿…</p>
      </section>
    );
  return (
    <section className="skin-editor" hidden={!active} aria-label="皮肤编辑器">
      <div className="skin-document-bar">
        <input
          aria-label="作品名称"
          maxLength={80}
          value={editor.doc.name}
          onChange={(e) => change(() => editor.setName(e.target.value || '未命名皮肤'))}
        />
        <details className="skin-menu">
          <summary>文件</summary>
          <div>
            <button onClick={() => setDialog('new')}>新建皮肤</button>
            <button onClick={() => void importImage('replace')}>导入 PNG</button>
            <button onClick={() => void importImage('layer')}>导入为图层</button>
            <button onClick={() => void openProject()}>打开工程文件</button>
            <button onClick={() => void save(true)}>另存为作品</button>
            {(['png', 'png64', 'legacy', 'project'] as const).map((format, n) => (
              <button
                key={format}
                disabled={format === 'legacy' && editor.doc.model !== 'classic'}
                onClick={() =>
                  void run(() => api.skinEditorExport({ project: projectForSave(), format }))
                }
              >
                {['导出 PNG', '导出 64×64 PNG', '导出旧版 64×32', '导出工程文件'][n]}
              </button>
            ))}
          </div>
        </details>
        <button onClick={() => void openLibrary()}>
          <FolderOpen size={16} />
          作品库
        </button>
        <button onClick={() => void save()} disabled={!loaded}>
          <Save size={16} />
          保存作品
        </button>
        <button
          className="primary"
          onClick={() =>
            void run(() => api.skinEditorExport({ project: projectForSave(), format: 'png' }))
          }
        >
          导出 PNG
        </button>
        <button onClick={() => setDialog('apply')} disabled={!state.accounts.length}>
          <Upload size={16} />
          应用
        </button>
        <button className="icon" aria-label="快捷键" onClick={() => setDialog('help')}>
          ?
        </button>
      </div>
      <div className="skin-action-bar">
        <button
          className="icon"
          aria-label="撤销"
          title="撤销 Ctrl+Z"
          disabled={!editor.canUndo}
          onClick={() => change(() => editor.undo())}
        >
          <Undo2 size={17} />
        </button>
        <button
          className="icon"
          aria-label="重做"
          title="重做 Ctrl+Y"
          disabled={!editor.canRedo}
          onClick={() => change(() => editor.redo())}
        >
          <Redo2 size={17} />
        </button>
        <Select
          aria-label="皮肤模型"
          value={editor.doc.model}
          onChange={(e) => {
            setNextModel(e.target.value as 'classic' | 'slim');
            setDialog('model');
          }}
        >
          <option value="classic">经典 · 4 像素</option>
          <option value="slim">纤细 · 3 像素</option>
        </Select>
        <Select
          aria-label="皮肤分辨率"
          value={editor.doc.resolution}
          onChange={(e) => {
            setNextResolution(Number(e.target.value) as SkinResolution);
            setDialog('resize');
          }}
        >
          {[64, 128, 256].map((n) => (
            <option key={n} value={n}>
              {n}×{n}
            </option>
          ))}
        </Select>
        <div className="segmented">
          {(['split', '3d', '2d'] as const).map((v, n) => (
            <button className={layout === v ? 'active' : ''} key={v} onClick={() => setLayout(v)}>
              {['双视图', '3D', '2D'][n]}
            </button>
          ))}
        </div>
        <span className="skin-save-state" role="status">
          {status}
        </span>
      </div>
      {error && (
        <div className="inline-error" role="alert">
          {error}
          <button className="text-button" onClick={() => setError('')}>
            关闭
          </button>
        </div>
      )}
      {draftBlocked && (
        <div className="skin-recovery">
          <span>草稿读取失败</span>
          <button
            onClick={() =>
              void run(() => api.skinEditorRecoverDraft()).then((p) => {
                if (p) {
                  replaceEditor(p);
                  setStatus('备份已恢复');
                } else setError('没有可用备份');
              })
            }
          >
            恢复备份
          </button>
          <button
            onClick={() => {
              setDraftBlocked(false);
              setError('');
              commit();
            }}
          >
            继续当前工程
          </button>
        </div>
      )}
      <div className="skin-workbench">
        <aside className="skin-toolbox" aria-label="绘画工具">
          <div className="skin-tools">
            {tools.map((t) => (
              <button
                key={t.id}
                className={tool === t.id ? 'active' : ''}
                aria-pressed={tool === t.id}
                title={`${t.label} (${workspace.shortcuts[t.id] ?? t.key})`}
                onClick={() => setTool(t.id)}
              >
                {t.label}
                <kbd>{(workspace.shortcuts[t.id] ?? t.key).toUpperCase()}</kbd>
              </button>
            ))}
          </div>
          <div className="skin-colors">
            <input
              type="color"
              aria-label="前景色"
              value={colorHex(color)}
              onChange={(e) => chooseColor(parseColor(e.target.value)!)}
            />
            <button
              title="交换颜色 X"
              aria-label="交换前景与背景色"
              style={{ background: colorHex(secondary) }}
              onClick={() => {
                setSecondary(color);
                chooseColor(secondary);
              }}
            >
              ⇄
            </button>
          </div>
          <input
            aria-label="HEX 颜色"
            className="skin-hex"
            value={hex}
            maxLength={9}
            onChange={(e) => {
              setHex(e.target.value);
              const c = parseColor(e.target.value);
              if (c) setColor(c);
            }}
            onBlur={() => setHex(colorHex(color, color[3] !== 255))}
          />
          <label>
            大小 <output>{brush.size}</output>
            <input
              aria-label="画笔大小"
              type="range"
              min="1"
              max="64"
              value={brush.size}
              onChange={(e) => setBrush({ ...brush, size: +e.target.value })}
            />
          </label>
          <label>
            不透明度 <output>{Math.round(brush.opacity * 100)}%</output>
            <input
              aria-label="画笔不透明度"
              type="range"
              min="0"
              max="1"
              step=".01"
              value={brush.opacity}
              onChange={(e) => setBrush({ ...brush, opacity: +e.target.value })}
            />
          </label>
          <BrushOptions tool={tool} value={brush} onChange={setBrush} />
          <details>
            <summary>选区</summary>
            <div className="skin-small-actions">
              <button onClick={() => change(() => editor.selectAll(), false)}>全选</button>
              <button onClick={() => change(() => editor.clearSelection(), false)}>取消</button>
              <button onClick={() => change(() => editor.invertSelection(), false)}>反选</button>
              <button
                disabled={!face}
                onClick={() => face && change(() => editor.selectFace(face), false)}
              >
                选中当前面
              </button>
              <button title="复制 Ctrl+C" onClick={() => change(() => editor.copy(), false)}>
                <Copy size={14} />
              </button>
              <button title="剪切 Ctrl+X" onClick={() => change(() => editor.copy(true))}>
                <Scissors size={14} />
              </button>
              <button onClick={() => change(() => editor.paste())}>粘贴</button>
              <button onClick={() => change(() => editor.transform('flipX'))}>水平翻转</button>
              <button onClick={() => change(() => editor.transform('flipY'))}>垂直翻转</button>
              <button onClick={() => change(() => editor.transform('rotateCW'))}>顺时针旋转</button>
              <button onClick={() => change(() => editor.clear())}>清空</button>
            </div>
          </details>
        </aside>
        <div className="skin-center">
          <div className="skin-view-bar">
            <div className="segmented">
              <button
                className={surface === 'base' ? 'active' : ''}
                onClick={() => {
                  setSurface('base');
                  setShowBase(true);
                }}
              >
                绘制内层
              </button>
              <button
                className={surface === 'outer' ? 'active' : ''}
                onClick={() => {
                  setSurface('outer');
                  setShowOuter(true);
                }}
              >
                绘制外层
              </button>
            </div>
            <label className="check">
              <input type="checkbox" checked={orbit} onChange={(e) => setOrbit(e.target.checked)} />
              旋转工具
            </label>
            <button onClick={() => setViewRevision((v) => v + 1)}>重置视角</button>
          </div>
          <div className={'skin-canvases layout-' + layout}>
            {active && layout !== '2d' && (
              <SkinViewport
                pixels={displayPixels}
                resolution={displayResolution}
                model={displayModel}
                revision={revision}
                onPixel={onPixel}
                onHover={(point) => {
                  setHover(point);
                  if (point?.face) setFace(point.face);
                }}
                activeSurface={surface}
                visibleParts={visibleParts}
                showBase={showBase}
                showOuter={showOuter}
                view={view}
                viewRevision={viewRevision}
                pose={pose}
                animate={animate}
                autoRotate={rotate}
                grid={grid}
                gamePreview={gamePreview}
                flatLight={flat}
                mode={orbit || comparing ? 'orbit' : 'paint'}
                brushSize={brush.size}
                altPaint
                poseAngles={workspace.poseAngles}
                background={workspace.background}
                checkerboard={workspace.checkerboard}
                onCaptureReady={(callback) => {
                  capture.current = callback;
                }}
                onAnimationReady={(callback) => {
                  animationCapture.current = callback;
                }}
              />
            )}
            {active && layout !== '3d' && (
              <SkinAtlas
                pixels={displayPixels}
                resolution={displayResolution}
                model={displayModel}
                revision={revision}
                onPixel={onPixel}
                onHover={(point) => {
                  setHover(point);
                  if (point?.face) setFace(point.face);
                }}
                grid={grid}
                labels={labels}
                selection={comparing ? null : editor.selection}
                activeFace={face}
                brushSize={brush.size}
                altPaint
                mode={orbit || comparing ? 'pan' : 'paint'}
                viewRevision={viewRevision}
              />
            )}
          </div>
          <div className="skin-canvas-status">
            <span>
              {hover ? `${hover.x}, ${hover.y}` : ' '}
              {face
                ? ` · ${partLabels[face.part]} · ${face.surface === 'base' ? '内层' : '外层'}`
                : ''}
            </span>
            <span>
              {layer.name} · {editor.doc.resolution} px
            </span>
          </div>
          <div className="skin-preview-options">
            <Select
              aria-label="观察方向"
              value={view}
              onChange={(e) => {
                setView(e.target.value as typeof view);
                setViewRevision((v) => v + 1);
              }}
            >
              {['free', 'front', 'back', 'left', 'right', 'top', 'bottom'].map((v, n) => (
                <option key={v} value={v}>
                  {['自由视角', '正面', '背面', '左侧', '右侧', '顶部', '底部'][n]}
                </option>
              ))}
            </Select>
            <Select
              aria-label="预览姿势"
              value={pose}
              onChange={(e) => setPose(e.target.value as typeof pose)}
            >
              {['stand', 'walk', 'run', 'sit', 'armsUp'].map((v, n) => (
                <option key={v} value={v}>
                  {['站立', '行走', '奔跑', '坐姿', '举手'][n]}
                </option>
              ))}
            </Select>
            {[
              [grid, setGrid, '网格'],
              [labels, setLabels, 'UV 标注'],
              [animate, setAnimate, '动作'],
              [rotate, setRotate, '转台'],
              [flat, setFlat, '原色'],
              [gamePreview, setGamePreview, '游戏效果'],
            ].map(([value, setter, label]) => (
              <label className="check" key={String(label)}>
                <input
                  type="checkbox"
                  checked={Boolean(value)}
                  onChange={(e) => (setter as (v: boolean) => void)(e.target.checked)}
                />
                {String(label)}
              </label>
            ))}
            <button
              disabled={layout === '2d'}
              onClick={() =>
                capture.current && void run(() => api.skinEditorCapture(capture.current!(true)))
              }
            >
              <Camera size={15} />
              截图
            </button>
            <button disabled={layout === '2d'} onClick={() => setDialog('animation')}>
              导出动画
            </button>
            <button
              onClick={() => {
                setComparison({
                  pixels: pixels.slice(),
                  model: editor.doc.model,
                  resolution: editor.doc.resolution,
                });
                setComparing(false);
              }}
            >
              设为对照
            </button>
            <button
              className={comparing ? 'active' : ''}
              disabled={!comparison}
              onClick={() => setComparing(!comparing)}
            >
              {comparing ? '返回编辑' : '查看对照'}
            </button>
          </div>
        </div>
        <aside className="skin-inspector">
          <section>
            <h2>
              图层 <span>{editor.doc.layers.length}/16</span>
            </h2>
            <div className="skin-small-actions">
              <button aria-label="新建图层" onClick={() => change(() => editor.addLayer())}>
                <Plus size={15} />
              </button>
              <button aria-label="复制图层" onClick={() => change(() => editor.duplicateLayer())}>
                <Copy size={15} />
              </button>
              <button
                aria-label="删除图层"
                disabled={editor.doc.layers.length < 2}
                onClick={() => change(() => editor.deleteLayer())}
              >
                <Trash2 size={15} />
              </button>
              <button
                aria-label="图层上移"
                onClick={() => change(() => editor.moveLayer(layer.id, 1))}
              >
                <ArrowUp size={15} />
              </button>
              <button
                aria-label="图层下移"
                onClick={() => change(() => editor.moveLayer(layer.id, -1))}
              >
                <ArrowDown size={15} />
              </button>
            </div>
            <div className="skin-layer-list">
              {[...editor.doc.layers].reverse().map((item) => (
                <div
                  className={'skin-layer ' + (layer.id === item.id ? 'active' : '')}
                  key={item.id}
                >
                  <input
                    className="skin-layer-select"
                    type="checkbox"
                    aria-label={'选择图层 ' + item.name}
                    checked={selectedLayers.includes(item.id)}
                    onChange={(e) =>
                      setSelectedLayers(
                        e.target.checked
                          ? [...selectedLayers, item.id]
                          : selectedLayers.filter((id) => id !== item.id),
                      )
                    }
                  />
                  <button
                    aria-label={(item.visible ? '隐藏 ' : '显示 ') + item.name}
                    onClick={() =>
                      change(() => editor.updateLayer(item.id, { visible: !item.visible }))
                    }
                  >
                    {item.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                  </button>
                  <button
                    className="skin-layer-name"
                    onClick={() => change(() => editor.setActiveLayer(item.id), false)}
                  >
                    {item.name}
                  </button>
                  <button
                    aria-label={(item.locked ? '解锁 ' : '锁定 ') + item.name}
                    onClick={() =>
                      change(() => editor.updateLayer(item.id, { locked: !item.locked }))
                    }
                  >
                    {item.locked ? <Lock size={13} /> : <Unlock size={13} />}
                  </button>
                </div>
              ))}
            </div>
            {!!selectedLayers.filter((id) => editor.doc.layers.some((l) => l.id === id)).length && (
              <div className="skin-small-actions">
                <button onClick={() => setSelectedLayers(editor.doc.layers.map((l) => l.id))}>
                  全选图层
                </button>
                <button onClick={() => setSelectedLayers([])}>取消选择</button>
                {(['show', 'hide', 'lock', 'unlock', 'duplicate', 'delete'] as const).map(
                  (action, index) => (
                    <button
                      key={action}
                      onClick={() =>
                        change(() => {
                          const ids = selectedLayers.filter((id) =>
                            editor.doc.layers.some((l) => l.id === id),
                          );
                          setSelectedLayers(editor.batchLayers(ids, action));
                        })
                      }
                    >
                      {['显示', '隐藏', '锁定', '解锁', '复制', '删除'][index]}所选
                    </button>
                  ),
                )}
              </div>
            )}
            <input
              aria-label="图层名称"
              maxLength={80}
              value={layer.name}
              onChange={(e) =>
                change(() => editor.updateLayer(layer.id, { name: e.target.value || '图层' }))
              }
            />
            <Select
              aria-label="图层混合模式"
              value={layer.blend}
              onChange={(e) =>
                change(() => editor.updateLayer(layer.id, { blend: e.target.value as SkinBlend }))
              }
            >
              {Object.entries(blendLabels).map(([key, label]) => (
                <option value={key} key={key}>
                  {label}
                </option>
              ))}
            </Select>
            <label>
              图层透明度
              <input
                aria-label="图层透明度"
                type="range"
                min="0"
                max="1"
                step=".01"
                value={layer.opacity}
                onChange={(e) =>
                  change(() => editor.updateLayer(layer.id, { opacity: +e.target.value }))
                }
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={!!layer.alphaLock}
                onChange={(e) =>
                  change(() => editor.updateLayer(layer.id, { alphaLock: e.target.checked }))
                }
              />
              锁定透明像素
            </label>
            <div className="skin-small-actions">
              <button onClick={() => change(() => editor.mergeDown())}>向下合并</button>
              <button onClick={() => change(() => editor.flatten())}>合并可见</button>
            </div>
          </section>
          <details open>
            <summary>颜色与色板</summary>
            <ColorPanel
              key={editorKey}
              color={color}
              onColor={chooseColor}
              secondary={secondary}
              onSecondary={setSecondary}
              recent={recent}
              palette={editor.doc.palette}
              onPalette={(colors) => change(() => editor.setPalette(colors))}
              workspace={workspace}
              onWorkspace={updateWorkspace}
              pixels={pixels}
              onImport={async () => (await run(() => api.skinEditorImportPalette())) ?? null}
              onExport={(value) => run(() => api.skinEditorExportPalette(value))}
            />
            <button
              onClick={() => {
                setComparing(false);
                setAdjustment({});
                setDialog('adjust');
              }}
            >
              颜色调整
            </button>
          </details>
          <details open>
            <summary>模型部位</summary>
            <div className="skin-part-grid">
              {Object.entries(partLabels).map(([part, label]) => (
                <label className="check" key={part}>
                  <input
                    type="checkbox"
                    checked={visibleParts[part as SkinPart] !== false}
                    onChange={(e) => setVisibleParts({ ...visibleParts, [part]: e.target.checked })}
                  />
                  {label}
                </label>
              ))}
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={showBase}
                onChange={(e) => setShowBase(e.target.checked)}
              />
              显示内层
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={showOuter}
                onChange={(e) => setShowOuter(e.target.checked)}
              />
              显示外层
            </label>
            <div className="skin-small-actions">
              <button
                onClick={() => {
                  setVisibleParts({});
                  setShowBase(true);
                  setShowOuter(true);
                }}
              >
                显示全部
              </button>
              <button
                disabled={!face}
                onClick={() =>
                  face &&
                  setVisibleParts(
                    Object.fromEntries(
                      Object.keys(partLabels).map((part) => [part, part === face.part]),
                    ),
                  )
                }
              >
                只看当前部位
              </button>
            </div>
            <Select
              aria-label="合入部位"
              value={importPart}
              onChange={(e) => setImportPart(e.target.value as SkinPart)}
            >
              {Object.entries(partLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </Select>
            <Select
              aria-label="合入内外层"
              value={importSurface}
              onChange={(e) => setImportSurface(e.target.value as typeof importSurface)}
            >
              <option value="both">内外层</option>
              <option value="base">仅内层</option>
              <option value="outer">仅外层</option>
            </Select>
            <button onClick={() => void importImage('part')}>从皮肤合入部位</button>
          </details>
          <details>
            <summary>历史记录</summary>
            <div className="skin-history">
              {history.labels.map((label, index) => (
                <button
                  key={index}
                  className={history.index === index ? 'active' : ''}
                  onClick={() => change(() => editor.jumpHistory(index))}
                >
                  {label}
                </button>
              ))}
            </div>
          </details>
          <details>
            <summary>参考图</summary>
            <ReferencePanel
              key={editorKey}
              workspace={workspace}
              onWorkspace={updateWorkspace}
              onColor={chooseColor}
              editor={editor}
              onChange={commit}
              run={run}
            />
          </details>
          <details>
            <summary>印章素材</summary>
            <StampPanel
              key={editorKey}
              workspace={workspace}
              onWorkspace={updateWorkspace}
              onColor={chooseColor}
              editor={editor}
              onChange={() => {
                setTool('stamp');
                redraw();
              }}
              run={run}
            />
          </details>
          <details>
            <summary>姿势与背景</summary>
            <PosePanel
              key={editorKey}
              workspace={workspace}
              onWorkspace={updateWorkspace}
              onColor={chooseColor}
              editor={editor}
              onChange={commit}
              run={run}
            />
          </details>
          <details>
            <summary>游戏检查</summary>
            <p className="muted">
              合成图 · 内层透明 {inspection.baseTransparent} · 外层半透明{' '}
              {inspection.outerTranslucent} · 未用区域 {inspection.unusedPixels}
            </p>
            <div className="skin-small-actions">
              <button onClick={() => change(() => editor.fixSkin({ baseAlpha: true }, color))}>
                补齐当前层内层
              </button>
              <button onClick={() => change(() => editor.fixSkin({ outerBinaryAlpha: true }))}>
                当前层外层二值化
              </button>
              <button onClick={() => change(() => editor.fixSkin({ clearUnused: true }))}>
                清理当前层 UV
              </button>
            </div>
          </details>
        </aside>
      </div>
      {dialog === 'new' && (
        <Modal title="新建皮肤" onClose={() => setDialog(null)}>
          <div className="form-body">
            <Field label="名称">
              <input value={newName} maxLength={80} onChange={(e) => setNewName(e.target.value)} />
            </Field>
            <Field label="模型">
              <Select
                value={newModel}
                onChange={(e) => setNewModel(e.target.value as typeof newModel)}
              >
                <option value="classic">经典</option>
                <option value="slim">纤细</option>
              </Select>
            </Field>
            <Field label="分辨率">
              <Select
                value={newResolution}
                onChange={(e) => setNewResolution(+e.target.value as SkinResolution)}
              >
                {[64, 128, 256].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="modal-footer">
            <button onClick={() => setDialog(null)}>取消</button>
            <button
              className="primary"
              onClick={() => {
                const next = new SkinEditor();
                next.setName(newName.trim() || '未命名皮肤');
                next.convertModel(newModel);
                next.resize(newResolution);
                replaceEditor(next.serialize());
                setDialog(null);
              }}
            >
              创建空白皮肤
            </button>
          </div>
        </Modal>
      )}
      {dialog === 'library' && (
        <Modal
          title="作品库"
          wide
          onClose={() => {
            setDialog(null);
            versionRequest.current++;
            setVersionOwner(undefined);
          }}
        >
          <div className="skin-library">
            {!library.length && <p className="muted">暂无作品</p>}
            {library.map((entry) => (
              <article key={entry.id}>
                <img alt={entry.name} src={entry.thumbnail} />
                <strong>{entry.name}</strong>
                <small>
                  {entry.resolution}×{entry.resolution} ·{' '}
                  {entry.model === 'classic' ? '经典' : '纤细'}
                </small>
                <div className="row">
                  <button onClick={() => void openProject(entry.id)}>编辑</button>
                  <button onClick={() => void loadVersions(entry.id)}>版本</button>
                  <button
                    className="icon"
                    aria-label={'移除作品 ' + entry.name}
                    onClick={() =>
                      void run(() => api.skinEditorDelete(entry.id)).then((removed) => {
                        if (removed) {
                          setLibrary((v) => v.filter((e) => e.id !== entry.id));
                          versionRequest.current++;
                          setVersionOwner(undefined);
                        }
                      })
                    }
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </article>
            ))}
          </div>
          {versionOwner && (
            <div className="form-body">
              <strong>已保存版本</strong>
              {!versions.length && <p className="muted">暂无历史版本</p>}
              {versions.map((item) => (
                <div className="row skin-version-row" key={item.versionId}>
                  <span>
                    {new Date(item.createdAt).toLocaleString()} · {item.name}
                  </span>
                  <button
                    onClick={async () => {
                      const current = editor;
                      const project = await run(() =>
                        api.skinEditorRestoreVersion({
                          id: versionOwner,
                          versionId: item.versionId,
                        }),
                      );
                      if (project && current === editorIdentity.current) {
                        replaceEditor(project);
                        setDialog(null);
                        versionRequest.current++;
                        setVersionOwner(undefined);
                      }
                    }}
                  >
                    恢复为新工程
                  </button>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}
      {dialog === 'adjust' && (
        <AdjustmentDialog
          value={adjustment}
          onChange={setAdjustment}
          pixels={displayPixels}
          resolution={editor.doc.resolution}
          color={color}
          onClose={() => {
            setDialog(null);
            setAdjustment({});
          }}
          onApply={() => {
            change(() => editor.adjust(adjustment));
            setAdjustment({});
            setDialog(null);
          }}
        />
      )}
      {dialog === 'apply' && (
        <Modal title="应用皮肤" onClose={() => setDialog(null)}>
          <div className="form-body">
            <Field label="账户">
              <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">选择账户</option>
                {state.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ·{' '}
                    {a.kind === 'offline'
                      ? '本地预览'
                      : a.kind === 'microsoft'
                        ? 'Microsoft'
                        : '第三方'}
                  </option>
                ))}
              </Select>
            </Field>
            <button disabled={!accountId} onClick={() => void accountImport('layer')}>
              导入为图层
            </button>
            <button disabled={!accountId} onClick={() => void accountImport('replace')}>
              从此皮肤新建工程
            </button>
            {editor.doc.resolution !== 64 && <p className="muted">应用到账户需要 64×64。</p>}
          </div>
          <div className="modal-footer">
            <button onClick={() => setDialog(null)}>取消</button>
            <button
              className="primary"
              disabled={!accountId || editor.doc.resolution !== 64}
              onClick={() =>
                void run(() => api.skinEditorApply({ accountId, project: projectForSave() })).then(
                  (ok) => {
                    if (ok) {
                      setStatus('皮肤已应用');
                      setDialog(null);
                    }
                  },
                )
              }
            >
              应用
            </button>
          </div>
        </Modal>
      )}
      {dialog === 'help' && (
        <ShortcutDialog
          workspace={workspace}
          onWorkspace={updateWorkspace}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'import' && pendingImage && (
        <SkinImportDialog
          image={pendingImage.image}
          mode={pendingImage.mode}
          destinationModel={editor.doc.model}
          part={importPart}
          surface={pendingImage.mode === 'part' ? importSurface : 'both'}
          onClose={() => {
            setDialog(null);
            setPendingImage(undefined);
          }}
          onImport={(model) => {
            const { image, mode } = pendingImage;
            if (mode === 'replace') {
              const next = new SkinEditor();
              next.importImage(image, 'replace', undefined, 'both', false, model);
              replaceEditor(next.serialize());
            } else
              change(() =>
                editor.importImage(image, mode, importPart, importSurface, mode === 'part', model),
              );
            setDialog(null);
            setPendingImage(undefined);
          }}
        />
      )}
      {dialog === 'animation' && (
        <AnimationDialog
          capture={animationCapture.current}
          onClose={() => setDialog(null)}
          onTask={() => setStatus('动画正在导出，可在任务中查看')}
        />
      )}
      {dialog === 'resize' && (
        <ResizeDialog
          pixels={pixels}
          resolution={editor.doc.resolution}
          target={nextResolution}
          onClose={() => setDialog(null)}
          onApply={() => {
            change(() => editor.resize(nextResolution));
            setFace(null);
            setComparing(false);
            setDialog(null);
          }}
        />
      )}
      {dialog === 'model' && (
        <Modal title="更换皮肤模型" onClose={() => setDialog(null)}>
          <div className="form-body">
            <button
              onClick={() => {
                change(() => editor.reinterpretModel(nextModel));
                setDialog(null);
              }}
            >
              仅更换模型
            </button>
            <button
              className="primary"
              onClick={() => {
                change(() => editor.convertModel(nextModel));
                setDialog(null);
              }}
            >
              同时转换手臂像素
            </button>
          </div>
        </Modal>
      )}
      {pendingSwitch && (
        <Modal title="保存当前作品？" onClose={() => setPendingSwitch(null)}>
          <div className="form-body">
            <p>{editor.doc.name} 有未保存的修改。</p>
          </div>
          <div className="modal-footer">
            <button onClick={() => setPendingSwitch(null)}>取消</button>
            <button
              onClick={() => {
                pendingSwitch();
                setPendingSwitch(null);
              }}
            >
              不保存
            </button>
            <button
              className="primary"
              onClick={() =>
                void save().then((saved) => {
                  if (saved) {
                    pendingSwitch();
                    setPendingSwitch(null);
                  }
                })
              }
            >
              保存并继续
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
