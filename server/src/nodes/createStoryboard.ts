import { ChatOpenAI } from '@langchain/openai';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { z } from 'zod';
import { WorkflowState } from './types.js';

function createLLM() {
  return new ChatOpenAI({
    model: process.env.MODEL_NAME,
    temperature: 0,
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

  const structuredLlm = llm.withStructuredOutput(storyboardSchema, {
    name: 'storyboard',
  });

  const result = await structuredLlm.invoke([
    {
      role: 'system',
      content: systemPrompt,
    },
    {
      role: 'human',
      content: state.problemAnalysis,
    },
  ]);

  const storyboard = result.steps.map((step) => ({
    visual: step.visual,
    voice: step.voice,
  }));

  console.log('✅ [Node] 分镜设计完成');
  return {storyboard};
}
