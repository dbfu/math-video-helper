# Math Video Helper

[中文](README.md) | English

A tool that automatically generates explanation videos from math problems. By entering text or uploading images, the system will analyze the problem, create a storyboard, generate voiceover, and render an explanation video using Remotion.

## Features

- **Multiple Input Methods**: Text input and image upload (with OCR support)
- **Math Formula Support**: Render math formulas using KaTeX
- **Smart Problem Parsing**: Support multi-problem recognition and selection
- **Automated Workflow**: Full automation from problem analysis to video rendering
- **Real-time Progress**: Streaming processing progress and status
- **Video Download**: Preview and download MP4 videos after generation

## Tech Stack

### Frontend

- React 19
- Ant Design 6
- Vite 6
- KaTeX (Math formula rendering)
- React Markdown

### Backend

- Express 5
- LangChain + LangGraph (AI workflow orchestration)
- Remotion 4 (Video rendering)
- OpenAI API (LLM + Vision)

## Project Structure

```
math-video-helper/
├── web/                    # Frontend application
│   ├── src/
│   │   ├── App.tsx        # Main application component
│   │   ├── App.css        # Styles
│   │   └── main.tsx       # Entry point
│   └── package.json
│
├── server/                 # Backend service
│   ├── src/
│   │   ├── index.ts       # Express server entry
│   │   ├── service.ts     # Workflow service
│   │   ├── nodes/         # LangGraph nodes
│   │   │   ├── analyzeProblem.ts    # Problem analysis node
│   │   │   ├── createStoryboard.ts  # Storyboard creation node
│   │   │   ├── generateVoice.ts     # Voice generation node
│   │   │   ├── generateVideoCode.ts # Video code generation node
│   │   │   ├── renderVideo.ts       # Video rendering node
│   │   │   └── types.ts              # Type definitions
│   │   └── utils.ts
│   └── package.json
│
└── .gitignore
```

## Workflow

```
Input Problem (Text/Image)
       ↓
   Problem Parsing (LLM/Vision)
       ↓
   Problem Analysis (analyzeProblem)
       ↓
   Create Storyboard (createStoryboard)
       ↓
   Generate Voice (generateVoice)
       ↓
   Generate Video Code (generateVideoCode)
       ↓
   Render Video (renderVideo)
       ↓
   Output MP4 Video
```

## Quick Start

### Prerequisites

- Node.js 18+
- pnpm (recommended)
- OpenAI API Key

### Installation

```bash
# Install frontend dependencies
cd web
pnpm install

# Install backend dependencies
cd ../server
pnpm install
```

### Configuration

Create a `.env` file in the `server/` directory:

```env
# OpenAI API Configuration
API_KEY=your_openai_api_key
BASE_URL=https://api.openai.com/v1  # Optional proxy URL
MODEL_NAME=gpt-4o-mini              # Text model
VISION_MODEL=gpt-4o-mini            # Vision model (must support vision)
```

### Start

```bash
# Option 1: One-click start for frontend and backend
./start.sh

# Option 2: Start separately
# Start backend (port 8000)
cd server
pnpm dev

# Start frontend (port 5173)
cd web
pnpm dev
```

Visit http://localhost:5173 to use.

## Docker Deployment

### Prerequisites

- Docker

### Quick Start (Docker Run)

```bash
docker run -d -p 8099:80 --cpus="8" \
  -e API_KEY=your_api_key \
  -e BASE_URL=https://api.siliconflow.cn/v1 \
  -e MODEL_NAME=Pro/Qwen/Qwen2.5-VL-72B-Instruct \
  -e VISION_MODEL=Pro/Qwen/Qwen2.5-VL-72B-Instruct \
  registry.cn-hangzhou.aliyuncs.com/xiaofu01/math-video-helper:latest
```

### Quick Start (Docker Compose)

```bash
# Build and start
docker-compose up --build

# Stop
docker-compose down
```

### Service Addresses

- Frontend: http://localhost:8099 (Docker Run) or http://localhost (Docker Compose)
- Backend API: http://localhost:8000

### Notes

1. The first startup will automatically download the Remotion browser (~150MB)
2. Video rendering takes time, please be patient
3. Generated videos are saved in the container at `/app/server/public/video`
4. Environment variables:
   - `API_KEY`: OpenAI API Key
   - `BASE_URL`: API proxy URL
   - `MODEL_NAME`: Text model name
   - `VISION_MODEL`: Vision model name

## API Endpoints

| Endpoint         | Method | Description                    |
| ---------------- | ------ | ------------------------------ |
| `/health`        | GET    | Health check                  |
| `/api/generate`  | POST   | Generate video from text      |
| `/api/upload`    | POST   | Generate video from image     |
| `/api/resume`    | POST   | Resume interrupted workflow   |

## Usage

1. **Text Input Mode**: Enter math problems in the text box, support multiple problems (separated by newlines)
2. **Image Upload Mode**: Upload problem images, support drag & drop or Ctrl+V paste
3. **Problem Selection**: If multiple problems are detected, the system will let you select which problem to generate a video for
4. **Video Generation**: Click the "Generate Video" button, the system will automatically complete the entire process
5. **Preview and Download**: After video generation is complete, you can preview or download

## Development

```bash
# Backend development (hot reload)
cd server && pnpm dev

# Frontend development (hot reload)
cd web && pnpm dev

# Frontend build
cd web && pnpm build
```

## License

MIT
