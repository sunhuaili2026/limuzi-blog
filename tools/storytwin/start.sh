#!/bin/bash
cd $(dirname $0)
export PORT=8001
nohup python3 backend/main.py > storytwin.log 2>&1 &
echo "✅ StoryTwin 已启动 (端口 8001)"
echo "📍 访问：http://localhost:8001"
