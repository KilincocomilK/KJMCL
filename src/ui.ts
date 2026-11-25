export type Run = <T>(work: () => Promise<T>, message?: string) => Promise<T | undefined>;
export const taskStatus = {
  running: '进行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};
export function remainingTime(seconds?: number) {
  if (seconds === undefined) return '正在估算剩余时间';
  if (seconds < 60) return `约剩 ${seconds} 秒`;
  if (seconds < 3600) return `约剩 ${Math.ceil(seconds / 60)} 分钟`;
  return `约剩 ${Math.ceil(seconds / 360) / 10} 小时`;
}
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
