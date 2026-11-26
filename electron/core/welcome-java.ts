import os from 'node:os';
import type { Api } from '../../shared/types';
import { Java, javaArch } from './java';
import { recommendedHeap } from './performance';
import type { Store } from './store';
import type { Work } from './tasks';

function defaultHeap() {
  return recommendedHeap(os.totalmem() / 1048576, os.freemem() / 1048576, 4096);
}

export async function welcomeJavaInfo(java: Java): ReturnType<Api['welcomeJavaInfo']> {
  const available = (await java.discover()).filter((j) => javaArch(j.arch) === process.arch);
  return { available, memoryMb: defaultHeap() };
}

export async function configureWelcomeJava(
  java: Java,
  store: Store,
  { major, allowInstall }: Parameters<Api['configureWelcomeJava']>[0],
  ctx: Work,
) {
  const starting = { ...store.data.settings };
  const { available, memoryMb } = await welcomeJavaInfo(java);
  ctx.signal.throwIfAborted();
  if (!available.some((j) => j.major === major)) {
    if (!allowInstall) throw new Error(`未找到 Java ${major}，请重新检测后安装`);
    await java.install(major, ctx);
  }
  ctx.signal.throwIfAborted();
  // A background download may finish after the player edits the launch settings.
  const current = store.data.settings;
  if (current.javaPath !== starting.javaPath || current.memoryMb !== starting.memoryMb)
    throw new Error('Java 已就绪，已保留下载期间修改的运行设置');
  store.data.settings = { ...current, javaPath: '', memoryMb };
  try {
    store.save('java');
  } catch (error) {
    store.data.settings = current;
    throw error;
  }
}
