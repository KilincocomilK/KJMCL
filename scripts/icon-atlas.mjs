import { readFile, readdir, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { watch } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseSync } from 'vite';
import { build } from 'esbuild';
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as lucide from 'lucide-react';
import {
  actionLabels,
  assetLabels,
  drawnMarks,
  glyphLabels,
  pageNames,
  pixelLabels,
} from '../tools/icon-atlas/labels.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const text = (file) => readFile(path.join(root, file), 'utf8');
const output = path.join(root, 'docs/icon-atlas.html');
const pixelFile = 'src/components/ItemArt.tsx';
const groupOrder = ['像素物品', '品牌标识', '操作图标', '地图标记', '界面符号'];
const labelFor = (file) => pageNames[path.parse(file).name] ?? path.parse(file).name;
const sort = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

async function filesUnder(dir) {
  const entries = await readdir(path.join(root, dir), { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      if (entry.name === 'KJMCL-画稿' && entry.isDirectory()) return [];
      const file = dir + '/' + entry.name;
      return entry.isDirectory() ? filesUnder(file) : entry.isFile() ? [file] : [];
    }),
  );
  return nested.flat().sort(sort);
}

function visit(n, fn, parents = []) {
  if (!n?.type || fn(n, parents) === false) return;
  const ancestors = [...parents, n];
  for (const value of Object.values(n)) {
    if (Array.isArray(value)) value.forEach((child) => visit(child, fn, ancestors));
    else if (value?.type) visit(value, fn, ancestors);
  }
}
const attrs = (el, key) => el?.attributes?.find((a) => a.name?.name === key)?.value;
const literal = (n) => (n?.type === 'JSXExpressionContainer' ? n.expression?.value : n?.value);
const tag = (n) => n?.openingElement?.name?.name;
const svgUrl = (svg) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
const svg = (body, box = '0 0 24 24') =>
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + box + '">' + body + '</svg>';

function jsxArt(n) {
  if (n.type === 'ParenthesizedExpression') return jsxArt(n.expression);
  if (n.type === 'JSXText') return n.value.trim() || null;
  if (n.type === 'JSXExpressionContainer' && n.expression.type === 'JSXEmptyExpression')
    return null;
  if (n.type === 'JSXFragment') return createElement(Fragment, null, ...n.children.map(jsxArt));
  if (n.type !== 'JSXElement') throw Error('动态 SVG 需要在图鉴生成器中登记其参考状态');
  const props = {};
  for (const a of n.openingElement.attributes) {
    const value = literal(a.value);
    if (a.type !== 'JSXAttribute' || value == null)
      throw Error('未识别的 SVG 属性 ' + a.name?.name);
    props[a.name.name] = value;
  }
  return createElement(tag(n), props, ...n.children.map(jsxArt));
}

function labelAt(parents) {
  for (const p of parents.toReversed()) {
    const el = p.openingElement;
    if (el && ['button', 'label', 'summary', 'SettingGroup', 'Empty'].includes(tag(p))) {
      const label =
        literal(attrs(el, 'aria-label')) ||
        literal(attrs(el, 'title')) ||
        p.children.find((c) => c.type === 'JSXText' && c.value.trim())?.value.trim();
      if (typeof label === 'string' && label.length <= 45) return label;
      break;
    }
    if (p.type === 'ArrayExpression' || p.type === 'ObjectExpression') {
      const values = p.elements ?? p.properties.map((v) => v.value);
      const label = values.find(
        (v) => typeof v?.value === 'string' && /\p{Script=Han}/u.test(v.value),
      );
      if (label) return label.value;
      break;
    }
  }
  return '';
}

