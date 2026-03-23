#!/usr/bin/env bash

set -euo pipefail

TARGET_PATH="$HOME/Library/LaunchAgents/com.skills-store.daily-refresh.plist"

if [ -f "$TARGET_PATH" ]; then
  launchctl bootout "gui/$(id -u)" "$TARGET_PATH" >/dev/null 2>&1 || true
  rm -f "$TARGET_PATH"
  echo "已卸载 launchd 定时任务: $TARGET_PATH"
else
  echo "未发现已安装的 launchd 定时任务。"
fi

