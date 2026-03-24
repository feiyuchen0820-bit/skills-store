#!/usr/bin/env node

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "..");
const taxonomyPath = path.join(workspaceRoot, "config", "pm-taxonomy.json");
const overridesPath = path.join(workspaceRoot, "config", "pm-overrides.json");
const zhCatalogPath = path.join(workspaceRoot, "config", "pm-zh.json");
const outputPath = path.join(workspaceRoot, "data", "skills.json");
const detailsRoot = path.join(workspaceRoot, "skills");
const shouldValidate = process.argv.includes("--validate");

const taxonomy = JSON.parse(await fs.readFile(taxonomyPath, "utf8"));
const overrides = JSON.parse(await fs.readFile(overridesPath, "utf8"));
const zhCatalog = JSON.parse(await fs.readFile(zhCatalogPath, "utf8"));
const sourceRoot = process.env.SKILLS_ROOT || taxonomy.sourceRoot;
const dimensionOrder = taxonomy.dimensions.map((dimension) => dimension.key);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeForSearch(value) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function containsChinese(value) {
  return /[\u3400-\u9fff]/u.test(String(value || ""));
}

function matchesKeyword(rawHaystack, normalizedHaystack, keyword) {
  const loweredKeyword = keyword.toLowerCase();
  const normalizedKeyword = normalizeForSearch(keyword);

  return (
    rawHaystack.includes(loweredKeyword) ||
    (normalizedKeyword.length > 0 &&
      normalizedHaystack.includes(normalizedKeyword))
  );
}

function parseFrontmatter(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);

  if (!match) {
    return {};
  }

  const lines = match[1].split(/\r?\n/);
  const result = {};

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (!line.trim()) {
      continue;
    }

    const keyMatch = line.match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/);

    if (!keyMatch) {
      continue;
    }

    const [, key, rawValue = ""] = keyMatch;

    if (rawValue === "|" || rawValue === ">") {
      const blockLines = [];
      index += 1;

      while (index < lines.length) {
        const blockLine = lines[index];

        if (blockLine === "") {
          blockLines.push("");
          index += 1;
          continue;
        }

        if (/^\s+/.test(blockLine)) {
          blockLines.push(blockLine.replace(/^\s+/, ""));
          index += 1;
          continue;
        }

        index -= 1;
        break;
      }

      result[key] = blockLines.join(" ").replace(/\s+/g, " ").trim();
      continue;
    }

    result[key] = rawValue
      .trim()
      .replace(/^['"]/, "")
      .replace(/['"]$/, "");
  }

  return result;
}

function parseTitle(markdown) {
  const body = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  const titleMatch = body.match(/^#\s+(.+)$/m);

  return titleMatch ? titleMatch[1].trim() : null;
}

function sortSkills(left, right) {
  if (right.pmScore !== left.pmScore) {
    return right.pmScore - left.pmScore;
  }

  const leftPrimary = left.primaryDimension
    ? left.dimensionScores[left.primaryDimension]
    : 0;
  const rightPrimary = right.primaryDimension
    ? right.dimensionScores[right.primaryDimension]
    : 0;

  if (rightPrimary !== leftPrimary) {
    return rightPrimary - leftPrimary;
  }

  return left.title.localeCompare(right.title, "en");
}

async function collectSkillFiles(rootDirectory, excludedDirectories) {
  const entries = await fs.readdir(rootDirectory, { withFileTypes: true });
  const collected = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".") && !excludedDirectories.includes(entry.name)) {
      continue;
    }

    const fullPath = path.join(rootDirectory, entry.name);

    if (entry.isDirectory()) {
      if (excludedDirectories.includes(entry.name)) {
        continue;
      }

      const nestedFiles = await collectSkillFiles(fullPath, excludedDirectories);
      collected.push(...nestedFiles);
      continue;
    }

    if (entry.isFile() && entry.name === "SKILL.md") {
      collected.push(fullPath);
    }
  }

  return collected;
}

function formatSourcePath(absolutePath) {
  const homeDirectory = os.homedir();

  if (absolutePath.startsWith(homeDirectory)) {
    return absolutePath.replace(homeDirectory, "~");
  }

  return absolutePath;
}

function buildDetailUrl(slug) {
  return `./skills/${slug}/`;
}

function getZhCopy(skill) {
  const entry = zhCatalog.skills?.[skill.slug];

  return {
    titleZh:
      entry?.titleZh ||
      (containsChinese(skill.title) ? skill.title : null),
    summaryZh:
      entry?.summaryZh ||
      (containsChinese(skill.description) ? skill.description : null)
  };
}

