# 数学视频生成器 Dockerfile

# ============ 阶段 1: 构建前端 ============
FROM node:22-bookworm-slim AS frontend-builder

WORKDIR /app/web

# 使用 npm 安装 pnpm (需要 9.x 版本匹配 lockfileVersion 6.0)
RUN npm install -g pnpm@9

COPY web/package.json web/pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile

COPY web/src ./src
COPY web/public ./public
COPY web/vite.config.ts .
COPY web/tsconfig.json .
COPY web/tsconfig.app.json .
COPY web/tsconfig.node.json .
COPY web/index.html .

RUN pnpm build

# ============ 阶段 2: 构建后端 ============
FROM node:22-bookworm-slim AS backend-builder

WORKDIR /app/server

# 安装 Chrome 依赖
RUN apt-get update && apt-get install -y \
  libnss3 \
  libdbus-1-3 \
  libatk1.0-0 \
  libgbm-dev \
  libasound2 \
  libxrandr2 \
  libxkbcommon-dev \
  libxfixes3 \
  libxcomposite1 \
  libxdamage1 \
  libatk-bridge2.0-0 \
  libpango-1.0-0 \
  libcairo2 \
  libcups2 \
  libdrm2 \
  libuuid1 \
  libx11-6 \
  libxext6 \
  && rm -rf /var/lib/apt/lists/*

# 使用 npm 安装 pnpm (需要 9.x 版本匹配 lockfileVersion 6.0)
RUN npm install -g pnpm@9

COPY server/package.json server/pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile

COPY server/src ./src
COPY server/tsconfig.json .

# ============ 阶段 3: 运行镜像 ============
FROM node:22-bookworm-slim

WORKDIR /app



# 安装 Chrome 依赖 (运行时也需要)
RUN apt-get update && apt-get install -y \
  libnss3 \
  libdbus-1-3 \
  libatk1.0-0 \
  libgbm-dev \
  libasound2 \
  libxrandr2 \
  libxkbcommon-dev \
  libxfixes3 \
  libxcomposite1 \
  libxdamage1 \
  libatk-bridge2.0-0 \
  libpango-1.0-0 \
  libcairo2 \
  libcups2 \
  libdrm2 \
  libuuid1 \
  libx11-6 \
  libxext6 \
  unzip \
  nginx \
  fonts-noto-cjk \
  && rm -rf /var/lib/apt/lists/*

# 创建必要的目录
RUN mkdir -p /app/web /app/server/public /app/server/audio /run/nginx

# 从前端构建阶段复制构建产物到 web 目录
COPY --from=frontend-builder /app/web/dist /app/web

# 从后端构建阶段复制 node_modules 和源代码
COPY --from=backend-builder /app/server/node_modules ./server/node_modules
COPY --from=backend-builder /app/server/package.json ./server/package.json
COPY --from=backend-builder /app/server/src ./server/src


# 复制 Chrome headless shell
COPY server/remotion-project.zip ./server/

# 复制 nginx 配置
RUN rm -f /etc/nginx/sites-enabled/default
COPY nginx.conf /etc/nginx/sites-available/default
RUN ln -sf /etc/nginx/sites-available/default /etc/nginx/sites-enabled/

# 设置环境变量
ENV NODE_ENV=production
ENV PORT=8000

EXPOSE 80 8000

# 启动脚本：先启动 nginx，后启动后端
CMD sh -c "nginx & sleep 3 && cd /app/server && node --import tsx src/index.ts"
