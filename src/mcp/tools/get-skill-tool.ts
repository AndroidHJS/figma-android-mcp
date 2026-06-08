import { z } from "zod";
import type { Skill } from "~/skills/types.js";

const parameters = {
  name: z
    .string()
    .optional()
    .describe(
      "Optional. The name of the skill to fetch full content for, e.g. \"android-layout\" or \"figma-android-mcp-skill\". Omit this parameter to list all available skills with lightweight instructions (no full content).",
    ),
};

const parametersSchema = z.object(parameters);

async function getSkill(params: z.infer<typeof parametersSchema>, skills: Skill[]) {
  const { name } = parametersSchema.parse(params);

  if (!name) {
    const lines: string[] = ["# 可用技能\n"];
    for (const s of skills) {
      const section = [`## ${s.name}${s.category ? ` (${s.category})` : ""}`, `**${s.title}**`, s.description];
      if (s.instructions) {
        section.push(`> 何时触发：${s.instructions}`);
      }
      if (s.triggers?.length) {
        section.push(`> 触发关键词：${s.triggers.join("、")}`);
      }
      lines.push(section.join("\n\n"));
    }
    return {
      content: [{ type: "text" as const, text: lines.join("\n\n---\n\n") }],
    };
  }

  const skill = skills.find((s) => s.name === name)
    ?? skills.find((s) => s.triggers?.includes(name));

  if (!skill) {
    const available = skills.map((s) => s.name).join(", ");
    return {
      isError: true,
      content: [{ type: "text" as const, text: `Unknown skill "${name}". Available: ${available}` }],
    };
  }

  return {
    content: [{ type: "text" as const, text: skill.content }],
  };
}

export const getSkillTool = {
  name: "get_skill",
  description:
    "Fetch a skill by name or trigger phrase to get its full content, or call without a name to list all available skills with lightweight trigger instructions. Skills provide constraints and best practices for converting Figma designs to code. Call this tool first to discover what skills exist and when to use them.",
  parametersSchema,
  handler: getSkill,
} as const;
