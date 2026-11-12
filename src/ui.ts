export type Run = <T>(work: () => Promise<T>, message?: string) => Promise<T | undefined>;
export const loaderLabel = {
  vanilla: '原版',
  fabric: 'Fabric',
  quilt: 'Quilt',
  forge: 'Forge',
  neoforge: 'NeoForge',
};
export const statusLabel = {
  empty: '未安装',
  installing: '安装中',
  ready: '已就绪',
  error: '安装失败',
};
export const date = (n?: number) => (n ? new Date(n).toLocaleDateString('zh-CN') : '尚未启动');
export const size = (n: number) =>
  n >= 1024 ** 3
    ? (n / 1024 ** 3).toFixed(2) + ' GiB'
    : n >= 1024 ** 2
      ? (n / 1024 ** 2).toFixed(1) + ' MiB'
      : n >= 1024
        ? (n / 1024).toFixed(1) + ' KiB'
        : n + ' B';
