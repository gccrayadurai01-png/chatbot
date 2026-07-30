import { requireAdmin } from "@/lib/auth";
import { ingestWebsite } from "@/lib/ingest";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/admin/services/ingest — fetch a website URL, extract its services,
 * and save them as unpublished drafts for review.
 */
export async function POST(request: Request) {
  try {
    await requireAdmin();
  } catch (response) {
    return response as Response;
  }

  let url: string;
  try {
    const body = (await request.json()) as { url?: unknown };
    if (typeof body.url !== "string" || !body.url.trim()) {
      return Response.json({ error: "A website URL is required" }, { status: 400 });
    }
    url = body.url.trim();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Normalize a bare domain to https.
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return Response.json({ error: "That doesn't look like a valid URL" }, { status: 400 });
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return Response.json({ error: "URL must be http or https" }, { status: 400 });
  }

  const result = await ingestWebsite(url);
  if (!result.ok) {
    return Response.json({ error: result.error ?? "Ingestion failed" }, { status: 502 });
  }

  return Response.json({
    ok: true,
    servicesCreated: result.servicesCreated,
    message: `Imported ${result.servicesCreated} service${result.servicesCreated === 1 ? "" : "s"} as drafts. Review and publish them below.`,
  });
}
