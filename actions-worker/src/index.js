const allowedRepoNames = new Set([
  "feature-dashboard",
  "planning",
  "opc-bounty-client",
  "opc-bounty-admin",
  "opc-bounty-server"
]);

const developmentModules = [
  "client frontend",
  "admin frontend",
  "backend",
  "dashboard",
  "qa-release",
  "architecture"
];

const developmentModuleRepoMap = {
  "client frontend": "shichai-dev/opc-bounty-client",
  "admin frontend": "shichai-dev/opc-bounty-admin",
  backend: "shichai-dev/opc-bounty-server",
  dashboard: "shichai-dev/feature-dashboard",
  "qa-release": "shichai-dev/planning",
  architecture: "shichai-dev/planning"
};

const developmentAllowedRepos = new Set(Object.values(developmentModuleRepoMap));

const claimLabels = {
  open: { name: "接单:待接单", color: "fff4df", description: "Issue 正在等待成员或 AI 接单" },
  claimed: { name: "接单:已接单", color: "e8f7ef", description: "Issue 已有唯一接单人" },
  progress: { name: "接单:开发中", color: "0969da", description: "接单人正在实现" },
  waitingPr: { name: "接单:等待PR", color: "6f42c1", description: "实现完成，等待合并请求" },
  reviewing: { name: "接单:审查中", color: "4338ca", description: "合并请求正在审查" },
  blocked: { name: "接单:阻塞", color: "be2f2f", description: "任务被依赖、权限或需求问题阻塞" },
  closed: { name: "接单:已关闭", color: "138a52", description: "Issue 已关闭" }
};

const allClaimLabelNames = Object.values(claimLabels).map((label) => label.name);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(data, status = 200, origin = "") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders(origin)
    }
  });
}

function corsHeaders(origin = "") {
  return {
    "access-control-allow-origin": origin || "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,x-shichai-action-key",
    "access-control-max-age": "86400",
    "vary": "Origin"
  };
}

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function responseOrigin(request, env) {
  const origin = request.headers.get("origin") || "";
  const allowed = allowedOrigins(env);
  if (!origin) return "";
  return allowed.includes(origin) ? origin : allowed[0] || "";
}

async function readJson(request) {
  const size = Number(request.headers.get("content-length") || "0");
  if (size > 120000) throw new HttpError(413, "提交内容过大，请缩短评论内容。");
  return await request.json().catch(() => {
    throw new HttpError(400, "请求内容不是有效 JSON。");
  });
}

function bytes(value) {
  return new TextEncoder().encode(String(value || ""));
}

function constantTimeEqual(left, right) {
  const a = bytes(left);
  const b = bytes(right);
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let index = 0; index < length; index += 1) {
    diff |= (a[index] || 0) ^ (b[index] || 0);
  }
  return diff === 0;
}

function cleanText(value, max = 4000) {
  return String(value || "")
    .replace(/\r/g, "")
    .trim()
    .slice(0, max);
}

function cleanObject(value, keys) {
  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(keys.map((key) => [key, cleanText(source[key], 1200)]));
}

function cleanList(value, maxItems, keys) {
  return (Array.isArray(value) ? value : [])
    .slice(0, maxItems)
    .map((item) => cleanObject(item, keys));
}

function assertActor(env, actor) {
  const login = cleanText(actor, 80);
  if (!/^[A-Za-z0-9-]{1,39}$/.test(login)) {
    throw new HttpError(400, "GitHub 用户名格式不正确。");
  }
  const allowed = String(env.ALLOWED_ACTORS || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length && !allowed.includes(login.toLowerCase())) {
    throw new HttpError(403, `用户 ${login} 不在允许接单名单中。`);
  }
  return login;
}

function assertActionKey(request, env) {
  const expected = env.DASHBOARD_ACTION_KEY || "";
  const provided = request.headers.get("x-shichai-action-key") || "";
  if (!expected || !constantTimeEqual(provided, expected)) {
    throw new HttpError(401, "团队操作口令不正确，或动作接口尚未配置 DASHBOARD_ACTION_KEY。");
  }
}

function splitRepo(env, repoFullName) {
  const owner = env.GITHUB_OWNER || "shichai-dev";
  const value = String(repoFullName || "");
  const [repoOwner, repoName] = value.includes("/") ? value.split("/") : [owner, value];
  if (repoOwner !== owner || !allowedRepoNames.has(repoName)) {
    throw new HttpError(400, `不允许操作仓库 ${value}。`);
  }
  return { owner: repoOwner, repo: repoName, fullName: `${repoOwner}/${repoName}` };
}

function parseIssueUrl(env, url) {
  const owner = env.GITHUB_OWNER || "shichai-dev";
  const match = String(url || "").match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);
  if (!match) return null;
  if (match[1] !== owner || !allowedRepoNames.has(match[2])) return null;
  return { owner, repo: match[2], number: Number(match[3]), fullName: `${owner}/${match[2]}` };
}

function labelNames(issue) {
  return (issue.labels || []).map((label) => typeof label === "string" ? label : label.name).filter(Boolean);
}

