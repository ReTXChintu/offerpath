/**
 * Hunt → learn: the skills the user's best-match jobs keep asking for and
 * their analyses mark as missing, ranked by how many of those jobs ask.
 *
 * "React (hooks)" is matched, but "Next.js" missing in 12 of the best-match
 * jobs is the kind of gap this surfaces, so it can go on the roadmap.
 * Pure: the service feeds it synced `job_analyses` and the catalogue.
 */

/** The fields of a synced job analysis this reads. */
export interface AnalysisDoc {
  jobId?: unknown;
  relevant?: unknown;
  matchScore?: unknown;
  missingSkills?: unknown;
}

export interface CatalogueEntry {
  id: string;
  slug: string;
  name: string;
}

export interface SkillGap {
  /** The skill as the job analyses name it (most common spelling). */
  skill: string;
  /** How many best-match jobs ask for it and find it missing. */
  jobs: number;
  /** The catalogue technology it maps to, when there is one. */
  technology: CatalogueEntry | null;
}

/** Jobs at or above this match score count as "best matches". */
export const BEST_MATCH_SCORE = 60;

/**
 * Lower-case, with punctuation and version numbers dropped, so "Node.js",
 * "NodeJS" and "node js 18" compare equal.
 */
export function normalizeSkill(skill: string): string {
  return skill
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/\b(v?\d+(\.\d+)*)\b/g, ' ')
    .replace(/\.?js\b/g, 'js')
    .replace(/[^a-z0-9+#]+/g, '')
    .trim();
}

export function skillGaps(
  analyses: AnalysisDoc[],
  catalogue: CatalogueEntry[],
  limit = 10,
): SkillGap[] {
  const byKey = new Map<string, { spellings: Map<string, number>; jobs: Set<string> }>();

  for (const analysis of analyses) {
    if (analysis.relevant === false) continue;
    const score = typeof analysis.matchScore === 'number' ? analysis.matchScore : 0;
    if (score < BEST_MATCH_SCORE) continue;
    if (!Array.isArray(analysis.missingSkills)) continue;
    const jobId = typeof analysis.jobId === 'string' ? analysis.jobId : String(byKey.size);

    for (const raw of analysis.missingSkills) {
      if (typeof raw !== 'string' || !raw.trim()) continue;
      const key = normalizeSkill(raw);
      if (!key) continue;
      const entry = byKey.get(key) ?? { spellings: new Map(), jobs: new Set() };
      entry.spellings.set(raw.trim(), (entry.spellings.get(raw.trim()) ?? 0) + 1);
      entry.jobs.add(jobId);
      byKey.set(key, entry);
    }
  }

  const catalogueByKey = new Map<string, CatalogueEntry>();
  for (const entry of catalogue) {
    catalogueByKey.set(normalizeSkill(entry.name), entry);
    catalogueByKey.set(normalizeSkill(entry.slug), entry);
  }

  return [...byKey.entries()]
    .map(([key, { spellings, jobs }]) => ({
      skill: [...spellings.entries()].sort((a, b) => b[1] - a[1])[0]![0],
      jobs: jobs.size,
      technology: catalogueByKey.get(key) ?? null,
    }))
    .sort((a, b) => b.jobs - a.jobs || a.skill.localeCompare(b.skill))
    .slice(0, limit);
}