function validateOverrideConfig() {
  for (const [slug, rule] of Object.entries(overrides.skills || {})) {
    if (rule.forceInclude && rule.forceExclude) {
      throw new Error(`手工规则冲突: ${slug} 不能同时 forceInclude 和 forceExclude`);
    }

    if (
      rule.primaryDimension &&
      !dimensionOrder.includes(rule.primaryDimension)
    ) {
      throw new Error(`手工规则维度非法: ${slug} -> ${rule.primaryDimension}`);
    }

    if (
      "scoreDelta" in rule &&
      (typeof rule.scoreDelta !== "number" || Number.isNaN(rule.scoreDelta))
    ) {
      throw new Error(`手工规则 scoreDelta 非法: ${slug}`);
    }
  }
}

function buildScorecard(skill) {
  const rawHaystack = [skill.slug, skill.title, skill.description]
    .join(" ")
    .toLowerCase();
  const normalizedHaystack = normalizeForSearch(rawHaystack);

  const dimensionScores = {};
  const matchedDimensionKeywords = {};

  for (const dimension of taxonomy.dimensions) {
    let score = 0;
    const hits = [];

    for (const [keyword, weight] of Object.entries(dimension.keywords)) {
      if (!matchesKeyword(rawHaystack, normalizedHaystack, keyword)) {
        continue;
      }

      score += weight;
      hits.push({ keyword, weight });
    }

    dimensionScores[dimension.key] = score;
    matchedDimensionKeywords[dimension.key] = hits;
  }

  let primaryDimension = dimensionOrder[0];
  let primaryDimensionScore = dimensionScores[primaryDimension];

  for (const dimensionKey of dimensionOrder.slice(1)) {
    if (dimensionScores[dimensionKey] > primaryDimensionScore) {
      primaryDimension = dimensionKey;
      primaryDimensionScore = dimensionScores[dimensionKey];
    }
  }

  const bonusHits = [];
  let bonusScore = 0;

  for (const [keyword, weight] of Object.entries(taxonomy.bonusKeywords)) {
    if (!matchesKeyword(rawHaystack, normalizedHaystack, keyword)) {
      continue;
    }

    bonusScore += weight;
    bonusHits.push({ keyword, weight });
  }

  const penaltyHits = [];
  let penaltyScore = 0;

  for (const [keyword, weight] of Object.entries(taxonomy.penaltyKeywords)) {
    if (!matchesKeyword(rawHaystack, normalizedHaystack, keyword)) {
      continue;
    }

    penaltyScore += weight;
    penaltyHits.push({ keyword, weight });
  }

  const pmScore = clamp(
    primaryDimensionScore + bonusScore - penaltyScore,
    0,
    100
  );

  return {
    dimensionScores,
    primaryDimension,
    pmScore,
    matchedKeywords: {
      dimensions: matchedDimensionKeywords,
      bonuses: bonusHits,
      penalties: penaltyHits
    },
    included: pmScore >= taxonomy.includeThreshold
  };
}

function applyManualOverride(skill, scorecard) {
  const rule = overrides.skills?.[skill.slug];

  if (!rule) {
    return {
      ...scorecard,
      basePmScore: scorecard.pmScore,
      baseIncluded: scorecard.included,
      override: null
    };
  }

  const scoreDelta =
    typeof rule.scoreDelta === "number" && !Number.isNaN(rule.scoreDelta)
      ? rule.scoreDelta
      : 0;
  const primaryDimension = rule.primaryDimension || scorecard.primaryDimension;
  const pmScore = clamp(scorecard.pmScore + scoreDelta, 0, 100);

  let included = pmScore >= taxonomy.includeThreshold;

  if (rule.forceInclude) {
    included = true;
  }

  if (rule.forceExclude) {
    included = false;
  }

  return {
    ...scorecard,
    primaryDimension,
    pmScore,
    included,
    basePmScore: scorecard.pmScore,
    baseIncluded: scorecard.included,
    override: {
      applied: true,
      scoreDelta,
      forceInclude: Boolean(rule.forceInclude),
      forceExclude: Boolean(rule.forceExclude),
      primaryDimension:
        rule.primaryDimension && rule.primaryDimension !== scorecard.primaryDimension
          ? rule.primaryDimension
          : null,
      note: String(rule.note || ""),
      labels: Array.isArray(rule.labels) ? rule.labels : []
    }
  };
}

