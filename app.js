const FAVORITES_STORAGE_KEY = "pm-skills-favorites";

const state = {
  payload: null,
  selectedTab: "总榜",
  query: "",
  filterMode: "all",
  sortMode: "score",
  favorites: loadFavorites()
};

const tabsElement = document.querySelector("#tabs");
const filterTabsElement = document.querySelector("#filter-tabs");
const dimensionBreakdownElement = document.querySelector("#dimension-breakdown");
const cardsElement = document.querySelector("#cards");
const emptyStateElement = document.querySelector("#empty-state");
const searchInput = document.querySelector("#search-input");
const sortSelectElement = document.querySelector("#sort-select");
const resultsSummaryElement = document.querySelector("#results-summary");
const thresholdNoteElement = document.querySelector("#threshold-note");
const generatedAtElement = document.querySelector("#generated-at");
const totalSkillsElement = document.querySelector("#total-skills");
const includedSkillsElement = document.querySelector("#included-skills");
const currentResultsElement = document.querySelector("#current-results");
const favoriteResultsElement = document.querySelector("#favorite-results");
const manualResultsElement = document.querySelector("#manual-results");
const topDimensionElement = document.querySelector("#top-dimension");

function loadFavorites() {
  try {
    const raw = window.localStorage.getItem(FAVORITES_STORAGE_KEY);

    if (!raw) {
      return new Set();
    }

    return new Set(JSON.parse(raw));
  } catch (error) {
    return new Set();
  }
}

function saveFavorites() {
  window.localStorage.setItem(
    FAVORITES_STORAGE_KEY,
    JSON.stringify([...state.favorites])
  );
}

function formatDateTime(value) {
  const date = new Date(value);

  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getDisplayTitle(skill) {
  return skill.titleZh || skill.title;
}

function getSecondaryTitle(skill) {
  if (!skill.titleZh || skill.titleZh === skill.title) {
    return "";
  }

  return skill.title;
}

function getDisplaySummary(skill) {
  return skill.summaryZh || skill.description;
}

function getComparableTitle(skill) {
  return getDisplayTitle(skill);
}

function isFavorite(slug) {
  return state.favorites.has(slug);
}

function toggleFavorite(slug) {
  if (state.favorites.has(slug)) {
    state.favorites.delete(slug);
  } else {
    state.favorites.add(slug);
  }

  saveFavorites();
  render();
}

function summarizeMatchedKeywords(skill) {
  const primaryHits =
    skill.matchedKeywords.dimensions[skill.primaryDimension] || [];
  const bonusHits = skill.matchedKeywords.bonuses || [];

  return [...primaryHits, ...bonusHits]
    .slice(0, 6)
    .map((item) => `${item.keyword} +${item.weight}`);
}

function describeOverride(override) {
  if (!override?.applied) {
    return "";
  }

  if (override.forceExclude) {
    return "手工排除";
  }

  if (override.forceInclude && override.scoreDelta === 0) {
    return "手工强制收录";
  }

  if (override.scoreDelta > 0) {
    return `手工置顶 +${override.scoreDelta}`;
  }

  if (override.scoreDelta < 0) {
    return `手工降权 ${override.scoreDelta}`;
  }

  if (override.primaryDimension) {
    return "手工改维度";
  }

  return "手工规则";
}

function sortSkills(skills) {
  const nextSkills = [...skills];

  if (state.sortMode === "updated") {
    nextSkills.sort(
      (left, right) => new Date(right.modifiedAt) - new Date(left.modifiedAt)
    );
    return nextSkills;
  }

  if (state.sortMode === "title") {
    nextSkills.sort((left, right) =>
      getComparableTitle(left).localeCompare(getComparableTitle(right), "zh-CN")
    );
    return nextSkills;
  }

  nextSkills.sort((left, right) => {
    if (right.pmScore !== left.pmScore) {
      return right.pmScore - left.pmScore;
    }

    const leftPrimary = left.dimensionScores[left.primaryDimension] || 0;
    const rightPrimary = right.dimensionScores[right.primaryDimension] || 0;

    if (rightPrimary !== leftPrimary) {
      return rightPrimary - leftPrimary;
    }

    return getComparableTitle(left).localeCompare(getComparableTitle(right), "zh-CN");
  });

  return nextSkills;
}

function getFilteredSkills() {
  if (!state.payload) {
    return [];
  }

  const query = state.query.trim().toLowerCase();

  const filteredSkills = state.payload.skills
    .filter((skill) => skill.included)
    .filter((skill) => {
      if (state.selectedTab === "总榜") {
        return true;
      }

      return skill.primaryDimension === state.selectedTab;
    })
    .filter((skill) => {
      if (state.filterMode === "favorites") {
        return isFavorite(skill.slug);
      }

      if (state.filterMode === "manual") {
        return Boolean(skill.override?.applied);
      }

      return true;
    })
    .filter((skill) => {
      if (!query) {
        return true;
      }

      const haystack = [
        skill.slug,
        skill.title,
        skill.titleZh,
        skill.description,
        skill.summaryZh,
        skill.primaryDimension
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(query);
    });

  return sortSkills(filteredSkills);
}

function renderTabs() {
  if (!state.payload) {
    return;
  }

  const tabs = ["总榜", ...state.payload.meta.dimensions];

  tabsElement.innerHTML = tabs
    .map((tab) => {
      const activeClass = state.selectedTab === tab ? " active" : "";
      const count =
        tab === "总榜"
          ? state.payload.meta.includedSkills
          : state.payload.meta.countsByDimension[tab];

      return `<button class="tab-button${activeClass}" data-tab="${tab}">${tab} · ${count}</button>`;
    })
    .join("");

  tabsElement.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedTab = button.dataset.tab;
      render();
    });
  });
}

