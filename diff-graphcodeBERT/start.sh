#!/bin/bash

# GraphCodeBERT 代码相似度对比工具 - 启动脚本

echo "=========================================="
echo "GraphCodeBERT 代码相似度对比工具"
echo "=========================================="

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查 Python 环境
check_python() {
    if command -v python3 &> /dev/null; then
        PYTHON=python3
    elif command -v python &> /dev/null; then
        PYTHON=python
    else
        echo -e "${RED}错误: 未找到 Python，请先安装 Python 3.8+${NC}"
        exit 1
    fi
    echo -e "${GREEN}✓ Python: $($PYTHON --version)${NC}"
}

# 检查 Node.js 环境
check_node() {
    if ! command -v node &> /dev/null; then
        echo -e "${RED}错误: 未找到 Node.js，请先安装 Node.js 16+${NC}"
        exit 1
    fi
    echo -e "${GREEN}✓ Node.js: $(node --version)${NC}"
}

# 安装 Python 依赖
install_python_deps() {
    echo -e "\n${YELLOW}安装 Python 依赖...${NC}"
    $PYTHON -m pip install -r backend/requirements.txt fastapi uvicorn
}

# 安装前端依赖
install_frontend_deps() {
    echo -e "\n${YELLOW}安装前端依赖...${NC}"
    cd frontend
    npm install
    cd ..
}

# 启动后端服务
start_backend() {
    echo -e "\n${GREEN}启动后端 API 服务 (端口 8000)...${NC}"
    $PYTHON backend/api.py &
    BACKEND_PID=$!
    echo "后端 PID: $BACKEND_PID"
}

# 启动前端服务
start_frontend() {
    echo -e "\n${GREEN}启动前端服务 (端口 3000)...${NC}"
    cd frontend
    npm run dev &
    FRONTEND_PID=$!
    cd ..
    echo "前端 PID: $FRONTEND_PID"
}

# 主流程
main() {
    echo -e "\n检查环境..."
    check_python
    check_node

    # 询问是否安装依赖
    read -p "是否安装/更新依赖? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        install_python_deps
        install_frontend_deps
    fi

    echo -e "\n${YELLOW}=========================================="
    echo "启动服务..."
    echo -e "==========================================${NC}"

    start_backend
    sleep 3  # 等待后端启动
    start_frontend

    echo -e "\n${GREEN}=========================================="
    echo "服务已启动!"
    echo "==========================================${NC}"
    echo -e "前端地址: ${GREEN}http://localhost:3000${NC}"
    echo -e "后端 API: ${GREEN}http://localhost:8000${NC}"
    echo -e "API 文档: ${GREEN}http://localhost:8000/docs${NC}"
    echo ""
    echo "按 Ctrl+C 停止所有服务"

    # 等待退出信号
    trap "echo -e '\n${YELLOW}正在停止服务...${NC}'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" SIGINT SIGTERM

    # 保持脚本运行
    wait
}

main
