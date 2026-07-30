import { query } from "./db";

/**
 * Runtime config the sales team can change without a deploy.
 *
 * Falls back to env vars, then to a hardcoded default, so the agent still has a
 * working calendar link in memory mode (no database).
 */
export type SettingKey = "calendar_url" | "meeting_length" | "company_name";

const DEFAULTS: Record<SettingKey, string> = {
  calendar_url: process.env.CALENDAR_URL ?? "https://www.cloudsufi.com/request-demo/",
  meeting_length: process.env.MEETING_LENGTH ?? "15 minutes",
  company_name: process.env.COMPANY_NAME ?? "CLOUDSUFI",
};

let cache: { values: Record<string, string>; expiresAt: number } | null = null;

// Memory-mode overrides (no DB), kept on globalThis so all routes and hot
// reloads share them — the same pattern as sessions/offers/services.
const globalForSettings = globalThis as unknown as { csSettings?: Record<string, string> };
function memorySettings(): Record<string, string> {
  if (!globalForSettings.csSettings) globalForSettings.csSettings = {};
  return globalForSettings.csSettings;
}

export async function getSettings(): Promise<Record<SettingKey, string>> {
  if (!process.env.DATABASE_URL) {
    return { ...DEFAULTS, ...memorySettings() } as Record<SettingKey, string>;
  }
  if (cache && cache.expiresAt > Date.now()) {
    return { ...DEFAULTS, ...cache.values } as Record<SettingKey, string>;
  }

  try {
    const rows = await query<{ key: string; value: string }>(`SELECT key, value FROM settings`);
    const values = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    cache = { values, expiresAt: Date.now() + 30_000 };
    return { ...DEFAULTS, ...values } as Record<SettingKey, string>;
  } catch (error) {
    // A settings read must never break the conversation.
    console.error("settings unavailable, using defaults", error);
    return { ...DEFAULTS };
  }
}

export async function setSetting(key: SettingKey, value: string): Promise<void> {
  if (!process.env.DATABASE_URL) {
    memorySettings()[key] = value;
    return;
  }
  await query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, value],
  );
  cache = null;
}
