import { listPublishedServices } from "@/lib/services";

export const runtime = "nodejs";

/**
 * GET /api/services — public. Feeds the chat widget's service picker so visitors
 * click instead of type. Returns only what the UI needs (no internal triggers).
 */
export async function GET() {
  const services = await listPublishedServices();
  return Response.json({
    services: services.map((s) => ({
      slug: s.slug,
      name: s.name,
      description: s.description,
      products: s.products,
    })),
  });
}
