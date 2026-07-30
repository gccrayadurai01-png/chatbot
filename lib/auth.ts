import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

const COOKIE_NAME = "cloudsufi_admin";
const TOKEN_TTL = "12h";

function secret(): Uint8Array {
  const value = process.env.JWT_SECRET;
  if (!value || value.length < 32) {
    throw new Error(
      "JWT_SECRET must be set to at least 32 characters. Generate one with: openssl rand -base64 48",
    );
  }
  return new TextEncoder().encode(value);
}

export type AdminClaims = { adminId: string; email: string };

export async function createSessionToken(claims: AdminClaims): Promise<string> {
  return new SignJWT({ email: claims.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.adminId)
    .setIssuedAt()
    .setExpirationTime(TOKEN_TTL)
    .sign(secret());
}

/**
 * Reads the admin session from the httpOnly cookie. Returns null when absent,
 * expired, or tampered with.
 *
 * The token lives in an httpOnly cookie rather than localStorage — a token in
 * localStorage is readable by any script on the page, so a single XSS bug hands
 * over admin access.
 */
export async function getAdmin(): Promise<AdminClaims | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (!payload.sub || typeof payload.email !== "string") return null;
    return { adminId: payload.sub, email: payload.email };
  } catch {
    return null;
  }
}

export async function setSessionCookie(token: string): Promise<void> {
  (await cookies()).set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 12 * 60 * 60,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(COOKIE_NAME);
}

/** Guard for admin API routes. Throws a Response the route handler can return. */
export async function requireAdmin(): Promise<AdminClaims> {
  const admin = await getAdmin();
  if (!admin) {
    throw new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  return admin;
}