export async function catalogue() {
  const items = new Map();
  function add(id, group, title, purpose, grid, image) {
    if (!groupOrder.includes(group)) throw Error('未知图标类别 ' + group);
    if (items.has(id)) throw Error('重复图标 ID ' + id);
    const item = { id, group, title, purpose, grid, image, uses: new Map() };
    items.set(id, item);
    return item;
  }
  function note(item, file, label = '') {
    if (!item) return;
    if (!item.uses.has(file)) item.uses.set(file, new Set());
    if (label) item.uses.get(file).add(label);
  }
  const sources = await filesUnder('src');
  const code = new Map();
  for (const file of sources.filter((f) => /\.[cm]?[jt]sx?$/.test(f))) {
    const source = await text(file);
    const parsed = parseSync(file, source);
    if (parsed.errors.length) throw Error(file + ' ' + parsed.errors[0].message);
    code.set(file, parsed.program);
  }

  const pixelTree = code.get(pixelFile);
  const sprites = pixelTree.body
    .flatMap((n) => n.declarations ?? [])
    .find((n) => n.id.name === 'sprites');
  let pixelGrid;
  visit(pixelTree, (n) => {
    if (tag(n) === 'svg') pixelGrid = literal(attrs(n.openingElement, 'viewBox'));
  });
  if (!pixelGrid || !sprites) throw Error('找不到 ItemArt 图集');
  const pixel = new Map();
  for (const prop of (sprites.init.expression ?? sprites.init).properties) {
    const key = prop.key.name ?? prop.key.value;
    const graphic = renderToStaticMarkup(
      createElement(
        'svg',
        {
          xmlns: 'http://www.w3.org/2000/svg',
          viewBox: pixelGrid,
          shapeRendering: 'crispEdges',
        },
        jsxArt(prop.value),
      ),
    );
    const [title, purpose] = pixelLabels[key] ?? [key, '像素物品图标'];
    pixel.set(
      key,
      add(
        'pixel/' + key,
        groupOrder[0],
        title,
        purpose,
        pixelGrid.split(' ').slice(2).join(' × '),
        svgUrl(graphic),
      ),
    );
  }
  const brandUsers = new Map();
  const coverArt = new Map();
  visit(code.get('src/components/LocalResourceArt.tsx'), (n) => {
    if (n.type === 'VariableDeclarator' && n.id.name === 'art') {
      for (const prop of (n.init.expression ?? n.init).properties)
        coverArt.set(prop.key.name, prop.value.value);
    }
  });
  function glyph(value, file, label) {
    const id = 'glyph/' + [...value].map((c) => c.codePointAt(0).toString(16)).join('-');
    const [title, purpose] = glyphLabels[value] ?? [label || value, label || '按钮符号'];
    const item = items.get(id) ?? add(id, groupOrder[4], title, purpose, '字体字形', null);
    item.glyph = value;
    note(item, file, label);
  }
  for (const [file, tree] of code) {
    if (file === pixelFile) continue;
    const imports = new Map(),
      namespaces = new Set();
    for (const n of tree.body) {
      if (
        n.type !== 'ImportDeclaration' ||
        n.source.value !== 'lucide-react' ||
        n.importKind === 'type'
      )
        continue;
      for (const s of n.specifiers) {
        if (s.type === 'ImportNamespaceSpecifier') namespaces.add(s.local.name);
        else if (s.imported && s.importKind !== 'type')
          imports.set(s.local.name, s.imported.name ?? s.imported.value);
      }
    }
    visit(tree, (n, parents) => {
      if (n.type === 'ImportDeclaration') return false;
      const parent = parents.at(-1);
      let name;
      if (n.type === 'JSXOpeningElement') {
        name = imports.get(n.name.name);
        if (n.name.type === 'JSXMemberExpression' && namespaces.has(n.name.object.name))
          name = n.name.property.name;
      } else if (
        n.type === 'Identifier' &&
        !(parent?.type === 'MemberExpression' && parent.property === n && !parent.computed)
      ) {
        name = imports.get(n.name);
      } else if (n.type === 'MemberExpression' && namespaces.has(n.object.name)) {
        name = n.property.name ?? n.property.value;
      }
      if (name) {
        const id = 'lucide/' + name;
        let item = items.get(id);
        if (!item) {
          const component = lucide[name];
          if (!component) throw Error('找不到 Lucide 图标 ' + name);
          const descriptor = actionLabels[name] ?? [
            labelAt(parents) || name,
            '用于' + labelFor(file) + '。',
          ];
          const graphic = (props) =>
            svgUrl(
              renderToStaticMarkup(
                createElement(component, { color: '#e8e6d9', size: 24, ...props }),
              ),
            );
          item = add(id, groupOrder[2], ...descriptor, '24 × 24', graphic({}));
          if (name === 'Star')
            item.variant = {
              label: '已收藏',
              image: graphic({ fill: '#ffa153', color: '#ffa153' }),
            };
        }
        note(item, file, labelAt(parents));
      }
      if (n.type === 'JSXElement') {
        if (tag(n) === 'Empty' && !attrs(n.openingElement, 'art'))
          note(pixel.get('chest'), file, '空列表');
        if (tag(n) === 'LocalResourceArt') {
          const kind = literal(attrs(n.openingElement, 'kind'));
          note(pixel.get(coverArt.get(kind)), file, '本地资源默认封面');
        }
        if (tag(n) === 'svg') {
          const owner = parents.findLast(
            (p) => p.type === 'FunctionDeclaration' || p.type === 'VariableDeclarator',
          )?.id?.name;
          if (!owner) throw Error('请为内联 SVG 登记稳定名称 ' + file);
          const brand = owner === 'Brand';
          const key = 'inline/' + file.replace(/^src\//, '').replace(/\.[^.]+$/, '') + '/' + owner;
          const el = jsxArt(n);
          const graphic = renderToStaticMarkup(
            createElement('svg', {
              ...el.props,
              xmlns: 'http://www.w3.org/2000/svg',
              color: brand ? '#ffa153' : '#e8e6d9',
            }),
          );
          const item = add(
            key,
            groupOrder[1],
            brand ? '像素 K 标记' : owner,
            brand ? '标识侧栏、主窗口和启动器信息页。' : '用于' + labelFor(file) + '。',
            el.props.viewBox?.split(' ').slice(2).join(' × ') ?? 'SVG',
            svgUrl(graphic),
          );
          note(item, file);
        }
        if (tag(n) === 'Brand') brandUsers.set(file, true);
        if (tag(n) === 'button') {
          const content = n.children.filter((c) => c.type !== 'JSXText' || c.value.trim());
          const symbol =
            content.length === 1 && content[0].type === 'JSXText' && content[0].value.trim();
          if (symbol && /^[\p{S}\p{P}]{1,4}$/u.test(symbol))
            glyph(symbol, file, labelAt([...parents, n]));
        }
      }
      if (n.type === 'Literal' && pixel.has(n.value)) {
        const attribute = parents.findLast((p) => p.type === 'JSXAttribute');
        const variable = parents.findLast((p) => p.type === 'VariableDeclarator');
        const component = parents.findLast((p) => p.type === 'JSXOpeningElement');
        const fromAttribute =
          attribute &&
          (attribute.name.name === 'art' ||
            (attribute.name.name === 'name' && component?.name.name === 'ItemArt'));
        if (
          fromAttribute ||
          ['navigation', 'tabArt', 'categoryArt', 'toolItems', 'art'].includes(variable?.id.name)
        )
          note(pixel.get(n.value), file, labelAt(parents));
      }
    });
  }
  const brand = [...items.values()].find((i) => i.id.endsWith('/Brand'));
  for (const file of brandUsers.keys()) note(brand, file);
  for (const file of (await readdir(root)).filter((f) => f.endsWith('.html')).sort()) {
    for (const m of (await text(file)).matchAll(
      /<button\b([^>]*)>\s*([\p{P}\p{S}]{1,4})\s*<\/button\s*>/gu,
    )) {
      glyph(m[2], file, /aria-label="([^"]+)"/.exec(m[1])?.[1]);
    }
  }
  for (const [key, group, title, purpose, file, anchor, body] of drawnMarks) {
    if (!(await text(file)).includes(anchor)) throw Error('请更新绘制标记来源 ' + key);
    note(add('mark/' + key, group, title, purpose, '绘制标记', svgUrl(svg(body))), file);
  }
  const artFiles = [...sources, ...(await filesUnder('build')), ...(await filesUnder('public'))];
  const mimes = {
    svg: 'image/svg+xml',
    png: 'image/png',
    ico: 'image/x-icon',
    webp: 'image/webp',
    gif: 'image/gif',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    bmp: 'image/bmp',
    avif: 'image/avif',
  };
  for (const file of artFiles) {
    const mime = mimes[path.extname(file).slice(1).toLowerCase()];
    if (!mime || assetLabels[file] === null) continue;
    const app = file === 'build/icon.png';
    const data = await readFile(path.join(root, file));
    const grid =
      mime === 'image/png'
        ? data.readUInt32BE(16) + ' × ' + data.readUInt32BE(20)
        : path.extname(file).slice(1).toUpperCase();
    const item = add(
      app ? 'brand/application' : 'asset/' + file,
      ...(assetLabels[file] ?? ['界面符号', path.parse(file).name, '项目图像资源。']),
      grid,
      'data:' + mime + ';base64,' + data.toString('base64'),
    );
    if (app)
      item.ico =
        'data:image/x-icon;base64,' +
        (await readFile(path.join(root, 'build/icon.ico'))).toString('base64');
    for (const ref of app
      ? [
          file,
          'build/icon.ico',
          'lightweight.html',
          'system-dialog.html',
          'electron/window-host.ts',
          'electron/system-dialog.ts',
        ]
      : [file])
      note(item, ref);
  }
  const result = [...items.values()].map(({ uses, ...item }) => ({
    ...item,
    refs: [...uses]
      .sort(([a], [b]) => sort(a, b))
      .map(([file, labels]) => ({ file, page: labelFor(file), labels: [...labels] })),
  }));
  // Preserve the sprite sheet's authored order; sort operations by stable library name.
  result.sort(
    (a, b) =>
      groupOrder.indexOf(a.group) - groupOrder.indexOf(b.group) ||
      (a.group === groupOrder[0] ? 0 : sort(a.id, b.id)),
  );
  return {
    version: JSON.parse(await text('package.json')).version,
    groups: groupOrder,
    items: result,
  };
}

