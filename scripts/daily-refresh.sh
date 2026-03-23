#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_BRANCH="${TARGET_BRANCH:-main}"

cd "$ROOT_DIR"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm 未安装，无法执行每日刷新。"
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "gh 未安装，无法自动推送到 GitHub。"
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "gh 尚未登录，请先执行: gh auth login"
  exit 1
fi

if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi

npm run build:data

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "当前目录还不是 git 仓库，请先执行 git init -b main。"
  exit 1
fi

if ! git remote get-url origin >/dev/null 2>&1; then
  echo "未配置 origin 远端，请先绑定 GitHub Pages 仓库。"
  exit 1
fi

gh auth setup-git >/dev/null 2>&1 || true

if [ -n "$(git status --porcelain -- data/skills.json)" ]; then
  git add data/skills.json
  git commit -m "chore: refresh PM skills index $(date '+%Y-%m-%d')"
  git push origin "$TARGET_BRANCH"
  echo "已推送最新 data/skills.json 到 origin/$TARGET_BRANCH。"
else
  echo "data/skills.json 无变化，跳过提交。"
fi
