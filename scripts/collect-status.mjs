import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const registryPath = resolve(root, "registry/feature-registry.json");
const outputPath = resolve(root, "data/status.json");
const projectOwner = "shichai-dev";
const projectNumber = "1";
const dashboardRepository = "shichai-dev/feature-dashboard";
const repositories = [
  "shichai-dev/planning",
  "shichai-dev/opc-bounty-client",
  "shichai-dev/opc-bounty-admin",
  "shichai-dev/opc-bounty-server"
];

function runGh(args) {
  const env = {
    ...process.env,
    GH_TOKEN: process.env.SHICHAI_READ_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN || ""
  };
  return execFileSync("gh", args, {
    cwd: root,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function tryGhJson(args, fallback) {
  try {
    return JSON.parse(runGh(args));
  } catch (error) {
    console.warn(`GitHub read skipped: gh ${args.join(" ")}`);
    console.warn(String(error.stderr || error.message).trim());
    return fallback;
  }
}

function statusRank(status) {
  return {
    blocked: 0,
    "in-progress": 1,
    planned: 2,
    implemented: 3
  }[status] ?? 2;
}

function inferIssueStatus(issue) {
  if (issue.state === "CLOSED") return "implemented";
  const labels = (issue.labels || []).map((label) => label.name || label);
  if (labels.includes("status:blocked")) return "blocked";
  if (labels.some((label) => label.startsWith("needs:"))) return "in-progress";
  return "planned";
}

function labelNames(issue) {
  return (issue.labels || []).map((label) => label.name || label).filter(Boolean);
}

function collectIssues() {
  return repositories.flatMap((repo) => {
    const issues = tryGhJson(
      [
        "issue",
        "list",
        "-R",
        repo,
        "--state",
        "all",
        "--limit",
        "100",
        "--json",
        "number,title,url,state,labels,assignees,updatedAt"
      ],
      []
    );
    return issues.map((issue) => ({
      ...issue,
      repo,
      inferredStatus: inferIssueStatus(issue)
    }));
  });
}

function collectDashboardIssues() {
  const issues = tryGhJson(
    [
      "issue",
      "list",
      "-R",
      dashboardRepository,
      "--state",
      "all",
      "--limit",
      "100",
      "--json",
      "number,title,url,state,labels,assignees,updatedAt,createdAt,closedAt,body"
    ],
    []
  );
  return issues.map((issue) => {
    const detail = tryGhJson(
      ["issue", "view", String(issue.number), "-R", dashboardRepository, "--json", "body,comments"],
      {}
    );
    return {
      ...issue,
      body: detail.body ?? issue.body ?? "",
      comments: Array.isArray(detail.comments) ? detail.comments : []
    };
  });
}

function collectProjectItems() {
  const data = tryGhJson(
    ["project", "item-list", projectNumber, "--owner", projectOwner, "--format", "json", "--limit", "200"],
    { items: [] }
  );
  return data.items || [];
}

function issueByUrl(issues) {
  return new Map(issues.map((issue) => [issue.url, issue]));
}

function discussionText(issue) {
  const comments = (Array.isArray(issue.comments) ? issue.comments : []).map((comment) => comment.body || "").join("\n");
  return `${issue.title || ""}\n${issue.body || ""}\n${comments}`;
}

function inferDiscussionType(issue) {
  const labels = labelNames(issue);
  const text = discussionText(issue).toLowerCase();
  if (text.includes("讨论类型: evaluation") || text.includes("讨论类型: 评价")) return "evaluation";
  if (text.includes("讨论类型: change-request") || text.includes("讨论类型: 修改请求")) return "change-request";
  if (text.includes("讨论类型: handoff") || text.includes("讨论类型: 协作交接")) return "handoff";
  if (text.includes("讨论类型: bug") || text.includes("讨论类型: 问题")) return "bug";
  if (labels.includes("discussion:evaluation") || text.includes("discussion type: evaluation")) return "evaluation";
  if (labels.includes("discussion:change-request") || text.includes("discussion type: change-request")) return "change-request";
  if (labels.includes("discussion:handoff") || text.includes("discussion type: handoff")) return "handoff";
  if (labels.includes("discussion:bug") || text.includes("discussion type: bug")) return "bug";
  return "idea";
}

function inferDiscussionFeatureId(issue, featureIds) {
  const text = discussionText(issue);
  const patterns = [
    /功能编号:\s*([a-z0-9-]+)/i,
    /Feature ID:\s*([a-z0-9-]+)/i,
    /\[feature:([a-z0-9-]+)\]/i,
    /\[Discussion\]\[([a-z0-9-]+)\]/i,
    /\[(idea|evaluation|change-request|bug|handoff)\]\[([a-z0-9-]+)\]/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const candidate = match?.[2] || match?.[1];
    if (candidate && featureIds.has(candidate)) return candidate;
  }
  for (const featureId of featureIds) {
    if (text.includes(featureId)) return featureId;
  }
  return null;
}

function inferDiscussionField(issue, label) {
  const text = discussionText(issue);
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`${escapedLabel}:\\s*([^\\n]+)`, "i"));
  return match?.[1]?.trim() || null;
}

function inferDiscussionLifecycle(issue) {
  const labels = labelNames(issue);
  if (labels.includes("status:implemented")) return "implemented";
  if (labels.includes("status:stale")) return "stale";
  if (labels.includes("status:accepted")) return "accepted";
  if (labels.includes("status:blocked")) return "blocked";
  const text = discussionText(issue).toLowerCase();
  if (issue.state === "CLOSED") return "implemented";
  if (/(已实现|已完成|implemented|done|fixed|shipped|merged)/i.test(text)) return "implemented";
  if (/(已过期|过期|不需要|obsolete|stale|superseded|replaced)/i.test(text)) return "stale";
  if (/(阻塞|blocked|blocking|depends on|依赖|等待)/i.test(text)) return "blocked";
  if (/(采纳|accepted|approved|同意|agree)/i.test(text)) return "accepted";
  return "needs-ai-review";
}

function normalizeComment(comment) {
  return {
    author: comment.author?.login || comment.author || "unknown",
    body: comment.body || "",
    createdAt: comment.createdAt || null,
    updatedAt: comment.updatedAt || null,
    url: comment.url || null
  };
}

function summarizeText(value) {
  const compact = String(value || "").replace(/\s+/g, " ").trim();
  return compact.length > 180 ? `${compact.slice(0, 177)}...` : compact;
}

function buildNewDiscussionUrl(feature) {
  const title = `[想法][${feature.id}] ${feature.title}`;
  const body = [
    `功能编号: ${feature.id}`,
    `功能: ${feature.title}`,
    "讨论类型: idea",
    "",
    "目标界面页面:",
    (feature.uiSurfaces || []).map((surface) => `- ${surface.name} (${surface.repo}${surface.route ? ` ${surface.route}` : ""})`).join("\n") || "- 待定",
    "",
    "建议或评价:",
    "",
    "希望智能助手处理:",
    "- [ ] 汇总这条讨论",
    "- [ ] 判断是否影响功能状态",
    "- [ ] 若已采纳则拆成实现议题",
    "- [ ] 若替代旧讨论则标记旧评论过期"
  ].join("\n");
  const labels = ["dashboard-discussion", `feature:${feature.id}`, "discussion:idea"];
  const params = new URLSearchParams({
    title,
    body,
    labels: labels.join(",")
  });
  return `https://github.com/${dashboardRepository}/issues/new?${params.toString()}`;
}

function buildDiscussionSignals(issues, registryFeatures) {
  const featureIds = new Set(registryFeatures.map((feature) => feature.id));
  return issues
    .map((issue) => {
      const featureId = inferDiscussionFeatureId(issue, featureIds);
      const type = inferDiscussionType(issue);
      const lifecycle = inferDiscussionLifecycle(issue);
      return {
        id: `dashboard-${issue.number}`,
        number: issue.number,
        title: issue.title,
        url: issue.url,
        state: issue.state,
        featureId,
        uiSurface: inferDiscussionField(issue, "界面页面") || inferDiscussionField(issue, "UI Surface"),
        operationStepId: inferDiscussionField(issue, "操作步骤") || inferDiscussionField(issue, "Operation Step"),
        hotspotId: inferDiscussionField(issue, "热点编号") || inferDiscussionField(issue, "Hotspot ID"),
        type,
        lifecycle,
        needsAiReview: lifecycle === "needs-ai-review" || !featureId,
        commentCount: Array.isArray(issue.comments) ? issue.comments.length : 0,
        labels: labelNames(issue),
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt,
        closedAt: issue.closedAt,
        body: issue.body || "",
        comments: (Array.isArray(issue.comments) ? issue.comments : []).map(normalizeComment)
      };
    })
    .filter((discussion) => {
      const labels = discussion.labels || [];
      return (
        discussion.featureId ||
        labels.includes("dashboard-discussion") ||
        labels.some((label) => label.startsWith("discussion:")) ||
        /\[(idea|evaluation|change-request|bug|handoff)\]/i.test(discussion.title || "")
      );
    });
}

function publicDiscussionSignal(discussion) {
  const { body, comments, ...publicSignal } = discussion;
  return {
    ...publicSignal,
    preview: summarizeText([body, ...(comments || []).map((comment) => comment.body)].join("\n"))
  };
}

function attachDiscussions(features, discussionSignals) {
  const byFeature = new Map();
  for (const discussion of discussionSignals) {
    if (!discussion.featureId) continue;
    const existing = byFeature.get(discussion.featureId) || [];
    existing.push(discussion);
    byFeature.set(discussion.featureId, existing);
  }

  return features.map((feature) => {
    const discussions = byFeature.get(feature.id) || [];
    const latest = [...discussions].sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))[0];
    const counts = {
      open: discussions.filter((discussion) => discussion.state !== "CLOSED").length,
      needsAiReview: discussions.filter((discussion) => discussion.needsAiReview).length,
      implemented: discussions.filter((discussion) => discussion.lifecycle === "implemented").length,
      stale: discussions.filter((discussion) => discussion.lifecycle === "stale").length,
      blocked: discussions.filter((discussion) => discussion.lifecycle === "blocked").length
    };

    return {
      ...feature,
      discussion: {
        issueTerm: `功能讨论：${feature.id}`,
        newIssueUrl: buildNewDiscussionUrl(feature),
        count: discussions.length,
        counts,
        latestUpdatedAt: latest?.updatedAt || null,
        latestTitle: latest?.title || null,
        signals: discussions.map(publicDiscussionSignal)
      }
    };
  });
}