export async function generateAtlas(check = false) {
  const [catalog, template, css, script, font, notices] = await Promise.all([
    catalogue(),
    text('tools/icon-atlas/page.html'),
    text('tools/icon-atlas/style.css'),
    build({
      absWorkingDir: root,
      entryPoints: ['tools/icon-atlas/workspace.mjs'],
      bundle: true,
      write: false,
      platform: 'browser',
      format: 'iife',
      target: 'es2022',
      minify: true,
      legalComments: 'inline',
    }),
    readFile(path.join(root, 'src/assets/fusion-pixel-12px-zh-hans.woff2')),
    Promise.all(
      [
        'LICENSE',
        'node_modules/lucide-react/LICENSE',
        'node_modules/fflate/LICENSE',
        ...(await filesUnder('public/licenses/fusion-pixel')),
      ].map(text),
    ),
  ]);
  const data = JSON.stringify(catalog).replaceAll('<', '\\u003c');
  if (check) {
    const missing = catalog.items.filter(
      (i) =>
        !/\p{Script=Han}/u.test(i.title) || ['像素物品图标', '项目图像资源。'].includes(i.purpose),
    );
    if (missing.length)
      throw Error('请在图鉴中补充中文名称和用途：' + missing.map((i) => i.id).join('、'));
  }
  const replacements = {
    FONT: font.toString('base64'),
    CSS: css,
    CATALOG: data,
    JAVASCRIPT: script.outputFiles[0].text.replace(/<\/script/gi, '<\\/script'),
    LICENSES: notices.join('\n\n').replace(/[ \t]+$/gm, '').replaceAll('&', '&amp;').replaceAll('<', '&lt;'),
  };
  const html = template.replace(/@@([A-Z]+)@@/g, (_, name) => replacements[name]);
  const before = await readFile(output, 'utf8').catch((e) => {
    if (e.code !== 'ENOENT') throw e;
    return '';
  });
  if (before !== html) {
    if (check) throw Error('图标图鉴需要更新，请运行 npm run icons');
    await mkdir(path.dirname(output), { recursive: true });
    const temp = output + '.' + randomUUID() + '.tmp';
    try {
      await writeFile(temp, html);
      await rename(temp, output);
    } finally {
      await rm(temp, { force: true });
    }
  }
  console.log('KJMCL 图标图鉴 · ' + catalog.items.length + ' 项 · docs/icon-atlas.html');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await generateAtlas(process.argv.includes('--check'));
  if (process.argv.includes('--watch')) {
    let timer,
      running = Promise.resolve();
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        running = running
          .then(async () => {
            const { stdout } = await promisify(execFile)(
              process.execPath,
              [fileURLToPath(import.meta.url)],
              { cwd: root, windowsHide: true },
            );
            process.stdout.write(stdout);
          })
          .catch((e) => console.error(e.message));
      }, 220);
    };
    for (const dir of ['src', 'public', 'build', 'tools/icon-atlas'])
      watch(path.join(root, dir), { recursive: true }, schedule);
    watch(fileURLToPath(import.meta.url), schedule);
    watch(root, (_, name) => {
      if (name && (/\.html$/.test(name) || name === 'package.json')) schedule();
    });
  }
}
