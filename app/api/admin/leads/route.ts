import { query } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";

const STATUSES = ["new", "contacted", "qualified", "demo_booked", "won", "lost"] as const;
const SORTS: Record<string, string> = {
  created_at: "l.created_at",
  updated_at: "l.updated_at",
  company: "l.company",
};

export type LeadRow = {
  id: string;
  session_id: string;
  name: string | null;
  email: string | null;
  company: string | null;
  industry: string | null;
  interest: string | null;
  intent: string;
  opportunity: string;
  status: string;
  notes: string | null;
  created_at: string;
  message_count: string;
  // Agentic fields
  domain: string | null;
  research_summary: string | null;
  offer_token: string | null;
  meeting_offered: boolean;
  pain: string | null;
  context: string | null;
  stack: string | null;
  urgency: string | null;
  role: string | null;
  recommended: string[] | null;
};

/** GET /api/admin/leads?status=new&q=acme&sort=created_at&limit=50&offset=0 */
export async function GET(request: Request) {
  try {
    await requireAdmin();
  } catch (response) {
    return response as Response;
  }

  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const search = url.searchParams.get("q")?.trim();

  // Whitelist the sort column — an interpolated `sort` query param is a SQL
  // injection hole, since column names can't be parameterized.
  const sortColumn = SORTS[url.searchParams.get("sort") ?? "created_at"] ?? "l.created_at";

  const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 200);
  const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (status && (STATUSES as readonly string[]).includes(status)) {
    params.push(status);
    conditions.push(`l.status = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    conditions.push(
      `(l.company ILIKE $${params.length} OR l.email ILIKE $${params.length} OR l.name ILIKE $${params.length})`,
    );
  }

  params.push(limit, offset);

  const rows = await query<LeadRow>(
    `SELECT l.id, l.session_id, l.name, l.email, l.company, l.industry, l.interest,
            l.intent, l.opportunity, l.status, l.notes, l.created_at,
            l.domain, l.research_summary, l.offer_token, l.meeting_offered,
            d.pain, d.context, d.stack, d.urgency, d.role, d.recommended,
            (SELECT COUNT(*) FROM messages m WHERE m.session_id = l.session_id) AS message_count
       FROM leads l
       LEFT JOIN discovery d ON d.session_id = l.session_id
       ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
      ORDER BY ${sortColumn} DESC NULLS LAST
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return Response.json({ leads: rows });
}
