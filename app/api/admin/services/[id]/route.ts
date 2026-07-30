import { requireAdmin } from "@/lib/auth";
import { deleteService, updateService, type ServiceInput } from "@/lib/services";

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

  const patch: Partial<ServiceInput> = {};
  if (typeof body.name === "string") patch.name = body.name.trim();
  if (typeof body.description === "string") patch.description = body.description;
  if (body.category !== undefined)
    patch.category = typeof body.category === "string" && body.category.trim() ? body.category.trim() : null;
  if (Array.isArray(body.products)) {
    patch.products = body.products
      .filter((p): p is { name?: unknown; description?: unknown } => typeof p === "object" && p !== null)
      .map((p) => ({
        name: typeof p.name === "string" ? p.name : "",
        description: typeof p.description === "string" ? p.description : "",
      }))
      .filter((p) => p.name.trim() !== "");
  }
  if (body.triggers !== undefined) patch.triggers = asStringArray(body.triggers);
  if (body.outcomes !== undefined) patch.outcomes = asStringArray(body.outcomes);
  if (typeof body.published === "boolean") patch.published = body.published;

  const service = await updateService(id, patch);
  if (!service) return Response.json({ error: "Service not found" }, { status: 404 });
  return Response.json({ service });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
  } catch (response) {
    return response as Response;
  }
  const { id } = await context.params;
  await deleteService(id);
  return Response.json({ ok: true });
}
