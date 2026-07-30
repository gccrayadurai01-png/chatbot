import { query } from "./db";

/**
 * Case studies — the proof the agent leans on ("we helped a company like yours
 * achieve X") and the centerpiece of the one-pager.
 *
 * DB-backed when Postgres is present, otherwise a seeded in-memory list so the
 * demo has real-looking proof out of the box.
 *
 * IMPORTANT: the seed metrics below are ILLUSTRATIVE placeholders modelled on
 * CLOUDSUFI's publicly named customers. Before this goes in front of prospects,
 * an admin must replace every result_metric with a verified number — these
 * strings are printed in a PDF and spoken by the agent, so a wrong claim is a
 * brand and legal problem. The admin UI flags this.
 */

export type CaseStudy = {
  id: string;
  client_name: string;
  industry: string | null;
  headline: string;
  challenge: string;
  solution: string;
  result_metric: string;
  service_slugs: string[];
  published: boolean;
  sort_order: number;
};

function usingPostgres(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

let seedCounter = 1;

function seedCaseStudies(): CaseStudy[] {
  const seeds: Omit<CaseStudy, "id">[] = [
    {
      client_name: "A global construction-software leader",
      industry: "Digital Natives / SaaS",
      headline: "Unified fragmented product data into one governed platform",
      challenge:
        "Analytics were spread across disconnected sources, so every report meant manual reconciliation and no one trusted the numbers.",
      solution:
        "Built a governed data platform on Google Cloud, consolidating sources into a single source of truth with automated pipelines.",
      result_metric: "Reporting cut from overnight to near real-time",
      service_slugs: ["data-platform", "integration"],
      published: true,
      sort_order: 10,
    },
    {
      client_name: "A leading materials-handling company",
      industry: "Supply Chain / Manufacturing",
      headline: "Real-time inventory and telemetry across automated warehouses",
      challenge:
        "Inventory truth was split between ERP and warehouse systems, leaving operators acting on stale numbers.",
      solution:
        "Delivered a real-time visibility layer over the automation and ERP feeds, with Kinaxis-aligned planning.",
      result_metric: "Stockout-driven expediting materially reduced",
      service_slugs: ["supply-chain", "integration"],
      published: true,
      sort_order: 20,
    },
    {
      client_name: "A digital-native fintech",
      industry: "Financial Services",
      headline: "Gen AI automation on their own customer data",
      challenge:
        "Support and document handling were manual and slow, capping how fast the team could grow.",
      solution:
        "Our Gen AI Lab shipped an LLM application with guardrails and human review on top of their governed data.",
      result_metric: "Manual document handling cut by more than half",
      service_slugs: ["gen-ai"],
      published: true,
      sort_order: 30,
    },
    {
      client_name: "A major health-research institution",
      industry: "Healthcare",
      headline: "Modernized legacy data infrastructure for research at scale",
      challenge:
        "Research data sat on end-of-life infrastructure that couldn't support modern analytics or AI.",
      solution:
        "Migrated to a cloud-native platform incrementally, with governance suitable for sensitive data.",
      result_metric: "Legacy platform retired; analytics unblocked",
      service_slugs: ["app-modernization", "data-platform"],
      published: true,
      sort_order: 40,
    },
  ];

  return seeds.map((s) => ({ ...s, id: `seed-cs-${seedCounter++}` }));
}

const globalForCS = globalThis as unknown as { csCaseStudies?: CaseStudy[] };
function memory(): CaseStudy[] {
  if (!globalForCS.csCaseStudies) globalForCS.csCaseStudies = seedCaseStudies();
  return globalForCS.csCaseStudies;
}

// --- Reads -------------------------------------------------------------------

export async function listPublishedCaseStudies(): Promise<CaseStudy[]> {
  if (!usingPostgres()) {
    return memory()
      .filter((c) => c.published)
      .sort((a, b) => a.sort_order - b.sort_order);
  }
  return query<CaseStudy>(
    `SELECT id, client_name, industry, headline, challenge, solution, result_metric,
            service_slugs, published, sort_order
       FROM case_studies WHERE published = true ORDER BY sort_order, created_at`,
  );
}

export async function listAllCaseStudies(): Promise<CaseStudy[]> {
  if (!usingPostgres()) return [...memory()].sort((a, b) => a.sort_order - b.sort_order);
  return query<CaseStudy>(
    `SELECT id, client_name, industry, headline, challenge, solution, result_metric,
            service_slugs, published, sort_order
       FROM case_studies ORDER BY published DESC, sort_order, created_at`,
  );
}

export async function getCaseStudiesByIds(ids: string[]): Promise<CaseStudy[]> {
  if (ids.length === 0) return [];
  if (!usingPostgres()) return memory().filter((c) => ids.includes(c.id));
  return query<CaseStudy>(
    `SELECT id, client_name, industry, headline, challenge, solution, result_metric,
            service_slugs, published, sort_order
       FROM case_studies WHERE id = ANY($1)`,
    [ids],
  );
}

/**
 * The most relevant published case studies for a set of service slugs, best
 * match first, falling back to any published ones so the PDF is never empty.
 */
export async function relevantCaseStudies(
  serviceSlugs: string[],
  max = 2,
): Promise<CaseStudy[]> {
  const all = await listPublishedCaseStudies();
  const scored = all
    .map((c) => ({
      c,
      score: c.service_slugs.filter((s) => serviceSlugs.includes(s)).length,
    }))
    .sort((a, b) => b.score - a.score);

  const matched = scored.filter((s) => s.score > 0).map((s) => s.c);
  const chosen = matched.length > 0 ? matched : all;
  return chosen.slice(0, max);
}

// --- Writes ------------------------------------------------------------------

export type CaseStudyInput = {
  client_name: string;
  industry: string | null;
  headline: string;
  challenge: string;
  solution: string;
  result_metric: string;
  service_slugs: string[];
  published: boolean;
};

export async function createCaseStudy(input: CaseStudyInput): Promise<CaseStudy> {
  if (!usingPostgres()) {
    const list = memory();
    const cs: CaseStudy = { ...input, id: `cs-${Date.now()}-${seedCounter++}`, sort_order: (list.length + 1) * 10 };
    list.push(cs);
    return cs;
  }
  const rows = await query<CaseStudy>(
    `INSERT INTO case_studies (client_name, industry, headline, challenge, solution, result_metric, service_slugs, published)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, client_name, industry, headline, challenge, solution, result_metric, service_slugs, published, sort_order`,
    [
      input.client_name,
      input.industry,
      input.headline,
      input.challenge,
      input.solution,
      input.result_metric,
      input.service_slugs,
      input.published,
    ],
  );
  return rows[0]!;
}

export async function updateCaseStudy(
  id: string,
  patch: Partial<CaseStudyInput>,
): Promise<CaseStudy | null> {
  if (!usingPostgres()) {
    const cs = memory().find((c) => c.id === id);
    if (!cs) return null;
    Object.assign(cs, {
      client_name: patch.client_name ?? cs.client_name,
      industry: patch.industry !== undefined ? patch.industry : cs.industry,
      headline: patch.headline ?? cs.headline,
      challenge: patch.challenge ?? cs.challenge,
      solution: patch.solution ?? cs.solution,
      result_metric: patch.result_metric ?? cs.result_metric,
      service_slugs: patch.service_slugs ?? cs.service_slugs,
      published: patch.published ?? cs.published,
    });
    return cs;
  }
  const rows = await query<CaseStudy>(
    `UPDATE case_studies SET
       client_name   = COALESCE($2, client_name),
       industry      = $3,
       headline      = COALESCE($4, headline),
       challenge     = COALESCE($5, challenge),
       solution      = COALESCE($6, solution),
       result_metric = COALESCE($7, result_metric),
       service_slugs = COALESCE($8, service_slugs),
       published     = COALESCE($9, published),
       updated_at    = now()
     WHERE id = $1
     RETURNING id, client_name, industry, headline, challenge, solution, result_metric, service_slugs, published, sort_order`,
    [
      id,
      patch.client_name ?? null,
      patch.industry ?? null,
      patch.headline ?? null,
      patch.challenge ?? null,
      patch.solution ?? null,
      patch.result_metric ?? null,
      patch.service_slugs ?? null,
      patch.published ?? null,
    ],
  );
  return rows[0] ?? null;
}

export async function deleteCaseStudy(id: string): Promise<void> {
  if (!usingPostgres()) {
    const list = memory();
    const idx = list.findIndex((c) => c.id === id);
    if (idx >= 0) list.splice(idx, 1);
    return;
  }
  await query(`DELETE FROM case_studies WHERE id = $1`, [id]);
}

/**
 * Case-study block for the agent prompt, framed the way the pitch should sound:
 * "we helped [a company like theirs] achieve [result]".
 */
export async function caseStudiesForPrompt(): Promise<string> {
  const studies = await listPublishedCaseStudies();
  if (studies.length === 0) return "(No case studies configured yet.)";

  return studies
    .map(
      (c) =>
        `- ${c.client_name} (${c.industry ?? "industry n/a"}) [proves: ${c.service_slugs.join(", ") || "general"}]\n  Result: ${c.result_metric}\n  ${c.headline}`,
    )
    .join("\n\n");
}
