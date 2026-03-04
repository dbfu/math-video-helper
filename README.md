# 数学视频生成器 (Math Video Helper)

[English](README-en.md) | 中文

一个将数学题目自动生成讲解视频的工具。通过输入文本或上传图片，系统会自动分析题目、创建分镜脚本、生成配音，并使用 Remotion 渲染出讲解视频。

## 功能特性

- **多种输入方式**：支持文本输入和图片上传（包含 OCR 识别）
- **数学公式支持**：使用 KaTeX 渲染数学公式
- **智能题目解析**：支持多题目识别和选择
- **自动化工作流**：从题目分析到视频渲染全流程自动化
- **实时进度反馈**：流式传输处理进度和状态
- **视频下载**：生成后可预览和下载 MP4 视频

## 技术栈

### 前端

- React 19
- Ant Design 6
- Vite 6
- KaTeX (数学公式渲染)
- React Markdown

### 后端

- Express 5
- LangChain + LangGraph (AI 工作流编排)
- Remotion 4 (视频渲染)
- OpenAI API (LLM + Vision)

## 项目结构

```
math-video-helper/
├── web/                    # 前端应用
│   ├── src/
│   │   ├── App.tsx        # 主应用组件
│   │   ├── App.css        # 样式文件
│   │   └── main.tsx       # 入口文件
│   └── package.json
│
├── server/                 # 后端服务
│   ├── src/
│   │   ├── index.ts       # Express 服务器入口
│   │   ├── service.ts     # 工作流服务
│   │   ├── nodes/         # LangGraph 节点
│   │   │   ├── analyzeProblem.ts    # 题目分析节点
│   │   │   ├── createStoryboard.ts  # 故事板创建节点
│   │   │   ├── generateVoice.ts     # 配音生成节点
│   │   │   ├── generateVideoCode.ts # 视频代码生成节点
│   │   │   ├── renderVideo.ts       # 视频渲染节点
│   │   │   └── types.ts              # 类型定义
│   │   └── utils.ts
│   └── package.json
│
└── .gitignore
```

## 工作流程

```
输入题目 (文本/图片)
       ↓
   题目解析 (LLM/Vision)
       ↓
   题目分析 (analyzeProblem)
       ↓
   创建分镜 (createStoryboard)
       ↓
   生成配音 (generateVoice)
       ↓
   生成视频代码 (generateVideoCode)
       ↓
   渲染视频 (renderVideo)
       ↓
   输出 MP4 视频
```

## 快速开始

### 前置要求

- Node.js 18+
- pnpm (推荐)
- OpenAI API Key

### 安装

```bash
# 安装前端依赖
cd web
pnpm install

# 安装后端依赖
cd ../server
pnpm install
```

### 配置

在 `server/` 目录下创建 `.env` 文件：

```env
# OpenAI API 配置
API_KEY=your_openai_api_key
BASE_URL=https://api.openai.com/v1  # 可选的代理地址
MODEL_NAME=gpt-4o-mini              # 文本模型
VISION_MODEL=gpt-4o-mini            # 视觉模型 (需支持 vision)
```

### 启动

```bash
# 方式一：一键启动前后端服务
./start.sh

# 方式二：分别启动
# 启动后端 (端口 8000)
cd server
pnpm dev

# 启动前端 (端口 5173)
cd web
pnpm dev
```

访问 <http://localhost:5173> 即可使用。

## Docker 部署

### 前置要求

- Docker

### 快速启动（Docker Run）

```bash
docker run -d -p 8099:80 --cpus="8" \
  -e API_KEY=your_api_key \
  -e BASE_URL=https://api.siliconflow.cn/v1 \
  -e MODEL_NAME=Pro/Qwen/Qwen2.5-VL-72B-Instruct \
  -e VISION_MODEL=Pro/Qwen/Qwen2.5-VL-72B-Instruct \
  registry.cn-hangzhou.aliyuncs.com/xiaofu01/math-video-helper:latest
```

### 快速启动（Docker Compose）

```bash
# 构建并启动
docker-compose up --build

# 停止
docker-compose down
```

### 服务地址

- 前端：<http://localhost:8099（Docker> Run）或 <http://localhost（Docker> Compose）
- 后端 API：<http://localhost:8000>

### 注意事项

1. 首次启动会自动下载 Remotion 浏览器（约 150MB）
2. 视频渲染需要较长时间，请耐心等待
3. 生成的视频保存在容器的 `/app/server/public/video` 目录
4. 环境变量说明：
   - `API_KEY`: OpenAI API Key
   - `BASE_URL`: API 代理地址
   - `MODEL_NAME`: 文本模型名称
   - `VISION_MODEL`: 视觉模型名称

## API 端点

| 端点            | 方法 | 描述             |
| --------------- | ---- | ---------------- |
| `/health`       | GET  | 健康检查         |
| `/api/generate` | POST | 文本题目生成视频 |
| `/api/upload`   | POST | 图片题目生成视频 |
| `/api/upload`   | POST | 图片题目生成视频 |
| `/api/resume`   | POST | 恢复中断的工作流 |

## 使用说明

1. **文本输入模式**：在文本框中输入数学题目，支持多题目（用换行分隔）
2. **图片上传模式**：上传题目图片，支持拖拽或 Ctrl+V 粘贴
3. **题目选择**：如果识别到多道题目，系统会让您选择要生成视频的题目
4. **视频生成**：点击"生成视频"按钮，系统会自动完成全部流程
5. **预览和下载**：视频生成完成后可以预览或下载

## 开发说明

```bash
# 后端开发 (热重载)
cd server && pnpm dev

# 前端开发 (热重载)
cd web && pnpm dev

# 前端构建
cd web && pnpm build
```

## 许可证

MIT
