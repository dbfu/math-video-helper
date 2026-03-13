import {
  Command,
  END,
  MemorySaver,
  START,
  StateGraph,
  StateSchema,
} from '@langchain/langgraph';
import 'dotenv/config';
import { z } from 'zod';
import { checkQuestionsNode } from './nodes/checkQuestions';
import {
  analyzeProblemNode,
  createStoryboardNode,
  generateVideoCodeNode,
  generateVoiceNode,
  renderVideoNode,
  WorkflowState,
} from './nodes/index';
import { recognizeProblemNode } from './nodes/recognizeProblem';

// Checkpointer for persisting graph state
const checkpointer = new MemorySaver();

// 用于存储工作流状态
interface WorkflowSession {
  threadId: string;
  questions: string[];
  selectedIndex: number;
  problemAnalysis: string;
  state?: WorkflowState;
}

const sessions = new Map<string, WorkflowSession>();

// 创建唯一的线程ID
function generateThreadId(): string {
  return `thread_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

const WorkflowStateSchema = new StateSchema({
  problemText: z.string(),
  questions: z.array(z.string()).optional(),
  selectedQuestionIndex: z.number().optional(),
  selectedQuestion: z.string().optional(),
  problemAnalysis: z.string(),
  storyboard: z.array(
    z.object({
      index: z.number(),
      visual: z.string(),
      voice: z.string(),
      duration: z.number().optional(),
      voiceFileName: z.string().optional(),
    }),
  ),
  videoCode: z.string(),
  videoUrl: z.string(),
  error: z.string().optional(),
  retryCount: z.number().optional(),
});

export function createWorkflow() {
  const workflow = new StateGraph(WorkflowStateSchema);

  return workflow
    .addNode('recognizeProblem', recognizeProblemNode)
    .addNode('checkQuestions', checkQuestionsNode)
    .addNode('analyzeProblem', analyzeProblemNode)
    .addNode('createStoryboard', createStoryboardNode)
    .addNode('generateVoice', generateVoiceNode)
    .addNode('generateVideoCode', generateVideoCodeNode)
    .addNode('renderVideo', renderVideoNode)
    .addEdge(START, 'recognizeProblem')
    .addConditionalEdges(
      'recognizeProblem',
      (state: WorkflowState) => {
        console.log(state, 'state');
        if (state.error) {
          return END;
        }
        return 'checkQuestions';
      },
      ['checkQuestions', END],
    )
    .addEdge('checkQuestions', 'analyzeProblem')
    .addEdge('analyzeProblem', 'createStoryboard')
    .addEdge('createStoryboard', 'generateVoice')
    .addEdge('generateVoice', 'generateVideoCode')
    .addEdge('generateVideoCode', 'renderVideo')
    .addConditionalEdges(
      'renderVideo',
      (state: WorkflowState) => {
        if (state.retryCount && state.retryCount > 0) {
          return 'generateVideoCode';
        }
        return END;
      },
      ['generateVideoCode', END],
    )
    .compile({checkpointer});
}

export async function runWorkflow(
  initialState: WorkflowState,
  options?: {
    threadId?: string;
    questions?: string[];
    onNodeStart?: (nodeName: string) => void;
    onNodeEnd?: (nodeName: string, output: Partial<WorkflowState>) => void;
    onError?: (nodeName: string, error: string) => void;
    onChunk?: (chunk: string) => void;
    onInterrupt?: (interruptData: {
      type: string;
      questions: string[];
      threadId: string;
    }) => void;
  },
): Promise<{
  lastOutput: WorkflowState;
  interrupted: boolean;
  threadId: string;
}> {
  const graph = createWorkflow();
  const threadId = options?.threadId || generateThreadId();

  // 创建 writer 回调，用于节点向前端发送消息
  const writer = (data: {type: string; content: string}) => {
    options?.onChunk?.('data: ' + JSON.stringify(data) + '\n\n');
  };

  const config = {
    configurable: {
      thread_id: threadId,
    },
    writer,
  } as any;

  let lastOutput: WorkflowState = initialState;

  // 第一次调用，如果有多道题，工作流会在 checkQuestions 节点中断等待用户选择
  try {
    for await (const chunk of await graph.stream(initialState, {
      ...config,
      streamMode: ['updates', 'custom'],
    } as any)) {
      const [, chunkAny] = chunk as any;
      // 检查是否包含 interrupt
      if (chunkAny.__interrupt__) {
        console.log('检测到中断', chunkAny);
        const [interrupt] = chunkAny.__interrupt__;

        // 返回中断信息给前端
        options?.onInterrupt?.({
          type: 'question_selection',
          questions: interrupt?.value?.questions || [],
          threadId,
        });

        return {
          lastOutput,
          interrupted: true,
          threadId,
        };
      }

      options?.onChunk?.('data: ' + JSON.stringify(chunk) + '\n\n');
      lastOutput = {...lastOutput, ...chunk};
    }
  } catch (error: any) {
    // 检查是否是中断错误
    if (error?.__interrupt__) {
      console.log('检测到中断 (通过错误)');

      options?.onInterrupt?.({
        type: 'question_selection',
        questions: lastOutput.questions || [],
        threadId,
      });

      return {
        lastOutput,
        interrupted: true,
        threadId,
      };
    }
    throw error;
  }

  return {
    lastOutput,
    interrupted: false,
    threadId,
  };
}

// 恢复工作流
export async function resumeWorkflow(
  threadId: string,
  resumeValue: number,
  options?: {
    onNodeStart?: (nodeName: string) => void;
    onChunk?: (chunk: string) => void;
  },
): Promise<WorkflowState> {
  const graph = createWorkflow();

  // 创建 writer 回调，用于节点向前端发送消息
  const writer = (data: {type: string; content: string}) => {
    options?.onChunk?.('data: ' + JSON.stringify(data) + '\n\n');
  };

  const config = {
    configurable: {
      thread_id: threadId,
    },
    writer,
  } as any;

  // 使用 Command 恢复执行
  const command = new Command({resume: resumeValue.toString()});

  let lastOutput: WorkflowState = {
    problemText: '',
    problemAnalysis: '',
    storyboard: [],
    videoCode: '',
    videoUrl: '',
  };

  for await (const chunk of await graph.stream(
    command as any,
    {
      ...config,
    } as any,
  )) {
    options?.onChunk?.('data: ' + JSON.stringify(chunk) + '\n\n');
    lastOutput = {...lastOutput, ...chunk};
  }

  return lastOutput;
}
