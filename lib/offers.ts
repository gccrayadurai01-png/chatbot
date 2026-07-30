import { SignJWT, jwtVerify } from "jose";
import { query } from "./db";

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
 * Offers are STATELESS: the whole payload is packed into a signed JWT that IS the
 * token in the one-pager URL. Any server instance can verify and decode it with
 * the shared JWT_SECRET, so the PDF link works even on serverless (Vercel), where
 * the request that opens the link may hit a different instance than the one that
 * created it. No database row, no in-memory map, nothing to lose on cold start.
 *
 * The signature is what makes the link safe to share unauthenticated — the token
 * can't be forged or tampered with, and nothing sensitive is inside it (our own
 * marketing copy plus the situation the visitor described).
 */
function secretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET ?? "cloudsufi-dev-insecure-secret-change-me";
  return new TextEncoder().encode(secret);
}

type OfferClaims = Omit<Offer, "token">;

export async function saveOffer(
  sessionId: string,
  offer: Omit<Offer, "token">,
): Promise<string> {
  const claims: OfferClaims = offer;

  const token = await new SignJWT({ o: claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    // Long-lived on purpose: a prospect may open the one-pager days later or
    // forward it internally. 90 days is a reasonable window for a sales asset.
    .setExpirationTime("90d")
    .sign(secretKey());

  // Best-effort: if a database is configured, note the newest offer on the lead
  // row so the dashboard can link to it. Never required for the link to work.
  if (process.env.DATABASE_URL) {
    await query(
      `UPDATE leads SET offer_token = $2, updated_at = now() WHERE session_id = $1`,
      [sessionId, token],
    ).catch(() => undefined);
  }

  return token;
}

export async function getOffer(token: string): Promise<Offer | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    const o = payload.o as OfferClaims | undefined;
    if (!o || typeof o.headline !== "string") return null;

    return {
      token,
      company: o.company ?? null,
      customerName: o.customerName ?? null,
      headline: o.headline,
      situation: o.situation ?? "",
      recommended: Array.isArray(o.recommended) ? o.recommended : [],
      outcomes: Array.isArray(o.outcomes) ? o.outcomes : [],
      caseStudyIds: Array.isArray(o.caseStudyIds) ? o.caseStudyIds : [],
      nextStep: o.nextStep ?? null,
    };
  } catch {
    // Bad signature, malformed, or expired — treat as not found.
    return null;
  }
}
