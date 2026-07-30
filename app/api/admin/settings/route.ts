import { requireAdmin } from "@/lib/auth";
import { getSettings, setSetting, type SettingKey } from "@/lib/settings";

export const runtime = "nodejs";

const EDITABLE: SettingKey[] = ["calendar_url", "meeting_length", "company_name"];

export async function GET() {
  try {
    await requireAdmin();
  } catch (response) {
    return response as Response;
  }
  return Response.json(await getSettings());
}

/** PUT /api/admin/settings — body is a partial map of setting key to value. */
export async function PUT(request: Request) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch (response) {
    return response as Response;
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const applied: string[] = [];

  for (const key of EDITABLE) {
    const value = body[key];
    if (value === undefined) continue;

    if (typeof value !== "string" || !value.trim()) {
      return Response.json({ error: `${key} must be a non-empty string` }, { status: 400 });
    }

    if (key === "calendar_url") {
      // The agent hands this straight to visitors, so reject anything that
      // isn't a plain https URL — a javascript: or data: URL here would be
      // rendered as a link in the widget and in the PDF.
      let parsed: URL;
      try {
        parsed = new URL(value.trim());
      } catch {
        return Response.json({ error: "calendar_url must be a valid URL" }, { status: 400 });
      }
      if (parsed.protocol !== "https:") {
        return Response.json({ error: "calendar_url must use https" }, { status: 400 });
      }
    }

    await setSetting(key, value.trim());
    applied.push(key);
  }

  if (applied.length === 0) {
    return Response.json({ error: "Nothing to update" }, { status: 400 });
  }

  // Audit log is best-effort and DB-only.
  if (process.env.DATABASE_URL) {
    const { query } = await import("@/lib/db");
    await query(
      `INSERT INTO audit_logs (admin_id, action, target, changes) VALUES ($1, $2, $3, $4)`,
      [admin.adminId, "update_settings", applied.join(","), JSON.stringify(body)],
    ).catch(() => undefined);
  }

  return Response.json({ ok: true, settings: await getSettings() });
}