function safeLabels(labels) {
  return (Array.isArray(labels) ? labels : [])
    .map((label) => cleanText(label, 48))
    .filter(Boolean)
    .slice(0, 8);
}

function titleOverlap(left, right) {
  const compact = (value) => String(value || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const a = new Set(compact(left).split(/\s+/).filter((word) => word.length >= 2));
  const b = new Set(compact(right).split(/\s+/).filter((word) => word.length >= 2));
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) {
    if (b.has(token)) shared += 1;
  }
  return shared / Math.max(a.size, b.size);
}

function firstAssignee(issue) {
  return issue.assignees?.[0]?.login || null;
}

async function github(env, method, path, body = null) {
  if (!env.GITHUB_TOKEN) {
    throw new HttpError(500, "动作接口缺少 GITHUB_TOKEN。");
  }
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      "accept": "application/vnd.github+json",
      "authorization": `Bearer ${env.GITHUB_TOKEN}`,
      "content-type": "application/json",
      "user-agent": "shichai-dashboard-actions",
      "x-github-api-version": "2022-11-28"
    },
    body: body ? JSON.stringify(body) : null
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new HttpError(response.status, data.message || `GitHub API 请求失败：${response.status}`);
  }
  return data;
}

async function ensureLabel(env, target, label) {
  try {
    await github(env, "GET", `/repos/${target.fullName}/labels/${encodeURIComponent(label.name)}`);
  } catch (error) {
    if (error.status !== 404) throw error;
    await github(env, "POST", `/repos/${target.fullName}/labels`, {
      name: label.name,
      color: label.color,
      description: label.description
    });
  }
}

async function addLabels(env, target, issueNumber, labels) {
  for (const label of labels) {
    await ensureLabel(env, target, label);
  }
  await github(env, "POST", `/repos/${target.fullName}/issues/${issueNumber}/labels`, {
    labels: labels.map((label) => label.name)
  });
}

async function removeLabels(env, target, issueNumber, names) {
  for (const name of names) {
    try {
      await github(env, "DELETE", `/repos/${target.fullName}/issues/${issueNumber}/labels/${encodeURIComponent(name)}`);
    } catch (error) {
      if (error.status !== 404) throw error;
    }
  }
}

async function getIssue(env, target, issueNumber) {
  return await github(env, "GET", `/repos/${target.fullName}/issues/${issueNumber}`);
}

async function listComments(env, target, issueNumber) {
  return await github(env, "GET", `/repos/${target.fullName}/issues/${issueNumber}/comments?per_page=100`);
}

async function comment(env, target, issueNumber, body) {
  await github(env, "POST", `/repos/${target.fullName}/issues/${issueNumber}/comments`, { body });
}

async function resolveTargetIssue(env, target, issueNumber) {
  const dashboardRepo = env.DASHBOARD_REPO || "feature-dashboard";
  const issue = await getIssue(env, target, issueNumber);
  if (target.repo !== dashboardRepo || !labelNames(issue).includes("dispatch:sent")) {
    return { target, issueNumber, issue, redirected: false };
  }
  const comments = await listComments(env, target, issueNumber);
  const text = [issue.body || "", ...comments.map((item) => item.body || "")].join("\n");
  const targetUrl = text.match(/(?:已分发目标|分发目标|目标 Issue|Dispatched issue)\s*[:：]\s*(https:\/\/github\.com\/[^\s)]+)/i)?.[1];
  const parsed = parseIssueUrl(env, targetUrl);
  if (!parsed || parsed.repo === target.repo && parsed.number === issueNumber) {
    return { target, issueNumber, issue, redirected: false };
  }
  const redirectedTarget = splitRepo(env, parsed.fullName);
  return {
    target: redirectedTarget,
    issueNumber: parsed.number,
    issue: await getIssue(env, redirectedTarget, parsed.number),
    redirected: true
  };
}

async function triggerRefresh(env) {
  const owner = env.GITHUB_OWNER || "shichai-dev";
  const dashboardRepo = env.DASHBOARD_REPO || "feature-dashboard";
  const ref = env.DASHBOARD_REF || "main";
  try {
    await github(env, "POST", `/repos/${owner}/${dashboardRepo}/actions/workflows/refresh-dashboard.yml/dispatches`, { ref });
  } catch (error) {
    console.warn(JSON.stringify({ message: "refresh trigger failed", error: error.message }));
  }
}

function developmentAiBaseUrl(env) {
  return cleanText(env.DEVELOPMENT_AI_BASE_URL || "", 300).replace(/\/+$/, "");
}

function developmentAiDirectConfig(env) {
  return {
    enabled: Boolean(env.DEVELOPMENT_AI_DEEPSEEK_API_KEY || env.DEEPSEEK_API_KEY),
    apiKey: env.DEVELOPMENT_AI_DEEPSEEK_API_KEY || env.DEEPSEEK_API_KEY || "",
    baseUrl: cleanText(env.DEVELOPMENT_AI_DEEPSEEK_BASE_URL || "https://api.deepseek.com", 300).replace(/\/+$/, ""),
    model: cleanText(env.DEVELOPMENT_AI_DEEPSEEK_MODEL || "deepseek-v4-flash", 100),
    maxTokens: boundedInteger(env.DEVELOPMENT_AI_DEEPSEEK_MAX_TOKENS, 4000, 1000, 12000),
    temperature: boundedNumber(env.DEVELOPMENT_AI_DEEPSEEK_TEMPERATURE, 0.1, 0, 2)
  };
}

