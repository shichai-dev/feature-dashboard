const state = {
  data: null,
  activeTab: "studio",
  query: "",
  status: "all",
  selectedId: null,
  selectedIssueId: null,
  selectedPageId: null,
  selectedTargetId: null,
  chainDrawerOpen: false,
  evaluationOpen: false
};

const statusLabels = {
  implemented: "已实现",
  "in-progress": "进行中",
  planned: "计划中",
  blocked: "受阻"
};

const statusClass = {
  implemented: "status-implemented",
  "in-progress": "status-in-progress",
  planned: "status-planned",
  blocked: "status-blocked"
};

const discussionLabels = {
  idea: "想法",
  evaluation: "评价",
  "change-request": "修改请求",
  handoff: "协作交接",
  bug: "问题风险"
};

const lifecycleLabels = {
  "needs-ai-review": "待智能处理",
  accepted: "已采纳",
  implemented: "已实现",
  stale: "已过期",
  blocked: "受阻"
};

const claimLabels = {
  open: "待接单",
  claimed: "已接单",
  "in-progress": "开发中",
  "waiting-pr": "等待 PR",
  reviewing: "审查中",
  blocked: "阻塞",
  closed: "已关闭"
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

function claimPill(status) {
  const safeStatus = status || "open";
  return `<span class="claim-pill claim-${escapeHtml(safeStatus)}">${escapeHtml(claimLabels[safeStatus] || safeStatus)}</span>`;
}

function formatDateTime(value) {
  if (!value) return "未记录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未记录";
  return date.toLocaleString();
}

function formatElapsedHours(hours, startedAt, endedAt = null) {
  if (!startedAt) return "未开始";
  let value = Number(hours);
  if (!Number.isFinite(value) && startedAt) {
    const start = new Date(startedAt).getTime();
    const end = endedAt ? new Date(endedAt).getTime() : Date.now();
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      value = Math.round(((end - start) / 36e5) * 10) / 10;
    }
  }
  if (!Number.isFinite(value)) return "未开始";
  if (value < 1) return `${Math.round(value * 60)} 分钟`;
  if (value < 24) return `${value} 小时`;
  return `${Math.round((value / 24) * 10) / 10} 天`;
}

function issueTasks() {
  return state.data?.issueTasks || [];
}

function currentIssueTask() {
  return issueTasks().find((task) => task.id === state.selectedIssueId) || issueTasks()[0] || null;
}

function issueTasksByStatus() {
  const groups = [
    { id: "open", title: "待接单", tasks: [] },
    { id: "claimed", title: "已接单", tasks: [] },
    { id: "in-progress", title: "开发中", tasks: [] },
    { id: "waiting", title: "等待 PR / 审查", tasks: [] },
    { id: "blocked", title: "阻塞", tasks: [] },
    { id: "closed", title: "已关闭", tasks: [] }
  ];
  const groupById = new Map(groups.map((group) => [group.id, group]));
  for (const task of issueTasks()) {
    if (task.status === "waiting-pr" || task.status === "reviewing") {
      groupById.get("waiting").tasks.push(task);
    } else if (groupById.has(task.status)) {
      groupById.get(task.status).tasks.push(task);
    } else {
      groupById.get("open").tasks.push(task);
    }
  }
  return groups;
}

