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
