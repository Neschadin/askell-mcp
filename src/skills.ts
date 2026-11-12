import {
  SkillCatalog,
  memorySkillFiles,
} from "@modelcontextprotocol/server/ext/skills";

import askellDocsSkill from "../skills/askell-docs/SKILL.md" with { type: "text" };
import askellMcpSkill from "../skills/askell-mcp/SKILL.md" with { type: "text" };

const EMBEDDED_SKILLS = memorySkillFiles({
  "askell-docs/SKILL.md": askellDocsSkill,
  "askell-mcp/SKILL.md": askellMcpSkill,
});

let cachedCatalog: SkillCatalog | null = null;

/**
 * Published SEP-2640 skills embedded directly into the bundle/binary so
 * standalone compiled executables work without an external `skills/` folder.
 */
export async function loadPublishedSkills(): Promise<SkillCatalog> {
  if (cachedCatalog) return cachedCatalog;

  cachedCatalog = await SkillCatalog.load(EMBEDDED_SKILLS, {
    strict: true,
    onWarning: ({ path, message }) => {
      console.error(`[askell-mcp] skills warning (${path}): ${message}`);
    },
  });

  return cachedCatalog;
}
