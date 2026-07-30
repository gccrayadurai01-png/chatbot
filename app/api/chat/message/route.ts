import { CHAT_MODEL, runAgent, type AgentEvent, type ChatTurn } from "@/lib/agent";
import { addMessage, logEvent } from "@/lib/store";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
// The agentic loop can run several model turns plus a web search.
export const maxDuration = 120;

const MAX_MESSAGE_CHARS = 4_000;
const HISTORY_TURNS = 24;

/**
 * POST /api/chat/message
 *
 * Streams newline-delimited JSON events (see AgentEvent). Richer than plain
 * text because the widget renders more than prose — tool status, the one-pager
 * card, and the meeting CTA.
 */
export async function POST(request: Request) {
  const limit = rateLimit(`message:${clientIp(request)}`, 60, 60 * 60 * 1000);
  if (!limit.allowed) {
    return Response.json(
      { error: "You're sending messages very quickly. Please wait a moment." },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } },
    );
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: "Server is missing ANTHROPIC_API_KEY. Add it to .env and restart." },
      { status: 500 },
    );
  }

  let sessionId: string;
  let message: string;
  let clientHistory: ChatTurn[] = [];
  let leadContext = "";
  try {
    const body = (await request.json()) as {
      sessionId?: unknown;
      message?: unknown;
      history?: unknown;
      lead?: unknown;
    };
    if (typeof body.sessionId !== "string" || typeof body.message !== "string") {
      return Response.json({ error: "sessionId and message are required" }, { status: 400 });
    }
    sessionId = body.sessionId;
    message = body.message.trim();

    // The persistent contact bar sends the visitor's name + work email once they
    // fill it. Surface it to the agent as context so it addresses them by name
    // and NEVER asks for the email again.
    const rawLead = body.lead;
    if (
      rawLead &&
      typeof rawLead === "object" &&
      typeof (rawLead as { email?: unknown }).email === "string" &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((rawLead as { email: string }).email)
    ) {
      const email = (rawLead as { email: string }).email.trim().slice(0, 200);
      const name =
        typeof (rawLead as { name?: unknown }).name === "string"
          ? (rawLead as { name: string }).name.trim().slice(0, 100)
          : "";
      leadContext =
        `(Contact already provided via the form: ${name ? `name ${name}, ` : ""}work email ${email}. ` +
        `Do NOT ask for their name or email again — address them by first name. When it's time to ` +
        `send the one-pager, call capture_email with this email.)`;
    }

    // The conversation is STATELESS: the widget sends the prior turns with every
    // message, so any serverless instance can answer without a shared session
    // store. Sanitize hard — this is untrusted client input.
    if (Array.isArray(body.history)) {
      clientHistory = body.history
        .filter(
          (t): t is { role: "user" | "assistant"; content: string } =>
            !!t &&
            typeof t === "object" &&
            ((t as { role?: unknown }).role === "user" ||
              (t as { role?: unknown }).role === "assistant") &&
            typeof (t as { content?: unknown }).content === "string" &&
            (t as { content: string }).content.trim().length > 0,
        )
        .map((t) => ({ role: t.role, content: t.content.slice(0, MAX_MESSAGE_CHARS) }))
        .slice(-HISTORY_TURNS);
    }
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!message) {
    return Response.json({ error: "Message cannot be empty" }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    return Response.json(
      { error: `Message is too long (max ${MAX_MESSAGE_CHARS} characters).` },
      { status: 400 },
    );
  }

  const combined: ChatTurn[] = [...clientHistory, { role: "user", content: message }];
  // The model requires the first turn to be from the user.
  while (combined.length > 1 && combined[0]!.role === "assistant") combined.shift();
  // Fold the contact-bar context into the latest user turn so the agent always
  // sees it, without breaking the user/assistant alternation.
  if (leadContext) {
    const last = combined[combined.length - 1]!;
    combined[combined.length - 1] = { ...last, content: `${leadContext}\n\n${last.content}` };
  }
  const history = combined;

  // Best-effort persistence for the admin dashboard when a database is present;
  // never required for the reply, and harmless (per-instance) in memory mode.
  await addMessage(sessionId, { role: "user", content: message }).catch(() => undefined);
  await logEvent(sessionId, "message_sent", { chars: message.length }).catch(() => undefined);

  // Absolute base URL for the one-pager link the agent hands to the visitor.
  const origin = new URL(request.url).origin;

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      // Tracks whether any prose reached the client, so the error handler knows
      // whether it needs a paragraph break before appending.
      const result = { textEmitted: false };

      const emit = (event: AgentEvent) => {
        if (closed) return;
        if (event.type === "text") result.textEmitted = true;
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };

      try {
        const agentResult = await runAgent(
          history,
          { sessionId, baseUrl: origin, domain: null, research: null, customerName: null },
          emit,
        );

        if (agentResult.text.trim()) {
          await addMessage(sessionId, {
            role: "assistant",
            content: agentResult.text,
            model: CHAT_MODEL,
            inputTokens: agentResult.inputTokens,
            outputTokens: agentResult.outputTokens,
          });
        }

        emit({ type: "done" });
      } catch (error) {
        console.error("agent run failed", sessionId, error);

        // Distinguish an exhausted API balance from a transient fault. Both are
        // ours, not the visitor's, but only one is fixed by retrying — and an
        // operator staring at "please try again" won't think to check billing.
        const message = error instanceof Error ? error.message : "";
        const outOfCredit = /credit balance is too low/i.test(message);

        emit({
          type: "error",
          // Leading break: this appends to whatever prose already streamed, and
          // without it the apology collides with the last word ("...for you.Sorry").
          value:
            (result.textEmitted ? "\n\n" : "") +
            (outOfCredit
              ? "I'm temporarily unable to respond — our team has been notified. Please email contact@cloudsufi.com and we'll pick this straight up."
              : "Sorry, I hit a problem on my side. Please try again, or email contact@cloudsufi.com."),
        });

        if (outOfCredit) {
          console.error(
            "ANTHROPIC API CREDIT EXHAUSTED — top up at https://platform.claude.com/settings/billing",
          );
        }
      } finally {
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
}
