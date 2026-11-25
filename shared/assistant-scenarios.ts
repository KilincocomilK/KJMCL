export const assistantScenarios = [
  {
    name: 'tune_memory',
    title: '调整内存',
    text: '结合可用物理内存和实例设置，帮我选择合适的内存策略。',
  },
  {
    name: 'diagnose_launch',
    title: '诊断启动',
    text: '查看这个实例最近的启动结果，解释原因并给出下一步。',
  },
  {
    name: 'tune_video',
    title: '优化帧率',
    text: '查看当前视频设置，给我一份更流畅的配置修改预览。',
  },
  {
    name: 'configure_downloads',
    title: '调整下载',
    text: '查看当前下载源和并行下载数，帮我调整下载设置。',
  },
] as const;
