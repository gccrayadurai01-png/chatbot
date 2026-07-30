import { query, queryOne } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { handoffReasons } from "@/lib/leads";

export const runtime = "nodejs";

const STATUSES = ["new", "contacted", "qualified", "demo_booked", "won", "lost"] as const;
type Status = (typeof STATUSES)[number];

/** GET /api/admin/leads/:id — lead detail plus the full transcript. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
  } catch (response) {
    return response as Response;
  }

  const { id } = await context.params;

  const lead = await queryOne<Record<string, unknown>>(
    `SELECT * FROM leads WHERE id = $1`,
    [id],
  );
  if (!lead) return Response.json({ error: "Lead not found" }, { status: 404 });

  const transcript = await query<{ role: string; content: string; created_at: string }>(
    `SELECT role, content, created_at FROM messages
      WHERE session_id = $1
      ORDER BY created_at ASC, id ASC`,
    [lead.session_id],
  );

  return Response.json({
    lead,
    transcript,
    handoffReasons: await handoffReasons(String(lead.session_id)),
  });
}

/** PATCH /api/admin/leads/:id — update status and/or notes. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch (response) {
    return response as Response;
  }

  const { id } = await context.params;

  let status: Status | undefined;
  let notes: string | undefined;
  try {
    const body = (await request.json()) as { status?: unknown; notes?: unknown };
    if (body.status !== undefined) {
      if (typeof body.status !== "string" || !(STATUSES as readonly string[]).includes(body.status)) {
        return Response.json(
          { error: `status must be one of: ${STATUSES.join(", ")}` },
          { status: 400 },
        );
      }
      status = body.status as Status;
    }
    if (body.notes !== undefined) {
      if (typeof body.notes !== "string" || body.notes.length > 5_000) {
        return Response.json({ error: "notes must be a string under 5000 chars" }, { status: 400 });
      }
      notes = body.notes;
    }
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (status === undefined && notes === undefined) {
    return Response.json({ error: "Nothing to update" }, { status: 400 });
  }

  // COALESCE keeps the existing value when a field wasn't supplied.
  const updated = await queryOne<{ id: string; status: string }>(
    `UPDATE leads
        SET status = COALESCE($2, status),
            notes  = COALESCE($3, notes),
            updated_at = now()
      WHERE id = $1
      RETURNING id, status`,
    [id, status ?? null, notes ?? null],
  );

  if (!updated) return Response.json({ error: "Lead not found" }, { status: 404 });

  await query(
    `INSERT INTO audit_logs (admin_id, action, target, changes) VALUES ($1, $2, $3, $4)`,
    [admin.adminId, "update_lead", id, JSON.stringify({ status, notesChanged: notes !== undefined })],
  );

  return Response.json({ ok: true, lead: updated });
}
