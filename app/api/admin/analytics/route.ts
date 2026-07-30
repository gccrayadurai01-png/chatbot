import { queryOne, query } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";

/** GET /api/admin/analytics — dashboard tiles for the last 30 days. */
export async function GET() {
  try {
    await requireAdmin();
  } catch (response) {
    return response as Response;
  }

  // One round trip instead of four sequential COUNT queries.
  const totals = await queryOne<{
    sessions_30d: string;
    messages_30d: string;
    leads_30d: string;
    demos_booked: string;
    qualified: string;
    avg_messages: string | null;
    output_tokens_30d: string | null;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM chat_sessions WHERE started_at > now() - interval '30 days') AS sessions_30d,
       (SELECT COUNT(*) FROM messages      WHERE created_at > now() - interval '30 days') AS messages_30d,
       (SELECT COUNT(*) FROM leads         WHERE created_at > now() - interval '30 days') AS leads_30d,
       (SELECT COUNT(*) FROM leads         WHERE status = 'demo_booked')                  AS demos_booked,
       (SELECT COUNT(*) FROM leads         WHERE status IN ('qualified','demo_booked','won')) AS qualified,
       (SELECT AVG(c) FROM (
          SELECT COUNT(*) AS c FROM messages GROUP BY session_id
        ) t) AS avg_messages,
       (SELECT SUM(output_tokens) FROM messages
         WHERE created_at > now() - interval '30 days') AS output_tokens_30d`,
  );

  const topInterests = await query<{ interest: string; count: string }>(
    `SELECT interest, COUNT(*) AS count
       FROM leads
      WHERE interest IS NOT NULL
      GROUP BY interest
      ORDER BY count DESC
      LIMIT 5`,
  );

  const byIndustry = await query<{ industry: string; count: string }>(
    `SELECT industry, COUNT(*) AS count
       FROM leads
      WHERE industry IS NOT NULL
      GROUP BY industry
      ORDER BY count DESC
      LIMIT 5`,
  );

  const sessions = Number(totals?.sessions_30d ?? 0);
  const leads = Number(totals?.leads_30d ?? 0);

  return Response.json({
    sessions30d: sessions,
    messages30d: Number(totals?.messages_30d ?? 0),
    leads30d: leads,
    demosBooked: Number(totals?.demos_booked ?? 0),
    qualifiedLeads: Number(totals?.qualified ?? 0),
    avgMessagesPerSession: Math.round(Number(totals?.avg_messages ?? 0) * 10) / 10,
    outputTokens30d: Number(totals?.output_tokens_30d ?? 0),
    // Lead generation rate — the Part 13 KPI with a >15% target.
    leadRatePct: sessions > 0 ? Math.round((leads / sessions) * 1000) / 10 : 0,
    topInterests,
    byIndustry,
  });
}
