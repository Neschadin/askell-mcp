import type { SkillCatalog } from '@modelcontextprotocol/server/ext/skills';
import { loadSkills } from '@modelcontextprotocol/server/ext/skills/node';

const skillsDir = `${import.meta.dir}/../skills`;

let cachedCatalog: SkillCatalog | null = null;

/** Published SEP-2640 skills shipped beside this package (`skills/`). */
export async function loadPublishedSkills(): Promise<SkillCatalog> {
  if (cachedCatalog) return cachedCatalog;

  cachedCatalog = await loadSkills(skillsDir, {
    onWarning: ({ path, message }) => {
      console.error(`[askell-mcp] skills warning (${path}): ${message}`);
    },
  });

  return cachedCatalog;
}
