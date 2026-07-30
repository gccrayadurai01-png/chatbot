import { randomUUID } from "crypto";
import type { ChatTurn } from "./agent";

/**
 * Storage for the chat path, with two backends:
 *
 *  - Postgres, when DATABASE_URL is set. This is the real one.
 *  - In-memory, when it isn't. Lets you run the widget locally with only an
 *    Anthropic key. Everything is lost on restart and each server instance has
 *    its own copy, so it is for local development and demos only.
 *
 * The admin dashboard requires Postgres — there is nothing durable to
 * administer in memory mode.
 */
export const usingPostgres = Boolean(process.env.DATABASE_URL);

export type StoredMessage = {
  role: "user" | "assistant";
  content: string;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  createdAt: Date;
};

type MemorySession = {
  id: string;
  visitorId: string | null;
  startedAt: Date;
  lastSeenAt: Date;
  messages: StoredMessage[];
};

/**
 * Held on globalThis, not as a plain module-level const.
 *
 * Next gives each route its own module instance, so a bare `new Map()` here
 * would leave /api/chat/session and /api/chat/message writing to two different
 * maps — the session would be created and then instantly "not found". The same
 * applies across hot reloads.
 */
const globalForMemory = globalThis as unknown as {
  csMemorySessions?: Map<string, MemorySession>;
};

const memory: Map<string, MemorySession> =
  globalForMemory.csMemorySessions ?? new Map<string, MemorySession>();
globalForMemory.csMemorySessions = memory;

// Bound memory growth in long-running dev servers.
const MEMORY_SESSION_LIMIT = 500;

export async function createSession(input: {
  visitorId: string | null;
  referrer: string | null;
  userAgent: string | null;
}): Promise<string> {
  if (!usingPostgres) {
    if (memory.size >= MEMORY_SESSION_LIMIT) {
      const oldest = [...memory.values()].sort(
        (a, b) => a.lastSeenAt.getTime() - b.lastSeenAt.getTime(),
      )[0];
      if (oldest) memory.delete(oldest.id);
    }
    const id = randomUUID();
    memory.set(id, {
      id,
      visitorId: input.visitorId,
      startedAt: new Date(),
      lastSeenAt: new Date(),
      messages: [],
    });
    return id;
  }

  const { queryOne } = await import("./db");
  const row = await queryOne<{ id: string }>(
    `INSERT INTO chat_sessions (visitor_id, referrer, user_agent)
     VALUES ($1, $2, $3) RETURNING id`,
    [input.visitorId, input.referrer, input.userAgent],
  );
  if (!row) throw new Error("Failed to insert chat session");
  return row.id;
}

export async function sessionExists(sessionId: string): Promise<boolean> {
  if (!usingPostgres) return memory.has(sessionId);

  const { queryOne } = await import("./db");
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM chat_sessions WHERE id = $1 AND closed_at IS NULL`,
    [sessionId],
  );
  return Boolean(row);
}

/** Most recent `limit` turns, oldest first — the order the API expects. */
export async function getHistory(sessionId: string, limit: number): Promise<ChatTurn[]> {
  if (!usingPostgres) {
    const session = memory.get(sessionId);
    if (!session) return [];
    return session.messages
      .slice(-limit)
      .map((m) => ({ role: m.role, content: m.content }));
  }

  const { query } = await import("./db");
  const rows = await query<{ role: "user" | "assistant"; content: string }>(
    `SELECT role, content FROM messages
      WHERE session_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT $2`,
    [sessionId, limit],
  );
  return rows.reverse().map((r) => ({ role: r.role, content: r.content }));
}

export async function addMessage(
  sessionId: string,
  message: Omit<StoredMessage, "createdAt">,
): Promise<void> {
  if (!usingPostgres) {
    const session = memory.get(sessionId);
    if (!session) return;
    session.messages.push({ ...message, createdAt: new Date() });
    session.lastSeenAt = new Date();
    return;
  }

  const { query } = await import("./db");
  await query(
    `INSERT INTO messages (session_id, role, content, model, input_tokens, output_tokens)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      sessionId,
      message.role,
      message.content,
      message.model ?? null,
      message.inputTokens ?? null,
      message.outputTokens ?? null,
    ],
  );
  await query(`UPDATE chat_sessions SET last_seen_at = now() WHERE id = $1`, [sessionId]);
}

export async function logEvent(
  sessionId: string | null,
  name: string,
  properties: Record<string, unknown> = {},
): Promise<void> {
  if (!usingPostgres) return; // Analytics needs durable storage; skip in memory mode.

  const { query } = await import("./db");
  await query(`INSERT INTO events (session_id, name, properties) VALUES ($1, $2, $3)`, [
    sessionId,
    name,
    JSON.stringify(properties),
  ]);
}
