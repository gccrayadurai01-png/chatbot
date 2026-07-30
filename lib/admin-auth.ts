import bcrypt from "bcryptjs";

/**
 * Verifies admin login credentials against the right backend.
 *
 *  - With Postgres: the `admin_users` table (bcrypt hashes), seeded by
 *    `npm run db:seed-admin`.
 *  - Without Postgres (local demo): a single env-configured credential, so the
 *    admin panel is usable with only an Anthropic key. Defaults are provided so
 *    a demo works out of the box, but they are LOCAL ONLY — `getAdmin` still
 *    requires a signed JWT, and you should set ADMIN_EMAIL / ADMIN_PASSWORD for
 *    anything beyond your own machine.
 */

export const DEMO_ADMIN_EMAIL = (process.env.ADMIN_EMAIL ?? "admin@cloudsufi.com").toLowerCase();
export const DEMO_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "cloudsufi-demo";

export type VerifiedAdmin = { adminId: string; email: string };

export async function verifyAdmin(
  email: string,
  password: string,
): Promise<VerifiedAdmin | null> {
  const normalized = email.trim().toLowerCase();

  if (!process.env.DATABASE_URL) {
    // Constant-ish time: compare even on email mismatch so timing doesn't leak.
    const emailOk = normalized === DEMO_ADMIN_EMAIL;
    const passOk = password === DEMO_ADMIN_PASSWORD;
    if (emailOk && passOk) return { adminId: "demo-admin", email: DEMO_ADMIN_EMAIL };
    return null;
  }

  const { queryOne } = await import("./db");
  const admin = await queryOne<{ id: string; email: string; password_hash: string }>(
    `SELECT id, email, password_hash FROM admin_users WHERE email = $1`,
    [normalized],
  );

  // Dummy hash on a missing user so response time doesn't reveal which emails exist.
  const hash =
    admin?.password_hash ?? "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv";
  const ok = await bcrypt.compare(password, hash);

  if (!admin || !ok) return null;
  return { adminId: admin.id, email: admin.email };
}
