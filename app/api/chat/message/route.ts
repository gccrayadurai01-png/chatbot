import { CHAT_MODEL, runAgent, type AgentEvent, type ChatTurn } from "@/lib/agent";
import { addMessage, getHistory, logEvent, sessionExists } from "@/lib/store";
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
  try {
    const body = (await request.json()) as { sessionId?: unknown; message?: unknown };
    if (typeof body.sessionId !== "string" || typeof body.message !== "string") {
      return Response.json({ error: "sessionId and message are required" }, { status: 400 });
    }
    sessionId = body.sessionId;
    message = body.message.trim();
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

  if (!(await sessionExists(sessionId))) {
    return Response.json({ error: "Unknown or expired session" }, { status: 404 });
  }

  const previous = await getHistory(sessionId, HISTORY_TURNS);
  const history: ChatTurn[] = [...previous, { role: "user", content: message }];

  await addMessage(sessionId, { role: "user", content: message });
  await logEvent(sessionId, "message_sent", { chars: message.length });

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
