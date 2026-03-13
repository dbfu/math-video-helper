import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';

/**
 * 大模型修复 JSON 的 system prompt
 */
const FIX_JSON_SYSTEM_PROMPT = `你是一个 JSON 修复专家。你的任务是将不规范的 JSON 修复为合法的 JSON。

# 规则
1. 只返回修复后的 JSON，不要包含任何解释或注释
2. 保持 JSON 的结构和数据不变
3. 修复以下问题：
   - 移除尾随逗号
   - 将单引号替换为双引号
   - 移除 JavaScript 注释
   - 修复其他 JSON 语法错误
4. 如果无法修复，返回原始 JSON`;

/**
 * 尝试修复不规范的 JSON 字符串
 */
export function tryFixJson(jsonStr: string): string {
  let fixed = jsonStr;

  // 移除尾随逗号: {a: 1,} -> {a: 1}
  fixed = fixed.replace(/,(\s*[}\]])/g, '$1');

  // 修复单引号为双引号（排除已转义的）
  fixed = fixed.replace(/(?<!\\)'/g, '"');

  // 移除 JavaScript 注释
  fixed = fixed.replace(/\/\/.*$/gm, '');
  fixed = fixed.replace(/\/\*[\s\S]*?\*\//g, '');

  // 移除 JSON 中不允许的 trailing comma
  fixed = fixed.replace(/,\s*([}\]])/g, '$1');

  return fixed;
}

/**
 * 提取 JSON 字符串的各种策略
 */
export function extractJsonStrategies(input: string): string | null {
  // 策略1: 提取 ```json ``` 块
  const jsonBlockMatch = input.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonBlockMatch?.[1]) {
    return jsonBlockMatch[1].trim();
  }

  // 策略2: 提取 ``` ``` 块（无语言标识）
  const codeBlockMatch = input.match(/```\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch?.[1]) {
    const content = codeBlockMatch[1].trim();
    if (content.startsWith('{') || content.startsWith('[')) {
      return content;
    }
  }

  // 策略3: 提取 {...}
  const bracesMatch = input.match(/\{[\s\S]*\}/);
  if (bracesMatch?.[0]) {
    return bracesMatch[0];
  }

  // 策略4: 提取 [...]
  const bracketsMatch = input.match(/\[[\s\S]*\]/);
  if (bracketsMatch?.[0]) {
    return bracketsMatch[0];
  }

  return null;
}

/**
 * 使用大模型修复 JSON
 */
async function fixJsonWithLLM(jsonStr: string): Promise<string> {
  const llm = new ChatOpenAI({
    model: process.env.MODEL_NAME || 'gpt-4o-mini',
    maxCompletionTokens: 4096,
    configuration: {
      apiKey: process.env.API_KEY,
      baseURL: process.env.BASE_URL,
    },
  });

  const result = await llm.invoke([
    {
      role: 'system',
      content: FIX_JSON_SYSTEM_PROMPT,
    },
    {
      role: 'human',
      content: `请修复以下 JSON：\n${jsonStr}`,
    },
  ]);

  // 提取修复后的 JSON
  const fixed = extractJsonStrategies(result.content as string);
  return fixed || jsonStr;
}

/**
 * extractJson 选项
 */
export interface ExtractJsonOptions {
  /** 是否严格模式：失败时抛错，否则返回 null */
  strict?: boolean;
  /** 最大正则修复尝试次数 */
  maxRetries?: number;
  /** 是否使用大模型修复（当正则修复失败后） */
  useLLMFix?: boolean;
}

/**
 * 从文本中提取 JSON 并用 zod schema 验证
 * @param schema - zod schema 定义
 * @param input - 输入文本
 * @param options - 选项
 * @returns 解析后的对象，类型为 zod schema 的推断类型
 */
export async function extractJson<T extends z.ZodType<any, any, any>>(
  schema: T,
  input: string,
  options: ExtractJsonOptions = {},
): Promise<z.infer<T> | null> {
  const { strict = true, maxRetries = 2, useLLMFix = true } = options;

  // 提取 JSON 字符串
  let jsonStr = extractJsonStrategies(input);

  if (!jsonStr) {
    if (strict) {
      throw new Error('未找到有效的 JSON 数据');
    }
    return null;
  }

  // 尝试解析，失败则尝试修复
  for (let i = 0; i <= maxRetries; i++) {
    try {
      const parsed = JSON.parse(jsonStr);
      return schema.parse(parsed);
    } catch (error) {
      // 最后一次尝试失败
      if (i === maxRetries) {
        // 如果开启了 LLM 修复，尝试用大模型修复
        if (useLLMFix) {
          try {
            console.log('   尝试使用大模型修复 JSON...');
            jsonStr = await fixJsonWithLLM(jsonStr);
            // LLM 修复后再尝试解析
            const parsed = JSON.parse(jsonStr);
            return schema.parse(parsed);
          } catch (llmError) {
            console.error('   LLM 修复失败:', llmError);
          }
        }

        console.error('JSON 解析失败:', error);
        if (strict) {
          throw new Error(
            `JSON 解析失败: ${error instanceof Error ? error.message : '未知错误'}`,
          );
        }
        return null;
      }

      // 尝试正则修复
      jsonStr = tryFixJson(jsonStr);
    }
  }

  return null;
}
