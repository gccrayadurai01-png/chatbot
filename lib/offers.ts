import { randomBytes } from "crypto";
import { query, queryOne } from "./db";

export type Offer = {
  token: string;
  company: string | null;
  customerName: string | null;
  headline: string;
  situation: string;
  recommended: string[];
  outcomes: string[];
  caseStudyIds: string[];
  nextStep: string | null;
};

/**
 * In-memory offers for when there's no database, kept on globalThis because Next
 * gives each route its own module instance (see lib/store.ts for the same
 * problem and the same fix).
 */
const globalForOffers = globalThis as unknown as { csOffers?: Map<string, Offer> };
const memoryOffers: Map<string, Offer> =
  globalForOffers.csOffers ?? new Map<string, Offer>();
globalForOffers.csOffers = memoryOffers;

/** 32 hex chars — unguessable, so the link is safe to share without auth. */
function newToken(): string {
  return randomBytes(16).toString("hex");
}

export async function saveOffer(
  sessionId: string,
  offer: Omit<Offer, "token">,
): Promise<string> {
  const token = newToken();

  if (!process.env.DATABASE_URL) {
    memoryOffers.set(token, { ...offer, token });
    return token;
  }

  await query(
    `INSERT INTO offers
       (session_id, token, company, customer_name, headline, situation,
        recommended, outcomes, case_study_ids, next_step)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      sessionId,
      token,
      offer.company,
      offer.customerName,
      offer.headline,
      offer.situation,
      offer.recommended,
      offer.outcomes,
      offer.caseStudyIds,
      offer.nextStep,
    ],
  );

  // Surface the newest offer on the lead row for the dashboard.
  await query(
    `UPDATE leads SET offer_token = $2, updated_at = now() WHERE session_id = $1`,
    [sessionId, token],
  ).catch(() => undefined);

  return token;
}

type OfferRow = {
  token: string;
  company: string | null;
  customer_name: string | null;
  headline: string;
  situation: string;
  recommended: string[];
  outcomes: string[];
  case_study_ids: string[];
  next_step: string | null;
};

export async function getOffer(token: string): Promise<Offer | null> {
  if (!process.env.DATABASE_URL) return memoryOffers.get(token) ?? null;

  const row = await queryOne<OfferRow>(
    `SELECT token, company, customer_name, headline, situation, recommended,
            outcomes, case_study_ids, next_step
       FROM offers WHERE token = $1`,
    [token],
  );
  if (!row) return null;

  // Fire and forget — a view counter must not slow the download.
  void query(`UPDATE offers SET view_count = view_count + 1 WHERE token = $1`, [
    token,
  ]).catch(() => undefined);

  return {
    token: row.token,
    company: row.company,
    customerName: row.customer_name,
    headline: row.headline,
    situation: row.situation,
    recommended: row.recommended,
    outcomes: row.outcomes,
    caseStudyIds: row.case_study_ids,
    nextStep: row.next_step,
  };
}
