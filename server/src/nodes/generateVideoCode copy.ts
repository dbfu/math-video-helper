import { ChatOpenAI } from '@langchain/openai';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { WorkflowState } from './types';

const MAX_RETRIES = 5;

function createLLM() {
  return new ChatOpenAI({
    model: process.env.MODEL_NAME,
    configuration: {
      apiKey: process.env.API_KEY,
      baseURL: process.env.BASE_URL,
    },
  });
}

export async function generateVideoCodeNode(
  state: WorkflowState,
  config: any,
): Promise<Partial<WorkflowState>> {
  const retryCount = state.retryCount || 0;

  if (retryCount >= MAX_RETRIES) {
    console.log('❌ [Node] 达到最大重试次数，停止重试');
    return {
      error: `视频代码生成失败，已重试 ${MAX_RETRIES} 次`,
    };
  }

  console.log(
    `🎥 [Node] 生成视频组件代码...${retryCount > 0 ? ` (重试 ${retryCount}/${MAX_RETRIES})` : ''}`,
  );

  config?.writer({
    type: 'message',
    content: '生成视频组件代码',
  });

  const llm = createLLM();

  let systemPrompt: string;
  let humanContent: string;

  if (retryCount > 0) {
    console.log('🔄 [Node] 重新生成代码...');
  }

  systemPrompt = (
    await readFile(join(process.cwd(), '/src/prompts/video.txt'), 'utf-8')
  ).toString();

  humanContent = JSON.stringify(state.storyboard);

  const result = await Promise.all(
    state.storyboard.map((item, index) =>
      llm.invoke([
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'human',
          content: JSON.stringify(item),
        },
      ]),
    ),
  );

  // const result = await llm.invoke([
  //   {
  //     role: 'system',
  //     content: systemPrompt,
  //   },
  //   {
  //     role: 'human',
  //     content: humanContent,
  //   },
  // ]);

  console.log(result.map((item) => item.content));

  await Promise.all(
    result.map(async (item, index) => {
      const code = (item.content as string).match(/```jsx\s*([\s\S]*?)\s*```/);
      await writeFile(
        `./codes/step_${index + 1}.tsx`,
        code?.[1] || (item.content as string),
      );
    }),
  );

  console.log('✅ [Node] 视频代码生成完成');

  return {videoCode: result[0].content as string};
}
