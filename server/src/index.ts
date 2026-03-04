import type { Request, Response } from 'express';
import express from 'express';
import { existsSync, promises as fs } from 'fs';
import multer from 'multer';
import path from 'path';
import {
  parseImageQuestions,
  parseTextQuestions,
  resumeWorkflow,
  runWorkflow,
} from './service.js';

const app = express();
const port = 8000;

app.use(express.json());
app.use(express.static('public'));

// 健康检查端点
app.get('/health', (req: Request, res: Response) => {
  res.json({status: 'ok', timestamp: new Date().toISOString()});
});

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: async (
    req: Request,
    file: Express.Multer.File,
    cb: (error: Error | null, destination: string) => void,
  ) => {
    const uploadDir = path.join(process.cwd(), 'public', 'uploads');
    if (!existsSync(uploadDir)) {
      await fs.mkdir(uploadDir, {recursive: true});
    }
    cb(null, uploadDir);
  },
  filename: (
    req: Request,
    file: Express.Multer.File,
    cb: (error: Error | null, filename: string) => void,
  ) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: {fileSize: 10 * 1024 * 1024}, // 10MB limit
  fileFilter: (
    req: Request,
    file: Express.Multer.File,
    cb: (error: Error | null, filename?: string | boolean) => void,
  ) => {
    const allowedExtensions = /jpeg|jpg|png|gif|webp/;
    const extname = allowedExtensions.test(
      path.extname(file.originalname).toLowerCase(),
    );
    const allowedMimes = /image\/(jpeg|jpg|png|gif|webp)/;
    const mimetype = allowedMimes.test(file.mimetype);
    if (extname || mimetype) {
      return cb(null, true);
    }
    cb(new Error('Only image files are allowed!'));
  },
});

// POST endpoint: upload image, parse questions, let user select one and generate video
app.post(
  '/api/upload',
  upload.single('image'),
  async (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');

    try {
      const uploadedFile = req.file as Express.Multer.File;

      res.write(
        JSON.stringify({type: 'message', content: '正在解析题目...'}) + '\n\n',
      );

      if (!uploadedFile) {
        res.write(JSON.stringify({type: 'error', content: '请上传图片文件'}));
        res.end();
        return;
      }

      const imageUrl = `http://localhost:${port}/uploads/${uploadedFile.filename}`;
      console.log('Processing image:', imageUrl);

      // Parse questions from image
      const questions = await parseImageQuestions(imageUrl);

      if (!questions || questions.length === 0) {
        res.write(JSON.stringify({type: 'error', content: '未识别到题目'}));
        res.end();
        return;
      }

      console.log(`Found ${questions.length} questions`);

      // 如果只有一道题，直接执行工作流
      if (questions.length === 1) {
        res.write(
          JSON.stringify({
            type: 'questions',
            questions,
            selectedIndex: 0,
            selectedQuestion: questions[0],
          }) + '\n\n',
        );

        await runWorkflow(questions[0], {
          onNodeStart: (nodeName) => {
            res.write(
              JSON.stringify({type: 'nodeStart', node: nodeName}) + '\n\n',
            );
          },
          onChunk: (chunk) => {
            res.write(chunk);
          },
          onError: (nodeName, error) => {
            res.write(
              JSON.stringify({
                type: 'error',
                content: `${nodeName} 失败: ${error}`,
              }),
            );
          },
        });
      } else {
        // 多道题：使用 interrupt 机制让用户选择
        const result = await runWorkflow(questions[0], {
          questions,
          onNodeStart: (nodeName) => {
            res.write(
              JSON.stringify({type: 'nodeStart', node: nodeName}) + '\n\n',
            );
          },
          onChunk: (chunk) => {
            res.write(chunk);
          },
          onError: (nodeName, error) => {
            res.write(
              JSON.stringify({
                type: 'error',
                content: `${nodeName} 失败: ${error}`,
              }),
            );
          },
          onInterrupt: (interruptData) => {
            // 返回题目列表让用户选择
            res.write(
              JSON.stringify({
                type: 'questions',
                threadId: interruptData.threadId,
                questions: interruptData.questions,
                needSelect: true,
              }) + '\n\n',
            );
          },
        });
      }
    } catch (error) {
      console.error('Upload and generate error:', error);
      res.write(
        JSON.stringify({
          type: 'error',
          content: error instanceof Error ? error.message : '处理失败',
        }),
      );
      res.end();
    }
  },
);