async function upstreamJson(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new HttpError(response.status || 502, data.message || data.error || "中台 AI 服务调用失败。");
  }
  return data;
}

async function handleDevelopmentAiHealth(env, origin) {
  const direct = developmentAiDirectConfig(env);
  if (direct.enabled) {
    return json({
      ok: true,
      service: "shichai-dashboard-actions",
      developmentAi: {
        ok: true,
        service: "shichai-development-ai",
        runtime: {
          ready: true,
          mode: "deepseek",
          provider: "worker-deepseek",
          authStatus: "api_key_configured",
          runtimeStatus: "api_available",
          runtimeVersion: "",
          model: direct.model,
          baseUrl: direct.baseUrl,
          vision: {
            enabled: false,
            ready: true,
            blocking: false,
            mode: "disabled",
            provider: "none",
            authStatus: "not_required",
            runtimeStatus: "disabled",
            model: "",
            baseUrl: "",
            onboarding: []
          },
          serviceTokenConfigured: true,
          onboarding: []
        }
      }
    }, 200, origin);
  }
  const baseUrl = developmentAiBaseUrl(env);
  if (!baseUrl) {
    throw new HttpError(503, "中台 AI 尚未配置 DeepSeek Secret 或 DEVELOPMENT_AI_BASE_URL。");
  }
  const response = await fetch(`${baseUrl}/api/development-ai/health`, {
    headers: { "user-agent": "shichai-dashboard-actions" }
  });
  const data = await upstreamJson(response);
  return json({
    ok: true,
    service: "shichai-dashboard-actions",
    developmentAi: data
  }, 200, origin);
}

async function handleDevelopmentAiTopicDraft(request, env, origin) {
  assertActionKey(request, env);
  const body = await readJson(request);
  const actor = assertActor(env, body.actor);
  const direct = developmentAiDirectConfig(env);
  if (direct.enabled) {
    return json({
      ok: true,
      service: "shichai-development-ai",
      topic: await generateWorkerDevelopmentTopic({ ...body, actor }, direct)
    }, 200, origin);
  }
  const baseUrl = developmentAiBaseUrl(env);
  const aiKey = env.DEVELOPMENT_AI_KEY || "";
  if (!baseUrl || !aiKey) {
    throw new HttpError(503, "中台 AI 服务尚未配置 DEVELOPMENT_AI_BASE_URL 或 DEVELOPMENT_AI_KEY。");
  }
  const response = await fetch(`${baseUrl}/api/development-ai/topic-draft`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "shichai-dashboard-actions",
      "x-development-ai-key": aiKey
    },
    body: JSON.stringify({
      ...body,
      actor
    })
  });
  return json(await upstreamJson(response), 200, origin);
}

async function generateWorkerDevelopmentTopic(input, config) {
  const request = normalizeDevelopmentTopicInput(input);
  const now = request.now || new Date().toISOString();
  const prompt = buildDevelopmentAiPrompt(request);
  const result = await callDeepSeekCoordinator(config, prompt);
  return normalizeDevelopmentTopicOutput(result.json, request, now, {
    source: "worker-deepseek",
    provider: "deepseek",
    model: result.model,
    responseId: result.responseId,
    usage: result.usage,
    vision: normalizeWorkerVisionContext(request.visualContext)
  });
}

function normalizeDevelopmentTopicInput(input) {
  const value = input && typeof input === "object" ? input : {};
  const request = {
    actor: cleanText(value.actor, 80),
    note: cleanText(value.note, 1000),
    now: cleanText(value.now, 80),
    target: cleanObject(value.target, ["id", "label", "summary", "uiSurface", "stepId", "featureId"]),
    page: cleanObject(value.page, ["id", "title", "summary", "uiSurface"]),
    feature: cleanObject(value.feature, ["id", "title", "summary", "repo", "lane", "status"]),
    visualContext: normalizeWorkerVisualInput(value.visualContext || value.visionContext),
    discussions: cleanList(value.discussions, 20, ["id", "title", "preview", "url", "hotspotId", "operationStepId", "featureId"]),
    issueTasks: cleanList(value.issueTasks, 30, ["id", "repo", "number", "title", "url", "totalProblem", "state", "status"])
  };
  if (!request.note) throw new HttpError(400, "Panel Topic 需要一句短说明。");
  if (JSON.stringify(request).length > 120000) {
    throw new HttpError(413, "Development AI input is too large.");
  }
  return request;
}

