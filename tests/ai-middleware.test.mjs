import assert from "node:assert/strict";
import test from "node:test";

import {
  bindManualIssueUrl,
  buildAgentHandoffPackageFromTopicTask,
  buildBridgeLaunchPackageFromTopicTask,
  buildFinalIssueRequest,
  buildFormalTaskFromTopic,
  claimFormalTaskTopic,
  createPanelTopic,
  findIssueBackfillCandidates,
  markIssuePublishingFailed,
  releaseFormalTaskTopic
} from "../assets/ai-middleware.js";

const page = {
  id: "home",
  title: "首页",
  summary: "发布需求、发布项目、查看反馈的入口页。",
  uiSurface: "用户端首页"
};

const target = {
  id: "home-publish-requirement",
  label: "发布需求",
  summary: "智能助手整理成合作机会卡",
  uiSurface: "用户端首页",
  featureId: "requirement-publishing",
  stepId: "publish-requirement-start"
};

const feature = {
  id: "requirement-publishing",
  title: "需求发布流程",
  summary: "需求发布流程。",
  lane: "client-publish",
  repo: "client/server"
};

test("creates a small clear panel topic with issue draft fields", () => {
  const topic = createPanelTopic({
    id: "topic-small",
    note: "发布需求按钮文案不清楚，需要改得更明确",
    page,
    target,
    feature,
    visualContext: {
      screenshotRef: "simulator://client-home/home-publish-requirement.png",
      domText: "首页按钮：发布需求"
    },
    discussions: [],
    issueTasks: [],
    now: "2026-06-17T00:00:00.000Z"
  });

  assert.equal(topic.status, "topic");
  assert.equal(topic.riskGate.decision, "direct-publish");
  assert.equal(topic.module, "client frontend");
  assert.equal(topic.issueDraft.repo, "shichai-dev/opc-bounty-client");
  assert.match(topic.issueDraft.title, /发布需求/);
  assert.equal(topic.simulatorEvidence.targetId, "home-publish-requirement");
  assert.equal(topic.simulatorEvidence.screenshotRef, "simulator://client-home/home-publish-requirement.png");
  assert.match(topic.issueDraft.body, /Visual context/);
});

test("gates suspected duplicate or cross-module topics for confirmation", () => {
  const topic = createPanelTopic({
    id: "topic-risk",
    note: "这个发布入口需要跨模块调整接口权限和后台流程",
    page,
    target,
    feature,
    discussions: [
      {
        id: "discussion-1",
        title: "发布入口跨模块权限讨论",
        url: "https://github.com/shichai-dev/feature-dashboard/issues/2",
        hotspotId: "home-publish-requirement",
        operationStepId: "publish-requirement-start",
        featureId: "requirement-publishing",
        preview: "已有发布入口权限和后台流程讨论"
      }
    ],
    issueTasks: [],
    now: "2026-06-17T00:00:00.000Z"
  });

  assert.equal(topic.riskGate.decision, "needs-confirmation");
  assert.equal(topic.riskGate.flags.crossModule, true);
  assert.equal(topic.riskGate.flags.suspectedDuplicate, true);
  assert.ok(topic.duplicateCheck.candidates.length >= 1);
});

test("publishing failure creates fallback package but not a formal task", () => {
  const topic = createPanelTopic({
    id: "topic-fallback",
    note: "发布需求按钮文案不清楚，需要改得更明确",
    page,
    target,
    feature,
    discussions: [],
    issueTasks: [],
    now: "2026-06-17T00:00:00.000Z"
  });
  const request = buildFinalIssueRequest(topic);
  const failed = markIssuePublishingFailed(topic, new Error("GitHub unavailable"), "2026-06-17T00:01:00.000Z");

  assert.equal(request.repo, "shichai-dev/opc-bounty-client");
  assert.equal(failed.status, "publish-failed");
  assert.equal(failed.manualFallback.repo, "shichai-dev/opc-bounty-client");
  assert.equal(failed.health.type, "github-publishing-failure");
  assert.equal(buildFormalTaskFromTopic(failed), null);
});

