import { createSession, logEvent } from "@/lib/store";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * POST /api/chat/session — start a conversation.
 *
 * Deliberately collects no contact details: the visitor hasn't consented to
 * being a lead yet, and inserting a placeholder contact row
 * ("visitor@cloudsufi.com") just pollutes the CRM with fake people. Lead rows
 * are created later, from what the visitor actually tells us.
 */
export async function POST(request: Request) {
  const limit = rateLimit(`session:${clientIp(request)}`, 20, 60 * 60 * 1000);
  if (!limit.allowed) {
    return Response.json(
      { error: "Too many sessions. Please try again later." },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } },
    );
  }

  let visitorId: string | null = null;
  try {
    const body = (await request.json()) as { visitorId?: unknown };
    if (typeof body.visitorId === "string" && body.visitorId.length <= 128) {
      visitorId = body.visitorId;
    }
  } catch {
    // An empty body is fine.
  }

  try {
    const sessionId = await createSession({
      visitorId,
      referrer: request.headers.get("referer")?.slice(0, 500) ?? null,
      userAgent: request.headers.get("user-agent")?.slice(0, 500) ?? null,
    });

    await logEvent(sessionId, "session_started");

    return Response.json({ sessionId });
  } catch (error) {
    console.error("session create failed", error);
    return Response.json({ error: "Could not start session" }, { status: 500 });
  }
}
