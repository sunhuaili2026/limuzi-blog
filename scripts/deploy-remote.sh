#!/bin/bash
# 非交互式远程部署 — 供 GitHub Actions 或 CI 调用

set -euo pipefail

WEB_ROOT="${WEB_ROOT:-/var/www/html}"
BACKUP_DIR="${BACKUP_DIR:-/var/www/backup/$(date +%Y%m%d_%H%M%S)}"

echo "🚀 开始部署到 ${WEB_ROOT}"

mkdir -p "$BACKUP_DIR" /var/www/backup
if [ -d "$WEB_ROOT" ] && [ "$(ls -A "$WEB_ROOT" 2>/dev/null)" ]; then
  cp -r "$WEB_ROOT"/* "$BACKUP_DIR"/ 2>/dev/null || true
  echo "✅ 备份完成：$BACKUP_DIR"
fi

cd "$WEB_ROOT"

if [ ! -d .git ]; then
  echo "❌ ${WEB_ROOT} 不是 git 仓库，请先 clone limuzi-blog"
  exit 1
fi

git fetch origin main
git reset --hard origin/main

echo "✅ 部署完成"
git log -1 --pretty=format:"%h - %s (%ar)"
echo ""

# 保留最近 5 个备份
cd /var/www/backup/ 2>/dev/null && ls -t | tail -n +6 | xargs -r rm -rf || true
