import { ChatOpenAI } from '@langchain/openai';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { z } from 'zod';
import { extractJson } from '../utils/common';
import { WorkflowState } from './types';

function createLLM() {
  return new ChatOpenAI({
    model: process.env.MODEL_NAME,
    configuration: {
      apiKey: process.env.API_KEY,
      baseURL: process.env.BASE_URL,
    },
  });
}

const storyboardSchema = z.object({
  steps: z.array(
    z.object({
      visual: z.string(),
      voice: z.string(),
    }),
  ),
});

export async function createStoryboardNode(
  state: WorkflowState,
  config: any,
): Promise<Partial<WorkflowState>> {
  console.log('🎬 [Node] 生成分镜设计...');

  config?.writer({
    type: 'message',
    content: '生成分镜设计',
  });

  const llm = createLLM();

  const systemPrompt = (
    await readFile(
      join(process.cwd(), '/src/prompts/createStoryboard.txt'),
      'utf-8',
    )
  ).toString();

  const result = await llm.invoke([
    {
      role: 'system',
      content: systemPrompt,
    },
    {
      role: 'human',
      content: state.problemAnalysis,
    },
  ]);

  const parsed = await extractJson(storyboardSchema, result.content as string, { strict: true })!;

  const storyboard = parsed!.steps.map((step, index) => ({
    visual: step.visual,
    voice: step.voice,
    index: index + 1,
  }));

  console.log('✅ [Node] 分镜设计完成');
  return {storyboard};
}
