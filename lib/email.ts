/**
 * Work-email gating.
 *
 * A personal address is close to worthless for GTM: no company to research, no
 * account to match in the CRM, and a much lower answer rate. So we ask for a
 * work address — but we never hard-block the conversation over it (see the
 * system prompt), because a refused visitor who still books a meeting is worth
 * more than a clean database row.
 */

const FREE_PROVIDERS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.in",
  "yahoo.co.uk",
  "ymail.com",
  "rocketmail.com",
  "outlook.com",
  "hotmail.com",
  "hotmail.co.uk",
  "live.com",
  "msn.com",
  "aol.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "gmx.com",
  "gmx.de",
  "mail.com",
  "zoho.com",
  "yandex.com",
  "yandex.ru",
  "fastmail.com",
  "hey.com",
  "tutanota.com",
  "rediffmail.com",
  "qq.com",
  "163.com",
  "126.com",
  "naver.com",
  "hanmail.net",
]);

/** Throwaway domains — these are a signal of bad intent, not just convenience. */
const DISPOSABLE_HINTS = [
  "mailinator",
  "guerrillamail",
  "10minutemail",
  "tempmail",
  "temp-mail",
  "throwaway",
  "yopmail",
  "trashmail",
  "sharklasers",
  "dispostable",
  "getnada",
  "maildrop",
];

// Deliberately permissive on the local part; the domain is what we care about.
const SHAPE = /^[^\s@]+@([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)$/i;

export type EmailVerdict =
  | { ok: true; email: string; domain: string }
  | {
      ok: false;
      reason: "malformed" | "free_provider" | "disposable";
      message: string;
      // Present whenever the shape matched (free_provider, disposable) so the
      // caller can offer an explicit "continue anyway" override. Absent only
      // for "malformed" — there's nothing to override on an invalid address.
      email?: string;
      domain?: string;
    };

export function classifyEmail(raw: string): EmailVerdict {
  const email = raw.trim().toLowerCase();
  const match = SHAPE.exec(email);

  if (!match) {
    return {
      ok: false,
      reason: "malformed",
      message: "That doesn't look like a valid email address.",
    };
  }

  const domain = match[1]!.toLowerCase();

  if (DISPOSABLE_HINTS.some((hint) => domain.includes(hint))) {
    return {
      ok: false,
      reason: "disposable",
      message: "That looks like a temporary address — please use your work email.",
      email,
      domain,
    };
  }

  if (FREE_PROVIDERS.has(domain)) {
    return {
      ok: false,
      reason: "free_provider",
      message:
        "That's a personal address. Please share your work email so this reaches the right team.",
      email,
      domain,
    };
  }

  return { ok: true, email, domain };
}

/** Best-effort company name from a domain, for use before research completes. */
export function companyNameFromDomain(domain: string): string {
  const base = domain.split(".")[0] ?? domain;
  return base
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
