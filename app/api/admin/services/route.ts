import { requireAdmin } from "@/lib/auth";
import { createService, listAllServices, type ServiceInput } from "@/lib/services";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireAdmin();
  } catch (response) {
    return response as Response;
  }
  return Response.json({ services: await listAllServices() });
}

function parseServiceInput(body: Record<string, unknown>): ServiceInput | string {
  if (typeof body.name !== "string" || !body.name.trim()) return "name is required";

  const asStringArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];

  const products = Array.isArray(body.products)
    ? body.products
        .filter((p): p is { name?: unknown; description?: unknown } => typeof p === "object" && p !== null)
        .map((p) => ({
          name: typeof p.name === "string" ? p.name : "",
          description: typeof p.description === "string" ? p.description : "",
        }))
        .filter((p) => p.name.trim() !== "")
    : [];

  return {
    name: body.name.trim(),
    description: typeof body.description === "string" ? body.description : "",
    category: typeof body.category === "string" && body.category.trim() ? body.category.trim() : null,
    products,
    triggers: asStringArray(body.triggers),
    outcomes: asStringArray(body.outcomes),
    published: body.published === true,
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

  const input = parseServiceInput(body);
  if (typeof input === "string") return Response.json({ error: input }, { status: 400 });

  const service = await createService(input);
  return Response.json({ service });
}
