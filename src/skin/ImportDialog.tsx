import { useMemo, useState } from 'react';
import type { SkinImportImage, SkinModel, SkinPart } from '../../shared/skin';
import { Modal, Field } from '../components';
import { Select } from '../Select';
import { SkinEditor } from './engine';
import { SkinViewport } from './SkinViewport';
import { PixelPreview } from './EditorDialogs';
import { partLabels } from './editor-ui';

export function SkinImportDialog({
  image,
  mode,
  destinationModel,
  part,
  surface,
  onImport,
  onClose,
}: {
  image: SkinImportImage;
  mode: 'replace' | 'layer' | 'part';
  destinationModel: SkinModel;
  part: SkinPart;
  surface: 'both' | 'base' | 'outer';
  onImport: (model: SkinModel) => void;
  onClose: () => void;
}) {
  const [model, setModel] = useState<SkinModel>(
    image.height === image.width / 2 ? 'classic' : destinationModel,
  );
  const preview = useMemo(() => {
    const editor = new SkinEditor();
    editor.importImage(image, 'replace', undefined, 'both', false, model);
    return editor;
  }, [image, model]);
  const pixels = useMemo(() => preview.composite(), [preview]);
  return (
    <Modal
      title={
        mode === 'part' ? '合入' + partLabels[part] : mode === 'layer' ? '导入为图层' : '导入皮肤'
      }
      onClose={onClose}
    >
      <div className="form-body">
        <strong>{image.name}</strong>
        <Field label="原图模型">
          <Select
            aria-label="原图模型"
            value={model}
            onChange={(e) => setModel(e.target.value as SkinModel)}
          >
            <option value="classic">经典 · 4 像素</option>
            <option value="slim">纤细 · 3 像素</option>
          </Select>
        </Field>
        <div className="skin-import-preview">
          <SkinViewport
            pixels={pixels}
            resolution={preview.doc.resolution}
            model={model}
            mode="orbit"
            activeSurface={surface === 'outer' ? 'outer' : 'base'}
            showBase={surface !== 'outer'}
            showOuter={surface !== 'base'}
            visibleParts={
              mode === 'part'
                ? Object.fromEntries(Object.keys(partLabels).map((p) => [p, p === part]))
                : {}
            }
            flatLight
          />
          <PixelPreview pixels={pixels} resolution={preview.doc.resolution} />
        </div>
        {mode !== 'replace' && model !== destinationModel && (
          <p className="muted">
            手臂像素将转换为{destinationModel === 'slim' ? '纤细' : '经典'}模型。
          </p>
        )}
      </div>
      <div className="modal-footer">
        <button onClick={onClose}>取消</button>
        <button className="primary" onClick={() => onImport(model)}>
          导入
        </button>
      </div>
    </Modal>
  );
}