function validatePayload(payload) {
  const errors = [];
  const skillsBySlug = new Map(payload.skills.map((skill) => [skill.slug, skill]));

  for (const skill of payload.skills) {
    const requiredFields = [
      "slug",
      "title",
      "titleZh",
      "description",
      "summaryZh",
      "sourcePath",
      "detailUrl",
      "modifiedAt",
      "primaryDimension",
      "dimensionScores",
      "pmScore",
      "basePmScore",
      "matchedKeywords",
      "included",
      "override"
    ];

    for (const field of requiredFields) {
      if (!(field in skill)) {
        errors.push(`缺少字段: ${skill.slug}.${field}`);
      }
    }

    if (skill.sourcePath.includes("/.system/")) {
      errors.push(`不应包含系统 skill: ${skill.slug}`);
    }
  }

  for (const slug of taxonomy.validation.mustInclude) {
    const skill = skillsBySlug.get(slug);

    if (!skill) {
      errors.push(`找不到必须收录的 skill: ${slug}`);
      continue;
    }

    if (!skill.included) {
      errors.push(`必须收录的 skill 未达阈值: ${slug}`);
    }
  }

  for (const slug of taxonomy.validation.mustExclude) {
    const skill = skillsBySlug.get(slug);

    if (!skill) {
      continue;
    }

    if (skill.included) {
      errors.push(`应被过滤的 skill 仍被收录: ${slug}`);
    }
  }

  for (const [slug, rule] of Object.entries(overrides.skills || {})) {
    const skill = skillsBySlug.get(slug);

    if (!skill) {
      errors.push(`手工规则引用了不存在的 skill: ${slug}`);
      continue;
    }

    if (rule.forceInclude && !skill.included) {
      errors.push(`手工 forceInclude 未生效: ${slug}`);
    }

    if (rule.forceExclude && skill.included) {
      errors.push(`手工 forceExclude 未生效: ${slug}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
}

function buildComparablePayload(payload) {
  return {
    ...payload,
    meta: {
      ...payload.meta,
      generatedAt: null
    }
  };
}

function renderDetailPage(skill) {
  const keywordList = [
    ...(skill.matchedKeywords.dimensions[skill.primaryDimension] || []),
    ...(skill.matchedKeywords.bonuses || [])
  ]
    .slice(0, 10)
    .map((item) => `${item.keyword} +${item.weight}`)
    .join(" · ");

  const overrideNote = skill.override?.note
    ? `<div class="override-note">手工规则：${escapeHtml(skill.override.note)}</div>`
    : "";

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>${escapeHtml(skill.titleZh || skill.title)} · Skills 详情</title>
    <meta name="description" content="${escapeHtml(skill.summaryZh || skill.description)}" />
    <link rel="stylesheet" href="../../styles.css" />
  </head>
  <body>
    <main class="page-shell">
      <section class="hero-card">
        <p class="eyebrow">Skill 详情</p>
        <h1>${escapeHtml(skill.titleZh || skill.title)}</h1>
        <p class="hero-copy">${escapeHtml(skill.summaryZh || skill.description)}</p>
        ${
          skill.titleZh && skill.titleZh !== skill.title
            ? `<div class="skill-slug">${escapeHtml(skill.title)}</div>`
            : ""
        }
        <div class="score-badges">
          <span class="score-pill">推荐分 ${skill.pmScore}</span>
          <span class="dimension-pill">${escapeHtml(skill.primaryDimension)}</span>
        </div>
        ${overrideNote}
        <div class="toolbar-meta">
          <span>来源：${escapeHtml(skill.sourcePath)}</span>
          <span>最近修改：${escapeHtml(skill.modifiedAt)}</span>
        </div>
      </section>

      <section class="toolbar-card">
        <div class="skill-bottomline">
          <a class="link-button" href="../../">← 返回目录</a>
          <a class="link-button" href="https://github.com/feiyuchen0820-bit/skills-store">仓库</a>
        </div>
        <div class="section-label">命中关键词</div>
        <div class="keyword-list">
          ${
            keywordList
              ? keywordList
                  .split(" · ")
                  .map((item) => `<span class="keyword-pill">${escapeHtml(item)}</span>`)
                  .join("")
              : '<span class="keyword-pill">暂无关键词命中</span>'
          }
        </div>
      </section>

      <section class="skill-card">
        <div class="section-label">英文原始说明</div>
        <p class="skill-description">${escapeHtml(skill.description)}</p>
      </section>

      <section class="skill-card">
        <div class="section-label">原始 SKILL.md</div>
        <pre class="skill-markdown">${escapeHtml(skill.markdown)}</pre>
      </section>
    </main>
  </body>
</html>
`;
}

async function writeDetailPages(skills) {
  await fs.rm(detailsRoot, { recursive: true, force: true });
  await fs.mkdir(detailsRoot, { recursive: true });

  for (const skill of skills) {
    const detailDirectory = path.join(detailsRoot, skill.slug);
    const detailPath = path.join(detailDirectory, "index.html");
    await fs.mkdir(detailDirectory, { recursive: true });
    await fs.writeFile(detailPath, renderDetailPage(skill), "utf8");
  }
}

async function readExistingOutput() {
  try {
    const raw = await fs.readFile(outputPath, "utf8");

    return {
      raw,
      payload: JSON.parse(raw)
    };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function main() {
  validateOverrideConfig();

  const skillFiles = await collectSkillFiles(sourceRoot, taxonomy.excludeDirs);
  const skills = [];

  for (const absolutePath of skillFiles) {
    const markdown = await fs.readFile(absolutePath, "utf8");
    const frontmatter = parseFrontmatter(markdown);
    const fileStats = await fs.stat(absolutePath);
    const slug = String(frontmatter.name || path.basename(path.dirname(absolutePath)));
    const title = parseTitle(markdown) || slug;
    const description = String(frontmatter.description || "").trim();
    const zhCopy = getZhCopy({ slug, title, description });
    const scorecard = applyManualOverride(
      { slug, title, description },
      buildScorecard({ slug, title, description })
    );

    skills.push({
      slug,
      title,
      titleZh: zhCopy.titleZh,
      description,
      summaryZh: zhCopy.summaryZh,
      sourcePath: formatSourcePath(absolutePath),
      modifiedAt: fileStats.mtime.toISOString(),
      primaryDimension: scorecard.primaryDimension,
      dimensionScores: scorecard.dimensionScores,
      pmScore: scorecard.pmScore,
      basePmScore: scorecard.basePmScore,
      baseIncluded: scorecard.baseIncluded,
      matchedKeywords: scorecard.matchedKeywords,
      included: scorecard.included,
      override: scorecard.override,
      detailUrl: buildDetailUrl(slug),
      markdown
    });
  }

  skills.sort(sortSkills);

  const includedSkills = skills.filter((skill) => skill.included);
  const countsByDimension = Object.fromEntries(
    dimensionOrder.map((dimensionKey) => [dimensionKey, 0])
  );

  for (const skill of includedSkills) {
    countsByDimension[skill.primaryDimension] += 1;
  }

  const manualOverrideCount = skills.filter(
    (skill) => skill.override?.applied
  ).length;
  const manualIncludedCount = includedSkills.filter(
    (skill) => skill.override?.applied
  ).length;

  const payload = {
    meta: {
      generatedAt: new Date().toISOString(),
      sourceRoot: formatSourcePath(sourceRoot),
      includeThreshold: taxonomy.includeThreshold,
      totalSkills: skills.length,
      includedSkills: includedSkills.length,
      manualOverrideCount,
      manualIncludedCount,
      countsByDimension,
      dimensions: dimensionOrder
    },
    skills: skills.map((skill) => ({
      slug: skill.slug,
      title: skill.title,
      titleZh: skill.titleZh,
      description: skill.description,
      summaryZh: skill.summaryZh,
      sourcePath: skill.sourcePath,
      modifiedAt: skill.modifiedAt,
      primaryDimension: skill.primaryDimension,
      dimensionScores: skill.dimensionScores,
      pmScore: skill.pmScore,
      basePmScore: skill.basePmScore,
      baseIncluded: skill.baseIncluded,
      matchedKeywords: skill.matchedKeywords,
      included: skill.included,
      override: skill.override,
      detailUrl: skill.detailUrl
    }))
  };

  const existingOutput = await readExistingOutput();

  if (existingOutput) {
    const nextComparable = JSON.stringify(buildComparablePayload(payload));
    const existingComparable = JSON.stringify(
      buildComparablePayload(existingOutput.payload)
    );

    if (nextComparable === existingComparable) {
      payload.meta.generatedAt = existingOutput.payload.meta.generatedAt;
    }
  }

  const nextOutput = `${JSON.stringify(payload, null, 2)}\n`;

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await writeDetailPages(skills);

  if (!existingOutput || existingOutput.raw !== nextOutput) {
    await fs.writeFile(outputPath, nextOutput, "utf8");
  }

  if (shouldValidate) {
    validatePayload(payload);
    console.log(
      `Validation passed: ${payload.meta.includedSkills}/${payload.meta.totalSkills} related skills included.`
    );
    return;
  }

  if (existingOutput && existingOutput.raw === nextOutput) {
    console.log(
      `No data changes. Preserved ${payload.meta.includedSkills}/${payload.meta.totalSkills} related skills.`
    );
    return;
  }

  console.log(
    `Built ${payload.meta.totalSkills} skills, included ${payload.meta.includedSkills}.`
  );
}

await main();
