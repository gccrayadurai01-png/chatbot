/**
 * CLOUDSUFI offering catalog.
 *
 * This is the answer to "how does the bot know what to offer?" — it does not
 * improvise. Each entry declares the signals that should trigger it, the
 * outcomes worth claiming, and the proof points we can actually stand behind.
 * The agent matches discovery answers against `triggers` and builds the
 * one-pager from `outcomes` / `proof`.
 *
 * EDIT THIS FILE to change what the bot sells. Everything downstream —
 * the system prompt's catalog block and the PDF — reads from here, so there is
 * one source of truth and no risk of the prompt and the PDF disagreeing.
 */

export type Offering = {
  id: string;
  name: string;
  /** One line the agent can say out loud. */
  pitch: string;
  /** Free-text signals: pains, phrases, and stack hints that should surface this. */
  triggers: string[];
  /** Business outcomes. Directional, never guaranteed. */
  outcomes: string[];
  /** Real references only. If we can't name it, it doesn't go here. */
  proof: string[];
  /** What we propose as the concrete next step. */
  nextStep: string;
  /** Typical engagement shape, for expectation-setting. Never a quote. */
  shape: string;
};

export const OFFERINGS: Offering[] = [
  {
    id: "data-platform",
    name: "Data Platform & Warehouse Modernization",
    pitch:
      "Consolidate fragmented data into one governed warehouse your analysts and AI can actually use.",
    triggers: [
      "siloed data",
      "multiple sources of truth",
      "on-prem warehouse",
      "legacy Teradata / Netezza / Hadoop",
      "slow reports",
      "BigQuery / Snowflake / Databricks migration",
      "data quality",
      "governance",
      "no single source of truth",
    ],
    outcomes: [
      "One governed source of truth across source systems",
      "Report latency measured in minutes rather than overnight batches",
      "Lower total platform cost after decommissioning legacy infrastructure",
    ],
    proof: [
      "Google Cloud partner with delivered warehouse migrations",
      "Oracle and Kinaxis partnerships for enterprise source systems",
    ],
    nextStep: "A technical assessment of your current data landscape",
    shape: "Assessment first, then a phased migration — scope drives timeline and cost",
  },
  {
    id: "gen-ai",
    name: "Generative AI & LLM Applications",
    pitch:
      "Put LLMs on your own data — agents, copilots, and document automation built by our Gen AI Lab.",
    triggers: [
      "gen ai",
      "generative ai",
      "llm",
      "chatbot",
      "copilot",
      "agent",
      "rag",
      "document processing",
      "customer service automation",
      "summarization",
      "knowledge search",
      "glean",
    ],
    outcomes: [
      "Manual document and ticket handling substantially reduced",
      "Institutional knowledge searchable in natural language",
      "Production-grade guardrails, evaluation, and human review built in",
    ],
    proof: [
      "Gen AI Lab with 500 experts",
      "LLM applications delivered across finance, retail, and manufacturing",
    ],
    nextStep: "A Gen AI use-case workshop to pick the highest-ROI first build",
    shape: "Workshop, then a scoped pilot on one use case before scaling",
  },
  {
    id: "supply-chain",
    name: "Antifragile Supply Chain",
    pitch:
      "Real-time inventory and demand visibility that holds up when the plan breaks.",
    triggers: [
      "inventory",
      "stockout",
      "supply chain",
      "demand forecasting",
      "logistics",
      "warehouse operations",
      "kinaxis",
      "planning",
      "fulfilment",
      "fulfillment",
      "distribution",
    ],
    outcomes: [
      "Real-time inventory visibility across channels and sites",
      "Fewer stockouts and less emergency expediting",
      "Planning cycles that respond to disruption instead of lagging it",
    ],
    proof: ["Kinaxis partnership", "Supply chain delivery with Dematic"],
    nextStep: "A supply chain discovery session with our practice lead",
    shape: "Discovery session, then a visibility pilot on one product line or region",
  },
  {
    id: "app-modernization",
    name: "Application & Database Modernization",
    pitch:
      "Move legacy applications and databases to cloud-native without a rewrite-everything gamble.",
    triggers: [
      "legacy application",
      "monolith",
      "modernization",
      "refactor",
      "database migration",
      "oracle to postgres",
      "lift and shift",
      "technical debt",
      "end of life",
      "mainframe",
    ],
    outcomes: [
      "Legacy platforms off end-of-life infrastructure",
      "Deployment frequency up, incident recovery time down",
      "Licensing and hosting cost reduced after cutover",
    ],
    proof: ["Oracle partnership", "Delivered database and application migrations"],
    nextStep: "A modernization assessment covering one candidate application",
    shape: "Assessment, then incremental migration — no big-bang cutover",
  },
  {
    id: "integration",
    name: "Enterprise Integration",
    pitch: "Make your systems talk to each other reliably, with observability built in.",
    triggers: [
      "integration",
      "api",
      "etl",
      "elt",
      "data pipeline",
      "systems don't talk",
      "manual data entry",
      "spreadsheet",
      "csv export",
      "erp",
      "crm sync",
      "middleware",
    ],
    outcomes: [
      "Manual data movement and re-entry eliminated",
      "Pipeline failures surfaced before the business notices",
      "New system onboarding measured in weeks, not quarters",
    ],
    proof: ["Integration delivery across CPG, retail, and financial services"],
    nextStep: "An integration architecture review",
    shape: "Architecture review, then build out the highest-pain interfaces first",
  },
  {
    id: "managed-services",
    name: "Managed Data Services",
    pitch: "We run the platform 24/7 so your team ships features instead of firefighting.",
    triggers: [
      "small team",
      "no data engineers",
      "can't hire",
      "on call",
      "firefighting",
      "maintenance burden",
      "support",
      "24/7",
      "keep the lights on",
      "attrition",
    ],
    outcomes: [
      "24/7 coverage without growing headcount",
      "Engineering time returned to product work",
      "Defined SLAs on pipeline availability",
    ],
    proof: ["24/7 managed services practice", "15+ years average team experience"],
    nextStep: "A managed services scoping call",
    shape: "Scoping call, then a transition period before we take the pager",
  },
];

/** Compact catalog block injected into the system prompt. */
export function catalogForPrompt(): string {
  return OFFERINGS.map(
    (o) =>
      `- ${o.name} (id: ${o.id})\n  Pitch: ${o.pitch}\n  Use when: ${o.triggers.join(", ")}\n  Outcomes: ${o.outcomes.join(" | ")}\n  Proof: ${o.proof.join(" | ")}\n  Next step: ${o.nextStep}\n  Engagement shape: ${o.shape}`,
  ).join("\n\n");
}

export function findOffering(id: string): Offering | undefined {
  return OFFERINGS.find((o) => o.id === id);
}

/**
 * Keyword fallback used only for admin-side reporting when the agent didn't
 * name an offering. Not used to drive the conversation — the model does that.
 */
export function guessOfferings(text: string): Offering[] {
  const haystack = text.toLowerCase();
  return OFFERINGS.map((offering) => ({
    offering,
    hits: offering.triggers.filter((t) => haystack.includes(t.toLowerCase())).length,
  }))
    .filter((row) => row.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .map((row) => row.offering);
}
