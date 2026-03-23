#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE_PATH="$ROOT_DIR/automation/com.skills-store.daily-refresh.plist"
TARGET_DIR="$HOME/Library/LaunchAgents"
TARGET_PATH="$TARGET_DIR/com.skills-store.daily-refresh.plist"
LOG_DIR="$HOME/Library/Logs"

cd "$ROOT_DIR"

if ! command -v gh >/dev/null 2>&1; then
  echo "gh 未安装，请先安装并登录 GitHub。"
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "gh 尚未登录。请先执行: gh auth login"
  exit 1
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "当前目录还不是 git 仓库，请先执行: git init -b main"
  exit 1
fi

if ! git remote get-url origin >/dev/null 2>&1; then
  echo "尚未配置 origin。请先执行: git remote add origin <repo-url>"
  exit 1
fi

mkdir -p "$TARGET_DIR" "$LOG_DIR"

python3 - "$TEMPLATE_PATH" "$TARGET_PATH" "$ROOT_DIR" "$HOME" <<'PY'
from pathlib import Path
import sys

template_path = Path(sys.argv[1])
target_path = Path(sys.argv[2])
root_dir = Path(sys.argv[3])
home_dir = Path(sys.argv[4])

content = template_path.read_text()
content = content.replace("/Users/chenfeiyu/Documents/codex/skills store", str(root_dir))
content = content.replace("/Users/chenfeiyu", str(home_dir))
target_path.write_text(content)
PY

launchctl bootout "gui/$(id -u)" "$TARGET_PATH" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$TARGET_PATH"
launchctl enable "gui/$(id -u)/com.skills-store.daily-refresh"

echo "已安装每日刷新任务:"
echo "  $TARGET_PATH"
echo "查看状态:"
echo "  launchctl print \"gui/$(id -u)/com.skills-store.daily-refresh\""
