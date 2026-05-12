import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { load as parseYaml } from "js-yaml";
import { builtInSkills } from "./built-in.js";
import type { Skill, SkillMeta } from "./types.js";

const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

function parseMarkdownSkill(filePath: string): Skill {
  const raw = readFileSync(filePath, "utf-8").replace(/\r\n/g, "\n");
  const match = raw.match(FRONTMATTER_REGEX);
  if (!match) {
    throw new Error(
      `Skill file "${filePath}" is missing YAML frontmatter. Expected format:\n---\nname: my-skill\ntitle: My Skill\ndescription: ...\n---\nContent...`,
    );
  }
  const frontmatter = parseYaml(match[1]) as Record<string, unknown>;
  const content = match[2].trim();

  if (typeof frontmatter.name !== "string" || !frontmatter.name) {
    throw new Error(`Skill file "${filePath}" is missing required "name" in frontmatter`);
  }
  if (typeof frontmatter.title !== "string" || !frontmatter.title) {
    throw new Error(`Skill file "${filePath}" is missing required "title" in frontmatter`);
  }
  if (typeof frontmatter.description !== "string" || !frontmatter.description) {
    throw new Error(`Skill file "${filePath}" is missing required "description" in frontmatter`);
  }

  return {
    name: frontmatter.name,
    title: frontmatter.title,
    description: frontmatter.description,
    category: typeof frontmatter.category === "string" ? frontmatter.category : undefined,
    content,
  };
}

function loadSkillsFromDir(dir: string): Skill[] {
  if (!existsSync(dir)) return [];
  const skills: Skill[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) continue;
    if (extname(entry) !== ".md") continue;
    try {
      skills.push(parseMarkdownSkill(fullPath));
    } catch (err) {
      process.stderr.write(`Warning: skipping skill file "${fullPath}": ${err instanceof Error ? err.message : err}\n`);
    }
  }
  return skills;
}

/**
 * Load all skills (built-in + optional custom directory).
 * Custom skills override built-in skills with the same name.
 */
export function loadSkills(customDir?: string): Skill[] {
  const skillMap = new Map<string, Skill>();

  for (const skill of builtInSkills) {
    skillMap.set(skill.name, skill);
  }

  if (customDir) {
    const customSkills = loadSkillsFromDir(customDir);
    for (const skill of customSkills) {
      skillMap.set(skill.name, skill);
    }
  }

  return [...skillMap.values()];
}

/** Returns a listing-friendly subset — no content, just metadata. */
export function toSkillList(skills: Skill[]): SkillMeta[] {
  return skills.map(({ name, title, description, category }) => ({
    name,
    title,
    description,
    category,
  }));
}
