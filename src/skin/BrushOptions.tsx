import type { SkinBrush } from '../../shared/skin';
import { Select } from '../Select';
export function BrushOptions({
  value: brush,
  onChange,
  tool,
}: {
  value: SkinBrush;
  onChange: (value: SkinBrush) => void;
  tool: string;
}) {
  const number = (
    key: 'hardness' | 'tolerance' | 'gradientSteps' | 'noiseStrength' | 'noiseSeed' | 'stampScale',
    label: string,
    min: number,
    max: number,
    step = 1,
  ) => (
    <label>
      {label}
      <input
        aria-label={label}
        type={key === 'noiseSeed' ? 'number' : 'range'}
        min={min}
        max={max}
        step={step}
        value={brush[key]}
        onChange={(e) =>
          onChange({ ...brush, [key]: Math.max(min, Math.min(max, +e.target.value)) })
        }
      />
      <output>{brush[key]}</output>
    </label>
  );
  const check = (
    key:
      | 'filled'
      | 'contiguous'
      | 'sampleMerged'
      | 'clipFace'
      | 'dither'
      | 'preserveAlpha'
      | 'noisePalette'
      | 'stampFlipX'
      | 'stampFlipY',
    label: string,
  ) => (
    <label className="check">
      <input
        type="checkbox"
        checked={brush[key]}
        onChange={(e) => onChange({ ...brush, [key]: e.target.checked })}
      />
      {label}
    </label>
  );
  return (
    <details open className="skin-brush-options">
      <summary>工具选项</summary>
      <Select
        aria-label="镜像方式"
        value={brush.mirror}
        onChange={(e) => onChange({ ...brush, mirror: e.target.value as SkinBrush['mirror'] })}
      >
        {[
          ['none', '不镜像'],
          ['body', '人体左右'],
          ['faceX', '面内水平'],
          ['faceY', '面内垂直'],
          ['faceXY', '面内双轴'],
          ['texture', '贴图水平'],
        ].map(([id, text]) => (
          <option key={id} value={id}>
            {text}
          </option>
        ))}
      </Select>
      {['pencil', 'eraser', 'noise', 'lighten', 'darken', 'clone'].includes(tool) && (
        <>
          <Select
            aria-label="笔刷形状"
            value={brush.shape}
            onChange={(e) => onChange({ ...brush, shape: e.target.value as SkinBrush['shape'] })}
          >
            <option value="square">方形</option>
            <option value="circle">圆形</option>
          </Select>
          {number('hardness', '硬度', 0, 1, 0.05)}
        </>
      )}
      {['fill', 'replace', 'wand'].includes(tool) && (
        <>
          {number('tolerance', '颜色容差', 0, 255)}
          {check('contiguous', '仅连续区域')}
          {check('sampleMerged', '采样全部图层')}
        </>
      )}
      {tool === 'fill' && (
        <Select
          aria-label="填充范围"
          value={brush.fillScope}
          onChange={(e) =>
            onChange({ ...brush, fillScope: e.target.value as SkinBrush['fillScope'] })
          }
        >
          <option value="face">当前面</option>
          <option value="part">部位跨面</option>
          <option value="texture">整张贴图</option>
        </Select>
      )}
      {tool === 'eyedropper' && check('sampleMerged', '采样全部图层')}
      {['rectangle', 'ellipse'].includes(tool) && check('filled', '实心形状')}
      {tool === 'gradient' && (
        <>
          {number('gradientSteps', '渐变色阶', 0, 32)}
          {check('dither', '抖色')}
          {check('preserveAlpha', '保留原透明度')}
        </>
      )}
      {tool === 'noise' && (
        <>
          {number('noiseStrength', '噪点强度', 0, 1, 0.01)}
          {number('noiseSeed', '随机种子', 0, 2147483647)}
          {check('noisePalette', '使用调色板')}
          <button
            onClick={() =>
              onChange({ ...brush, noiseSeed: Math.floor(Math.random() * 2147483647) })
            }
          >
            随机种子
          </button>
        </>
      )}
      {tool === 'sculpt' && (
        <Select
          aria-label="雕刻模式"
          value={brush.sculptMode}
          onChange={(e) =>
            onChange({ ...brush, sculptMode: e.target.value as SkinBrush['sculptMode'] })
          }
        >
          <option value="raise">内层隆起到外层</option>
          <option value="lower">外层压回内层</option>
        </Select>
      )}
      {tool === 'stamp' && (
        <>
          {number('stampScale', '印章缩放', 1, 8)}
          <Select
            aria-label="印章旋转"
            value={brush.stampRotation}
            onChange={(e) =>
              onChange({ ...brush, stampRotation: +e.target.value as SkinBrush['stampRotation'] })
            }
          >
            {[0, 90, 180, 270].map((n) => (
              <option key={n} value={n}>
                {n}°
              </option>
            ))}
          </Select>
          {check('stampFlipX', '水平翻转')}
          {check('stampFlipY', '垂直翻转')}
        </>
      )}
      {!['fill', 'replace', 'wand', 'eyedropper', 'select', 'lasso', 'move'].includes(tool) &&
        check('clipFace', '限制当前面')}
    </details>
  );
}
