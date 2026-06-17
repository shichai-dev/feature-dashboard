# 面板动作接口

这个 Worker 负责让公开 Dashboard 在页面内完成评价、Panel Topic 发布、手动 Issue 绑定、接单、转交和状态更新。

前端不能直接保存 GitHub 写权限，所以所有写入 GitHub 的动作都由 Worker 代办。

它是当前 MVP 的受控动作执行层：AI 和浏览器只提交结构化请求，Worker 负责校验团队操作口令、actor、允许仓库和动作类型，再执行有限 GitHub 写入。后续可以替换为自有后台或 GitHub App，但边界仍然是禁止浏览器持写 token、禁止 AI 持无限制 GitHub token。

## 接口

- `POST /api/discussions`：在 `shichai-dev/feature-dashboard` 创建源讨论，并打上 `dispatch:pending`。
- `POST /api/action-check`：无副作用检测动作接口、团队口令和操作者权限。
- `GET /api/development-ai/health`：读取开发面板中台 AI 运行状态；优先使用 Worker 内置 DeepSeek 免费路径，未配置时可回退代理共享服务器。
- `POST /api/development-ai/topic-draft`：校验 Dashboard 操作者后，优先由 Worker 直接调用 DeepSeek 生成 Panel Topic 和 issue 草稿；未配置 DeepSeek key 时可回退服务器中台 AI。
- `POST /api/final-issues`：把面板生成的 Panel Topic 草稿发布为目标仓库的 Final Implementation Issue。
- `POST /api/final-issues/bind`：校验手动发布后的 GitHub Issue URL，确认仓库和标题匹配后返回绑定信息。
- `POST /api/issue-command`：对目标 Issue 执行接单、放弃、转交、阻塞、等待 PR。
- `GET /api/health`：健康检查。

## 必需密钥

```powershell
wrangler secret put GITHUB_TOKEN
wrangler secret put DASHBOARD_ACTION_KEY
wrangler secret put DEVELOPMENT_AI_DEEPSEEK_API_KEY
```

`GITHUB_TOKEN` 至少需要这些权限：

- 对 `shichai-dev/feature-dashboard` 写 Issue、写评论、触发 `refresh-dashboard.yml`
- 对 `planning`、`opc-bounty-client`、`opc-bounty-admin`、`opc-bounty-server` 写 Issue、写评论、设置 assignee 和标签

`DASHBOARD_ACTION_KEY` 是团队成员在 Dashboard 顶部填写的操作口令。

`DEVELOPMENT_AI_DEEPSEEK_API_KEY` 是免费方案的主路径，只保存在 Cloudflare Worker Secret 中。前端网页、仓库、浏览器本地存储都不能保存这个 key。

可选 fallback：

```powershell
wrangler secret put DEVELOPMENT_AI_KEY
```

`DEVELOPMENT_AI_KEY` 只用于 Worker 回退调用 `opc-bounty-server` 时的服务器到服务器鉴权。`wrangler.jsonc` 中的 `DEVELOPMENT_AI_BASE_URL` 可保留为共享服务器入口，但不再是中台 AI 的主路径。

## 部署

```powershell
cd actions-worker
npm install
npm run deploy
```

部署完成后，把 Worker 地址填到 `index.html` 的：

```html
<meta name="dashboard-action-api" content="https://你的-worker.workers.dev">
```

也可以先在页面顶部的“动作接口”输入框里手动填写 Worker 地址，用于测试。
