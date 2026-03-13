import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { createVoiceByText, getMp3Duration } from '../utils/common';
import { WorkflowState } from './types';

/**
 * 并发限制函数
 */
async function promiseLimit<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
): Promise<T[]> {
  const results: T[] = [];
  const executing: Promise<void>[] = [];

  for (const task of tasks) {
    const p = Promise.resolve().then(() => task());
    results.push(p as any);

    if (concurrency <= tasks.length) {
      const e: Promise<void> = p.then(() => {
        executing.splice(executing.indexOf(e), 1);
      });
      executing.push(e);

      if (executing.length >= concurrency) {
        await Promise.race(executing);
      }
    }
  }

  return Promise.all(results);
}

export async function generateVoiceNode(
  state: WorkflowState,
  config: any,
): Promise<Partial<WorkflowState>> {
  console.log('🔊 [Node] 生成语音...');

  // 确保 audio 文件夹存在
  const audioDir = path.join(process.cwd(), 'audio');
  if (!existsSync(audioDir)) {
    mkdirSync(audioDir, {recursive: true});
    console.log('   已创建 audio 文件夹');
  }

  config?.writer({
    type: 'message',
    content: '生成语音',
  });

  const storyboard = state.storyboard;

  // 最多并发 3 个语音生成任务
  const tasks = storyboard.map((step, index) => () =>
    createVoiceByText(step.voice, `audio/step_${index + 1}.mp3`),
  );
  await promiseLimit(tasks, 3);

  for (let index = 0; index < storyboard.length; index++) {
    const mp3Duration = await getMp3Duration(`audio/step_${index + 1}.mp3`);
    console.log(`   step_${index + 1}.mp3 时长：${mp3Duration}秒`);
    storyboard[index].duration = mp3Duration;
    storyboard[index].voiceFileName = `step_${index + 1}.mp3`;
  }

  console.log('✅ [Node] 语音生成完成');

  return {storyboard};
}