function renderFilterTabs() {
  if (!state.payload) {
    return;
  }

  const includedSkills = state.payload.skills.filter((skill) => skill.included);
  const totalFavorites = includedSkills.filter((skill) => isFavorite(skill.slug)).length;
  const totalManual = includedSkills.filter((skill) => skill.override?.applied).length;
  const filters = [
    { key: "all", label: `全部收录 · ${includedSkills.length}` },
    { key: "favorites", label: `仅收藏 · ${totalFavorites}` },
    { key: "manual", label: `仅手工规则 · ${totalManual}` }
  ];

  filterTabsElement.innerHTML = filters
    .map((filter) => {
      const activeClass = state.filterMode === filter.key ? " active" : "";

      return `<button class="filter-button${activeClass}" data-filter="${filter.key}">${filter.label}</button>`;
    })
    .join("");

  filterTabsElement.querySelectorAll(".filter-button").forEach((button) => {
    button.addEventListener("click", () => {
      state.filterMode = button.dataset.filter;
      render();
    });
  });
}

function renderInsightPanel(visibleSkills) {
  const visibleFavorites = visibleSkills.filter((skill) => isFavorite(skill.slug)).length;
  const visibleManual = visibleSkills.filter((skill) => skill.override?.applied).length;
  const breakdown = Object.fromEntries(
    state.payload.meta.dimensions.map((dimension) => [dimension, 0])
  );

  for (const skill of visibleSkills) {
    breakdown[skill.primaryDimension] += 1;
  }

  const topDimension = state.payload.meta.dimensions
    .map((dimension) => ({ dimension, count: breakdown[dimension] }))
    .sort((left, right) => right.count - left.count)[0];

  currentResultsElement.textContent = String(visibleSkills.length);
  favoriteResultsElement.textContent = String(visibleFavorites);
  manualResultsElement.textContent = String(visibleManual);
  topDimensionElement.textContent =
    topDimension && topDimension.count > 0
      ? `${topDimension.dimension} · ${topDimension.count}`
      : "-";

  dimensionBreakdownElement.innerHTML = state.payload.meta.dimensions
    .map(
      (dimension) =>
        `<span class="breakdown-pill">${escapeHtml(dimension)} · ${breakdown[dimension]}</span>`
    )
    .join("");
}

