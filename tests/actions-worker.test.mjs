import assert from "node:assert/strict";
import test from "node:test";

import worker from "../actions-worker/src/index.js";

const env = {
  DASHBOARD_ACTION_KEY: "test-action-key",
  ALLOWED_ACTORS: "sexymonk,longxi102",
  ALLOWED_ORIGINS: "http://127.0.0.1:4174",
  GITHUB_OWNER: "shichai-dev",
  DASHBOARD_REPO: "feature-dashboard",
  DASHBOARD_REF: "main"
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