function enrichFeatures(registryFeatures, issues, projectItems) {
  const issuesByUrl = issueByUrl(issues);
  const projectByUrl = new Map();
  for (const item of projectItems) {
    if (item?.content?.url) {
      projectByUrl.set(item.content.url, item);
    }
  }

  return registryFeatures.map((feature) => {
    const linkedIssues = (feature.linkedIssues || []).map((link) => {
      const issue = issuesByUrl.get(link.url);
      const projectItem = projectByUrl.get(link.url);
      return {
        ...link,
        state: issue?.state || "UNKNOWN",
        needs: projectItem?.needs || null,
        stage: projectItem?.stage || null,
        verification: projectItem?.verification || null
      };
    });

    const issueStatuses = linkedIssues
      .map((link) => issuesByUrl.get(link.url))
      .filter(Boolean)
      .map(inferIssueStatus);
    const mostConservativeIssueStatus = issueStatuses.sort((a, b) => statusRank(a) - statusRank(b))[0];
    const status = mostConservativeIssueStatus && feature.status !== "implemented"
      ? mostConservativeIssueStatus
      : feature.status;

    const openNeeds = linkedIssues
      .filter((link) => link.state !== "CLOSED")
      .map((link) => link.needs)
      .filter(Boolean);

    return {
      ...feature,
      status,
      linkedIssues,
      openNeeds
    };
  });
}

