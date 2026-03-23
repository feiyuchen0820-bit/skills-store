#!/usr/bin/env node

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "..");
const taxonomyPath = path.join(workspaceRoot, "config", "pm-taxonomy.json");
const outputPath = path.join(workspaceRoot, "data", "skills.json");
const shouldValidate = process.argv.includes("--validate");

const taxonomy = JSON.parse(await fs.readFile(taxonomyPath, "utf8"));
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

function validatePayload(payload) {
  const errors = [];
  const skillsBySlug = new Map(payload.skills.map((skill) => [skill.slug, skill]));

  for (const skill of payload.skills) {
    const requiredFields = [
      "slug",
      "title",
      "description",
      "sourcePath",
      "modifiedAt",
      "primaryDimension",
      "dimensionScores",
      "pmScore",
      "matchedKeywords",
      "included"
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
  const skillFiles = await collectSkillFiles(sourceRoot, taxonomy.excludeDirs);
  const skills = [];

  for (const absolutePath of skillFiles) {
    const markdown = await fs.readFile(absolutePath, "utf8");
    const frontmatter = parseFrontmatter(markdown);
    const fileStats = await fs.stat(absolutePath);
    const slug = String(frontmatter.name || path.basename(path.dirname(absolutePath)));
    const title = parseTitle(markdown) || slug;
    const description = String(frontmatter.description || "").trim();
    const scorecard = buildScorecard({ slug, title, description });

    skills.push({
      slug,
      title,
      description,
      sourcePath: formatSourcePath(absolutePath),
      modifiedAt: fileStats.mtime.toISOString(),
      primaryDimension: scorecard.primaryDimension,
      dimensionScores: scorecard.dimensionScores,
      pmScore: scorecard.pmScore,
      matchedKeywords: scorecard.matchedKeywords,
      included: scorecard.included
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

  const payload = {
    meta: {
      generatedAt: new Date().toISOString(),
      sourceRoot: formatSourcePath(sourceRoot),
      includeThreshold: taxonomy.includeThreshold,
      totalSkills: skills.length,
      includedSkills: includedSkills.length,
      countsByDimension,
      dimensions: dimensionOrder
    },
    skills
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

  if (!existingOutput || existingOutput.raw !== nextOutput) {
    await fs.writeFile(outputPath, nextOutput, "utf8");
  }

  if (shouldValidate) {
    validatePayload(payload);
    console.log(
      `Validation passed: ${payload.meta.includedSkills}/${payload.meta.totalSkills} PM skills included.`
    );
  } else {
    if (existingOutput && existingOutput.raw === nextOutput) {
      console.log(
        `No data changes. Preserved ${payload.meta.includedSkills}/${payload.meta.totalSkills} PM skills.`
      );
    } else {
      console.log(
        `Built ${payload.meta.totalSkills} skills, included ${payload.meta.includedSkills}.`
      );
    }
  }
}

await main();