async function callDeepSeekCoordinator(config, prompt) {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        {
          role: "system",
          content: "你是拾柴开发面板的中台协调 AI。只返回严格 JSON，不输出 Markdown、解释、代码块或额外文字。"
        },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
      temperature: config.temperature,
      max_tokens: config.maxTokens,
      stream: false
    })
  });
  const data = await response.json().catch(() => {
    throw new HttpError(502, `DeepSeek 返回非 JSON 响应：${response.status}`);
  });
  if (!response.ok) {
    throw new HttpError(response.status || 502, `DeepSeek 调用失败：${sanitizeProviderMessage(data?.error?.message || data?.message || response.status)}`);
  }
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new HttpError(502, "DeepSeek 响应缺少 message content。");
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new HttpError(502, "DeepSeek 返回内容不是有效 JSON。");
  }
  return {
    json: parsed,
    usage: data.usage || null,
    responseId: cleanText(data.id, 160),
    model: cleanText(data.model, 120) || config.model
  };
}

function buildDevelopmentAiPrompt(request) {
  return [
    "请为拾柴开发面板生成 Panel Topic 结构化结果。",
    "",
    "边界：",
    "- 你是中台协调 AI，只做分类、上下文补全、查重、风险门槛、issue 草稿和 handoff 摘要。",
    "- 不实现代码、不运行测试、不发 PR、不合并、不部署、不要求访问源码。",
    "- 小且明确、低风险、单模块、可回滚的问题可 direct-publish；疑似重复、低置信、跨模块、大改必须 needs-confirmation。",
    "- GitHub 写入由受控动作执行层完成，你这里只生成草稿。",
    "- visualContext 是浏览器提供的页面/截图上下文摘要；如果没有真实图像识别，不要声称你看到了截图。",
    "",
    "请只返回 JSON，字段包括：topicType、module、recommendedRepo、simulatorEvidence、duplicateCheck、riskGate、issueDraft、agentHandoffSummary。",
    "可选值：",
    `- module: ${developmentModules.join(", ")}`,
    `- repo: ${[...developmentAllowedRepos].join(", ")}`,
    "- topicType: bug, change-request, evaluation, idea",
    "- riskGate.decision: direct-publish 或 needs-confirmation",
    "",
    "输入：",
    JSON.stringify(request, null, 2)
  ].join("\n");
}

function normalizeDevelopmentTopicOutput(output, request, now, metadata) {
  const value = output && typeof output === "object" ? output : {};
  const module = developmentModules.includes(value.module) ? value.module : inferDevelopmentModule(request);
  const recommendedRepo = developmentAllowedRepos.has(value.recommendedRepo) ? value.recommendedRepo : developmentModuleRepoMap[module];
  const topicType = ["bug", "change-request", "evaluation", "idea"].includes(value.topicType) ? value.topicType : inferDevelopmentTopicType(request.note);
  const duplicateCheck = normalizeDevelopmentDuplicateCheck(value.duplicateCheck);
  const riskGate = normalizeDevelopmentRiskGate(value.riskGate, request, module);
  const simulatorEvidence = normalizeDevelopmentSimulatorEvidence(value.simulatorEvidence, request);
  const issueDraft = normalizeDevelopmentIssueDraft(value.issueDraft, { topicType, module, recommendedRepo, request, duplicateCheck });
  return {
    id: `topic-${Date.parse(now) || Date.now()}-${slug(request.target.id || request.target.label || request.note)}`,
    status: "topic",
    createdAt: now,
    updatedAt: now,
    note: request.note,
    topicType,
    module,
    recommendedRepo,
    simulatorEvidence,
    duplicateCheck,
    riskGate,
    issueDraft,
    finalIssue: null,
    manualFallback: null,
    health: null,
    coordinator: {
      ...metadata,
      generatedAt: now,
      agentHandoffSummary: cleanText(value.agentHandoffSummary, 2000)
    }
  };
}

function normalizeDevelopmentSimulatorEvidence(evidence, request) {
  const value = evidence && typeof evidence === "object" ? evidence : {};
  return {
    productSurface: cleanText(value.productSurface, 160) || request.target.uiSurface || request.page.uiSurface || "",
    pageId: cleanText(value.pageId, 120) || request.page.id || "",
    pageTitle: cleanText(value.pageTitle, 160) || request.page.title || "",
    targetId: cleanText(value.targetId, 160) || request.target.id || "",
    targetLabel: cleanText(value.targetLabel, 160) || request.target.label || "",
    operationStepId: cleanText(value.operationStepId, 160) || request.target.stepId || "",
    triggerLocation: cleanText(value.triggerLocation, 300) || `${request.page.title || "unknown"} / ${request.target.label || "unknown"}`,
    currentBehavior: cleanText(value.currentBehavior, 1000) || request.target.summary || request.page.summary || "",
    expectedBehavior: cleanText(value.expectedBehavior, 1000) || "让所选模拟器流程更清晰、更安全或更符合当前产品语义。",
    screenshotRef: cleanText(value.screenshotRef, 500) || request.visualContext.screenshotRef || ""
  };
}

function normalizeDevelopmentDuplicateCheck(duplicateCheck) {
  const value = duplicateCheck && typeof duplicateCheck === "object" ? duplicateCheck : {};
  const candidates = (Array.isArray(value.candidates) ? value.candidates : []).slice(0, 5).map((item) => ({
    kind: item.kind === "issue" ? "issue" : "discussion",
    id: cleanText(item.id, 160),
    title: cleanText(item.title, 240),
    url: cleanText(item.url, 500),
    score: clamp01(item.score),
    reason: cleanText(item.reason, 160)
  }));
  return {
    candidates,
    topScore: candidates.length ? Math.max(...candidates.map((item) => item.score)) : clamp01(value.topScore),
    summary: cleanText(value.summary, 1000)
  };
}