// POST endpoint: resume workflow after user selects a question
app.post('/api/resume', upload.none(), async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');

  const {threadId, selectedIndex} = req.body;

  if (!threadId || selectedIndex === undefined) {
    res.write(JSON.stringify({type: 'error', content: '缺少必要参数'}));
    res.end();
    return;
  }

  console.log(
    `恢复工作流: threadId=${threadId}, selectedIndex=${selectedIndex}`,
  );

  try {
    await resumeWorkflow(threadId, selectedIndex, {
      onNodeStart: (nodeName) => {
        res.write(JSON.stringify({type: 'nodeStart', node: nodeName}) + '\n\n');
      },
      onChunk: (chunk) => {
        res.write(chunk);
      },
    });
  } catch (error) {
    console.error('Resume workflow error:', error);
    res.write(
      JSON.stringify({
        type: 'error',
        content: error instanceof Error ? error.message : '恢复工作流失败',
      }),
    );
    res.end();
  }
});

// POST endpoint with selected question
app.post(
  '/api/generate',
  upload.none(),
  async (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');

    const problemText = req.body.problemText;

    if (!problemText) {
      res.write(JSON.stringify({type: 'error', content: '请提供题目文本'}));
      res.end();
      return;
    }

    try {
      console.log('解析文本题目...');

      res.write(
        JSON.stringify({type: 'message', content: '正在解析题目...'}) + '\n\n',
      );

      // 解析文本中的多题目
      const questions = await parseTextQuestions(problemText);

      if (!questions || questions.length === 0) {
        res.write(JSON.stringify({type: 'error', content: '未识别到题目'}));
        res.end();
        return;
      }

      console.log(`Found ${questions.length} questions`);

      // 如果只有一道题，直接执行工作流
      if (questions.length === 1) {
        res.write(
          JSON.stringify({
            type: 'questions',
            questions,
            selectedIndex: 0,
            selectedQuestion: questions[0],
          }) + '\n\n',
        );

        await runWorkflow(questions[0], {
          onNodeStart: (nodeName) => {
            res.write(
              JSON.stringify({type: 'nodeStart', node: nodeName}) + '\n\n',
            );
          },
          onChunk: (chunk) => {
            res.write(chunk);
          },
          onError: (nodeName, error) => {
            res.write(
              JSON.stringify({
                type: 'error',
                content: `${nodeName} 失败: ${error}`,
              }),
            );
          },
        });
      } else {
        // 多道题：使用 interrupt 机制让用户选择
        await runWorkflow(questions[0], {
          questions,
          onNodeStart: (nodeName) => {
            res.write(
              JSON.stringify({type: 'nodeStart', node: nodeName}) + '\n\n',
            );
          },
          onChunk: (chunk) => {
            res.write(chunk);
          },
          onError: (nodeName, error) => {
            res.write(
              JSON.stringify({
                type: 'error',
                content: `${nodeName} 失败: ${error}`,
              }),
            );
          },
          onInterrupt: (interruptData) => {
            // 返回题目列表让用户选择
            res.write(
              JSON.stringify({
                type: 'questions',
                threadId: interruptData.threadId,
                questions: interruptData.questions,
                needSelect: true,
              }) + '\n\n',
            );
          },
        });
      }
    } catch (error) {
      console.error('Generate error:', error);
      res.write(
        JSON.stringify({
          type: 'error',
          content: error instanceof Error ? error.message : '处理失败',
        }),
      );
      res.end();
    }
  },
);

app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`);
});
