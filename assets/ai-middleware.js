const allowedRepos = new Set([
  "shichai-dev/feature-dashboard",
  "shichai-dev/planning",
  "shichai-dev/opc-bounty-client",
  "shichai-dev/opc-bounty-admin",
  "shichai-dev/opc-bounty-server"
]);

const moduleRepoMap = {
  "client frontend": "shichai-dev/opc-bounty-client",
  "admin frontend": "shichai-dev/opc-bounty-admin",
  backend: "shichai-dev/opc-bounty-server",
  dashboard: "shichai-dev/feature-dashboard",
  "qa-release": "shichai-dev/planning",
  architecture: "shichai-dev/planning"
};

const moduleLaneHints = [
  { module: "client frontend", repo: moduleRepoMap["client frontend"], patterns: [/client/i, /用户端/, /首页/, /展示台/, /发布/, /个人页/] },
  { module: "admin frontend", repo: moduleRepoMap["admin frontend"], patterns: [/admin/i, /管理端/, /后台/, /审核/, /运营/] },
  { module: "backend", repo: moduleRepoMap.backend, patterns: [/server/i, /backend/i, /api/i, /接口/, /数据库/, /钱包/, /账本/, /权限/, /对象存储/] },
  { module: "dashboard", repo: moduleRepoMap.dashboard, patterns: [/dashboard/i, /看板/, /面板/, /仿真平台/, /feature-dashboard/] },
  { module: "qa-release", repo: moduleRepoMap["qa-release"], patterns: [/qa/i, /测试/, /验证/, /release/i] }
];

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function slug(value) {
  return compactText(value).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "topic";
}

function textTokens(value) {
  const words = compactText(value).toLowerCase().match(/[a-z0-9]+|[\u4e00-\u9fa5]{2,}/g) || [];
  return new Set(words.filter((word) => word.length >= 2));
}

function overlapScore(left, right) {
  const a = textTokens(left);
  const b = textTokens(right);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) {
    if (b.has(token)) shared += 1;
  }
  return shared / Math.max(a.size, b.size);
}

function hasAny(value, patterns) {
  return patterns.some((pattern) => pattern.test(value));
}

export function inferTopicType(note) {
  const text = compactText(note);
  if (hasAny(text, [/bug/i, /错误/, /报错/, /失败/, /不生效/, /打不开/, /错位/, /风险/, /问题/])) return "bug";
  if (hasAny(text, [/修改/, /调整/, /改成/, /优化/, /太/, /不清楚/, /合并/, /拆分/])) return "change-request";
  if (hasAny(text, [/评价/, /清楚/, /体验/])) return "evaluation";
  return "idea";
}

export function inferModuleAndRepo({ note, target, page, feature }) {
  const haystack = [
    note,
    target?.label,
    target?.summary,
    target?.uiSurface,
    page?.title,
    page?.uiSurface,
    feature?.title,
    feature?.summary,
    feature?.repo,
    feature?.lane
  ].join(" ");
  for (const hint of moduleLaneHints) {
    if (hasAny(haystack, hint.patterns)) return { module: hint.module, repo: hint.repo };
  }
  return { module: "architecture", repo: moduleRepoMap.architecture };
}

