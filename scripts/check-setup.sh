#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILLS_ROOT="${SKILLS_ROOT:-/Users/chenfeiyu/.codex/skills}"

cd "$ROOT_DIR"

echo "== PM Skills Site Setup Check =="
echo "workspace: $ROOT_DIR"
echo "skills root: $SKILLS_ROOT"

if [ -d "$SKILLS_ROOT" ]; then
  echo "✓ skills 数据源存在"
else
  echo "✗ skills 数据源不存在: $SKILLS_ROOT"
  exit 1
fi

if command -v node >/dev/null 2>&1; then
  echo "✓ node: $(node -v)"
else
  echo "✗ node 未安装"
  exit 1
fi

if command -v npm >/dev/null 2>&1; then
  echo "✓ npm: $(npm -v)"
else
  echo "✗ npm 未安装"
  exit 1
fi

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "✓ 当前目录已是 git 仓库"
else
  echo "✗ 当前目录不是 git 仓库，请先执行: git init -b main"
  exit 1
fi

if git remote get-url origin >/dev/null 2>&1; then
  echo "✓ origin: $(git remote get-url origin)"
else
  echo "✗ 未配置 origin，请执行: git remote add origin <repo-url>"
fi

if [ -f "$ROOT_DIR/data/skills.json" ]; then
  echo "✓ 已生成 data/skills.json"
else
  echo "○ 尚未生成 data/skills.json，可执行: npm run build:data"
fi

LAUNCH_AGENT_TARGET="$HOME/Library/LaunchAgents/com.skills-store.daily-refresh.plist"

if [ -f "$LAUNCH_AGENT_TARGET" ]; then
  echo "✓ 已安装 launchd plist: $LAUNCH_AGENT_TARGET"
else
  echo "○ 尚未安装 launchd 定时任务，可执行: npm run install:launchd"
fi

