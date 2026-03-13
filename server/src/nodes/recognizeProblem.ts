import { parseImageQuestions, parseTextQuestions } from '../utils/common';
import { WorkflowState } from './types';

export async function recognizeProblemNode(
  state: WorkflowState,
  config: any,
): Promise<Partial<WorkflowState>> {
  console.log('🔍 [Node] 解析数学题目...');

  config?.writer({
    type: 'message',
    content: '正在识别题目，请稍后...',
  });

  let questions: string[] = [];

  if (state.imagePath) {
    questions = await parseImageQuestions(state.imagePath);
  } else if (state.problemText) {
    questions = await parseTextQuestions(state.problemText);
  }

  if (!questions.length) {
    console.log('未识识别题目');
    config?.writer({type: 'error', content: '未识识别题目'});
    return {
      error: '未识别到题目',
    };
  }

  console.log('✅ [Node] 题目识别完成，识别结果：', questions);

  return {
    questions,
  };
}
