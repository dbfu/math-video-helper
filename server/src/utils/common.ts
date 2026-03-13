import { ChatOpenAI } from '@langchain/openai';
import { promises as fs } from 'fs';
import { parseFile } from 'music-metadata';
import { EdgeTTS } from 'node-edge-tts';
import path from 'path';
import z from 'zod';

import { extractJson } from './json';
export type { ExtractJsonOptions } from './json';

export { extractJson };

export async function createVoiceByText(text: string, path: string) {
  const tts = new EdgeTTS({
    voice: 'zh-CN-XiaoxiaoNeural',
  });

  console.log(text, '生成语音');

  // 添加超时处理（默认 2 分钟）
  const timeout = 120000;
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('语音生成超时')), timeout),
  );

  try {
    await Promise.race([tts.ttsPromise(text, path), timeoutPromise]);
  } catch (error) {
    console.error(`   生成语音失败: ${text.substring(0, 20)}...`, error);
    throw error;
  }
}

export async function getMp3Duration(filePath: string): Promise<number> {
  const metadata = await parseFile(filePath);

  const duration = metadata.format.duration; // 秒
  return duration || 0;
}

// 定义题目解析的输出 schema
const QuestionsSchema = z.object({
  questions: z.array(z.string()).describe('解析出的数学题目数组'),
});

// Function to parse questions from text input
export async function parseTextQuestions(text: string): Promise<string[]> {
  const llm = new ChatOpenAI({
    model: process.env.MODEL_NAME || 'gpt-4o-mini',
    maxCompletionTokens: 4096,
    configuration: {
      apiKey: process.env.API_KEY,
      baseURL: process.env.BASE_URL,
    },
  });

  const systemPrompt = `
  # 角色
  你是一个数学题目识别专家。请仔细分析输入的数学题目，将其解析为独立的题目。

# 规则
1. 如果只有一道数学题，将其放入数组中
2. 如果有多道数学题，将每一道题放入数组中
3. 每道题必须是完整的、独立的题目文本
4. 只返回题目文本，不要包含解析或答案
5. 如果没有识别到题目，返回[]
6. 必须返回json数据

# 返回数据格式
json_schema: ${JSON.stringify(QuestionsSchema.toJSONSchema())}
`;

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

    const object = await extractJson(
      QuestionsSchema,
      result.content as string,
      {strict: true},
    );
    return object!.questions;
  } catch (error) {
    console.error('文本解析失败:', error);
    throw new Error(
      `文本解析失败: ${error instanceof Error ? error.message : '未知错误'}`,
    );
  }
}

// Function to parse questions from image using vision model
export async function parseImageQuestions(
  imagePath: string,
): Promise<string[]> {
  const llm = new ChatOpenAI({
    model: process.env.VISION_MODEL,
    maxCompletionTokens: 4096,
    configuration: {
      apiKey: process.env.API_KEY,
      baseURL: process.env.BASE_URL,
    },
  });

  const systemPrompt = `
  # 角色
  你是一个数学题目识别专家。请仔细分析图片中的数学题目，将其解析为独立的题目。

# 规则
1. 如果图片中只有一道数学题，将其放入数组中
2. 如果图片中有多道数学题，将每一道题放入数组中
3. 每道题必须是完整的、独立的题目文本
4. 只返回题目文本，不要包含解析或答案
5. 如果需要图片才能理解题目，请在题目中说明
6. 必须返回json数据

# 返回数据格式
json_schema: ${JSON.stringify(QuestionsSchema.toJSONSchema())}
`;

  console.log('开始视觉模型识别...');

  const imageBuffer = await fs.readFile(imagePath);
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

    const object = await extractJson(
      QuestionsSchema,
      result.content as string,
      {strict: true},
    );
    return object!.questions;
  } catch (error) {
    console.error('视觉模型调用失败:', error);
    throw new Error(
      `图片识别失败: ${error instanceof Error ? error.message : '未知错误'}`,
    );
  }
}