export function findDuplicateCandidates({ note, target, discussions = [], issueTasks = [] }) {
  const targetId = target?.id || "";
  const stepId = target?.stepId || "";
  const haystack = `${note} ${target?.label || ""} ${target?.summary || ""}`;
  const discussionCandidates = discussions.map((discussion) => {
    const locationMatch = Boolean(
      (targetId && discussion.hotspotId === targetId) ||
      (stepId && discussion.operationStepId === stepId) ||
      (target?.featureId && discussion.featureId === target.featureId)
    );
    const score = Math.max(
      overlapScore(haystack, `${discussion.title || ""} ${discussion.preview || ""}`),
      locationMatch ? 0.5 : 0
    );
    return {
      kind: "discussion",
      id: discussion.id,
      title: discussion.title,
      url: discussion.url,
      score,
      reason: locationMatch ? "same-simulator-location" : "similar-text"
    };
  });
  const issueCandidates = issueTasks.map((task) => {
    const score = Math.max(
      overlapScore(haystack, `${task.title || ""} ${task.totalProblem || ""}`),
      target?.featureId && task.parentFeature?.id === target.featureId ? 0.36 : 0
    );
    return {
      kind: "issue",
      id: task.id,
      title: task.title,
      url: task.url,
      score,
      reason: target?.featureId && task.parentFeature?.id === target.featureId ? "same-feature" : "similar-text"
    };
  });
  return [...discussionCandidates, ...issueCandidates]
    .filter((candidate) => candidate.score >= 0.34)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

export function evaluateRiskGate({ note, topicType, module, duplicateCandidates = [] }) {
  const text = compactText(note);
  const reasons = [];
  const flags = {
    suspectedDuplicate: duplicateCandidates.some((candidate) => candidate.score >= 0.45),
    lowConfidence: text.length < 6,
    crossModule: hasAny(text, [/跨模块/, /跨仓/, /整体/, /架构/, /权限/, /数据库/, /api/i, /服务端/, /后台.*用户端|用户端.*后台/]),
    largeChange: hasAny(text, [/大改/, /重构/, /重新设计/, /整套/, /完整/, /全流程/, /支付/, /钱包/, /安全/])
  };
  if (flags.suspectedDuplicate) reasons.push("疑似已有讨论或正式任务");
  if (flags.lowConfidence) reasons.push("一句话说明过短，AI 置信度不足");
  if (flags.crossModule) reasons.push("可能跨模块或涉及权限/接口/架构");
  if (flags.largeChange) reasons.push("修改范围可能偏大");
  const smallClear = !reasons.length && ["bug", "change-request", "evaluation"].includes(topicType) && module !== "architecture";
  return {
    decision: smallClear ? "direct-publish" : "needs-confirmation",
    riskLevel: smallClear ? "low" : flags.suspectedDuplicate || flags.crossModule || flags.largeChange ? "high" : "medium",
    flags,
    reasons,
    label: smallClear ? "small clear issue" : "needs confirmation"
  };
}

export function buildIssueDraft({ note, target, page, feature, topicType, module, repo, duplicateCandidates = [] }) {
  const titlePrefix = topicType === "bug" ? "Bug" : topicType === "change-request" ? "Change" : topicType === "evaluation" ? "Review" : "Idea";
  const title = `[${titlePrefix}][${target?.featureId || feature?.id || module}] ${target?.label || page?.title || "UI simulator finding"}: ${compactText(note).slice(0, 60)}`;
  const body = [
    "Panel Topic Source:",
    `- UI surface: ${target?.uiSurface || page?.uiSurface || "unknown"}`,
    `- Page: ${page?.title || "unknown"}`,
    `- Target: ${target?.label || "unknown"}`,
    `- Operation step: ${target?.stepId || "unknown"}`,
    `- Feature: ${feature?.title || target?.featureId || "unknown"}`,
    "",
    "Short note:",
    compactText(note),
    "",
    "AI generated context:",
    `- Type: ${topicType}`,
    `- Module: ${module}`,
    `- Recommended repo: ${repo}`,
    `- Current behavior: ${target?.summary || page?.summary || "needs confirmation"}`,
    "- Expected behavior: make the selected simulator operation clearer, safer, or consistent with the product flow.",
    "",
    "Acceptance criteria:",
    "- The selected simulator/page behavior is updated or the reason not to change is documented.",
    "- Existing related flow still works.",
    "- Verification evidence is added to the PR or final implementation note.",
    "",
    "Duplicate/risk check:",
    duplicateCandidates.length
      ? duplicateCandidates.map((candidate) => `- ${candidate.kind}: ${candidate.title} (${Math.round(candidate.score * 100)}%) ${candidate.url || ""}`).join("\n")
      : "- No strong duplicate candidate found in the current dashboard snapshot."
  ].join("\n");
  return { title, body, repo, labels: ["from:development-panel", `module:${module}`, `topic:${topicType}`] };
}

export function createPanelTopic(input) {
  const note = compactText(input.note);
  if (!note) throw new Error("Panel Topic 需要一句短说明。");
  const topicType = inferTopicType(note);
  const { module, repo } = inferModuleAndRepo(input);
  const duplicateCandidates = findDuplicateCandidates(input);
  const riskGate = evaluateRiskGate({ note, topicType, module, duplicateCandidates });
  const issueDraft = buildIssueDraft({ ...input, note, topicType, module, repo, duplicateCandidates });
  const now = input.now || new Date().toISOString();
  const target = input.target || {};
  const page = input.page || {};
  return {
    id: input.id || `topic-${Date.parse(now) || Date.now()}-${slug(target.id || target.label || note)}`,
    status: "topic",
    createdAt: now,
    updatedAt: now,
    note,
    topicType,
    module,
    recommendedRepo: repo,
    simulatorEvidence: {
      productSurface: target.uiSurface || page.uiSurface || "",
      pageId: page.id || "",
      pageTitle: page.title || "",
      targetId: target.id || "",
      targetLabel: target.label || "",
      operationStepId: target.stepId || "",
      triggerLocation: `${page.title || "unknown"} / ${target.label || "unknown"}`,
      currentBehavior: target.summary || page.summary || "",
      screenshotRef: ""
    },
    duplicateCheck: {
      candidates: duplicateCandidates,
      topScore: duplicateCandidates[0]?.score || 0
    },
    riskGate,
    issueDraft,
    finalIssue: null,
    manualFallback: null,
    health: null
  };
}

export function buildFinalIssueRequest(topic) {
  return {
    topicId: topic.id,
    repo: topic.issueDraft.repo,
    title: topic.issueDraft.title,
    body: topic.issueDraft.body,
    labels: topic.issueDraft.labels,
    module: topic.module,
    riskGate: topic.riskGate
  };
}

export function markTopicPublished(topic, issue, now = new Date().toISOString()) {
  return {
    ...topic,
    status: "published",
    updatedAt: now,
    finalIssue: {
      repo: issue.repo || topic.issueDraft.repo,
      number: issue.number || parseIssueUrl(issue.url)?.number || null,
      url: issue.url || issue.html_url,
      title: issue.title || topic.issueDraft.title,
      boundAt: now,
      source: issue.source || "silent-publish"
    },
    manualFallback: null,
    health: null
  };
}

export function markIssuePublishingFailed(topic, error, now = new Date().toISOString()) {
  return {
    ...topic,
    status: "publish-failed",
    updatedAt: now,
    manualFallback: {
      title: topic.issueDraft.title,
      body: topic.issueDraft.body,
      repo: topic.issueDraft.repo,
      context: {
        topicId: topic.id,
        module: topic.module,
        evidence: topic.simulatorEvidence,
        riskGate: topic.riskGate
      },
      failedAt: now,
      error: error?.message || String(error || "silent publish failed")
    },
    health: {
      type: "github-publishing-failure",
      module: topic.module,
      message: "Final Implementation Issue 静默发布失败，等待手动发布或重试。",
      createdAt: now
    }
  };
}

export function parseIssueUrl(url) {
  const match = String(url || "").match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)(?:[?#].*)?$/);
  if (!match) return null;
  const repo = `${match[1]}/${match[2]}`;
  if (!allowedRepos.has(repo)) return null;
  return { owner: match[1], repo: match[2], fullName: repo, number: Number(match[3]), url: `https://github.com/${repo}/issues/${match[3]}` };
}

export function bindManualIssueUrl(topic, url, issue = {}, now = new Date().toISOString()) {
  const parsed = parseIssueUrl(url);
  if (!parsed) {
    throw new Error("Issue URL 必须来自 shichai-dev 允许的仓库。");
  }
  if (parsed.fullName !== topic.issueDraft.repo) {
    throw new Error(`Issue 仓库不匹配：期望 ${topic.issueDraft.repo}。`);
  }
  const issueTitle = compactText(issue.title || "");
  if (issueTitle && overlapScore(issueTitle, topic.issueDraft.title) < 0.2) {
    throw new Error("Issue 标题与草稿标题差异过大，请确认是否绑定错了。");
  }
  return markTopicPublished(topic, {
    repo: parsed.fullName,
    number: parsed.number,
    url: parsed.url,
    title: issueTitle || topic.issueDraft.title,
    source: "manual-url-binding"
  }, now);
}

export function findIssueBackfillCandidates(topic, issueTasks = []) {
  if (!topic?.manualFallback && !topic?.issueDraft) return [];
  const expectedRepo = topic.issueDraft.repo;
  const expectedTitle = topic.issueDraft.title;
  return (Array.isArray(issueTasks) ? issueTasks : [])
    .filter((task) => task.url && task.repo === expectedRepo)
    .map((task) => ({
      id: task.id,
      repo: task.repo,
      number: task.number,
      title: task.title,
      url: task.url,
      score: Math.max(
        overlapScore(expectedTitle, task.title),
        overlapScore(topic.note, `${task.title || ""} ${task.totalProblem || ""}`)
      )
    }))
    .filter((candidate) => candidate.score >= 0.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

export function buildFormalTaskFromTopic(topic) {
  if (!topic.finalIssue?.url) return null;
  return {
    id: topic.finalIssue.url.replace("https://github.com/", ""),
    source: "development-ai-middleware",
    panelTopicId: topic.id,
    repo: topic.finalIssue.repo,
    repoName: topic.finalIssue.repo.split("/").pop(),
    number: topic.finalIssue.number,
    title: topic.finalIssue.title,
    url: topic.finalIssue.url,
    state: "OPEN",
    labels: topic.issueDraft.labels,
    lane: topic.module,
    status: topic.claim?.claimant ? "in-progress" : "open",
    statusLabel: topic.claim?.claimant ? "开发中" : "待接单",
    claimant: topic.claim?.claimant || null,
    claimedAt: topic.claim?.claimedAt || null,
    elapsedHours: null,
    createdAt: topic.finalIssue.boundAt,
    updatedAt: topic.updatedAt,
    closedAt: null,
    parentIssue: null,
    parentFeature: {
      id: topic.simulatorEvidence.operationStepId || topic.simulatorEvidence.targetId,
      title: topic.simulatorEvidence.targetLabel || topic.simulatorEvidence.pageTitle,
      summary: topic.note,
      status: "planned",
      lane: topic.module
    },
    totalProblem: topic.note,
    claimCommand: "/claim",
    commandHelp: "这是面板中台生成的 Formal Task。优先在面板内认领，GitHub 映射后台同步。"
  };
}

export function claimFormalTaskTopic(topic, claimant, now = new Date().toISOString()) {
  const login = compactText(claimant);
  if (!login) throw new Error("认领需要 GitHub 用户名。");
  if (topic.claim?.claimant && topic.claim.claimant !== login) {
    throw new Error(`这个任务已由 @${topic.claim.claimant} 认领。`);
  }
  return {
    ...topic,
    updatedAt: now,
    claim: {
      claimant: login,
      claimedAt: topic.claim?.claimedAt || now,
      source: "panel-led-claim"
    }
  };
}

export function releaseFormalTaskTopic(topic, claimant, now = new Date().toISOString()) {
  const login = compactText(claimant);
  if (topic.claim?.claimant && topic.claim.claimant !== login) {
    throw new Error(`释放失败：当前认领人是 @${topic.claim.claimant}。`);
  }
  return {
    ...topic,
    updatedAt: now,
    claim: null
  };
}

export function buildAgentHandoffPackageFromTopicTask(task, topic) {
  return {
    source: "development-ai-middleware",
    generatedAt: new Date().toISOString(),
    panelTopic: {
      id: topic.id,
      note: topic.note,
      type: topic.topicType,
      riskGate: topic.riskGate,
      duplicateCheck: topic.duplicateCheck
    },
    simulatorEvidence: topic.simulatorEvidence,
    task: {
      id: task.id,
      issueUrl: task.url,
      repo: task.repo,
      number: task.number,
      title: task.title,
      module: topic.module,
      claimant: task.claimant || ""
    },
    issueDraft: topic.issueDraft,
    acceptance: [
      "解决 Final Implementation Issue 描述的具体问题。",
      "保留面板 claim 和 GitHub issue/PR 映射边界。",
      "不要自动合并、部署、发布或修改凭据。",
      "如发现范围扩大，在本地 Codex 线程中说明并由开发者判断。"
    ],
    verification: [
      "运行目标仓库已有的最小相关检查。",
      "前端变更需要提供页面或流程验证证据。",
      "最终回复说明修改文件、验证结果和残余风险。"
    ]
  };
}

export function buildBridgeLaunchPackageFromTopicTask(task, topic, options = {}) {
  return {
    taskId: task.id,
    issueUrl: task.url,
    title: task.title,
    goal: [
      `处理已认领的 Final Implementation Issue：${task.title}`,
      `来源 Panel Topic：${topic.id}`,
      `UI 位置：${topic.simulatorEvidence.triggerLocation}`,
      `短说明：${topic.note}`
    ].join("\n"),
    claimant: task.claimant || options.claimant || "",
    module: topic.module,
    recommendedRepo: task.repo,
    threadId: options.threadId || undefined,
    handoffPackage: buildAgentHandoffPackageFromTopicTask(task, topic),
    permissionEnvelope: {
      codex: {
        developerInstructions: [
          `Bound OPC task: ${task.id}`,
          `Panel topic: ${topic.id}`,
          `Module scope: ${topic.module}`,
          "Do not merge, deploy, release, or change production credentials.",
          "Use the repository bound by the bridge. Do not work in unrelated local projects.",
          "If the issue becomes broader than this package, explain it in the Codex thread and wait for developer steering."
        ].join("\n")
      }
    }
  };
}
