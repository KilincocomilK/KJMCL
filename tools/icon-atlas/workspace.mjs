import { zipSync, unzipSync, strToU8, strFromU8 } from 'three/addons/libs/fflate.module.js';

const { version, groups, items } = JSON.parse(document.getElementById('inventory').textContent);
const byId = new Map(items.map((item) => [item.id, item]));
const drafts = new Map(),
  urls = new Map(),
  saving = new Set();
const $ = (id) => document.getElementById(id);
const node = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
};
const button = (label, action, cls) => {
  const el = node('button', cls, label);
  el.type = 'button';
  el.addEventListener('click', action);
  return el;
};
const types = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
};
const accept = '.png,.jpg,.jpeg,.webp,.svg,.ico';
const fileLimit = 24 * 1024 ** 2,
  backupLimit = 384 * 1024 ** 2;
let filterGroup = '',
  filterState = 'all',
  inspected,
  directory,
  noticeTimer;
const safeId = (id) =>
  typeof id === 'string' &&
  id.includes('/') &&
  id.length <= 250 &&
  id
    .split('/')
    .every(
      (part) => part.trim() && part !== '.' && part !== '..' && !/[\\:\x00-\x1f<>|?*"]/u.test(part),
    );

function notify(message) {
  $('notice').textContent = message;
  $('notice').hidden = false;
  const feedback = document.querySelector('#detail-body [role=status]');
  if (feedback) feedback.textContent = message;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    $('notice').hidden = true;
  }, 5800);
}
const report = (error) => {
  if (error?.name === 'AbortError') return;
  if (['SecurityError', 'NotAllowedError'].includes(error?.name)) {
    notify('浏览器未授权访问该目录，可重新选择文件夹或导出 ZIP。');
    return;
  }
  notify(
    error?.name === 'QuotaExceededError'
      ? '浏览器存储已满。请先导出备份并释放空间。'
      : error?.message || '操作失败。',
  );
};
function connect() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('KJMCL-Icon-Atlas', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('drafts', { keyPath: 'id' });
      request.result.createObjectStore('settings');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function transact(store, mode, work) {
  const db = await storageReady.catch(() => {
    throw Error('此窗口无法保存画稿，请在本机浏览器中打开图鉴。');
  });
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = work(tx.objectStore(store));
    tx.oncomplete = () => resolve(request?.result);
    tx.onabort = tx.onerror = () => reject(tx.error || Error('写入失败，请重试。'));
  });
}
function remember(record) {
  if (urls.has(record.id)) URL.revokeObjectURL(urls.get(record.id));
  urls.set(record.id, URL.createObjectURL(record.blob));
  drafts.set(record.id, record);
}
async function readArt(id, file, originalName = file.name) {
  if (!file.size || file.size > fileLimit) throw Error('请选择 24 MiB 以内的图像。');
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const sig = String.fromCharCode(...bytes);
  let ext;
  if (sig.startsWith('\x89PNG\r\n\x1a\n')) ext = 'png';
  else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) ext = 'jpg';
  else if (sig.startsWith('RIFF') && sig.slice(8, 12) === 'WEBP') ext = 'webp';
  else if (sig.startsWith('\x00\x00\x01\x00')) ext = 'ico';
  else if (file.type === types.svg || /\.svg$/i.test(originalName)) ext = 'svg';
  if (!ext) throw Error('支持 PNG、SVG、WebP、JPG 和 ICO 图像。');
  const blob = file.slice(0, file.size, types[ext]);
  const url = URL.createObjectURL(blob),
    image = new Image();
  try {
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw Error();
    return {
      id,
      name: originalName,
      ext,
      blob,
      width: image.naturalWidth,
      height: image.naturalHeight,
    };
  } catch {
    throw Error('无法读取这张图，请检查文件格式。');
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Write an additional copy when the artist links a real directory. The content hash
// keeps earlier revisions intact even if the browser or another tab has older data.
async function copyToFolder(record, handle) {
  const target = await handle.getDirectoryHandle('KJMCL-画稿', { create: true });
  const [kind, ...parts] = record.id.split('/');
  const group = await target.getDirectoryHandle(kind, { create: true });
  const hash = await crypto.subtle.digest('SHA-256', await record.blob.arrayBuffer());
  const suffix = [...new Uint8Array(hash).slice(0, 12)]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('');
  const name = parts.join('--') + '-' + suffix + '.' + record.ext;
  const file = await group.getFileHandle(name, { create: true });
  const writer = await file.createWritable();
  try {
    await writer.write(record.blob);
    await writer.close();
  } catch (error) {
    await writer.abort().catch(() => {});
    throw error;
  }
}
async function syncCopies(records) {
  if (!directory) return '';
  try {
    if ((await directory.queryPermission({ mode: 'readwrite' })) !== 'granted')
      return '点「画稿目录」恢复文件夹写入。';
    for (const record of records) await copyToFolder(record, directory);
    return '已同步到画稿目录。';
  } catch {
    return '文件夹暂时无法写入，画稿已保存在此浏览器。';
  }
}
function storageNote() {
  $('storage-note').textContent = directory
    ? '画稿同时保存到 ' + directory.name + '/KJMCL-画稿。'
    : '画稿保存在此浏览器，可导出 ZIP 备份。';
}
async function linkDirectory() {
  let handle = directory;
  if (!handle || (await handle.queryPermission({ mode: 'readwrite' })) === 'granted') {
    handle = await window.showDirectoryPicker({ id: 'kjmcl-artwork', mode: 'readwrite' });
  } else if ((await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') return;
  let persistent = true;
  try {
    await transact('settings', 'readwrite', (s) => s.put(handle, 'directory'));
  } catch {
    persistent = false;
  }
  directory = handle;
  storageNote();
  const result = await syncCopies(drafts.values());
  notify((result || '画稿目录已关联。') + (persistent ? '' : '下次打开时请重新关联目录。'));
}
async function upload(id, file) {
  if (!file || saving.has(id)) return;
  saving.add(id);
  try {
    const record = await readArt(id, file);
    await transact('drafts', 'readwrite', (s) => s.put(record));
    remember(record);
    const result = await syncCopies([record]);
    render();
    if ($('detail').open && inspected === id) detail(id);
    notify('已保存「' + byId.get(id).title + '」的手绘稿。' + result);
  } finally {
    saving.delete(id);
  }
}

function download(url, name) {
  const link = node('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
}
function blobDownload(blob, name) {
  const url = URL.createObjectURL(blob);
  download(url, name);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function ask(title, message) {
  const d = $('confirm');
  $('confirm-title').textContent = title;
  $('confirm-text').textContent = message;
  d.returnValue = '';
  d.showModal();
  $('no').focus();
  return new Promise((resolve) =>
    d.addEventListener('close', () => resolve(d.returnValue === 'yes'), { once: true }),
  );
}
async function exportDrafts() {
  const records = await transact('drafts', 'readonly', (s) => s.getAll());
  if (!records.length) return notify('尚未上传手绘稿。');
  if (records.reduce((n, r) => n + r.blob.size, 0) > backupLimit)
    throw Error('画稿超过 ZIP 容量，请使用画稿目录保存原文件。');
  const files = Object.create(null),
    manifest = { format: 'kjmcl-icon-artwork', version: 1, items: [] };
  for (const r of records) {
    const file = 'artwork/' + r.id + '.' + r.ext;
    files[file] = new Uint8Array(await r.blob.arrayBuffer());
    manifest.items.push({ id: r.id, name: r.name, file });
  }
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  blobDownload(
    new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' }),
    'KJMCL-手绘图标.zip',
  );
  notify('已导出 ' + records.length + ' 张手绘稿。');
}
async function restoreBackup(file) {
  if (!file) return;
  if (file.size > backupLimit + 4 * 1024 ** 2) throw Error('备份文件过大。');
  let size = 0,
    files,
    manifest;
  try {
    files = unzipSync(new Uint8Array(await file.arrayBuffer()), {
      filter: (f) => {
        if (f.name !== 'manifest.json' && !f.name.startsWith('artwork/')) return false;
        size += f.originalSize;
        if (size > backupLimit + 4 * 1024 ** 2 || f.originalSize > fileLimit) throw Error();
        return true;
      },
    });
    manifest = JSON.parse(strFromU8(files['manifest.json']));
    if (
      manifest.format !== 'kjmcl-icon-artwork' ||
      manifest.version !== 1 ||
      !Array.isArray(manifest.items) ||
      !manifest.items.length
    )
      throw Error();
  } catch {
    throw Error('无法读取图鉴备份，请选择从本图鉴导出的 ZIP。');
  }
  const records = [],
    ids = new Set();
  for (const item of manifest.items) {
    if (
      !safeId(item.id) ||
      ids.has(item.id) ||
      typeof item.name !== 'string' ||
      !item.name.trim() ||
      !files[item.file]
    )
      throw Error('备份中的画稿记录有误。');
    ids.add(item.id);
    const ext = item.file.split('.').at(-1);
    if (!Object.hasOwn(types, ext) || item.file !== 'artwork/' + item.id + '.' + ext)
      throw Error('备份的文件名有误。');
    const record = await readArt(
      item.id,
      new Blob([files[item.file]], { type: types[ext] }),
      item.name,
    );
    if (record.ext !== ext) throw Error('备份中的图像格式有误。');
    records.push(record);
  }
  const existing = await transact('drafts', 'readonly', (s) => s.getAllKeys());
  const overlap = existing.filter((key) => ids.has(key)).length;
  if (
    overlap &&
    !(await ask(
      '导入备份',
      '导入 ' + records.length + ' 张画稿，其中 ' + overlap + ' 张将替换当前画稿。',
    ))
  )
    return;
  await transact('drafts', 'readwrite', (s) => {
    for (const r of records) s.put(r);
  });
  records.forEach(remember);
  render();
  const result = await syncCopies(records);
  notify('已导入 ' + records.length + ' 张手绘稿。' + result);
}

function preview(item, draft = false) {
  if (!draft && item.glyph) return node('span', 'glyph', item.glyph);
  const image = node('img');
  image.src = draft ? urls.get(item.id) : item.image;
  image.alt = draft ? '手绘稿' : '原图';
  image.draggable = false;
  image.loading = 'lazy';
  if (item.group === '像素物品' || item.group === '品牌标识' || draft) image.className = 'pixel';
  return image;
}
function uploader(item, replace = false) {
  const input = node('input');
  input.type = 'file';
  input.accept = accept;
  input.hidden = true;
  input.setAttribute('aria-label', '上传手绘稿 · ' + item.title);
  const b = button(replace ? '替换手绘' : '上传手绘', () => input.click(), 'upload');
  b.setAttribute('aria-label', b.textContent + ' · ' + item.title);
  const icon = node('img');
  icon.src = byId.get('lucide/Upload')?.image || byId.get('pixel/brush').image;
  icon.alt = '';
  icon.width = 14;
  icon.height = 14;
  b.prepend(icon);
  input.onchange = () => {
    const file = input.files[0];
    input.value = '';
    upload(item.id, file).catch(report);
  };
  return [b, input];
}
function card(item) {
  const record = drafts.get(item.id),
    box = node('article', 'card');
  box.dataset.id = item.id;
  const plate = button('', () => detail(item.id), 'plate');
  plate.setAttribute('aria-label', '查看绘制参考 · ' + item.title);
  if (record) {
    for (const [draft, label] of [
      [false, '原图'],
      [true, '手绘'],
    ]) {
      const side = node('span', 'pair');
      side.append(preview(item, draft), node('small', '', label));
      plate.append(side);
    }
  } else plate.append(preview(item));
  const info = node('div', 'card-copy'),
    line = node('div', 'card-title');
  line.append(node('h3', '', item.title), node('span', 'base', item.grid));
  info.append(line, node('p', '', item.purpose), ...uploader(item, !!record));
  box.append(plate, info);
  box.ondragover = (event) => {
    if (event.dataTransfer.types.includes('Files')) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      box.classList.add('dragging');
    }
  };
  box.ondragleave = (event) => {
    if (!box.contains(event.relatedTarget)) box.classList.remove('dragging');
  };
  box.ondrop = (event) => {
    event.preventDefault();
    box.classList.remove('dragging');
    if (event.dataTransfer.files.length !== 1) {
      notify('请为这个图标选择一张手绘稿。');
      return;
    }
    upload(item.id, event.dataTransfer.files[0]).catch(report);
  };
  return box;
}
async function referencePng(item) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (item.glyph) {
    await document.fonts.ready;
    canvas.width = canvas.height = 64;
    ctx.font = '48px KJPixel';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#eeeade';
    ctx.fillText(item.glyph, 32, 32);
  } else {
    const image = new Image();
    image.src = item.image;
    await image.decode();
    const grid = /^(\d+) × (\d+)$/.exec(item.grid);
    canvas.width = grid ? Number(grid[1]) : item.grid === '绘制标记' ? 24 : image.naturalWidth;
    canvas.height = grid ? Number(grid[2]) : item.grid === '绘制标记' ? 24 : image.naturalHeight;
    ctx.imageSmoothingEnabled = item.group !== '像素物品';
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  }
  const png = await new Promise((resolve) => canvas.toBlob(resolve));
  if (!png) throw Error('无法生成参考图。');
  return png;
}
async function reference(item) {
  const name = item.id.replaceAll('/', '-');
  if (item.glyph) {
    blobDownload(await referencePng(item), name + '.png');
    return;
  }
  const extension = item.image.startsWith('data:image/svg')
    ? 'svg'
    : item.image.split(';')[0].split('/').at(-1);
  download(item.image, name + '.' + extension);
}
async function exportReferences() {
  const control = $('references');
  control.disabled = true;
  try {
    const files = Object.create(null);
    const rows = [['文件', '图标', '类别', '用途', '原图规格']];
    for (const item of items) {
      const file = 'references/' + item.id + '.png';
      files[file] = new Uint8Array(await (await referencePng(item)).arrayBuffer());
      rows.push([file, item.title, item.group, item.purpose, item.grid]);
    }
    files['图标清单.csv'] = strToU8(
      '\uFEFF' +
        rows
          .map((row) => row.map((cell) => '"' + cell.replaceAll('"', '""') + '"').join(','))
          .join('\r\n'),
    );
    files['许可证.txt'] = strToU8($('legal').querySelector('pre').textContent);
    blobDownload(
      new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' }),
      'KJMCL-图标参考-' + version + '.zip',
    );
    notify('已导出 ' + items.length + ' 张参考图和功能清单。');
  } finally {
    control.disabled = false;
  }
}
function detail(id) {
  const item = byId.get(id),
    record = drafts.get(id);
  inspected = id;
  const body = $('detail-body');
  body.replaceChildren();
  $('detail-title').textContent = item.title;
  const comparison = node('div', 'compare');
  const addSide = (image, label) => {
    const side = node('div');
    side.append(image, node('small', '', label));
    comparison.append(side);
  };
  addSide(preview(item), '当前原图');
  if (item.variant) {
    const image = node('img');
    image.src = item.variant.image;
    image.alt = item.variant.label;
    addSide(image, item.variant.label);
  }
  if (record) addSide(preview(item, true), '你的手绘稿');
  const specs = {
    像素物品: '使用 16 × 16 原始像素格，放大后可逐格对照轮廓、亮面和阴影。',
    品牌标识:
      id === 'brand/application'
        ? '原始 PNG 为 ' + item.grid + ' 像素。桌面和任务栏还会使用 16 至 256 像素的 ICO。'
        : '按 ' + item.grid + ' 的画布对照外轮廓，兼顾小尺寸显示。',
    操作图标: '原始矢量画布为 24 × 24，默认线宽为 2。缩小后仍需能辨认操作方向。',
    地图标记: '参考图放大了画布上的标记；绘制时可在深、浅两种地形上检查可见性。',
    界面符号: '参考当前轮廓和留白。符号在按钮、角标等小尺寸位置显示。',
  };
  body.append(
    node('p', 'key', item.id),
    node('p', '', item.purpose),
    comparison,
    node('p', 'spec', specs[item.group]),
  );
  if (record)
    body.append(
      node('p', 'meta', record.name + ' · ' + record.width + ' × ' + record.height + ' px'),
    );
  const actions = node('div', 'detail-actions');
  actions.append(
    ...uploader(item, !!record),
    button('下载原图', () => reference(item).catch(report)),
  );
  if (item.ico) actions.append(button('下载 ICO', () => download(item.ico, 'KJMCL.ico')));
  if (record) actions.append(button('下载手绘稿', () => download(urls.get(id), record.name)));
  const locations = node('details', 'source-list');
  locations.append(node('summary', '', '使用位置 · ' + item.refs.length));
  const list = node('ul');
  for (const ref of item.refs) {
    const li = node('li');
    li.append(
      document.createTextNode(
        ref.page + (ref.labels.length ? ' · ' + ref.labels.join('、') : '') + ' ',
      ),
      node('code', '', ref.file),
    );
    list.append(li);
  }
  locations.append(list);
  const feedback = node('p', 'meta');
  feedback.setAttribute('role', 'status');
  body.append(actions, locations, feedback);
  if (!$('detail').open) $('detail').showModal();
}

const normalized = (value) => value.normalize('NFKC').toLowerCase();
const searchText = new Map(
  items.map((i) => [
    i.id,
    normalized(
      [
        i.title,
        i.id,
        i.group,
        i.purpose,
        ...i.refs.flatMap((r) => [r.page, r.file, ...r.labels]),
      ].join(' '),
    ),
  ]),
);
function render() {
  const done = items.filter((i) => drafts.has(i.id)).length;
  $('count').textContent = done + ' / ' + items.length;
  $('progress').max = items.length;
  $('progress').value = done;
  $('export').disabled = !drafts.size;
  for (const b of $('groups').children)
    b.setAttribute('aria-pressed', String(b.dataset.group === filterGroup));
  for (const b of document.querySelectorAll('[data-state]'))
    b.setAttribute('aria-pressed', String(b.dataset.state === filterState));
  const words = normalized($('search').value).trim().split(/\s+/).filter(Boolean),
    page = $('area').value;
  const visible = items.filter(
    (i) =>
      (!filterGroup || i.group === filterGroup) &&
      (!page || i.refs.some((r) => r.page === page)) &&
      (filterState === 'all' || drafts.has(i.id) === (filterState === 'done')) &&
      words.every((q) => searchText.get(i.id).includes(q)),
  );
  const fragment = document.createDocumentFragment();
  for (const group of groups) {
    const matches = visible.filter((i) => i.group === group);
    if (!matches.length) continue;
    const heading = node('div', 'section-head');
    heading.append(node('h2', '', group), node('span', 'num', String(matches.length)));
    const grid = node('div', 'grid');
    for (const item of matches) grid.append(card(item));
    fragment.append(heading, grid);
  }
  if (!visible.length)
    fragment.append(
      node(
        'p',
        'empty',
        filterState === 'done' && !done ? '尚未上传手绘稿。' : '没有符合条件的图标。',
      ),
    );
  $('cards').replaceChildren(fragment);
}

$('brand').src = byId.get('brand/application').image;
$('release').textContent = 'KJMCL ' + version + ' · ' + items.length + ' 个图标';
for (const group of ['', ...groups]) {
  const b = button(group || '全部图标', () => {
    filterGroup = group;
    render();
  });
  b.dataset.group = group;
  b.append(
    node(
      'span',
      'num',
      String(group ? items.filter((i) => i.group === group).length : items.length),
    ),
  );
  $('groups').append(b);
}
for (const page of [...new Set(items.flatMap((i) => i.refs.map((r) => r.page)))].sort((a, b) =>
  a.localeCompare(b, 'zh-CN'),
)) {
  const option = node('option', '', page);
  option.value = page;
  $('area').append(option);
}
for (const b of document.querySelectorAll('[data-state]'))
  b.onclick = () => {
    filterState = b.dataset.state;
    render();
  };
$('search').oninput = render;
$('area').onchange = render;
for (const b of document.querySelectorAll('[data-close]'))
  b.onclick = () => b.closest('dialog').close();
$('no').onclick = () => $('confirm').close('no');
$('yes').onclick = () => $('confirm').close('yes');
$('licenses').onclick = () => $('legal').showModal();
$('references').onclick = () => exportReferences().catch(report);
$('restore').onclick = () => $('backup-file').click();
$('backup-file').onchange = (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  restoreBackup(file).catch(report);
};
$('export').onclick = () => exportDrafts().catch(report);
if (typeof window.showDirectoryPicker === 'function') {
  $('directory').hidden = false;
  $('directory').onclick = () => linkDirectory().catch(report);
}
render();
const storageReady = connect();
storageReady
  .then(async () => {
    (await transact('drafts', 'readonly', (s) => s.getAll())).forEach(remember);
    directory = await transact('settings', 'readonly', (s) => s.get('directory'));
    storageNote();
    render();
  })
  .catch(() => {
    notify('此窗口无法持久保存画稿，请使用本机浏览器打开图鉴。');
  });
