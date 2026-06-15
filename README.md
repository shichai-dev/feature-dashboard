# ShiChai Feature Discussion Dashboard

Public, sanitized feature-status and asynchronous discussion dashboard for ShiChai development.

Live site:

- https://shichai-dev.github.io/feature-dashboard/

Sources:

- `registry/feature-registry.json` is the public feature and UI-surface registry.
- Dashboard issue threads are the public asynchronous discussion store. Team members can submit ideas, evaluations, change requests, bug/risk notes, and handoff needs from the web page.
- `scripts/collect-status.mjs` merges registry data with GitHub Project state, private implementation issues, dashboard issues, and dashboard comments when a token can read the required sources.
- `data/status.json` is the generated snapshot used by the dashboard.

Private code repositories stay private. This repository should publish only feature names, UI surface names, operation chains, linked issue URLs, and verification status. Do not publish secrets, source snippets, object keys, private user data, prompts, or production credentials.

## Discussion flow

1. Open the live dashboard and select a feature.
2. Use **Submit idea or evaluation** to create a structured public discussion issue, or use the embedded comment area for quick comments.
3. The refresh workflow reads dashboard discussions and classifies each signal as `needs-ai-review`, `accepted`, `implemented`, `stale`, or `blocked`.
4. Coordinator AI reads `data/status.json`, especially `discussions` and `aiReviewQueue`, then decides whether to summarize, split work into implementation issues, or mark older comments as obsolete.
5. After code or issue state changes, the next refresh updates the feature map, UI surfaces, operation chains, handoffs, discussion counts, and AI review queue.

The embedded quick-comment widget uses GitHub-backed issue comments. Install the `utterances` GitHub App for `shichai-dev/feature-dashboard` before relying on in-page comments. Structured discussion issues work without the widget.

## Refresh

Run locally:

```powershell
node scripts/collect-status.mjs
```

Run in GitHub Actions:

- Configure `SHICHAI_READ_TOKEN` as a repository secret if scheduled refresh should read private repos and the organization Project.
- The token should be least-privilege: read access to issues/projects in `shichai-dev` and no write access to production systems.

Optional labels for public discussions:

- `dashboard-discussion`
- `discussion:idea`
- `discussion:evaluation`
- `discussion:change-request`
- `discussion:bug`
- `discussion:handoff`
- `status:accepted`
- `status:stale`
- `status:implemented`
