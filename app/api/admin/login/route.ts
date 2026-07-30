import { createSessionToken, setSessionCookie } from "@/lib/auth";
import { verifyAdmin } from "@/lib/admin-auth";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  // Throttle by IP to slow credential stuffing.
  const limit = rateLimit(`login:${clientIp(request)}`, 10, 15 * 60 * 1000);
  if (!limit.allowed) {
    return Response.json(
      { error: "Too many attempts. Try again shortly." },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } },
    );
  }

  let email: string;
  let password: string;
  try {
    const body = (await request.json()) as { email?: unknown; password?: unknown };
    if (typeof body.email !== "string" || typeof body.password !== "string") {
      return Response.json({ error: "Email and password are required" }, { status: 400 });
    }
    email = body.email;
    password = body.password;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const admin = await verifyAdmin(email, password);
  if (!admin) {
    return Response.json({ error: "Invalid email or password" }, { status: 401 });
  }

  await setSessionCookie(await createSessionToken(admin));
  return Response.json({ ok: true, email: admin.email });
}