function renderCards() {
  const visibleSkills = getFilteredSkills();

  if (visibleSkills.length === 0) {
    cardsElement.innerHTML = "";
    emptyStateElement.classList.remove("hidden");
  } else {
    emptyStateElement.classList.add("hidden");
    cardsElement.innerHTML = visibleSkills
      .map((skill) => {
        const displayTitle = getDisplayTitle(skill);
        const secondaryTitle = getSecondaryTitle(skill);
        const displaySummary = getDisplaySummary(skill);
        const keywordPills = summarizeMatchedKeywords(skill)
          .map((keyword) => `<span class="keyword-pill">${escapeHtml(keyword)}</span>`)
          .join("");
        const favoriteButtonLabel = isFavorite(skill.slug) ? "★ 已收藏" : "☆ 收藏";
        const overridePill = skill.override?.applied
          ? `<span class="override-pill">${escapeHtml(describeOverride(skill.override))}</span>`
          : "";
        const overrideLabels = (skill.override?.labels || [])
          .map((label) => `<span class="keyword-pill">${escapeHtml(label)}</span>`)
          .join("");
        const overrideNote = skill.override?.note
          ? `<div class="override-note">手工规则：${escapeHtml(skill.override.note)}</div>`
          : "";
        const originalScorePill =
          skill.basePmScore !== skill.pmScore
            ? `<span class="meta-pill">原始分 ${skill.basePmScore}</span>`
            : "";

        return `
          <article class="skill-card">
            <div class="skill-topline">
              <div class="skill-title-group">
                <h2 class="skill-title">${escapeHtml(displayTitle)}</h2>
                ${
                  secondaryTitle
                    ? `<div class="skill-subtitle">${escapeHtml(secondaryTitle)}</div>`
                    : ""
                }
                <div class="skill-slug">${escapeHtml(skill.slug)}</div>
              </div>
              <div class="score-badges">
                <span class="score-pill">推荐分 ${skill.pmScore}</span>
                <span class="dimension-pill">${escapeHtml(skill.primaryDimension)}</span>
                ${overridePill}
                <a class="link-button" href="${escapeHtml(skill.detailUrl)}">查看详情</a>
                <button class="favorite-button${isFavorite(skill.slug) ? " active" : ""}" data-favorite-slug="${escapeHtml(skill.slug)}">${favoriteButtonLabel}</button>
              </div>
            </div>

            <p class="skill-description">${escapeHtml(displaySummary)}</p>

            <div class="skill-bottomline">
              <span class="meta-pill">最近修改 ${escapeHtml(formatDateTime(skill.modifiedAt))}</span>
              <span class="meta-pill">主维度分 ${skill.dimensionScores[skill.primaryDimension]}</span>
              ${originalScorePill}
            </div>

            <div class="section-label">命中关键词</div>
            <div class="keyword-list">${keywordPills || '<span class="keyword-pill">暂无关键词命中</span>'}</div>
            ${
              overrideLabels
                ? `<div class="override-labels">${overrideLabels}</div>`
                : ""
            }
            ${overrideNote}

            <div class="skill-source">来源：${escapeHtml(skill.sourcePath)}</div>
          </article>
        `;
      })
      .join("");
  }

  const scopeLabel =
    state.selectedTab === "总榜" ? "全部相关维度" : state.selectedTab;
  const filterLabel =
    state.filterMode === "all"
      ? "全部收录"
      : state.filterMode === "favorites"
        ? "仅收藏"
        : "仅手工规则";
  resultsSummaryElement.textContent = `${scopeLabel} · ${filterLabel} · 共 ${visibleSkills.length} 个结果`;
  renderInsightPanel(visibleSkills);
}

function renderSummary() {
  const { meta } = state.payload;

  generatedAtElement.textContent = formatDateTime(meta.generatedAt);
  totalSkillsElement.textContent = String(meta.totalSkills);
  includedSkillsElement.textContent = `${meta.includedSkills}（手工 ${meta.manualIncludedCount}）`;
  thresholdNoteElement.textContent = `默认阈值：推荐分 ≥ ${meta.includeThreshold}`;
}

function render() {
  renderTabs();
  renderFilterTabs();
  renderSummary();
  renderCards();
}

searchInput.addEventListener("input", (event) => {
  state.query = event.target.value;
  renderCards();
});

sortSelectElement.addEventListener("change", (event) => {
  state.sortMode = event.target.value;
  renderCards();
});

cardsElement.addEventListener("click", (event) => {
  const favoriteButton = event.target.closest("[data-favorite-slug]");

  if (!favoriteButton) {
    return;
  }

  toggleFavorite(favoriteButton.dataset.favoriteSlug);
});

async function bootstrap() {
  try {
    const response = await fetch("./data/skills.json", { cache: "no-store" });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    state.payload = await response.json();
    render();
  } catch (error) {
    resultsSummaryElement.textContent = "数据加载失败";
    cardsElement.innerHTML = `
      <article class="skill-card">
        <h2 class="skill-title">未能加载 data/skills.json</h2>
        <p class="skill-description">
          请先运行 <code>npm run build:data</code> 或 <code>npm run refresh</code> 生成最新数据。
        </p>
        <div class="skill-source">${escapeHtml(String(error))}</div>
      </article>
    `;
  }
}

bootstrap();