function normalizeDevelopmentRiskGate(riskGate, request, module) {
  const value = riskGate && typeof riskGate === "object" ? riskGate : {};
  const text = `${request.note} ${request.target.label} ${request.target.summary}`;
  const flags = {
    suspectedDuplicate: Boolean(value.flags?.suspectedDuplicate),
    lowConfidence: Boolean(value.flags?.lowConfidence || request.note.length < 6),
    crossModule: Boolean(value.flags?.crossModule || /跨模块|跨仓|整体|架构|权限|数据库|api|服务端|后台.*用户端|用户端.*后台/i.test(text)),
    largeChange: Boolean(value.flags?.largeChange || /大改|重构|重新设计|整套|完整|全流程|支付|钱包|安全/.test(text))
  };
  const generatedReasons = [];
  if (flags.suspectedDuplicate) generatedReasons.push("疑似已有讨论或正式任务");
  if (flags.lowConfidence) generatedReasons.push("一句话说明过短，AI 置信度不足");
  if (flags.crossModule) generatedReasons.push("可能跨模块或涉及权限/接口/架构");
  if (flags.largeChange) generatedReasons.push("修改范围可能偏大");
  const decision = value.decision === "direct-publish" || value.decision === "needs-confirmation"
    ? value.decision
    : generatedReasons.length || module === "architecture" ? "needs-confirmation" : "direct-publish";
  return {
    decision,
    riskLevel: ["low", "medium", "high"].includes(value.riskLevel)
      ? value.riskLevel
      : decision === "direct-publish" ? "low" : flags.crossModule || flags.largeChange ? "high" : "medium",
    label: decision === "direct-publish" ? "small clear issue" : "needs confirmation",
    reasons: arrayOfStrings(value.reasons, 8, 160).length ? arrayOfStrings(value.reasons, 8, 160) : generatedReasons,
    flags
  };
}

function normalizeDevelopmentIssueDraft(issueDraft, { topicType, module, recommendedRepo, request, duplicateCheck }) {
  const value = issueDraft && typeof issueDraft === "object" ? issueDraft : {};
  const titlePrefix = topicType === "bug" ? "Bug" : topicType === "change-request" ? "Change" : topicType === "evaluation" ? "Review" : "Idea";
  const visualSummary = request.visualContext.domText || request.visualContext.selectedElement.label || "";
  const body = cleanText(value.body, 12000) || [
    "Panel Topic Source:",
    `- UI surface: ${request.target.uiSurface || request.page.uiSurface || "unknown"}`,
    `- Page: ${request.page.title || "unknown"}`,
    `- Target: ${request.target.label || "unknown"}`,
    `- Operation step: ${request.target.stepId || "unknown"}`,
    `- Feature: ${request.feature.title || request.target.featureId || "unknown"}`,
    "",
    "Short note:",
    request.note,
    "",
    "Coordinator generated context:",
    `- Type: ${topicType}`,
    `- Module: ${module}`,
    `- Recommended repo: ${recommendedRepo}`,
    `- Duplicate summary: ${duplicateCheck.summary || "No strong duplicate candidate found."}`,
    visualSummary ? `- Visual context: ${visualSummary}` : "",
    "",
    "Acceptance criteria:",
    "- The selected simulator/page behavior is updated or the reason not to change is documented.",
    "- Existing related flow still works.",
    "- Verification evidence is added to the PR or final implementation note."
  ].join("\n").replace(/\n{3,}/g, "\n\n");
  return {
    title: cleanText(value.title, 180) || `[${titlePrefix}][${request.target.featureId || request.feature.id || module}] ${request.target.label || request.page.title || "UI simulator finding"}: ${request.note.slice(0, 60)}`,
    body,
    repo: developmentAllowedRepos.has(value.repo) ? value.repo : recommendedRepo,
    labels: arrayOfStrings(value.labels, 8, 80).length ? arrayOfStrings(value.labels, 8, 80) : ["from:development-panel", `module:${module}`, `topic:${topicType}`]
  };
}

function inferDevelopmentModule(request) {
  const text = [
    request.note,
    request.target.label,
    request.target.summary,
    request.target.uiSurface,
    request.page.title,
    request.page.uiSurface,
    request.feature.title,
    request.feature.summary,
    request.feature.repo,
    request.feature.lane
  ].join(" ");
  if (/client|用户端|首页|展示台|发布|个人页/i.test(text)) return "client frontend";
  if (/admin|管理端|后台|审核|运营/i.test(text)) return "admin frontend";
  if (/server|backend|api|接口|数据库|钱包|账本|权限|对象存储/i.test(text)) return "backend";
  if (/dashboard|看板|面板|仿真平台|feature-dashboard/i.test(text)) return "dashboard";
  if (/qa|测试|验证|release/i.test(text)) return "qa-release";
  return "architecture";
}

