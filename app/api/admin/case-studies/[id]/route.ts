import { requireAdmin } from "@/lib/auth";
import { deleteCaseStudy, updateCaseStudy, type CaseStudyInput } from "@/lib/case-studies";

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
  } catch (response) {
    return response as Response;
  }

  const { id } = await context.params;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const asStringArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];

  const patch: Partial<CaseStudyInput> = {};
  if (typeof body.client_name === "string") patch.client_name = body.client_name.trim();
  if (body.industry !== undefined)
    patch.industry = typeof body.industry === "string" && body.industry.trim() ? body.industry.trim() : null;
  if (typeof body.headline === "string") patch.headline = body.headline.trim();
  if (typeof body.challenge === "string") patch.challenge = body.challenge;
  if (typeof body.solution === "string") patch.solution = body.solution;
  if (typeof body.result_metric === "string") patch.result_metric = body.result_metric.trim();
  if (body.service_slugs !== undefined) patch.service_slugs = asStringArray(body.service_slugs);
  if (typeof body.published === "boolean") patch.published = body.published;

  const caseStudy = await updateCaseStudy(id, patch);
  if (!caseStudy) return Response.json({ error: "Case study not found" }, { status: 404 });
  return Response.json({ caseStudy });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
  } catch (response) {
    return response as Response;
  }
  const { id } = await context.params;
  await deleteCaseStudy(id);
  return Response.json({ ok: true });
}
