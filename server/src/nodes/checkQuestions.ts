import { interrupt } from '@langchain/langgraph';
import { WorkflowState } from './types';

// 题目检查节点：判断题目数量，如果有多个题目则让用户选择
export async function checkQuestionsNode(
  state: WorkflowState,
): Promise<Partial<WorkflowState>> {
  const questions = state.questions || [];

  // 如果没有 questions 数组，说明是直接传入 problemText
  if (questions.length === 0) {
    return {
      problemText: state.problemText,
    };
  }

  // 只有一道题，直接使用该题目
  if (questions.length === 1) {
    console.log('只有一道题，直接进入分析');
    return {
      problemText: questions[0],
      selectedQuestionIndex: 0,
      selectedQuestion: questions[0],
    };
  }

  // 有多道题，中断让用户选择
  console.log(`有 ${questions.length} 道题，等待用户选择...`);

  const interruptPayload = {
    type: 'question_selection',
    questions: questions,
    message: '请选择一道题目',
  };

  const selectedIndex = interrupt(interruptPayload) as number;

  console.log(`用户选择了第 ${selectedIndex + 1} 道题目`);

  return {
    selectedQuestionIndex: selectedIndex,
    selectedQuestion: questions[selectedIndex],
    problemText: questions[selectedIndex],
  };
}
