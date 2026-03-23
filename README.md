# PM Skills H5 目录站

一个面向产品经理的静态 skills 目录站：从本机 `/Users/chenfeiyu/.codex/skills` 读取 skill 元数据，按 PM 5 维自动分类、打分、排序，并生成可发布到 GitHub Pages 的 H5 页面。

## 文件结构

- `package.json`：构建、校验和本地预览脚本
- `config/pm-taxonomy.json`：PM 维度、加分词、惩罚词和校验名单
- `scripts/build-skills-index.mjs`：扫描 skill 并生成 `data/skills.json`
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
git commit -m "feat: bootstrap PM skills site"
git remote add origin <你的 GitHub 仓库地址>
git push -u origin main
```

然后在 GitHub 仓库设置里将 **Pages** 的发布源设为：

- Branch：`main`
- Folder：`/ (root)`

## 每日自动刷新

先确保：

- GitHub 远端已配置为 `origin`
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

- 总分公式：`PM 推荐分 = max(维度分) + PM 加分 - 非 PM 惩罚`
- 收录阈值：`PM 推荐分 >= 30`
- 数据源只使用：`slug + title + description`
- `.system` 目录下的系统 skills 不进入站点目录