function buildSurfaces(features) {
  const surfaceMap = new Map();
  for (const feature of features) {
    for (const surface of feature.uiSurfaces || []) {
      const key = `${surface.repo}:${surface.name}`;
      const existing = surfaceMap.get(key) || {
        ...surface,
        description: "",
        featureCount: 0,
        features: []
      };
      existing.featureCount += 1;
      existing.features.push(feature.title);
      existing.description = existing.description || `用于 ${existing.features.join("、")}`;
      surfaceMap.set(key, existing);
    }
  }
  return [...surfaceMap.values()].sort((a, b) => a.repo.localeCompare(b.repo) || a.name.localeCompare(b.name));
}

function buildChains(features) {
  return features
    .filter((feature) => (feature.operationChain || []).length)
    .map((feature) => ({
      id: feature.id,
      name: feature.title,
      description: feature.summary,
      status: feature.status,
      repo: feature.repo,
      lane: feature.lane,
      steps: feature.operationChain
    }));
}

function buildHandoffs(features) {
  const featureHandoffs = features.flatMap((feature) => {
    const needs = new Set(feature.openNeeds || []);
    return [...needs].map((need) => ({
      title: feature.title,
      summary: `该功能正在等待 ${need}。`,
      needs: need,
      lane: feature.lane,
      repo: feature.repo
    }));
  });
  const seen = new Set();
  return featureHandoffs.filter((handoff) => {
    const key = `${handoff.title}:${handoff.needs}:${handoff.lane}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildMetrics(features, handoffs) {
  const discussions = features.flatMap((feature) => feature.discussion?.signals || []);
  return {
    implemented: features.filter((feature) => feature.status === "implemented").length,
    inProgress: features.filter((feature) => feature.status === "in-progress").length,
    planned: features.filter((feature) => feature.status === "planned").length,
    blocked: features.filter((feature) => feature.status === "blocked").length,
    needsHandoff: handoffs.length,
    openDiscussions: discussions.filter((discussion) => discussion.state !== "CLOSED").length,
    needsAiReview: discussions.filter((discussion) => discussion.needsAiReview).length,
    staleDiscussions: discussions.filter((discussion) => discussion.lifecycle === "stale").length
  };
}

function buildAiReviewQueue(features, discussionSignals, handoffs) {
  const discussionQueue = discussionSignals
    .filter((discussion) => discussion.needsAiReview || discussion.lifecycle === "blocked")
    .map((discussion) => ({
      type: "discussion",
      title: discussion.title,
      url: discussion.url,
      featureId: discussion.featureId,
      reason: discussion.featureId ? discussion.lifecycle : "unmapped-feature",
      updatedAt: discussion.updatedAt
    }));

  const handoffQueue = handoffs.map((handoff) => ({
    type: "handoff",
    title: handoff.title,
    featureId: features.find((feature) => feature.title === handoff.title)?.id || null,
    reason: handoff.needs,
    repo: handoff.repo,
    lane: handoff.lane
  }));

  return [...discussionQueue, ...handoffQueue];
}

function main() {
  const registry = JSON.parse(readFileSync(registryPath, "utf8"));
  const issues = collectIssues();
  const projectItems = collectProjectItems();
  const dashboardIssues = collectDashboardIssues();
  const discussionSignals = buildDiscussionSignals(dashboardIssues, registry.features || []);
  const features = attachDiscussions(enrichFeatures(registry.features || [], issues, projectItems), discussionSignals);
  const uiSurfaces = buildSurfaces(features);
  const operationChains = buildChains(features);
  const handoffs = buildHandoffs(features);
  const metrics = buildMetrics(features, handoffs);
  const aiReviewQueue = buildAiReviewQueue(features, discussionSignals, handoffs);

  const output = {
    generatedAt: new Date().toISOString(),
    sourceSummary: `${features.length} 个功能，${uiSurfaces.length} 个界面页面，${operationChains.length} 条操作链。已读取 ${projectItems.length} 个项目项、${issues.length} 个私有议题、${discussionSignals.length} 条看板讨论。`,
    repositories,
    dashboardRepository,
    metrics,
    operationStudio: registry.operationStudio || null,
    features,
    uiSurfaces,
    operationChains,
    handoffs,
    discussions: discussionSignals.map(publicDiscussionSignal),
    aiReviewQueue
  };

  writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Wrote ${outputPath}`);
}

main();
