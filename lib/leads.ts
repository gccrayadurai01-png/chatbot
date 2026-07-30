import { query, queryOne } from "./db";

/**
 * Lead writes triggered by agent tool calls.
 *
 * All of these are no-ops without a database, so the chat keeps working in
 * memory mode — the agent still runs discovery, still generates the one-pager,
 * still offers the meeting; only persistence is skipped.
 */

function persistenceEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export type LeadFromTool = {
  email: string;
  name: string | null;
  domain: string;
  company: string | null;
  researchSummary: string | null;
};

/**
 * Called when capture_email accepts an address. Creates the lead row or fills
 * in what's newly known — COALESCE so a later call can't blank a field that was
 * already populated. `status` and `notes` belong to the sales team; never
 * touched here.
 */
export async function upsertLeadFromTool(
  sessionId: string,
  lead: LeadFromTool,
): Promise<void> {
  if (!persistenceEnabled()) return;

  try {
    await query(
      `INSERT INTO leads (session_id, email, name, domain, company, research_summary, intent)
       VALUES ($1, $2, $3, $4, $5, $6, 'researching')
       ON CONFLICT (session_id) DO UPDATE SET
         email            = COALESCE(EXCLUDED.email, leads.email),
         name             = COALESCE(EXCLUDED.name, leads.name),
         domain           = COALESCE(EXCLUDED.domain, leads.domain),
         company          = COALESCE(EXCLUDED.company, leads.company),
         research_summary = COALESCE(EXCLUDED.research_summary, leads.research_summary),
         updated_at       = now()`,
      [sessionId, lead.email, lead.name, lead.domain, lead.company, lead.researchSummary],
    );

    await query(
      `INSERT INTO events (session_id, name, properties) VALUES ($1, 'email_captured', $2)`,
      [sessionId, JSON.stringify({ domain: lead.domain, researched: Boolean(lead.researchSummary) })],
    );
  } catch (error) {
    console.error("upsertLeadFromTool failed", sessionId, error);
  }
}

export type DiscoveryInput = {
  pain: string;
  context: string | null;
  stack: string | null;
  urgency: string | null;
  role: string | null;
  recommended: string[];
};

/** Called by record_discovery. Upsert keyed on session. */
export async function recordDiscovery(
  sessionId: string,
  discovery: DiscoveryInput,
): Promise<void> {
  if (!persistenceEnabled()) return;

  try {
    await query(
      `INSERT INTO discovery (session_id, pain, context, stack, urgency, role, recommended)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (session_id) DO UPDATE SET
         pain        = COALESCE(EXCLUDED.pain, discovery.pain),
         context     = COALESCE(EXCLUDED.context, discovery.context),
         stack       = COALESCE(EXCLUDED.stack, discovery.stack),
         urgency     = COALESCE(EXCLUDED.urgency, discovery.urgency),
         role        = COALESCE(EXCLUDED.role, discovery.role),
         recommended = CASE
                         WHEN array_length(EXCLUDED.recommended, 1) IS NULL
                         THEN discovery.recommended
                         ELSE EXCLUDED.recommended
                       END,
         updated_at  = now()`,
      [
        sessionId,
        discovery.pain || null,
        discovery.context,
        discovery.stack,
        discovery.urgency,
        discovery.role,
        discovery.recommended,
      ],
    );

    // Mirror the recommended offering onto the lead so the dashboard can show it
    // without a join, and bump intent past the default.
    if (discovery.recommended.length > 0) {
      await query(
        `UPDATE leads
            SET interest = $2, updated_at = now()
          WHERE session_id = $1 AND (interest IS NULL OR interest = '')`,
        [sessionId, discovery.recommended.join(", ")],
      );
    }
  } catch (error) {
    console.error("recordDiscovery failed", sessionId, error);
  }
}

/** Called when the agent hands over the calendar link. */
export async function markMeetingOffered(sessionId: string): Promise<void> {
  if (!persistenceEnabled()) return;

  try {
    await query(
      `UPDATE leads SET meeting_offered = true, intent = 'evaluating', updated_at = now()
        WHERE session_id = $1`,
      [sessionId],
    );
    await query(
      `INSERT INTO events (session_id, name) VALUES ($1, 'meeting_offered')`,
      [sessionId],
    );
  } catch (error) {
    console.error("markMeetingOffered failed", sessionId, error);
  }
}

/**
 * Conditions that mean a human should pick this up now. Surfaced in the
 * dashboard so reps triage by signal rather than by arrival order.
 */
export async function handoffReasons(sessionId: string): Promise<string[]> {
  if (!persistenceEnabled()) return [];

  const row = await queryOne<{
    email: string | null;
    meeting_offered: boolean;
    offer_token: string | null;
    urgency: string | null;
    message_count: string;
  }>(
    `SELECT l.email, l.meeting_offered, l.offer_token, d.urgency,
            (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS message_count
       FROM chat_sessions s
       LEFT JOIN leads l     ON l.session_id = s.id
       LEFT JOIN discovery d ON d.session_id = s.id
      WHERE s.id = $1`,
    [sessionId],
  ).catch(() => null);

  if (!row) return [];

  const reasons: string[] = [];
  if (row.email) reasons.push("Work email captured");
  if (row.offer_token) reasons.push("One-pager generated");
  if (row.meeting_offered) reasons.push("Meeting offered — follow up");
  if (row.urgency && /quarter|month|week|urgent|asap|funded|budget/i.test(row.urgency)) {
    reasons.push(`Timeline signal: ${row.urgency}`);
  }
  if (Number(row.message_count) >= 12) reasons.push("Long, engaged conversation");
  return reasons;
}
