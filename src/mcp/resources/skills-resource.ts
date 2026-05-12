import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toSkillList } from "../../skills/index.js";
import type { Skill } from "../../skills/types.js";

/**
 * Register MCP resources for the skill system:
 * - `skill://list` — static resource returning JSON array of all skill metadata
 * - `skill://{name}` — dynamic resource returning individual skill content
 */
export function registerSkillResources(server: McpServer, skills: Skill[]): void {

  server.registerResource(
    "skill_list",
    "skill://list",
    {
      title: "Available Skills",
      description:
        "Lists all available skill definitions. Skills provide constraints and best practices for converting Figma designs to code.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          text: JSON.stringify(toSkillList(skills), null, 2),
          mimeType: "application/json",
        },
      ],
    }),
  );

  const template = new ResourceTemplate("skill://{name}", {
    list: async () => ({
      resources: skills.map((s) => ({
        uri: `skill://${s.name}`,
        name: s.name,
        title: s.title,
        description: s.description,
      })),
    }),
  });

  server.registerResource(
    "skill",
    template,
    {
      title: "Skill",
      description:
        "Individual skill content providing constraints and best practices for Figma-to-code conversion.",
      mimeType: "text/markdown",
    },
    async (uri, variables) => {
      const name = Array.isArray(variables.name) ? variables.name[0] : variables.name;
      const skill = skills.find((s) => s.name === name);

      if (!skill) {
        throw new Error(
          `Unknown skill "${name}". Available skills: ${skills.map((s) => s.name).join(", ")}`,
        );
      }

      return {
        contents: [
          {
            uri: uri.href,
            text: skill.content,
            mimeType: "text/markdown",
          },
        ],
      };
    },
  );
}
