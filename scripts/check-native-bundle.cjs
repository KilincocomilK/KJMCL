const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { Arch } = require('builder-util');
module.exports = async (context) => {
  const manifest = JSON.parse(
    readFileSync(resolve(context.packager.projectDir, 'dist-native/manifest.json'), 'utf8'),
  );
  const arch = Arch[context.arch];
  if (manifest.platform !== context.electronPlatformName || manifest.arch !== arch)
    throw new Error(
      `Rust 存档核心为 ${manifest.platform}/${manifest.arch}，不能打包到 ${context.electronPlatformName}/${arch}。请在对应系统和架构重新构建。`,
    );
};
