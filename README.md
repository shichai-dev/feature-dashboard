# 拾柴功能讨论看板

这是拾柴团队公开可见的功能状态和异步讨论看板。

线上地址：

- https://shichai-dev.github.io/feature-dashboard/

数据来源：

- `registry/feature-registry.json`：公开功能、界面页面、仿真页面、热点和操作链登记表。
- 公开讨论议题：团队成员可以从网页里提交想法、评价、修改请求、问题风险和协作交接。
- `scripts/collect-status.mjs`：合并功能登记表、组织项目看板、私有实现议题、Issue 接单状态、公开讨论议题和评论。
- `data/status.json`：网页实际读取的生成快照。

私有代码仓库仍然保持私有。这个公开仓库只能发布功能名称、界面页面、操作链、关联议题链接和验证状态。不要发布密钥、源码片段、对象存储键、真实用户数据、私有提示词或生产凭据。

## 讨论流程

1. 打开线上看板，进入“仿真平台”。
2. 在仿真实页面里点击某个按钮、图标、页面区域或操作步骤。
3. 在页面顶部填写 GitHub 用户名、团队操作口令和动作接口。
4. 在右侧讨论栏直接提交想法、评价、修改请求、问题风险或追加操作链，不需要跳转 GitHub。
5. Dashboard 动作接口会先生成一个公开源讨论，并带上 `dispatch:pending`。
6. `discussion-dispatch.yml` 会根据功能编号、界面页面、关键词和分工规则推断目标仓库，并创建目标 Issue。
7. 分发成功后，源讨论下面会写回“已分发目标”，并标记为 `dispatch:sent`。
8. 刷新任务会读取源讨论和目标仓 Issue，并标记为“待智能处理”“已采纳”“已实现”“已过期”或“受阻”。
9. 协调智能体读取 `data/status.json`，重点查看讨论、分发状态和待处理队列，再决定是否进一步拆分实现议题或标记旧评论过期。
10. 代码、议题或评论变化后，下一次刷新会同步更新功能状态、界面页面、操作链、协作交接、讨论数量和接单状态。

页面内直接提交依赖 `actions-worker/`。前端不会保存 GitHub 写权限；GitHub token 只放在 Worker Secret 中。

旧的 GitHub 跳转式流程已经降级为后台记录，不再作为默认操作路径。

页面内嵌快速评论已经并入结构化提交表单，不再依赖 `utterances` 或 GitHub 页面跳转。

## 分发流程

Dashboard 是讨论收集入口，不是所有任务的最终归属仓库。

自动分发规则：

- 用户端界面、按钮、图标、页面、交互、首页、展示台、发布、详情页、个人页：分发到 `opc-bounty-client`。
- 管理端、后台、管理员、审核、审计、运营台：分发到 `opc-bounty-admin`。
- 后端、服务端、接口、API、数据库、权限、钱包、账本、支付、智能服务、对象存储：分发到 `opc-bounty-server`。
- 规划、需求不清、跨仓总问题：分发到 `planning`。
- Dashboard 自身看板、接单、分发、公开讨论问题：保留在 `feature-dashboard`。

分发成功后，Dashboard 源讨论会保留，目标仓库会出现一个可接单 Issue。后续接单应在目标 Issue 里完成。

跨仓创建 Issue 需要给本仓库配置 `SHICHAI_DISPATCH_TOKEN` 密钥。该令牌至少需要对这些仓库具备 Issues 写权限：

- `shichai-dev/planning`
- `shichai-dev/opc-bounty-client`
- `shichai-dev/opc-bounty-admin`
- `shichai-dev/opc-bounty-server`

如果没有配置该密钥，分发工作流会在源讨论里标记 `dispatch:blocked` 并说明原因。

## 接单流程

1. 打开线上看板，进入“任务接单”。
2. 点击某个 Issue 卡片，在右侧查看父级归属、总问题、负责人、接单时间和已耗时。
3. 在页面顶部确认 GitHub 用户名、团队操作口令和动作接口已经填写。
4. 直接点击右侧的“我来接单”“等待 PR”“放弃接单”“转交”“标记阻塞”。
5. 动作接口会在后台设置 assignee、标签和评论，并触发 Dashboard 自动刷新。
6. 下一次 Dashboard 刷新后，页面会同步显示新的负责人、接单状态和已耗时。

面板按钮和旧命令的对应关系：

```txt
我来接单 -> /claim
放弃接单 -> /unclaim
转交 -> /handoff @用户名
标记阻塞 -> /blocked 原因
等待 PR -> /ready-pr
```

当前任务接单面板会汇总 `planning`、`opc-bounty-client`、`opc-bounty-admin`、`opc-bounty-server` 和 `feature-dashboard` 的 Issue。当前推荐路径是通过 `actions-worker/` 集中处理面板内动作；各仓库里的 `.github/workflows/issue-claim.yml` 继续作为 Issue 评论命令的兼容兜底。

## 本地 Agent 接力

认领者本人在“任务接单”详情里会看到“本地 Agent”私有控件。其他开发者只能看到团队可见的认领关系，不会看到认领者本机 Bridge 状态。

本地 Agent 控件支持：

