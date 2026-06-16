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
4. 刷新任务会读取公开讨论，并标记为“待智能处理”“已采纳”“已实现”“已过期”或“受阻”。
5. 协调智能体读取 `data/status.json`，重点查看讨论和待处理队列，再决定是否汇总、拆分实现议题或标记旧评论过期。
6. 代码、议题或评论变化后，下一次刷新会同步更新功能状态、界面页面、操作链、协作交接和讨论数量。

页面内嵌快速评论使用代码托管平台的议题评论。正式依赖它之前，需要给 `shichai-dev/feature-dashboard` 安装 `utterances` 应用。结构化公开讨论议题不依赖这个组件。

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

当前仓库已经包含 `.github/workflows/issue-claim.yml`，可处理本仓库 Issue 的 `/claim` 等命令。若要让 `opc-bounty-client`、`opc-bounty-admin`、`opc-bounty-server`、`planning` 的 Issue 也自动执行接单锁，需要在对应仓库安装同一套工作流，或改为统一 GitHub App / Coordinator 服务集中处理。

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
