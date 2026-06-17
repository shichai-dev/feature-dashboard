const allowedRepoNames = new Set([
  "feature-dashboard",
  "planning",
  "opc-bounty-client",
  "opc-bounty-admin",
  "opc-bounty-server"
]);

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

async function upstreamJson(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new HttpError(response.status || 502, data.message || data.error || "中台 AI 服务调用失败。");
  }
  return data;
}

async function handleDevelopmentAiHealth(env, origin) {
  const baseUrl = developmentAiBaseUrl(env);
  if (!baseUrl) {
    throw new HttpError(503, "中台 AI 服务尚未配置 DEVELOPMENT_AI_BASE_URL。");
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
