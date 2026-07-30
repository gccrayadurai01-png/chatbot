import { getOffer } from "@/lib/offers";
import { getSettings } from "@/lib/settings";

export const runtime = "nodejs";

/**
 * GET /view/:token — a tiny full-page viewer that embeds the one-pager PDF in an
 * iframe. The raw PDF at /api/offer/:token is served `inline`, but some browsers
 * (and "always download PDFs" settings) still save it instead of showing it.
 * Embedding it in an HTML page forces the browser's built-in PDF viewer, so the
 * one-pager reliably OPENS IN A TAB — with the viewer's own download button
 * still one click away.
 */
export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;

  // JWT: three base64url segments separated by dots (offers are stateless tokens).
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
    return new Response("Not found", { status: 404 });
  }

  const [offer, settings] = await Promise.all([getOffer(token), getSettings()]);
  if (!offer) {
    return new Response("This one-pager has expired or does not exist.", { status: 404 });
  }

  const pdfUrl = `/api/offer/${token}`;
  const title = `${settings.company_name} — ${offer.company ?? "Your one-pager"}`;
  const esc = (s: string) =>
    s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: #0f2545; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  .bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; height: 52px; padding: 0 16px; background: #0f2545; color: #fff; }
  .bar strong { font-size: 14px; letter-spacing: 0.06em; }
  .bar .sub { font-size: 12px; opacity: 0.7; margin-left: 8px; }
  .dl { display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 8px; background: #2563eb; color: #fff; text-decoration: none; font-size: 13px; font-weight: 600; }
  .dl:hover { background: #1d4ed8; }
  .frame { width: 100%; height: calc(100% - 52px); border: 0; background: #52525b; }
</style>
</head>
<body>
  <div class="bar">
    <span><strong>${esc(settings.company_name.toUpperCase())}</strong><span class="sub">one-pager for ${esc(offer.company ?? "your team")}</span></span>
    <a class="dl" href="${pdfUrl}" download>Download PDF</a>
  </div>
  <iframe class="frame" src="${pdfUrl}" title="${esc(title)}"></iframe>
</body>
</html>`;

  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
