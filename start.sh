#!/bin/bash

# 一键启动前后端服务

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}正在启动 Math Video Helper...${NC}"

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 启动后端服务
echo -e "${YELLOW}[1/2] 启动后端服务...${NC}"
cd "$SCRIPT_DIR/server"
pnpm start &
SERVER_PID=$!

# 等待后端启动
sleep 3

# 启动前端服务
echo -e "${YELLOW}[2/2] 启动前端服务...${NC}"
cd "$SCRIPT_DIR/web"
pnpm dev &
WEB_PID=$!

echo -e "${GREEN}服务启动完成！${NC}"
echo -e "  - 后端服务: http://localhost:8000"
echo -e "  - 前端服务: http://localhost:5173"
echo ""
echo -e "按 ${YELLOW}Ctrl+C${NC} 停止所有服务"

# 捕获 Ctrl+C 并停止所有服务
trap "kill $SERVER_PID $WEB_PID 2>/dev/null; exit" INT TERM

# 等待任意一个进程结束
wait