function inferDevelopmentTopicType(note) {
  if (/bug|错误|报错|失败|不生效|打不开|错位|风险|问题/i.test(note)) return "bug";
  if (/修改|调整|改成|优化|太|不清楚|合并|拆分/.test(note)) return "change-request";
  if (/评价|清楚|体验/.test(note)) return "evaluation";
  return "idea";
}

function normalizeWorkerVisualInput(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    screenshotRef: cleanText(source.screenshotRef, 500),
    domText: cleanText(source.domText || source.visibleText || source.pageText, 4000),
    pageState: cleanText(source.pageState, 1000),
    viewport: {
      width: boundedInteger(source.viewport?.width, 0, 0, 10000),
      height: boundedInteger(source.viewport?.height, 0, 0, 10000),
      deviceScaleFactor: boundedNumber(source.viewport?.deviceScaleFactor, 0, 0, 10)
    },
    selectedElement: {
      tag: cleanText(source.selectedElement?.tag, 80),
      role: cleanText(source.selectedElement?.role, 80),
      label: cleanText(source.selectedElement?.label || source.selectedElement?.ariaLabel, 200),
      text: cleanText(source.selectedElement?.text, 500),
      testId: cleanText(source.selectedElement?.testId, 120)
    }
  };
}

function normalizeWorkerVisionContext(visualContext) {
  const hasContext = Boolean(visualContext.screenshotRef || visualContext.domText || visualContext.selectedElement.label || visualContext.selectedElement.text);
  return {
    status: hasContext ? "text_only" : "not_provided",
    provider: "worker-text-context",
    summary: visualContext.domText || visualContext.selectedElement.label || "",
    screenshotRef: visualContext.screenshotRef,
    inputKinds: [
      visualContext.screenshotRef ? "screenshot-ref" : "",
      visualContext.domText ? "dom-text" : "",
      visualContext.selectedElement.label || visualContext.selectedElement.text ? "selected-element" : ""
    ].filter(Boolean),
    limitations: ["Worker free path uses browser-provided visual context only; no multimodal screenshot recognition is enabled."]
  };
}

function arrayOfStrings(value, maxItems, maxLength) {
  return (Array.isArray(value) ? value : [])
    .map((item) => cleanText(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(1, Math.max(0, number));
}

function slug(value) {
  return cleanText(value, 120).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "topic";
}

function boundedInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(number)));
}

function boundedNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function sanitizeProviderMessage(message = "") {
  return String(message || "Provider unavailable.")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-[redacted]")
    .slice(0, 500);
}

async function handleDiscussion(request, env, ctx, origin) {
  assertActionKey(request, env);
  const body = await readJson(request);
  const actor = assertActor(env, body.actor);
  const owner = env.GITHUB_OWNER || "shichai-dev";
  const dashboardRepo = env.DASHBOARD_REPO || "feature-dashboard";
  const target = splitRepo(env, `${owner}/${dashboardRepo}`);
  const type = cleanText(body.type || "idea", 40);
  const featureId = cleanText(body.featureId || "未映射", 80);
  const title = cleanText(body.title || "面板讨论", 180);
  const issueBody = [
    `功能编号: ${featureId}`,
    `功能: ${cleanText(body.featureTitle || featureId, 180)}`,
    `界面页面: ${cleanText(body.uiSurface || "", 180)}`,
    `操作步骤: ${cleanText(body.operationStepId || "", 180)}`,
    `热点编号: ${cleanText(body.hotspotId || "", 180)}`,
    `讨论类型: ${type}`,
    "",
    "选中的界面:",
    `- 页面: ${cleanText(body.pageTitle || "", 180)}`,
    `- 操作点: ${cleanText(body.targetLabel || "", 180)}`,
    `- 当前行为: ${cleanText(body.targetSummary || "", 800)}`,
    "",
    "建议或评价:",
    cleanText(body.body || "", 5000),
    "",
    "面板提交信息:",
    `- 提交人: @${actor}`,
    `- 提交时间: ${new Date().toISOString()}`,
    "",
    "希望智能助手处理:",
    "- [ ] 汇总这条讨论",
    "- [ ] 判断是否影响功能状态",
    "- [ ] 若已采纳则拆成实现议题",
    "- [ ] 若替代旧讨论则标记旧评论过期"
  ].join("\n");
  const labels = [
    { name: "dashboard-discussion", color: "0a66c2", description: "来自公开 Dashboard 的结构化讨论" },
    { name: "dispatch:pending", color: "fff4df", description: "等待自动分发到目标仓库" },
    { name: `discussion:${type}`, color: "bbcabf", description: "讨论类型" }
  ];
  if (featureId && featureId !== "未映射") {
    labels.push({ name: `feature:${featureId}`, color: "e8f7ef", description: "关联功能编号" });
  }
  for (const label of labels) {
    await ensureLabel(env, target, label);
  }
  const issue = await github(env, "POST", `/repos/${target.fullName}/issues`, {
    title,
    body: issueBody,
    labels: labels.map((label) => label.name)
  });
  ctx.waitUntil(triggerRefresh(env));
  return json({
    ok: true,
    issueUrl: issue.html_url,
    message: "讨论已在面板内提交。系统会自动分发到目标仓库，并刷新看板。"
  }, 201, origin);
}

