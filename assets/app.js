import {
  bindManualIssueUrl,
  buildAgentHandoffPackageFromTopicTask,
  buildBridgeLaunchPackageFromTopicTask,
  buildFinalIssueRequest,
  buildFormalTaskFromTopic,
  createPanelTopic,
  claimFormalTaskTopic,
  findIssueBackfillCandidates,
  markIssuePublishingFailed,
  markTopicPublished,
  releaseFormalTaskTopic
} from "./ai-middleware.js";

const operatorStorageKey = "shichai-dashboard-operator";
const actionApiStorageKey = "shichai-dashboard-action-api";
const localBridgeSettingsStorageKey = "shichai-dashboard-local-bridge";
const localBridgeTokenStorageKey = "shichai-dashboard-local-bridge-token";
const localBridgeRunsStorageKey = "shichai-dashboard-local-bridge-runs";
const aiMiddlewareStorageKey = "shichai-dashboard-ai-middleware";
const defaultActionApiBase = document.querySelector('meta[name="dashboard-action-api"]')?.content?.trim() || "";
const defaultBridgeBase = document.querySelector('meta[name="opc-bridge-url"]')?.content?.trim() || "http://127.0.0.1:17653";

function loadOperatorIdentity() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(operatorStorageKey) || "{}");
    return {
      login: saved.login || "",
      actionKey: saved.actionKey || ""
    };
  } catch {
    return { login: "", actionKey: "" };
  }
}

function loadActionApiBase() {
  return localStorage.getItem(actionApiStorageKey) || defaultActionApiBase || "";
}

function loadLocalBridge() {
  try {
    const saved = JSON.parse(localStorage.getItem(localBridgeSettingsStorageKey) || "{}");
    return {
      baseUrl: saved.baseUrl || defaultBridgeBase,
      token: sessionStorage.getItem(localBridgeTokenStorageKey) || "",
      health: null,
      busy: false,
      message: null,
      runs: loadLocalBridgeRuns()
    };
  } catch {
    return {
      baseUrl: defaultBridgeBase,
      token: "",
      health: null,
      busy: false,
      message: null,
      runs: {}
    };
  }
}

function loadLocalBridgeRuns() {
  try {
    return JSON.parse(localStorage.getItem(localBridgeRunsStorageKey) || "{}");
  } catch {
    return {};
  }
}

function loadAiMiddlewareState() {
  try {
    const saved = JSON.parse(localStorage.getItem(aiMiddlewareStorageKey) || "{}");
    return {
      topics: Array.isArray(saved.topics) ? saved.topics : [],
      selectedTopicId: saved.selectedTopicId || "",
      message: null,
      busy: false
    };
  } catch {
    return {
      topics: [],
      selectedTopicId: "",
      message: null,
      busy: false
    };
  }
}

const state = {
  data: null,
  activeTab: "studio",
  query: "",
  status: "all",
  selectedId: null,
  selectedIssueId: null,
  selectedPageId: null,
  selectedTargetId: null,
  chainDrawerOpen: false,
  evaluationOpen: false,
  operator: loadOperatorIdentity(),
  actionApiBase: loadActionApiBase(),
  localBridge: loadLocalBridge(),
  aiMiddleware: loadAiMiddlewareState(),
  actionBusy: false,
  actionMessage: null,
  actionHealth: null
};

const statusLabels = {
  implemented: "已实现",
  "in-progress": "进行中",
  planned: "计划中",
  blocked: "受阻"
};

const statusClass = {
  implemented: "status-implemented",
  "in-progress": "status-in-progress",
  planned: "status-planned",
  blocked: "status-blocked"
};

const discussionLabels = {
  idea: "想法",
  evaluation: "评价",
  "change-request": "修改请求",
  handoff: "协作交接",
  bug: "问题风险"
};

const lifecycleLabels = {
  "needs-ai-review": "待智能处理",
  accepted: "已采纳",
  implemented: "已实现",
  stale: "已过期",
  blocked: "受阻"
};

const claimLabels = {
  open: "待接单",
  claimed: "已接单",
  "in-progress": "开发中",
  "waiting-pr": "等待 PR",
  reviewing: "审查中",
  blocked: "阻塞",
  closed: "已关闭"
};

const byId = (id) => document.getElementById(id);

