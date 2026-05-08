#!/bin/bash

# 李子木个人网站自动部署脚本
# 使用方法：在服务器上执行此脚本

set -e

echo "========================================"
echo "🚀 李子木个人网站自动部署脚本"
echo "========================================"
echo ""

# 网站目录
WEB_ROOT="/var/www/html"
BACKUP_DIR="/var/www/backup/$(date +%Y%m%d_%H%M%S)"

# 颜色定义
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}⚠️  此脚本将：${NC}"
echo "   1. 备份当前网站文件到 $BACKUP_DIR"
echo "   2. 从 GitHub 拉取最新代码"
echo "   3. 更新网站文件"
echo ""

read -p "确认继续？(y/n): " confirm
if [ "$confirm" != "y" ]; then
    echo -e "${RED}❌ 已取消${NC}"
    exit 1
fi

echo ""
echo "📦 步骤 1: 创建备份目录..."
mkdir -p "$BACKUP_DIR"
cp -r "$WEB_ROOT"/* "$BACKUP_DIR"/ 2>/dev/null || true
echo -e "${GREEN}✅ 备份完成：$BACKUP_DIR${NC}"

echo ""
echo "📦 步骤 2: 进入网站目录..."
cd "$WEB_ROOT"

echo ""
echo "📦 步骤 3: 拉取最新代码..."
git config --global user.email "deploy@lizhimu.cn"
git config --global user.name "Deploy Bot"
git pull origin main

echo ""
echo -e "${GREEN}✅ 部署完成！${NC}"
echo ""
echo "📊 当前版本信息:"
git log -1 --pretty=format:"%h - %s (%ar)"
echo ""
echo "🌐 网站地址：https://lizhimu.cn"
echo ""

# 清理旧备份（保留最近 5 个）
echo "🧹 清理旧备份..."
cd /var/www/backup/
ls -t | tail -n +6 | xargs -r rm -rf
echo -e "${GREEN}✅ 备份清理完成${NC}"

echo ""
echo "========================================"
echo -e "${GREEN}🎉 部署成功！${NC}"
echo "========================================"