async function handleIssueCommand(request, env, ctx, origin) {
  assertActionKey(request, env);
  const body = await readJson(request);
  const actor = assertActor(env, body.actor);
  const sourceTarget = splitRepo(env, body.repo);
  const sourceNumber = Number(body.number);
  if (!Number.isInteger(sourceNumber) || sourceNumber < 1) {
    throw new HttpError(400, "Issue 编号不正确。");
  }
  const resolved = await resolveTargetIssue(env, sourceTarget, sourceNumber);
  const target = resolved.target;
  const issueNumber = resolved.issueNumber;
  const issue = resolved.issue;
  const action = cleanText(body.command, 40);
  const argument = cleanText(body.argument || "", 500);
  const currentOwner = firstAssignee(issue);
  const now = new Date().toISOString();

  if (action === "claim") {
    if (currentOwner && currentOwner !== actor) {
      throw new HttpError(409, `接单失败：这个任务已由 @${currentOwner} 接手。`);
    }
    if (!currentOwner) {
      await github(env, "POST", `/repos/${target.fullName}/issues/${issueNumber}/assignees`, { assignees: [actor] });
    }
    await removeLabels(env, target, issueNumber, [claimLabels.open.name, claimLabels.blocked.name, claimLabels.closed.name]);
    await addLabels(env, target, issueNumber, [claimLabels.claimed, claimLabels.progress]);
    await comment(env, target, issueNumber, [
      "面板内接单成功。",
      "",
      `- 接单人: @${actor}`,
      `- 接单时间: ${now}`,
      "- 当前状态: 已接单 / 开发中",
      resolved.redirected ? `- 源讨论: ${sourceTarget.fullName}#${sourceNumber}` : ""
    ].filter(Boolean).join("\n"));
  } else if (action === "unclaim") {
    if (currentOwner !== actor) {
      throw new HttpError(409, `放弃失败：当前接单人是 ${currentOwner ? `@${currentOwner}` : "空"}。`);
    }
    await github(env, "DELETE", `/repos/${target.fullName}/issues/${issueNumber}/assignees`, { assignees: [actor] });
    await removeLabels(env, target, issueNumber, [claimLabels.claimed.name, claimLabels.progress.name, claimLabels.waitingPr.name, claimLabels.reviewing.name, claimLabels.blocked.name]);
    await addLabels(env, target, issueNumber, [claimLabels.open]);
    await comment(env, target, issueNumber, `@${actor} 已在面板内放弃接单，任务回到待接单状态。`);
  } else if (action === "handoff") {
    const targetLogin = argument.match(/@?([A-Za-z0-9-]{1,39})/)?.[1];
    if (!targetLogin) throw new HttpError(400, "转交需要填写 @用户名。");
    if (currentOwner && currentOwner !== actor) {
      throw new HttpError(409, `转交失败：当前接单人是 @${currentOwner}。`);
    }
    if (currentOwner) {
      await github(env, "DELETE", `/repos/${target.fullName}/issues/${issueNumber}/assignees`, { assignees: [currentOwner] });
    }
    await github(env, "POST", `/repos/${target.fullName}/issues/${issueNumber}/assignees`, { assignees: [targetLogin] });
    await removeLabels(env, target, issueNumber, [claimLabels.open.name, claimLabels.blocked.name, claimLabels.closed.name]);
    await addLabels(env, target, issueNumber, [claimLabels.claimed, claimLabels.progress]);
    await comment(env, target, issueNumber, [
      "任务已在面板内转交。",
      "",
      `- 原接单人: ${currentOwner ? `@${currentOwner}` : "无"}`,
      `- 新接单人: @${targetLogin}`,
      `- 转交人: @${actor}`,
      `- 转交时间: ${now}`
    ].join("\n"));
  } else if (action === "blocked") {
    if (currentOwner && currentOwner !== actor) {
      throw new HttpError(409, `标记失败：当前接单人是 @${currentOwner}。`);
    }
    await removeLabels(env, target, issueNumber, [claimLabels.open.name, claimLabels.waitingPr.name, claimLabels.reviewing.name, claimLabels.closed.name]);
    await addLabels(env, target, issueNumber, [claimLabels.blocked]);
    await comment(env, target, issueNumber, [
      `@${actor} 已在面板内标记阻塞。`,
      "",
      `阻塞原因：${argument || "未填写"}`,
      `标记时间：${now}`
    ].join("\n"));
  } else if (action === "ready-pr") {
    if (currentOwner && currentOwner !== actor) {
      throw new HttpError(409, `状态更新失败：当前接单人是 @${currentOwner}。`);
    }
    await removeLabels(env, target, issueNumber, [claimLabels.open.name, claimLabels.progress.name, claimLabels.blocked.name, claimLabels.closed.name]);
    await addLabels(env, target, issueNumber, [claimLabels.claimed, claimLabels.waitingPr]);
    await comment(env, target, issueNumber, `@${actor} 已在面板内将任务标记为等待 PR。`);
  } else {
    throw new HttpError(400, "不支持的接单动作。");
  }

  ctx.waitUntil(triggerRefresh(env));
  return json({
    ok: true,
    repo: target.fullName,
    number: issueNumber,
    redirected: resolved.redirected,
    message: "接单操作已在面板内提交。系统会自动刷新 Dashboard 状态。"
  }, 200, origin);
}

