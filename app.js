const state = {
  payload: null,
  selectedTab: "总榜",
  query: ""
};

const tabsElement = document.querySelector("#tabs");
const cardsElement = document.querySelector("#cards");
const emptyStateElement = document.querySelector("#empty-state");
const searchInput = document.querySelector("#search-input");
const resultsSummaryElement = document.querySelector("#results-summary");
const generatedAtElement = document.querySelector("#generated-at");
const totalSkillsElement = document.querySelector("#total-skills");
const includedSkillsElement = document.querySelector("#included-skills");

function formatDateTime(value) {
  const date = new Date(value);

  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function summarizeMatchedKeywords(skill) {
  const primaryHits =
    skill.matchedKeywords.dimensions[skill.primaryDimension] || [];
  const bonusHits = skill.matchedKeywords.bonuses || [];

  return [...primaryHits, ...bonusHits]
    .slice(0, 6)
    .map((item) => `${item.keyword} +${item.weight}`);
}

function getVisibleSkills() {
  if (!state.payload) {
    return [];
  }

  const query = state.query.trim().toLowerCase();

  return state.payload.skills
    .filter((skill) => skill.included)
    .filter((skill) => {
      if (state.selectedTab === "总榜") {
        return true;
      }

      return skill.primaryDimension === state.selectedTab;
    })
    .filter((skill) => {
      if (!query) {
        return true;
      }

      const haystack = [
        skill.slug,
        skill.title,
        skill.description,
        skill.primaryDimension
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(query);
    });
}

function renderTabs() {
  if (!state.payload) {
    return;
  }

  const tabs = ["总榜", ...state.payload.meta.dimensions];

  tabsElement.innerHTML = tabs
    .map((tab) => {
      const activeClass = state.selectedTab === tab ? " active" : "";

      return `<button class="tab-button${activeClass}" data-tab="${tab}">${tab}</button>`;
    })
    .join("");

  tabsElement.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedTab = button.dataset.tab;
      render();
    });
  });
}

function renderCards() {
  const visibleSkills = getVisibleSkills();

  if (visibleSkills.length === 0) {
    cardsElement.innerHTML = "";
    emptyStateElement.classList.remove("hidden");
  } else {
    emptyStateElement.classList.add("hidden");
    cardsElement.innerHTML = visibleSkills
      .map((skill) => {
        const keywordPills = summarizeMatchedKeywords(skill)
          .map((keyword) => `<span class="keyword-pill">${escapeHtml(keyword)}</span>`)
          .join("");

        return `
          <article class="skill-card">
            <div class="skill-topline">
              <div>
                <h2 class="skill-title">${escapeHtml(skill.title)}</h2>
                <div class="skill-slug">${escapeHtml(skill.slug)}</div>
              </div>
              <div class="score-badges">
                <span class="score-pill">PM 推荐分 ${skill.pmScore}</span>
                <span class="dimension-pill">${escapeHtml(skill.primaryDimension)}</span>
              </div>
            </div>

            <p class="skill-description">${escapeHtml(skill.description)}</p>

            <div class="skill-bottomline">
              <span class="meta-pill">最近修改 ${escapeHtml(formatDateTime(skill.modifiedAt))}</span>
              <span class="meta-pill">主维度分 ${skill.dimensionScores[skill.primaryDimension]}</span>
            </div>

            <div class="section-label">命中关键词</div>
            <div class="keyword-list">${keywordPills || '<span class="keyword-pill">暂无关键词命中</span>'}</div>

            <div class="skill-source">来源：${escapeHtml(skill.sourcePath)}</div>
          </article>
        `;
      })
      .join("");
  }

  const scopeLabel =
    state.selectedTab === "总榜" ? "全部 PM 维度" : state.selectedTab;
  resultsSummaryElement.textContent = `${scopeLabel} · 共 ${visibleSkills.length} 个结果`;
}

function renderSummary() {
  const { meta } = state.payload;

  generatedAtElement.textContent = formatDateTime(meta.generatedAt);
  totalSkillsElement.textContent = String(meta.totalSkills);
  includedSkillsElement.textContent = String(meta.includedSkills);
}

function render() {
  renderTabs();
  renderSummary();
  renderCards();
}

searchInput.addEventListener("input", (event) => {
  state.query = event.target.value;
  renderCards();
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

