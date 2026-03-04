import { ChatOpenAI } from '@langchain/openai';
import { readFile } from 'fs/promises';
import { join } from 'path';
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

export async function analyzeProblemNode(
  state: WorkflowState,
  config: any,
): Promise<Partial<WorkflowState>> {
  console.log('🔍 [Node] 分析数学题目...');

  config?.writer({
    type: 'message',
    content: '正在分析题目，请稍后...',
  });

  const llm = createLLM();

  const systemPrompt = (
    await readFile(
      join(process.cwd(), '/src/prompts/analyzeProblem.txt'),
      'utf-8',
    )
  ).toString();

  let fullContent = '';

  const stream = await llm.stream([
    {
      role: 'system',
      content: systemPrompt,
    },
    {
      role: 'human',
      content: `【数学题目】：${state.problemText}`,
    },
  ]);

  for await (const chunk of stream) {
    const content = chunk.content as string;
    fullContent += content;
    config?.writer({
      type: 'analyzeProblem',
      content: fullContent,
    });
  }

  console.log('✅ [Node] 题目分析完成');

  return {
    problemAnalysis: fullContent,
  };
}