async function handleFinalIssuePublish(request, env, ctx, origin) {
  assertActionKey(request, env);
  const body = await readJson(request);
  const actor = assertActor(env, body.actor);
  const target = splitRepo(env, body.repo);
  const title = cleanText(body.title, 180);
  const issueBody = cleanText(body.body, 12000);
  if (!title || !issueBody) {
    throw new HttpError(400, "Final Issue 需要标题和正文。");
  }
  const labels = safeLabels(body.labels);
  for (const name of labels) {
    await ensureLabel(env, target, { name, color: "e8f7ef", description: "Development panel generated label" });
  }
  const issue = await github(env, "POST", `/repos/${target.fullName}/issues`, {
    title,
    body: [
      issueBody,
      "",
      "Development panel metadata:",
      `- Panel topic: ${cleanText(body.topicId, 120)}`,
      `- Module: ${cleanText(body.module, 80)}`,
      `- Published by: @${actor}`
    ].join("\n"),
    labels
  });
  await comment(env, target, issue.number, [
    "Final Implementation Issue created from the development panel.",
    "",
    `- Publisher: @${actor}`,
    `- Panel topic: ${cleanText(body.topicId, 120)}`,
    "- Task distribution may now show this issue as claimable after Dashboard refresh."
  ].join("\n"));
  ctx.waitUntil(triggerRefresh(env));
  return json({
    ok: true,
    issue: {
      repo: target.fullName,
      number: issue.number,
      title: issue.title,
      url: issue.html_url
    },
    message: "Final Implementation Issue 已静默发布。"
  }, 201, origin);
}

async function handleFinalIssueBind(request, env, ctx, origin) {
  assertActionKey(request, env);
  const body = await readJson(request);
  assertActor(env, body.actor);
  const parsed = parseIssueUrl(env, body.url);
  if (!parsed) {
    throw new HttpError(400, "Issue URL 必须来自允许的 shichai-dev 仓库。");
  }
  const expected = splitRepo(env, body.expectedRepo);
  if (parsed.fullName !== expected.fullName) {
    throw new HttpError(400, `Issue 仓库不匹配：期望 ${expected.fullName}。`);
  }
  const issue = await getIssue(env, expected, parsed.number);
  const expectedTitle = cleanText(body.expectedTitle, 180);
  if (expectedTitle && titleOverlap(issue.title, expectedTitle) < 0.2) {
    throw new HttpError(400, "Issue 标题和面板草稿差异过大，请确认是否绑定错了。");
  }
  ctx.waitUntil(triggerRefresh(env));
  return json({
    ok: true,
    issue: {
      repo: expected.fullName,
      number: issue.number,
      title: issue.title,
      url: issue.html_url
    },
    message: "手动发布 Issue 已绑定。"
  }, 200, origin);
}

async function handleActionCheck(request, env, origin) {
  assertActionKey(request, env);
  const body = await readJson(request);
  const actor = assertActor(env, body.actor);
  return json({
    ok: true,
    service: "shichai-dashboard-actions",
    actor,
    allowedRepos: [...allowedRepoNames].map((repo) => `${env.GITHUB_OWNER || "shichai-dev"}/${repo}`),
    message: "动作接口、团队操作口令和操作者权限已通过检测。"
  }, 200, origin);
}

export default {
  async fetch(request, env, ctx) {
    const origin = responseOrigin(request, env);
    try {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders(origin) });
      }
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/api/health") {
        return json({ ok: true, service: "shichai-dashboard-actions" }, 200, origin);
      }
      if (request.method === "GET" && url.pathname === "/api/development-ai/health") {
        return await handleDevelopmentAiHealth(env, origin);
      }
      if (request.method === "POST" && url.pathname === "/api/action-check") {
        return await handleActionCheck(request, env, origin);
      }
      if (request.method === "POST" && url.pathname === "/api/development-ai/topic-draft") {
        return await handleDevelopmentAiTopicDraft(request, env, origin);
      }
      if (request.method === "POST" && url.pathname === "/api/discussions") {
        return await handleDiscussion(request, env, ctx, origin);
      }
      if (request.method === "POST" && url.pathname === "/api/issue-command") {
        return await handleIssueCommand(request, env, ctx, origin);
      }
      if (request.method === "POST" && url.pathname === "/api/final-issues") {
        return await handleFinalIssuePublish(request, env, ctx, origin);
      }
      if (request.method === "POST" && url.pathname === "/api/final-issues/bind") {
        return await handleFinalIssueBind(request, env, ctx, origin);
      }
      return json({ ok: false, message: "接口不存在。" }, 404, origin);
    } catch (error) {
      const status = error.status || 500;
      console.error(JSON.stringify({ status, message: error.message }));
      return json({ ok: false, message: error.message || "动作接口异常。" }, status, origin);
    }
  }
};