function normalize(value) {
  return String(value || "").toLowerCase();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function actionApiBase() {
  return String(state.actionApiBase || "").trim().replace(/\/+$/, "");
}

function setActionMessage(type, text) {
  state.actionMessage = text ? { type, text } : null;
  renderOperatorPanel();
}

function saveOperatorIdentity(login, actionKey, apiBase) {
  state.operator = { login: login.trim(), actionKey };
  state.actionApiBase = apiBase.trim();
  sessionStorage.setItem(operatorStorageKey, JSON.stringify(state.operator));
  if (state.actionApiBase) {
    localStorage.setItem(actionApiStorageKey, state.actionApiBase);
  } else {
    localStorage.removeItem(actionApiStorageKey);
  }
  setActionMessage("success", "已保存面板操作身份。");
}

function readOperatorInputs() {
  return {
    login: byId("operator-login")?.value || "",
    actionKey: byId("operator-key")?.value || "",
    apiBase: byId("operator-api")?.value || ""
  };
}

function actionNetworkErrorText(error) {
  const raw = error?.message || String(error || "");
  if (/failed to fetch|load failed|networkerror|blocked|cors/i.test(raw)) {
    return "动作接口不可达。可能是 URL 错误、浏览器或网络拦截 workers.dev、或 CORS 未允许当前面板来源；测试时可临时改用 http://127.0.0.1:8787 本地 Worker。";
  }
  return raw || "动作接口检测失败。";
}

async function checkActionApiHealth() {
  if (state.actionBusy) return;
  const current = readOperatorInputs();
  saveOperatorIdentity(current.login, current.actionKey, current.apiBase);
  if (!actionApiBase()) {
    setActionMessage("error", "请先填写动作接口地址。");
    return;
  }
  state.actionBusy = true;
  state.actionHealth = {
    status: "checking",
    endpoint: actionApiBase(),
    checkedAt: new Date().toISOString()
  };
  setActionMessage("pending", "正在检测动作接口...");
  renderOperatorPanel();
  try {
    const healthResponse = await fetch(`${actionApiBase()}/api/health`);
    const health = await healthResponse.json().catch(() => ({}));
    if (!healthResponse.ok || !health.ok) {
      throw new Error(health.message || `健康检查返回 ${healthResponse.status}`);
    }
    if (state.operator.login?.trim() && state.operator.actionKey) {
      const auth = await postDashboardAction("/api/action-check", {});
      state.actionHealth = {
        status: "ok",
        endpoint: actionApiBase(),
        service: auth.service || health.service || "shichai-dashboard-actions",
        actor: auth.actor || state.operator.login.trim(),
        checkedAt: new Date().toISOString()
      };
      setActionMessage("success", auth.message || "动作接口、口令和操作者权限检测通过。");
    } else {
      state.actionHealth = {
        status: "partial",
        endpoint: actionApiBase(),
        service: health.service || "shichai-dashboard-actions",
        checkedAt: new Date().toISOString()
      };
      setActionMessage("success", "动作接口在线。填写 GitHub 用户名和团队操作口令后，可继续验证权限。");
    }
  } catch (error) {
    state.actionHealth = {
      status: "error",
      endpoint: actionApiBase(),
      error: actionNetworkErrorText(error),
      checkedAt: new Date().toISOString()
    };
    setActionMessage("error", state.actionHealth.error);
  } finally {
    state.actionBusy = false;
    renderAll();
  }
}

function requireActionIdentity() {
  if (!actionApiBase()) {
    throw new Error("请先填写动作接口地址。部署 actions-worker 后，把 Worker 地址填到这里。");
  }
  if (!state.operator.login?.trim()) {
    throw new Error("请先填写你的 GitHub 用户名，用于接单归属。");
  }
  if (!state.operator.actionKey) {
    throw new Error("请先填写团队操作口令。");
  }
}

async function postDashboardAction(path, payload) {
  requireActionIdentity();
  const response = await fetch(`${actionApiBase()}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-shichai-action-key": state.operator.actionKey
    },
    body: JSON.stringify({
      ...payload,
      actor: state.operator.login.trim()
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || data.error || `动作接口返回 ${response.status}`);
  }
  return data;
}

function saveAiMiddlewareState() {
  localStorage.setItem(aiMiddlewareStorageKey, JSON.stringify({
    topics: state.aiMiddleware.topics || [],
    selectedTopicId: state.aiMiddleware.selectedTopicId || ""
  }));
}

function setAiMiddlewareMessage(type, text) {
  state.aiMiddleware.message = text ? { type, text } : null;
}

function updatePanelTopic(topic) {
  const topics = state.aiMiddleware.topics || [];
  const index = topics.findIndex((item) => item.id === topic.id);
  if (index >= 0) {
    topics[index] = topic;
  } else {
    topics.unshift(topic);
  }
  state.aiMiddleware.topics = topics;
  state.aiMiddleware.selectedTopicId = topic.id;
  saveAiMiddlewareState();
}

function removePublishedDuplicates(tasks) {
  const seen = new Set();
  return tasks.filter((task) => {
    const key = task.url || task.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function middlewareTasks() {
  const existingUrls = new Set((state.data?.issueTasks || []).map((task) => task.url));
  return (state.aiMiddleware.topics || [])
    .map(buildFormalTaskFromTopic)
    .filter(Boolean)
    .filter((task) => !existingUrls.has(task.url));
}

function topicById(topicId) {
  return (state.aiMiddleware.topics || []).find((topic) => topic.id === topicId) || null;
}

function topicsForTarget(target = currentTarget()) {
  if (!target) return [];
  return (state.aiMiddleware.topics || [])
    .filter((topic) => topic.simulatorEvidence?.targetId === target.id)
    .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
}

function selectedTopicForTarget(target = currentTarget()) {
  const topics = topicsForTarget(target);
  return topics.find((topic) => topic.id === state.aiMiddleware.selectedTopicId) || topics[0] || null;
}

function healthItems() {
  return (state.aiMiddleware.topics || [])
    .filter((topic) => topic.health)
    .map((topic) => ({ ...topic.health, topicId: topic.id, title: topic.issueDraft?.title || topic.note }));
}

async function runPanelAction(actionName, request) {
  if (state.actionBusy) return;
  state.actionBusy = true;
  setActionMessage("pending", `${actionName}提交中...`);
  try {
    const data = await request();
    setActionMessage("success", data.message || `${actionName}已提交，系统会自动同步看板。`);
    return data;
  } catch (error) {
    setActionMessage("error", error.message || `${actionName}失败。`);
    return null;
  } finally {
    state.actionBusy = false;
    renderAll();
  }
}

function bridgeBaseUrl() {
  return String(state.localBridge.baseUrl || defaultBridgeBase).trim().replace(/\/+$/, "");
}

function saveLocalBridgeSettings(baseUrl, token) {
  state.localBridge.baseUrl = (baseUrl || defaultBridgeBase).trim();
  state.localBridge.token = token || "";
  localStorage.setItem(localBridgeSettingsStorageKey, JSON.stringify({ baseUrl: state.localBridge.baseUrl }));
  sessionStorage.setItem(localBridgeTokenStorageKey, state.localBridge.token);
  setLocalBridgeMessage("success", "本地 Bridge 设置已保存。");
}

function saveLocalBridgeRuns() {
  localStorage.setItem(localBridgeRunsStorageKey, JSON.stringify(state.localBridge.runs || {}));
}

function setLocalBridgeMessage(type, text, taskId = "") {
  state.localBridge.message = text ? { type, text, taskId } : null;
}

function localBridgeRun(task) {
  return state.localBridge.runs?.[task.id] || null;
}

function updateLocalBridgeRun(task, patch) {
  state.localBridge.runs = {
    ...(state.localBridge.runs || {}),
    [task.id]: {
      ...(state.localBridge.runs?.[task.id] || {}),
      ...patch,
      updatedAt: new Date().toISOString()
    }
  };
  saveLocalBridgeRuns();
}

function localBridgeHeaders(includeJson = false) {
  const headers = {};
  if (includeJson) headers["content-type"] = "application/json";
  if (state.localBridge.token) headers.authorization = `Bearer ${state.localBridge.token}`;
  return headers;
}

async function fetchLocalBridge(path, options = {}) {
  const response = await fetch(`${bridgeBaseUrl()}${path}`, {
    ...options,
    headers: {
      ...localBridgeHeaders(Boolean(options.body)),
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.error?.message || data.message || `Bridge 返回 ${response.status}`;
    const error = new Error(message);
    error.code = data.error?.code || "BRIDGE_REQUEST_FAILED";
    error.details = data.error?.details || data;
    throw error;
  }
  return data;
}

async function checkLocalBridgeHealth() {
  if (state.localBridge.busy) return;
  state.localBridge.busy = true;
  setLocalBridgeMessage("pending", "正在检测本地 Bridge...");
  try {
    const health = await fetchLocalBridge("/health");
    state.localBridge.health = {
      reachable: true,
      ...health
    };
    setLocalBridgeMessage(
      health.ready ? "success" : "error",
      health.ready ? "Bridge 已在线，Codex runtime 已就绪。" : bridgeOnboardingText(health.codex)
    );
  } catch (error) {
    state.localBridge.health = {
      reachable: false,
      error: error.message
    };
    setLocalBridgeMessage("error", "Bridge 未在线。请先启动桌面上的 OPC Codex Bridge。");
  } finally {
    state.localBridge.busy = false;
    renderAll();
  }
}

async function launchLocalAgent(task) {
  if (state.localBridge.busy) return;
  state.localBridge.busy = true;
  setLocalBridgeMessage("pending", "正在启动本地 Agent...", task.id);
  renderAll();
  try {
    const launchPackage = buildBridgeLaunchPackage(task);
    const result = await fetchLocalBridge("/v1/launch", {
      method: "POST",
      body: JSON.stringify(launchPackage)
    });
    updateLocalBridgeRun(task, {
      status: "executed",
      threadId: result.threadId || launchPackage.threadId || "",
      turnId: result.turnId || "",
      cwd: result.cwd || "",
      lastLaunchAt: new Date().toISOString(),
      lastError: ""
    });
    setLocalBridgeMessage("success", "本地 Agent 已执行。停止不会释放任务认领。", task.id);
  } catch (error) {
    updateLocalBridgeRun(task, {
      status: "failed",
      lastError: bridgeErrorText(error),
      lastFailureAt: new Date().toISOString()
    });
    setLocalBridgeMessage("error", bridgeErrorText(error), task.id);
  } finally {
    state.localBridge.busy = false;
    renderAll();
  }
}

async function stopLocalAgent(task) {
  if (state.localBridge.busy) return;
  state.localBridge.busy = true;
  setLocalBridgeMessage("pending", "正在向 Bridge 发送停止指令...", task.id);
  renderAll();
  try {
    const result = await fetchLocalBridge("/v1/stop", {
      method: "POST",
      body: JSON.stringify({ taskId: task.id })
    });
    updateLocalBridgeRun(task, {
      status: "executed",
      stoppedAt: new Date().toISOString(),
      stopResult: result.status || (result.stopped ? "stopped" : "not_found")
    });
    setLocalBridgeMessage(
      result.stopped ? "success" : "error",
      result.stopped ? "已发送停止指令。任务认领未释放。" : "Bridge 没找到正在运行的本地 Agent；任务认领未释放。",
      task.id
    );
  } catch (error) {
    setLocalBridgeMessage("error", bridgeErrorText(error), task.id);
  } finally {
    state.localBridge.busy = false;
    renderAll();
  }
}

async function copyBridgeLaunchPackage(task) {
  const launchPackage = buildBridgeLaunchPackage(task);
  const text = JSON.stringify(launchPackage, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    setLocalBridgeMessage("success", "Bridge Launch Package 已复制。", task.id);
  } catch {
    setLocalBridgeMessage("error", "浏览器不允许写入剪贴板，请使用启动按钮或手动导出。", task.id);
  }
  renderAll();
}

function bridgeErrorText(error) {
  if (error.code === "CODEX_RUNTIME_NOT_READY") {
    return bridgeOnboardingText(error.details?.codex) || error.message;
  }
  if (error.code === "WORKSPACE_NOT_FOUND") {
    return "本地未找到对应仓库。请先确认项目已拉取，或后续使用仓库准备流程。";
  }
  if (error.code === "UNAUTHORIZED") {
    return "Bridge token 不正确。请打开本地 Bridge 目录的 .env 核对 OPC_BRIDGE_TOKEN。";
  }
  return error.message || "本地 Bridge 启动失败。";
}

function bridgeOnboardingText(codex) {
  const action = codex?.onboarding?.[0];
  if (action?.description) return action.description;
  if (codex?.runtime?.status === "missing") return "Codex runtime 未安装或不可调用。请安装 Codex 并完成 App 登录。";
  if (codex?.auth?.status === "login_required") return "Codex 尚未登录。请打开 Codex App 完成 ChatGPT 登录后重试。";
  return "Codex runtime 尚未就绪。";
}

function buildBridgeLaunchPackage(task) {
  const topic = task.panelTopicId ? topicById(task.panelTopicId) : null;
  if (topic) {
    const run = localBridgeRun(task);
    return buildBridgeLaunchPackageFromTopicTask(task, topic, {
      claimant: task.claimant || state.operator.login.trim(),
      threadId: run?.threadId || undefined
    });
  }
  const run = localBridgeRun(task);
  const module = inferTaskModule(task);
  return {
    taskId: task.id,
    issueUrl: task.url,
    title: task.title,
    goal: buildTaskGoal(task),
    claimant: task.claimant || state.operator.login.trim(),
    module,
    recommendedRepo: task.repo,
    threadId: run?.threadId || undefined,
    handoffPackage: buildAgentHandoffPackage(task, module),
    permissionEnvelope: buildPermissionEnvelope(task, module)
  };
}

function buildTaskGoal(task) {
  return [
    `处理已认领的 Final Implementation Issue：${task.title}`,
    `仓库：${task.repo}`,
    `Issue：${task.url}`,
    `总问题：${task.totalProblem || "未归属父问题"}`,
    "完成后提供修改摘要、验证证据和后续风险。"
  ].join("\n");
}

function buildAgentHandoffPackage(task, module) {
  return {
    source: "feature-dashboard",
    generatedAt: new Date().toISOString(),
    task: {
      id: task.id,
      issueUrl: task.url,
      repo: task.repo,
      number: task.number,
      title: task.title,
      labels: task.labels || [],
      lane: task.lane || "",
      status: task.status,
      claimant: task.claimant || "",
      claimedAt: task.claimedAt || ""
    },
    module,
    parentFeature: task.parentFeature || null,
    parentIssue: task.parentIssue || null,
    totalProblem: task.totalProblem || "",
    acceptance: [
      "只处理这个已认领 Issue 的具体目标。",
      "保留 GitHub Issue/PR/Project 作为事实源。",
      "不要自动合并、部署或发布生产变更。",
      "如果发现任务跨出当前模块边界，在 Codex 线程里明确说明并等待开发者判断。"
    ],
    verification: [
      "优先运行仓库已有的最小相关测试或语法检查。",
      "如涉及前端界面，提供可复现页面/流程和截图或手动验证说明。",
      "在最终回复中说明改动文件、验证命令、未覆盖风险。"
    ]
  };
}

function buildPermissionEnvelope(task, module) {
  return {
    codex: {
      developerInstructions: [
        `Bound OPC task: ${task.id}`,
        `Module scope: ${module}`,
        "Do not merge, deploy, release, or change production credentials.",
        "Use the checked-out repository bound by the bridge. Do not work in unrelated local projects.",
        "If the task needs broader permissions, explain that in the Codex thread and wait for the developer to steer."
      ].join("\n")
    }
  };
}

function inferTaskModule(task) {
  const repo = String(task.repoName || task.repo || "").toLowerCase();
  const lane = String(task.lane || "").toLowerCase();
  if (repo.includes("opc-bounty-client") || lane.includes("client")) return "client frontend";
  if (repo.includes("opc-bounty-admin") || lane.includes("admin")) return "admin frontend";
  if (repo.includes("opc-bounty-server") || lane.includes("server") || lane.includes("database")) return "backend";
  if (repo.includes("feature-dashboard") || lane.includes("dashboard")) return "dashboard";
  if (lane.includes("qa")) return "qa-release";
  return "architecture";
}

function isTaskClaimedByOperator(task) {
  const operator = state.operator.login?.trim().toLowerCase();
  return Boolean(operator && task.claimant?.toLowerCase() === operator);
}

function matchesFeature(feature) {
  const query = normalize(state.query);
  const statusOk = state.status === "all" || feature.status === state.status;
  const haystack = [
    feature.title,
    feature.summary,
    feature.repo,
    feature.lane,
    feature.verification,
    feature.discussion?.latestTitle,
    ...(feature.discussion?.signals || []).map((discussion) => `${discussion.title} ${discussion.preview}`),
    ...(feature.uiSurfaces || []).map((surface) => surface.name),
    ...(feature.operationChain || [])
  ].join(" ");
  return statusOk && (!query || normalize(haystack).includes(query));
}

function filteredFeatures() {
  return (state.data?.features || []).filter(matchesFeature);
}

function statusPill(status) {
  const safeStatus = status || "planned";
  return `<span class="status-pill ${statusClass[safeStatus] || statusClass.planned}">${statusLabels[safeStatus] || safeStatus}</span>`;
}

function claimPill(status) {
  const safeStatus = status || "open";
  return `<span class="claim-pill claim-${escapeHtml(safeStatus)}">${escapeHtml(claimLabels[safeStatus] || safeStatus)}</span>`;
}

function formatDateTime(value) {
  if (!value) return "未记录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未记录";
  return date.toLocaleString();
}

function formatElapsedHours(hours, startedAt, endedAt = null) {
  if (!startedAt) return "未开始";
  let value = Number(hours);
  if (!Number.isFinite(value) && startedAt) {
    const start = new Date(startedAt).getTime();
    const end = endedAt ? new Date(endedAt).getTime() : Date.now();
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      value = Math.round(((end - start) / 36e5) * 10) / 10;
    }
  }
  if (!Number.isFinite(value)) return "未开始";
  if (value < 1) return `${Math.round(value * 60)} 分钟`;
  if (value < 24) return `${value} 小时`;
  return `${Math.round((value / 24) * 10) / 10} 天`;
}

function issueTasks() {
  return removePublishedDuplicates([...(state.data?.issueTasks || []), ...middlewareTasks()]);
}

function currentIssueTask() {
  return issueTasks().find((task) => task.id === state.selectedIssueId) || issueTasks()[0] || null;
}

function issueTasksByStatus() {
  const groups = [
    { id: "open", title: "待接单", tasks: [] },
    { id: "claimed", title: "已接单", tasks: [] },
    { id: "in-progress", title: "开发中", tasks: [] },
    { id: "waiting", title: "等待 PR / 审查", tasks: [] },
    { id: "blocked", title: "阻塞", tasks: [] },
    { id: "closed", title: "已关闭", tasks: [] }
  ];
  const groupById = new Map(groups.map((group) => [group.id, group]));
  for (const task of issueTasks()) {
    if (task.status === "waiting-pr" || task.status === "reviewing") {
      groupById.get("waiting").tasks.push(task);
    } else if (groupById.has(task.status)) {
      groupById.get(task.status).tasks.push(task);
    } else {
      groupById.get("open").tasks.push(task);
    }
  }
  return groups;
}

function studio() {
  return state.data?.operationStudio || null;
}

function studioPages() {
  return studio()?.pages || [];
}

function studioChains() {
  return studio()?.chains || [];
}

function currentPage() {
  const pages = studioPages();
  const defaultPageId = studio()?.defaultPageId || pages[0]?.id;
  return pages.find((page) => page.id === state.selectedPageId) || pages.find((page) => page.id === defaultPageId) || pages[0] || null;
}

function featureById(featureId) {
  return (state.data?.features || []).find((feature) => feature.id === featureId) || null;
}

function pageTargets(page = currentPage()) {
  if (!page) return [];
  const sectionItems = (page.sections || []).flatMap((section) =>
    (section.items || []).map((item) => ({
      ...item,
      source: "section",
      sectionTitle: section.title,
      uiSurface: page.uiSurface
    }))
  );
  const hotspots = (page.hotspots || []).map((hotspot) => ({
    ...hotspot,
    source: "hotspot",
    uiSurface: page.uiSurface
  }));
  return [...sectionItems, ...hotspots];
}

function currentTarget() {
  const targets = pageTargets();
  return targets.find((target) => target.id === state.selectedTargetId) || targets[0] || null;
}

function discussionsForTarget(target = currentTarget()) {
  if (!target) return [];
  return (state.data?.discussions || []).filter((discussion) =>
    discussion.hotspotId === target.id ||
    discussion.operationStepId === target.stepId ||
    discussion.featureId === target.featureId
  );
}

function discussionCountForTarget(target) {
  return discussionsForTarget(target).filter((discussion) => discussion.state !== "CLOSED").length;
}

function chainsForPage(page = currentPage()) {
  if (!page) return [];
  return studioChains().filter((chain) => (chain.pageIds || []).includes(page.id));
}

function chainsForTarget(target = currentTarget()) {
  if (!target) return [];
  return studioChains().filter((chain) =>
    chain.featureId === target.featureId ||
    (chain.steps || []).some((step) => step.id === target.stepId)
  );
}

function pageTitleById(pageId) {
  return studioPages().find((page) => page.id === pageId)?.title || pageId || "页面";
}

function buildTargetDiscussionPayload(target, type = "idea", titleInput = "", bodyInput = "") {
  const page = currentPage();
  const feature = featureById(target?.featureId);
  const typeLabel = discussionLabels[type] || "想法";
  return {
    type,
    title: `[${typeLabel}][${target?.featureId || "未映射"}] ${titleInput || target?.label || "平台界面讨论"}`,
    body: bodyInput || "",
    featureId: target?.featureId || "",
    featureTitle: feature?.title || target?.featureId || "",
    uiSurface: target?.uiSurface || page?.uiSurface || "",
    operationStepId: target?.stepId || "",
    hotspotId: target?.id || "",
    pageTitle: page?.title || "",
    targetLabel: target?.label || "",
    targetSummary: target?.summary || page?.summary || ""
  };
}

function buildFeatureDiscussionPayload(feature, type = "idea", titleInput = "", bodyInput = "") {
  return {
    type,
    title: `[${discussionLabels[type] || "想法"}][${feature.id}] ${titleInput || feature.title}`,
    body: bodyInput || "",
    featureId: feature.id,
    featureTitle: feature.title,
    uiSurface: (feature.uiSurfaces || []).map((surface) => surface.name).join("、"),
    operationStepId: "",
    hotspotId: "",
    pageTitle: "功能地图",
    targetLabel: feature.title,
    targetSummary: feature.summary || ""
  };
}

async function submitTargetDiscussion(target, type, title, body) {
  await runPanelAction("讨论", async () => postDashboardAction("/api/discussions", buildTargetDiscussionPayload(target, type, title, body)));
}

async function submitFeatureDiscussion(feature, type, title, body) {
  await runPanelAction("讨论", async () => postDashboardAction("/api/discussions", buildFeatureDiscussionPayload(feature, type, title, body)));
}

function buildPanelTopicInput(note, target) {
  const page = currentPage();
  const feature = featureById(target?.featureId);
  return {
    note,
    target,
    page,
    feature,
    discussions: state.data?.discussions || [],
    issueTasks: issueTasks(),
    now: new Date().toISOString()
  };
}

function markBrowserTopicFallback(topic, error = null) {
  return {
    ...topic,
    coordinator: {
      ...(topic.coordinator || {}),
      source: "browser-fallback",
      provider: "local-deterministic",
      generatedAt: topic.createdAt,
      error: error?.message || ""
    }
  };
}

async function createCurrentPanelTopic(target) {
  if (state.aiMiddleware.busy) return;
  const note = byId("panel-topic-note")?.value?.trim() || "";
  state.aiMiddleware.busy = true;
  setAiMiddlewareMessage("pending", "正在请求服务器中台 AI 生成 Panel Topic...");
  renderAll();
  try {
    const input = buildPanelTopicInput(note, target);
    let topic = null;
    let usedServerAi = false;
    if (actionApiBase() && state.operator.login?.trim() && state.operator.actionKey) {
      try {
        const result = await postDashboardAction("/api/development-ai/topic-draft", input);
        topic = result.topic;
        if (!topic?.issueDraft?.title || !topic?.riskGate?.decision) {
          throw new Error("服务器中台 AI 返回内容不完整。");
        }
        usedServerAi = true;
      } catch (error) {
        topic = markBrowserTopicFallback(createPanelTopic(input), error);
      }
    } else {
      topic = markBrowserTopicFallback(createPanelTopic(input));
    }
    updatePanelTopic(topic);
    setAiMiddlewareMessage(
      usedServerAi ? "success" : "error",
      usedServerAi
        ? "服务器中台 AI 已生成 topic、issue 草稿、查重和风险门槛。"
        : "服务器中台 AI 不可用或未配置权限，已使用本地兜底生成 Topic；发布前请确认。"
    );
  } catch (error) {
    setAiMiddlewareMessage("error", error.message || "Panel Topic 生成失败。");
  } finally {
    state.aiMiddleware.busy = false;
    renderAll();
  }
}

async function publishPanelTopic(topicId) {
  if (state.aiMiddleware.busy) return;
  const topic = topicById(topicId);
  if (!topic) return;
  state.aiMiddleware.busy = true;
  setAiMiddlewareMessage("pending", "正在静默发布 Final Implementation Issue...");
  renderAll();
  try {
    const result = await postDashboardAction("/api/final-issues", buildFinalIssueRequest(topic));
    const issue = result.issue || result;
    updatePanelTopic(markTopicPublished(topic, {
      repo: issue.repo || topic.issueDraft.repo,
      number: issue.number,
      url: issue.url || issue.html_url,
      title: issue.title || topic.issueDraft.title
    }));
    setAiMiddlewareMessage("success", "Final Implementation Issue 已发布并进入任务分发。");
  } catch (error) {
    updatePanelTopic(markIssuePublishingFailed(topic, error));
    setAiMiddlewareMessage("error", "静默发布失败，已生成手动发布包。绑定 GitHub Issue URL 后才会进入任务分发。");
  } finally {
    state.aiMiddleware.busy = false;
    renderAll();
  }
}

async function bindPanelTopicIssueUrl(topicId) {
  const topic = topicById(topicId);
  if (!topic) return;
  const url = byId(`manual-issue-url-${topic.id}`)?.value?.trim() || "";
  if (!url) {
    setAiMiddlewareMessage("error", "请粘贴手动发布后的 GitHub Issue URL。");
    renderAll();
    return;
  }
  state.aiMiddleware.busy = true;
  setAiMiddlewareMessage("pending", "正在校验并绑定 GitHub Issue URL...");
  renderAll();
  try {
    let issue = {};
    if (actionApiBase() && state.operator.actionKey) {
      const result = await postDashboardAction("/api/final-issues/bind", {
        topicId: topic.id,
        expectedRepo: topic.issueDraft.repo,
        expectedTitle: topic.issueDraft.title,
        url
      });
      issue = result.issue || {};
    }
    updatePanelTopic(bindManualIssueUrl(topic, url, issue));
    setAiMiddlewareMessage("success", "手动 Issue 已绑定，任务已进入任务分发。");
  } catch (error) {
    setAiMiddlewareMessage("error", error.message || "Issue URL 绑定失败。");
  } finally {
    state.aiMiddleware.busy = false;
    renderAll();
  }
}

async function bindPanelTopicCandidate(topicId, candidateUrl) {
  const topic = topicById(topicId);
  if (!topic) return;
  try {
    const candidate = findIssueBackfillCandidates(topic, issueTasks()).find((item) => item.url === candidateUrl);
    if (!candidate) throw new Error("候选 Issue 不在当前可绑定列表中。");
    updatePanelTopic(bindManualIssueUrl(topic, candidate.url, { title: candidate.title }));
    setAiMiddlewareMessage("success", "已绑定候选 Issue，任务已进入任务分发。");
  } catch (error) {
    setAiMiddlewareMessage("error", error.message || "候选 Issue 绑定失败。");
  }
  renderAll();
}

async function copyTopicIssuePackage(topicId) {
  const topic = topicById(topicId);
  if (!topic) return;
  const payload = topic.manualFallback || {
    title: topic.issueDraft.title,
    body: topic.issueDraft.body,
    repo: topic.issueDraft.repo,
    context: {
      topicId: topic.id,
      module: topic.module,
      evidence: topic.simulatorEvidence,
      riskGate: topic.riskGate
    }
  };
  try {
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    setAiMiddlewareMessage("success", "Issue 处理包已复制。");
  } catch {
    setAiMiddlewareMessage("error", "浏览器不允许写入剪贴板，请手动选择标题和正文。");
  }
  renderAll();
}

async function continueTopicDiscussion(topicId) {
  const topic = topicById(topicId);
  if (!topic) return;
  const target = currentTarget();
  await submitTargetDiscussion(
    target,
    topic.topicType,
    topic.issueDraft.title.replace(/^\[[^\]]+\]\[[^\]]+\]\s*/, ""),
    [
      topic.note,
      "",
      "AI 生成草稿:",
      topic.issueDraft.body,
      "",
      "风险门槛:",
      topic.riskGate.reasons.length ? topic.riskGate.reasons.map((reason) => `- ${reason}`).join("\n") : "- small clear issue"
    ].join("\n")
  );
}

function renderMetrics() {
  const metrics = state.data?.metrics || {};
  const healthCount = healthItems().length;
  byId("metrics").innerHTML = [
    ["待接单", metrics.openIssueTasks || 0],
    ["已接单", metrics.claimedIssueTasks || 0],
    ["等待 PR", metrics.waitingPrIssueTasks || 0],
    ["开放讨论", metrics.openDiscussions || 0],
    ["中台恢复", healthCount]
  ]
    .map(([label, value]) => `
      <article class="metric">
        <span>${label}</span>
        <strong>${value}</strong>
      </article>
    `)
    .join("");
}

function renderOperatorPanel() {
  const root = byId("operator-panel");
  if (!root) return;
  const message = state.actionMessage
    ? `<div class="operator-message message-${escapeHtml(state.actionMessage.type)}">${escapeHtml(state.actionMessage.text)}</div>`
    : "";
  const health = state.actionHealth;
  const healthHtml = health ? `
    <div class="action-health action-health-${escapeHtml(health.status)}">
      <span>${escapeHtml(actionHealthLabel(health.status))}</span>
      <strong>${escapeHtml(health.actor ? `@${health.actor}` : health.service || "动作接口")}</strong>
      <small>${escapeHtml(health.error || health.endpoint || "")}</small>
    </div>
  ` : "";
  root.innerHTML = `
    <div class="operator-copy">
      <strong>面板内接单和评价</strong>
      <span>填写一次身份后，评价、发布 issue、接单、转交和状态更新都会直接在面板内提交。先检测接口可减少发布时的失败。</span>
    </div>
    <div class="operator-form">
      <label>
        <span>GitHub 用户名</span>
        <input id="operator-login" type="text" autocomplete="username" value="${escapeHtml(state.operator.login)}" placeholder="例如 sexymonk">
      </label>
      <label>
        <span>团队操作口令</span>
        <input id="operator-key" type="password" autocomplete="current-password" value="${escapeHtml(state.operator.actionKey)}" placeholder="由团队负责人提供">
      </label>
      <label>
        <span>动作接口</span>
        <input id="operator-api" type="url" value="${escapeHtml(state.actionApiBase)}" placeholder="https://...workers.dev">
      </label>
      <div class="operator-actions">
        <button type="button" id="save-operator" ${state.actionBusy ? "disabled" : ""}>保存</button>
        <button type="button" id="check-action-api" ${state.actionBusy ? "disabled" : ""}>检测接口</button>
      </div>
    </div>
    ${healthHtml}
    ${message}
  `;
  byId("save-operator")?.addEventListener("click", () => {
    const current = readOperatorInputs();
    saveOperatorIdentity(current.login, current.actionKey, current.apiBase);
  });
  byId("check-action-api")?.addEventListener("click", checkActionApiHealth);
}

function actionHealthLabel(status) {
  if (status === "ok") return "动作接口可用";
  if (status === "partial") return "接口在线";
  if (status === "checking") return "检测中";
  return "接口异常";
}

function renderStudioNav(pages, activePage) {
  return `
    <aside class="sim-sidebar" aria-label="模拟平台导航">
      <div class="sim-brand">
        <span>拾柴</span>
        <div>
          <strong>拾柴</strong>
          <small>共创平台</small>
        </div>
      </div>
      <nav class="sim-nav">
        ${pages
          .map((page) => `
            <button type="button" class="${page.id === activePage?.id ? "active" : ""}" data-page-id="${escapeHtml(page.id)}">
              <span class="sim-nav-icon">${escapeHtml(page.title.slice(0, 1))}</span>
              <span>${escapeHtml(page.title)}</span>
            </button>
          `)
          .join("")}
      </nav>
      <div class="sim-health">环境确认 · 已连接</div>
    </aside>
  `;
}

function renderHotspotButton(target, label = "") {
  const count = discussionCountForTarget(target);
  const selected = target.id === state.selectedTargetId;
  return `
    <button type="button" class="hotspot-pin ${selected ? "is-selected" : ""}" data-target-id="${escapeHtml(target.id)}" aria-label="评论 ${escapeHtml(label || target.label)}">
      <span>+</span>
      ${count ? `<strong>${count}</strong>` : ""}
    </button>
  `;
}

function renderStudioSection(section, page) {
  const items = section.items || [];
  if (section.variant === "hero") {
    return `
      <section class="sim-card sim-hero">
        <span class="state-pill">社区工作流</span>
        <h3>${escapeHtml(section.description || section.title)}</h3>
        <div class="sim-action-grid">
          ${items.map((item) => renderStudioAction(item, page, "large")).join("")}
        </div>
      </section>
    `;
  }
  if (section.variant === "filters" || section.variant === "tabs") {
    return `
      <section class="sim-card">
        <div class="sim-section-head">
          <h3>${escapeHtml(section.title)}</h3>
          <span>${escapeHtml(section.description || "")}</span>
        </div>
        <div class="sim-segment-grid">
          ${items.map((item, index) => renderStudioAction(item, page, index === 0 ? "active" : "segmented")).join("")}
        </div>
      </section>
    `;
  }
  if (section.variant === "list") {
    return `
      <section class="sim-card">
        <div class="sim-section-head">
          <h3>${escapeHtml(section.title)}</h3>
          <span>${escapeHtml(section.description || "")}</span>
        </div>
        <div class="sim-list">
          ${items.map((item, index) => renderStudioListItem(item, page, index + 1)).join("")}
        </div>
      </section>
    `;
  }
  if (section.variant === "form") {
    return `
      <section class="sim-card">
        <div class="sim-section-head">
          <h3>${escapeHtml(section.title)}</h3>
          <span>${escapeHtml(section.description || "")}</span>
        </div>
        <div class="sim-form-flow">
          ${items.map((item, index) => renderStudioFormStep(item, page, index + 1)).join("")}
        </div>
      </section>
    `;
  }
  return `
    <section class="sim-card">
      <div class="sim-section-head">
        <h3>${escapeHtml(section.title)}</h3>
        <span>${escapeHtml(section.description || "")}</span>
      </div>
      <div class="sim-action-grid compact">
        ${items.map((item) => renderStudioAction(item, page, "compact")).join("")}
      </div>
    </section>
  `;
}

function renderStudioAction(item, page, variant = "") {
  const target = { ...item, uiSurface: page.uiSurface };
  const count = discussionCountForTarget(target);
  return `
    <button type="button" class="sim-action ${variant} ${item.id === state.selectedTargetId ? "is-selected" : ""}" data-target-id="${escapeHtml(item.id)}">
      <span class="sim-action-icon">${escapeHtml(item.label.slice(0, 1))}</span>
      <strong>${escapeHtml(item.label)}</strong>
      <small>${escapeHtml(item.summary || "")}</small>
      <span class="inline-comment">${count ? `${count} 条讨论` : "评论"}</span>
    </button>
  `;
}

function renderStudioListItem(item, page, index) {
  const target = { ...item, uiSurface: page.uiSurface };
  return `
    <div class="sim-row ${item.id === state.selectedTargetId ? "is-selected" : ""}" data-target-id="${escapeHtml(item.id)}">
      <span class="sim-rank">${String(index).padStart(2, "0")}</span>
      <button type="button" data-target-id="${escapeHtml(item.id)}">
        <strong>${escapeHtml(item.label)}</strong>
        <small>${escapeHtml(item.summary || "")}</small>
      </button>
      ${renderHotspotButton(target, item.label)}
    </div>
  `;
}

function renderStudioFormStep(item, page, index) {
  const target = { ...item, uiSurface: page.uiSurface };
  return `
    <div class="sim-form-step ${item.id === state.selectedTargetId ? "is-selected" : ""}" data-target-id="${escapeHtml(item.id)}">
      <span class="step-index">${index}</span>
      <div>
        <strong>${escapeHtml(item.label)}</strong>
        <p>${escapeHtml(item.summary || "")}</p>
      </div>
      ${renderHotspotButton(target, item.label)}
    </div>
  `;
}

function renderPageHotspots(page) {
  return (page.hotspots || [])
    .map((hotspot) => {
      const target = { ...hotspot, uiSurface: page.uiSurface };
      return `
        <button type="button" class="sim-hotspot-chip ${hotspot.id === state.selectedTargetId ? "is-selected" : ""}" data-target-id="${escapeHtml(hotspot.id)}">
          <span>${escapeHtml(hotspot.kind || "icon")}</span>
          <strong>${escapeHtml(hotspot.label)}</strong>
          <small>${discussionCountForTarget(target) || 0}</small>
        </button>
      `;
    })
    .join("");
}

function renderStudioTopbar(page) {
  const topbarTargets = (page.hotspots || []).filter((hotspot) => hotspot.id.startsWith("top-"));
  return `
    <header class="sim-topbar">
      <div class="sim-title">
        <button type="button" class="sim-back" aria-label="返回">&lt;</button>
        <div>
          <p>${escapeHtml(page.eyebrow || "拾柴平台")}</p>
          <h3>${escapeHtml(page.title)}</h3>
        </div>
      </div>
      <div class="sim-top-actions">
        ${topbarTargets.map((target) => `
          <button type="button" class="sim-icon-target ${target.id === state.selectedTargetId ? "is-selected" : ""}" data-target-id="${escapeHtml(target.id)}">
            ${escapeHtml(target.label.replace("图标", "").slice(0, 2))}
            <span class="icon-comment-count">${discussionCountForTarget({ ...target, uiSurface: page.uiSurface }) || "+"}</span>
          </button>
        `).join("")}
        <span class="sim-user">邮箱用户 v0-***@example.com</span>
        <button type="button">退出</button>
      </div>
    </header>
  `;
}

function renderStudioChainStrip(page) {
  const chains = chainsForPage(page);
  if (!chains.length) return "";
  return `
    <section class="sim-chain-strip">
      <div class="sim-section-head">
        <h3>当前页面支持的操作链</h3>
        <button type="button" id="toggle-chain-drawer">${state.chainDrawerOpen ? "收起" : "一键查看全部"}</button>
      </div>
      <div class="sim-chain-tabs">
        ${chains.map((chain) => `<span>${escapeHtml(chain.title)}</span>`).join("")}
      </div>
      ${state.chainDrawerOpen ? `
        <div class="sim-chain-drawer">
          ${chains.map((chain) => `
            <article>
              <h4>${escapeHtml(chain.title)}</h4>
              <ol>
                ${(chain.steps || []).map((step) => `
                  <li class="${step.pageId === page.id ? "on-page" : ""}">
                    <span>${escapeHtml(pageTitleById(step.pageId))}</span>
                    <strong>${escapeHtml(step.label)}</strong>
                    <button type="button" data-step-id="${escapeHtml(step.id)}">评论此步骤</button>
                  </li>
                `).join("")}
              </ol>
            </article>
          `).join("")}
        </div>
      ` : ""}
    </section>
  `;
}

function renderStudio() {
  const root = byId("studio-root");
  const data = studio();
  if (!root) return;
  if (!data) {
    root.innerHTML = `<div class="empty-state">暂无平台仿真数据。</div>`;
    return;
  }
  const pages = studioPages();
  const page = currentPage();
  if (!state.selectedPageId && page) state.selectedPageId = page.id;
  if (!state.selectedTargetId && pageTargets(page)[0]) state.selectedTargetId = pageTargets(page)[0].id;

  root.innerHTML = `
    <div class="studio-shell">
      ${renderStudioNav(pages, page)}
      <section class="sim-workspace">
        ${renderStudioTopbar(page)}
        <div class="sim-command-row">
          <div>
            <strong>${escapeHtml(page.summary || "")}</strong>
            <span>${escapeHtml(page.uiSurface || "")}</span>
          </div>
          <button type="button" id="view-page-chains">一键查看操作链</button>
        </div>
        <div class="sim-hotspot-row">${renderPageHotspots(page)}</div>
        <div class="sim-page-body">
          ${(page.sections || []).map((section) => renderStudioSection(section, page)).join("")}
        </div>
        ${renderStudioChainStrip(page)}
      </section>
    </div>
  `;

  root.querySelectorAll("[data-page-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedPageId = button.dataset.pageId;
      state.selectedTargetId = pageTargets(currentPage())[0]?.id || null;
      renderAll();
    });
  });
  root.querySelectorAll("[data-target-id]").forEach((element) => {
    element.addEventListener("click", (event) => {
      event.stopPropagation();
      state.selectedTargetId = element.dataset.targetId;
      renderAll();
    });
  });
  root.querySelectorAll("[data-step-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = pageTargets(page).find((item) => item.stepId === button.dataset.stepId);
      state.selectedTargetId = target?.id || state.selectedTargetId;
      renderAll();
    });
  });
  byId("toggle-chain-drawer")?.addEventListener("click", () => {
    state.chainDrawerOpen = !state.chainDrawerOpen;
    renderAll();
  });
  byId("view-page-chains")?.addEventListener("click", () => {
    state.chainDrawerOpen = true;
    renderAll();
  });
}

function renderIssueTaskCard(task) {
  const claimant = task.claimant ? `@${task.claimant}` : "未接单";
  const parent = task.parentIssue?.url
    ? `<a href="${escapeHtml(task.parentIssue.url)}">${escapeHtml(task.parentIssue.label || "父级 Issue")}</a>`
    : escapeHtml(task.parentFeature?.title || "未归属父问题");
  return `
    <article class="issue-task-card ${task.id === state.selectedIssueId ? "is-selected" : ""}" data-issue-id="${escapeHtml(task.id)}">
      <div class="issue-task-head">
        ${claimPill(task.status)}
        <span class="repo-chip">${escapeHtml(task.repoName || task.repo)}</span>
      </div>
      <h3>#${escapeHtml(task.number)} ${escapeHtml(task.title)}</h3>
      <div class="issue-task-meta">
        <span>归属：${parent}</span>
        <span>负责人：${escapeHtml(claimant)}</span>
        <span>已耗时：${escapeHtml(formatElapsedHours(task.elapsedHours, task.claimedAt, task.closedAt))}</span>
      </div>
    </article>
  `;
}

function renderIssueTasks() {
  const root = byId("issue-task-board");
  if (!root) return;
  const groups = issueTasksByStatus();
  root.innerHTML = groups
    .map((group) => `
      <section class="issue-task-column">
        <div class="issue-task-column-head">
          <h3>${escapeHtml(group.title)}</h3>
          <span>${group.tasks.length}</span>
        </div>
        <div class="issue-task-stack">
          ${group.tasks.length ? group.tasks.map(renderIssueTaskCard).join("") : `<div class="mini-empty">暂无任务</div>`}
        </div>
      </section>
    `)
    .join("");

  root.querySelectorAll("[data-issue-id]").forEach((card) => {
    card.addEventListener("click", () => {
      state.selectedIssueId = card.dataset.issueId;
      renderAll();
    });
  });
}

function renderRows() {
  const rows = filteredFeatures();
  const tbody = byId("feature-rows");
  if (!rows.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6">
          <div class="empty-state">没有符合当前筛选条件的功能。</div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = rows
    .map((feature) => {
      const surfaces = (feature.uiSurfaces || []).map((surface) => surface.name).join(", ");
      const chain = (feature.operationChain || []).slice(0, 3).join(" -> ");
      return `
        <tr data-feature-id="${escapeHtml(feature.id)}" class="${feature.id === state.selectedId ? "is-selected" : ""}">
          <td>
            <div class="feature-title">
              <strong>${escapeHtml(feature.title)}</strong>
              <span>${escapeHtml(feature.summary || "")}</span>
            </div>
          </td>
          <td>${escapeHtml(surfaces || "未映射")}</td>
          <td>${escapeHtml(chain || "未映射")}</td>
          <td>${statusPill(feature.status)}</td>
          <td><span class="cell-muted">${escapeHtml(feature.lane || "未分配")}</span></td>
          <td><span class="cell-muted">${escapeHtml(feature.verification || "未验证")}</span></td>
        </tr>
      `;
    })
    .join("");

  tbody.querySelectorAll("tr[data-feature-id]").forEach((row) => {
    row.addEventListener("click", () => {
      state.selectedId = row.dataset.featureId;
      renderAll();
    });
  });
}

function renderSurfaces() {
  const surfaces = state.data?.uiSurfaces || [];
  byId("surface-grid").innerHTML = surfaces.length
    ? surfaces
        .map((surface) => `
          <article class="surface-item">
            <h3>${escapeHtml(surface.name)}</h3>
            <p>${escapeHtml(surface.description || "")}</p>
            <div class="meta-row">
              <span class="meta-chip">${escapeHtml(surface.repo || "仓库")}</span>
              <span class="meta-chip">${escapeHtml(surface.route || "路径待定")}</span>
              <span class="meta-chip">${surface.featureCount || 0} 个功能</span>
            </div>
          </article>
        `)
        .join("")
    : `<div class="empty-state">还没有登记界面页面。</div>`;
}

function renderChains() {
  const chains = state.data?.operationChains || [];
  byId("chain-list").innerHTML = chains.length
    ? chains
        .map((chain) => `
          <article class="chain-item">
            <h3>${escapeHtml(chain.name)}</h3>
            <p>${escapeHtml(chain.description || "")}</p>
            <ol class="chain-steps">
              ${(chain.steps || [])
                .map((step, index) => `
                  <li>
                    <span class="step-index">${index + 1}</span>
                    <span>${escapeHtml(step)}</span>
                  </li>
                `)
                .join("")}
            </ol>
          </article>
        `)
        .join("")
    : `<div class="empty-state">还没有登记操作链。</div>`;
}

function renderHandoffs() {
  const handoffs = state.data?.handoffs || [];
  byId("handoff-list").innerHTML = handoffs.length
    ? handoffs
        .map((handoff) => `
          <article class="handoff-item">
            <h3>${escapeHtml(handoff.title)}</h3>
            <p>${escapeHtml(handoff.summary || "")}</p>
            <div class="meta-row">
              <span class="meta-chip">${escapeHtml(handoff.needs || "需要复核")}</span>
              <span class="meta-chip">${escapeHtml(handoff.lane || "分工待定")}</span>
              <span class="meta-chip">${escapeHtml(handoff.repo || "仓库待定")}</span>
            </div>
          </article>
        `)
        .join("")
    : `<div class="empty-state">当前快照里没有开放协作交接。</div>`;
}

function renderHealth() {
  const root = byId("health-list");
  if (!root) return;
  const items = healthItems();
  root.innerHTML = items.length
    ? items.map((item) => `
      <article class="health-item">
        <div>
          <h3>${escapeHtml(item.title)}</h3>
          <p>${escapeHtml(item.message)}</p>
        </div>
        <div class="meta-row">
          <span class="meta-chip">${escapeHtml(item.type)}</span>
          <span class="meta-chip">${escapeHtml(item.module || "module")}</span>
          <span class="meta-chip">${escapeHtml(formatDateTime(item.createdAt))}</span>
        </div>
        <button type="button" data-health-topic="${escapeHtml(item.topicId)}">打开 Topic</button>
      </article>
    `).join("")
    : `<div class="empty-state">当前没有需要恢复的中台事项。</div>`;
  root.querySelectorAll("[data-health-topic]").forEach((button) => {
    button.addEventListener("click", () => {
      state.aiMiddleware.selectedTopicId = button.dataset.healthTopic;
      const topic = topicById(button.dataset.healthTopic);
      if (topic?.simulatorEvidence?.pageId) {
        state.selectedPageId = topic.simulatorEvidence.pageId;
        state.selectedTargetId = topic.simulatorEvidence.targetId;
      }
      state.activeTab = "studio";
      renderAll();
    });
  });
}

function renderDiscussions() {
  const discussions = state.data?.discussions || [];
  byId("discussion-list").innerHTML = discussions.length
    ? discussions
        .map((discussion) => `
          <article class="discussion-item">
            <div>
              <h3>${escapeHtml(discussion.title)}</h3>
              <p>${escapeHtml(discussion.preview || "暂无公开摘要。")}</p>
            </div>
            <div class="meta-row">
              <span class="meta-chip">${escapeHtml(discussionLabels[discussion.type] || discussion.type || "想法")}</span>
              <span class="meta-chip">${escapeHtml(lifecycleLabels[discussion.lifecycle] || discussion.lifecycle || "待复核")}</span>
              <span class="meta-chip">${escapeHtml(discussion.dispatch?.statusLabel || "未进入分发")}</span>
              <span class="meta-chip">${escapeHtml(discussion.featureId || "未映射")}</span>
              <span class="meta-chip">${discussion.commentCount || 0} 条评论</span>
            </div>
            <div class="detail-links muted-links">
              <span>源记录：#${escapeHtml(discussion.number || "")}</span>
              ${discussion.dispatch?.targetRepo ? `<span>目标仓库：${escapeHtml(discussion.dispatch.targetRepo)}</span>` : ""}
              ${discussion.dispatch?.targetUrl ? `<span>目标任务已生成</span>` : ""}
            </div>
          </article>
        `)
        .join("")
    : `<div class="empty-state">还没有看板讨论。可以在仿真界面里选中操作点后提交想法或评价。</div>`;
}

function attachDiscussionComposer(feature) {
  const button = byId("open-discussion-issue");
  if (!button) return;
  button.addEventListener("click", async () => {
    await submitFeatureDiscussion(
      feature,
      byId("discussion-type")?.value || "idea",
      byId("discussion-title")?.value?.trim() || "",
      byId("discussion-body")?.value?.trim() || ""
    );
  });
}

function renderCommentWidget(feature) {
  const container = byId("comment-widget");
  if (!container) return;
  container.innerHTML = `
    <div class="inline-action-note">
      快速评论已经合并到上方表单。提交后会进入公开源讨论，并由系统自动分发到目标仓库。
    </div>
  `;
}

function renderTargetCommentWidget(target) {
  const container = byId("comment-widget");
  if (!container) return;
  container.innerHTML = `
    <div class="inline-action-note">
      当前操作点：${escapeHtml(target.label || target.id)}。请使用上方表单直接提交想法、评价或操作链建议。
    </div>
  `;
}

function coordinatorSourceLabel(coordinator = {}) {
  if (coordinator.source === "server-deepseek") return "服务器 DeepSeek";
  if (coordinator.source === "server-codex") return "服务器 Codex";
  if (coordinator.source === "server-mock") return "服务器 mock";
  if (coordinator.source === "browser-fallback") return "浏览器兜底";
  return coordinator.source || "未记录";
}

function renderPanelTopicMiddleware(target) {
  const topics = topicsForTarget(target);
  const selected = selectedTopicForTarget(target);
  const message = state.aiMiddleware.message
    ? `<div class="operator-message message-${escapeHtml(state.aiMiddleware.message.type)}">${escapeHtml(state.aiMiddleware.message.text)}</div>`
    : "";
  const topicList = topics.length
    ? `<div class="topic-tabs">${topics.slice(0, 4).map((topic) => `
        <button type="button" data-topic-select="${escapeHtml(topic.id)}" class="${topic.id === selected?.id ? "is-active" : ""}">
          ${escapeHtml(topic.status === "published" ? "已发布" : topic.status === "publish-failed" ? "待绑定" : "Topic")}
        </button>
      `).join("")}</div>`
    : "";
  return `
    <div class="detail-section ai-topic-panel">
      <h3>Panel Topic</h3>
      <p>选择当前位置后只写一句短说明；服务器中台 AI 会补全 issue 草稿、查重和风险门槛，失败时本地兜底。</p>
      <div class="topic-create-row">
        <input id="panel-topic-note" type="text" placeholder="例如：首页发布入口文案太像普通按钮，需要更明确">
        <button class="primary-button" type="button" id="create-panel-topic" ${state.aiMiddleware.busy ? "disabled" : ""}>生成 Topic</button>
      </div>
      ${message}
      ${topicList}
      ${selected ? renderPanelTopicDetail(selected) : ""}
    </div>
  `;
}

function renderPanelTopicDetail(topic) {
  const gateClass = topic.riskGate.decision === "direct-publish" ? "gate-direct" : "gate-confirm";
  const backfillCandidates = topic.manualFallback && !topic.finalIssue
    ? findIssueBackfillCandidates(topic, issueTasks())
    : [];
  const duplicateItems = topic.duplicateCheck.candidates.length
    ? topic.duplicateCheck.candidates.map((candidate) => `
      <li>
        <span>${escapeHtml(candidate.kind)} · ${Math.round(candidate.score * 100)}%</span>
        ${candidate.url ? `<a href="${escapeHtml(candidate.url)}">${escapeHtml(candidate.title)}</a>` : `<strong>${escapeHtml(candidate.title)}</strong>`}
      </li>
    `).join("")
    : "<li><span>duplicate</span><strong>当前快照未发现强重复候选</strong></li>";
  const reasons = topic.riskGate.reasons.length
    ? topic.riskGate.reasons.map((reason) => `<span class="meta-chip">${escapeHtml(reason)}</span>`).join("")
    : "<span class=\"meta-chip\">small clear issue</span>";
  const manualPackage = topic.manualFallback
    ? `
      <div class="manual-package">
        <label>
          <span>标题</span>
          <textarea readonly rows="2">${escapeHtml(topic.manualFallback.title)}</textarea>
        </label>
        <label>
          <span>正文和上下文</span>
          <textarea readonly rows="7">${escapeHtml(topic.manualFallback.body)}</textarea>
        </label>
      </div>
    `
    : "";
  const published = topic.finalIssue?.url
    ? `<p class="backend-record">Final Issue：<a data-final-issue-link href="${escapeHtml(topic.finalIssue.url)}">${escapeHtml(topic.finalIssue.repo)}#${escapeHtml(topic.finalIssue.number)}</a></p>`
    : "";
  const coordinator = topic.coordinator
    ? `<p class="backend-record">中台 AI：${escapeHtml(coordinatorSourceLabel(topic.coordinator))}${topic.coordinator.threadId ? ` · thread ${escapeHtml(topic.coordinator.threadId)}` : ""}</p>`
    : "";
  const backfillHtml = backfillCandidates.length
    ? `
      <div class="backfill-candidates">
        <strong>可能是手动发布的 Issue</strong>
        <ul class="signal-list">
          ${backfillCandidates.map((candidate) => `
            <li>
              <span>${Math.round(candidate.score * 100)}% · ${escapeHtml(candidate.repo)}#${escapeHtml(candidate.number)}</span>
              <a href="${escapeHtml(candidate.url)}">${escapeHtml(candidate.title)}</a>
              <button type="button" data-topic-candidate="${escapeHtml(topic.id)}" data-candidate-url="${escapeHtml(candidate.url)}">绑定这个候选</button>
            </li>
          `).join("")}
        </ul>
      </div>
    `
    : "";
  const publishLabel = topic.riskGate.decision === "direct-publish" ? "直接发布 Final Issue" : "确认发布 Final Issue";
  return `
    <article class="topic-detail">
      <div class="topic-head">
        <span class="topic-status ${escapeHtml(gateClass)}">${escapeHtml(topic.riskGate.label)}</span>
        <span class="repo-chip">${escapeHtml(topic.recommendedRepo)} · ${escapeHtml(topic.module)}</span>
      </div>
      <strong>${escapeHtml(topic.issueDraft.title)}</strong>
      <p>${escapeHtml(topic.note)}</p>
      ${coordinator}
      <div class="meta-row">${reasons}</div>
      <ul class="signal-list">${duplicateItems}</ul>
      <div class="topic-actions">
        <button class="primary-button" type="button" data-topic-publish="${escapeHtml(topic.id)}" ${state.aiMiddleware.busy || topic.finalIssue ? "disabled" : ""}>${publishLabel}</button>
        <button type="button" data-topic-copy="${escapeHtml(topic.id)}">导出 issue 处理包</button>
        <button type="button" data-topic-discuss="${escapeHtml(topic.id)}" ${state.actionBusy ? "disabled" : ""}>继续讨论</button>
      </div>
      ${manualPackage}
      ${backfillHtml}
      <label class="manual-bind-row">
        <span>手动发布后的 GitHub Issue URL</span>
        <input id="manual-issue-url-${escapeHtml(topic.id)}" type="url" placeholder="https://github.com/shichai-dev/opc-bounty-client/issues/123">
      </label>
      <button type="button" data-topic-bind="${escapeHtml(topic.id)}" ${state.aiMiddleware.busy || topic.finalIssue ? "disabled" : ""}>绑定 URL 并进入任务分发</button>
      ${published}
    </article>
  `;
}

function attachPanelTopicMiddleware(target) {
  byId("create-panel-topic")?.addEventListener("click", () => createCurrentPanelTopic(target));
  document.querySelectorAll("[data-topic-select]").forEach((button) => {
    button.addEventListener("click", () => {
      state.aiMiddleware.selectedTopicId = button.dataset.topicSelect;
      saveAiMiddlewareState();
      renderAll();
    });
  });
  document.querySelectorAll("[data-topic-publish]").forEach((button) => {
    button.addEventListener("click", () => publishPanelTopic(button.dataset.topicPublish));
  });
  document.querySelectorAll("[data-topic-copy]").forEach((button) => {
    button.addEventListener("click", () => copyTopicIssuePackage(button.dataset.topicCopy));
  });
  document.querySelectorAll("[data-topic-bind]").forEach((button) => {
    button.addEventListener("click", () => bindPanelTopicIssueUrl(button.dataset.topicBind));
  });
  document.querySelectorAll("[data-topic-candidate]").forEach((button) => {
    button.addEventListener("click", () => bindPanelTopicCandidate(button.dataset.topicCandidate, button.dataset.candidateUrl));
  });
  document.querySelectorAll("[data-topic-discuss]").forEach((button) => {
    button.addEventListener("click", () => continueTopicDiscussion(button.dataset.topicDiscuss));
  });
}

function renderStudioInspector() {
  const target = currentTarget();
  const page = currentPage();
  const detail = byId("detail-panel");
  if (!target || !page) {
    detail.innerHTML = `
      <div class="empty-detail">
        <h2>选择一个页面操作</h2>
        <p>点击仿真界面里的按钮、图标或区域后，在这里评论、评价或追加操作链。</p>
      </div>
    `;
    return;
  }

  const feature = featureById(target.featureId);
  const discussions = discussionsForTarget(target);
  const chains = chainsForTarget(target);
  const discussionItems = discussions.length
    ? discussions.slice(0, 5).map((discussion) => `
      <li>
        <span>${escapeHtml(lifecycleLabels[discussion.lifecycle] || discussion.lifecycle)}</span>
        <a href="${escapeHtml(discussion.url)}">${escapeHtml(discussion.title)}</a>
      </li>
    `).join("")
    : "<li>这个页面操作还没有结构化讨论。</li>";

  detail.innerHTML = `
    <div>
      ${statusPill(feature?.status || "planned")}
      <h2>${escapeHtml(target.label)}</h2>
      <p>${escapeHtml(target.summary || page.summary || "")}</p>
      <div class="meta-row">
        <span class="meta-chip">${escapeHtml(page.title)}</span>
        <span class="meta-chip">${escapeHtml(target.uiSurface || page.uiSurface || "界面页面")}</span>
        <span class="meta-chip">${escapeHtml(target.stepId || target.id)}</span>
      </div>
    </div>
    <div class="detail-section">
      <h3>关联功能</h3>
      <p>${escapeHtml(feature?.title || target.featureId || "未映射")}</p>
    </div>
    <div class="detail-section">
      <h3>当前操作链</h3>
      <div class="target-chain-list">
        ${chains.length ? chains.map((chain) => `
          <article>
            <strong>${escapeHtml(chain.title)}</strong>
            <ol>
              ${(chain.steps || []).map((step) => `
                <li class="${step.id === target.stepId ? "is-current" : ""}">${escapeHtml(step.label)}</li>
              `).join("")}
            </ol>
          </article>
        `).join("") : "<p>还没有映射操作链。</p>"}
      </div>
    </div>
    <div class="detail-section">
      <h3>异步讨论</h3>
      <div class="meta-row">
        <span class="meta-chip">${discussions.filter((discussion) => discussion.state !== "CLOSED").length} 开放</span>
        <span class="meta-chip">${discussions.filter((discussion) => discussion.needsAiReview).length} 待智能处理</span>
        <span class="meta-chip">${discussions.filter((discussion) => discussion.lifecycle === "stale").length} 已过期</span>
      </div>
      <ul class="signal-list">${discussionItems}</ul>
    </div>
    ${renderPanelTopicMiddleware(target)}
    <div class="detail-section">
      <h3>添加评论或操作建议</h3>
      <div class="discussion-composer">
        <label>
          <span>类型</span>
          <select id="discussion-type">
            <option value="idea">想加功能</option>
            <option value="evaluation">评价当前功能</option>
            <option value="change-request">修改现有操作</option>
            <option value="handoff">追加操作链</option>
            <option value="bug">问题或风险</option>
          </select>
        </label>
        <label>
          <span>标题</span>
          <input id="discussion-title" type="text" placeholder="例如：这里需要批量导入材料">
        </label>
        <label>
          <span>评论</span>
          <textarea id="discussion-body" rows="5" placeholder="针对这个页面、图标或操作，描述想增加什么、为什么、后续接哪条操作链。"></textarea>
        </label>
        <div class="inspector-actions">
          <button class="primary-button" type="button" id="open-discussion-issue" ${state.actionBusy ? "disabled" : ""}>提交到面板讨论</button>
          <button type="button" id="open-evaluation-modal">打开评价窗口</button>
        </div>
      </div>
    </div>
    <div class="detail-section">
      <h3>快速评论</h3>
      <div id="comment-widget" class="comment-widget" aria-live="polite"></div>
    </div>
    ${state.evaluationOpen ? renderEvaluationModal(target) : ""}
  `;

  byId("open-discussion-issue")?.addEventListener("click", async () => {
    const type = byId("discussion-type")?.value || "idea";
    const title = byId("discussion-title")?.value?.trim() || "";
    const body = byId("discussion-body")?.value?.trim() || "";
    await submitTargetDiscussion(target, type, title, body);
  });
  byId("open-evaluation-modal")?.addEventListener("click", () => {
    state.evaluationOpen = true;
    renderAll();
  });
  byId("close-evaluation-modal")?.addEventListener("click", () => {
    state.evaluationOpen = false;
    renderAll();
  });
  byId("send-evaluation")?.addEventListener("click", async () => {
    const rating = byId("evaluation-rating")?.value || "ok";
    const note = byId("evaluation-note")?.value?.trim() || "";
    await submitTargetDiscussion(target, "evaluation", `评价：${target.label}`, `评价结果：${rating}\n\n${note}`);
  });
  attachPanelTopicMiddleware(target);
  renderTargetCommentWidget(target);
}

function renderEvaluationModal(target) {
  return `
    <div class="evaluation-popover" role="dialog" aria-label="评价窗口">
      <div class="evaluation-head">
        <strong>评价窗口</strong>
        <button type="button" id="close-evaluation-modal">关闭</button>
      </div>
      <label>
        <span>当前操作是否清楚</span>
        <select id="evaluation-rating">
          <option value="clear">清楚，可以继续扩展</option>
          <option value="unclear">不清楚，需要重做文案或流程</option>
          <option value="missing-chain">缺少后续操作链</option>
          <option value="risk">存在风险，需要先讨论</option>
        </select>
      </label>
      <label>
        <span>评价内容</span>
        <textarea id="evaluation-note" rows="4" placeholder="评价 ${escapeHtml(target.label)} 的当前体验，或者说明希望接到哪条后续操作。"></textarea>
      </label>
      <button class="primary-button" type="button" id="send-evaluation" ${state.actionBusy ? "disabled" : ""}>提交评价</button>
    </div>
  `;
}

function renderLocalAgentControl(task) {
  const operator = state.operator.login?.trim();
  const message = state.localBridge.message?.taskId === task.id || !state.localBridge.message?.taskId
    ? state.localBridge.message
    : null;
  const run = localBridgeRun(task);
  const status = localAgentDisplayStatus(task, run);
  const messageHtml = message
    ? `<div class="operator-message message-${escapeHtml(message.type)}">${escapeHtml(message.text)}</div>`
    : "";

  if (!operator) {
    return `
      <div class="detail-section local-agent-panel">
        <h3>本地 Agent</h3>
        <p>先在页面顶部填写 GitHub 用户名。只有任务认领者本人会看到本地 Agent 启动控件。</p>
      </div>
    `;
  }

  if (!task.claimant) {
    return `
      <div class="detail-section local-agent-panel">
        <h3>本地 Agent</h3>
        <p>这个任务还未认领。先接单后，个人页才允许启动本地 Agent。</p>
      </div>
    `;
  }

  if (!isTaskClaimedByOperator(task)) {
    return `
      <div class="detail-section local-agent-panel">
        <h3>本地 Agent</h3>
        <p>这个任务由 @${escapeHtml(task.claimant)} 认领。本地 Agent 控件只对认领者本人可见和可操作。</p>
      </div>
    `;
  }

  return `
    <div class="detail-section local-agent-panel">
      <div class="local-agent-head">
        <h3>本地 Agent</h3>
        <span class="local-agent-status ${escapeHtml(status.className)}">${escapeHtml(status.label)}</span>
      </div>
      <p>只控制你本机的 Bridge 和 Codex 线程。停止不会释放任务认领，释放请使用“放弃接单”。</p>
      <div class="local-agent-settings">
        <label>
          <span>Bridge 地址</span>
          <input id="local-bridge-url" type="url" value="${escapeHtml(state.localBridge.baseUrl)}" placeholder="http://127.0.0.1:17653">
        </label>
        <label>
          <span>Bridge Token</span>
          <input id="local-bridge-token" type="password" value="${escapeHtml(state.localBridge.token)}" placeholder="OPC_BRIDGE_TOKEN">
        </label>
        <button type="button" id="save-local-bridge">保存</button>
      </div>
      <div class="local-agent-actions">
        <button type="button" id="check-local-bridge" ${state.localBridge.busy ? "disabled" : ""}>检测 Bridge</button>
        <button class="primary-button" type="button" id="launch-local-agent" ${state.localBridge.busy ? "disabled" : ""}>启动 / 续写</button>
        <button type="button" id="stop-local-agent" ${state.localBridge.busy ? "disabled" : ""}>停止 Agent</button>
        <button type="button" id="copy-bridge-package" ${state.localBridge.busy ? "disabled" : ""}>复制处理包</button>
      </div>
      <div class="local-agent-meta">
        ${run?.threadId ? `<span>threadId: ${escapeHtml(run.threadId)}</span>` : "<span>还没有本地 threadId</span>"}
        ${run?.cwd ? `<span>cwd: ${escapeHtml(run.cwd)}</span>` : ""}
        ${run?.updatedAt ? `<span>更新时间: ${escapeHtml(formatDateTime(run.updatedAt))}</span>` : ""}
      </div>
      ${messageHtml}
    </div>
  `;
}

function localAgentDisplayStatus(task, run) {
  if (run?.status === "executed") return { label: "已执行", className: "agent-executed" };
  if (run?.status === "failed") return { label: "启动失败", className: "agent-failed" };
  if (state.localBridge.health?.reachable === false) return { label: "Bridge 未在线", className: "agent-offline" };
  return { label: "未启动", className: "agent-idle" };
}

function attachLocalAgentControl(task) {
  byId("save-local-bridge")?.addEventListener("click", () => {
    saveLocalBridgeSettings(byId("local-bridge-url")?.value || "", byId("local-bridge-token")?.value || "");
    renderAll();
  });
  byId("check-local-bridge")?.addEventListener("click", checkLocalBridgeHealth);
  byId("launch-local-agent")?.addEventListener("click", () => launchLocalAgent(task));
  byId("stop-local-agent")?.addEventListener("click", () => stopLocalAgent(task));
  byId("copy-bridge-package")?.addEventListener("click", () => copyBridgeLaunchPackage(task));
}

function renderTaskHandoffPackage(task) {
  const topic = task.panelTopicId ? topicById(task.panelTopicId) : null;
  if (!topic) return "";
  const handoff = buildAgentHandoffPackageFromTopicTask(task, topic);
  return `
    <div class="detail-section handoff-package-panel">
      <h3>Agent Handoff Package</h3>
      <p>${escapeHtml(handoff.panelTopic.note)}</p>
      <div class="meta-row">
        <span class="meta-chip">${escapeHtml(handoff.task.module)}</span>
        <span class="meta-chip">${escapeHtml(handoff.simulatorEvidence.triggerLocation)}</span>
        <span class="meta-chip">${escapeHtml(handoff.panelTopic.riskGate.label)}</span>
      </div>
      <ul class="signal-list">
        ${handoff.acceptance.slice(0, 3).map((item) => `<li><span>acceptance</span><strong>${escapeHtml(item)}</strong></li>`).join("")}
      </ul>
    </div>
  `;
}

async function submitIssueCommand(task, command, argument = "") {
  if (task.source === "development-ai-middleware" && task.panelTopicId) {
    try {
      const topic = topicById(task.panelTopicId);
      if (!topic) throw new Error("找不到对应 Panel Topic。");
      let nextTopic = topic;
      if (command === "claim") {
        nextTopic = claimFormalTaskTopic(topic, state.operator.login);
        setActionMessage("success", "已在面板内认领任务，GitHub 映射会由后台同步。");
      } else if (command === "unclaim") {
        nextTopic = releaseFormalTaskTopic(topic, state.operator.login);
        setActionMessage("success", "已释放面板任务认领。");
      } else if (command === "ready-pr") {
        setActionMessage("success", "本地中台任务已标记等待 PR；正式状态以后以 GitHub 刷新为准。");
      } else if (command === "blocked") {
        nextTopic = {
          ...topic,
          health: {
            type: "claim-mapping-recovery",
            module: topic.module,
            message: argument || "本地中台任务被标记为阻塞。",
            createdAt: new Date().toISOString()
          }
        };
        setActionMessage("success", "已记录阻塞恢复项。");
      } else if (command === "handoff") {
        setActionMessage("success", "转交需等待正式 GitHub issue 同步后处理；当前任务认领未改变。");
      }
      updatePanelTopic(nextTopic);
      renderAll();
    } catch (error) {
      setActionMessage("error", error.message || "接单操作失败。");
      renderAll();
    }
    return;
  }
  await runPanelAction("接单操作", async () => postDashboardAction("/api/issue-command", {
    repo: task.repo,
    number: task.number,
    command,
    argument
  }));
}

function renderIssueInspector() {
  const task = currentIssueTask();
  const detail = byId("detail-panel");
  if (!task) {
    detail.innerHTML = `
      <div class="empty-detail">
        <h2>暂无接单任务</h2>
        <p>刷新后会从团队仓库读取开放 Issue，并按接单状态展示。</p>
      </div>
    `;
    return;
  }

  state.selectedIssueId = task.id;
  const parent = task.parentIssue?.url
    ? `<a href="${escapeHtml(task.parentIssue.url)}">${escapeHtml(task.parentIssue.label || "父级 Issue")}</a>`
    : escapeHtml(task.parentFeature?.title || "未归属父问题");
  const labels = (task.labels || []).slice(0, 8).map((label) => `<span class="meta-chip">${escapeHtml(label)}</span>`).join("");

  detail.innerHTML = `
    <div>
      ${claimPill(task.status)}
      <h2>#${escapeHtml(task.number)} ${escapeHtml(task.title)}</h2>
      <p>${escapeHtml(task.repo)} · ${escapeHtml(task.lane || "分工待定")}</p>
      <div class="meta-row">
        <span class="meta-chip">负责人：${escapeHtml(task.claimant ? `@${task.claimant}` : "未接单")}</span>
        <span class="meta-chip">接单时间：${escapeHtml(formatDateTime(task.claimedAt))}</span>
        <span class="meta-chip">已耗时：${escapeHtml(formatElapsedHours(task.elapsedHours, task.claimedAt, task.closedAt))}</span>
      </div>
    </div>
    <div class="detail-section">
      <h3>归属状态</h3>
      <p>父级：${parent}</p>
      <p>总问题：${escapeHtml(task.totalProblem || "未归属父问题")}</p>
    </div>
    ${renderTaskHandoffPackage(task)}
    <div class="detail-section">
      <h3>接单操作</h3>
      <p>直接在面板内接单或更新状态。系统会在后台写入对应仓库 Issue，并触发看板刷新。</p>
      <div class="claim-action-grid">
        <button class="primary-button" type="button" data-issue-command="claim" ${state.actionBusy ? "disabled" : ""}>我来接单</button>
        <button type="button" data-issue-command="ready-pr" ${state.actionBusy ? "disabled" : ""}>等待 PR</button>
        <button type="button" data-issue-command="unclaim" ${state.actionBusy ? "disabled" : ""}>放弃接单</button>
      </div>
      <label class="command-input">
        <span>转交对象或阻塞原因</span>
        <input id="issue-command-argument" type="text" placeholder="转交填写 @用户名；阻塞填写原因">
      </label>
      <div class="claim-action-grid secondary">
        <button type="button" data-issue-command="handoff" ${state.actionBusy ? "disabled" : ""}>转交</button>
        <button type="button" data-issue-command="blocked" ${state.actionBusy ? "disabled" : ""}>标记阻塞</button>
      </div>
      <p class="backend-record">后台记录：${escapeHtml(task.repo)}#${escapeHtml(task.number)}</p>
      <p class="claim-note">竞发锁以 GitHub assignee 为准。一个 Issue 已有负责人后，后续接单会被拒绝或需要转交。</p>
    </div>
    ${renderLocalAgentControl(task)}
    <div class="detail-section">
      <h3>接单命令</h3>
      <ul class="signal-list">
        <li><span>/claim</span><strong>接手这个 Issue</strong></li>
        <li><span>/unclaim</span><strong>放弃接单，回到待接单</strong></li>
        <li><span>/handoff @用户名</span><strong>转交给其他成员</strong></li>
        <li><span>/blocked 原因</span><strong>标记阻塞并说明原因</strong></li>
        <li><span>/ready-pr</span><strong>标记为等待 PR</strong></li>
      </ul>
    </div>
    <div class="detail-section">
      <h3>标签</h3>
      <div class="meta-row">${labels || "<span class=\"meta-chip\">暂无标签</span>"}</div>
    </div>
  `;

  detail.querySelectorAll("[data-issue-command]").forEach((button) => {
    button.addEventListener("click", async () => {
      await submitIssueCommand(task, button.dataset.issueCommand, byId("issue-command-argument")?.value?.trim() || "");
    });
  });
  attachLocalAgentControl(task);
}

function renderDetail() {
  if (state.activeTab === "tasks") {
    renderIssueInspector();
    return;
  }
  if (state.activeTab === "studio") {
    renderStudioInspector();
    return;
  }
  const feature = (state.data?.features || []).find((item) => item.id === state.selectedId) || filteredFeatures()[0];
  const detail = byId("detail-panel");
  if (!feature) {
    detail.innerHTML = `
      <div class="empty-detail">
        <h2>选择功能</h2>
        <p>选择一行后查看界面页面、操作链步骤、关联议题和讨论提示。</p>
      </div>
    `;
    return;
  }

  state.selectedId = feature.id;
  const links = (feature.linkedIssues || [])
    .map((link) => `<a href="${escapeHtml(link.url)}">${escapeHtml(link.label || link.url)}</a>`)
    .join("");
  const discussionSignals = feature.discussion?.signals || [];
  const discussionCounts = feature.discussion?.counts || {};
  const signalList = discussionSignals.length
    ? discussionSignals
        .slice(0, 4)
        .map((discussion) => `
          <li>
            <span>${escapeHtml(lifecycleLabels[discussion.lifecycle] || discussion.lifecycle)}</span>
            <a href="${escapeHtml(discussion.url)}">${escapeHtml(discussion.title)}</a>
          </li>
        `)
        .join("")
    : "<li>还没有结构化讨论信号。</li>";

  detail.innerHTML = `
    <div>
      ${statusPill(feature.status)}
      <h2>${escapeHtml(feature.title)}</h2>
      <p>${escapeHtml(feature.summary || "")}</p>
      <div class="meta-row">
        <span class="meta-chip">${escapeHtml(feature.repo || "仓库")}</span>
        <span class="meta-chip">${escapeHtml(feature.lane || "分工")}</span>
        <span class="meta-chip">${escapeHtml(feature.ownerAi || "智能负责人待定")}</span>
      </div>
    </div>
    <div class="detail-section">
      <h3>界面页面</h3>
      <p>${escapeHtml((feature.uiSurfaces || []).map((surface) => surface.name).join(", ") || "还没有映射界面页面。")}</p>
    </div>
    <div class="detail-section">
      <h3>操作链</h3>
      <ol class="chain-steps">
        ${(feature.operationChain || [])
          .map((step, index) => `
            <li>
              <span class="step-index">${index + 1}</span>
              <span>${escapeHtml(step)}</span>
            </li>
          `)
          .join("") || "<li>还没有映射操作链。</li>"}
      </ol>
    </div>
    <div class="detail-section">
      <h3>关联讨论</h3>
      <div class="detail-links">${links || "<p>还没有关联议题。</p>"}</div>
    </div>
    <div class="detail-section">
      <h3>Async signals</h3>
      <div class="meta-row">
        <span class="meta-chip">${discussionCounts.open || 0} 开放</span>
        <span class="meta-chip">${discussionCounts.needsAiReview || 0} 待智能处理</span>
        <span class="meta-chip">${discussionCounts.implemented || 0} 已实现</span>
        <span class="meta-chip">${discussionCounts.stale || 0} 已过期</span>
      </div>
      <ul class="signal-list">${signalList}</ul>
    </div>
    <div class="detail-section">
      <h3>讨论提示</h3>
      <p>${escapeHtml(feature.discussionPrompt || "下一步应该扩展、验证或拆分什么？")}</p>
    </div>
    <div class="detail-section">
      <h3>提交想法或评价</h3>
      <div class="discussion-composer">
        <label>
          <span>类型</span>
          <select id="discussion-type">
            <option value="idea">新增功能想法</option>
            <option value="evaluation">评价当前功能</option>
            <option value="change-request">修改请求</option>
            <option value="bug">问题或风险</option>
            <option value="handoff">需要其他分工</option>
          </select>
        </label>
        <label>
          <span>标题</span>
          <input id="discussion-title" type="text" placeholder="简短标题">
        </label>
        <label>
          <span>评论</span>
          <textarea id="discussion-body" rows="5" placeholder="描述想法、评价、预期行为或需要修改的内容。"></textarea>
        </label>
        <button class="primary-button" type="button" id="open-discussion-issue" ${state.actionBusy ? "disabled" : ""}>提交到面板讨论</button>
      </div>
    </div>
    <div class="detail-section">
      <h3>快速评论</h3>
      <div id="comment-widget" class="comment-widget" aria-live="polite"></div>
    </div>
  `;
  attachDiscussionComposer(feature);
  renderCommentWidget(feature);
}

function renderTabs() {
  document.querySelectorAll(".nav-tab").forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.tab === state.activeTab);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.panel === state.activeTab);
  });
  document.querySelector(".toolbar")?.toggleAttribute("hidden", state.activeTab !== "features");
}