async function copyClaimCommand(command) {
  try {
    await navigator.clipboard.writeText(command);
    return true;
  } catch {
    return false;
  }
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

function pageTitleById(pageId) {
  return studioPages().find((page) => page.id === pageId)?.title || pageId || "页面";
}

function buildTargetDiscussionUrl(target, type = "idea", titleInput = "", bodyInput = "") {
  const page = currentPage();
  const feature = featureById(target?.featureId);
  const typeLabel = discussionLabels[type] || "想法";
  const title = `[${typeLabel}][${target?.featureId || "未映射"}] ${titleInput || target?.label || "平台界面讨论"}`;
  const body = [
    `功能编号: ${target?.featureId || ""}`,
    `功能: ${feature?.title || target?.featureId || ""}`,
    `界面页面: ${target?.uiSurface || page?.uiSurface || ""}`,
    `操作步骤: ${target?.stepId || ""}`,
    `热点编号: ${target?.id || ""}`,
    `讨论类型: ${type}`,
    "",
    "选中的界面:",
    `- 页面: ${page?.title || ""}`,
    `- 操作点: ${target?.label || ""}`,
    `- 当前行为: ${target?.summary || ""}`,
    "",
    "建议或评价:",
    bodyInput || "",
    "",
    "希望智能助手处理:",
    "- [ ] 汇总这条讨论",
    "- [ ] 判断是否影响功能状态",
    "- [ ] 若已采纳则拆成实现议题",
    "- [ ] 若替代旧讨论则标记旧评论过期"
  ].join("\n");
  const labels = ["dashboard-discussion", "dispatch:pending", target?.featureId ? `feature:${target.featureId}` : "", `discussion:${type}`]
    .filter(Boolean)
    .join(",");
  const params = new URLSearchParams({ title, body, labels });
  return `https://github.com/shichai-dev/feature-dashboard/issues/new?${params.toString()}`;
}

function renderMetrics() {
  const metrics = state.data?.metrics || {};
  byId("metrics").innerHTML = [
    ["待接单", metrics.openIssueTasks || 0],
    ["已接单", metrics.claimedIssueTasks || 0],
    ["等待 PR", metrics.waitingPrIssueTasks || 0],
    ["开放讨论", metrics.openDiscussions || 0]
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
          <p>${escapeHtml(page.eyebrow || "拾柴平台")}</p>
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
                    <span>${escapeHtml(pageTitleById(step.pageId))}</span>
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
    root.innerHTML = `<div class="empty-state">暂无平台仿真数据。</div>`;
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

function renderIssueTaskCard(task) {
  const claimant = task.claimant ? `@${task.claimant}` : "未接单";
  const parent = task.parentIssue?.url
    ? `<a href="${escapeHtml(task.parentIssue.url)}">${escapeHtml(task.parentIssue.label || "父级 Issue")}</a>`
    : escapeHtml(task.parentFeature?.title || "未归属父问题");
  return `
    <article class="issue-task-card ${task.id === state.selectedIssueId ? "is-selected" : ""}" data-issue-id="${escapeHtml(task.id)}">
      <div class="issue-task-head">
        ${claimPill(task.status)}
        <span class="repo-chip">${escapeHtml(task.repoName || task.repo)}</span>
      </div>
      <h3>#${escapeHtml(task.number)} ${escapeHtml(task.title)}</h3>
      <div class="issue-task-meta">
        <span>归属：${parent}</span>
        <span>负责人：${escapeHtml(claimant)}</span>
        <span>已耗时：${escapeHtml(formatElapsedHours(task.elapsedHours, task.claimedAt, task.closedAt))}</span>
      </div>
    </article>
  `;
}

function renderIssueTasks() {
  const root = byId("issue-task-board");
  if (!root) return;
  const groups = issueTasksByStatus();
  root.innerHTML = groups
    .map((group) => `
      <section class="issue-task-column">
        <div class="issue-task-column-head">
          <h3>${escapeHtml(group.title)}</h3>
          <span>${group.tasks.length}</span>
        </div>
        <div class="issue-task-stack">
          ${group.tasks.length ? group.tasks.map(renderIssueTaskCard).join("") : `<div class="mini-empty">暂无任务</div>`}
        </div>
      </section>
    `)
    .join("");

  root.querySelectorAll("[data-issue-id]").forEach((card) => {
    card.addEventListener("click", () => {
      state.selectedIssueId = card.dataset.issueId;
      renderAll();
    });
  });
}

function renderRows() {
  const rows = filteredFeatures();
  const tbody = byId("feature-rows");
  if (!rows.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6">
          <div class="empty-state">没有符合当前筛选条件的功能。</div>
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
          <td>${escapeHtml(surfaces || "未映射")}</td>
          <td>${escapeHtml(chain || "未映射")}</td>
          <td>${statusPill(feature.status)}</td>
          <td><span class="cell-muted">${escapeHtml(feature.lane || "未分配")}</span></td>
          <td><span class="cell-muted">${escapeHtml(feature.verification || "未验证")}</span></td>
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
              <span class="meta-chip">${escapeHtml(surface.repo || "仓库")}</span>
              <span class="meta-chip">${escapeHtml(surface.route || "路径待定")}</span>
              <span class="meta-chip">${surface.featureCount || 0} 个功能</span>
            </div>
          </article>
        `)
        .join("")
    : `<div class="empty-state">还没有登记界面页面。</div>`;
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
    : `<div class="empty-state">还没有登记操作链。</div>`;
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
              <span class="meta-chip">${escapeHtml(handoff.needs || "需要复核")}</span>
              <span class="meta-chip">${escapeHtml(handoff.lane || "分工待定")}</span>
              <span class="meta-chip">${escapeHtml(handoff.repo || "仓库待定")}</span>
            </div>
          </article>
        `)
        .join("")
    : `<div class="empty-state">当前快照里没有开放协作交接。</div>`;
}

function renderDiscussions() {
  const discussions = state.data?.discussions || [];
  byId("discussion-list").innerHTML = discussions.length
    ? discussions
        .map((discussion) => `
          <article class="discussion-item">
            <div>
              <h3>${escapeHtml(discussion.title)}</h3>
              <p>${escapeHtml(discussion.preview || "暂无公开摘要。")}</p>
            </div>
            <div class="meta-row">
              <span class="meta-chip">${escapeHtml(discussionLabels[discussion.type] || discussion.type || "想法")}</span>
              <span class="meta-chip">${escapeHtml(lifecycleLabels[discussion.lifecycle] || discussion.lifecycle || "待复核")}</span>
              <span class="meta-chip">${escapeHtml(discussion.dispatch?.statusLabel || "未进入分发")}</span>
              <span class="meta-chip">${escapeHtml(discussion.featureId || "未映射")}</span>
              <span class="meta-chip">${discussion.commentCount || 0} 条评论</span>
            </div>
            <div class="detail-links">
              <a href="${escapeHtml(discussion.url)}">打开讨论</a>
              ${discussion.dispatch?.targetUrl ? `<a href="${escapeHtml(discussion.dispatch.targetUrl)}">打开目标任务</a>` : ""}
            </div>
          </article>
        `)
        .join("")
    : `<div class="empty-state">还没有看板讨论。可以在仿真界面里选中操作点后提交想法或评价。</div>`;
}

function buildDiscussionUrl(feature) {
  const type = byId("discussion-type")?.value || "idea";
  const titleInput = byId("discussion-title")?.value?.trim();
  const bodyInput = byId("discussion-body")?.value?.trim();
  const typeLabel = discussionLabels[type] || "想法";
  const title = `[${typeLabel}][${feature.id}] ${titleInput || feature.title}`;
  const surfaces = (feature.uiSurfaces || [])
    .map((surface) => `- ${surface.name} (${surface.repo}${surface.route ? ` ${surface.route}` : ""})`)
    .join("\n") || "- TBD";
  const body = [
    `功能编号: ${feature.id}`,
    `功能: ${feature.title}`,
    `讨论类型: ${type}`,
    "",
    "目标界面页面:",
    surfaces,
    "",
    "建议或评价:",
    bodyInput || "",
    "",
    "希望智能助手处理:",
    "- [ ] 汇总这条讨论",
    "- [ ] 判断是否影响功能状态",
    "- [ ] 若已采纳则拆成实现议题",
    "- [ ] 若替代旧讨论则标记旧评论过期"
  ].join("\n");
  const labels = ["dashboard-discussion", "dispatch:pending", `feature:${feature.id}`, `discussion:${type}`].join(",");
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
  script.setAttribute("issue-term", feature.discussion?.issueTerm || `功能讨论：${feature.id}`);
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
  script.setAttribute("issue-term", `功能讨论：${target.featureId} ${target.stepId || target.id}`);
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
        <p>点击仿真界面里的按钮、图标或区域后，在这里评论、评价或追加操作链。</p>
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
        <span class="meta-chip">${escapeHtml(target.uiSurface || page.uiSurface || "界面页面")}</span>
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
        <span class="meta-chip">${discussions.filter((discussion) => discussion.state !== "CLOSED").length} 开放</span>
        <span class="meta-chip">${discussions.filter((discussion) => discussion.needsAiReview).length} 待智能处理</span>
        <span class="meta-chip">${discussions.filter((discussion) => discussion.lifecycle === "stale").length} 已过期</span>
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
    window.open(buildTargetDiscussionUrl(target, "evaluation", `评价：${target.label}`, `评价结果：${rating}\n\n${note}`), "_blank", "noopener,noreferrer");
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

function renderIssueInspector() {
  const task = currentIssueTask();
  const detail = byId("detail-panel");
  if (!task) {
    detail.innerHTML = `
      <div class="empty-detail">
        <h2>暂无接单任务</h2>
        <p>刷新后会从团队仓库读取开放 Issue，并按接单状态展示。</p>
      </div>
    `;
    return;
  }

  state.selectedIssueId = task.id;
  const parent = task.parentIssue?.url
    ? `<a href="${escapeHtml(task.parentIssue.url)}">${escapeHtml(task.parentIssue.label || "父级 Issue")}</a>`
    : escapeHtml(task.parentFeature?.title || "未归属父问题");
  const labels = (task.labels || []).slice(0, 8).map((label) => `<span class="meta-chip">${escapeHtml(label)}</span>`).join("");

  detail.innerHTML = `
    <div>
      ${claimPill(task.status)}
      <h2>#${escapeHtml(task.number)} ${escapeHtml(task.title)}</h2>
      <p>${escapeHtml(task.repo)} · ${escapeHtml(task.lane || "分工待定")}</p>
      <div class="meta-row">
        <span class="meta-chip">负责人：${escapeHtml(task.claimant ? `@${task.claimant}` : "未接单")}</span>
        <span class="meta-chip">接单时间：${escapeHtml(formatDateTime(task.claimedAt))}</span>
        <span class="meta-chip">已耗时：${escapeHtml(formatElapsedHours(task.elapsedHours, task.claimedAt, task.closedAt))}</span>
      </div>
    </div>
    <div class="detail-section">
      <h3>归属状态</h3>
      <p>父级：${parent}</p>
      <p>总问题：${escapeHtml(task.totalProblem || "未归属父问题")}</p>
    </div>
    <div class="detail-section">
      <h3>接单操作</h3>
      <p>${escapeHtml(task.commandHelp || "在 GitHub Issue 评论区发送接单命令。")}</p>
      <div class="claim-command-box">
        <code id="claim-command-text">${escapeHtml(task.claimCommand || "/claim")}</code>
        <button type="button" id="copy-claim-command">复制命令</button>
      </div>
      <div class="inspector-actions claim-actions">
        <button class="primary-button" type="button" id="open-claim-issue">打开 Issue 接单</button>
        <a class="ghost-link" href="${escapeHtml(task.url)}">查看问题详情</a>
      </div>
      <p class="claim-note">竞发锁以 GitHub assignee 为准。一个 Issue 已有负责人后，后续接单会被拒绝或需要转交。</p>
    </div>
    <div class="detail-section">
      <h3>接单命令</h3>
      <ul class="signal-list">
        <li><span>/claim</span><strong>接手这个 Issue</strong></li>
        <li><span>/unclaim</span><strong>放弃接单，回到待接单</strong></li>
        <li><span>/handoff @用户名</span><strong>转交给其他成员</strong></li>
        <li><span>/blocked 原因</span><strong>标记阻塞并说明原因</strong></li>
        <li><span>/ready-pr</span><strong>标记为等待 PR</strong></li>
      </ul>
    </div>
    <div class="detail-section">
      <h3>标签</h3>
      <div class="meta-row">${labels || "<span class=\"meta-chip\">暂无标签</span>"}</div>
    </div>
  `;

  byId("open-claim-issue")?.addEventListener("click", () => {
    window.open(`${task.url}#issuecomment-new`, "_blank", "noopener,noreferrer");
  });
  byId("copy-claim-command")?.addEventListener("click", async () => {
    const ok = await copyClaimCommand(task.claimCommand || "/claim");
    byId("copy-claim-command").textContent = ok ? "已复制" : "请手动复制";
  });
}

function renderDetail() {
  if (state.activeTab === "tasks") {
    renderIssueInspector();
    return;
  }
  if (state.activeTab === "studio") {
    renderStudioInspector();
    return;
  }
  const feature = (state.data?.features || []).find((item) => item.id === state.selectedId) || filteredFeatures()[0];
  const detail = byId("detail-panel");
  if (!feature) {
    detail.innerHTML = `
      <div class="empty-detail">
        <h2>选择功能</h2>
        <p>选择一行后查看界面页面、操作链步骤、关联议题和讨论提示。</p>
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
    : "<li>还没有结构化讨论信号。</li>";

  detail.innerHTML = `
    <div>
      ${statusPill(feature.status)}
      <h2>${escapeHtml(feature.title)}</h2>
      <p>${escapeHtml(feature.summary || "")}</p>
      <div class="meta-row">
        <span class="meta-chip">${escapeHtml(feature.repo || "仓库")}</span>
        <span class="meta-chip">${escapeHtml(feature.lane || "分工")}</span>
        <span class="meta-chip">${escapeHtml(feature.ownerAi || "智能负责人待定")}</span>
      </div>
    </div>
    <div class="detail-section">
      <h3>界面页面</h3>
      <p>${escapeHtml((feature.uiSurfaces || []).map((surface) => surface.name).join(", ") || "还没有映射界面页面。")}</p>
    </div>
    <div class="detail-section">
      <h3>操作链</h3>
      <ol class="chain-steps">
        ${(feature.operationChain || [])
          .map((step, index) => `
            <li>
              <span class="step-index">${index + 1}</span>
              <span>${escapeHtml(step)}</span>
            </li>
          `)
          .join("") || "<li>还没有映射操作链。</li>"}
      </ol>
    </div>
    <div class="detail-section">
      <h3>关联讨论</h3>
      <div class="detail-links">${links || "<p>还没有关联议题。</p>"}</div>
    </div>
    <div class="detail-section">
      <h3>Async signals</h3>
      <div class="meta-row">
        <span class="meta-chip">${discussionCounts.open || 0} 开放</span>
        <span class="meta-chip">${discussionCounts.needsAiReview || 0} 待智能处理</span>
        <span class="meta-chip">${discussionCounts.implemented || 0} 已实现</span>
        <span class="meta-chip">${discussionCounts.stale || 0} 已过期</span>
      </div>
      <ul class="signal-list">${signalList}</ul>
    </div>
    <div class="detail-section">
      <h3>讨论提示</h3>
      <p>${escapeHtml(feature.discussionPrompt || "下一步应该扩展、验证或拆分什么？")}</p>
    </div>
    <div class="detail-section">
      <h3>提交想法或评价</h3>
      <div class="discussion-composer">
        <label>
          <span>类型</span>
          <select id="discussion-type">
            <option value="idea">新增功能想法</option>
            <option value="evaluation">评价当前功能</option>
            <option value="change-request">修改请求</option>
            <option value="bug">问题或风险</option>
            <option value="handoff">需要其他分工</option>
          </select>
        </label>
        <label>
          <span>标题</span>
          <input id="discussion-title" type="text" placeholder="简短标题">
        </label>
        <label>
          <span>评论</span>
          <textarea id="discussion-body" rows="5" placeholder="描述想法、评价、预期行为或需要修改的内容。"></textarea>
        </label>
        <button class="primary-button" type="button" id="open-discussion-issue">发送到公开讨论</button>
      </div>
    </div>
    <div class="detail-section">
      <h3>快速评论</h3>
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
    ? `最近生成：${generatedAt.toLocaleString()}`
    : "正在使用内置快照。";
  byId("sync-source").textContent = state.data?.sourceSummary || "";
}

function renderAll() {
  renderTabs();
  renderMetrics();
  renderStudio();
  renderIssueTasks();
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
  state.selectedIssueId = state.data.issueTasks?.[0]?.id || null;
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
  byId("sync-state").textContent = "看板数据加载失败。";
  byId("sync-source").textContent = error.message;
});
