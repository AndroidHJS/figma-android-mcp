import { z } from "zod";
import type { Skill } from "~/skills/types.js";

const parameters = {
  name: z
    .string()
    .describe("The name of the skill to fetch, e.g. \"android-layout\" or \"figma-android-mcp-skill\""),
};

const parametersSchema = z.object(parameters);

async function getSkill(params: z.infer<typeof parametersSchema>, skills: Skill[]) {
  const { name } = parametersSchema.parse(params);
  const skill = skills.find((s) => s.name === name);

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
    "Fetch the full content of a skill by name. Skills provide constraints and best practices for converting Figma designs to code. Call this tool when you need to read the detailed workflow or rules defined by a skill.",
  parametersSchema,
  handler: getSkill,
} as const;
