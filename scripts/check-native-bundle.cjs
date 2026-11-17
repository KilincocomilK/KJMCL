const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { createHash } = require('node:crypto');
const { Arch } = require('builder-util');
module.exports = async (context) => {
  const arch = Arch[context.arch];
  for (const [folder, name, label] of [
    ['dist-native', 'kjmcl-save-manager', '存档'],
    ['dist-native/seed-map', 'kjmcl-seed-map', '种子地图'],
    ['dist-native/projection', 'kjmcl-projection', '投影工坊'],
  ]) {
    const directory = resolve(context.packager.projectDir, folder);
    const manifest = JSON.parse(readFileSync(resolve(directory, 'manifest.json'), 'utf8'));
    const executable = name + (context.electronPlatformName === 'win32' ? '.exe' : '');
    if (
      manifest.schemaVersion !== 1 ||
      manifest.platform !== context.electronPlatformName ||
      manifest.arch !== arch ||
      manifest.executable !== executable
    )
      throw new Error(
        `Rust ${label}核心与 ${context.electronPlatformName}/${arch} 不匹配，请在对应系统和架构重新构建。`,
      );
    if (
      createHash('sha256')
        .update(readFileSync(resolve(directory, executable)))
        .digest('hex') !== manifest.sha256
    )
      throw new Error(`Rust ${label}核心校验失败，请重新构建。`);
  }
};
