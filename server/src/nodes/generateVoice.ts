import { WorkflowState } from './types.js';
import { createVoiceByText, getMp3Duration } from '../utils.js';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';

export async function generateVoiceNode(state: WorkflowState, config: any): Promise<Partial<WorkflowState>> {
  console.log('🔊 [Node] 生成语音...');

  // 确保 audio 文件夹存在
  const audioDir = path.join(process.cwd(), 'audio');
  if (!existsSync(audioDir)) {
    mkdirSync(audioDir, { recursive: true });
    console.log('   已创建 audio 文件夹');
  }

  config?.writer({
    type: "message",
    content: '生成语音',
  });

  const storyboard = state.storyboard;

  await Promise.all(
    storyboard.map((step, index) =>
      createVoiceByText(step.voice, `audio/step_${index + 1}.mp3`),
    ),
  );

  for (let index = 0; index < storyboard.length; index++) {
    const mp3Duration = await getMp3Duration(`audio/step_${index + 1}.mp3`);
    console.log(`   step_${index + 1}.mp3 时长：${mp3Duration}秒`);
    storyboard[index].duration = mp3Duration;
    storyboard[index].voiceFileName = `step_${index + 1}.mp3`;
  }

  console.log('✅ [Node] 语音生成完成');

  return { storyboard };
}
