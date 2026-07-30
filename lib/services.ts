import { query } from "./db";
import { OFFERINGS } from "./catalog";

/**
 * The catalog, as admin-managed data.
 *
 * Two backends, same as the chat store:
 *  - Postgres when DATABASE_URL is set — rows an admin edits or the website
 *    ingester writes.
 *  - An in-memory list otherwise, seeded from lib/catalog.ts so the demo has a
 *    full catalog with only an Anthropic key. Admin edits persist for the life
 *    of the running server (kept on globalThis, like sessions and offers).
 */

export type Product = { name: string; description: string };

export type Service = {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string | null;
  products: Product[];
  triggers: string[];
  outcomes: string[];
  source_url: string | null;
  published: boolean;
  sort_order: number;
};

function usingPostgres(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

// --- Seed (memory mode) ------------------------------------------------------

let seedCounter = 1;

function seedServices(): Service[] {
  return OFFERINGS.map((o, i) => ({
    id: `seed-svc-${seedCounter++}`,
    slug: o.id,
    name: o.name,
    description: o.pitch,
    category: null,
    products: [],
    triggers: o.triggers,
    outcomes: o.outcomes,
    source_url: null,
    published: true,
    sort_order: (i + 1) * 10,
  }));
}

const globalForServices = globalThis as unknown as { csServices?: Service[] };
function memory(): Service[] {
  if (!globalForServices.csServices) globalForServices.csServices = seedServices();
  return globalForServices.csServices;
}

// --- Reads -------------------------------------------------------------------

/** Published services for the chat picker and the agent prompt. */
export async function listPublishedServices(): Promise<Service[]> {
  if (!usingPostgres()) {
    return memory()
      .filter((s) => s.published)
      .sort((a, b) => a.sort_order - b.sort_order);
  }

  return query<Service>(
    `SELECT id, slug, name, description, category, products, triggers, outcomes,
            source_url, published, sort_order
       FROM services
      WHERE published = true
      ORDER BY sort_order, name`,
  );
}

/** Every service, published or draft — the admin view. */
export async function listAllServices(): Promise<Service[]> {
  if (!usingPostgres()) {
    return [...memory()].sort((a, b) => a.sort_order - b.sort_order);
  }

  return query<Service>(
    `SELECT id, slug, name, description, category, products, triggers, outcomes,
            source_url, published, sort_order
       FROM services
      ORDER BY published DESC, sort_order, name`,
  );
}

export async function getServiceBySlug(slug: string): Promise<Service | null> {
  if (!usingPostgres()) return memory().find((s) => s.slug === slug) ?? null;

  const rows = await query<Service>(
    `SELECT id, slug, name, description, category, products, triggers, outcomes,
            source_url, published, sort_order
       FROM services WHERE slug = $1`,
    [slug],
  );
  return rows[0] ?? null;
}

// --- Writes ------------------------------------------------------------------

export type ServiceInput = {
  name: string;
  description: string;
  category: string | null;
  products: Product[];
  triggers: string[];
  outcomes: string[];
  published: boolean;
  source_url?: string | null;
};

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || `service-${Date.now()}`;
}

async function uniqueSlug(base: string, existing: (slug: string) => Promise<boolean>): Promise<string> {
  let slug = base;
  let n = 2;
  while (await existing(slug)) slug = `${base}-${n++}`;
  return slug;
}

export async function createService(input: ServiceInput): Promise<Service> {
  const base = slugify(input.name);

  if (!usingPostgres()) {
    const list = memory();
    const slug = await uniqueSlug(base, async (s) => list.some((x) => x.slug === s));
    const service: Service = {
      id: `svc-${Date.now()}-${seedCounter++}`,
      slug,
      name: input.name,
      description: input.description,
      category: input.category,
      products: input.products,
      triggers: input.triggers,
      outcomes: input.outcomes,
      source_url: input.source_url ?? null,
      published: input.published,
      sort_order: (list.length + 1) * 10,
    };
    list.push(service);
    return service;
  }

  const slug = await uniqueSlug(base, async (s) => {
    const rows = await query<{ id: string }>(`SELECT id FROM services WHERE slug = $1`, [s]);
    return rows.length > 0;
  });

  const rows = await query<Service>(
    `INSERT INTO services (slug, name, description, category, products, triggers, outcomes, source_url, published)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, slug, name, description, category, products, triggers, outcomes, source_url, published, sort_order`,
    [
      slug,
      input.name,
      input.description,
      input.category,
      JSON.stringify(input.products),
      input.triggers,
      input.outcomes,
      input.source_url ?? null,
      input.published,
    ],
  );
  return rows[0]!;
}

export async function updateService(
  id: string,
  patch: Partial<ServiceInput>,
): Promise<Service | null> {
  if (!usingPostgres()) {
    const service = memory().find((s) => s.id === id);
    if (!service) return null;
    Object.assign(service, {
      name: patch.name ?? service.name,
      description: patch.description ?? service.description,
      category: patch.category !== undefined ? patch.category : service.category,
      products: patch.products ?? service.products,
      triggers: patch.triggers ?? service.triggers,
      outcomes: patch.outcomes ?? service.outcomes,
      published: patch.published ?? service.published,
    });
    return service;
  }

  const rows = await query<Service>(
    `UPDATE services SET
       name        = COALESCE($2, name),
       description = COALESCE($3, description),
       category    = $4,
       products    = COALESCE($5, products),
       triggers    = COALESCE($6, triggers),
       outcomes    = COALESCE($7, outcomes),
       published   = COALESCE($8, published),
       updated_at  = now()
     WHERE id = $1
     RETURNING id, slug, name, description, category, products, triggers, outcomes, source_url, published, sort_order`,
    [
      id,
      patch.name ?? null,
      patch.description ?? null,
      patch.category ?? null,
      patch.products ? JSON.stringify(patch.products) : null,
      patch.triggers ?? null,
      patch.outcomes ?? null,
      patch.published ?? null,
    ],
  );
  return rows[0] ?? null;
}

export async function deleteService(id: string): Promise<void> {
  if (!usingPostgres()) {
    const list = memory();
    const idx = list.findIndex((s) => s.id === id);
    if (idx >= 0) list.splice(idx, 1);
    return;
  }
  await query(`DELETE FROM services WHERE id = $1`, [id]);
}

/** Compact catalog block injected into the agent's system prompt. */
export async function servicesForPrompt(): Promise<string> {
  const services = await listPublishedServices();
  if (services.length === 0) return "(No services configured yet.)";

  return services
    .map((s) => {
      const products = s.products.length
        ? `\n  Products: ${s.products.map((p) => p.name).join(", ")}`
        : "";
      return `- ${s.name} (slug: ${s.slug})\n  ${s.description}\n  Use when: ${s.triggers.join(", ")}\n  Outcomes: ${s.outcomes.join(" | ")}${products}`;
    })
    .join("\n\n");
}
