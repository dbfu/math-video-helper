import {
  Command,
  END,
  interrupt,
  MemorySaver,
  START,
  StateGraph,
  StateSchema,
} from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import 'dotenv/config';
import { promises as fs } from 'fs';
import path from 'path';
import { z } from 'zod';
import {
  analyzeProblemNode,
  createStoryboardNode,
  generateVideoCodeNode,
  generateVoiceNode,
  renderVideoNode,
  WorkflowState,
} from './nodes/index.js';

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

// 题目检查节点：判断题目数量，如果有多个题目则让用户选择
async function checkQuestionsNode(
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

export function createWorkflow() {
  const workflow = new StateGraph(WorkflowStateSchema);

  return workflow
    .addNode('checkQuestions', checkQuestionsNode)
    .addNode('analyzeProblem', analyzeProblemNode)
    .addNode('createStoryboard', createStoryboardNode)
    .addNode('generateVoice', generateVoiceNode)
    .addNode('generateVideoCode', generateVideoCodeNode)
    .addNode('renderVideo', renderVideoNode)
    .addEdge(START, 'checkQuestions')
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
  problemText: string,
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

  const initialState: WorkflowState = {
    problemText,
    questions: options?.questions,
    problemAnalysis: '',
    storyboard: [],
    videoCode: '',
    videoUrl: '',
  };

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
        console.log('检测到中断');

        // 返回中断信息给前端
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

// 定义题目解析的输出 schema
const QuestionsSchema = z.object({
  questions: z.array(z.string()).describe('解析出的数学题目数组'),
});

// Function to parse questions from text input
export async function parseTextQuestions(text: string): Promise<string[]> {
  const llm = new ChatOpenAI({
    model: process.env.MODEL_NAME || 'gpt-4o-mini',
    temperature: 0,
    maxCompletionTokens: 4096,
    configuration: {
      apiKey: process.env.API_KEY,
      baseURL: process.env.BASE_URL,
    },
  }).withStructuredOutput(QuestionsSchema);

  const systemPrompt = `你是一个数学题目识别专家。请仔细分析输入的数学题目，将其解析为独立的题目。

规则：
1. 如果只有一道数学题，将其放入数组中
2. 如果有多道数学题，将每一道题放入数组中
3. 每道题必须是完整的、独立的题目文本
4. 只返回题目文本，不要包含解析或答案`;

  console.log('开始解析文本题目...');

  try {
    const result = await llm.invoke([
      {
        role: 'system',
        content: systemPrompt,
      },
      {
        role: 'human',
        content: `【数学题目】：${text}`,
      },
    ]);

    console.log('文本解析返回:', result);
    return result.questions;
  } catch (error) {
    console.error('文本解析失败:', error);
    throw new Error(
      `文本解析失败: ${error instanceof Error ? error.message : '未知错误'}`,
    );
  }
}

// Function to parse questions from image using vision model
export async function parseImageQuestions(imageUrl: string): Promise<string[]> {
  const llm = new ChatOpenAI({
    model: process.env.VISION_MODEL,
    temperature: 0,
    maxCompletionTokens: 4096,
    configuration: {
      apiKey: process.env.API_KEY,
      baseURL: process.env.BASE_URL,
    },
  }).withStructuredOutput(QuestionsSchema);

  const systemPrompt = `你是一个数学题目识别专家。请仔细分析图片中的数学题目，将其解析为独立的题目。

规则：
1. 如果图片中只有一道数学题，将其放入数组中
2. 如果图片中有多道数学题，将每一道题放入数组中
3. 每道题必须是完整的、独立的题目文本
4. 只返回题目文本，不要包含解析或答案
5. 如果需要图片才能理解题目，请在题目中说明`;

  console.log('开始视觉模型识别...');

  // Convert local image to base64
  const imagePath = imageUrl.replace(/^http:\/\/localhost:\d+\//, '');
  const imageFullPath = path.join(process.cwd(), 'public', imagePath);
  const imageBuffer = await fs.readFile(imageFullPath);
  const base64Image = imageBuffer.toString('base64');
  const ext = path.extname(imagePath).slice(1).toLowerCase();
  const mimeType = ext === 'jpg' ? 'jpeg' : ext;
  const dataUrl = `data:image/${mimeType};base64,${base64Image}`;

  console.log('图片大小:', Math.round(base64Image.length / 1024), 'KB');

  try {
    const result = await llm.invoke([
      {
        role: 'system',
        content: systemPrompt,
      },
      {
        role: 'human',
        content: [
          {
            type: 'image_url',
            image_url: {url: dataUrl},
          },
        ],
      },
    ]);

    console.log('视觉模型返回:', result);
    return result.questions;
  } catch (error) {
    console.error('视觉模型调用失败:', error);
    throw new Error(
      `图片识别失败: ${error instanceof Error ? error.message : '未知错误'}`,
    );
  }
}
