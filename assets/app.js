const state = {
  data: null,
  activeTab: "studio",
  query: "",
  status: "all",
  selectedId: null,
  selectedPageId: null,
  selectedTargetId: null,
  chainDrawerOpen: false,
  evaluationOpen: false
};

const statusLabels = {
  implemented: "Implemented",
  "in-progress": "In progress",
  planned: "Planned",
  blocked: "Blocked"
};

const statusClass = {
  implemented: "status-implemented",
  "in-progress": "status-in-progress",
  planned: "status-planned",
  blocked: "status-blocked"
};

const discussionLabels = {
  idea: "Idea",
  evaluation: "Evaluation",
  "change-request": "Change request",
  handoff: "Handoff",
  bug: "Bug"
};

const lifecycleLabels = {
  "needs-ai-review": "Needs AI review",
  accepted: "Accepted",
  implemented: "Implemented",
  stale: "Stale",
  blocked: "Blocked"
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

function buildTargetDiscussionUrl(target, type = "idea", titleInput = "", bodyInput = "") {
  const page = currentPage();
  const feature = featureById(target?.featureId);
  const typeLabel = discussionLabels[type] || "Idea";
  const title = `[${typeLabel}][${target?.featureId || "unmapped"}] ${titleInput || target?.label || "Platform UI discussion"}`;
  const body = [
    `Feature ID: ${target?.featureId || ""}`,
    `Feature: ${feature?.title || target?.featureId || ""}`,
    `UI Surface: ${target?.uiSurface || page?.uiSurface || ""}`,
    `Operation Step: ${target?.stepId || ""}`,
    `Hotspot ID: ${target?.id || ""}`,
    `Discussion type: ${type}`,
    "",
    "Selected UI:",
    `- Page: ${page?.title || ""}`,
    `- Target: ${target?.label || ""}`,
    `- Current behavior: ${target?.summary || ""}`,
    "",
    "Proposal / evaluation:",
    bodyInput || "",
    "",
    "Expected AI action:",
    "- [ ] Summarize this discussion",
    "- [ ] Decide whether it changes feature status",
    "- [ ] Split into implementation issues if accepted",
    "- [ ] Mark older comments obsolete if this supersedes them"
  ].join("\n");
  const labels = ["dashboard-discussion", target?.featureId ? `feature:${target.featureId}` : "", `discussion:${type}`]
    .filter(Boolean)
    .join(",");
  const params = new URLSearchParams({ title, body, labels });
  return `https://github.com/shichai-dev/feature-dashboard/issues/new?${params.toString()}`;
}

function renderMetrics() {
  const metrics = state.data?.metrics || {};
  byId("metrics").innerHTML = [
    ["Implemented", metrics.implemented || 0],
    ["In progress", metrics.inProgress || 0],
    ["Open discussions", metrics.openDiscussions || 0],
    ["Needs AI review", metrics.needsAiReview || 0]
  ]
    .map(([label, value]) => `
      <article class="metric">
        <span>${label}</span>
        <strong>${value}</strong>
      </article>
    `)
    .join("");
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
          <p>${escapeHtml(page.eyebrow || "ShiChai Platform")}</p>
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
                    <span>${escapeHtml(step.pageId)}</span>
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
    root.innerHTML = `<div class="empty-state">No platform simulation data is available.</div>`;
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

function renderRows() {
  const rows = filteredFeatures();
  const tbody = byId("feature-rows");
  if (!rows.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6">
          <div class="empty-state">No features match the current filters.</div>
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
          <td>${escapeHtml(surfaces || "Not mapped")}</td>
          <td>${escapeHtml(chain || "Not mapped")}</td>
          <td>${statusPill(feature.status)}</td>
          <td><span class="cell-muted">${escapeHtml(feature.lane || "unassigned")}</span></td>
          <td><span class="cell-muted">${escapeHtml(feature.verification || "none")}</span></td>
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
              <span class="meta-chip">${escapeHtml(surface.repo || "repo")}</span>
              <span class="meta-chip">${escapeHtml(surface.route || "route TBD")}</span>
              <span class="meta-chip">${surface.featureCount || 0} features</span>
            </div>
          </article>
        `)
        .join("")
    : `<div class="empty-state">No UI surfaces have been registered yet.</div>`;
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
    : `<div class="empty-state">No operation chains have been registered yet.</div>`;
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
              <span class="meta-chip">${escapeHtml(handoff.needs || "needs-review")}</span>
              <span class="meta-chip">${escapeHtml(handoff.lane || "lane TBD")}</span>
              <span class="meta-chip">${escapeHtml(handoff.repo || "repo TBD")}</span>
            </div>
          </article>
        `)
        .join("")
    : `<div class="empty-state">No open handoffs in the current snapshot.</div>`;
}

function renderDiscussions() {
  const discussions = state.data?.discussions || [];
  byId("discussion-list").innerHTML = discussions.length
    ? discussions
        .map((discussion) => `
          <article class="discussion-item">
            <div>
              <h3>${escapeHtml(discussion.title)}</h3>
              <p>${escapeHtml(discussion.preview || "No public summary yet.")}</p>
            </div>
            <div class="meta-row">
              <span class="meta-chip">${escapeHtml(discussionLabels[discussion.type] || discussion.type || "Idea")}</span>
              <span class="meta-chip">${escapeHtml(lifecycleLabels[discussion.lifecycle] || discussion.lifecycle || "Needs review")}</span>
              <span class="meta-chip">${escapeHtml(discussion.featureId || "unmapped")}</span>
              <span class="meta-chip">${discussion.commentCount || 0} comments</span>
            </div>
            <div class="detail-links">
              <a href="${escapeHtml(discussion.url)}">Open discussion</a>
            </div>
          </article>
        `)
        .join("")
    : `<div class="empty-state">No dashboard discussions yet. Use the selected feature panel to submit an idea or evaluation.</div>`;
}

function buildDiscussionUrl(feature) {
  const type = byId("discussion-type")?.value || "idea";
  const titleInput = byId("discussion-title")?.value?.trim();
  const bodyInput = byId("discussion-body")?.value?.trim();
  const typeLabel = discussionLabels[type] || "Idea";
  const title = `[${typeLabel}][${feature.id}] ${titleInput || feature.title}`;
  const surfaces = (feature.uiSurfaces || [])
    .map((surface) => `- ${surface.name} (${surface.repo}${surface.route ? ` ${surface.route}` : ""})`)
    .join("\n") || "- TBD";
  const body = [
    `Feature ID: ${feature.id}`,
    `Feature: ${feature.title}`,
    `Discussion type: ${type}`,
    "",
    "Target UI surfaces:",
    surfaces,
    "",
    "Proposal / evaluation:",
    bodyInput || "",
    "",
    "Expected AI action:",
    "- [ ] Summarize this discussion",
    "- [ ] Decide whether it changes feature status",
    "- [ ] Split into implementation issues if accepted",
    "- [ ] Mark older comments obsolete if this supersedes them"
  ].join("\n");
  const labels = ["dashboard-discussion", `feature:${feature.id}`, `discussion:${type}`].join(",");
  const params = new URLSearchParams({ title, body, labels });
  return `https://github.com/shichai-dev/feature-dashboard/issues/new?${params.toString()}`;
}

function attachDiscussionComposer(feature) {
  const button = byId("open-discussion-issue");
  if (!button) return;
  button.addEventListener("click", () => {
    window.open(buildDiscussionUrl(feature), "_blank", "noopener,noreferrer");
  });
}

function renderCommentWidget(feature) {
  const container = byId("comment-widget");
  if (!container) return;
  container.innerHTML = "";
  const script = document.createElement("script");
  script.src = "https://utteranc.es/client.js";
  script.async = true;
  script.setAttribute("repo", "shichai-dev/feature-dashboard");
  script.setAttribute("issue-term", feature.discussion?.issueTerm || `Feature discussion: ${feature.id}`);
  script.setAttribute("label", "dashboard-discussion");
  script.setAttribute("theme", "github-light");
  script.setAttribute("crossorigin", "anonymous");
  container.appendChild(script);
}

function renderTargetCommentWidget(target) {
  const container = byId("comment-widget");
  if (!container) return;
  container.innerHTML = "";
  const script = document.createElement("script");
  script.src = "https://utteranc.es/client.js";
  script.async = true;
  script.setAttribute("repo", "shichai-dev/feature-dashboard");
  script.setAttribute("issue-term", `Feature discussion: ${target.featureId} ${target.stepId || target.id}`);
  script.setAttribute("label", "dashboard-discussion");
  script.setAttribute("theme", "github-light");
  script.setAttribute("crossorigin", "anonymous");
  container.appendChild(script);
}

function renderStudioInspector() {
  const target = currentTarget();
  const page = currentPage();
  const detail = byId("detail-panel");
  if (!target || !page) {
    detail.innerHTML = `
      <div class="empty-detail">
        <h2>选择一个页面操作</h2>
        <p>点击仿真 UI 里的按钮、图标或区域后，在这里评论、评价或追加操作链。</p>
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
        <span class="meta-chip">${escapeHtml(target.uiSurface || page.uiSurface || "UI surface")}</span>
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
        <span class="meta-chip">${discussions.filter((discussion) => discussion.state !== "CLOSED").length} open</span>
        <span class="meta-chip">${discussions.filter((discussion) => discussion.needsAiReview).length} AI review</span>
        <span class="meta-chip">${discussions.filter((discussion) => discussion.lifecycle === "stale").length} stale</span>
      </div>
      <ul class="signal-list">${discussionItems}</ul>
    </div>
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
          <button class="primary-button" type="button" id="open-discussion-issue">发送到公开讨论</button>
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

  byId("open-discussion-issue")?.addEventListener("click", () => {
    const type = byId("discussion-type")?.value || "idea";
    const title = byId("discussion-title")?.value?.trim() || "";
    const body = byId("discussion-body")?.value?.trim() || "";
    window.open(buildTargetDiscussionUrl(target, type, title, body), "_blank", "noopener,noreferrer");
  });
  byId("open-evaluation-modal")?.addEventListener("click", () => {
    state.evaluationOpen = true;
    renderAll();
  });
  byId("close-evaluation-modal")?.addEventListener("click", () => {
    state.evaluationOpen = false;
    renderAll();
  });
  byId("send-evaluation")?.addEventListener("click", () => {
    const rating = byId("evaluation-rating")?.value || "ok";
    const note = byId("evaluation-note")?.value?.trim() || "";
    window.open(buildTargetDiscussionUrl(target, "evaluation", `评价：${target.label}`, `Evaluation: ${rating}\n\n${note}`), "_blank", "noopener,noreferrer");
  });
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
      <button class="primary-button" type="button" id="send-evaluation">提交评价</button>
    </div>
  `;
}

function renderDetail() {
  if (state.activeTab === "studio") {
    renderStudioInspector();
    return;
  }
  const feature = (state.data?.features || []).find((item) => item.id === state.selectedId) || filteredFeatures()[0];
  const detail = byId("detail-panel");
  if (!feature) {
    detail.innerHTML = `
      <div class="empty-detail">
        <h2>Select a feature</h2>
        <p>Choose a row to inspect UI surfaces, operation chain steps, linked issues, and discussion prompts.</p>
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
    : "<li>No structured discussion signals yet.</li>";

  detail.innerHTML = `
    <div>
      ${statusPill(feature.status)}
      <h2>${escapeHtml(feature.title)}</h2>
      <p>${escapeHtml(feature.summary || "")}</p>
      <div class="meta-row">
        <span class="meta-chip">${escapeHtml(feature.repo || "repo")}</span>
        <span class="meta-chip">${escapeHtml(feature.lane || "lane")}</span>
        <span class="meta-chip">${escapeHtml(feature.ownerAi || "AI owner TBD")}</span>
      </div>
    </div>
    <div class="detail-section">
      <h3>UI surfaces</h3>
      <p>${escapeHtml((feature.uiSurfaces || []).map((surface) => surface.name).join(", ") || "No UI surfaces mapped yet.")}</p>
    </div>
    <div class="detail-section">
      <h3>Operation chain</h3>
      <ol class="chain-steps">
        ${(feature.operationChain || [])
          .map((step, index) => `
            <li>
              <span class="step-index">${index + 1}</span>
              <span>${escapeHtml(step)}</span>
            </li>
          `)
          .join("") || "<li>No chain mapped yet.</li>"}
      </ol>
    </div>
    <div class="detail-section">
      <h3>Linked discussion</h3>
      <div class="detail-links">${links || "<p>No linked issues yet.</p>"}</div>
    </div>
    <div class="detail-section">
      <h3>Async signals</h3>
      <div class="meta-row">
        <span class="meta-chip">${discussionCounts.open || 0} open</span>
        <span class="meta-chip">${discussionCounts.needsAiReview || 0} AI review</span>
        <span class="meta-chip">${discussionCounts.implemented || 0} implemented</span>
        <span class="meta-chip">${discussionCounts.stale || 0} stale</span>
      </div>
      <ul class="signal-list">${signalList}</ul>
    </div>
    <div class="detail-section">
      <h3>Discussion prompt</h3>
      <p>${escapeHtml(feature.discussionPrompt || "What should be expanded, verified, or split next?")}</p>
    </div>
    <div class="detail-section">
      <h3>Submit idea or evaluation</h3>
      <div class="discussion-composer">
        <label>
          <span>Type</span>
          <select id="discussion-type">
            <option value="idea">New feature idea</option>
            <option value="evaluation">Evaluate current feature</option>
            <option value="change-request">Change request</option>
            <option value="bug">Bug or risk</option>
            <option value="handoff">Needs another lane</option>
          </select>
        </label>
        <label>
          <span>Title</span>
          <input id="discussion-title" type="text" placeholder="Short title">
        </label>
        <label>
          <span>Comment</span>
          <textarea id="discussion-body" rows="5" placeholder="Describe the idea, evaluation, expected behavior, or what should change."></textarea>
        </label>
        <button class="primary-button" type="button" id="open-discussion-issue">Send to public discussion</button>
      </div>
    </div>
    <div class="detail-section">
      <h3>Quick comments</h3>
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
    ? `Last generated: ${generatedAt.toLocaleString()}`
    : "Using bundled snapshot.";
  byId("sync-source").textContent = state.data?.sourceSummary || "";
}

function renderAll() {
  renderTabs();
  renderMetrics();
  renderStudio();
  renderRows();
  renderSurfaces();
  renderChains();
  renderDiscussions();
  renderHandoffs();
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

byId("search-input").addEventListener("input", (event) => {
  state.query = event.target.value;
  renderAll();
});

byId("status-filter").addEventListener("change", (event) => {
  state.status = event.target.value;
  renderAll();
});

loadData().catch((error) => {
  byId("sync-state").textContent = "Dashboard data could not be loaded.";
  byId("sync-source").textContent = error.message;
});
