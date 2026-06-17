import assert from "node:assert/strict";
import test from "node:test";

import worker from "../actions-worker/src/index.js";

const env = {
  DASHBOARD_ACTION_KEY: "test-action-key",
  ALLOWED_ACTORS: "sexymonk,longxi102",
  ALLOWED_ORIGINS: "http://127.0.0.1:4174",
  GITHUB_OWNER: "shichai-dev",
  DASHBOARD_REPO: "feature-dashboard",
  DASHBOARD_REF: "main",
  DEVELOPMENT_AI_BASE_URL: "https://development-ai.test",
  DEVELOPMENT_AI_KEY: "test-development-ai-key"
};

function request(path, { key = env.DASHBOARD_ACTION_KEY, actor = "sexymonk" } = {}) {
  return new Request(`http://worker.test${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-shichai-action-key": key,
      origin: "http://127.0.0.1:4174"
    },
    body: JSON.stringify({ actor })
  });
}

test("health endpoint is public and side-effect free", async () => {
  const response = await worker.fetch(new Request("http://worker.test/api/health"), env, {});
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.service, "shichai-dashboard-actions");
});

test("action-check validates key and allowed actor without GitHub writes", async () => {
  const response = await worker.fetch(request("/api/action-check"), env, {});
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.actor, "sexymonk");
  assert.ok(body.allowedRepos.includes("shichai-dev/feature-dashboard"));
});

test("action-check rejects bad action key", async () => {
  const response = await worker.fetch(request("/api/action-check", { key: "wrong" }), env, {});
  const body = await response.json();

  assert.equal(response.status, 401);
  assert.equal(body.ok, false);
  assert.match(body.message, /口令/);
});

test("action-check rejects disallowed actor", async () => {
  const response = await worker.fetch(request("/api/action-check", { actor: "unknown-user" }), env, {});
  const body = await response.json();

  assert.equal(response.status, 403);
  assert.equal(body.ok, false);
  assert.match(body.message, /不在允许/);
});

test("development-ai health proxies the server runtime snapshot", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    assert.equal(String(url), "https://development-ai.test/api/development-ai/health");
    assert.equal(options.headers["user-agent"], "shichai-dashboard-actions");
    return new Response(JSON.stringify({
      ok: true,
      service: "shichai-development-ai",
      runtime: { ready: true, mode: "codex" }
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const response = await worker.fetch(new Request("http://worker.test/api/development-ai/health"), env, {});
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.developmentAi.service, "shichai-development-ai");
    assert.equal(body.developmentAi.runtime.mode, "codex");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("development-ai health uses free Worker DeepSeek path when secret is configured", async () => {
  const directEnv = {
    ...env,
    DEVELOPMENT_AI_DEEPSEEK_API_KEY: "test-deepseek-key",
    DEVELOPMENT_AI_DEEPSEEK_BASE_URL: "https://deepseek.test",
    DEVELOPMENT_AI_DEEPSEEK_MODEL: "deepseek-test-model"
  };
  const response = await worker.fetch(new Request("http://worker.test/api/development-ai/health"), directEnv, {});
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.developmentAi.runtime.ready, true);
  assert.equal(body.developmentAi.runtime.provider, "worker-deepseek");
  assert.equal(body.developmentAi.runtime.model, "deepseek-test-model");
});

test("development-ai topic draft validates the dashboard actor and forwards with server key", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    assert.equal(String(url), "https://development-ai.test/api/development-ai/topic-draft");
    assert.equal(options.method, "POST");
    assert.equal(options.headers["x-development-ai-key"], "test-development-ai-key");
    const payload = JSON.parse(options.body);
    assert.equal(payload.actor, "sexymonk");
    assert.equal(payload.note, "发布需求按钮文案不清楚");
    return new Response(JSON.stringify({
      ok: true,
      service: "shichai-development-ai",
      topic: {
        id: "topic-1",
        issueDraft: { title: "draft" },
        riskGate: { decision: "direct-publish" }
      }
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const response = await worker.fetch(new Request("http://worker.test/api/development-ai/topic-draft", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-shichai-action-key": env.DASHBOARD_ACTION_KEY,
        origin: "http://127.0.0.1:4174"
      },
      body: JSON.stringify({
        actor: "sexymonk",
        note: "发布需求按钮文案不清楚"
      })
    }), env, {});
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.topic.id, "topic-1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("development-ai topic draft can be generated directly by Worker DeepSeek", async () => {
  const directEnv = {
    ...env,
    DEVELOPMENT_AI_DEEPSEEK_API_KEY: "test-deepseek-key",
    DEVELOPMENT_AI_DEEPSEEK_BASE_URL: "https://deepseek.test",
    DEVELOPMENT_AI_DEEPSEEK_MODEL: "deepseek-test-model"
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    assert.equal(String(url), "https://deepseek.test/chat/completions");
    assert.equal(options.method, "POST");
    assert.equal(options.headers.authorization, "Bearer test-deepseek-key");
    const payload = JSON.parse(options.body);
    assert.equal(payload.model, "deepseek-test-model");
    assert.equal(payload.response_format.type, "json_object");
    assert.equal(JSON.stringify(payload.messages).includes("发布需求按钮文案不清楚"), true);
    return new Response(JSON.stringify({
      id: "deepseek-worker-response",
      model: "deepseek-test-model",
      choices: [{
        message: {
          content: JSON.stringify({
            topicType: "change-request",
            module: "client frontend",
            recommendedRepo: "shichai-dev/opc-bounty-client",
            simulatorEvidence: {
              productSurface: "client",
              pageId: "client-home",
              pageTitle: "用户端首页",
              targetId: "home-publish-requirement",
              targetLabel: "发布需求",
              operationStepId: "home-entry",
              triggerLocation: "用户端首页 / 发布需求",
              currentBehavior: "发布需求按钮文案不清楚",
              expectedBehavior: "说明会进入智能助手整理流程",
              screenshotRef: ""
            },
            duplicateCheck: {
              candidates: [],
              topScore: 0,
              summary: "未发现重复。"
            },
            riskGate: {
              decision: "direct-publish",
              riskLevel: "low",
              label: "small clear issue",
              reasons: [],
              flags: {
                suspectedDuplicate: false,
                lowConfidence: false,
                crossModule: false,
                largeChange: false
              }
            },
            issueDraft: {
              title: "发布需求按钮文案不清楚",
              body: "Worker DeepSeek generated body.",
              repo: "shichai-dev/opc-bounty-client",
              labels: ["from:development-panel", "module:client frontend"]
            },
            agentHandoffSummary: "检查首页发布需求按钮文案。"
          })
        }
      }],
      usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 }
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const response = await worker.fetch(new Request("http://worker.test/api/development-ai/topic-draft", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-shichai-action-key": env.DASHBOARD_ACTION_KEY,
        origin: "http://127.0.0.1:4174"
      },
      body: JSON.stringify({
        actor: "sexymonk",
        note: "发布需求按钮文案不清楚",
        page: { id: "client-home", title: "用户端首页", uiSurface: "client" },
        target: {
          id: "home-publish-requirement",
          label: "发布需求",
          summary: "发布需求入口",
          uiSurface: "client",
          stepId: "home-entry",
          featureId: "requirement-publishing"
        },
        feature: { id: "requirement-publishing", title: "需求发布", repo: "client/server", lane: "client-publish" },
        visualContext: { domText: "首页按钮：发布需求", selectedElement: { label: "发布需求", text: "发布需求" } }
      })
    }), directEnv, {});
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.topic.coordinator.source, "worker-deepseek");
    assert.equal(body.topic.coordinator.provider, "deepseek");
    assert.equal(body.topic.issueDraft.repo, "shichai-dev/opc-bounty-client");
    assert.equal(body.topic.riskGate.decision, "direct-publish");
    assert.equal(body.topic.coordinator.vision.status, "text_only");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
