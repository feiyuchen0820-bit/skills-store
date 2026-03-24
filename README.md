# 产品相关 Skills 目录站

一个面向产品、设计、战略、增长等工作流的静态 skills 目录站：从本机 `/Users/chenfeiyu/.codex/skills` 读取 skill 元数据，按多维度自动分类、打分、排序，并生成可发布到 GitHub Pages 的 H5 页面。

## 文件结构

- `package.json`：构建、校验和本地预览脚本
- `config/pm-taxonomy.json`：产品相关维度、加分词、惩罚词和校验名单
- `config/pm-overrides.json`：手工置顶、降权、强制收录/排除规则
- `config/pm-zh.json`：skills 的中文标题与中文简介映射
- `scripts/build-skills-index.mjs`：扫描 skill 并生成 `data/skills.json` 与 `skills/<slug>/index.html`
- `index.html`、`styles.css`、`app.js`：静态 H5 页面
- `scripts/daily-refresh.sh`：每日更新数据并按需推送
- `automation/com.skills-store.daily-refresh.plist`：macOS `launchd` 每日 09:00 定时任务模板

## 本地命令

- 生成最新数据：`npm run build:data`
- 生成并校验：`npm run refresh`
- 本地预览：`npm run preview`
- 环境自检：`npm run check`
- 安装每日定时任务：`npm run install:launchd`
- 卸载每日定时任务：`npm run uninstall:launchd`

预览后打开 [http://localhost:4173](http://localhost:4173)。

## GitHub Pages 初始化

如果当前目录还不是仓库，先执行：

```bash
git init -b main
git add .
git commit -m "feat: bootstrap skills site"
git remote add origin <你的 GitHub 仓库地址>
git push -u origin main
```

然后在 GitHub 仓库设置里将 **Pages** 的发布源设为：

- Branch：`main`
- Folder：`/ (root)`

## 每日自动刷新

先确保：

- GitHub 远端已配置为 `origin`
- `gh` 已安装且已登录 GitHub
- 本机可直接访问 `/Users/chenfeiyu/.codex/skills`
- 已执行过一次 `npm install`

手动运行一次刷新：

```bash
./scripts/daily-refresh.sh
```

安装 macOS 定时任务：

```bash
npm run install:launchd
```

查看任务状态：

```bash
launchctl print "gui/$(id -u)/com.skills-store.daily-refresh"
```

取消任务：

```bash
npm run uninstall:launchd
```

## 快速检查

先跑一遍：

```bash
npm run check
```

如果输出里出现以下项目，说明还差人工一步：

- `未配置 origin`：需要先执行 `git remote add origin <repo-url>`
- `当前目录不是 git 仓库`：需要先执行 `git init -b main`
- `尚未安装 launchd 定时任务`：执行 `npm run install:launchd`

## 评分规则

- 总分公式：`推荐分 = max(维度分) + 产品相关加分 - 非相关惩罚`
- 若 `config/pm-overrides.json` 命中，会在自动分基础上叠加 `scoreDelta`
- 支持 `forceInclude`、`forceExclude`、`primaryDimension` 手工修正
- 当前收录阈值：`推荐分 >= 15`
- 数据源只使用：`slug + title + description`
- `.system` 目录下的系统 skills 不进入站点目录
- 前端优先展示 `config/pm-zh.json` 中配置的中文标题与中文简介，英文原文仍保留在详情页

## 手工规则与收藏

- 手工规则配置文件：`config/pm-overrides.json`
- 常用字段：
  - `scoreDelta`：分数加减
  - `forceInclude`：强制收录
  - `forceExclude`：强制排除
  - `primaryDimension`：手工指定主维度
  - `labels`、`note`：前端展示说明
- 页面内“收藏”保存在浏览器 `localStorage`，只对当前浏览器生效，不会同步到仓库
- 每个 skill 会生成站内详情页，可从首页卡片点击“查看详情”跳转