- 检测 `OPC Codex Bridge` 是否在线，并读取 `ready/codex` 预检状态。
- 生成并复制 `Bridge Launch Package`。
- 启动或续写本地 Codex thread。
- 向 Bridge 发送停止指令。

边界：

- 停止本地 Agent 不释放任务认领；释放仍使用“放弃接单”。
- `threadId` 和本地执行状态只存在浏览器本地存储中。
- Bridge token 只存在当前浏览器会话中，不写入 Dashboard 数据或 Worker。
- 如果 `/health` 不可达，个人页显示 `Bridge 未在线`；如果 `/v1/launch` 返回错误，个人页显示 `启动失败`；启动成功后显示 `已执行`。

## AI 中台薄闭环

“仿真平台”详情栏现在提供第一版最小 AI 中台闭环：

1. 选择一个 UI 模拟器位置。
2. 只填写一句短说明，生成 `Panel Topic`。
3. 服务器中台 AI 优先调用可信服务器上的 ChatGPT-managed Codex 生成类型、模块、推荐仓库、模拟器证据、issue 草稿、验收标准、查重候选和风险门槛；不可用时浏览器使用本地兜底逻辑。
4. `small clear issue` 可直接尝试静默发布；疑似重复、低置信、跨模块或大修改会停在确认发布。
5. 静默发布失败时生成手动 issue 处理包，不进入任务分发。
6. 粘贴手动发布后的 GitHub Issue URL 并校验仓库后，才生成 Formal Task。
7. Formal Task 在“任务接单”中可认领/释放；认领后才显示本地 Agent 启动和处理包导出入口。

边界：

- 面板不显示 AI job、队列、token、模型日志或执行日志。
- 面板不做远程代码执行、测试、PR、合并或部署。
- 本地 Agent 执行仍发生在开发者自己的 Codex 项目线程中。
- 中台 AI 只负责判断、生成、查重和草拟；GitHub 写入必须经过受控动作接口执行。
- 服务器中台 AI 密钥只放在服务器和 Worker secret 中，浏览器只持团队操作口令。
- “中台恢复”只列发布失败、绑定或包生成这类阻断闭环的恢复事项，不是运维台。

## 面板动作接口

`actions-worker/` 是“不要跳转 GitHub”的关键组件。

当前 MVP 使用 Cloudflare Worker 作为受控动作接口：浏览器和中台 AI 都不保存 GitHub 写权限，Worker 按团队口令、actor、允许仓库和动作类型执行有限写入。后续可以替换为自有后台或 GitHub App，但不能退回到浏览器持 token 或 AI 持无限制 token。

它提供：

- `POST /api/discussions`：面板内提交想法、评价、修改请求、问题风险、追加操作链。
- `POST /api/action-check`：无副作用检测动作接口、团队口令和操作者权限。
- `GET /api/development-ai/health`：代理读取服务器中台 AI 运行状态。
- `POST /api/development-ai/topic-draft`：代理调用服务器中台 AI 生成 Panel Topic/issue 草稿。
- `POST /api/final-issues`：从 Panel Topic 静默创建 Final Implementation Issue。
- `POST /api/final-issues/bind`：校验并绑定手动发布后的 GitHub Issue URL。
- `POST /api/issue-command`：面板内接单、放弃、转交、阻塞、等待 PR。
- `GET /api/health`：动作接口健康检查。

需要配置的 Worker Secret：

```powershell
wrangler secret put GITHUB_TOKEN
wrangler secret put DASHBOARD_ACTION_KEY
wrangler secret put DEVELOPMENT_AI_KEY
```

`DEVELOPMENT_AI_KEY` 必须和 `opc-bounty-server` 上的同名环境变量一致。`DEVELOPMENT_AI_BASE_URL` 在 Worker 配置中指向共享服务器的标准 HTTP/HTTPS 入口，例如 `http://124.220.53.97`。

部署后，把 Worker 地址填入 `index.html`：

```html
<meta name="dashboard-action-api" content="https://你的-worker.workers.dev">
```

也可以先在页面顶部“动作接口”输入框手动填写，用于测试。

## 刷新

本地运行：

```powershell
node scripts/collect-status.mjs
```

在自动化流程中运行：

- 如果定时刷新需要读取私有仓库和组织项目看板，需要给本仓库配置 `SHICHAI_READ_TOKEN` 密钥。
- 这个令牌应使用最小权限：只读 `shichai-dev` 的议题和项目看板，不允许写入生产系统。
- 如果 GitHub Actions 中没有 `SHICHAI_READ_TOKEN`，刷新脚本会拒绝覆盖 `data/status.json`，避免把 Dashboard 误刷新成只包含公开仓库的局部快照。

推荐公开讨论标签：

- `dashboard-discussion`
- `dispatch:pending`
- `dispatch:sent`
- `dispatch:blocked`
- `discussion:idea`
- `discussion:evaluation`
- `discussion:change-request`
- `discussion:bug`
- `discussion:handoff`
- `status:accepted`
- `status:stale`
- `status:implemented`
- `status:blocked`

推荐接单标签：

- `接单:待接单`
- `接单:已接单`
- `接单:开发中`
- `接单:等待PR`
- `接单:审查中`
- `接单:阻塞`
- `接单:已关闭`
