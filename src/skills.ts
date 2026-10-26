import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { SkillCatalog } from '@modelcontextprotocol/server/ext/skills';
import { loadSkills } from '@modelcontextprotocol/server/ext/skills/node';

function resolveSkillsDir(): string {
  const nextToModule = join(import.meta.dir, '..', 'skills');
  if (existsSync(nextToModule)) return nextToModule;
  return join(dirname(process.execPath), 'skills');
}

let cachedCatalog: SkillCatalog | null = null;

/** Published SEP-2640 skills shipped beside this package (`skills/`). */
export async function loadPublishedSkills(): Promise<SkillCatalog> {
  if (cachedCatalog) return cachedCatalog;

  cachedCatalog = await loadSkills(resolveSkillsDir(), {
    onWarning: ({ path, message }) => {
      console.error(`[askell-mcp] skills warning (${path}): ${message}`);
    },
  });

  return cachedCatalog;
}
