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
3. 在右侧讨论栏提交想法、评价、修改请求、问题风险或追加操作链。
4. Dashboard 会先生成一个公开源讨论，并带上 `dispatch:pending`。
5. `discussion-dispatch.yml` 会根据功能编号、界面页面、关键词和分工规则推断目标仓库，并创建目标 Issue。
6. 分发成功后，源讨论下面会写回“已分发目标”，并标记为 `dispatch:sent`。
7. 刷新任务会读取源讨论和目标仓 Issue，并标记为“待智能处理”“已采纳”“已实现”“已过期”或“受阻”。
8. 协调智能体读取 `data/status.json`，重点查看讨论、分发状态和待处理队列，再决定是否进一步拆分实现议题或标记旧评论过期。
9. 代码、议题或评论变化后，下一次刷新会同步更新功能状态、界面页面、操作链、协作交接、讨论数量和接单状态。

页面内嵌快速评论使用代码托管平台的议题评论。正式依赖它之前，需要给 `shichai-dev/feature-dashboard` 安装 `utterances` 应用。结构化公开讨论议题不依赖这个组件。

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
3. 如果任务处于“待接单”，点击“打开 Issue 接单”，在 GitHub Issue 评论区发送：

```txt
/claim
```

4. 接单成功后，系统会把评论人设置为唯一 assignee，并写入接单人、接单时间和初始耗时。
5. 后续可继续在 Issue 评论区发送命令：

```txt
/unclaim
/handoff @用户名
/blocked 原因
/ready-pr
```

6. 下一次 Dashboard 刷新后，页面会同步显示新的负责人、接单状态和已耗时。

当前任务接单面板会汇总 `planning`、`opc-bounty-client`、`opc-bounty-admin`、`opc-bounty-server` 和 `feature-dashboard` 的 Issue。当前仓库已经包含 `.github/workflows/issue-claim.yml`，可处理本仓库 Issue 的 `/claim` 等命令。若要让其他仓库的 Issue 也自动执行接单锁，需要在对应仓库安装同一套工作流，或改为统一 GitHub App / Coordinator 服务集中处理。

## 刷新

本地运行：

```powershell
node scripts/collect-status.mjs
```

在自动化流程中运行：

- 如果定时刷新需要读取私有仓库和组织项目看板，需要给本仓库配置 `SHICHAI_READ_TOKEN` 密钥。
- 这个令牌应使用最小权限：只读 `shichai-dev` 的议题和项目看板，不允许写入生产系统。

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
