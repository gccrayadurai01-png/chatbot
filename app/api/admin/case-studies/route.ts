import { requireAdmin } from "@/lib/auth";
import { createCaseStudy, listAllCaseStudies, type CaseStudyInput } from "@/lib/case-studies";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireAdmin();
  } catch (response) {
    return response as Response;
  }
  return Response.json({ caseStudies: await listAllCaseStudies() });
}

function parse(body: Record<string, unknown>): CaseStudyInput | string {
  if (typeof body.client_name !== "string" || !body.client_name.trim())
    return "client_name is required";
  if (typeof body.headline !== "string" || !body.headline.trim()) return "headline is required";
  if (typeof body.result_metric !== "string" || !body.result_metric.trim())
    return "result_metric is required — this is the win the visitor sees";

  const asStringArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];

  return {
    client_name: body.client_name.trim(),
    industry: typeof body.industry === "string" && body.industry.trim() ? body.industry.trim() : null,
    headline: body.headline.trim(),
    challenge: typeof body.challenge === "string" ? body.challenge : "",
    solution: typeof body.solution === "string" ? body.solution : "",
    result_metric: body.result_metric.trim(),
    service_slugs: asStringArray(body.service_slugs),
    published: body.published !== false,
  };
}

export async function POST(request: Request) {
  try {
    await requireAdmin();
  } catch (response) {
    return response as Response;
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const input = parse(body);
  if (typeof input === "string") return Response.json({ error: input }, { status: 400 });

  const caseStudy = await createCaseStudy(input);
  return Response.json({ caseStudy });
}