test("manual URL binding validates repo and creates a claimable formal task", () => {
  const topic = markIssuePublishingFailed(createPanelTopic({
    id: "topic-bind",
    note: "发布需求按钮文案不清楚，需要改得更明确",
    page,
    target,
    feature,
    discussions: [],
    issueTasks: [],
    now: "2026-06-17T00:00:00.000Z"
  }), new Error("GitHub unavailable"), "2026-06-17T00:01:00.000Z");

  const bound = bindManualIssueUrl(
    topic,
    "https://github.com/shichai-dev/opc-bounty-client/issues/123",
    { title: topic.issueDraft.title },
    "2026-06-17T00:02:00.000Z"
  );
  const task = buildFormalTaskFromTopic(bound);

  assert.equal(bound.status, "published");
  assert.equal(bound.finalIssue.source, "manual-url-binding");
  assert.equal(task.status, "open");
  assert.equal(task.repo, "shichai-dev/opc-bounty-client");
  assert.throws(
    () => bindManualIssueUrl(topic, "https://github.com/shichai-dev/opc-bounty-server/issues/9", { title: topic.issueDraft.title }),
    /仓库不匹配/
  );
});

test("finds manual-publish backfill candidates without auto-binding them", () => {
  const topic = markIssuePublishingFailed(createPanelTopic({
    id: "topic-backfill",
    note: "发布需求按钮文案不清楚，需要改得更明确",
    page,
    target,
    feature,
    discussions: [],
    issueTasks: [],
    now: "2026-06-17T00:00:00.000Z"
  }), new Error("GitHub unavailable"), "2026-06-17T00:01:00.000Z");

  const candidates = findIssueBackfillCandidates(topic, [
    {
      id: "client#88",
      repo: "shichai-dev/opc-bounty-client",
      number: 88,
      title: "[Change][requirement-publishing] 发布需求: 发布需求按钮文案不清楚，需要改得更明确",
      url: "https://github.com/shichai-dev/opc-bounty-client/issues/88",
      totalProblem: "发布需求按钮文案"
    },
    {
      id: "server#3",
      repo: "shichai-dev/opc-bounty-server",
      number: 3,
      title: "[API] unrelated",
      url: "https://github.com/shichai-dev/opc-bounty-server/issues/3",
      totalProblem: "unrelated"
    }
  ]);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].number, 88);
});

test("panel-led claim and release update task state separately from agent stop", () => {
  const bound = bindManualIssueUrl(createPanelTopic({
    id: "topic-claim",
    note: "发布需求按钮文案不清楚，需要改得更明确",
    page,
    target,
    feature,
    discussions: [],
    issueTasks: [],
    now: "2026-06-17T00:00:00.000Z"
  }), "https://github.com/shichai-dev/opc-bounty-client/issues/124", { title: "[Change][requirement-publishing] 发布需求: 发布需求按钮文案不清楚，需要改得更明确" });

  const claimed = claimFormalTaskTopic(bound, "sexymonk", "2026-06-17T00:03:00.000Z");
  const claimedTask = buildFormalTaskFromTopic(claimed);
  const released = releaseFormalTaskTopic(claimed, "sexymonk", "2026-06-17T00:04:00.000Z");

  assert.equal(claimedTask.claimant, "sexymonk");
  assert.equal(claimedTask.status, "in-progress");
  assert.equal(buildFormalTaskFromTopic(released).claimant, null);
});

test("generates agent handoff and bridge launch packages from claimed task", () => {
  const topic = claimFormalTaskTopic(bindManualIssueUrl(createPanelTopic({
    id: "topic-package",
    note: "发布需求按钮文案不清楚，需要改得更明确",
    page,
    target,
    feature,
    discussions: [],
    issueTasks: [],
    now: "2026-06-17T00:00:00.000Z"
  }), "https://github.com/shichai-dev/opc-bounty-client/issues/125", { title: "[Change][requirement-publishing] 发布需求: 发布需求按钮文案不清楚，需要改得更明确" }), "sexymonk");
  const task = buildFormalTaskFromTopic(topic);
  const handoff = buildAgentHandoffPackageFromTopicTask(task, topic);
  const launch = buildBridgeLaunchPackageFromTopicTask(task, topic, { threadId: "thread-1" });

  assert.equal(handoff.task.issueUrl, "https://github.com/shichai-dev/opc-bounty-client/issues/125");
  assert.equal(handoff.simulatorEvidence.targetId, "home-publish-requirement");
  assert.equal(launch.threadId, "thread-1");
  assert.equal(launch.handoffPackage.panelTopic.id, "topic-package");
  assert.match(launch.permissionEnvelope.codex.developerInstructions, /Do not merge/);
});