function renderSync() {
  const generatedAt = state.data?.generatedAt ? new Date(state.data.generatedAt) : null;
  byId("sync-state").textContent = generatedAt
    ? `最近生成：${generatedAt.toLocaleString()}`
    : "正在使用内置快照。";
  byId("sync-source").textContent = state.data?.sourceSummary || "";
}

function renderAll() {
  renderTabs();
  renderOperatorPanel();
  renderMetrics();
  renderStudio();
  renderIssueTasks();
  renderRows();
  renderSurfaces();
  renderChains();
  renderDiscussions();
  renderHandoffs();
  renderHealth();
  renderDetail();
  renderSync();
}

async function loadData() {
  const response = await fetch(`./data/status.json?ts=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load status.json: ${response.status}`);
  }
  state.data = await response.json();
  state.selectedId = state.data.features?.[0]?.id || null;
  state.selectedIssueId = state.data.issueTasks?.[0]?.id || null;
  state.selectedPageId = state.data.operationStudio?.defaultPageId || state.data.operationStudio?.pages?.[0]?.id || null;
  state.selectedTargetId = pageTargets(currentPage())[0]?.id || null;
  renderAll();
}

document.querySelectorAll(".nav-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    state.activeTab = tab.dataset.tab;
    renderAll();
  });
});

document.querySelectorAll("[data-jump-tab]").forEach((button) => {
  button.addEventListener("click", () => {
    state.activeTab = button.dataset.jumpTab;
    renderAll();
  });
});

byId("search-input").addEventListener("input", (event) => {
  state.query = event.target.value;
  renderAll();
});

byId("status-filter").addEventListener("change", (event) => {
  state.status = event.target.value;
  renderAll();
});

loadData().catch((error) => {
  byId("sync-state").textContent = "看板数据加载失败。";
  byId("sync-source").textContent = error.message;
});
